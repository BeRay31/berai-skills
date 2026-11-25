#!/usr/bin/env python3
"""Assemble a self-contained explainer HTML from a content source + the kit.

Stdlib only — needs Python 3.9+ (run ``python3 --version`` to confirm). The
output is ONE .html file with zero external runtime dependencies; Motion is
vendored inline.

Usage (run from the repo root):
    python3 .factory/skills/explainer/assemble.py explainers/_sources/<topic>.html
    python3 .factory/skills/explainer/assemble.py <source> --out explainers/<topic>-explainer.html

Content source format (one file, four required slots plus optional authoring):
    <script type="application/json" data-slot="meta"> {...} </script>
    <template data-slot="content"> ...sections... </template>
    <style data-slot="page-css"> ...topic-specific CSS... </style>
    <script data-slot="page-js"> ...topic data + renderers + initPresent... </script>
    <script type="application/json" data-slot="authoring"> ...Studio edits... </script>

See README.md and references/CONTRACTS.md (next to this file) for the full
authoring guide. Output paths in meta.output are resolved relative to the
current working directory, not this file — always run from the repo root.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from dataclasses import replace as dataclass_replace
from html import escape as html_escape  # avoid shadowing main()'s assembled `html` string
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, NoReturn, cast

_AUTHORING: dict[str, Any] = runpy.run_path(str(Path(__file__).resolve().with_name("authoring.py")))
ManifestError = _AUTHORING["ManifestError"]
extract_authoring_manifest = _AUTHORING["extract_manifest"]
authoring_has_content = _AUTHORING["has_content"]
authoring_component_assets = _AUTHORING["component_assets"]

KIT = Path(__file__).resolve().parent
STYLES = sorted(p.stem for p in (KIT / "styles").glob("*.css"))
COMPONENTS = sorted(p.stem for p in (KIT / "components").glob("*.js") if p.stem != "_core")
# geo-world is data for chart's map kind, so it pulls chart in; the reverse
# is deliberately NOT a dependency — charts without a map must not pay the
# ~95 KB of vendored world geometry
COMPONENT_DEPENDENCIES = {
    "architecture": ("data-flow",),
    "geo-world": ("chart",),
    "trace": ("data-flow", "architecture", "chart"),
}
# Retired component names that have a direct current equivalent.
# Accepted without error; a note is printed so authors can update the source.
COMPONENT_ALIASES: dict[str, str] = {
    "stat": "chart",
    "before-after": "table",
    "ledger": "table",
    "comparison": "table",
    "dotplot": "table",
    "chips": "table",
    "tiles": "table",
    "filetree": "tree",
    "operating-model": "architecture",
}
COMPONENT_COMPAT_ASSETS: dict[str, tuple[str, ...]] = {
    "contrast": ("table",),
    "verdict": ("chart",),
    "duo": (),
}
RENDER_COMPONENTS: dict[str, str] = {
    "renderTable": "table",
    "renderTree": "tree",
    "renderLoop": "loop",
    "renderStepper": "stepper",
    "renderDataFlow": "data-flow",
    "renderArchitecture": "architecture",
    "renderSequence": "architecture",
    "renderErd": "architecture",
    "renderStack": "architecture",
    "renderTrace": "trace",
    "renderFlow": "flow",
    "renderChart": "chart",
    "renderSection": "section",
    "renderRoadmap": "roadmap",
    "renderCode": "code",
    "renderIceberg": "iceberg",
    "renderPyramid": "pyramid",
    "renderStats": "chart",
    "renderLedger": "table",
    "renderBeforeAfter": "table",
    "renderComparison": "table",
    "renderDotplot": "table",
    "renderChips": "table",
    "renderTiles": "table",
    "renderFiletree": "tree",
    "renderOperatingModel": "architecture",
    "renderContrast": "table",
    "renderVerdict": "chart",
    "renderDuo": "duo",
}
THEMES = ("dark", "light")
RECIPES = ("explainer", "app-sketch")
MIN_VARIANTS = 2  # --variants exists to compare looks; one style is just --style


def die(msg: str) -> NoReturn:
    """Print `msg` prefixed with the script name and exit with status 1."""
    sys.exit(f"assemble.py: error: {msg}")


def read_kit_file(rel_path: str) -> str:
    """Read a file that ships with the kit itself.

    Covers styles/base/components/template/VERSION. Dies with an actionable
    message if the file is missing, instead of letting a raw
    FileNotFoundError escape — consistent with how every other "is the kit
    intact?" check in this script behaves.
    """
    path = KIT / rel_path
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        die(f"kit file missing: {rel_path} — is .factory/skills/explainer/ intact?")


def _sketch_csp_disclosure(simulation: dict[str, object]) -> tuple[str, str]:
    """Build the offline-only CSP meta tag and simulation disclosure block.

    Shared by both ``app-sketch`` (and any future sketch-adjacent recipe).
    Returns ``(csp_html, disclosure_html)``.
    """
    csp = (
        '<meta http-equiv="Content-Security-Policy" content="'
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
        "img-src data: blob:; media-src data: blob:; connect-src 'none'; "
        "font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; "
        "base-uri 'none'; form-action 'none'"
        '">'
    )
    disclosure = (
        '<aside class="simulation-disclosure" role="note" '
        f'data-fidelity="{html_escape(cast("str", simulation["fidelity"]))}" '
        f'data-scenario="{html_escape(cast("str", simulation["scenario"]))}" '
        'aria-label="Simulation status">'
        "<strong>Simulated sketch</strong>"
        "<span>Synthetic data · no network fetches</span>"
        "</aside>"
    )
    return csp, disclosure


def validate_under_cwd(path: Path, what: str) -> None:
    """Confine `path` to the current working directory, or die.

    Content sources are agent-authored and can set meta.output to anything;
    without this check a source could write (or delete) an arbitrary file
    outside the project via "../../etc" or an absolute path. `what` names the
    kind of path in the die() message (e.g. "output path").
    """
    resolved = path.resolve()
    if Path.cwd() not in resolved.parents:
        die(
            f"{what} '{path}' resolves outside the current directory ({Path.cwd()}) — refusing to write there"
        )


def extract_slot(src: str, pattern: str, name: str, *, required: bool = True) -> str:
    """Return the stripped contents of `pattern`'s single capture group.

    Matches the first occurrence in `src`, DOTALL so it spans newlines.

    Parameters
    ----------
    src : str
        The full content-source HTML to scan.
    pattern : str
        A regex with exactly one capture group, matched with `re.DOTALL`.
    name : str
        The slot's ``data-slot`` name, used only in the die() message.
    required : bool, optional
        When true (the default), die() if `pattern` has no match. When
        false, a missing slot returns "" instead of failing.

    Returns
    -------
    str
        The stripped capture-group text, or "" for a missing optional slot.
    """
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        if required:
            die(f'content source is missing the required <... data-slot="{name}"> block')
        return ""
    return m.group(1).strip()


def extract_content_slot(src: str) -> str:
    """Return the inner HTML of the balanced ``<template data-slot="content">``.

    Parameters
    ----------
    src : str
        The full content-source HTML to scan.

    Returns
    -------
    str
        The stripped inner HTML of the content ``<template>`` (``""`` only
        when the slot element is present but empty).

    Raises
    ------
    SystemExit
        Via :func:`die` when the required ``<template data-slot="content">``
        block is missing or its closing tag is unbalanced.

    Notes
    -----
    Finds the *balanced* closing ``</template>`` rather than the first literal
    one, because ``<template>`` (unlike raw-text ``<script>``/``<style>``) can
    legitimately nest. HTML comments are blanked first so tag-like text inside
    them cannot unbalance the counter; a literal ``<template`` inside a quoted
    attribute value remains a known, rare limitation.
    """
    # <template> is a normal (non-raw-text) HTML element, so it can
    # legitimately nest — unlike <script>/<style> below, which are raw-text
    # elements per the HTML spec: a browser stops at the first literal
    # "</script"/"</style" regardless of string/comment context, so a
    # smarter parser there would only produce results that diverge from how
    # the assembled output itself actually gets parsed. Find the balanced
    # closing tag here instead of the first literal `</template>`.
    #
    # Known limitation: this still counts a literal "<template"/"</template"
    # inside a quoted attribute value that merely mentions template syntax as
    # prose (e.g. a content source documenting the kit itself). HTML comments
    # are blanked out first (see `blanked` below) so they don't trip this up;
    # an occurrence inside an attribute value is rare enough in practice (and
    # would need a real HTML parser to rule out generally) that it's left as
    # a documented edge case rather than fixed here.
    blanked = re.sub(r"<!--.*?-->", lambda mm: " " * len(mm.group(0)), src, flags=re.DOTALL)
    m = re.search(r'<template[^>]*data-slot="content"[^>]*>', blanked, re.IGNORECASE)
    if not m:
        die('content source is missing the required <template data-slot="content"> block')
    depth, pos = 1, m.end()
    for tag in re.finditer(r"<template\b[^>]*>|</template\s*>", blanked[pos:], re.IGNORECASE):
        # A trailing "/" before ">" (e.g. "<template ... />") is absorbed by
        # [^>]*, so this still counts as an *opening* tag — matching real
        # HTML parsing, where <template> isn't a void/foreign element and a
        # browser ignores a stray trailing slash on it.
        depth += -1 if tag.group(0).startswith("</") else 1
        if depth == 0:
            return src[pos : pos + tag.start()].strip()
    die("content slot's <template> is never closed (unbalanced nesting?)")


def motion_version_key(path: Path) -> tuple[int, ...]:
    """Sort key for vendored ``motion-<version>.min.js`` builds.

    Splits the dotted version embedded in the filename into integers so the
    newest build is selected numerically, e.g. ``motion-12.23.26`` sorts above
    ``motion-9.0.0`` (lexicographic ``sorted()`` would rank ``9`` highest).

    Parameters
    ----------
    path : Path
        A ``vendor/motion-*.min.js`` file path.

    Returns
    -------
    tuple[int, ...]
        The dotted version components as integers; ``()`` when no digits are
        present, so an unversioned build sorts lowest.
    """
    digits = re.findall(r"\d+", path.name)
    return tuple(int(d) for d in digits)


# Markers filled with the topic's own content rather than a kit file's
# contents — excluded from the kit-reuse byte count. Defined once and
# reused below so a future marker can't silently miscount itself into
# "kit" just because someone forgot to update a second, separate list.
PAGE_MARKERS = {
    "@TITLE@",
    "@THEME@",
    "@STYLE@",
    "@RECIPE@",
    "@CSP@",
    "@KIT_STAMP@",
    "<!--@inject:SIMULATION_DISCLOSURE@-->",
    "/*@inject:PAGE_CSS@*/",
    "<!--@inject:CONTENT@-->",
    "/*@inject:PAGE_JS@*/",
    "/*@inject:AUTHORING_JS@*/",
    "<!--@inject:SOURCE_EMBED@-->",
}


def embed_source(raw_source: str) -> str:
    """Pack the verbatim content source into an inert script block.

    Every assembled explainer carries its own source (base64, so nested
    ``</script>`` tags cannot break the page). That makes any copy of the
    page editable anywhere: the studio recovers the source from the page
    itself when the stamped ``source=`` path is not on disk — mailed files,
    downloads, other machines. Browsers ignore the unknown script type;
    nothing here executes or loads.

    Parameters
    ----------
    raw_source : str
        The content source file's full text, verbatim.

    Returns
    -------
    str
        A ``<script type="text/x-explainer-source">`` block wrapping the
        base64-encoded, line-wrapped source.
    """
    packed = base64.b64encode(raw_source.encode("utf-8")).decode("ascii")
    wrapped = "\n".join(packed[i : i + 120] for i in range(0, len(packed), 120))
    return f'<script type="text/x-explainer-source">\n{wrapped}\n</script>'


@dataclass
class ContentSource:
    """The authored slots plus the path/text they came from.

    Bundles what would otherwise be five separate parameters threaded
    through every assembly step (:func:`_assemble_variants`,
    :func:`_build_app_sketch_page`, :func:`_build_explainer_page`,
    :func:`assemble_once`) — one content source, passed as one value.
    """

    meta: dict[str, Any]
    content: str
    page_css: str
    page_js: str
    authoring: dict[str, object]
    src_path: Path
    raw: str = field(default="")  # verbatim source text, for embed_source()


class _ContentIdCollector(HTMLParser):
    """Collect literal HTML id attributes without interpreting page script."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.ids: list[str] = []
        self.template_depth = 0

    def _collect(self, attrs: list[tuple[str, str | None]]) -> None:
        if not self.template_depth:
            self.ids.extend(value for name, value in attrs if name == "id" and value is not None)

    def handle_starttag(  # pyrefly: ignore[missing-override-decorator]
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self._collect(attrs)
        if tag == "template":
            self.template_depth += 1

    def handle_endtag(  # pyrefly: ignore[missing-override-decorator]
        self, tag: str
    ) -> None:
        if tag == "template" and self.template_depth:
            self.template_depth -= 1

    def handle_startendtag(  # pyrefly: ignore[missing-override-decorator]
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        del tag
        self._collect(attrs)


@dataclass(frozen=True)
class _JsToken:
    """A deliberately small JS token used only for conservative recognition."""

    kind: str
    value: str


_JS_REGEX_PREFIXES = {"return", "case", "throw", "delete", "void", "typeof", "yield", "await"}
_JS_PREFIX_PUNCTUATION = set("([{ :;,=!?&|+-*%^~<>")
_JS_CONTROL_KEYWORDS = {"if", "while", "for", "with", "switch", "catch"}


def _is_punct_token(token: _JsToken, value: str) -> bool:
    return token.kind == "punct" and token.value == value


def _regex_can_start(tokens: list[_JsToken]) -> bool:
    if not tokens:
        return True
    previous = tokens[-1]
    if not _is_punct_token(previous, ")"):
        return (previous.kind == "punct" and previous.value in _JS_PREFIX_PUNCTUATION) or (
            previous.kind == "ident" and previous.value in _JS_REGEX_PREFIXES
        )
    depth = 0
    for index in range(len(tokens) - 1, -1, -1):
        if _is_punct_token(tokens[index], ")"):
            depth += 1
        elif _is_punct_token(tokens[index], "("):
            depth -= 1
            if depth == 0:
                return (
                    index > 0
                    and tokens[index - 1].kind == "ident"
                    and tokens[index - 1].value in _JS_CONTROL_KEYWORDS
                )
    return False


def _skip_js_comment(source: str, start: int) -> int:
    if source.startswith("//", start):
        newline = source.find("\n", start + 2)
        return len(source) if newline < 0 else newline + 1
    end = source.find("*/", start + 2)
    return len(source) if end < 0 else end + 2


def _read_js_string(source: str, start: int) -> tuple[int, str | None]:
    quote, index, escaped = source[start], start + 1, False
    while index < len(source) and source[index] != quote:
        if source[index] == "\\":
            escaped = True
            index += 2
        else:
            index += 1
    value = (
        source[start + 1 : index] if quote != "`" and index < len(source) and not escaped else None
    )
    return min(index + 1, len(source)), value


def _skip_js_regex(source: str, start: int) -> int:
    index, in_class = start + 1, False
    while index < len(source) and source[index] not in "\r\n":
        if source[index] == "\\":
            index += 2
            continue
        if source[index] == "[":
            in_class = True
        elif source[index] == "]":
            in_class = False
        elif source[index] == "/" and not in_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            break
        index += 1
    return index


def _scan_js(source: str) -> tuple[list[_JsToken], list[str]]:
    """Recognize conservative tokens and collect comment-free string source."""
    tokens: list[_JsToken] = []
    strings: list[str] = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
        elif source.startswith(("//", "/*"), index):
            index = _skip_js_comment(source, index)
        elif char in "'\"`":
            start = index
            index, value = _read_js_string(source, index)
            strings.append(value if value is not None else source[start:index])
            # Template, escaped, and unterminated strings intentionally emit opaque tokens.
            # Their neighbours stay separated while literal-value checks still give up safely.
            tokens.append(
                _JsToken("string", value)
                if value is not None
                else _JsToken("opaque", source[start:index])
            )
        elif char == "/" and _regex_can_start(tokens):
            start = index
            index = _skip_js_regex(source, index)
            tokens.append(_JsToken("opaque", source[start:index]))
        elif char.isalpha() or char in "_$":
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in "_$"):
                end += 1
            tokens.append(_JsToken("ident", source[index:end]))
            index = end
        else:
            tokens.append(_JsToken("punct", char))
            index += 1
    return tokens, strings


def _js_tokens(source: str) -> list[_JsToken]:
    """Recognize only the literal JavaScript forms safe for static validation."""
    return _scan_js(source)[0]


def _js_string_fragments(source: str) -> list[str]:
    """Return string source for markup checks without including comments."""
    return _scan_js(source)[1]


def _matching_token(tokens: list[_JsToken], opening: int) -> int | None:
    pairs = {"(": ")", "[": "]", "{": "}"}
    expected = pairs.get(tokens[opening].value)
    if expected is None:
        return None
    depth = 0
    for index in range(opening, len(tokens)):
        if tokens[index].kind != "punct":
            continue
        if tokens[index].value == tokens[opening].value:
            depth += 1
        elif tokens[index].value == expected:
            depth -= 1
            if depth == 0:
                return index
    return None


def _is_direct_call(tokens: list[_JsToken], index: int) -> bool:
    if index + 1 >= len(tokens) or not _is_punct_token(tokens[index + 1], "("):
        return False
    if index and _is_punct_token(tokens[index - 1], "."):
        return False
    if index and tokens[index - 1].kind == "ident" and tokens[index - 1].value == "function":
        return False
    if (
        index > 1
        and _is_punct_token(tokens[index - 1], "*")
        and tokens[index - 2].kind == "ident"
        and tokens[index - 2].value == "function"
    ):
        return False
    closing = _matching_token(tokens, index + 1)
    return (
        closing is None
        or closing + 1 >= len(tokens)
        or not _is_punct_token(tokens[closing + 1], "{")
    )


def _literal_id_array(tokens: list[_JsToken], start: int, end: int) -> list[str]:
    selectors: list[str] = []
    for index in range(start, end):
        value = tokens[index].value
        if (
            tokens[index].kind == "string"
            and tokens[index - 1].value in {"[", ","}
            and tokens[index + 1].value in {",", "]"}
            and re.fullmatch(r"#[A-Za-z_][A-Za-z0-9_-]*", value)
        ):
            selectors.append(value)
    return selectors


def _literal_present_id_selectors(tokens: list[_JsToken]) -> list[str]:
    """Return exact ``#id`` string elements from recognizable pick arrays."""
    selectors: list[str] = []
    for index, token in enumerate(tokens):
        if token.value != "initPresent" or not _is_direct_call(tokens, index):
            continue
        call_end = _matching_token(tokens, index + 1)
        if call_end is None or index + 2 >= call_end or tokens[index + 2].value != "[":
            continue
        cursor = index + 3
        object_depth = 0
        while cursor + 2 < call_end:
            current = tokens[cursor]
            if current.kind == "punct" and current.value == "{":
                object_depth += 1
            elif current.kind == "punct" and current.value == "}":
                object_depth -= 1
            elif (
                object_depth == 1
                and current.value == "pick"
                and tokens[cursor + 1].value == ":"
                and tokens[cursor + 2].value == "["
            ):
                array_end = _matching_token(tokens, cursor + 2)
                if array_end is None or array_end > call_end:
                    break
                selectors.extend(_literal_id_array(tokens, cursor + 3, array_end))
                cursor = array_end
            cursor += 1
    return selectors


_JS_MEMBER_MIN_TOKENS = 3
_JS_RENDER_MIN_ARGUMENTS = 2
_JS_SPREAD_TOKENS = 3
_JS_SAFE_INTEGER_MAX = 9_007_199_254_740_991
_TEXT_CAP_PATH = re.compile(
    r"[A-Za-z_$][A-Za-z0-9_$]*(?:\[\])*(?:\.[A-Za-z_$][A-Za-z0-9_$]*(?:\[\])*)*"
)
_TEXT_CAP_FALLBACK = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
_TEXT_CAP_WHEN_FIELDS = {"mode", "kind", "preset"}
_TEXT_CAP_MEASURES = {"plain", "passive-inline"}
_TEXT_CAP_ROOT_KEYS = {"schema", "rules"}
_TEXT_CAP_RULE_KEYS = {
    "id",
    "component",
    "renderers",
    "targets",
    "when",
    "unlessAnyNonempty",
}
_TEXT_CAP_TARGET_KEYS = {"path", "max", "measure", "hint", "fallback"}
_TEXT_CAP_PASSIVE_TOKEN = re.compile(
    r'</?(?:code|em|strong|b|i|br)>|</span>|<span class="(?:y-key|y-str|y-num|y-bool|y-com)">',
    re.IGNORECASE,
)
_UNKNOWN_JS_VALUE = object()
_ABSENT_JS_VALUE = object()


@dataclass(frozen=True)
class _TextCapTarget:
    path: str
    limit: int
    measure: str
    hint: str
    fallback: str | None


@dataclass(frozen=True)
class _TextCapRule:
    rule_id: str
    component: str
    renderers: tuple[str, ...]
    targets: tuple[_TextCapTarget, ...]
    when: dict[str, tuple[str | None, ...]]
    unless_any_nonempty: tuple[str, ...]


@dataclass(frozen=True)
class _TextCapDiagnostic:
    renderer: str
    component: str
    path: str
    actual: int
    limit: int
    value: str
    hint: str


@dataclass(frozen=True)
class _LiteralBinding:
    declaration_end: int
    value: dict[str, object]


@dataclass(frozen=True)
class _MaterializedValue:
    path: str
    value: object


def _top_level_js_segments(
    tokens: list[_JsToken], start: int, end: int
) -> list[tuple[int, int]] | None:
    pairs = {"(": ")", "[": "]", "{": "}"}
    closings = {value: key for key, value in pairs.items()}
    stack: list[str] = []
    segments: list[tuple[int, int]] = []
    segment_start = start
    for index in range(start, end):
        token = tokens[index]
        if token.kind != "punct":
            continue
        if token.value in pairs:
            stack.append(token.value)
        elif token.value in closings:
            if not stack or stack[-1] != closings[token.value]:
                return None
            stack.pop()
        elif token.value == "," and not stack:
            segments.append((segment_start, index))
            segment_start = index + 1
    if stack:
        return None
    segments.append((segment_start, end))
    return segments


def _literal_object_members(
    tokens: list[_JsToken], start: int, end: int
) -> dict[str, tuple[int, int]] | None:
    if start >= end or not _is_punct_token(tokens[start], "{"):
        return None
    if _matching_token(tokens, start) != end - 1:
        return None
    segments = _top_level_js_segments(tokens, start + 1, end - 1)
    if segments is None:
        return None
    members: dict[str, tuple[int, int]] = {}
    for member_start, member_end in segments:
        if member_start == member_end:
            continue
        if (
            member_end - member_start < _JS_MEMBER_MIN_TOKENS
            or tokens[member_start].kind not in {"ident", "string"}
            or not _is_punct_token(tokens[member_start + 1], ":")
        ):
            return None
        key = tokens[member_start].value
        if key in members:
            return None
        members[key] = (member_start + 2, member_end)
    return members


def _literal_js_array(tokens: list[_JsToken], start: int, end: int) -> object:
    if _matching_token(tokens, start) != end - 1:
        return _UNKNOWN_JS_VALUE
    segments = _top_level_js_segments(tokens, start + 1, end - 1)
    if segments is None:
        return _UNKNOWN_JS_VALUE
    if len(segments) == 1 and segments[0][0] == segments[0][1]:
        empty: list[object] = []
        return empty
    values: list[object] = []
    for index, value_range in enumerate(segments):
        value_start, value_end = value_range
        if value_start == value_end:
            if index == len(segments) - 1:
                continue
            return _UNKNOWN_JS_VALUE
        if value_end - value_start >= _JS_SPREAD_TOKENS and all(
            _is_punct_token(tokens[value_start + offset], ".")
            for offset in range(_JS_SPREAD_TOKENS)
        ):
            return _UNKNOWN_JS_VALUE
        values.append(_literal_js_value(tokens, value_start, value_end))
    return values


def _literal_js_integer(tokens: list[_JsToken], start: int, end: int) -> int | None:
    source = "".join(token.value for token in tokens[start:end])
    if not re.fullmatch(r"-?(?:0|[1-9][0-9]*)", source):
        return None
    value = int(source)
    return value if abs(value) <= _JS_SAFE_INTEGER_MAX else None


def _literal_js_value(tokens: list[_JsToken], start: int, end: int) -> object:
    if end - start == 1:
        token = tokens[start]
        if token.kind == "string":
            return token.value
        if token.kind == "ident" and token.value in {"null", "true", "false"}:
            return {"null": None, "true": True, "false": False}[token.value]
    if start < end and _is_punct_token(tokens[start], "{"):
        members = _literal_object_members(tokens, start, end)
        if members is None:
            return _UNKNOWN_JS_VALUE
        return {
            name: _literal_js_value(tokens, value_start, value_end)
            for name, (value_start, value_end) in members.items()
        }
    if start < end and _is_punct_token(tokens[start], "["):
        return _literal_js_array(tokens, start, end)
    integer = _literal_js_integer(tokens, start, end)
    return integer if integer is not None else _UNKNOWN_JS_VALUE


def _js_token_depths(tokens: list[_JsToken]) -> list[int]:
    openings = {"(", "[", "{"}
    closings = {")": "(", "]": "[", "}": "{"}
    stack: list[str] = []
    depths: list[int] = []
    for token in tokens:
        depths.append(len(stack))
        if token.kind != "punct":
            continue
        if token.value in openings:
            stack.append(token.value)
        elif token.value in closings and stack and stack[-1] == closings[token.value]:
            stack.pop()
    return depths


def _js_statement_end(tokens: list[_JsToken], start: int) -> int:
    pairs = {"(": ")", "[": "]", "{": "}"}
    closings = {value: key for key, value in pairs.items()}
    stack: list[str] = []
    for index in range(start, len(tokens)):
        token = tokens[index]
        if token.kind != "punct":
            continue
        if token.value in pairs:
            stack.append(token.value)
        elif token.value in closings:
            if not stack or stack[-1] != closings[token.value]:
                return index
            stack.pop()
        elif token.value == ";" and not stack:
            return index
    return len(tokens)


def _asi_literal_binding(
    tokens: list[_JsToken], declaration: int, depths: list[int]
) -> tuple[str, _LiteralBinding] | None:
    name_index = declaration + 1
    value_index = declaration + 3
    if (
        value_index >= len(tokens)
        or tokens[name_index].kind != "ident"
        or not _is_punct_token(tokens[name_index + 1], "=")
        or not _is_punct_token(tokens[value_index], "{")
    ):
        return None
    value_end = _matching_token(tokens, value_index)
    next_index = value_end + 1 if value_end is not None else len(tokens)
    if (
        value_end is None
        or next_index >= len(tokens)
        or tokens[next_index].kind != "ident"
        or depths[next_index] != 0
    ):
        return None
    value = _literal_js_value(tokens, value_index, next_index)
    if not isinstance(value, dict):
        return None
    return tokens[name_index].value, _LiteralBinding(value_end, cast("dict[str, object]", value))


def _top_level_literal_bindings(tokens: list[_JsToken]) -> dict[str, _LiteralBinding]:
    depths = _js_token_depths(tokens)
    candidates: dict[str, list[_LiteralBinding]] = {}
    for index, token in enumerate(tokens):
        if token.kind != "ident" or token.value not in {"var", "let", "const"} or depths[index]:
            continue
        statement_end = _js_statement_end(tokens, index + 1)
        declarations = _top_level_js_segments(tokens, index + 1, statement_end)
        if declarations is None:
            continue
        for start, end in declarations:
            if (
                end - start < _JS_MEMBER_MIN_TOKENS
                or tokens[start].kind != "ident"
                or not _is_punct_token(tokens[start + 1], "=")
            ):
                continue
            value = _literal_js_value(tokens, start + 2, end)
            if isinstance(value, dict):
                candidates.setdefault(tokens[start].value, []).append(
                    _LiteralBinding(statement_end, cast("dict[str, object]", value))
                )
        asi_binding = _asi_literal_binding(tokens, index, depths)
        if asi_binding is not None:
            name, binding = asi_binding
            candidates.setdefault(name, []).append(binding)
    return {name: values[0] for name, values in candidates.items() if len(values) == 1}


def _reject_json_constant(value: str) -> NoReturn:
    msg = f"non-standard JSON constant {value!r}"
    raise ValueError(msg)


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            msg = f"duplicate JSON object key {key!r}"
            raise ValueError(msg)
        value[key] = item
    return value


def _text_cap_known_keys(
    value: dict[str, Any], allowed: set[str], path: str, errors: list[str]
) -> None:
    errors.extend(f"{path}: unknown key {key!r}" for key in value.keys() - allowed)


def _text_cap_required_keys(
    value: dict[str, Any], required: set[str], path: str, errors: list[str]
) -> None:
    errors.extend(f"{path}: missing required key {key!r}" for key in required - value.keys())


def _validate_text_cap_condition(
    condition: object, path: str, errors: list[str]
) -> tuple[str | None, ...] | None:
    values = condition if isinstance(condition, list) else [condition]
    if not values:
        errors.append(f"{path}: condition array must not be empty")
        return None
    if any(value is not None and not isinstance(value, str) for value in values):
        errors.append(f"{path}: expected a string, null, or a non-empty array of those values")
        return None
    if len({json.dumps(value) for value in values}) != len(values):
        errors.append(f"{path}: condition values must be unique")
        return None
    return tuple(cast("str | None", value) for value in values)


def _validate_text_cap_when(
    value: object, path: str, errors: list[str]
) -> dict[str, tuple[str | None, ...]] | None:
    if value is _ABSENT_JS_VALUE:
        return {}
    if not isinstance(value, dict):
        errors.append(f"{path}: expected an object")
        return None
    _text_cap_known_keys(value, _TEXT_CAP_WHEN_FIELDS, path, errors)
    normalized: dict[str, tuple[str | None, ...]] = {}
    for field_name, condition in value.items():
        if field_name not in _TEXT_CAP_WHEN_FIELDS:
            continue
        expected = _validate_text_cap_condition(condition, f"{path}.{field_name}", errors)
        if expected is not None:
            normalized[field_name] = expected
    return normalized


def _validate_text_cap_paths(value: object, path: str, errors: list[str]) -> tuple[str, ...] | None:
    if value is _ABSENT_JS_VALUE:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        errors.append(f"{path}: expected an array of paths")
        return None
    paths = cast("list[str]", value)
    for index, item in enumerate(paths):
        if _TEXT_CAP_PATH.fullmatch(item) is None:
            errors.append(f"{path}[{index}]: invalid dotted/[] path {item!r}")
    if len(set(paths)) != len(paths):
        errors.append(f"{path}: paths must be unique")
    return tuple(paths)


def _validate_text_cap_target(value: object, path: str, errors: list[str]) -> _TextCapTarget | None:
    if not isinstance(value, dict):
        errors.append(f"{path}: expected an object")
        return None
    before = len(errors)
    _text_cap_known_keys(value, _TEXT_CAP_TARGET_KEYS, path, errors)
    _text_cap_required_keys(value, {"path", "max", "measure", "hint"}, path, errors)
    target_path = value.get("path")
    if not isinstance(target_path, str) or _TEXT_CAP_PATH.fullmatch(target_path) is None:
        errors.append(f"{path}.path: expected a simple dotted/[] path")
    limit = value.get("max")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        errors.append(f"{path}.max: expected a positive non-boolean integer")
    measure = value.get("measure")
    if not isinstance(measure, str) or measure not in _TEXT_CAP_MEASURES:
        errors.append(f"{path}.measure: expected one of {sorted(_TEXT_CAP_MEASURES)}")
    hint = value.get("hint")
    if not isinstance(hint, str) or not hint.strip():
        errors.append(f"{path}.hint: expected a non-empty string")
    fallback_raw = value.get("fallback", _ABSENT_JS_VALUE)
    if fallback_raw is _ABSENT_JS_VALUE:
        fallback = None
    elif not isinstance(fallback_raw, str) or _TEXT_CAP_FALLBACK.fullmatch(fallback_raw) is None:
        errors.append(f"{path}.fallback: expected a simple field name")
        fallback = None
    else:
        fallback = fallback_raw
    if len(errors) != before:
        return None
    return _TextCapTarget(
        cast("str", target_path),
        cast("int", limit),
        cast("str", measure),
        cast("str", hint),
        cast("str | None", fallback),
    )


def _validate_text_cap_renderers(value: object, path: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list) or not value:
        errors.append(f"{path}: expected a non-empty array")
        return []
    renderer_names = [item for item in value if isinstance(item, str)]
    if len(renderer_names) != len(value) or any(
        renderer not in RENDER_COMPONENTS for renderer in renderer_names
    ):
        errors.append(f"{path}: entries must be known renderer names")
    if len(set(renderer_names)) != len(renderer_names):
        errors.append(f"{path}: entries must be unique")
    return renderer_names


def _validate_text_cap_targets(value: object, path: str, errors: list[str]) -> list[_TextCapTarget]:
    if not isinstance(value, list) or not value:
        errors.append(f"{path}: expected a non-empty array")
        return []
    targets: list[_TextCapTarget] = []
    for index, target_raw in enumerate(value):
        target = _validate_text_cap_target(target_raw, f"{path}[{index}]", errors)
        if target is not None:
            targets.append(target)
    return targets


def _validate_text_cap_rule(value: object, index: int, errors: list[str]) -> _TextCapRule | None:
    path = f"rules[{index}]"
    if not isinstance(value, dict):
        errors.append(f"{path}: expected an object")
        return None
    before = len(errors)
    _text_cap_known_keys(value, _TEXT_CAP_RULE_KEYS, path, errors)
    _text_cap_required_keys(value, {"id", "component", "renderers", "targets"}, path, errors)
    rule_id = value.get("id")
    if not isinstance(rule_id, str) or not rule_id.strip():
        errors.append(f"{path}.id: expected a non-empty string")
    component = value.get("component")
    if not isinstance(component, str) or component not in COMPONENTS:
        errors.append(f"{path}.component: expected an existing component name")
    renderer_names = _validate_text_cap_renderers(
        value.get("renderers"), f"{path}.renderers", errors
    )
    targets = _validate_text_cap_targets(value.get("targets"), f"{path}.targets", errors)
    when = _validate_text_cap_when(value.get("when", _ABSENT_JS_VALUE), f"{path}.when", errors)
    unless = _validate_text_cap_paths(
        value.get("unlessAnyNonempty", _ABSENT_JS_VALUE),
        f"{path}.unlessAnyNonempty",
        errors,
    )
    if len(errors) != before or when is None or unless is None:
        return None
    return _TextCapRule(
        cast("str", rule_id),
        cast("str", component),
        tuple(renderer_names),
        tuple(targets),
        when,
        unless,
    )


def _load_text_caps_registry() -> tuple[dict[str, Any], tuple[_TextCapRule, ...]]:
    rel_path = "components/text-caps.json"
    try:
        raw = json.loads(
            read_kit_file(rel_path),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=_reject_json_constant,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        die(f"kit file invalid: {rel_path}: {exc}")
    errors: list[str] = []
    if not isinstance(raw, dict):
        die(f"kit file invalid: {rel_path}: root must be an object")
    _text_cap_known_keys(raw, _TEXT_CAP_ROOT_KEYS, "root", errors)
    _text_cap_required_keys(raw, _TEXT_CAP_ROOT_KEYS, "root", errors)
    schema = raw.get("schema")
    if isinstance(schema, bool) or not isinstance(schema, int) or schema != 1:
        errors.append("root.schema: expected integer 1")
    rules_raw = raw.get("rules")
    rules: list[_TextCapRule] = []
    if not isinstance(rules_raw, list):
        errors.append("root.rules: expected an array")
    else:
        for index, rule_raw in enumerate(rules_raw):
            rule = _validate_text_cap_rule(rule_raw, index, errors)
            if rule is not None:
                rules.append(rule)
        rule_ids = [rule.rule_id for rule in rules]
        if len(set(rule_ids)) != len(rule_ids):
            errors.append("root.rules: rule ids must be unique")
    if errors:
        die(f"kit file invalid: {rel_path}:\n" + "\n".join(sorted(errors)))
    return raw, tuple(rules)


def _text_cap_segments(path: str) -> list[tuple[str, int]]:
    segments: list[tuple[str, int]] = []
    for part in path.split("."):
        field_name = part.replace("[]", "")
        segments.append((field_name, (len(part) - len(field_name)) // 2))
    return segments


def _traverse_text_cap_states(
    states: list[_MaterializedValue], traversals: int
) -> tuple[list[_MaterializedValue], bool]:
    uncertain = False
    for _depth in range(traversals):
        traversed: list[_MaterializedValue] = []
        for state in states:
            if state.value is _UNKNOWN_JS_VALUE:
                uncertain = True
            elif isinstance(state.value, list):
                traversed.extend(
                    _MaterializedValue(f"{state.path}[{index}]", item)
                    for index, item in enumerate(state.value)
                )
            elif state.value is not _ABSENT_JS_VALUE and state.value is not None:
                traversed.append(state)
        states = traversed
    return states, uncertain


def _materialize_text_cap(
    data: dict[str, object], path: str, fallback: str | None = None
) -> tuple[list[_MaterializedValue], bool]:
    states = [_MaterializedValue("", data)]
    uncertain = False
    segments = _text_cap_segments(path)
    for segment_index, (field_name, traversals) in enumerate(segments):
        next_states: list[_MaterializedValue] = []
        for state in states:
            if state.value is _UNKNOWN_JS_VALUE:
                uncertain = True
                continue
            if not isinstance(state.value, dict):
                continue
            selected_name = field_name
            value = state.value.get(field_name, _ABSENT_JS_VALUE)
            if (
                segment_index == len(segments) - 1
                and fallback is not None
                and (value is _ABSENT_JS_VALUE or value is None or value == "")
            ):
                selected_name = fallback
                value = state.value.get(fallback, _ABSENT_JS_VALUE)
            selected_path = f"{state.path}.{selected_name}" if state.path else selected_name
            field_states, traversal_uncertain = _traverse_text_cap_states(
                [_MaterializedValue(selected_path, value)], traversals
            )
            uncertain = uncertain or traversal_uncertain
            next_states.extend(field_states)
        states = next_states
    uncertain = uncertain or any(state.value is _UNKNOWN_JS_VALUE for state in states)
    materialized = [
        state
        for state in states
        if state.value is not _ABSENT_JS_VALUE
        and state.value is not _UNKNOWN_JS_VALUE
        and state.value is not None
    ]
    return materialized, uncertain


def _text_cap_nonempty(value: object) -> bool:
    if value is None or value is _ABSENT_JS_VALUE:
        return False
    if isinstance(value, (list, str)):
        return bool(value)
    return True


def _text_cap_rule_matches(rule: _TextCapRule, renderer: str, data: dict[str, object]) -> bool:
    if renderer not in rule.renderers:
        return False
    for field_name, expected_values in rule.when.items():
        actual = data.get(field_name)
        if actual is _UNKNOWN_JS_VALUE:
            return False
        if not any(
            (expected is None and actual is None)
            or (isinstance(actual, str) and expected is not None and actual == expected)
            for expected in expected_values
        ):
            return False
    for path in rule.unless_any_nonempty:
        values, uncertain = _materialize_text_cap(data, path)
        if uncertain or any(_text_cap_nonempty(value.value) for value in values):
            return False
    return True


def _passive_inline_visible_text(value: str) -> str:
    visible: list[str] = []
    stack = [""]
    offset = 0
    for match in _TEXT_CAP_PASSIVE_TOKEN.finditer(value):
        visible.append(value[offset : match.start()])
        token = match.group(0)
        tag_match = re.match(r"</?([a-z]+)", token, re.IGNORECASE)
        if tag_match is None:
            visible.append(token)
            offset = match.end()
            continue
        tag = tag_match.group(1).lower()
        closing = token.startswith("</")
        allowed = tag != "span"
        if not allowed or (closing and (len(stack) == 1 or stack[-1] != tag)):
            visible.append(token)
        elif closing:
            stack.pop()
        elif tag != "br":
            stack.append(tag)
        offset = match.end()
    visible.append(value[offset:])
    return "".join(visible)


def _js_utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _text_cap_length(value: str, measure: str) -> int:
    measured = _passive_inline_visible_text(value) if measure == "passive-inline" else value
    return _js_utf16_length(measured)


def _js_scalar_string(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return None


def _binding_is_unchanged(
    tokens: list[_JsToken], name: str, binding: _LiteralBinding, call_index: int
) -> bool:
    for index in range(binding.declaration_end + 1, call_index):
        if tokens[index].kind != "ident" or tokens[index].value != name:
            continue
        if index and _is_punct_token(tokens[index - 1], "."):
            continue
        return False
    return True


def _renderer_literal_data(
    tokens: list[_JsToken], call_index: int, bindings: dict[str, _LiteralBinding]
) -> dict[str, object] | None:
    call_end = _matching_token(tokens, call_index + 1)
    if call_end is None:
        return None
    arguments = _top_level_js_segments(tokens, call_index + 2, call_end)
    if arguments is None or len(arguments) < _JS_RENDER_MIN_ARGUMENTS:
        return None
    start, end = arguments[1]
    value = _literal_js_value(tokens, start, end)
    if isinstance(value, dict):
        return cast("dict[str, object]", value)
    if end - start != 1 or tokens[start].kind != "ident":
        return None
    name = tokens[start].value
    binding = bindings.get(name)
    return (
        binding.value
        if binding is not None
        and binding.declaration_end < call_index
        and _binding_is_unchanged(tokens, name, binding, call_index)
        else None
    )


def _collect_text_cap_diagnostics(
    tokens: list[_JsToken], rules: tuple[_TextCapRule, ...]
) -> list[_TextCapDiagnostic]:
    diagnostics: list[_TextCapDiagnostic] = []
    bindings = _top_level_literal_bindings(tokens)
    for call_index, token in enumerate(tokens):
        renderer = token.value
        if renderer not in RENDER_COMPONENTS or not _is_direct_call(tokens, call_index):
            continue
        data = _renderer_literal_data(tokens, call_index, bindings)
        if data is None:
            continue
        for rule in rules:
            if not _text_cap_rule_matches(rule, renderer, data):
                continue
            for target in rule.targets:
                values, _uncertain = _materialize_text_cap(data, target.path, target.fallback)
                for materialized in values:
                    value = _js_scalar_string(materialized.value)
                    if value is None:
                        continue
                    actual = _text_cap_length(value, target.measure)
                    if actual > target.limit:
                        diagnostics.append(
                            _TextCapDiagnostic(
                                renderer,
                                rule.component,
                                materialized.path,
                                actual,
                                target.limit,
                                value,
                                target.hint,
                            )
                        )
    return diagnostics


def _validate_text_caps(tokens: list[_JsToken], rules: tuple[_TextCapRule, ...]) -> None:
    diagnostics = sorted(
        _collect_text_cap_diagnostics(tokens, rules),
        key=lambda item: (
            item.renderer,
            item.component,
            item.path,
            item.actual,
            item.limit,
            item.value,
            item.hint,
        ),
    )
    if not diagnostics:
        return
    lines = [
        f"component.copy_limit {item.renderer}/{item.component} authored {item.path}; "
        f"measured UTF-16 length {item.actual}; limit {item.limit}; "
        f"value {json.dumps(item.value, ensure_ascii=False)}; "
        f"hint {json.dumps(item.hint, ensure_ascii=False)}"
        for item in diagnostics
    ]
    die("\n".join(lines))


def _validate_static_authoring(
    source: ContentSource,
    declared: list[str],
    expanded: list[str],
    text_cap_rules: tuple[_TextCapRule, ...],
    *,
    allow_legacy_copy: bool,
) -> None:
    """Reject only authoring failures provable from literal source forms."""
    collector = _ContentIdCollector()
    collector.feed(source.content)
    counts: dict[str, int] = {}
    for value in collector.ids:
        counts[value] = counts.get(value, 0) + 1
    duplicates = [value for value, count in counts.items() if count > 1]
    if duplicates:
        die(f"duplicate literal id(s) in content slot: {duplicates}")

    tokens = _js_tokens(source.page_js)
    capabilities = set(expanded)
    capabilities.update(name for name in declared if name in COMPONENT_COMPAT_ASSETS)
    for index, token in enumerate(tokens):
        required = RENDER_COMPONENTS.get(token.value)
        if required and _is_direct_call(tokens, index) and required not in capabilities:
            die(
                f"{token.value}(...) requires component '{required}', but meta.components "
                "does not declare or resolve it"
            )

    if not allow_legacy_copy:
        _validate_text_caps(tokens, text_cap_rules)

    for selector in _literal_present_id_selectors(tokens):
        count = counts.get(selector[1:], 0)
        if count != 1:
            die(
                f"literal initPresent pick selector '{selector}' resolves to {count} "
                "content elements; expected exactly 1"
            )


def main() -> None:
    """Assemble a content source into a standalone explainer page.

    Reads the source path from ``sys.argv`` (via argparse), loads and
    validates the authored slots, resolves the requested style, theme,
    and components against the kit's own inventory, fills ``template.html``'s
    ``@inject`` markers, and writes the assembled ``.html``.

    Parameters
    ----------
    None
        Arguments are parsed from ``sys.argv``: ``source`` (required content
        source path), ``--out`` (optional output ``.html`` path; defaults
        to ``meta.output`` or ``<source-stem>-explainer.html``), ``--style``
        (override ``meta.style`` for one run), and ``--variants`` (assemble
        one output per named style for side-by-side review).

    Returns
    -------
    None
        The assembled files are written to disk as a side effect.

    Raises
    ------
    SystemExit
        Via :func:`die` (exit code 1) on any validation failure — missing
        source, unparseable ``meta`` JSON, missing required meta keys,
        unknown style/theme/component, a ``<script>`` in the content slot, a
        missing vendored Motion build, or a metadata-derived output path outside
        the project — and via ``argparse`` on malformed CLI arguments.

    Notes
    -----
    Call flow::

        main()
          ├─ _parse_args()
          ├─ _extract_slots()              # content plus optional authoring, as a ContentSource
          ├─ _validate_recipe_and_style()
          ├─ _validate_simulation()
          └─ assemble_once()               # once, or once per --variants style (via _assemble_variants())
               ├─ _build_app_sketch_page()  or  _build_explainer_page()
               │    └─ read_kit_file()          # styles/, components/, VERSION
               └─ validate_under_cwd()          # output path confinement

    Examples
    --------
    >>> import sys
    >>> sys.argv = ["assemble.py", "explainers/_sources/<topic>.html"]
    >>> main()  # doctest: +SKIP
    """
    args = _parse_args()

    src_path = Path(args.source)
    if not src_path.is_file():
        die(f"source not found: {src_path}")
    src = src_path.read_text(encoding="utf-8")

    source = _extract_slots(src_path, src)
    recipe = _validate_recipe_and_style(source.meta, args)
    _validate_simulation(source.meta, recipe)

    if args.legacy_copy_compat and (args.variants or args.settle or recipe != "explainer"):
        die("--legacy-copy-compat applies only to one explainer upgrade")

    if args.settle:
        if args.variants or args.style:
            die("--settle is exclusive: it already names the winning style")
        _settle_variants(source, recipe, args)
        return

    if args.variants:
        _assemble_variants(source, recipe, args)
        return

    if args.legacy_copy_compat:
        source.meta["_legacy_copy_compat"] = True
    out = resolve_out(args.out, source.meta, src_path, recipe)
    assemble_once(source, recipe, out, out_is_cli=bool(args.out))


def _parse_args() -> argparse.Namespace:
    """Parse assemble.py's CLI arguments (source, --out, --style, --variants)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("source", help="content source file (see .factory/skills/explainer/README.md)")
    ap.add_argument(
        "--out",
        help="output .html path (default: from meta.output, else <source-stem>-explainer.html; <source-stem>-sketch.html for app-sketch, next to src/)",
    )
    ap.add_argument(
        "--style",
        help="override meta.style for this run (explainer recipe only) — try a look without editing the source",
    )
    ap.add_argument(
        "--variants",
        help="comma-separated styles (e.g. keynote,playful) — assemble one output per style, suffixed -<style>, then compare them with review.py",
    )
    ap.add_argument(
        "--settle",
        metavar="STYLE",
        help="apply a review verdict: assemble STYLE to the canonical output name, then delete the -<style> candidate pages this source produced (deterministic cleanup — never hand-delete)",
    )
    ap.add_argument(
        "--legacy-copy-compat",
        action="store_true",
        help="preserve over-limit copy during an explicit Studio upgrade recovery",
    )
    return ap.parse_args()


def _validate_page_js_syntax(page_js: str, src_path: Path) -> None:
    """Best-effort JavaScript syntax check on the page-js slot.

    Uses ``node --check`` when available to catch syntax errors before the
    assembled page silently renders blank. When node is not installed, the
    check is skipped — the assembler remains stdlib-only Python.

    Parameters
    ----------
    page_js : str
        The extracted page-js slot text.
    src_path : Path
        The content source path, used in the error message for context.
    """
    if not page_js.strip():
        return
    node = shutil.which("node")
    if node is None:
        return
    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as tmp:
        tmp.write(page_js)
        tmp_path = tmp.name
    try:
        result = subprocess.run(
            [node, "--check", tmp_path],
            capture_output=True,
            check=False,  # a non-zero exit IS the finding; die() reports it below
            text=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, OSError):
        return
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    if result.returncode != 0:
        stderr = result.stderr.strip()
        for path in (str(Path(tmp_path).resolve()), tmp_path):
            stderr = stderr.replace(path, "page-js slot")
        die(
            f"page-js slot has a JavaScript syntax error in {src_path}"
            f" (line numbers are within the page-js slot):\n{stderr}"
        )


def _extract_slots(src_path: Path, src: str) -> ContentSource:
    """Extract source slots and validate the shared meta fields.

    Parameters
    ----------
    src_path : Path
        The content source's path, carried through on the returned
        :class:`ContentSource` (embedded in the kit stamp downstream).
    src : str
        The full content-source file's text.

    Returns
    -------
    ContentSource
        The parsed, minimally-validated slots.
    """
    meta_raw = extract_slot(src, r'<script[^>]*data-slot="meta"[^>]*>(.*?)</script>', "meta")
    try:
        meta = json.loads(meta_raw)
    except json.JSONDecodeError as e:
        die(f"meta JSON does not parse: {e}")
    content = extract_content_slot(src)
    page_css = extract_slot(
        src, r'<style[^>]*data-slot="page-css"[^>]*>(.*?)</style>', "page-css", required=False
    )
    page_js = extract_slot(
        src, r'<script[^>]*data-slot="page-js"[^>]*>(.*?)</script>', "page-js", required=False
    )
    try:
        manifest = extract_authoring_manifest(src)
    except ManifestError as exc:
        die(str(exc))

    if "<script" in content.lower():
        die("the content slot must not contain <script> tags — put JS in the page-js slot")
    page_js_literals = "\n".join(_js_string_fragments(page_js))
    if re.search(r"<\s*/?\s*button\b|data-term\s*=", page_js_literals, re.IGNORECASE):
        die(
            "the page-js slot must not contain authored <button> or data-term markup — "
            "component data is plain text; put glossary buttons in the content slot"
        )
    _validate_page_js_syntax(page_js, src_path)
    if not isinstance(meta, dict):
        die("meta must be a JSON object")
    if "_legacy_copy_compat" in meta:
        die("meta._legacy_copy_compat is reserved; use --legacy-copy-compat")
    if not isinstance(meta.get("title"), str) or not meta["title"].strip():
        die("meta.title is required and must be a non-empty string")
    if "output" in meta and not isinstance(meta.get("output"), str):
        die("meta.output must be a string when present")
    return ContentSource(
        meta=meta,
        content=content,
        page_css=page_css,
        page_js=page_js,
        authoring=manifest,
        src_path=src_path,
        raw=src,
    )


def _validate_recipe_and_style(meta: dict[str, Any], args: argparse.Namespace) -> str:
    """Validate `meta`'s recipe against the ``--style``/``--variants`` flags.

    Applies ``args.style`` into ``meta["style"]`` in place when given.

    Parameters
    ----------
    meta : dict[str, Any]
        The parsed ``meta`` slot; mutated in place when ``args.style`` is set.
    args : argparse.Namespace
        The parsed CLI arguments (``style``, ``variants``).

    Returns
    -------
    str
        The resolved recipe name.
    """
    recipe = meta.get("recipe", "explainer")
    if recipe not in RECIPES:
        die(f"unknown recipe '{recipe}' — available: {', '.join(RECIPES)}")

    if args.style and args.variants:
        die("--style and --variants are mutually exclusive — --variants already names its styles")
    if recipe == "app-sketch" and (args.style or args.variants):
        die(
            "--style/--variants apply to the explainer recipe only — app-sketch has its own app-shell theme"
        )
    if args.style:
        if args.style not in STYLES:
            die(f"unknown style '{args.style}' — available: {', '.join(STYLES)}")
        meta["style"] = args.style

    # app-sketch does not use the explainer style system (keynote/playful);
    # it has its own app-shell theme via base/app-shell.css. With --variants the
    # style comes per-variant, so meta.style may be absent.
    if recipe != "app-sketch" and not args.variants and not meta.get("style"):
        die("meta.style is required")
    return recipe


def _validate_simulation(meta: dict[str, Any], recipe: str) -> None:
    """Validate ``meta.simulation``, required only for recipe ``"app-sketch"``."""
    if recipe != "app-sketch":
        return
    simulation = meta.get("simulation")
    if not isinstance(simulation, dict):
        die("meta.simulation is required for recipe 'app-sketch'")
    for key in ("fidelity", "data", "network", "scenario"):
        if not isinstance(simulation.get(key), str) or not simulation[key].strip():
            die(f"meta.simulation.{key} is required for recipe 'app-sketch'")
    if simulation["data"] != "synthetic":
        die("meta.simulation.data must be 'synthetic' for recipe 'app-sketch'")
    if simulation["network"] != "none":
        die("meta.simulation.network must be 'none' for recipe 'app-sketch'")


def _assemble_variants(source: ContentSource, recipe: str, args: argparse.Namespace) -> None:
    """Assemble one output per ``--variants`` style, then print the compare hint."""
    styles = [s.strip() for s in args.variants.split(",") if s.strip()]
    if len(styles) < MIN_VARIANTS:
        die("--variants needs at least two comma-separated styles (e.g. keynote,playful)")
    duplicates = [s for s in dict.fromkeys(styles) if styles.count(s) > 1]
    if duplicates:
        die(f"duplicate style(s) in --variants: {duplicates}")
    unknown_styles = [s for s in styles if s not in STYLES]
    if unknown_styles:
        die(f"unknown style(s) {unknown_styles} — available: {', '.join(STYLES)}")
    base_out = resolve_out(args.out, source.meta, source.src_path, recipe)
    outputs: list[Path] = []
    for style_name in styles:
        variant_source = dataclass_replace(source, meta={**source.meta, "style": style_name})
        variant_out = base_out.with_name(f"{base_out.stem}-{style_name}{base_out.suffix}")
        outputs.append(
            assemble_once(
                variant_source,
                recipe,
                variant_out,
                out_is_cli=bool(args.out),
                show_hints=False,
            )
        )
    review_script = KIT / "review.py"
    try:
        review_cmd = review_script.relative_to(Path.cwd())
    except ValueError:
        review_cmd = review_script
    print("hint: this is a first share — keep iterating by asking for changes in plain language")
    print(
        "compare the variants in a browser (A/B flip, pinned comments, design tuner, winner pick):"
    )
    print(f"  python3 {review_cmd.as_posix()} " + " ".join(o.as_posix() for o in outputs))


def _settle_variants(source: ContentSource, recipe: str, args: argparse.Namespace) -> None:
    """Apply a review verdict: assemble the winner canonically, delete the candidates.

    Clicking Prefer in the review overlay only records a verdict — no browser
    click may destroy files. This is the deterministic other half: the winning
    style is assembled under the canonical output name, and every sibling
    ``-<style>`` candidate page is deleted *only* when it is provably ours
    (kit-stamped, explainer recipe, matching style suffix, same source file).
    Anything that merely looks like a candidate is kept, with the reason printed.

    Parameters
    ----------
    source : ContentSource
        The parsed content-source slots the candidates were assembled from.
    recipe : str
        The validated recipe; only ``explainer`` has styles to settle.
    args : argparse.Namespace
        Parsed CLI arguments (``settle`` holds the winning style; ``out``
        must match the ``--out`` the ``--variants`` run used, if any).
    """
    if recipe != "explainer":
        die("--settle applies to the explainer recipe only")
    winner = args.settle.strip()
    if winner not in STYLES:
        die(f"unknown style {winner!r} — available: {', '.join(STYLES)}")
    settled = dataclass_replace(source, meta={**source.meta, "style": winner})
    out = resolve_out(args.out, settled.meta, source.src_path, recipe)
    assemble_once(settled, recipe, out, out_is_cli=bool(args.out), show_hints=False)
    removed = 0
    for style_name in STYLES:
        candidate = out.with_name(f"{out.stem}-{style_name}{out.suffix}")
        if not candidate.is_file():
            continue
        reason = _candidate_mismatch(candidate, style_name, source.src_path)
        if reason:
            print(f"kept {candidate.name} — {reason}")
            continue
        candidate.unlink()
        removed += 1
        print(f"settled: removed candidate {candidate.name}")
    print(f"settled on {winner}: {out.as_posix()} is the page ({removed} candidate(s) removed)")


def _candidate_mismatch(candidate: Path, style_name: str, src_path: Path) -> str | None:
    """Explain why a candidate page must be kept, or return None when provably ours.

    Parameters
    ----------
    candidate : Path
        A file matching the ``<out-stem>-<style><suffix>`` candidate naming.
    style_name : str
        The style its filename suffix claims.
    src_path : Path
        The content source being settled; the candidate's stamp must point at
        this same source (by resolved path when the stamped path resolves,
        else by filename).

    Returns
    -------
    str or None
        A human-readable reason to keep the file, or None when every stamp
        field matches and deleting it is safe.
    """
    try:
        html = candidate.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return f"unreadable ({exc})"
    stamp = re.search(r"assembled by \.factory/skills/explainer[^<\n]*", html)
    if not stamp:
        return "no kit stamp — not an assembled explainer page"
    fields = dict(re.findall(r"(recipe|style|source)=([^\s·]+)", stamp.group(0)))
    if fields.get("recipe") != "explainer":
        return "stamped with a different recipe"
    if fields.get("style") != style_name:
        return "stamp style does not match its filename suffix"
    stamped_source = Path(fields.get("source", ""))
    reason = None
    if stamped_source.name != src_path.name:
        reason = "stamped from a different source"
    elif (
        stamped_source.parts
        and stamped_source.exists()
        and (stamped_source.resolve() != src_path.resolve())
    ):
        # a stamped path that resolves must point at THIS source, not a
        # same-named file in another directory
        reason = "stamped from a same-named source in another directory"
    return reason


def resolve_out(out_arg: str | None, meta: dict[str, Any], src_path: Path, recipe: str) -> Path:
    """Resolve the output ``.html`` path for one assembly.

    Precedence: CLI ``--out``, else ``meta.output``, else a default next to
    the source's parent directory (matching the pre-``--variants`` behavior).

    Parameters
    ----------
    out_arg : str or None
        The parsed ``--out`` CLI argument, or None when not passed.
    meta : dict[str, Any]
        The parsed ``meta`` slot; only ``meta["output"]`` is read here.
    src_path : Path
        The content source path, used to derive the default output location.
    recipe : str
        ``"explainer"`` or ``"app-sketch"`` — picks the default suffix
        (``-explainer.html`` vs. ``-sketch.html``).

    Returns
    -------
    Path
        The resolved output path (not yet validated or written).
    """
    if out_arg:
        return Path(out_arg)
    if meta.get("output"):
        return Path(meta["output"])
    suffix = "sketch" if recipe == "app-sketch" else "explainer"
    return src_path.parent.parent / f"{src_path.stem}-{suffix}.html"


def _build_app_sketch_page(
    source: ContentSource, version: str
) -> tuple[str, dict[str, str], set[str]]:
    """Build the app-sketch recipe's template HTML, marker replacements, and page markers.

    app-shell template, no Present mode / Motion / kit components.

    Returns
    -------
    tuple[str, dict[str, str], set[str]]
        ``(html, replacements, page_markers)`` — see :func:`assemble_once`.
    """
    meta, page_css, page_js = source.meta, source.page_css, source.page_js
    if meta.get("components"):
        die("meta.components is not used for recipe 'app-sketch' — remove it")
    if authoring_has_content(source.authoring):
        die("authoring edits are supported only by the explainer recipe")
    if "onSketchReset" not in page_js:
        die("app-sketch requires window.onSketchReset to be defined in the page-js slot")
    theme = meta.get("theme", "dark")
    if theme not in THEMES:
        die(f"unknown theme '{theme}' — available: {', '.join(THEMES)}")

    stamp = (
        f"assembled by .factory/skills/explainer v{version} · recipe=app-sketch"
        f" · theme={theme}"
        f" · source={source.src_path.as_posix()}"
    )

    simulation = cast("dict[str, object]", meta.get("simulation"))
    csp, disclosure = _sketch_csp_disclosure(simulation)

    html = read_kit_file("template-app.html")
    replacements = {
        "@TITLE@": html_escape(meta["title"]),
        "@THEME@": theme,
        "@RECIPE@": "app-sketch",
        "@CSP@": csp,
        "@KIT_STAMP@": html_escape(stamp),
        "/*@inject:APP_SHELL_CSS@*/": read_kit_file("base/app-shell.css"),
        "/*@inject:PAGE_CSS@*/": page_css,
        "<!--@inject:SIMULATION_DISCLOSURE@-->": disclosure,
        "<!--@inject:CONTENT@-->": source.content,
        "/*@inject:APP_SHELL_JS@*/": read_kit_file("base/app-shell.js"),
        "/*@inject:PAGE_JS@*/": page_js,
    }
    # app-sketch pages don't embed their source: the sketch CSP treats
    # every byte as attack surface and sketches are throwaway by design
    page_markers = PAGE_MARKERS - {
        "@STYLE@",
        "<!--@inject:SOURCE_EMBED@-->",
        "/*@inject:AUTHORING_JS@*/",
    }
    return html, replacements, page_markers


def _resolve_theme(meta: dict[str, Any], style_css: str) -> str:
    """Resolve the explainer recipe's theme: `meta.theme`, else the style's default."""
    theme = meta.get("theme")
    if not theme:
        m = re.search(r"default-theme:\s*(\w+)", style_css)
        theme = m.group(1) if m else "dark"
    if theme not in THEMES:
        die(f"unknown theme '{theme}' — available: {', '.join(THEMES)}")
    return theme


def _apply_migration(wanted: list[str]) -> list[str]:
    """Resolve retired declarations to current assets, preserving source data."""
    migrated: list[str] = []
    seen: set[str] = set()
    for component in wanted:
        compat_assets = COMPONENT_COMPAT_ASSETS.get(component)
        if compat_assets is not None:
            asset_note = (
                f"loading {', '.join(repr(asset) for asset in compat_assets)} for compatibility"
                if compat_assets
                else "using the built-in compatibility renderer"
            )
            print(
                f"note: component '{component}' was retired; {asset_note}"
                " — update the source to silence this"
            )
            for asset in compat_assets:
                if asset not in seen:
                    seen.add(asset)
                    migrated.append(asset)
            continue
        target = COMPONENT_ALIASES.get(component, component)
        if target != component:
            print(
                f"note: component '{component}' was renamed to '{target}'"
                " — update meta.components in the source to silence this"
            )
        if target not in seen:
            seen.add(target)
            migrated.append(target)
    return migrated


def _expand_with_deps(components: list[str]) -> list[str]:
    """Expand a component list with its dependencies (see COMPONENT_DEPENDENCIES), preserving order."""
    expanded: list[str] = []
    for component in components:
        for dep in COMPONENT_DEPENDENCIES.get(component, ()):
            if dep not in expanded:
                expanded.append(dep)
        if component not in expanded:
            expanded.append(component)
    return expanded


def _selected_text_caps_json(registry: dict[str, Any], expanded: list[str]) -> str:
    """Serialize the validated text-cap rules used by the selected component assets."""
    selected_components = set(expanded)
    selected = {
        "schema": registry["schema"],
        "rules": [
            rule
            for rule in cast("list[dict[str, Any]]", registry["rules"])
            if rule["component"] in selected_components
        ],
    }
    return (
        json.dumps(
            selected,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _resolve_components(
    wanted: object,
) -> tuple[list[str], str, str, tuple[_TextCapRule, ...]]:
    """Validate `meta.components`, migrate retired names, expand dependencies, load assets.

    Parameters
    ----------
    wanted : object
        ``meta.get("components", [])`` — validated here to actually be a
        list of known component names.

    Returns
    -------
    tuple[list[str], str, str, tuple[_TextCapRule, ...]]
        ``(expanded, comp_css, comp_js, text_cap_rules)`` — `expanded`
        includes every dependency (see :data:`COMPONENT_DEPENDENCIES`) ahead
        of the component that pulled it in; rules are filtered to that set.
    """
    if not isinstance(wanted, list):
        die(f"meta.components must be a list, got {type(wanted).__name__}: {wanted!r}")
    if not all(isinstance(component, str) for component in wanted):
        die(f"meta.components entries must be strings: {wanted!r}")
    migrated = _apply_migration(wanted)
    unknown = [c for c in migrated if c not in COMPONENTS]
    if unknown:
        die(f"unknown component(s) {unknown} — available: {', '.join(COMPONENTS)}")
    expanded = _expand_with_deps(migrated)
    registry, all_text_cap_rules = _load_text_caps_registry()
    text_cap_rules = tuple(rule for rule in all_text_cap_rules if rule.component in expanded)
    comp_css = "\n".join(read_kit_file(f"components/{c}.css") for c in expanded)
    comp_js = ""
    if expanded:
        injected = _selected_text_caps_json(registry, expanded)
        comp_js = f"globalThis.__kitInjectedTextCaps = {injected};\n"
        comp_js += read_kit_file("components/_core.js") + "\n"
        comp_js += "\n".join(read_kit_file(f"components/{c}.js") for c in expanded)
    return expanded, comp_css, comp_js, text_cap_rules


def _newest_motion_build() -> Path:
    """Return the highest-versioned vendored Motion build, or die() if none exist."""
    motion = (KIT / "vendor").glob("motion-*.min.js")
    motion_files = sorted(motion, key=motion_version_key)
    if not motion_files:
        die("no vendored Motion build found in vendor/")
    return motion_files[-1]


def _build_explainer_page(
    source: ContentSource, version: str
) -> tuple[str, dict[str, str], set[str]]:
    """Build the explainer recipe's template HTML, marker replacements, and page markers.

    Full kit: style tokens, components, Present mode, zoom, Motion.

    Returns
    -------
    tuple[str, dict[str, str], set[str]]
        ``(html, replacements, page_markers)`` — see :func:`assemble_once`.
    """
    meta, page_css, page_js = source.meta, source.page_css, source.page_js
    allow_legacy_copy = meta.get("_legacy_copy_compat") is True
    style = meta["style"]
    if style not in STYLES:
        die(f"unknown style '{style}' — available: {', '.join(STYLES)}")
    style_css = read_kit_file(f"styles/{style}.css")
    theme = _resolve_theme(meta, style_css)
    wanted = meta.get("components", [])
    # Inserted Studio slides can use a renderer absent from the original source
    # declaration. Resolve only their allowlisted assets; no manifest string is
    # ever treated as a path or an asset name.
    authoring_assets = authoring_component_assets(source.authoring)
    requested = wanted + authoring_assets if isinstance(wanted, list) else wanted
    expanded, comp_css, comp_js, text_cap_rules = _resolve_components(requested)
    if allow_legacy_copy:
        comp_js = "globalThis.__kitLegacyComponentCompat = true;\n" + comp_js
    _validate_static_authoring(
        source,
        cast("list[str]", wanted),
        expanded,
        text_cap_rules,
        allow_legacy_copy=allow_legacy_copy,
    )
    motion_file = _newest_motion_build()
    motion_js = motion_file.read_text(encoding="utf-8")

    stamp = (
        f"assembled by .factory/skills/explainer v{version} · recipe=explainer"
        f" · style={style} · theme={theme}"
        f" · components=[{','.join(wanted)}] · source={source.src_path.as_posix()}"
        f" · motion={motion_file.name}" + (" · copy=legacy-compatible" if allow_legacy_copy else "")
    )

    html = read_kit_file("template.html")
    replacements = {
        "@TITLE@": html_escape(meta["title"]),
        "@THEME@": theme,
        "@STYLE@": style,
        "@RECIPE@": "explainer",
        "@CSP@": "",
        "@KIT_STAMP@": html_escape(stamp),
        "/*@inject:STYLE_TOKENS@*/": style_css,
        "/*@inject:BASE_CSS@*/": read_kit_file("base/base.css"),
        "/*@inject:COMPONENTS_CSS@*/": comp_css,
        "/*@inject:PRESENT_CSS@*/": read_kit_file("base/present.css"),
        "/*@inject:ZOOM_CSS@*/": read_kit_file("base/zoom.css"),
        "/*@inject:PAGE_CSS@*/": page_css,
        "<!--@inject:SIMULATION_DISCLOSURE@-->": "",
        "<!--@inject:CONTENT@-->": source.content,
        "/*@inject:MOTION_JS@*/": motion_js,
        "/*@inject:APP_JS@*/": read_kit_file("base/app.js"),
        "/*@inject:COMPONENTS_JS@*/": comp_js,
        "/*@inject:COMPAT_JS@*/": read_kit_file("base/compat.js"),
        "/*@inject:PRESENT_JS@*/": read_kit_file("base/present.js"),
        "/*@inject:ZOOM_JS@*/": read_kit_file("base/zoom.js"),
        "/*@inject:PAGE_JS@*/": page_js,
        "/*@inject:AUTHORING_JS@*/": (
            "globalThis.__explainerAuthoring = "
            + json.dumps(source.authoring, ensure_ascii=False, separators=(",", ":")).replace(
                "</", "<\\/"
            )
            + ";\n"
            + read_kit_file("base/authoring.js")
            if authoring_has_content(source.authoring)
            else ""
        ),
        "<!--@inject:SOURCE_EMBED@-->": embed_source(source.raw),
    }
    return html, replacements, PAGE_MARKERS


def assemble_once(
    source: ContentSource,
    recipe: str,
    out: Path,
    *,
    out_is_cli: bool,
    show_hints: bool = True,
) -> Path:
    """Fill the recipe's template with one style/theme/component set and write ``out``.

    Extracted from :func:`main` so ``--variants`` can assemble the same content
    once per style. Recipe- and simulation-level validation already happened in
    ``main``; this function validates only what varies per assembly (style,
    theme, components) and performs the template fill, write, and per-file
    reporting. The recipe-specific template/replacements/markers come from
    :func:`_build_app_sketch_page` or :func:`_build_explainer_page`.

    Parameters
    ----------
    source : ContentSource
        The parsed content-source slots (already recipe-validated by the
        caller); for ``--variants``, one style-specialized copy per style.
    recipe : str
        ``"explainer"`` or ``"app-sketch"``; picks the template and asset set.
    out : Path
        Where to write the assembled HTML.
    out_is_cli : bool
        True when `out` came directly from ``--out`` (a deliberate user
        choice, so it is exempt from the under-cwd confinement check that
        applies to agent-authored ``meta.output`` paths).
    show_hints : bool, optional
        Print the "keep iterating" / showcase-link hints after writing
        (default True). ``--variants`` passes False and prints its own
        combined hint once, after all variants are written.

    Returns
    -------
    Path
        `out`, unchanged — returned so callers can collect it.
    """
    version = read_kit_file("VERSION").strip()

    if recipe == "app-sketch":
        html, replacements, page_markers = _build_app_sketch_page(source, version)
    else:
        html, replacements, page_markers = _build_explainer_page(source, version)

    # Programmer invariant, not user input: PAGE_MARKERS is a hardcoded set
    # meant to mirror `replacements`' keys; a mismatch is a bug in this file,
    # never something a content source can trigger. Fine to strip under -O.
    assert page_markers <= replacements.keys(), (  # noqa: S101
        "PAGE_MARKERS references a marker not in replacements"
    )
    kit_bytes = 0
    for marker, value in replacements.items():
        if marker not in html:
            die(f"template is missing marker {marker}")
        if marker not in page_markers:
            kit_bytes += len(value)
        html = html.replace(marker, value)

    leftover = re.findall(r"@inject:\w+@", html)
    if leftover:
        die(f"unresolved template markers after assembly: {leftover}")

    # Agent-authored meta stays confined to the repo. An explicit CLI --out is
    # a direct user choice and may target /tmp for disposable verification.
    if not out_is_cli:
        validate_under_cwd(out, "output path")  # `out` itself stays relative/unresolved for display
    out.write_text(html, encoding="utf-8")

    authored = len(source.content) + len(source.page_css) + len(source.page_js)
    total = len(html)
    print(f"wrote {out}  ({total / 1024:.0f} KB)")

    print(
        f"reuse: {kit_bytes / 1024:.0f} KB assembled from the kit · {authored / 1024:.0f} KB authored "
        f"({100 * kit_bytes / max(kit_bytes + authored, 1):.0f}% of the page came from files, not generation)"
    )
    if show_hints:
        print(
            "hint: this is a first share — keep iterating by asking for changes in plain language"
        )
    return out


if __name__ == "__main__":
    main()
