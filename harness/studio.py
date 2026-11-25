#!/usr/bin/env python3
"""Studio — the review loop plus deterministic one-click tweaks, no model in the loop.

Everything review.py does (Notes, A/B/C flip, design tuner,
winner pick, review.md for the agent) PLUS a left-edge studio panel:

- **Theme controls** — one click re-assembles the page from its content source in
  another style (``assemble.py --style``, sub-second) and serves it in place.
  Files on disk are never modified; previews live in the git-ignored
  ``_reviews/`` directory.
- **Component switches** — components that register options (charts expose
  their walkthrough) toggle instantly in the page via client-side re-render.
  Supported switches, text, appearance, frames, and native shapes can be saved
  into the source and rebuilt locally without an agent.
- **Section slides** — add a reversible chapter divider before an existing
  slide, preview its pattern, and keep the original content untouched as the
  following slide.
- **PPTX export** — download the coordinated Present-mode sequence as editable
  native PowerPoint objects, with walkthrough states expanded into slides and
  atomic failure for unsupported content.

Maintainable by humans on purpose: the panel's UI lives in real files next to
this script (``studio/studio.css``, ``studio/studio.js``) and is re-read on
every request — edit them, refresh the browser, see the change. The server
logic reuses review.py (imported below) rather than duplicating it.

Usage (run from the repo root, same as assemble.py):
    python3 .factory/skills/explainer/studio.py explainers/<topic>-explainer.html
    python3 .factory/skills/explainer/studio.py explainers/          # newest page opens, folder list has the rest
    python3 .factory/skills/explainer/studio.py a.html b.html --port 7373 --no-open

Style flips re-assemble from the page's content source: the path recorded in
its ``assembled by …`` stamp when that file exists, else the source embedded
in every v3 page (recovered into ``_reviews/``). Only a pre-v3 page with no
reachable source hides the theme controls.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import html
import json
import os
import re
import runpy
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar
from urllib.parse import parse_qs, quote, unquote

KIT_DIR = Path(__file__).resolve().parent
STUDIO_DIR = KIT_DIR / "studio"

sys.path.insert(0, str(KIT_DIR))
# review.py lives next to this script, not on any package path — resolved at
# runtime via the sys.path insert above, invisible to the type checker.
import agent_adapters  # noqa: E402  # pyrefly: ignore[missing-import]
import review  # noqa: E402  # pyrefly: ignore[missing-import]

_AUTHORING: dict[str, Any] = runpy.run_path(str(KIT_DIR / "authoring.py"))
ManifestError = _AUTHORING["ManifestError"]
empty_authoring_manifest = _AUTHORING["empty_manifest"]
extract_authoring_manifest = _AUTHORING["extract_manifest"]
sanitize_authoring_manifest = _AUTHORING["sanitize_manifest"]
upsert_authoring_manifest = _AUTHORING["upsert_manifest"]

# every explainer assembled since v3 carries its own content source, base64
# in an inert script block (see assemble.py embed_source)
SOURCE_EMBED_RE = re.compile(
    r'<script type="text/x-explainer-source">\s*([A-Za-z0-9+/=\s]+?)\s*</script>'
)
MAX_SOURCE_EMBED_CHARS = 3_000_000
MAX_SOURCE_BYTES = 2_250_000
MAX_META_CHARS = 256_000
META_OPEN_RE = re.compile(
    r"<script\b[^>]{0,2048}\bdata-slot\s*=\s*(['\"])meta\1[^>]*>",
    re.IGNORECASE,
)
STAMP_COMPONENTS_RE = re.compile(r"\bcomponents=\[([A-Za-z0-9_.-]*(?:,[A-Za-z0-9_.-]+)*)\]")
PREVIEW_CHANNEL_RE = re.compile(r"[A-Za-z0-9-]{1,100}")
HANDOFF_FORMAT = "explainer-studio-handoff"
HANDOFF_VERSION = 2
HANDOFF_SETTLE_NS = 1_000_000_000
MAX_CONSUMED_TEXT_TARGETS = 500
MAX_CONSUMED_SWAP_KEYS = 100
MAX_CONSUMED_CANVAS_HOSTS = 100
MAX_CONSUMED_TEXT_TARGET_CHARS = 600
MAX_CONSUMED_SWAP_KEY_CHARS = 120
ASSEMBLE_TIMEOUT_SECONDS = 30


def _handoff_path(context: review.PageContext) -> Path:
    return context.preview_dir / "handoff.json"


def _read_handoff(context: review.PageContext) -> dict[str, object]:
    path = _handoff_path(context)
    if not path.is_file():
        return {"status": "editing"}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"status": "editing"}
    if (
        not isinstance(value, dict)
        or value.get("format") != HANDOFF_FORMAT
        or value.get("version") != HANDOFF_VERSION
    ):
        return {"status": "editing"}
    return value


def _write_handoff(context: review.PageContext, value: dict[str, object]) -> None:
    path = _handoff_path(context)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _fingerprint(path: Path) -> dict[str, int]:
    stat = path.stat()
    return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}


def _fingerprint_token(path: Path) -> str:
    value = _fingerprint(path)
    return f"{value['mtime_ns']}:{value['size']}"


def _bounded_string_list(value: object, max_items: int, max_chars: int) -> list[str] | None:
    """Return a list of bounded strings, or None when the value is malformed."""
    if not isinstance(value, list) or len(value) > max_items:
        return None
    strings: list[str] = []
    for item in value:
        if not isinstance(item, str) or len(item) > max_chars:
            return None
        strings.append(item)
    return strings


def _canvas_hosts(value: object) -> list[str] | None:
    """Return the bounded canvas-host list, or None when it is malformed."""
    if not isinstance(value, list) or len(value) > MAX_CONSUMED_CANVAS_HOSTS:
        return None
    hosts: list[str] = []
    for item in value:
        if not isinstance(item, str) or not re.fullmatch(r"[\w-]{1,120}", item):
            return None
        hosts.append(item)
    return hosts


def _drop_labeled_keys(
    mapping: dict[str, object], label: str, keys: set[str]
) -> dict[str, object] | None:
    """Return a copy of ``mapping`` minus ``keys`` under one label, or None."""
    current = mapping.get(label)
    if not isinstance(current, dict):
        return None
    updated = dict(mapping)
    remaining = {key: value for key, value in current.items() if key not in keys}
    if remaining:
        updated[label] = remaining
    else:
        updated.pop(label, None)
    return updated


def _atomic_write_text(path: Path, value: str) -> None:
    """Replace one local text file without exposing a partial source file."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.replace(path)


def _explainer_paths(variants: list[review.Variant], pages_dir: Path) -> list[Path]:
    """Return current variants and stamped direct siblings eligible for routes."""
    current = {variant.path.resolve() for variant in variants}
    paths = list(current)
    for candidate in sorted(pages_dir.glob("*.html")):
        resolved = candidate.resolve()
        if candidate.name.startswith("_") or resolved in current:
            continue
        try:
            info = review.load_variant(candidate, "A")
        except OSError:
            continue
        if info.version:
            paths.append(resolved)
    return paths


def _decode_source_embed(page_html: str) -> bytes | None:
    """Decode a bounded v3 source embed without executing or writing it."""
    match = SOURCE_EMBED_RE.search(page_html)
    if not match or len(match.group(1)) > MAX_SOURCE_EMBED_CHARS:
        return None
    try:
        return base64.b64decode("".join(match.group(1).split()), validate=True)
    except (binascii.Error, ValueError):
        return None


def _meta_counts(source: bytes) -> tuple[int | None, int | None]:
    """Return declared slide and unique-component counts from source meta."""
    try:
        text = source.decode("utf-8")
    except UnicodeDecodeError:
        return None, None
    opening = META_OPEN_RE.search(text)
    if opening is None:
        return None, None
    closing = text.lower().find("</script>", opening.end())
    if closing < 0 or closing - opening.end() > MAX_META_CHARS:
        return None, None
    try:
        meta = json.loads(text[opening.end() : closing])
    except (json.JSONDecodeError, RecursionError):
        return None, None
    if not isinstance(meta, dict):
        return None, None
    slides = meta.get("slides")
    components = meta.get("components")
    slide_count = len(slides) if isinstance(slides, list) else None
    component_count = (
        len({item for item in components if isinstance(item, str)})
        if isinstance(components, list)
        else None
    )
    return slide_count, component_count


def _page_counts(page_html: str) -> tuple[int | None, int | None]:
    """Read v3 counts from embedded meta; use the bounded stamp for older pages."""
    slide_count: int | None = None
    source = _decode_source_embed(page_html)
    if source is not None:
        slide_count, component_count = _meta_counts(source)
        if component_count is not None:
            return slide_count, component_count
    stamp = STAMP_COMPONENTS_RE.search(page_html[:6000])
    if stamp is None:
        return slide_count, None
    components: list[str] = stamp.group(1).split(",") if stamp.group(1) else []
    return slide_count, len(set(components))


def _source_file_counts(source: Path | None) -> tuple[int | None, int | None]:
    """Read metadata from a reachable stamped source within the embed size cap."""
    if source is None:
        return None, None
    try:
        if not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES:
            return None, None
        return _meta_counts(source.read_bytes())
    except OSError:
        return None, None


def recover_source(page: Path, review_dir: Path) -> Path | None:
    """Recover the content source embedded in an assembled page.

    Used when the page's stamped ``source=`` path is not on disk — a mailed
    or downloaded copy, a page opened on another machine. The source is
    written into the git-ignored ``_reviews/`` directory so style flips and
    one-click upgrades work exactly as if the original file were present.

    Parameters
    ----------
    page : Path
        An assembled explainer/sketch ``.html`` file to scan for an embedded
        source (see :func:`assemble.embed_source`).
    review_dir : Path
        The git-ignored directory to write the recovered source into.

    Returns
    -------
    Path or None
        The path of the written ``recovered-source-<stem>.html``, or None
        for pages older than the embed (pre-v3), non-kit pages, or a
        corrupt/truncated embed.
    """
    raw = _decode_source_embed(page.read_text(encoding="utf-8", errors="replace"))
    if raw is None:
        return None
    review_dir.mkdir(parents=True, exist_ok=True)
    out = review_dir / f"recovered-source-{page.stem}.html"
    out.write_bytes(raw)
    return out


def _sample_spacing_bridge() -> str:
    """Expose current geometry spacing helpers without redeclaring an older core."""
    # Reuse the current spacing helpers in a local scope. Old assembled
    # pages predate this API; loading the whole core would redeclare consts.
    core = (KIT_DIR / "components" / "_core.js").read_text(encoding="utf-8")
    helpers = []
    for name in ("kitContentSpacing", "kitObserveContentSpacing"):
        match = re.search(
            r"^function " + name + r"\([^)]*\) \{.*?^\}", core, re.MULTILINE | re.DOTALL
        )
        if match is None:
            message = f"Studio preview helper missing from _core.js: {name}"
            raise ValueError(message)
        helpers.append(match.group())
    return (
        '<script id="st-sample-core-compat">(function () {\n'
        + "\n".join(helpers)
        + """
      globalThis.ExplainerKit = globalThis.ExplainerKit || {};
      globalThis.ExplainerKit.contentSpacing ||= kitContentSpacing;
      globalThis.ExplainerKit.observeContentSpacing ||= kitObserveContentSpacing;
    })();
    </script>
    """
    )


def _sample_runtime(html: str) -> str:
    """Load missing renderer assets for Studio drafts, never into the shared HTML."""
    styles = "".join(re.findall(r"<style\b[^>]*>(.*?)</style>", html, re.IGNORECASE | re.DOTALL))
    styles = re.sub(r"\s+", "", re.sub(r"/\*.*?\*/", "", styles, flags=re.DOTALL))
    scripts = "\n".join(
        body
        for attrs, body in re.findall(
            r"<script\b([^>]*)>(.*?)</script>", html, re.IGNORECASE | re.DOTALL
        )
        if "source" not in attrs.lower()
    )
    components = KIT_DIR / "components"
    assets = [
        ("section", "function renderSection(sel, data)", ".ksc{"),
        ("roadmap", "function renderRoadmap(sel, data)", ".krm-"),
        ("geo-world", "window.__kitGeo", ".kch-map-sphere"),
        ("chart", "function renderChart(sel, data)", ".kch-"),
        ("flow", "function renderFlow(sel, data)", ".kf-"),
        ("table", "function renderTable(sel, data)", ".kt-"),
        ("tree", "function renderTree(sel, data)", ".ktr-"),
        ("loop", "function renderLoop(sel, data)", ".klp-"),
        ("stepper", "function renderStepper(sel, data)", ".kst-"),
        ("code", "function renderCode(sel, data)", ".kcd-"),
        ("trace", "function renderTrace(sel, data)", ".ktrace-"),
        ("iceberg", "function renderIceberg(sel, data)", ".kib-"),
        ("pyramid", "function renderPyramid(sel, data)", ".kpy-"),
        ("data-flow", "function renderDataFlow(sel, data)", ".kdf{"),
        ("architecture", "function renderArchitecture(sel, data)", ".kseq{"),
    ]
    blocks = []
    if "function kitMount(sel)" not in scripts:
        core = (components / "_core.js").read_text(encoding="utf-8")
        blocks.append(f'<script id="st-sample-core-component">{core}</script>')
    elif "contentSpacing: kitContentSpacing" not in scripts:
        blocks.append(_sample_spacing_bridge())
    # CSS comments can mention a component that the page never loaded. Check
    # actual styles and always pair a newly loaded renderer with its CSS.
    for name, renderer, selector in assets:
        prefix = "st-section" if name == "section" else f"st-sample-{name}"
        if renderer not in scripts or selector not in styles:
            css = (components / f"{name}.css").read_text(encoding="utf-8")
            blocks.append(f'<style id="{prefix}-style">{css}</style>')
        if renderer not in scripts or name == "section":
            js = (
                (components / f"{name}.js").read_text(encoding="utf-8")
                if renderer not in scripts
                else ""
            )
            blocks.append(f'<script id="{prefix}-component">{js}</script>')
    return "".join(blocks)


def inject_studio(html: str, boot: dict[str, object]) -> str:
    """Append Studio before </body>; reread assets so a refresh picks up edits."""
    editors = tuple(review.CANVAS_EDIT_CODECS)
    components = KIT_DIR / "components"
    css = (
        (STUDIO_DIR / "studio.css").read_text(encoding="utf-8")
        + "\n"
        + (STUDIO_DIR / "composition.css").read_text(encoding="utf-8")
        + "\n".join(
            (components / f"{name}.editor.css").read_text(encoding="utf-8") for name in editors
        )
    )
    scripts = (
        [
            KIT_DIR / "vendor" / "pptxgenjs-4.0.1.bundle.js",
            KIT_DIR / "base" / "authoring.js",
            STUDIO_DIR / "canvas.js",
        ]
        + [components / f"{name}.editor.js" for name in editors]
        + [
            STUDIO_DIR / "detach.js",
            STUDIO_DIR / "component-editor.js",
            STUDIO_DIR / "inline-edit-lenses.js",
            STUDIO_DIR / "inline-edit.js",
            STUDIO_DIR / "slides.js",
            STUDIO_DIR / "composition.js",
            STUDIO_DIR / "authoring.js",
            STUDIO_DIR / "pptx.js",
            STUDIO_DIR / "studio.js",
        ]
    )
    js = "\n".join(path.read_text(encoding="utf-8") for path in scripts)
    samples_js = (STUDIO_DIR / "samples.js").read_text(encoding="utf-8")
    component_editor_css = (STUDIO_DIR / "component-editor.css").read_text(encoding="utf-8")
    css += "\n" + component_editor_css
    css += "\n" + (STUDIO_DIR / "inline-edit.css").read_text(encoding="utf-8")
    capture = (STUDIO_DIR / "component-capture.js").read_text(encoding="utf-8")
    marker = "/* ── page-specific JS ── */"
    if marker in html:
        # This marker is *inside* the page's script block. Inline the Studio
        # hook ahead of page code instead of nesting a script tag there.
        html = html.replace(marker, capture + "\n" + marker, 1)
    payload = json.dumps(boot).replace("</", "<\\/")
    # Browsers request /favicon.ico on first interaction; the dev server has
    # none, so every Studio session logged a 404 console error. A data-URI
    # icon in the head pre-empts the request (Chrome ignores body-level ones).
    icon = quote(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>"
        "<rect width='16' height='16' rx='3' fill='#1c1c1e'/>"
        "<path d='M3.5 5.5h9M3.5 8h6.5M3.5 10.5h4.5' "
        "stroke='#f5f5f7' stroke-width='1.6' stroke-linecap='round'/>"
        "</svg>",
        # `#` must be percent-encoded: in a URL it starts a fragment, and
        # browsers cut the data URI at the first one, leaving broken SVG.
        safe="'<=> ",
    )
    icon_link = f'<link rel="icon" href="data:image/svg+xml,{icon}">'
    head_at = html.lower().find("<head>")
    if head_at != -1:
        at = head_at + len("<head>")
        html = html[:at] + icon_link + html[at:]
        icon_link = ""
    block = (
        f'{icon_link}<style id="st-style">{css}</style>'
        f"{_sample_runtime(html)}"
        f'<script id="st-samples">{samples_js}</script>'
        f'<script id="st-boot">window.__STUDIO__ = {payload};</script>'
        f'<script id="st-app">{js}</script>'
    )
    lower = html.lower()
    at = lower.rfind("</body>")
    if at == -1:
        return html + block
    return html[:at] + block + html[at:]


# One server, many open explainers:
#
#   any request     ─▶ _bind_context(review name) ─▶ contexts[name] ─▶ handler
#   GET /?style=…   ─▶ assemble.py --style ─▶ _reviews/ preview ─▶ served in place
#   state mutation  ─▶ _store_context ─▶ contexts[name] (other tabs untouched)


class StudioHandler(review.ReviewHandler):
    """review.py's handler plus ?style= re-assembly and the studio bundle."""

    server_version = "explainer-studio/1"
    # all_styles and pages_dir are set once at startup and never change per
    # served page, so they stay as plain ClassVars. Everything that varies
    # per page (variants/state/json_path/md_path/preview_dir/source_path/
    # styles) lives on an immutable PageContext registered by review name.
    all_styles: ClassVar[list[str]] = []
    pages_dir: ClassVar[Path] = Path()
    # Re-declared so startup can assign it on the class; the per-tab binding
    # below otherwise reads as instance-only.
    context: review.PageContext = review.empty_page_context()
    gallery_mode: ClassVar[bool] = False  # True when no specific file was given at startup
    build_lock: ClassVar[threading.Lock] = threading.Lock()
    handoff_mutation_lock: ClassVar[threading.Lock] = threading.Lock()
    agent_adapter: ClassVar[agent_adapters.HarnessAdapter | None] = None
    # /api/pages cache: (pages_dir mtime, pages list). Invalidated by
    # open_page/upgrade_variant, which change the served page or its bytes.
    pages_cache: ClassVar[tuple[tuple[float, str], list[dict[str, object]]] | None] = None
    contexts: ClassVar[dict[str, review.PageContext]] = {}
    # Page names mid-rebuild, keyed by review context name so the flag
    # survives the context object being replaced after a state save. Set and
    # cleared under handoff_mutation_lock; _send_handoff rejects a send while
    # the flag is up, and the lock is never held across the build itself.
    upgrading: ClassVar[set[str]] = set()

    @staticmethod
    def _context_name(context: review.PageContext) -> str:
        name = context.state.get("review")
        return name if isinstance(name, str) else ""

    def _store_context(self, context: review.PageContext) -> None:
        """Persist a request's context without changing another open tab."""
        name = self._context_name(context)
        if name:
            type(self).contexts[name] = context
        self.context = context

    def _bind_context(self, name: str) -> bool:
        """Bind an explicitly named review context to this request handler."""
        with self.state_lock:
            context = type(self).contexts.get(name)
        if context is None:
            return False
        self.context = context
        return True

    def _context_for_path(self, target: Path) -> tuple[review.PageContext, int]:
        """Return the registered context and variant index for an explainer path."""
        resolved = target.resolve()
        with self.state_lock:
            contexts = tuple(type(self).contexts.values())
        for context in contexts:
            for index, variant in enumerate(context.variants):
                if variant.path.resolve() == resolved:
                    return context, index
        context = self.open_page(target.name)
        return context, 0

    def variant_boot(self, index: int) -> dict[str, object]:
        """Extend review.py's bootstrap payload with the studio flag.

        Adding ``"studio": True`` tells the injected overlay JS to hide its
        own drawer tuner — the studio panel's fine-tune section owns it
        there instead, so the two don't render duplicate sliders.
        """
        boot = super().variant_boot(index)
        variants = boot.get("variants")
        if isinstance(variants, list):
            for variant_index, variant in enumerate(variants):
                if isinstance(variant, dict):
                    variant["slug"] = self._variant_slug(variant_index)
        boot["studio"] = True
        review_name = self._context_name(self.context)
        encoded_review = quote(review_name, safe="")
        try:
            page_token = _fingerprint_token(self.context.variants[index].path)
        except OSError:
            page_token = ""
        boot["state_url"] = (
            f"/api/state?review={encoded_review}&index={index}"
            f"&page_token={quote(page_token, safe='')}"
        )
        boot["page_token"] = page_token
        boot["review_url"] = f"/review.md?review={encoded_review}"
        boot["page_status_url"] = f"/api/page-status?review={encoded_review}"
        boot["handoff_url"] = (
            f"/api/handoff?review={encoded_review}" if self.agent_adapter is not None else ""
        )
        boot["agent_adapter"] = self.agent_adapter.name if self.agent_adapter is not None else ""
        boot["handoff"] = self._handoff_public_state(self.context)
        boot["upgrade_url"] = f"/api/upgrade?review={encoded_review}"
        boot["review"] = review_name
        source = self.context.source_path
        if source is not None:
            try:
                boot["source_token"] = _fingerprint_token(source)
                boot["authoring"] = extract_authoring_manifest(source.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, ManifestError):
                boot["source_token"] = ""
                boot["authoring"] = empty_authoring_manifest()
        else:
            boot["source_token"] = ""
            boot["authoring"] = empty_authoring_manifest()
        boot["authoring_url"] = f"/api/authoring?review={encoded_review}"
        return boot

    @staticmethod
    def _handoff_public_state(context: review.PageContext) -> dict[str, object]:
        value = _read_handoff(context)
        public = {
            "status": value.get("status", "editing"),
            "request_id": value.get("request_id", ""),
        }
        for key in ("agent", "agent_phase", "agent_detail", "agent_session_id"):
            item = value.get(key)
            if isinstance(item, str):
                public[key] = item
        created_ns = value.get("created_at_ns")
        if isinstance(created_ns, int):
            # Lets any tab render an honest elapsed clock, even after a
            # refresh during the wait.
            public["created_ms"] = created_ns // 1_000_000
        observed = value.get("observed")
        fingerprint = observed.get("fingerprint") if isinstance(observed, dict) else None
        if value.get("status") == "ready" and isinstance(fingerprint, dict):
            mtime_ns = fingerprint.get("mtime_ns")
            size = fingerprint.get("size")
            if isinstance(mtime_ns, int) and isinstance(size, int):
                public["completion_token"] = f"{mtime_ns}:{size}"
        return public

    @staticmethod
    def _snapshot_for(context: review.PageContext, variant: review.Variant) -> Path | None:
        handoff = _read_handoff(context)
        if handoff.get("status") != "waiting":
            return None
        snapshots = handoff.get("snapshots")
        if not isinstance(snapshots, list):
            return None
        resolved = variant.path.resolve().as_posix()
        for item in snapshots:
            if not isinstance(item, dict) or item.get("assembled") != resolved:
                continue
            snapshot = item.get("snapshot")
            if isinstance(snapshot, str):
                path = context.preview_dir / snapshot
                return path if path.is_file() else None
        return None

    def _explainer_paths(self) -> list[Path]:
        """Return current variants and stamped direct siblings eligible for routes."""
        return _explainer_paths(self.context.variants, self.pages_dir)

    def _slug_map(self) -> dict[Path, str]:
        """Return canonical slugs for all currently routable explainers."""
        return review.page_slugs(self._explainer_paths())

    def _variant_slug(self, index: int) -> str:
        """Return the server-generated slug for a current variant."""
        return self._slug_map()[self.context.variants[index].path.resolve()]

    def do_GET(self) -> None:
        """Dispatch a GET request: studio routes, then review.py's routes.

        Routes
        ------
        ``/gallery``
            Preview-first grid of every explainer in the folder, each with an
            iframe thumbnail. Entry point when no specific file is
            given at startup, and reachable from the studio panel at any time.
        ``/preview?file=<name>``
            Raw assembled page served without any overlay — used as the
            ``src`` of gallery thumbnail iframes.
        ``/api/pages``
            Every explainer next to the served one (re-scanned on each call).
        ``/<slug>[?style=<name>]``
            The file-derived semantic route for a variant or direct sibling;
            with ``?style=``, re-assembled in that
            style via :meth:`build_style` and served in place (the file on
            disk is never touched) with the studio bundle appended.
        Anything else
            Delegated to :meth:`review.ReviewHandler.do_GET`.
        """
        path, _, query = self.path.partition("?")
        review_name = (parse_qs(query).get("review") or [""])[0]
        if review_name and not self._bind_context(review_name):
            self._send_json({"error": "unknown review"}, code=404)
            return
        exact_routes = {
            "/": self._route_studio_root,
            "/gallery": self._route_gallery,
            "/preview": lambda: self._route_preview(query),
            "/api/pages": self._route_api_pages,
            "/api/page-status": lambda: self._route_api_page_status(query),
            "/api/state": self._route_state,
            "/showcase": self._route_showcase,
            "/review.md": self._route_review_md,
        }
        exact = exact_routes.get(path)
        if exact is not None:
            exact()
            return
        match = re.fullmatch(r"/([^/]+)", path)
        if not match:
            super().do_GET()
            return
        try:
            slug = unquote(match.group(1), errors="strict")
        except UnicodeDecodeError:
            self._send(404, b"unknown page", "text/plain")
            return
        if not review.SLUG_RE.fullmatch(slug):
            self._send(404, b"unknown page", "text/plain")
            return
        self._route_semantic_variant(slug, query)

    def _route_studio_root(self) -> None:
        """Redirect to the first canonical route, or Gallery with no open page."""
        location = f"/{self._variant_slug(0)}" if self.context.variants else "/gallery"
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _route_semantic_variant(self, slug: str, query: str) -> None:
        """Resolve a current variant or safely open a direct sibling by slug."""
        slug_map = self._slug_map()
        target = next((path for path, value in slug_map.items() if value == slug), None)
        if target is None:
            self._send(404, b"unknown page", "text/plain")
            return
        try:
            context, index = self._context_for_path(target)
        except (OSError, RuntimeError):
            self._send(404, b"unknown page", "text/plain")
            return
        self.context = context
        self._route_studio_variant(index, query, slug)

    def _route_api_pages(self) -> None:
        """``/api/pages`` lists every explainer next to the served one.

        Feeds the panel's folder browser; cached against the pages
        directory's mtime and the newest page file's mtime — a directory
        mtime alone misses an in-place rewrite (an external
        ``assemble.py --out <existing page>.html``) — and re-scanned only
        when either changes (the cache is also dropped by
        open_page/upgrade_variant, which change the served page or its
        bytes).
        """
        entries = sorted(self.pages_dir.glob("*.html"))
        dir_mtime = max(
            [self.pages_dir.stat().st_mtime] + [entry.stat().st_mtime for entry in entries]
        )
        current = self.context.variants[0].path.resolve() if self.context.variants else None
        cache_key = (dir_mtime, current.as_posix() if current else "")
        cached = StudioHandler.pages_cache
        if cached is not None and cached[0] == cache_key:
            self._send_json({"pages": cached[1]})
            return
        kit_version = (KIT_DIR / "VERSION").read_text(encoding="utf-8").strip()
        slugs = self._slug_map()
        # the embed marker is a fixed literal appended near the end of every
        # v3 page; a substring check on the whole file avoids decoding the
        # base64 payload just to answer "is there a source to rebuild from".
        embed_marker = '<script type="text/x-explainer-source">'
        pages: list[dict[str, object]] = []
        for candidate in entries:
            if candidate.name.startswith("_"):
                continue
            text = candidate.read_text(encoding="utf-8", errors="replace")
            info = review.load_variant(candidate, "A", content=text)
            if not info.version and candidate.resolve() != current:
                continue  # unstamped html (e.g. a stray content source) is not an explainer
            slide_count, component_count = _page_counts(text)
            stamped = _stamped_source([info], candidate)
            if slide_count is None or component_count is None:
                source_slides, source_components = _source_file_counts(stamped)
                if slide_count is None:
                    slide_count = source_slides
                if component_count is None:
                    component_count = source_components
            needs_upgrade = bool(info.version and info.version != kit_version)
            has_source = stamped is not None or embed_marker in text
            pages.append(
                {
                    "file": candidate.name,
                    "slug": slugs[candidate.resolve()],
                    "title": html.unescape(info.title),
                    "style": info.style,
                    "version": info.version,
                    "slide_count": slide_count,
                    "component_count": component_count,
                    "current": candidate.resolve() == current,
                    # a source makes a page upgradable — the stamped path
                    # on disk, or the copy every v3 page embeds
                    "needs_upgrade": needs_upgrade,
                    "upgradable": needs_upgrade and has_source,
                    "upgrade_reason": (
                        ""
                        if has_source
                        else "No authored source is available to rebuild this explainer."
                    ),
                    "upgrade_requires_style": bool(
                        needs_upgrade and has_source and info.style not in self.all_styles
                    ),
                }
            )
        StudioHandler.pages_cache = (cache_key, pages)
        self._send_json({"pages": pages})

    def _route_api_page_status(self, query: str) -> None:
        """Report whether the active assembled file was rebuilt externally."""
        raw_index = (parse_qs(query).get("index") or ["0"])[0]
        try:
            index = int(raw_index)
        except ValueError:
            self._send_json({"error": "index must be an integer"}, code=400)
            return
        if index < 0 or index >= len(self.context.variants):
            self._send_json({"error": "unknown variant"}, code=404)
            return
        path = self.context.variants[index].path
        try:
            stat = path.stat()
        except OSError as exc:
            self._send_json({"error": f"cannot read assembled file: {exc}"}, code=500)
            return
        # Resume and polling both transition the same persisted record.
        # Re-read it under the mutation lock so a stale poll can never
        # write `waiting` back over a user's explicit Resume action.
        with self.handoff_mutation_lock:
            handoff = _read_handoff(self.context)
            if handoff.get("status") == "waiting" and handoff.get("index") == index:
                self._observe_rebuild(handoff, index, path)
        self._send_json(
            {
                "built_ms": int(stat.st_mtime * 1000),
                "file": path.name,
                "handoff": self._handoff_public_state(self.context),
            }
        )

    def _observe_rebuild(self, handoff: dict[str, object], index: int, path: Path) -> None:
        """Record a changed file and accept it after one stable observation."""
        try:
            current = _fingerprint(path)
        except OSError:
            return
        if current == handoff.get("baseline"):
            return
        observed = handoff.get("observed")
        now = time.time_ns()
        if not isinstance(observed, dict) or observed.get("fingerprint") != current:
            handoff["observed"] = {"fingerprint": current, "at_ns": now}
            _write_handoff(self.context, handoff)
            return
        if now - int(observed.get("at_ns", 0)) < HANDOFF_SETTLE_NS:
            return
        try:
            rebuilt_html = path.read_text(encoding="utf-8", errors="replace")
            rebuilt = review.load_variant(
                path,
                self.context.variants[index].label,
                content=rebuilt_html,
            )
        except OSError:
            rebuilt_html = ""
            rebuilt = None
        if rebuilt is not None and rebuilt.version and "</html>" in rebuilt_html.lower():
            handoff["status"] = "ready"
            handoff["completed_at_ns"] = now
        else:
            handoff["validation_error"] = "assembled page is incomplete or unstamped"
        _write_handoff(self.context, handoff)

    def _resolve_variant_html(
        self, index: int, requested_style: str
    ) -> tuple[str, str, review.Variant] | None:
        """Read `index`'s HTML, re-assembled in `requested_style` when it differs.

        Parameters
        ----------
        index : int
            The variant's position in ``self.context.variants``.
        requested_style : str
            The ``?style=`` query value, or "" to serve the variant as-is.

        Returns
        -------
        tuple[str, str, Variant] or None
            ``(html, current_style, authored_variant)``, or None after already
            sending an error response (unknown style, build failure, or read
            failure). ``authored_variant`` is parsed from the current file so
            a long-running Studio server notices an external re-assembly on
            browser refresh.
        """
        variant = self.context.variants[index]
        if requested_style and not self._style_request_allowed(requested_style):
            return None
        try:
            snapshot = self._snapshot_for(self.context, variant)
            authored_html = (snapshot or variant.path).read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            self._send(500, f"cannot read {variant.path}: {exc}".encode(), "text/plain")
            return None
        # Studio is intentionally long-running while the author and reviewer
        # iterate. The assembled file can change underneath it, so the stamp
        # captured at server startup is only a routing identity, not current
        # version evidence.
        authored_variant = review.load_variant(variant.path, variant.label, content=authored_html)
        kit_version = (KIT_DIR / "VERSION").read_text(encoding="utf-8").strip()
        if requested_style and authored_variant.version and authored_variant.version != kit_version:
            self._send(
                409,
                b"upgrade this page before previewing another theme; theme previews use the current kit",
                "text/plain",
            )
            return None
        if (
            requested_style
            and requested_style != authored_variant.style
            and self.context.source_path is not None
        ):
            try:
                html = self.build_style(requested_style)
            except (OSError, RuntimeError) as exc:
                self._send(500, f"style flip failed: {exc}".encode(), "text/plain")
                return None
            return html, requested_style, authored_variant
        return authored_html, authored_variant.style or "", authored_variant

    def _style_request_allowed(self, requested_style: str) -> bool:
        """Reject style previews that conflict with a handoff or known styles."""
        if _read_handoff(self.context).get("status") == "waiting":
            self._send(423, b"review is waiting for the agent", "text/plain")
            return False
        if requested_style not in self.context.styles:
            self._send(404, f"unknown style '{requested_style}'".encode(), "text/plain")
            return False
        return True

    def _route_studio_variant(self, index: int, query: str, slug: str) -> None:
        """Serve a resolved semantic variant with the studio bundle appended.

        With ``?style=``, re-assembled in that style via :meth:`build_style`
        and served in place (the file on disk is never touched).
        """
        requested = (parse_qs(query).get("style") or [""])[0]
        resolved = self._resolve_variant_html(index, requested)
        if resolved is None:
            return
        html, current, variant = resolved
        # The authored variant is the canonical/base look. Theme previews
        # still use an explicit query, but asking for the base style by name
        # should not leave a redundant ``?style=keynote`` (or equivalent)
        # in bookmarks and navigation history.
        if requested and requested == variant.style:
            self.send_response(302)
            self.send_header("Location", f"/{slug}")
            self.end_headers()
            return

        kit_version = (KIT_DIR / "VERSION").read_text(encoding="utf-8").strip()
        source = self.context.source_path
        needs_upgrade = bool(variant.version and variant.version != kit_version)
        upgrade = bool(source is not None and needs_upgrade)
        upgrade_reason = (
            ""
            if source is not None
            else "No authored source is available to rebuild this explainer."
        )
        studio_boot: dict[str, object] = {
            "index": index,
            "slug": slug,
            "styles": list(self.context.styles) if source is not None else [],
            "current": current,
            "base": variant.style or "",
            "upgrade_requires_style": bool(upgrade and current not in self.context.styles),
            "source": source.as_posix() if source else "",
            # the upgrade card: an older stamp + a reachable source = one click
            "page_version": variant.version,
            "kit_version": kit_version,
            "needs_upgrade": needs_upgrade,
            "upgrade": upgrade,
            "upgrade_reason": upgrade_reason,
        }
        review_boot = self.variant_boot(index)
        studio_boot.update(
            {
                key: review_boot[key]
                for key in ("authoring", "authoring_url", "source_token", "page_token", "review")
            }
        )
        page = inject_studio(review.inject_overlay(html, review_boot), studio_boot)
        self._send_html(page)

    def do_POST(self) -> None:
        """Handle Studio mutations and delegate ordinary review persistence.

        ``/api/open`` switches the studio to a sibling page (body:
        ``{"file": "<name>.html"}``); ``/api/upgrade`` rebuilds one variant
        from its source with the current kit (body: ``{"index": <int>}``,
        default 0). Any other path is delegated to
        :meth:`review.ReviewHandler.do_POST`.
        """
        path, _, query = self.path.partition("?")
        review_name = (parse_qs(query).get("review") or [""])[0]
        if review_name and not self._bind_context(review_name):
            self._send_json({"error": "unknown review"}, code=404)
            return
        if path == "/api/state":
            self._save_state(query)
            return
        if path not in ("/api/upgrade", "/api/open", "/api/handoff", "/api/authoring"):
            super().do_POST()  # review.py's do_POST carries the origin guard
            return
        if not self._check_request_origin():
            self._send_json({"error": "forbidden origin"}, code=403)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > review.MAX_BODY_BYTES:
            self._send_json({"error": "request body is too large"}, code=413)
            return
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body: object = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = None
        handler = {
            "/api/handoff": self._handoff,
            "/api/authoring": self._save_authoring,
            "/api/open": self._open_studio_page,
        }.get(path, self._upgrade)
        handler(body)

    def _open_studio_page(self, body: object) -> None:
        """Open one sibling explainer requested by the Gallery."""
        name = body.get("file") if isinstance(body, dict) else None
        try:
            self.open_page(name if isinstance(name, str) else "")
        except (OSError, RuntimeError) as exc:
            self._send_json({"error": str(exc)}, code=400)
            return
        self._send_json({"ok": True, "slug": self._variant_slug(0)})

    def _page_token_matches(self, query: str) -> bool:
        """Reject writes from a DOM served before the latest assembled page."""
        params = parse_qs(query)
        raw_index = (params.get("index") or [""])[0]
        token = (params.get("page_token") or [""])[0]
        try:
            index = int(raw_index)
            path = self.context.variants[index].path
            return bool(token) and token == _fingerprint_token(path)
        except (IndexError, OSError, ValueError):
            return False

    def _body_page_token_matches(self, body: dict[str, object], index: int) -> bool:
        token = body.get("page_token")
        try:
            return isinstance(token, str) and token == _fingerprint_token(
                self.context.variants[index].path
            )
        except (IndexError, OSError):
            return False

    def _consume_deterministic_drafts(
        self, context: review.PageContext, label: str, consumed: object
    ) -> None:
        """Remove just the current variant's persisted, projected draft records."""
        if not isinstance(consumed, dict):
            return
        text_targets = _bounded_string_list(
            consumed.get("text_targets"),
            MAX_CONSUMED_TEXT_TARGETS,
            MAX_CONSUMED_TEXT_TARGET_CHARS,
        )
        swap_keys = _bounded_string_list(
            consumed.get("swap_keys"), MAX_CONSUMED_SWAP_KEYS, MAX_CONSUMED_SWAP_KEY_CHARS
        )
        if text_targets is None or swap_keys is None:
            return
        canvas_hosts = _canvas_hosts(consumed.get("canvas_hosts"))
        if canvas_hosts is None:
            return
        text_target_set = set(text_targets)
        swap_key_set = set(swap_keys)
        canvas_host_set = set(canvas_hosts)
        state = dict(context.state)
        state["edits"] = [
            item
            for item in state.get("edits", [])
            if not isinstance(item, dict)
            or item.get("variant") != label
            or item.get("selector") not in text_target_set
        ]
        self._drop_consumed_records(state, label, swap_key_set, canvas_host_set)
        if consumed.get("tokens") is True:
            tokens = state.get("tokens")
            if isinstance(tokens, dict):
                updated_tokens = dict(tokens)
                updated_tokens.pop(label, None)
                state["tokens"] = updated_tokens
        labels = [variant.label for variant in context.variants]
        cleaned = review.sanitize_state(state, context.state, labels)
        updated_context = review.replace(context, state=cleaned)
        self._store_context(updated_context)
        review.persist_state(
            cleaned,
            updated_context.variants,
            updated_context.json_path,
            updated_context.md_path,
        )

    def _drop_consumed_records(
        self,
        state: dict[str, object],
        label: str,
        swap_key_set: set[str],
        canvas_host_set: set[str],
    ) -> None:
        """Remove consumed swap and canvas records for one label, in place."""
        for key, consumed_set in (("swaps", swap_key_set), ("canvas_edits", canvas_host_set)):
            mapping = state.get(key)
            if isinstance(mapping, dict) and consumed_set:
                updated = _drop_labeled_keys(mapping, label, consumed_set)
                if updated is not None:
                    state[key] = updated

    def _save_authoring(self, body: object) -> None:
        """Embed deterministic edits in source and rebuild the served variant."""
        if not isinstance(body, dict):
            self._send_json({"error": "authoring payload must be an object"}, code=400)
            return
        try:
            manifest = sanitize_authoring_manifest(body.get("manifest"))
        except ManifestError as exc:
            self._send_json({"error": str(exc)}, code=400)
            return
        index = body.get("index", 0)
        if not isinstance(index, int) or not 0 <= index < len(self.context.variants):
            self._send_json({"error": "unknown variant"}, code=400)
            return
        source = self.context.source_path
        if source is None:
            self._send_json({"error": "No authored source is available to save changes."}, code=409)
            return
        stale = self._authoring_staleness(body, index)
        if stale is not None:
            self._send_json({"error": stale}, code=409)
            return
        context_name = self._context_name(self.context)
        refusal = self._authoring_refusal(context_name)
        if refusal is not None:
            message, code = refusal
            self._send_json({"error": message}, code=code)
            return
        self._rebuild_authoring(body, index, source, manifest, context_name)

    def _authoring_staleness(self, body: dict[str, object], index: int) -> str | None:
        """Return the 409 message for a stale save request, else None."""
        source_token = body.get("source_token")
        if not isinstance(source_token, str) or not source_token:
            return "missing source token — reload before saving"
        if not self._body_page_token_matches(body, index):
            return "this page changed — reload before saving"
        return None

    def _authoring_refusal(self, context_name: str) -> tuple[str, int] | None:
        """Reserve this explainer for an authoring save, or say why not."""
        with self.handoff_mutation_lock:
            if _read_handoff(self.context).get("status") in ("waiting", "ready"):
                return ("review is locked for agent handoff", 423)
            if context_name in type(self).upgrading:
                return ("an update is already running for this explainer", 409)
            type(self).upgrading.add(context_name)
            return None

    def _rebuild_authoring(
        self,
        body: dict[str, object],
        index: int,
        source: Path,
        manifest: dict[str, object],
        context_name: str,
    ) -> None:
        """Rebuild one variant with the manifest embedded, then answer the request.

        Owns the ``upgrading`` slot: it is released in ``finally`` and exactly
        one JSON response is always sent.
        """
        try:
            with self.build_lock:
                context = self.context
                variant = context.variants[index]
                try:
                    source_before, source_after, output_before = self._authoring_targets(
                        body, index, source, variant, manifest
                    )
                except (OSError, RuntimeError, UnicodeDecodeError, ManifestError) as exc:
                    self._send_json({"error": str(exc)}, code=409)
                    return
                temporary_output = variant.path.with_suffix(variant.path.suffix + ".authoring.tmp")
                try:
                    _atomic_write_text(source, source_after)
                    self._assemble_variant(source, variant, temporary_output)
                except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                    self._restore_authoring_targets(
                        source, source_before, variant, output_before, temporary_output
                    )
                    message = (
                        f"assemble.py did not finish within {ASSEMBLE_TIMEOUT_SECONDS}s"
                        if isinstance(exc, subprocess.TimeoutExpired)
                        else str(exc)
                    )
                    self._send_json({"error": message}, code=500)
                    return
                new_variants = list(context.variants)
                try:
                    new_variants[index] = review.load_variant(variant.path, variant.label)
                except OSError as exc:
                    self._send_json({"error": str(exc)}, code=500)
                    return
                updated_context = review.replace(context, variants=new_variants)
                with self.state_lock:
                    self._store_context(updated_context)
                    self._consume_deterministic_drafts(
                        updated_context, variant.label, body.get("consumed_review")
                    )
                type(self).pages_cache = None
                try:
                    response = {
                        "ok": True,
                        "page_token": _fingerprint_token(new_variants[index].path),
                        "source_token": _fingerprint_token(source),
                        "authoring": manifest,
                        "boot": self.variant_boot(index),
                    }
                except OSError as exc:
                    self._send_json({"error": str(exc)}, code=500)
                    return
        finally:
            with self.handoff_mutation_lock:
                type(self).upgrading.discard(context_name)
        self._send_json(response)

    def _authoring_targets(
        self,
        body: dict[str, object],
        index: int,
        source: Path,
        variant: review.Variant,
        manifest: dict[str, object],
    ) -> tuple[str, str, bytes]:
        """Read the save targets under the build lock; RuntimeError on any drift."""
        if not self._body_page_token_matches(body, index):
            msg = "this page changed — reload before saving"
            raise RuntimeError(msg)
        source_token = body.get("source_token")
        if not isinstance(source_token, str) or source_token != _fingerprint_token(source):
            msg = "the source changed — reload before saving"
            raise RuntimeError(msg)
        source_before = source.read_text(encoding="utf-8")
        source_after = upsert_authoring_manifest(source_before, manifest)
        output_before = variant.path.read_bytes()
        return source_before, source_after, output_before

    def _assemble_variant(
        self, source: Path, variant: review.Variant, temporary_output: Path
    ) -> None:
        """Rebuild one variant from source; RuntimeError when assemble fails."""
        result = subprocess.run(
            [
                sys.executable,
                str(KIT_DIR / "assemble.py"),
                str(source),
                "--style",
                variant.style,
                "--out",
                str(temporary_output),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=ASSEMBLE_TIMEOUT_SECONDS,
        )
        if result.returncode:
            message = (result.stderr or result.stdout).strip() or "assemble.py failed"
            raise RuntimeError(message)
        temporary_output.replace(variant.path)

    def _restore_authoring_targets(
        self,
        source: Path,
        source_before: str,
        variant: review.Variant,
        output_before: bytes,
        temporary_output: Path,
    ) -> None:
        """Undo a half-finished authoring rebuild; best effort by design."""
        try:
            _atomic_write_text(source, source_before)
            variant.path.write_bytes(output_before)
            temporary_output.unlink(missing_ok=True)
        except OSError:
            pass

    def _save_state(self, query: str) -> None:
        """Persist review state without allowing a handoff lock-check race."""
        if not self._check_request_origin():
            self._send_json({"error": "forbidden origin"}, code=403)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > review.MAX_BODY_BYTES:
            self._send_json({"error": "body too large or empty"}, code=413)
            return
        raw = self.rfile.read(length)
        try:
            parsed: object = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json({"error": "invalid JSON"}, code=400)
            return
        if isinstance(parsed, dict):
            posted_name = parsed.get("review")
            if (
                isinstance(posted_name, str)
                and posted_name
                and posted_name != self.context.state.get("review")
            ):
                self._send_json({"error": "this tab shows another page — refresh it"}, code=409)
                return
        if isinstance(parsed, dict) and review.invalid_canvas_records(parsed.get("canvas_edits")):
            self._send_json({"error": "invalid canvas edits; review not changed"}, code=400)
            return

        response: dict[str, object]
        response_code = 200
        summary = ""
        with self.handoff_mutation_lock, self.state_lock:
            handoff = _read_handoff(self.context)
            if handoff.get("status") in (
                "waiting",
                "ready",
            ):
                response = {
                    "error": "review is locked for agent handoff",
                    "handoff": self._handoff_public_state(self.context),
                }
                response_code = 423
            elif not self._page_token_matches(query):
                response = {"error": "this page changed — reload before editing"}
                response_code = 409
            else:
                labels = [variant.label for variant in self.context.variants]
                merged = review.sanitize_state(parsed, self.context.state, labels)
                updated_context = review.replace(self.context, state=merged)
                self._store_context(updated_context)
                review.persist_state(
                    merged,
                    updated_context.variants,
                    updated_context.json_path,
                    updated_context.md_path,
                )
                summary = review.state_summary(merged)
                response = {"ok": True, "updated": merged["updated"]}
        if summary:
            print(summary, flush=True)
        self._send_json(response, code=response_code)

    @classmethod
    def _record_agent_update(
        cls,
        context: review.PageContext,
        request_id: str,
        update: agent_adapters.AgentUpdate,
    ) -> None:
        """Persist one adapter update if it still belongs to the active handoff."""
        with cls.handoff_mutation_lock:
            value = _read_handoff(context)
            if value.get("request_id") != request_id or value.get("status") != "waiting":
                return
            phase = update.phase
            detail = update.detail
            if phase == "validating":
                index = value.get("index")
                try:
                    unchanged = isinstance(index, int) and _fingerprint(
                        context.variants[index].path
                    ) == value.get("baseline")
                except (IndexError, OSError):
                    unchanged = True
                if unchanged:
                    phase = "failed"
                    agent = value.get("agent")
                    label = agent.title() if isinstance(agent, str) and agent else "Agent"
                    detail = f"{label} finished without rebuilding the assembled explainer"
            value["agent_phase"] = phase
            value["agent_detail"] = detail
            if update.session_id:
                value["agent_session_id"] = update.session_id
            value["agent_updated_at_ns"] = time.time_ns()
            _write_handoff(context, value)

    @staticmethod
    def _agent_prompt(
        context: review.PageContext,
        variant: review.Variant,
        request_id: str,
    ) -> str:
        """Build the bounded, server-derived instruction for a child agent turn."""
        source = context.source_path
        if source is None:
            message = "this explainer has no authored source for the agent to edit"
            raise RuntimeError(message)
        style = f" using style {variant.style!r}" if variant.style else ""
        return (
            "Apply one local Explainer Studio review. Do not ask the user questions, commit, "
            "push, or modify unrelated files.\n\n"
            f"Request ID: {request_id}\n"
            f"Explainer skill: {(KIT_DIR / 'SKILL.md').resolve()}\n"
            f"Saved review: {context.md_path.resolve()}\n"
            f"Authored source to edit: {source.resolve()}\n"
            f"Assembled page to rebuild in place: {variant.path.resolve()}\n\n"
            "Read the skill's `Applying a review` instructions and the saved review. Apply the "
            "requested content and visual changes to the authored source, then run the skill's "
            f"assembler to rebuild the assembled page{style}. Verify the rebuilt page is complete "
            "and stamped before finishing."
        )

    def _handoff(self, body: object) -> None:
        """Atomically persist feedback, lock the review, and queue its agent turn."""
        if not isinstance(body, dict):
            self._send_json({"error": "invalid handoff"}, code=400)
            return
        action = body.get("action", "send")
        if action == "resume":
            self._resume_handoff()
            return
        if action == "acknowledge":
            self._acknowledge_handoff(body)
            return
        if action == "send":
            self._send_handoff(body)
            return
        self._send_json({"error": "unknown handoff action"}, code=400)

    def _resume_handoff(self) -> None:
        """Cancel a waiting turn before releasing its edit lock."""
        with self.handoff_mutation_lock:
            pending = _read_handoff(self.context)
            pending_request_id = pending.get("request_id")
        if (
            pending.get("status") == "waiting"
            and isinstance(pending_request_id, str)
            and self.agent_adapter is not None
            and not self.agent_adapter.cancel(pending_request_id)
        ):
            self._send_json({"error": "could not stop the agent safely"}, code=409)
            return
        resumed = False
        with self.handoff_mutation_lock, self.state_lock:
            value = _read_handoff(self.context)
            index = value.get("index")
            try:
                unchanged = isinstance(index, int) and _fingerprint(
                    self.context.variants[index].path
                ) == value.get("baseline")
            except (IndexError, OSError):
                unchanged = False
            if value.get("status") == "waiting" and unchanged:
                value["status"] = "editing"
                value["resumed_at_ns"] = time.time_ns()
                _write_handoff(self.context, value)
                resumed = True
            elif value.get("status") == "editing":
                resumed = True
        if not resumed:
            self._send_json(
                {"error": "the rebuild has started; wait for the validated result"},
                code=409,
            )
            return
        self._send_json({"ok": True, "handoff": self._handoff_public_state(self.context)})

    def _acknowledge_handoff(self, body: dict[str, object]) -> None:
        """Unlock a completed handoff only from the rebuilt page."""
        with self.handoff_mutation_lock, self.state_lock:
            value = _read_handoff(self.context)
            public = self._handoff_public_state(self.context)
            page_token = body.get("page_token")
            value_index = value.get("index")
            try:
                current_token = (
                    _fingerprint_token(self.context.variants[value_index].path)
                    if isinstance(value_index, int)
                    else ""
                )
            except (IndexError, OSError):
                current_token = ""
            valid = (
                value.get("status") == "ready"
                and isinstance(page_token, str)
                and page_token == public.get("completion_token")
                and page_token == current_token
            )
            if valid:
                value["status"] = "editing"
                value["acknowledged_at_ns"] = time.time_ns()
                _write_handoff(self.context, value)
        if not valid:
            self._send_json({"error": "reload the completed explainer first"}, code=409)
            return
        self._send_json({"ok": True, "handoff": self._handoff_public_state(self.context)})

    def _send_handoff(self, body: dict[str, object]) -> None:
        """Validate and persist one new handoff before queueing it."""
        validated = self._validate_handoff_request(body)
        if validated is None:
            return
        adapter, raw_state, index = validated
        job: agent_adapters.AgentJob | None = None
        job_context: review.PageContext | None = None
        response: dict[str, object]
        response_code = 200
        with self.handoff_mutation_lock, self.state_lock:
            current = _read_handoff(self.context)
            if self._context_name(self.context) in type(self).upgrading:
                response = {"error": "an update is running — retry when it finishes"}
                response_code = 423
            elif current.get("status") in ("waiting", "ready"):
                response = {"ok": True, "handoff": self._handoff_public_state(self.context)}
            elif not self._body_page_token_matches(body, index):
                response = {"error": "this page changed — reload before sending"}
                response_code = 409
            elif raw_state.get("review") != self.context.state.get("review"):
                response = {"error": "this tab shows another page — refresh it"}
                response_code = 409
            else:
                try:
                    job_context, job = self._prepare_agent_job(raw_state, index, adapter)
                except OSError as exc:
                    response = {"error": f"could not prepare handoff: {exc}"}
                    response_code = 500
                else:
                    response = {
                        "ok": True,
                        "handoff": self._handoff_public_state(job_context),
                    }
        if job is not None and job_context is not None:
            self._queue_agent_job(adapter, job_context, job)
        self._send_json(response, code=response_code)

    def _validate_handoff_request(
        self,
        body: dict[str, object],
    ) -> tuple[agent_adapters.HarnessAdapter, dict[str, object], int] | None:
        """Return typed handoff inputs or send the corresponding client error."""
        adapter = self.agent_adapter
        if adapter is None:
            self._send_json({"error": "Studio was launched without an agent adapter"}, code=409)
            return None
        if self.context.source_path is None:
            self._send_json({"error": "this explainer has no authored source to edit"}, code=409)
            return None
        raw_state = body.get("state")
        if not isinstance(raw_state, dict):
            self._send_json({"error": "review state is required"}, code=400)
            return None
        index_value = body.get("index", 0)
        index = index_value if isinstance(index_value, int) else 0
        if index < 0 or index >= len(self.context.variants):
            self._send_json({"error": "unknown variant"}, code=404)
            return None
        if review.invalid_canvas_records(raw_state.get("canvas_edits")):
            self._send_json({"error": "invalid canvas edits"}, code=400)
            return None
        return adapter, raw_state, index

    def _prepare_agent_job(
        self,
        raw_state: dict[str, object],
        index: int,
        adapter: agent_adapters.HarnessAdapter,
    ) -> tuple[review.PageContext, agent_adapters.AgentJob]:
        """Save a recoverable snapshot and build its queued agent job."""
        labels = [variant.label for variant in self.context.variants]
        merged = review.sanitize_state(raw_state, self.context.state, labels)
        updated_context = review.replace(self.context, state=merged)
        updated_context.preview_dir.mkdir(parents=True, exist_ok=True)
        snapshots: list[dict[str, str]] = []
        for variant_index, variant in enumerate(updated_context.variants):
            snapshot_name = f"handoff-{variant_index}.html"
            shutil.copy2(variant.path, updated_context.preview_dir / snapshot_name)
            snapshots.append(
                {
                    "assembled": variant.path.resolve().as_posix(),
                    "snapshot": snapshot_name,
                }
            )
        review.persist_state(
            merged,
            updated_context.variants,
            updated_context.json_path,
            updated_context.md_path,
        )
        variant = updated_context.variants[index]
        request_id = uuid.uuid4().hex
        handoff: dict[str, object] = {
            "format": HANDOFF_FORMAT,
            "version": HANDOFF_VERSION,
            "status": "waiting",
            "request_id": request_id,
            "agent": adapter.name,
            "agent_phase": "queued",
            "agent_detail": f"Queued for {adapter.name.title()}",
            "review": self._context_name(updated_context),
            "index": index,
            "baseline": _fingerprint(variant.path),
            "created_at_ns": time.time_ns(),
            "snapshots": snapshots,
        }
        _write_handoff(updated_context, handoff)
        self._store_context(updated_context)
        job = agent_adapters.AgentJob(
            request_id=request_id,
            prompt=self._agent_prompt(updated_context, variant, request_id),
            cwd=Path.cwd(),
        )
        return updated_context, job

    def _queue_agent_job(
        self,
        adapter: agent_adapters.HarnessAdapter,
        context: review.PageContext,
        job: agent_adapters.AgentJob,
    ) -> None:
        """Queue a prepared job and surface immediate adapter failures."""
        callback = partial(self._record_agent_update, context, job.request_id)
        try:
            adapter.submit(job, callback)
        except RuntimeError as exc:
            self._record_agent_update(
                context,
                job.request_id,
                agent_adapters.AgentUpdate("failed", str(exc)),
            )

    def _upgrade(self, body: object) -> None:
        # Gallery upgrades identify the card explicitly. Opening it in the
        # server context first gives upgrade_variant the card's own authored
        # source (or recovered embed), without navigating the browser.
        name = body.get("file") if isinstance(body, dict) else None
        if isinstance(name, str):
            try:
                self.open_page(name)
            except (OSError, RuntimeError) as exc:
                self._send_json({"error": str(exc)}, code=400)
                return
        context_name = self._context_name(self.context)
        with self.handoff_mutation_lock:
            # The handoff gate belongs after the page binds: a gallery upgrade
            # arrives unbound, so checking before open_page would read the
            # previously served page's handoff, not the card's.
            if _read_handoff(self.context).get("status") in ("waiting", "ready"):
                self._send_json({"error": "review is waiting for the agent"}, code=423)
                return
            if context_name in type(self).upgrading:
                self._send_json(
                    {"error": "an update is already running for this explainer"}, code=409
                )
                return
            type(self).upgrading.add(context_name)
        # The flag, not the lock, excludes a concurrent send — a rebuild can
        # hold the build lock for tens of seconds and polling/saves must not
        # queue behind it.
        try:
            index_value = body.get("index") if isinstance(body, dict) else 0
            index = (
                index_value
                if isinstance(index_value, int) and 0 <= index_value < len(self.context.variants)
                else 0
            )
            if self.context.source_path is None:
                self._send_json(
                    {"error": "No authored source is available to rebuild this explainer."},
                    code=409,
                )
                return
            style = self._resolve_upgrade_style(body, index)
            if style is None:
                return
            legacy_copy = (
                body.get("legacy_copy_compat") is True if isinstance(body, dict) else False
            )
            try:
                self.upgrade_variant(index, style, legacy_copy=legacy_copy)
            except (OSError, RuntimeError) as exc:
                message = str(exc)
                copy_limit_recovery = bool(
                    not legacy_copy
                    and message
                    and all("component.copy_limit" in line for line in message.splitlines())
                )
                self._send_json(
                    {"error": message, "copy_limit_recovery": copy_limit_recovery}, code=500
                )
            else:
                self._send_json({"ok": True})
        finally:
            with self.handoff_mutation_lock:
                type(self).upgrading.discard(context_name)

    def open_page(self, name: str) -> review.PageContext:
        """Load and bind a sibling explainer's page-scoped review context.

        The panel's folder browser calls this; each page keeps a separate
        ``_reviews/<stem>/`` so feedback never mixes between pages. Stale tabs
        from the previous page are rejected by the review-name guard on save.

        Parameters
        ----------
        name : str
            An ``.html`` filename directly inside `self.pages_dir` (no
            subdirectories, no traversal — enforced below).

        Returns
        -------
        PageContext
            The registered context bound to this request. Other open tabs keep
            their own registered contexts.

        Raises
        ------
        RuntimeError
            When `name` is empty, not a plain ``.html`` file directly inside
            `self.pages_dir`, or does not exist.
        """
        directory = self.pages_dir
        target = directory / name
        if (
            not name
            or target.suffix != ".html"
            or target.resolve().parent != directory.resolve()
            or not target.is_file()
        ):
            msg = f"unknown page '{name}'"
            raise RuntimeError(msg)
        with self.build_lock:
            resolved_target = target.resolve()
            with self.state_lock:
                for context in type(self).contexts.values():
                    if any(
                        variant.path.resolve() == resolved_target for variant in context.variants
                    ):
                        self.context = context
                        return context
            variant = review.load_variant(target, "A")
            stem = target.stem
            review_dir = directory / "_reviews" / stem
            json_path = review_dir / "review.json"
            md_path = review_dir / "review.md"
            state = review.load_state(stem, [variant], json_path)
            review.persist_state(state, [variant], json_path, md_path)
            source = _resolve_source([variant], target, review_dir)
            # Build the complete page context under build_lock, then register
            # it under state_lock so concurrent tabs never see a partial or
            # unrelated page snapshot.
            ctx = review.PageContext(
                variants=[variant],
                state=state,
                json_path=json_path,
                md_path=md_path,
                preview_dir=review_dir,
                source_path=source,
                styles=tuple(self.all_styles) if source is not None else (),
            )
            with self.state_lock:
                self._store_context(ctx)
            type(self).pages_cache = None
            return ctx

    def _resolve_upgrade_style(self, body: object, index: int) -> str | None:
        style_value = body.get("style") if isinstance(body, dict) else None
        if style_value is not None and not isinstance(style_value, str):
            self._send_json({"error": "upgrade style must be a string"}, code=400)
            return None
        variant = self.context.variants[index]
        style = style_value or variant.style
        if style in self.context.styles:
            return style
        self._send_json(
            {
                "error": f"Style '{style or 'unknown'}' is no longer available. Choose a supported style to continue.",
                "available_styles": list(self.context.styles),
            },
            code=409,
        )
        return None

    def upgrade_variant(self, index: int, style: str, *, legacy_copy: bool = False) -> None:
        """Rebuild one page from its source with the current kit, in place.

        The only write this server ever makes to a served file, and only on
        the reviewer's explicit click. The previous bytes are kept in the
        git-ignored ``_reviews/`` directory first, and restored if the
        rebuild fails, so a broken assemble.py run never corrupts the
        served page.

        Parameters
        ----------
        index : int
            The variant's position in ``self.context.variants``.
        style : str
            A current-kit style selected by the reviewer.
        legacy_copy : bool, optional
            Preserve copy that predates current component limits.

        Returns
        -------
        None
            This page's registered context is replaced with one whose variant
            at `index` is reloaded from the rebuilt file, so the panel stops
            offering the upgrade.

        Raises
        ------
        RuntimeError
            When no content source is available, ``assemble.py`` exits
            non-zero, or the build times out (the pre-upgrade file is
            restored first in each case).
        """
        # Snapshot the request-bound context inside build_lock so this rebuild
        # and a simultaneous first-time page open cannot interleave writes.
        with self.build_lock:
            ctx = self.context
            if not 0 <= index < len(ctx.variants):
                msg = f"unknown variant {index}"
                raise RuntimeError(msg)
            variant = ctx.variants[index]
            source = ctx.source_path
            if source is None:
                msg = "no content source available — re-assemble manually"
                raise RuntimeError(msg)
            ctx.preview_dir.mkdir(parents=True, exist_ok=True)
            backup = ctx.preview_dir / f"pre-upgrade-v{variant.version or 'unknown'}.html"
            shutil.copy2(variant.path, backup)
            cmd = [
                sys.executable,
                str(KIT_DIR / "assemble.py"),
                str(source),
                "--style",
                style,
                "--out",
                str(variant.path),
            ]
            if legacy_copy:
                cmd.append("--legacy-copy-compat")
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, check=False, timeout=30
                )
            except subprocess.TimeoutExpired:
                shutil.copy2(backup, variant.path)  # roll back on a timed-out build
                msg = "assemble.py did not finish within 30s"
                raise RuntimeError(msg) from None
            if result.returncode != 0:
                shutil.copy2(backup, variant.path)  # roll back on a failed build
                raise RuntimeError((result.stderr or result.stdout).strip())
            # refresh stamp metadata so the panel stops offering the upgrade:
            # swap the whole context atomically with the reloaded variant
            new_variants = list(ctx.variants)
            new_variants[index] = review.load_variant(variant.path, variant.label)
            with self.state_lock:
                self._store_context(review.replace(ctx, variants=new_variants))
            type(self).pages_cache = None

    def _route_gallery(self) -> None:
        """``/gallery`` serves the preview-first explainer gallery page.

        The CSS/JS are read from disk on every call (same pattern as the
        studio panel) so a human can edit ``studio/gallery.css`` /
        ``studio/gallery.js`` and just refresh.
        """
        css = (STUDIO_DIR / "gallery.css").read_text(encoding="utf-8")
        js = (STUDIO_DIR / "gallery.js").read_text(encoding="utf-8")
        # the gallery links to the component showcase so the roster is
        # discoverable from the library, not only from a Swap button
        boot = json.dumps(
            {
                "showcase": "/showcase" if review.SHOWCASE.is_file() else "",
                "review": self._context_name(self.context),
            }
        )
        html = (
            '<!DOCTYPE html><html data-theme="dark"><head>'
            '<meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            "<title>Explainers — studio</title>"
            f"<style>{css}</style>"
            "</head><body>"
            '<div id="gl-root"></div>'
            f"<script>window.__galleryBoot={boot};</script>"
            f"<script>{js}</script>"
            "</body></html>"
        )
        self._send_html(html)

    def _send_preview_unavailable(self, code: int, message: str, channel: str) -> None:
        """Send an iframe-safe error document with an opaque-origin status message."""
        escaped = html.escape(message)
        payload = json.dumps(
            {
                "source": "explainer-gallery-preview",
                "channel": channel,
                "unavailable": True,
            },
            separators=(",", ":"),
        ).replace("</", "<\\/")
        body = (
            '<!doctype html><html><head><meta charset="utf-8">'
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
            f'<meta name="explainer-preview-unavailable" content="{code}">'
            "</head>"
            f'<body data-preview-unavailable="{code}">{escaped}'
            f'<script>window.parent.postMessage({payload}, "*");</script>'
            "</body></html>"
        )
        self._send(code, body.encode("utf-8"), "text/html; charset=utf-8")

    def _route_preview(self, query: str) -> None:
        """``/preview?file=<name>`` serves a raw assembled page for gallery iframes.

        Serves the file without any overlay injection so the iframe renders
        the page as the visitor would see it. Only files directly inside
        ``pages_dir`` are reachable — no path traversal.
        """
        params = parse_qs(query)
        name = (params.get("file") or [""])[0]
        raw_channel = (params.get("channel") or [""])[0]
        channel = raw_channel if PREVIEW_CHANNEL_RE.fullmatch(raw_channel) else ""
        target = self.pages_dir / name
        if (
            not name
            or target.suffix != ".html"
            or not target.is_file()
            or target.resolve().parent != self.pages_dir.resolve()
        ):
            self._send_preview_unavailable(404, "Preview unavailable", channel)
            return
        try:
            html = target.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            self._send_preview_unavailable(500, f"Preview unavailable: {exc}", channel)
            return
        self._send_html(html)

    def build_style(self, style: str) -> str:
        """Re-assemble the source in `style`, cached until source or kit changes.

        Parameters
        ----------
        style : str
            One of ``self.context.styles`` — a style name under ``styles/*.css``.

        Returns
        -------
        str
            The re-assembled page's full HTML.

        Raises
        ------
        RuntimeError
            When no content source is available, ``assemble.py`` exits
            non-zero, or the build times out.
        """
        ctx = self.context
        source = ctx.source_path
        if source is None:
            msg = "no content source available"
            raise RuntimeError(msg)
        cache = ctx.preview_dir / f"preview-{style}.html"
        assembly_inputs = [
            source,
            KIT_DIR / "VERSION",
            KIT_DIR / "assemble.py",
            *KIT_DIR.glob("template*.html"),
        ]
        for asset_dir in (
            KIT_DIR / "base",
            KIT_DIR / "styles",
            KIT_DIR / "components",
            KIT_DIR / "vendor",
        ):
            assembly_inputs.extend(asset for asset in asset_dir.rglob("*") if asset.is_file())
        newest_input = max(asset.stat().st_mtime for asset in assembly_inputs)
        with self.build_lock:
            if not cache.is_file() or cache.stat().st_mtime < newest_input:
                ctx.preview_dir.mkdir(parents=True, exist_ok=True)
                try:
                    result = subprocess.run(
                        [
                            sys.executable,
                            str(KIT_DIR / "assemble.py"),
                            str(source),
                            "--style",
                            style,
                            "--out",
                            str(cache),
                        ],
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=30,
                    )
                except subprocess.TimeoutExpired as exc:
                    msg = "assemble.py did not finish within 30s"
                    raise RuntimeError(msg) from exc
                if result.returncode != 0:
                    raise RuntimeError((result.stderr or result.stdout).strip())
        return cache.read_text(encoding="utf-8", errors="replace")


def _parse_args() -> argparse.Namespace:
    """Parse studio.py's CLI arguments."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "files",
        nargs="*",
        metavar="HTML|DIR",
        help="assembled explainer .html files (2-3 for an A/B/C flip), or a"
        " directory — opens the gallery for that folder. Omit entirely to"
        " open the gallery for explainers/ in the current directory; errors"
        " when that conventional folder does not exist.",
    )
    ap.add_argument(
        "--port",
        type=int,
        default=review.DEFAULT_PORT,
        help=f"localhost port (default {review.DEFAULT_PORT}; falls back to a free port when busy)",
    )
    ap.add_argument("--no-open", action="store_true", help="do not open the browser automatically")
    ap.add_argument(
        "--agent",
        choices=("auto", "none", "droid", "devin"),
        default="auto",
        help="Studio-owned agent session adapter (default: auto — detect the"
        " harness in the process ancestry, else none)",
    )
    return ap.parse_args()


def _detect_agent() -> str:
    """Walk the process ancestry for a harness CLI on PATH (devin/droid).

    The launching agent — not the installed binaries — decides the adapter:
    studio.py started inside a Devin or Droid session finds that CLI in its
    parent chain; started anywhere else it gets ``none``.
    """
    ps = shutil.which("ps")
    if ps is None:
        return "none"
    pid = os.getppid()
    for _ in range(8):
        if pid <= 1:
            break
        probe = subprocess.run(
            [ps, "-o", "ppid=,comm=", "-p", str(pid)],
            capture_output=True,
            text=True,
            check=False,
        )
        try:
            parent, command = probe.stdout.strip().split(None, 1)
            pid = int(parent)
        except ValueError:
            break
        name = Path(command.strip()).name
        if name in ("devin", "droid") and shutil.which(name):
            return name
    return "none"


def _make_adapter(choice: str) -> agent_adapters.HarnessAdapter | None:
    """Resolve the --agent choice (``auto`` walks the ancestry) and build it."""
    agent = choice if choice != "auto" else _detect_agent()
    adapter: agent_adapters.HarnessAdapter | None = None
    try:
        adapter = agent_adapters.create_adapter(agent)
    except RuntimeError as exc:
        review.die(str(exc))
    if adapter is not None:
        print(f"agent adapter: {agent}", flush=True)
    return adapter


def _resolve_files(names: list[str]) -> tuple[list[Path], Path]:
    """Resolve CLI file arguments into (specific_files, pages_dir).

    An empty ``specific_files`` list signals gallery mode — the caller opens
    ``/gallery`` instead of a page route. Three cases:

    - **No args**: gallery mode for ``explainers/``; fail when that
      conventional folder does not exist rather than scanning elsewhere.
    - **Single directory**: gallery mode for that directory.
    - **One or more .html files**: studio mode for those specific files
      (2-3 for an A/B/C comparison); ``pages_dir`` is their parent.
    """
    if not names:
        default = Path("explainers")
        if not default.is_dir():
            review.die(
                "no explainers/ directory found — pass an explicit explainer HTML file "
                "or directory; Studio will not scan sketches/ or the current directory"
            )
        return [], default
    if len(names) == 1 and Path(names[0]).is_dir():
        return [], Path(names[0])
    files: list[Path] = []
    for name in names:
        path = Path(name)
        if path.is_dir():
            review.die("cannot mix a directory with file arguments — pass one or the other")
        files.append(path)
    if len(files) > len(review.VARIANT_LABELS):
        review.die(f"too many variants — {len(review.VARIANT_LABELS)} max")
    return files, files[0].parent


def _stamped_source(variants: list[review.Variant], first: Path) -> Path | None:
    """Return the stamped source path when a file sits behind it.

    A relative stamp is authored from the page's tree, not from the studio's
    incidental working directory, so an unresolved relative path retries
    against the pages directory and its parent before recovery is considered.
    """
    if not variants[0].source:
        return None
    candidate = Path(variants[0].source)
    if candidate.is_file():
        return candidate
    for base in (first.parent, first.parent.parent):
        resolved = base / candidate
        if resolved.is_file():
            return resolved
    return None


def _is_recovered_artifact(path: Path) -> bool:
    """Return whether a source path is a studio recovery copy in ``_reviews``."""
    return path.name.startswith("recovered-source-") and "_reviews" in path.parts


def _identical_source(reference: bytes, pages_dir: Path) -> Path | None:
    """Find the authored source file matching ``reference`` byte-for-byte.

    Recovery copies live in the throwaway ``_reviews`` tree. When the real
    source still exists next to the page, editing that file keeps the page
    and its source together instead of forking them.
    """
    candidates = [*(pages_dir / "_sources").glob("*.html"), *pages_dir.glob("*.html")]
    for candidate in sorted(candidates):
        if _same_bytes(candidate, reference):
            return candidate
    return None


def _same_bytes(path: Path, reference: bytes) -> bool:
    """Return whether `path` exists and matches ``reference`` byte-for-byte."""
    try:
        return path.stat().st_size == len(reference) and path.read_bytes() == reference
    except OSError:
        return False


def _resolve_source(variants: list[review.Variant], first: Path, review_dir: Path) -> Path | None:
    """Resolve the studio's content source without forking it into ``_reviews``.

    Preference order: the stamped path (resolved against the studio cwd, then
    the page's tree), a byte-identical authored source when the stamp is a
    recovery artifact or unreachable, and only then recovery from the embed.
    """
    stamped = _stamped_source(variants, first)
    if stamped is not None:
        if not _is_recovered_artifact(stamped):
            return stamped
        try:
            twin = _identical_source(stamped.read_bytes(), first.parent)
        except OSError:
            twin = None
        if twin is not None:
            return twin
        return stamped
    embedded = _decode_source_embed(first.read_text(encoding="utf-8", errors="replace"))
    if embedded is not None:
        twin = _identical_source(embedded, first.parent)
        if twin is not None:
            return twin
    # stamped path gone (downloaded/mailed copy)? v3 pages carry their
    # source inside — recover it and the full studio still works
    return recover_source(first, review_dir)


def _print_startup(
    variants: list[review.Variant],
    source: Path | None,
    styles: list[str],
    url: str,
    md_path: Path,
) -> None:
    """Print the studio's startup banner: variants, source, URL, feedback path."""
    print(f"studio: {len(variants)} variant(s) · deterministic tweaks, no model in the loop")
    for v in variants:
        style = f" · style={v.style}" if v.style else ""
        print(f"  {v.label} · {v.path}{style}")
    if source is not None:
        print(f"source: {source} — theme controls ready: {', '.join(styles)}")
    else:
        print(
            "source: no reachable file or embedded v3 source — "
            "theme controls disabled (notes still work)"
        )
    print(f"open: {url}", flush=True)
    print(f"feedback lands in: {md_path}")
    print(f'when done, tell your agent: "Apply the review in {md_path}"')
    print("stop with Ctrl-C · re-assemble + refresh shows new versions (feedback persists)")


def _initial_context(files: list[Path], pages_dir: Path, styles: list[str]) -> review.PageContext:
    """Build the gallery placeholder or the first page's complete context."""
    if not files:
        review_dir = pages_dir / "_reviews" / "_gallery"
        json_path = review_dir / "review.json"
        return review.PageContext(
            variants=[],
            state=review.load_state("_gallery", [], json_path),
            json_path=json_path,
            md_path=review_dir / "review.md",
            preview_dir=review_dir,
        )

    variants = [
        review.load_variant(path, review.VARIANT_LABELS[index]) for index, path in enumerate(files)
    ]
    first = variants[0].path
    review_dir = first.parent / "_reviews" / first.stem
    json_path = review_dir / "review.json"
    md_path = review_dir / "review.md"
    state = review.load_state(first.stem, variants, json_path)
    review.persist_state(state, variants, json_path, md_path)
    source = _resolve_source(variants, first, review_dir)
    return review.PageContext(
        variants=variants,
        state=state,
        json_path=json_path,
        md_path=md_path,
        preview_dir=review_dir,
        source_path=source,
        styles=tuple(styles) if source is not None else (),
    )


def main() -> None:
    """Parse CLI args, serve the studio server, and block until Ctrl-C."""
    args = _parse_args()
    files, pages_dir = _resolve_files(args.files)
    gallery_mode = not files
    styles = sorted(p.stem for p in (KIT_DIR / "styles").glob("*.css"))

    StudioHandler.all_styles = styles
    StudioHandler.pages_dir = pages_dir
    StudioHandler.gallery_mode = gallery_mode
    StudioHandler.pages_cache = None
    StudioHandler.contexts = {}
    StudioHandler.agent_adapter = _make_adapter(args.agent)

    StudioHandler.context = _initial_context(files, pages_dir, styles)
    initial_name = StudioHandler.context.state.get("review")
    if isinstance(initial_name, str) and initial_name:
        StudioHandler.contexts[initial_name] = StudioHandler.context

    try:
        # StudioHandler's base comes from the runtime-resolved review module,
        # so the checker can't see it is a BaseHTTPRequestHandler subclass.
        server = ThreadingHTTPServer(("127.0.0.1", args.port), StudioHandler)  # pyrefly: ignore[bad-argument-type]
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), StudioHandler)  # pyrefly: ignore[bad-argument-type]
    port = server.server_address[1]

    if gallery_mode:
        url = f"http://127.0.0.1:{port}/gallery"
        print(f"studio: gallery · {pages_dir}/")
        print(f"open: {url}", flush=True)
        print("click any card to open it in the studio")
        print("stop with Ctrl-C")
    else:
        first_path = StudioHandler.context.variants[0].path.resolve()
        startup_slugs = review.page_slugs(
            _explainer_paths(StudioHandler.context.variants, StudioHandler.pages_dir)
        )
        url = f"http://127.0.0.1:{port}/{startup_slugs[first_path]}"
        _print_startup(
            StudioHandler.context.variants,
            StudioHandler.context.source_path,
            styles,
            url,
            StudioHandler.context.md_path,
        )

    if not args.no_open:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()

    def stop_on_sigterm(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, stop_on_sigterm)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if not gallery_mode:
            print(f"\nreview saved: {StudioHandler.context.md_path}")
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
        if StudioHandler.agent_adapter is not None:
            StudioHandler.agent_adapter.close()


if __name__ == "__main__":
    main()
