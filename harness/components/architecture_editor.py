"""Server validation for architecture geometry edits."""

from __future__ import annotations


def _nodes(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, object] = {}
    max_id_length = 120
    for node_id, node in list(raw.items())[:200]:
        if not isinstance(node_id, str) or not 0 < len(node_id) <= max_id_length:
            continue
        if not isinstance(node, dict) or not isinstance(node.get("identity"), str):
            continue
        if not all(
            isinstance(node.get(key), (int, float))
            and not isinstance(node[key], bool)
            and 0 <= node[key] <= 1
            for key in ("x", "y", "w", "h")
        ):
            continue
        if node["w"] <= 0 or node["h"] <= 0:
            continue
        clean[node_id] = {key: round(node[key], 6) for key in ("x", "y", "w", "h")} | {
            "identity": node["identity"][:500]
        }
    return clean


def _sanitize_record(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict) or raw.get("version") != 1 or isinstance(raw.get("version"), bool):
        return {}
    layouts = raw.get("layouts")
    if not isinstance(layouts, dict):
        return {}
    clean = {}
    for name in ("free", "stages", "main-flow", "groups"):
        layout = layouts.get(name)
        nodes: dict[str, object] = _nodes(layout.get("nodes")) if isinstance(layout, dict) else {}
        if nodes:
            clean[name] = {"nodes": nodes}
    return {"version": 1, "layouts": clean} if clean else {}
