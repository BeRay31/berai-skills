"""Validated, source-embedded deterministic edits for Explainer Studio.

The manifest deliberately contains only portable primitives.  It is inert in
the source file and can later map directly to a presentation scene graph.
"""

from __future__ import annotations

import json
import math
import re
import runpy
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

VERSION = 2
MAX_TEXT_ITEMS = 5_000
MAX_COMPONENTS = 200
MAX_SHAPES = 5_000
MAX_SLIDES = 100
MAX_SOURCE_SLIDES = 200
MAX_TEXT = 10_000
MAX_TARGET = 500
MAX_SETTINGS_BYTES = 200_000
MAX_SETTINGS_ENTRIES = 100
MAX_SETTINGS_KEY_CHARS = 200
MAX_PATH_POINTS = 400
MIN_PATH_POINT_ITEMS = 4
MAX_TOKENS = 6
MAX_PATH_TOTAL_POINTS = 200_000
MAX_TEXT_SHAPE_CHARS = 500_000
MAX_SHAPE_DEPTH = 16
MAX_MANIFEST_BYTES = 1_500_000
_SLOT_RE = re.compile(
    r'<script\b[^>]*\bdata-slot\s*=\s*(["\'])authoring\1[^>]*>(.*?)</script\s*>',
    re.IGNORECASE | re.DOTALL,
)
_SHAPE_TYPES = frozenset(("rect", "ellipse", "line", "arrow", "text", "group", "path"))
_IDENTIFIER_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,119}\Z")
_SLIDE_COMPONENTS = {
    "roadmap": "roadmap",
    "architecture": "architecture",
    "operating-model": "architecture",
    "sequence": "architecture",
    "erd": "architecture",
    "stack": "architecture",
    "trace": "trace",
    "chart": "chart",
    "flow": "flow",
    "table": "table",
    "tree": "tree",
    "loop": "loop",
    "stepper": "stepper",
    "code": "code",
    "iceberg": "iceberg",
    "pyramid": "pyramid",
}
_CANVAS_CODECS = {
    "architecture": "architecture_editor.py",
    "operating-model": "operating_model_editor.py",
}
_PAINT_RE = re.compile(
    r"(?:#[0-9a-fA-F]{3,8}|none|transparent|currentColor|rgba?\([0-9.%\s,]+\)|hsla?\([0-9.%\s,]+\))"
)


class ManifestError(ValueError):
    """The authoring block or request is not a supported manifest."""


def empty_manifest() -> dict[str, object]:
    """Return the empty current-version authoring manifest envelope."""
    return {
        "version": VERSION,
        "text": [],
        "tokens": {},
        "components": {},
        "shapes": [],
        "slides": [],
        "sourceSlides": [],
        "order": [],
    }


def _string(value: object, name: str, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or len(value) > limit:
        msg = f"{name} must be a string of at most {limit} characters"
        raise ManifestError(msg)
    return value


def _identifier(value: object, name: str) -> str:
    identifier = _string(value, name, 120)
    if not _IDENTIFIER_RE.fullmatch(identifier):
        msg = f"{name} must be a plain identifier"
        raise ManifestError(msg)
    return identifier


def _number(value: object, name: str, low: float = 0, high: float = 1) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        msg = f"{name} must be a finite number"
        raise ManifestError(msg)
    number = float(value)
    if not low <= number <= high:
        msg = f"{name} must be between {low:g} and {high:g}"
        raise ManifestError(msg)
    return number


def _json_value(value: object, name: str) -> object:
    """Accept JSON data only, with a bounded serialized representation."""
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (RecursionError, TypeError, ValueError) as exc:
        msg = f"{name} must contain JSON values"
        raise ManifestError(msg) from exc
    if len(encoded.encode("utf-8")) > MAX_SETTINGS_BYTES:
        msg = f"{name} is too large"
        raise ManifestError(msg)
    return json.loads(encoded)


def _json_object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    cleaned = _json_value(value, name)
    if not isinstance(cleaned, dict):  # Narrowing for the type checker and future edits.
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    return cleaned


def _paint_style(item: object, label: str) -> str:
    """Validate a local color, rejecting anything remote or scriptable."""
    paint = _string(item, label, 100)
    if not _PAINT_RE.fullmatch(paint):
        msg = f"{label} must be a local color"
        raise ManifestError(msg)
    return paint


def _font_family_style(item: object, label: str) -> str:
    """Validate a font name, rejecting markup delimiters."""
    family = _string(item, label, 100)
    if any(character in family for character in "<>;{}"):
        msg = f"{label} must be a local font name"
        raise ManifestError(msg)
    return family


def _font_weight_style(item: object, label: str) -> object:
    """Accept the CSS weight keywords or a bounded numeric weight."""
    if isinstance(item, str) and item in ("normal", "bold", "bolder", "lighter"):
        return item
    weight = int(item) if isinstance(item, str) and item.isdigit() else item
    return _number(weight, label, 100, 900)


def _choice_style(item: object, label: str, choices: tuple[str, ...], tail: str) -> object:
    """Accept one of a closed set of string values."""
    if item not in choices:
        msg = f"{label} must be {tail}"
        raise ManifestError(msg)
    return item


def _line_height_style(item: object, label: str) -> object:
    """Accept the ``normal`` keyword or a bounded multiplier."""
    if item == "normal":
        return item
    return _number(item, label, 0.5, 4)


def _boolean_style(item: object, label: str) -> bool:
    """Require a real boolean."""
    if not isinstance(item, bool):
        msg = f"{label} must be a boolean"
        raise ManifestError(msg)
    return item


_STYLE_RULES: dict[str, Callable[[object, str], object]] = {
    "fill": _paint_style,
    "stroke": _paint_style,
    "strokeWidth": partial(_number, low=0, high=100),
    "opacity": _number,
    "radius": partial(_number, low=0, high=100),
    "fontFamily": _font_family_style,
    "fontSize": partial(_number, low=6, high=192),
    "fontWeight": _font_weight_style,
    "fontStyle": partial(
        _choice_style, choices=("normal", "italic", "oblique"), tail="normal, italic, or oblique"
    ),
    "lineHeight": _line_height_style,
    "letterSpacing": partial(_number, low=-100, high=100),
    "textAlign": partial(
        _choice_style,
        choices=("left", "center", "right", "start", "end", "justify"),
        tail="a supported text alignment",
    ),
    "rotation": partial(_number, low=-3600, high=3600),
    "startArrow": _boolean_style,
    "endArrow": _boolean_style,
    "dash": _boolean_style,
    "strokeLinecap": partial(
        _choice_style,
        choices=("butt", "round", "square", "miter", "bevel", "arcs"),
        tail="a supported SVG line style",
    ),
    "strokeLinejoin": partial(
        _choice_style,
        choices=("butt", "round", "square", "miter", "bevel", "arcs"),
        tail="a supported SVG line style",
    ),
}


def _style(value: object, name: str) -> dict[str, object]:
    """Keep only the supported style keys, each validated by its own rule."""
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    return {
        key: _STYLE_RULES[key](item, f"{name}.{key}")
        for key, item in value.items()
        if key in _STYLE_RULES
    }


def _frame(value: object, name: str) -> dict[str, float]:
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    frame = {key: _number(value.get(key), f"{name}.{key}") for key in ("x", "y", "width", "height")}
    if frame["width"] == 0 or frame["height"] == 0:
        msg = f"{name} width and height must be greater than zero"
        raise ManifestError(msg)
    if frame["x"] + frame["width"] > 1 or frame["y"] + frame["height"] > 1:
        msg = f"{name} must fit within its normalized slide"
        raise ManifestError(msg)
    if "rotation" in value:
        frame["rotation"] = _number(value["rotation"], f"{name}.rotation", -3600, 3600)
    return frame


def _path_shape_fields(value: dict[str, object], name: str) -> dict[str, object]:
    """Validate the portable flat point list carried by freeform path shapes."""
    # ``points`` is the canonical field; accepting the short ``path``
    # alias keeps hand-authored v2 records readable without permitting raw
    # SVG path strings.
    points = value.get("points", value.get("path"))
    if (
        not isinstance(points, list)
        or len(points) < MIN_PATH_POINT_ITEMS
        or len(points) > MAX_PATH_POINTS
    ):
        msg = f"{name}.points must be a bounded flat list with at least two points"
        raise ManifestError(msg)
    if len(points) % 2:
        msg = f"{name}.points must contain x,y pairs"
        raise ManifestError(msg)
    fields: dict[str, object] = {
        "points": [
            _number(point, f"{name}.points[{point_index}]")
            for point_index, point in enumerate(points)
        ]
    }
    closed = value.get("closed", False)
    if not isinstance(closed, bool):
        msg = f"{name}.closed must be a boolean"
        raise ManifestError(msg)
    fields["closed"] = closed
    if "rotation" in value:
        fields["rotation"] = _number(value["rotation"], f"{name}.rotation", -3600, 3600)
    if "style" in value:
        fields["style"] = _style(value["style"], f"{name}.style")
    return fields


def _shape(value: object, index: int) -> dict[str, object]:
    name = f"shapes[{index}]"
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    shape_type = value.get("type")
    if shape_type not in _SHAPE_TYPES:
        msg = f"{name}.type must be one of {', '.join(sorted(_SHAPE_TYPES))}"
        raise ManifestError(msg)
    shape: dict[str, object] = {
        "id": _string(value.get("id"), f"{name}.id", 200),
        "slide": _string(value.get("slide"), f"{name}.slide", 200),
        "type": shape_type,
    }
    if "parent" in value:
        shape["parent"] = _string(value["parent"], f"{name}.parent", 200)
    shape["z"] = _integer(value.get("z", 0), f"{name}.z", -10_000, 10_000)
    if shape_type == "group":
        return shape
    if shape_type == "path":
        shape.update(_path_shape_fields(value, name))
        return shape
    shape["style"] = _style(value.get("style", {}), f"{name}.style")
    if shape_type in ("line", "arrow"):
        shape.update(
            {key: _number(value.get(key), f"{name}.{key}") for key in ("x1", "y1", "x2", "y2")}
        )
        if "rotation" in value:
            shape["rotation"] = _number(value["rotation"], f"{name}.rotation", -3600, 3600)
        return shape
    shape.update(_frame(value, name))
    if shape_type == "text" and "text" in value:
        shape["text"] = _string(value["text"], f"{name}.text")
    return shape


def _integer(value: object, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        msg = f"{name} must be an integer between {low} and {high}"
        raise ManifestError(msg)
    return value


def _token_entry(key: str, item: object) -> object:
    """Validate one design token; the token set is closed and shared."""
    if key == "font_pct":
        return _number(item, "tokens.font_pct", 85, 115)
    if key == "space_scale":
        return _number(item, "tokens.space_scale", 0.75, 1.35)
    if key == "measure":
        if item not in ("44ch", "52ch", "68ch"):
            msg = "tokens.measure must be 44ch, 52ch, or 68ch"
            raise ManifestError(msg)
        return item
    if key == "accent":
        return _style({"fill": item}, "tokens")["fill"]
    if key == "accent_mode":
        if item not in ("safe", "contrast"):
            msg = "tokens.accent_mode must be safe or contrast"
            raise ManifestError(msg)
        return item
    if key == "accent_preset":
        if item != "adyen":
            msg = "tokens.accent_preset must be adyen"
            raise ManifestError(msg)
        return item
    msg = f"tokens.{key} is not supported"
    raise ManifestError(msg)


def _tokens(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or len(value) > MAX_TOKENS:
        msg = "authoring.tokens must be a bounded object"
        raise ManifestError(msg)
    return {key: _token_entry(key, item) for key, item in value.items()}


def _canvas(kind: str, value: object, name: str) -> dict[str, object]:
    """Validate component-owned canvas records through their trusted codecs."""
    filename = _CANVAS_CODECS.get(kind)
    if filename is None:
        msg = f"{name} is supported only by architecture or operating-model"
        raise ManifestError(msg)
    codec_path = Path(__file__).resolve().parent / "components" / filename
    codec = runpy.run_path(str(codec_path)).get("_sanitize_record")
    if not callable(codec):  # Defensive: a broken local install must not accept data.
        msg = f"{name} validator is unavailable"
        raise ManifestError(msg)
    cleaned = codec(value)
    if not isinstance(cleaned, dict) or not cleaned:
        msg = f"{name} is not a valid {kind} canvas record"
        raise ManifestError(msg)
    return _json_object(cleaned, name)


def _component_canvas(value: object, name: str) -> dict[str, object]:
    """Validate a canvas edit whose source component supplies the renderer kind."""
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in _CANVAS_CODECS:
        choices = ", ".join(sorted(_CANVAS_CODECS))
        msg = f"{name}.kind must be one of {choices}"
        raise ManifestError(msg)
    return {
        "kind": kind,
        "record": _canvas(kind, value.get("record"), f"{name}.record"),
    }


def _slide(value: object, index: int) -> dict[str, object]:
    name = f"slides[{index}]"
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    raw_component = value.get("component")
    if not isinstance(raw_component, dict):
        msg = f"{name}.component must be an object"
        raise ManifestError(msg)
    kind = raw_component.get("kind")
    if not isinstance(kind, str) or kind not in _SLIDE_COMPONENTS:
        choices = ", ".join(sorted(_SLIDE_COMPONENTS))
        msg = f"{name}.component.kind must be one of {choices}"
        raise ManifestError(msg)
    data = _json_object(raw_component.get("data"), f"{name}.component.data")
    if "canvasEdits" in data:
        msg = f"{name}.component.data.canvasEdits must use component.canvas"
        raise ManifestError(msg)
    component: dict[str, object] = {"kind": kind, "data": data}
    if "settings" in raw_component:
        settings = _json_object(raw_component["settings"], f"{name}.component.settings")
        if len(settings) > MAX_SETTINGS_ENTRIES or any(
            len(key) > MAX_SETTINGS_KEY_CHARS for key in settings
        ):
            msg = f"{name}.component.settings has invalid keys"
            raise ManifestError(msg)
        component["settings"] = settings
    if "frame" in raw_component:
        component["frame"] = _frame(raw_component["frame"], f"{name}.component.frame")
    if "canvas" in raw_component:
        component["canvas"] = _canvas(kind, raw_component["canvas"], f"{name}.component.canvas")
    if "detached" in raw_component:
        component["detached"] = _detached(raw_component["detached"], f"{name}.component.detached")
    return {
        "id": _identifier(value.get("id"), f"{name}.id"),
        "before": _identifier(value.get("before"), f"{name}.before"),
        "title": _string(value.get("title"), f"{name}.title", 300),
        "component": component,
    }


def _source_slide(value: object, index: int) -> dict[str, object]:
    name = f"sourceSlides[{index}]"
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    hidden = value.get("hidden", False)
    if not isinstance(hidden, bool):
        msg = f"{name}.hidden must be a boolean"
        raise ManifestError(msg)
    return {
        "id": _identifier(value.get("id"), f"{name}.id"),
        "hidden": hidden,
    }


def _detached(value: object, name: str) -> dict[str, str]:
    if not isinstance(value, dict):
        msg = f"{name} must be an object"
        raise ManifestError(msg)
    root = _identifier(value.get("root"), f"{name}.root")
    return {"root": root}


def _check_shape_parents(shapes: list[dict[str, object]]) -> None:
    """Reject unknown, non-group, cross-slide, cyclic, or too-deep parents."""
    by_id = {shape["id"]: shape for shape in shapes}
    for shape in shapes:
        parent = shape.get("parent")
        if parent is None:
            continue
        parent_shape = by_id.get(parent)
        if parent_shape is None:
            msg = f"shape {shape['id']} references an unknown parent"
            raise ManifestError(msg)
        if parent_shape["type"] != "group":
            msg = f"shape {shape['id']} parent must be a group"
            raise ManifestError(msg)
        if parent_shape["slide"] != shape["slide"]:
            msg = f"shape {shape['id']} parent must be on the same slide"
            raise ManifestError(msg)

        seen: set[str] = set()
        current: object = shape
        depth = 0
        while isinstance(current, dict) and current.get("parent") is not None:
            current_id = current.get("id")
            if isinstance(current_id, str):
                if current_id in seen:
                    msg = "authoring shape parents must be acyclic"
                    raise ManifestError(msg)
                seen.add(current_id)
            depth += 1
            if depth > MAX_SHAPE_DEPTH:
                msg = "authoring shape nesting is too deep"
                raise ManifestError(msg)
            current = by_id.get(current.get("parent"))


def _check_detached_roots(
    shapes: list[dict[str, object]],
    slides: list[dict[str, object]],
    components: dict[str, object],
) -> None:
    """Require detached component roots to be unique, top-level groups."""
    by_id = {shape["id"]: shape for shape in shapes}
    detached_roots: set[str] = set()

    def detached_root(component: object, expected_slide: str | None, name: str) -> None:
        if not isinstance(component, dict) or "detached" not in component:
            return
        detached = component["detached"]
        root = detached["root"]
        root_shape = by_id.get(root)
        if root_shape is None or root_shape["type"] != "group":
            msg = f"{name}.detached.root must name a group shape"
            raise ManifestError(msg)
        if root_shape.get("parent") is not None:
            msg = f"{name}.detached.root must be a top-level group"
            raise ManifestError(msg)
        if root in detached_roots:
            msg = "detached component roots must be unique"
            raise ManifestError(msg)
        detached_roots.add(root)
        if expected_slide is not None and root_shape["slide"] != expected_slide:
            msg = f"{name}.detached.root must belong to its component slide"
            raise ManifestError(msg)

    for slide in slides:
        component = slide["component"]
        detached_root(component, f"ea-slide-{slide['id']}", f"slides.{slide['id']}.component")
    for identity, component in components.items():
        # A source component identity does not reliably encode its slide. The
        # shape tree already keeps every child on its root's slide; unique,
        # top-level roots prevent ownership overlap without guessing a host id.
        detached_root(component, None, f"components.{identity}")


def _validate_shape_tree(
    shapes: list[dict[str, object]],
    slides: list[dict[str, object]],
    components: dict[str, object],
) -> None:
    """Enforce the shape budget, the parent tree, and detached-root ownership."""
    path_points = 0
    text_chars = 0
    for shape in shapes:
        points = shape.get("points")
        text = shape.get("text")
        if shape["type"] == "path" and isinstance(points, list):
            path_points += len(points)
        if shape["type"] == "text" and isinstance(text, str):
            text_chars += len(text)
    if path_points > MAX_PATH_TOTAL_POINTS:
        msg = "authoring path points are too numerous"
        raise ManifestError(msg)
    if text_chars > MAX_TEXT_SHAPE_CHARS:
        msg = "authoring shape text is too large"
        raise ManifestError(msg)
    _check_shape_parents(shapes)
    _check_detached_roots(shapes, slides, components)


def _sanitize_text(value: dict[str, object]) -> list[dict[str, str]]:
    """Validate the bounded text replacement list."""
    text = value.get("text", [])
    if not isinstance(text, list) or len(text) > MAX_TEXT_ITEMS:
        msg = "authoring.text must be a bounded list"
        raise ManifestError(msg)
    cleaned = [
        {
            "target": _string(item.get("target"), f"text[{index}].target", MAX_TARGET),
            "before": _string(item.get("before"), f"text[{index}].before"),
            "value": _string(item.get("value"), f"text[{index}].value"),
        }
        for index, item in enumerate(text)
        if isinstance(item, dict)
    ]
    if len(cleaned) != len(text):
        msg = "authoring.text entries must be objects"
        raise ManifestError(msg)
    return cleaned


def _component_entry(identity: str, item: dict[str, object]) -> dict[str, object]:
    """Validate one source component override record."""
    settings = item.get("settings", {})
    if not isinstance(settings, dict):
        msg = f"components.{identity}.settings must be an object"
        raise ManifestError(msg)
    if len(settings) > MAX_SETTINGS_ENTRIES or any(
        not isinstance(key, str) or len(key) > MAX_SETTINGS_KEY_CHARS for key in settings
    ):
        msg = f"components.{identity}.settings has invalid keys"
        raise ManifestError(msg)
    cleaned: dict[str, object] = {
        "settings": _json_value(settings, f"components.{identity}.settings")
    }
    kind = item.get("kind")
    data = item.get("data")
    if kind is not None or data is not None:
        if not isinstance(kind, str) or kind not in _SLIDE_COMPONENTS:
            choices = ", ".join(sorted(_SLIDE_COMPONENTS))
            msg = f"components.{identity}.kind must be one of {choices}"
            raise ManifestError(msg)
        cleaned["kind"] = kind
        clean_data = _json_object(data, f"components.{identity}.data")
        if "canvasEdits" in clean_data:
            msg = f"components.{identity}.data.canvasEdits must use component.canvas"
            raise ManifestError(msg)
        cleaned["data"] = clean_data
    if "frame" in item:
        cleaned["frame"] = _frame(item["frame"], f"components.{identity}.frame")
    if "canvas" in item:
        cleaned["canvas"] = _component_canvas(item["canvas"], f"components.{identity}.canvas")
    if "detached" in item:
        cleaned["detached"] = _detached(item["detached"], f"components.{identity}.detached")
    return cleaned


def _sanitize_components(value: dict[str, object]) -> dict[str, object]:
    """Validate the bounded component override map."""
    components = value.get("components", {})
    if not isinstance(components, dict) or len(components) > MAX_COMPONENTS:
        msg = "authoring.components must be a bounded object"
        raise ManifestError(msg)
    cleaned: dict[str, object] = {}
    for identity, item in components.items():
        if not isinstance(identity, str) or not isinstance(item, dict):
            msg = "authoring.components entries must be keyed objects"
            raise ManifestError(msg)
        cleaned[_string(identity, "component identity", 500)] = _component_entry(identity, item)
    return cleaned


def _sanitize_shapes(value: dict[str, object]) -> list[dict[str, object]]:
    """Validate the bounded shape list and its unique ids."""
    shapes = value.get("shapes", [])
    if not isinstance(shapes, list) or len(shapes) > MAX_SHAPES:
        msg = "authoring.shapes must be a bounded list"
        raise ManifestError(msg)
    cleaned = [_shape(item, index) for index, item in enumerate(shapes)]
    if len({shape["id"] for shape in cleaned}) != len(cleaned):
        msg = "authoring.shapes ids must be unique"
        raise ManifestError(msg)
    if sum(shape["type"] == "text" for shape in cleaned) > MAX_TEXT_ITEMS:
        msg = "authoring text shapes are too numerous"
        raise ManifestError(msg)
    return cleaned


def _sanitize_slides(value: dict[str, object]) -> list[dict[str, object]]:
    """Validate the bounded inserted-slide list and its unique ids."""
    slides = value.get("slides", [])
    if not isinstance(slides, list) or len(slides) > MAX_SLIDES:
        msg = "authoring.slides must be a bounded list"
        raise ManifestError(msg)
    cleaned = [_slide(item, index) for index, item in enumerate(slides)]
    if len({slide["id"] for slide in cleaned}) != len(cleaned):
        msg = "authoring.slides ids must be unique"
        raise ManifestError(msg)
    return cleaned


def _sanitize_source_slides(value: dict[str, object]) -> list[dict[str, object]]:
    """Validate the bounded source-slide visibility list and its unique ids."""
    source_slides = value.get("sourceSlides", [])
    if not isinstance(source_slides, list) or len(source_slides) > MAX_SOURCE_SLIDES:
        msg = "authoring.sourceSlides must be a bounded list"
        raise ManifestError(msg)
    cleaned = [_source_slide(item, index) for index, item in enumerate(source_slides)]
    if len({slide["id"] for slide in cleaned}) != len(cleaned):
        msg = "authoring.sourceSlides ids must be unique"
        raise ManifestError(msg)
    return cleaned


def _sanitize_order(
    value: dict[str, object],
    source_slides: list[dict[str, object]],
    slides: list[dict[str, object]],
) -> list[str]:
    """Validate the bounded order and its coverage of the declared slides."""
    order = value.get("order", [])
    if not isinstance(order, list) or len(order) > MAX_SOURCE_SLIDES + MAX_SLIDES:
        msg = "authoring.order must be a bounded list"
        raise ManifestError(msg)
    identifiers = [_identifier(item, f"order[{index}]") for index, item in enumerate(order)]
    if len(set(identifiers)) != len(identifiers):
        msg = "authoring.order ids must be unique"
        raise ManifestError(msg)
    source_ids = {slide["id"] for slide in source_slides}
    inserted_ids = {f"ea-slide-{slide['id']}" for slide in slides}
    if source_ids & inserted_ids:
        msg = "source and inserted slide ids must not collide"
        raise ManifestError(msg)
    if set(identifiers) - source_ids - inserted_ids:
        msg = "authoring.order must refer to declared slides"
        raise ManifestError(msg)
    return identifiers


def sanitize_manifest(value: object) -> dict[str, object]:
    """Migrate version 1, then validate the current manifest contract."""
    if not isinstance(value, dict) or value.get("version") not in (1, VERSION):
        msg = f"authoring.version must be 1 or {VERSION}"
        raise ManifestError(msg)
    # v1 had the same portable fields but no scene groups or paths. Copying the
    # envelope makes the migration explicit and avoids mutating caller data.
    value = {**value, "version": VERSION}
    result = empty_manifest()
    result["text"] = _sanitize_text(value)
    result["tokens"] = _tokens(value.get("tokens", {}))
    components = _sanitize_components(value)
    shapes = _sanitize_shapes(value)
    slides = _sanitize_slides(value)
    source_slides = _sanitize_source_slides(value)
    result["components"] = components
    result["shapes"] = shapes
    result["slides"] = slides
    result["sourceSlides"] = source_slides
    result["order"] = _sanitize_order(value, source_slides, slides)
    _validate_shape_tree(shapes, slides, components)
    manifest_size = len(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    if manifest_size > MAX_MANIFEST_BYTES:
        msg = f"authoring manifest exceeds the {MAX_MANIFEST_BYTES}-byte save limit"
        raise ManifestError(msg)
    return result


def has_content(manifest: dict[str, object]) -> bool:
    """Report whether the manifest carries any authored content at all."""
    return any(
        bool(manifest[key])
        for key in ("text", "tokens", "components", "shapes", "slides", "sourceSlides", "order")
    )


def component_assets(manifest: dict[str, object]) -> list[str]:
    """Return assets needed by inserted slides and source component overrides."""
    assets: list[str] = []
    slides = manifest.get("slides", [])
    if not isinstance(slides, list):
        return assets
    components = [slide.get("component") for slide in slides if isinstance(slide, dict)]
    overrides = manifest.get("components", {})
    if isinstance(overrides, dict):
        components.extend(overrides.values())
    for component in components:
        if not isinstance(component, dict):
            continue
        kind = component.get("kind")
        asset = _SLIDE_COMPONENTS.get(kind) if isinstance(kind, str) else None
        if asset and asset not in assets:
            assets.append(asset)
        data = component.get("data")
        if (
            kind == "chart"
            and isinstance(data, dict)
            and data.get("kind") == "map"
            and "geo-world" not in assets
        ):
            assets.append("geo-world")
    return assets


def extract_manifest(source: str) -> dict[str, object]:
    """Return the optional sanitized source slot; reject duplicate slots."""
    matches = list(_SLOT_RE.finditer(source))
    if not matches:
        return empty_manifest()
    if len(matches) != 1:
        msg = "content source has more than one authoring slot"
        raise ManifestError(msg)
    try:
        raw = json.loads(matches[0].group(2))
    except json.JSONDecodeError as exc:
        msg = f"authoring JSON does not parse: {exc}"
        raise ManifestError(msg) from exc
    return sanitize_manifest(raw)


def upsert_manifest(source: str, manifest: dict[str, object]) -> str:
    """Replace the optional managed slot without touching authored slots."""
    sanitized = sanitize_manifest(manifest)
    matches = list(_SLOT_RE.finditer(source))
    if len(matches) > 1:
        msg = "content source has more than one authoring slot"
        raise ManifestError(msg)
    block = (
        '<script type="application/json" data-slot="authoring">\n'
        + json.dumps(sanitized, ensure_ascii=False, indent=2).replace("</", "<\\/")
        + "\n</script>"
    )
    if matches:
        return source[: matches[0].start()] + block + source[matches[0].end() :]
    suffix = "" if source.endswith("\n") else "\n"
    return source + suffix + "\n" + block + "\n"
