#!/usr/bin/env python3
"""Review assembled explainers in the browser — add notes, flip variants, tune tokens.

Stdlib only — needs Python 3.9+ (run ``python3 --version`` to confirm), no
Node or npm install. Serves one or more *assembled* explainer/sketch HTML
files on localhost with a review overlay injected on the fly; files on disk
are never modified:

- **Notes** — click any element to leave a note anchored to a CSS
  selector, its section, and a text snippet, so an agent can act on it.
- **A/B/C flip** — pass 2-3 variants (e.g. from ``assemble.py --variants``)
  and flip between them with scroll position preserved; pick a winner.
- **Design tuner** — live controls for type scale, content spacing, measure,
  and accent color; chosen values are recorded per variant.

Everything lands in ``<dir of first file>/_reviews/<name>/review.json`` plus a
prompt-ready ``review.md``. When done, the reviewer tells their agent:
"Apply the review in .explainers/_reviews/<name>/review.md".

Usage (run from the repo root):
    python3 .factory/skills/explainer/review.py .explainers/<topic>-explainer.html
    python3 .factory/skills/explainer/review.py a.html b.html c.html
    python3 .factory/skills/explainer/review.py a.html --port 7373 --no-open

Re-assembling a variant and refreshing the browser shows the new version —
files are re-read from disk on every request, and notes persist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import threading
import unicodedata
import webbrowser
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from runpy import run_path
from typing import TYPE_CHECKING, ClassVar, NoReturn, cast
from urllib.parse import unquote

if TYPE_CHECKING:
    from collections.abc import Callable

VARIANT_LABELS = "ABCDEFGH"
MAX_BODY_BYTES = 2_000_000
DEFAULT_PORT = 7373
DEFAULT_FONT_PCT = 100
MAX_STABLE_HOST_ID = 120
KIT_DIR = Path(__file__).resolve().parent
SHOWCASE = KIT_DIR / "showcase" / "components.html"
REVIEW_DIR = KIT_DIR / "review"
DEFAULT_TOKENS: dict[str, object] = {
    "font_pct": 100,
    "space_scale": 1.0,
    "measure": None,  # style-dependent; only recorded when changed
    "orb_opacity": None,
    "accent": None,
    "accent_preset": None,
    "accent_mode": None,
}
CSP_META_RE = re.compile(
    r'<meta\s+http-equiv="Content-Security-Policy"[^>]*>', re.IGNORECASE | re.DOTALL
)
STAMP_LINE_RE = re.compile(r"assembled by [^\n]*")
STAMP_FIELD_RE = re.compile(r"(style|source|recipe)=([^\s·]+)")
STAMP_VERSION_RE = re.compile(r"assembled by \S+ v([0-9][\w.]*)")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
RESERVED_SLUGS = {"gallery", "preview", "showcase"}


def die(msg: str) -> NoReturn:
    """Print `msg` prefixed with the script name and exit with status 1."""
    sys.exit(f"review.py: error: {msg}")


def slug_base(stem: str) -> str:
    """Normalize a file stem into a non-empty, URL-safe semantic slug."""
    ascii_stem = (
        unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii").lower()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_stem).strip("-") or "explainer"
    return f"explainer-{slug}" if slug.isdigit() or slug in RESERVED_SLUGS else slug


def page_slugs(paths: list[Path]) -> dict[Path, str]:
    """Return stable file-derived slugs, hashing every normalization collision."""
    resolved = {path.resolve(): path for path in paths}
    bases: dict[str, list[Path]] = {}
    for path in resolved:
        bases.setdefault(slug_base(path.stem), []).append(path)
    slugs: dict[Path, str] = {}
    used: set[str] = set()
    for base in sorted(bases):
        group = sorted(bases[base], key=lambda path: path.name)
        for path in group:
            slug = base
            if len(group) > 1 or slug in used:
                digest = hashlib.sha256(path.name.encode("utf-8")).hexdigest()
                width = 8
                slug = f"{base}-{digest[:width]}"
                if slug in used:
                    digest = hashlib.sha256(path.as_posix().encode("utf-8")).hexdigest()
                    slug = f"{base}-{digest[:width]}"
                while slug in used:
                    width += 2
                    slug = f"{base}-{digest[:width]}"
            used.add(slug)
            slugs[path] = slug
    return slugs


@dataclass
class Variant:
    """One reviewable HTML file: an assembled explainer or sketch."""

    path: Path
    label: str
    style: str
    source: str
    title: str
    version: str = ""  # kit version stamped at assembly time; "" when unstamped


@dataclass(frozen=True)
class PageContext:
    """Immutable snapshot of the served page's review state and paths.

    Review mode has one context. Studio registers one per open explainer and
    binds the matching snapshot to each request, so two browser tabs cannot
    save into each other's review files. The ``state`` dict itself is still
    mutated under ``state_lock``; the frozen dataclass freezes the snapshot
    reference rather than its nested values.
    """

    variants: list[Variant]
    state: dict[str, object]
    json_path: Path
    md_path: Path
    preview_dir: Path = Path("_reviews")
    source_path: Path | None = None
    styles: tuple[str, ...] = ()


def empty_page_context() -> PageContext:
    """Build the placeholder context served until startup binds the real page.

    A factory, not a shared constant: ``state`` stays mutable, so each handler
    class needs its own dict.
    """
    return PageContext(
        variants=[], state={}, json_path=Path("review.json"), md_path=Path("review.md")
    )


def load_variant(path: Path, label: str, *, content: str | None = None) -> Variant:
    """Read stamp metadata (style, content source) out of an assembled page.

    Parses only the kit's ``assembled by …`` stamp line near the top of the
    file — a bare ``style=``/``source=`` elsewhere in the head (e.g. a CSS
    ``[data-style="…"]`` selector) is not metadata.

    Parameters
    ----------
    path : Path
        An assembled explainer/sketch ``.html`` file.
    label : str
        The single-letter variant label (``"A"``, ``"B"``, ...) to stamp
        onto the returned :class:`Variant`.
    content : str, optional
        Pre-read file text. When given, `path` is not opened (its existence
        is not checked either) — lets a caller that already has the bytes
        (e.g. ``/api/pages`` scanning a folder) reuse them instead of
        reading each candidate a second time. Only the first 6000 chars are
        inspected, matching the on-disk path.

    Returns
    -------
    Variant
        Populated from the stamp when present; ``style``/``source`` are ""
        and ``version`` is "" for an unstamped (non-kit or pre-stamp) page.
    """
    if content is None:
        if not path.is_file():
            die(f"file not found: {path}")
        head = path.read_text(encoding="utf-8", errors="replace")[:6000]
    else:
        head = content[:6000]
    # Parse only the kit's `assembled by …` stamp line — a bare style=/source=
    # elsewhere in the head (e.g. a CSS [data-style="…"] selector) is not metadata.
    stamp_line = STAMP_LINE_RE.search(head)
    fields: dict[str, str] = {}
    version = ""
    if stamp_line:
        for key, value in STAMP_FIELD_RE.findall(stamp_line.group(0)):
            fields.setdefault(key, value)
        version_m = STAMP_VERSION_RE.search(stamp_line.group(0))
        if version_m:
            version = version_m.group(1)
    title_m = TITLE_RE.search(head)
    return Variant(
        path=path,
        label=label,
        style=fields.get("style", ""),
        source=fields.get("source", ""),
        title=title_m.group(1).strip() if title_m else path.name,
        version=version,
    )


def utc_now() -> str:
    """Return the current UTC time as ``YYYY-MM-DDTHH:MM:SSZ``."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── state ──────────────────────────────────────────────────────────────────


def empty_state(name: str, variants: list[Variant]) -> dict[str, object]:
    """Build a fresh, empty review state for `name` and its `variants`."""
    return {
        "review": name,
        "created": utc_now(),
        "updated": utc_now(),
        "variants": [
            {"label": v.label, "file": v.path.as_posix(), "style": v.style, "source": v.source}
            for v in variants
        ],
        "verdict": None,
        "general_notes": "",
        "comments": [],
        "edits": [],
        "tokens": {},
        "swaps": {},
        "canvas_edits": {},
        "roadmap_key_items": {},
        "sections": [],
        "slides": [],
        "orders": {},
        "look": None,
    }


def _clip(value: object, limit: int) -> str:
    """Truncate `value` to `limit` chars if it's a str, else "" (drop it)."""
    return value[:limit] if isinstance(value, str) else ""


def sanitize_region(raw: object) -> dict[str, float] | None:
    """Accept a finite rectangle in normalized anchor coordinates."""
    if not isinstance(raw, dict):
        return None
    result: dict[str, float] = {}
    for key in ("x", "y", "width", "height"):
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not 0 <= value <= 1:
            return None
        result[key] = float(value)
    if result["width"] <= 0 or result["height"] <= 0:
        return None
    bound_with_rounding = 1.000001
    if (
        result["x"] + result["width"] > bound_with_rounding
        or result["y"] + result["height"] > bound_with_rounding
    ):
        return None
    return result


def sanitize_comment(raw: object) -> dict[str, object] | None:
    """Keep only the known, bounded comment fields; drop anything malformed."""
    if not isinstance(raw, dict):
        return None
    comment = _clip(raw.get("comment"), 4000).strip()
    if not comment:
        return None
    ident = raw.get("id")
    kind = _clip(raw.get("kind"), 8)
    region = sanitize_region(raw.get("region"))
    return {
        **({"region": region} if region else {}),
        "id": ident if isinstance(ident, int) else 0,
        # Keep the compatible note/remix schema values. Both are presented
        # to reviewers as Notes; remix means the requested change is open-ended.
        "kind": kind if kind in ("note", "remix") else "note",
        "variant": _clip(raw.get("variant"), 4) or "A",
        "section": _clip(raw.get("section"), 200),
        "selector": _clip(raw.get("selector"), 600),
        "snippet": _clip(raw.get("snippet"), 300),
        "comment": comment,
        "theme": _clip(raw.get("theme"), 12),
        "created": _clip(raw.get("created"), 40) or utc_now(),
    }


def sanitize_edit(raw: object) -> dict[str, object] | None:
    """One in-place text edit typed on the page in edit-text mode."""
    if not isinstance(raw, dict):
        return None
    selector = _clip(raw.get("selector"), 600).strip()
    before = _clip(raw.get("before"), 1200)
    after = _clip(raw.get("after"), 1200)
    if not selector or before == after:
        return None
    return {
        "selector": selector,
        "before": before,
        "after": after,
        "variant": _clip(raw.get("variant"), 4) or "A",
        "section": _clip(raw.get("section"), 200),
        "created": _clip(raw.get("created"), 40) or utc_now(),
    }


def sanitize_tokens(raw: object) -> dict[str, object]:
    """Bound the per-variant tuner values to plain scalars."""
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, object] = {}
    for key in DEFAULT_TOKENS:
        value = raw.get(key)
        if key == "accent_preset":
            if value == "adyen":
                clean[key] = value
            continue
        if key == "accent_mode":
            if value in ("safe", "contrast"):
                clean[key] = value
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            clean[key] = value
        elif isinstance(value, str) and value:
            clean[key] = value[:40]
    return clean


def _sanitize_verdict(raw: object, labels: list[str]) -> dict[str, object] | None:
    """Return the preferred-variant verdict, or None when unset/invalid."""
    if isinstance(raw, dict) and _clip(raw.get("preferred"), 4) in labels:
        return {
            "preferred": _clip(raw.get("preferred"), 4),
            "decided_at": _clip(raw.get("decided_at"), 40) or utc_now(),
        }
    return None


def _sanitize_comments(raw: object, labels: list[str]) -> list[dict[str, object]]:
    """Every location-aware Note, sanitized and label-filtered."""
    comments: list[dict[str, object]] = []
    if isinstance(raw, list):
        for item in raw[:500]:
            clean = sanitize_comment(item)
            if clean is not None and clean["variant"] in labels:
                comments.append(clean)
    return comments


def _sanitize_edits(raw: object, labels: list[str]) -> list[dict[str, object]]:
    """Every on-page text edit, sanitized and label-filtered."""
    edits: list[dict[str, object]] = []
    if isinstance(raw, list):
        for item in raw[:300]:
            clean = sanitize_edit(item)
            if clean is not None and clean["variant"] in labels:
                edits.append(clean)
    return edits


def _sanitize_tokens_by_label(raw: object, labels: list[str]) -> dict[str, object]:
    """Return the design-tuner values, keyed by variant label."""
    tokens: dict[str, object] = {}
    if isinstance(raw, dict):
        for label in labels:
            if label in raw:
                clean = sanitize_tokens(raw[label])
                if clean:
                    tokens[label] = clean
    return tokens


CANVAS_EDIT_CODECS = {
    name: cast(
        "Callable[[object], dict[str, object]]",
        run_path(str(KIT_DIR / "components" / f"{name.replace('-', '_')}_editor.py"))[
            "_sanitize_record"
        ],
    )
    for name in ("architecture", "operating-model")
}


def _sanitize_canvas_record(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {}
    kind = raw.get("kind", "architecture")
    codec = CANVAS_EDIT_CODECS.get(kind) if isinstance(kind, str) else None
    return codec(raw) if codec else {}


def invalid_canvas_records(raw: object) -> bool:
    """Return whether persisted canvas edits contain an invalid record."""
    if not isinstance(raw, dict):
        return False
    return any(
        isinstance(record, dict) and "kind" in record and not _sanitize_canvas_record(record)
        for hosts in raw.values()
        if isinstance(hosts, dict)
        for record in hosts.values()
    )


def _sanitize_canvas_edits(raw: object, labels: list[str]) -> dict[str, object]:
    """Keep bounded, versioned node geometry keyed by variant, host and layout."""
    result: dict[str, object] = {}
    if not isinstance(raw, dict):
        return result
    for label in labels:
        hosts = raw.get(label)
        if not isinstance(hosts, dict):
            continue
        clean_hosts = {}
        for host, record in list(hosts.items())[:100]:
            if not isinstance(host, str) or not re.fullmatch(r"[\w-]{1,120}", host):
                continue
            clean = _sanitize_canvas_record(record)
            if clean:
                clean_hosts[host] = clean
        if clean_hosts:
            result[label] = clean_hosts
    return result


def _sanitize_swaps_by_label(raw: object, labels: list[str]) -> dict[str, object]:
    """Deterministic Studio settings, keyed by variant label.

    Per-variant ``{switch_key: bool}`` (or a string choice, e.g. ``kind:
    "area"``) — deterministic preview choices the agent bakes into the
    source afterwards.
    """
    swaps: dict[str, object] = {}
    if not isinstance(raw, dict):
        return swaps
    for label in labels:
        entry = raw.get(label)
        if not isinstance(entry, dict):
            continue
        clean_swaps: dict[str, object] = {}
        for key, value in list(entry.items())[:40]:
            if not isinstance(key, str):
                continue
            if isinstance(value, bool):
                clean_swaps[key[:120]] = value
            elif isinstance(value, str) and value:
                clean_swaps[key[:120]] = value[:40]  # choice options, e.g. kind: "area"
        if clean_swaps:
            swaps[label] = clean_swaps
    return swaps


def _sanitize_roadmap_key_record(raw: object) -> dict[str, list[str]]:
    """Sanitize one roadmap host's item IDs while preserving label alignment."""
    if not isinstance(raw, dict):
        return {}
    raw_ids = raw.get("item_ids")
    raw_labels = raw.get("labels")
    if not isinstance(raw_ids, list) or not isinstance(raw_labels, list):
        return {}
    item_ids: list[str] = []
    item_labels: list[str] = []
    for index, value in enumerate(raw_ids[:24]):
        if not isinstance(value, str) or not value.strip() or value[:120] in item_ids:
            continue
        item_ids.append(value[:120])
        label_value = raw_labels[index] if index < len(raw_labels) else ""
        item_labels.append(label_value[:160] if isinstance(label_value, str) else "")
    return {"item_ids": item_ids, "labels": item_labels} if item_ids else {}


def _sanitize_roadmap_key_items(raw: object, labels: list[str]) -> dict[str, object]:
    """Keep bounded roadmap key-item previews by variant and stable host id."""
    result: dict[str, object] = {}
    if not isinstance(raw, dict):
        return result
    for label in labels:
        hosts = raw.get(label)
        if not isinstance(hosts, dict):
            continue
        clean_hosts = {
            host: clean
            for host, record in list(hosts.items())[:100]
            if isinstance(host, str) and 0 < len(host) <= MAX_STABLE_HOST_ID
            if (clean := _sanitize_roadmap_key_record(record))
        }
        if clean_hosts:
            result[label] = clean_hosts
    return result


def _sanitize_sections(raw: object, labels: list[str]) -> list[dict[str, object]]:
    """Section-divider previews authored in Studio, without replacing content."""
    sections: list[dict[str, object]] = []
    if not isinstance(raw, list):
        return sections
    allowed_patterns = {"ribbons", "dots", "arcs", "iso", "waves", "frames", "rays", "swarm"}
    # A review saved before kit v3.4.0 can name a retired pattern. Rewrite it
    # to the successor renderSection resolves to; rejecting it here would
    # silently drop the whole inserted section on the next load.
    retired_patterns = {"contours": "arcs", "grid": "iso"}
    for item in raw[:50]:
        if not isinstance(item, dict):
            continue
        ident = _clip(item.get("id"), 80)
        target = _clip(item.get("target"), 120)
        title = _clip(item.get("title"), 56).strip()
        pattern = _clip(item.get("pattern"), 16)
        pattern = retired_patterns.get(pattern, pattern)
        variant = _clip(item.get("variant"), 4) or "A"
        if (
            not re.fullmatch(r"st-section-[a-z0-9-]+", ident)
            or not target
            or not title
            or pattern not in allowed_patterns
            or variant not in labels
        ):
            continue
        sections.append(
            {
                "id": ident,
                "target": target,
                "title": title,
                "kicker": _clip(item.get("kicker"), 28).strip(),
                "mode": "chapter",
                "pattern": pattern,
                "variant": variant,
                "created": _clip(item.get("created"), 40) or utc_now(),
            }
        )
    return sections


def _sanitize_slides(raw: object, labels: list[str]) -> list[dict[str, object]]:
    """Keep bounded Studio slide insertion/removal requests."""
    slides: list[dict[str, object]] = []
    if not isinstance(raw, list):
        return slides
    visuals = {
        "roadmap",
        "architecture",
        "sequence",
        "erd",
        "operating-model",
        "chart",
        "flow",
        "flow-timeline",
        "table-rows",
        "table-before-after",
        "table-compare",
        "table-grid",
        "table-chips",
        "table-specs",
        "tree-org",
        "tree-files",
        "tree-evolution",
        "loop",
        "stepper",
        "code",
        "stack",
        "stack-diff",
        "chart-bars",
        "chart-line",
        "chart-split",
        "chart-dumbbell",
        "chart-histogram",
        "chart-heatmap",
        "chart-dots",
        "chart-scatter",
        "chart-map",
        "chart-stat",
        "architecture-trace",
        "iceberg",
        "pyramid",
    }
    for item in raw[:50]:
        if not isinstance(item, dict):
            continue
        ident = _clip(item.get("id"), 80)
        variant = _clip(item.get("variant"), 4) or "A"
        target = _clip(item.get("target"), 120).strip()
        action = _clip(item.get("action"), 6)
        visual = _clip(item.get("visual"), 32)
        title = _clip(item.get("title"), 120).strip()
        brief = _clip(item.get("brief"), 4000).strip()
        if (
            not re.fullmatch(r"st-slide-[a-z0-9-]+", ident)
            or not target
            or variant not in labels
            or action not in ("insert", "remove")
            or (action == "insert" and (not title or visual not in visuals))
            or (action == "remove" and visual and visual not in visuals)
        ):
            continue
        slides.append(
            {
                "id": ident,
                "variant": variant,
                "target": target,
                "title": title,
                "visual": visual,
                "brief": brief,
                "action": action,
                "created": _clip(item.get("created"), 40) or utc_now(),
            }
        )
    return slides


def _sanitize_look(raw: object) -> dict[str, object] | None:
    """Return the look chosen in the studio panel.

    Picking a style there IS the preference for how the page should be
    assembled.
    """
    if isinstance(raw, dict) and _clip(raw.get("style"), 40):
        return {
            "style": _clip(raw.get("style"), 40),
            "variant": _clip(raw.get("variant"), 4),
        }
    return None


def _sanitize_orders(raw: object, labels: list[str]) -> dict[str, list[str]]:
    """Keep bounded, unique section identifiers per known variant."""
    if not isinstance(raw, dict):
        return {}
    orders: dict[str, list[str]] = {}
    for label, ids in raw.items():
        if label not in labels or not isinstance(ids, list):
            continue
        clean = list(
            dict.fromkeys(
                value
                for value in ids[:128]
                if isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]{0,127}", value)
            )
        )
        if clean:
            orders[label] = clean
    return orders


def sanitize_state(raw: object, base: dict[str, object], labels: list[str]) -> dict[str, object]:
    """Merge a client-posted state into `base`, keeping only known fields.

    Every field is re-derived from `raw` field-by-field (bounded lengths,
    type checks, membership in `labels`) rather than trusted wholesale, since
    `raw` is untrusted JSON posted by the browser overlay. Unknown or
    malformed top-level keys in `raw` are silently dropped; a `raw` that
    isn't even a dict returns `base` unchanged.

    Parameters
    ----------
    raw : object
        The parsed JSON body of a POST to ``/api/state``.
    base : dict[str, object]
        The state to merge into — normally the server's current state, so
        fields `raw` doesn't touch (e.g. after a partial client update) keep
        their prior values.
    labels : list[str]
        The variant labels in play (``["A"]``, ``["A", "B"]``, ...); comments,
        edits, tokens, swaps, and section previews referencing any other label are dropped.

    Returns
    -------
    dict[str, object]
        A new state dict — `base` is never mutated.
    """
    if not isinstance(raw, dict):
        return base
    state = dict(base)
    state["general_notes"] = _clip(raw.get("general_notes"), 20000)
    state["verdict"] = _sanitize_verdict(raw.get("verdict"), labels)
    state["comments"] = _sanitize_comments(raw.get("comments"), labels)
    state["edits"] = _sanitize_edits(raw.get("edits"), labels)
    state["tokens"] = _sanitize_tokens_by_label(raw.get("tokens"), labels)
    state["swaps"] = _sanitize_swaps_by_label(raw.get("swaps"), labels)
    state["canvas_edits"] = _sanitize_canvas_edits(raw.get("canvas_edits"), labels)
    state["roadmap_key_items"] = _sanitize_roadmap_key_items(raw.get("roadmap_key_items"), labels)
    state["sections"] = _sanitize_sections(raw.get("sections"), labels)
    state["slides"] = _sanitize_slides(raw.get("slides"), labels)
    state["orders"] = _sanitize_orders(raw.get("orders"), labels)
    state["look"] = _sanitize_look(raw.get("look"))
    state["updated"] = utc_now()
    return state


# ── review.md rendering ────────────────────────────────────────────────────


def format_tokens(tokens: dict[str, object]) -> str:
    """Render one variant's non-default tuner values as a "·"-joined line."""
    parts: list[str] = []
    font_pct = tokens.get("font_pct")
    if isinstance(font_pct, (int, float)) and font_pct != DEFAULT_FONT_PCT:
        parts.append(f"type scale {font_pct:g}%")
    space = tokens.get("space_scale")
    if isinstance(space, (int, float)) and space != 1.0:
        parts.append(
            f"content spacing within each slide ×{space:g}"
            " (set --content-space-scale on the document root; includes Present)"
        )
    measure = tokens.get("measure")
    if measure:
        parts.append(f"measure {measure}")
    orb = tokens.get("orb_opacity")
    if isinstance(orb, (int, float)):
        parts.append(f"orb opacity {orb:g}")
    mode = tokens.get("accent_mode")
    if mode in ("safe", "contrast"):
        parts.append(f"accent accessibility {mode} (set data-accent-mode on the document root)")
    preset = tokens.get("accent_preset")
    if preset == "adyen":
        parts.append("accent preset Adyen (Malachite #0ABF53 dark / Midnight #00112C light)")
    accent = tokens.get("accent")
    if accent:
        parts.append(f"accent {accent}")
    return " · ".join(parts)


def _md_intro(state: dict[str, object]) -> list[str]:
    """Build the title and generated-by line."""
    return [
        f"# Explainer review — {state.get('review', '')}",
        "",
        f"_skills/explainer/review.py · {state.get('updated', '')}_",
        "",
        "Edit the content source (not the assembled HTML), re-assemble with"
        " `assemble.py`, re-serve for another pass.",
        "",
    ]


def _md_source(variants: list[Variant]) -> list[str]:
    """One-line source reference so the agent knows which file to edit."""
    if not variants:
        return []
    v = variants[0]
    parts = [f"`{v.path.as_posix()}`"]
    if v.style:
        parts.append(f"style={v.style}")
    if v.source:
        parts.append(f"source={v.source}")
    return [" · ".join(parts), ""]


def _md_verdict(verdict: object) -> list[str]:
    """Record the preferred variant when the reviewer selected one."""
    if not isinstance(verdict, dict) or not verdict.get("preferred"):
        return []
    return ["", f"preferred variant: **{verdict.get('preferred')}**", ""]


def _md_tokens(tokens: object) -> list[str]:
    """Build the "## Design-token adjustments" section — omitted when there are none."""
    if not isinstance(tokens, dict) or not tokens:
        return []
    lines = ["", "## Design-token adjustments (from the live tuner)", ""]
    for label in sorted(tokens):
        token_values = tokens[label]
        if isinstance(token_values, dict):
            formatted = format_tokens(token_values)
            if formatted:
                lines.append(f"- **{label}**: {formatted}")
    lines.append("")
    lines.append(
        "Apply by adjusting the chosen style's tokens (or a new `styles/<name>.css`"
        " following the token contract), not by inline-editing the assembled page."
    )
    return lines


def _md_look(look: object) -> list[str]:
    """Build the "## Look (chosen in the studio)" section — omitted when unset."""
    if not isinstance(look, dict) or not look.get("style"):
        return []
    return [
        "",
        "## Look (chosen in the studio)",
        "",
        f"- **{look.get('style')}** — set `meta.style` in the content source to match",
    ]


def _md_swaps(swaps: object) -> list[str]:
    """Build the "## Studio settings" section — omitted when there are none."""
    if not isinstance(swaps, dict) or not swaps:
        return []
    lines = [
        "",
        "## Studio settings",
        "",
        "Bake each into the content source so they survive re-assembly.",
        "",
    ]
    for label in sorted(swaps):
        entry = swaps[label]
        if isinstance(entry, dict):
            for key in sorted(entry):
                value = entry[key]
                shown = value if isinstance(value, str) else ("on" if value else "off")
                lines.append(f"- {key}: {shown}")
    return lines


def _md_roadmap_key_items(value: object) -> list[str]:
    """Render exact roadmap key-item IDs and labels for the source-edit handoff."""
    if not isinstance(value, dict) or not value:
        return []
    lines = [
        "",
        "## Roadmap key commitments",
        "",
        "Apply these exact item IDs to the matching roadmap source. The Studio preview did not edit the source.",
        "",
    ]
    for variant in sorted(value):
        hosts = value[variant]
        if not isinstance(hosts, dict):
            continue
        for host in sorted(hosts):
            record = hosts[host]
            if not isinstance(record, dict):
                continue
            ids = record.get("item_ids")
            labels = record.get("labels")
            if not isinstance(ids, list):
                continue
            safe_host = str(host).replace("`", "'").replace("\n", " ")
            lines.append(f"- Variant {variant} · host `{safe_host}`")
            for index, item_id in enumerate(ids):
                label = labels[index] if isinstance(labels, list) and index < len(labels) else ""
                safe_id = str(item_id).replace("`", "'").replace("\n", " ")
                safe_label = str(label).replace("\n", " ") if label else ""
                suffix = f" — {safe_label}" if safe_label else ""
                lines.append(f"  - `{safe_id}`{suffix}")
    return lines


def _md_sections(sections: object) -> list[str]:
    """Build the content-preserving section-slide handoff."""
    if not isinstance(sections, list) or not sections:
        return []
    lines = [
        "",
        "## Section slides",
        "",
        "Insert each divider before the named section. Keep the existing section content as the next slide, add `section` to `meta.components`, and give the divider `layout:'cover'` in the Present manifest.",
        "",
    ]
    for item in sections:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "Section").replace("`", "'").replace("\n", " ")
        target = str(item.get("target") or "").replace("`", "'").replace("\n", " ")
        kicker = str(item.get("kicker") or "").replace("`", "'").replace("\n", " ")
        context = f" · kicker `{kicker}`" if kicker else ""
        lines.append(
            f"- Variant {item.get('variant') or 'A'} · before `#{target}`: **{title}** · pattern `{item.get('pattern')}`{context}"
        )
    return lines


def _md_slides(slides: object) -> list[str]:
    """Build the handoff for inserted and removed ordinary slides."""
    if not isinstance(slides, list) or not slides:
        return []
    lines = [
        "",
        "## Ordinary slide changes",
        "",
        "Studio previews use placeholder/sample data and are never factual. Implement each request in the content source and Present manifest, then replace the sample data with real content derived from the brief. If an inserted slide has no brief, ask the user for the factual content before inventing any.",
        "",
    ]
    for item in slides:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "insert")
        target = str(item.get("target") or "").replace("`", "'").replace("\n", " ")
        title = str(item.get("title") or "").replace("`", "'").replace("\n", " ")
        visual = str(item.get("visual") or "").replace("`", "'").replace("\n", " ")
        brief = str(item.get("brief") or "").replace("\n", " ")
        if action == "remove":
            lines.append(
                f"- Variant {item.get('variant') or 'A'} · remove authored slide `#{target}` from the source and Present manifest."
            )
        else:
            lines.append(
                f"- Variant {item.get('variant') or 'A'} · insert `#{item.get('id')}` before `#{target}` · title **{title}** · visual `{visual}`"
            )
            lines.append(f"  - brief: {brief}")
    return lines


def _md_edits(edits: object) -> list[str]:
    """Build the "## Text edits" section — omitted when there are none."""
    if not isinstance(edits, list) or not edits:
        return []
    lines = [
        "",
        f"## Text edits ({len(edits)})",
        "",
        "Apply verbatim in the content source: find `before`, replace with `after`.",
        "",
    ]
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        where = str(edit.get("section") or "") or f"`{edit.get('selector')}`"
        lines.append(f"- {where}")
        lines.append(f'  - before: "{edit.get("before")}"')
        lines.append(f'  - after: "{edit.get("after")}"')
    return lines


def _md_comment(item: dict[str, object]) -> list[str]:
    """Compact agent-targeted block for a location-aware Note."""
    kind = str(item.get("kind") or "note")
    section = str(item.get("section") or "(no section)")
    snippet = str(item.get("snippet") or "").strip()
    selector = str(item.get("selector") or "")
    comment = str(item.get("comment") or "").strip()
    host_part = f" · `{selector}`" if selector else ""

    if kind == "remix":
        current = f" (was: {snippet})" if snippet else ""
        lines = [
            "",
            f"### {section}{host_part}{current}",
            f"> {comment}",
            "intent: propose ideas or apply the requested component change",
        ]
    else:
        # Standard Note.
        lines = ["", f"### {section}{host_part}", f"> {comment}"]
        theme = str(item.get("theme") or "")
        if theme:
            lines.append(f"theme: {theme}")

    region = sanitize_region(item.get("region"))
    if region:
        lines.append(f"selected area (relative to selector): {json.dumps(region)}")

    return lines


def _md_comments(comments_value: object) -> list[str]:
    """Build the optional location-aware Notes sections."""
    all_comments: list[object] = comments_value if isinstance(comments_value, list) else []
    notes = [c for c in all_comments if isinstance(c, dict) and c.get("kind") != "remix"]
    remixes = [c for c in all_comments if isinstance(c, dict) and c.get("kind") == "remix"]
    lines: list[str] = []
    if remixes:
        lines.append("")
        lines.append(f"## Notes requesting ideas or component changes ({len(remixes)})")
        lines.append("")
        lines.append(
            "Act on each Note at its specified location. If the request is open-ended,"
            " propose 2-3 options before applying. Data contracts:"
            " `references/CONTRACTS.md`."
        )
        for item in remixes:
            lines.extend(_md_comment(item))
    if notes:
        lines.append("")
        lines.append(f"## Notes ({len(notes)})")
        for item in notes:
            lines.extend(_md_comment(item))
    return lines


def _md_footer(state: dict[str, object], md_path: Path) -> list[str]:
    """Build the "## General notes" section plus the machine-readable-copy footer."""
    general_notes_text = str(state.get("general_notes") or "").strip()
    return [
        "",
        "## General notes",
        "",
        general_notes_text or "(none)",
        "",
        "---",
        "",
        f"_Machine-readable copy: `{md_path.with_suffix('.json').as_posix()}`_",
        "",
    ]


def render_md(state: dict[str, object], variants: list[Variant], md_path: Path) -> str:
    """Render the prompt-ready markdown an agent applies to the source.

    Sections appear only when they have content (e.g. the ideas-request
    Notes section is omitted when empty), so an empty review renders as
    a short, uncluttered file rather than a wall of "(none)" headers. Each
    section is built by its own ``_md_*`` helper and appended in order here.

    Parameters
    ----------
    state : dict[str, object]
        A sanitized review state (see :func:`sanitize_state`).
    variants : list[Variant]
        The variants this review covers, in label order, for the "Variants"
        section and to resolve the preferred label's marker.
    md_path : Path
        The path this markdown will be written to; only its ``.json``
        sibling name is referenced, in the "machine-readable copy" footer.

    Returns
    -------
    str
        The complete markdown document, ready to write to disk.
    """
    lines = _md_intro(state)
    lines.extend(_md_source(variants))
    lines.extend(_md_verdict(state.get("verdict")))
    lines.extend(_md_tokens(state.get("tokens")))
    lines.extend(_md_look(state.get("look")))
    lines.extend(_md_sections(state.get("sections")))
    lines.extend(_md_slides(state.get("slides")))
    orders = state.get("orders")
    if isinstance(orders, dict) and orders:
        lines.extend(
            [
                "## Section order",
                "",
                "Move whole sections in the source and update the Present manifest to match. Keep each section's continuation slides together; preserve all content.",
                "",
            ]
        )
        for label, ids in orders.items():
            if isinstance(ids, list):
                lines.append(f"- Variant {label}: " + " → ".join(f"`#{value}`" for value in ids))
        lines.append("")
    canvas_edits = state.get("canvas_edits")
    if isinstance(canvas_edits, dict) and canvas_edits:
        lines.extend(
            [
                "## Canvas adjustments",
                "",
                "Apply each host record as `canvasEdits` in that component's source data, then reassemble. Records with `kind: operating-model` contain authored phases, capability presence and states, delivery groups, and colours. Preserve their stable IDs and null cells. Other records contain normalized layout geometry; do not flatten one layout into another. Retain unrelated source fields.",
                "",
                "```json",
                json.dumps(canvas_edits, indent=2, ensure_ascii=False),
                "```",
                "",
            ]
        )
    lines.extend(_md_swaps(state.get("swaps")))
    lines.extend(_md_roadmap_key_items(state.get("roadmap_key_items")))
    lines.extend(_md_edits(state.get("edits")))
    lines.extend(_md_comments(state.get("comments")))
    lines.extend(_md_footer(state, md_path))
    return "\n".join(lines)


# ── HTML injection ─────────────────────────────────────────────────────────


def load_overlay_assets() -> tuple[str, str]:
    """Read the overlay's CSS/JS from disk, fresh on every call.

    The assets live as real, editable files (``review/review.css``,
    ``review/store.js``, and ``review/review.js`` next to this script) rather than strings embedded
    in Python — mirrors how studio.py reads ``studio/studio.css`` +
    ``studio/studio.js`` (see :func:`studio.inject_studio`), so a human can
    edit either and just refresh the browser.

    Returns
    -------
    tuple[str, str]
        ``(css, js)``, each read fresh from disk.
    """
    css_path = REVIEW_DIR / "review.css"
    store_path = REVIEW_DIR / "store.js"
    js_path = REVIEW_DIR / "review.js"
    missing = [path for path in (css_path, store_path, js_path) if not path.is_file()]
    if missing:
        die("overlay assets missing — expected " + ", ".join(str(path) for path in missing))
    js = store_path.read_text(encoding="utf-8") + "\n" + js_path.read_text(encoding="utf-8")
    return css_path.read_text(encoding="utf-8"), js


def inject_overlay(html: str, boot: dict[str, object]) -> str:
    """Insert the review overlay before </body>, stripping any sketch CSP.

    The served bytes are modified; the file on disk never is. The app-sketch
    recipe ships an offline-only CSP whose ``connect-src 'none'`` would block
    the overlay's save calls, so review mode removes the meta tag (and says
    so in the overlay badge via ``csp_stripped``).

    Parameters
    ----------
    html : str
        The assembled page's full HTML, as read from disk.
    boot : dict[str, object]
        The overlay's bootstrap payload (see
        :meth:`ReviewHandler.variant_boot`); ``csp_stripped`` is added to a
        copy of it here, so the caller's dict is not mutated.

    Returns
    -------
    str
        `html` with the overlay's ``<style>``/``<script>`` block inserted
        before ``</body>`` (appended at the end when no ``</body>`` is
        found), and any sketch CSP ``<meta>`` tag replaced with a comment.
    """
    stripped = CSP_META_RE.search(html) is not None
    if stripped:
        html = CSP_META_RE.sub("<!-- CSP removed by review.py (review mode only) -->", html, 1)
    boot = dict(boot)
    boot["csp_stripped"] = stripped
    payload = json.dumps(boot).replace("</", "<\\/")
    css, js = load_overlay_assets()
    block = (
        f'<style id="rv-style">{css}</style>'
        f'<script id="rv-boot">window.__RV__ = {payload};</script>'
        f'<script id="rv-app">{js}</script>'
    )
    lower = html.lower()
    at = lower.rfind("</body>")
    if at == -1:
        return html + block
    return html[:at] + block + html[at:]


# ── HTTP server ────────────────────────────────────────────────────────────
#
# Request → context → save, for this server and for Studio's subclass:
#
#   GET  /           ─▶ variant HTML + injected overlay      (disk untouched)
#   GET  /api/state  ─▶ self.context.state
#   POST /api/state  ─▶ sanitize_state ─▶ replace(context, state=…)
#                        ─▶ _store_context ─▶ review.json + review.md
#
# self.context is the page this request serves. Review mode has one; Studio
# binds one per open tab (studio.py: contexts[review name]) before handling.


class ReviewHandler(BaseHTTPRequestHandler):
    """Serves the variants with the overlay injected, plus the state API."""

    server_version = "explainer-review/1"
    # Per-page snapshot, reassigned as a unit under state_lock so a request
    # never sees a half-switched page. A plain class attribute, not a ClassVar:
    # Studio binds its own per-tab context on the instance.
    context: PageContext = empty_page_context()
    state_lock: ClassVar[threading.Lock] = threading.Lock()

    def _store_context(self, context: PageContext) -> None:
        """Replace this server's context after a state mutation.

        Studio overrides this hook to update its page-keyed registry instead
        of a process-global active page.
        """
        type(self).context = context
        self.context = context

    # `format` (not `fmt`) matches BaseHTTPRequestHandler.log_message's own
    # parameter name — pyrefly's override check (bad-override-param-name)
    # requires it verbatim even though this override never calls it by
    # keyword.
    def log_message(  # pyrefly: ignore[missing-override-decorator]
        self,
        format: str,  # noqa: A002
        *args: object,
    ) -> None:
        """Silence per-request logging; the overlay shows save feedback."""

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str) -> None:
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _send_json(self, payload: object, *, code: int = 200) -> None:
        self._send(code, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def _check_request_origin(self) -> bool:
        """Return True when a POST is same-origin to this loopback server.

        Browsers always send ``Origin`` (or a same-origin ``Referer``) on a
        POST, so a cross-site form/fetch trying to drive the review state
        (CSRF) carries a header that does not match this server. ``Host``
        must always name the bound loopback host:port. Non-browser clients
        (urllib, curl) that send neither ``Origin`` nor ``Referer`` are
        allowed through the ``Host`` check alone — they are not CSRF vectors
        and the loopback bind is the boundary for them.
        """
        # server_address is typed loosely on the base class; the server is
        # always a ThreadingHTTPServer bound to ("127.0.0.1", port).
        port = cast("tuple[str, int]", self.server.server_address)[1]
        expected_host = f"127.0.0.1:{port}"
        if self.headers.get("Host", "") != expected_host:
            return False
        origin = self.headers.get("Origin")
        if origin is not None:
            return origin == f"http://{expected_host}"
        referer = self.headers.get("Referer")
        if referer is not None:
            return referer.startswith(f"http://{expected_host}/")
        return True

    def do_GET(self) -> None:
        """Dispatch a GET request to one of the review server's routes.

        Routes
        ------
        ``/``
            Redirects to the first variant's semantic route.
        ``/api/state``
            The current review state, as JSON.
        ``/showcase``
            The kit's component showcase (so reviewers can learn the
            vocabulary without leaving the review).
        ``/review.md``
            The rendered handoff file, as plain text.
        ``/<slug>``
            The file-stem-derived semantic route for a variant.
        Anything else
            404.
        """
        route = self._resolve_route(self.path.split("?", 1)[0])
        if route is None:
            self._send(404, b"not found", "text/plain")
            return
        route()

    def _resolve_route(self, path: str) -> Callable[[], None] | None:
        """Map `path` to its no-argument handler, or None for an unknown route."""
        exact: dict[str, Callable[[], None]] = {
            "/": self._route_root,
            "/api/state": self._route_state,
            "/showcase": self._route_showcase,
            "/review.md": self._route_review_md,
        }
        if path in exact:
            return exact[path]
        match = re.fullmatch(r"/([^/]+)", path)
        if match:
            try:
                slug = unquote(match.group(1), errors="strict")
            except UnicodeDecodeError:
                return None
            if not SLUG_RE.fullmatch(slug):
                return None
            index = self._slug_index(slug)
            if index is not None:
                return lambda: self._route_variant(index)
        return None

    def _route_root(self) -> None:
        """``/`` redirects to the first variant's canonical semantic route."""
        if not self.context.variants:
            self._send(404, b"unknown variant", "text/plain")
            return
        self.send_response(302)
        self.send_header("Location", f"/{self._variant_slug(0)}")
        self.end_headers()

    def _slug_map(self) -> dict[Path, str]:
        """Return canonical slugs for the current variants."""
        return page_slugs([variant.path for variant in self.context.variants])

    def _variant_slug(self, index: int) -> str:
        """Return the canonical server-generated slug for a variant."""
        return self._slug_map()[self.context.variants[index].path.resolve()]

    def _slug_index(self, slug: str) -> int | None:
        """Resolve a canonical slug to its current variant index."""
        slugs = self._slug_map()
        return next(
            (
                index
                for index, variant in enumerate(self.context.variants)
                if slugs[variant.path.resolve()] == slug
            ),
            None,
        )

    def _route_state(self) -> None:
        """``/api/state`` returns the current review state as JSON."""
        with self.state_lock:
            self._send_json(self.context.state)

    def _route_showcase(self) -> None:
        """``/showcase`` serves the kit's component showcase.

        Lets reviewers learn the vocabulary ("use a loop here") without
        leaving the review.
        """
        if not SHOWCASE.is_file():
            self._send(404, b"showcase not found in the kit", "text/plain")
            return
        self._send_html(SHOWCASE.read_text(encoding="utf-8", errors="replace"))

    def _route_review_md(self) -> None:
        """``/review.md`` serves the rendered handoff file as plain text.

        "See exactly what the agent receives" — the finish view links here.
        """
        if not self.context.md_path.is_file():
            self._send(404, b"no review yet", "text/plain")
            return
        self._send(200, self.context.md_path.read_bytes(), "text/plain; charset=utf-8")

    def _route_variant(self, index: int) -> None:
        """Serve one variant at its canonical semantic route."""
        if index >= len(self.context.variants):
            self._send(404, b"unknown variant", "text/plain")
            return
        variant = self.context.variants[index]
        try:
            html = variant.path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            self._send(500, f"cannot read {variant.path}: {exc}".encode(), "text/plain")
            return
        self._send_html(inject_overlay(html, self.variant_boot(index)))

    def variant_boot(self, index: int) -> dict[str, object]:
        """Build the overlay bootstrap payload for one variant.

        Also used by studio.py, which extends the returned dict with its own
        ``studio`` key before handing it to :func:`inject_overlay`.

        Parameters
        ----------
        index : int
            The variant's position in ``self.context.variants``.

        Returns
        -------
        dict[str, object]
            Assigned to ``window.__RV__`` in the served page: the variant
            list, a deep copy of the current review state, the showcase and
            review.md URLs, and ``built_ms`` (the served file's on-disk
            mtime, used to detect a rebuild since the last save).
        """
        with self.state_lock:
            state_copy = json.loads(json.dumps(self.context.state))
        return {
            "index": index,
            "variants": [
                {
                    "label": v.label,
                    "file": v.path.as_posix(),
                    "style": v.style,
                    "title": v.title,
                    "slug": self._variant_slug(variant_index),
                }
                for variant_index, v in enumerate(self.context.variants)
            ],
            "state": state_copy,
            "state_url": "/api/state",
            "canvas_editors": dict.fromkeys(CANVAS_EDIT_CODECS, 1),
            "review_url": "/review.md",
            "md_path": self.context.md_path.as_posix(),
            "showcase": "/showcase" if SHOWCASE.is_file() else "",
            # when the served file is newer than the review, the agent has
            # rebuilt it — the overlay offers to archive the applied notes
            "built_ms": int(self.context.variants[index].path.stat().st_mtime * 1000)
            if self.context.variants[index].path.is_file()
            else 0,
        }

    def do_POST(self) -> None:
        """Handle ``POST /api/state``: sanitize and persist a posted review state.

        Any other path 404s. The body must be JSON no larger than
        `MAX_BODY_BYTES`; a posted ``review`` name that doesn't match the
        currently served page is rejected with 409 (a stale tab left open on
        a page the studio has since switched away from).
        """
        if not self._check_request_origin():
            self._send_json({"error": "forbidden origin"}, code=403)
            return
        if self.path.split("?", 1)[0] != "/api/state":
            self._send(404, b"not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json({"error": "body too large or empty"}, code=413)
            return
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json({"error": "invalid JSON"}, code=400)
            return
        # stale-tab guard: a tab left open on a previously served page must
        # not write its state into the page the studio switched to
        if isinstance(parsed, dict):
            posted_name = parsed.get("review")
            if (
                isinstance(posted_name, str)
                and posted_name
                and posted_name != self.context.state.get("review")
            ):
                self._send_json({"error": "this tab shows another page — refresh it"}, code=409)
                return
        if isinstance(parsed, dict) and invalid_canvas_records(parsed.get("canvas_edits")):
            self._send_json({"error": "invalid canvas edits; review not changed"}, code=400)
            return
        labels = [v.label for v in self.context.variants]
        with self.state_lock:
            merged = sanitize_state(parsed, self.context.state, labels)
            updated_context = replace(self.context, state=merged)
            self._store_context(updated_context)
            persist_state(
                merged,
                updated_context.variants,
                updated_context.json_path,
                updated_context.md_path,
            )
            summary = state_summary(merged)
            updated = merged["updated"]
        # the socket write stays outside the lock — a stalled client must not
        # stall every other request that needs state_lock (ThreadingHTTPServer)
        print(summary, flush=True)
        self._send_json({"ok": True, "updated": updated})


def _tuner_summary(state: dict[str, object]) -> str:
    """Return a compact description of saved design-token adjustments."""
    tokens = state.get("tokens")
    if not isinstance(tokens, dict) or not any(v for v in tokens.values()):
        return ""
    return "tuner " + "/".join(sorted(k for k, v in tokens.items() if v))


def _list_summary(state: dict[str, object], key: str, singular: str) -> str:
    """Return a pluralized count for one non-empty review list."""
    value = state.get(key)
    if not isinstance(value, list) or not value:
        return ""
    return f"{len(value)} {singular}{'s' if len(value) != 1 else ''}"


def _content_summary(state: dict[str, object]) -> list[str]:
    """Return saved review entries that change story content or structure."""
    parts = [
        _list_summary(state, "comments", "note"),
        _list_summary(state, "edits", "text edit"),
        _list_summary(state, "sections", "section slide"),
        _list_summary(state, "slides", "ordinary slide change"),
    ]
    if state.get("orders"):
        parts.append("section order")
    if state.get("canvas_edits"):
        parts.append("canvas adjustments")
    return [part for part in parts if part]


def _has_saved_values(value: object) -> bool:
    """Return whether a per-variant record contains at least one value."""
    return isinstance(value, dict) and any(value.values())


def _design_summary(state: dict[str, object]) -> list[str]:
    """Return saved visual, component, and variant decisions."""
    parts: list[str] = []
    if _has_saved_values(state.get("roadmap_key_items")):
        parts.append("roadmap key commitments")
    swaps = state.get("swaps")
    if isinstance(swaps, dict) and _has_saved_values(swaps):
        count = sum(len(value) for value in swaps.values() if isinstance(value, dict))
        parts.append(f"{count} swap{'s' if count != 1 else ''}")
    tuner = _tuner_summary(state)
    if tuner:
        parts.append(tuner)
    look = state.get("look")
    if look:
        parts.append(f"look {look}")
    verdict = state.get("verdict")
    if isinstance(verdict, dict) and verdict.get("preferred"):
        parts.append(f"preferred {verdict['preferred']}")
    return parts


def state_summary(state: dict[str, object]) -> str:
    """Render one terminal line describing a just-saved review state.

    The overlay POSTs the full state (debounced) on every gesture, so this
    prints roughly once per reviewer action — enough to follow a session
    from the terminal without opening review.json.

    Parameters
    ----------
    state : dict[str, object]
        A sanitized review state (see :func:`sanitize_state`).

    Returns
    -------
    str
        e.g. ``saved 14:02:11 · adyen-main · 3 notes · 1 text edit · look playful``.
    """
    stamp = datetime.now(tz=timezone.utc).astimezone().strftime("%H:%M:%S")
    parts = [f"saved {stamp} · {state.get('review') or '?'}"]
    parts.extend(_content_summary(state))
    parts.extend(_design_summary(state))
    return " · ".join(parts)


def persist_state(
    state: dict[str, object], variants: list[Variant], json_path: Path, md_path: Path
) -> None:
    """Write review.json + review.md atomically (tmp file, then replace).

    Parameters
    ----------
    state : dict[str, object]
        A sanitized review state (see :func:`sanitize_state`) to serialize.
    variants : list[Variant]
        Passed through to :func:`render_md` for the "Variants" section.
    json_path : Path
        Destination for the machine-readable state (``review.json``).
    md_path : Path
        Destination for the rendered handoff file (``review.md``).

    Returns
    -------
    None
        `json_path` and `md_path` are written as a side effect; each via a
        sibling ``.tmp`` file that is then renamed over the target, so a
        concurrent reader never sees a half-written file.
    """
    json_path.parent.mkdir(parents=True, exist_ok=True)
    # Review feedback and studio previews are throwaway working files. Teams
    # that track explainers in git shouldn't have to remember that: drop a
    # self-ignoring .gitignore into _reviews/ so its contents never show up
    # as untracked noise. (The content source and assembled page are the
    # assets worth committing.)
    reviews_root = json_path.parent.parent
    if reviews_root.name == "_reviews":
        gitignore = reviews_root / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text("*\n", encoding="utf-8")
    tmp = json_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(json_path)
    md_tmp = md_path.with_suffix(".md.tmp")
    md_tmp.write_text(render_md(state, variants, md_path), encoding="utf-8")
    md_tmp.replace(md_path)


def load_state(name: str, variants: list[Variant], json_path: Path) -> dict[str, object]:
    """Load and sanitize a saved review state, or start fresh (shared with studio.py)."""
    if not json_path.is_file():
        return empty_state(name, variants)
    try:
        loaded = json.loads(json_path.read_text(encoding="utf-8"))
    except ValueError:
        loaded = None
    base = empty_state(name, variants)
    if not isinstance(loaded, dict):
        return base
    state = sanitize_state(loaded, base, [v.label for v in variants])
    if isinstance(loaded.get("created"), str):
        state["created"] = loaded["created"]
    # sanitize_state stamps `updated` with utc_now(); on load, keep the
    # timestamp that was persisted at last save (mirrors `created` above)
    # so reopening a review doesn't reset its last-modified time.
    if isinstance(loaded.get("updated"), str):
        state["updated"] = loaded["updated"]
    return state


def main() -> None:
    """Parse CLI args, serve the review server, and block until Ctrl-C."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "files",
        nargs="+",
        metavar="HTML",
        help="assembled explainer/sketch .html files (2-3 for an A/B/C flip)",
    )
    ap.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"localhost port (default {DEFAULT_PORT}; falls back to a free port when busy)",
    )
    ap.add_argument("--no-open", action="store_true", help="do not open the browser automatically")
    args = ap.parse_args()

    if len(args.files) > len(VARIANT_LABELS):
        die(f"too many variants — {len(VARIANT_LABELS)} max")
    variants = [load_variant(Path(name), VARIANT_LABELS[i]) for i, name in enumerate(args.files)]

    first = variants[0].path
    name = first.stem
    review_dir = first.parent / "_reviews" / name
    json_path = review_dir / "review.json"
    md_path = review_dir / "review.md"
    state = load_state(name, variants, json_path)
    persist_state(state, variants, json_path, md_path)

    ReviewHandler.context = PageContext(
        variants=variants, state=state, json_path=json_path, md_path=md_path
    )

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), ReviewHandler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), ReviewHandler)
    port = server.server_address[1]
    slugs = page_slugs([variant.path for variant in variants])
    url = f"http://127.0.0.1:{port}/{slugs[first.resolve()]}"

    print(f"reviewing {len(variants)} variant(s):")
    for v in variants:
        style = f" · style={v.style}" if v.style else ""
        print(f"  {v.label} · {v.path}{style}")
    print(f"open: {url}", flush=True)
    print(f"feedback lands in: {md_path}")
    print(f'when done, tell your agent: "Apply the review in {md_path}"')
    print("stop with Ctrl-C · re-assemble + refresh to see new versions (notes persist)")

    if not args.no_open:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\nreview saved: {md_path}")


if __name__ == "__main__":
    main()
