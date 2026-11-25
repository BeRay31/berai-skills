"""Server validation for operating-model structural edits."""

from __future__ import annotations

import re


def _fields(
    raw: object, limits: dict[str, int], required: tuple[str, ...] = ()
) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    result: dict[str, str] = {}
    for key, limit in limits.items():
        if key not in raw:
            if key in required:
                return None
            continue
        value = raw[key]
        if (
            not isinstance(value, str)
            or len(value) > limit
            or (key in required and not value.strip())
        ):
            return None
        result[key] = value
    return result


def _rows(
    raw: object, limits: dict[str, int], required: tuple[str, ...], minimum: int, maximum: int
) -> list[dict[str, str]] | None:
    if not isinstance(raw, list) or not minimum <= len(raw) <= maximum:
        return None
    parsed = [_fields(item, limits, required) for item in raw]
    if any(item is None for item in parsed):
        return None
    clean = [item for item in parsed if item is not None]
    if "id" in required and len({item["id"] for item in clean}) != len(clean):
        return None
    return clean


def _states(raw: object) -> list[dict[str, str]] | None:
    states = _rows(
        raw, {"id": 120, "label": 24, "tone": 12, "color": 7}, ("id", "label", "tone"), 2, 5
    )
    if states is None:
        return None
    tones = {"neutral", "accent", "violet", "success", "warning"}
    if any(
        state["tone"] not in tones
        or ("color" in state and not re.fullmatch(r"#[0-9a-fA-F]{6}", state["color"]))
        for state in states
    ):
        return None
    return states


def _capabilities(
    raw: object, phase_ids: set[str], state_ids: set[str]
) -> list[dict[str, object]] | None:
    labels = _rows(raw, {"id": 120, "label": 30}, ("id", "label"), 0, 8)
    if labels is None or not isinstance(raw, list):
        return None
    result: list[dict[str, object]] = []
    # _rows returns one entry per raw item, so the lists line up. zip's
    # strict keyword is Python 3.10+ and this kit still runs on 3.9.
    for label, source in zip(labels, raw):
        values = source.get("states")
        if not isinstance(values, dict) or set(values) != phase_ids:
            return None
        if any(
            value is not None and (not isinstance(value, str) or value not in state_ids)
            for value in values.values()
        ):
            return None
        result.append({**label, "states": dict(values)})
    return result


def _horizons(raw: object, phase_order: list[str]) -> list[dict[str, str]] | None:
    horizons = _rows(
        raw, {"from": 120, "to": 120, "label": 40, "owner": 32}, ("from", "to", "label"), 0, 4
    )
    if horizons is None:
        return None
    phase_ids = set(phase_order)
    for horizon in horizons:
        if horizon["from"] not in phase_ids or horizon["to"] not in phase_ids:
            return None
        if phase_order.index(horizon["from"]) > phase_order.index(horizon["to"]):
            return None
    return horizons


def _sanitize_record(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict) or raw.get("version") != 1 or isinstance(raw.get("version"), bool):
        return {}
    progression = raw.get("progression")
    if not isinstance(progression, dict):
        return {}
    stages = _rows(
        raw.get("stages"),
        {
            "id": 120,
            "title": 32,
            "owner": 32,
            "decider": 32,
            "partners": 60,
            "cadence": 32,
            "body": 140,
            "audience": 60,
        },
        ("id", "title"),
        2,
        5,
    )
    states = _states(progression.get("states"))
    if stages is None or states is None:
        return {}
    phase_order = [stage["id"] for stage in stages]
    capabilities = _capabilities(
        progression.get("capabilities"), set(phase_order), {state["id"] for state in states}
    )
    horizons = _horizons(progression.get("horizons", []), phase_order)
    extra = _fields(progression, {"caption": 120})
    if capabilities is None or horizons is None or extra is None:
        return {}
    return {
        "version": 1,
        "kind": "operating-model",
        "stages": stages,
        "progression": {
            **extra,
            "states": states,
            "capabilities": capabilities,
            "horizons": horizons,
        },
    }
