"""Lazy adapter selection for Studio launchers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import HarnessAdapter


def create_adapter(name: str) -> HarnessAdapter | None:
    """Create only the adapter explicitly selected by the launching harness."""
    if name == "none":
        return None
    if name == "droid":
        from .droid import DroidAdapter  # noqa: PLC0415 - preserve lazy loading

        return DroidAdapter()
    if name == "devin":
        from .devin import DevinAdapter  # noqa: PLC0415 - preserve lazy loading

        return DevinAdapter()
    message = f"unsupported agent adapter: {name}"
    raise ValueError(message)
