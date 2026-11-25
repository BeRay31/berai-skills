"""Factory Droid stream-JSON-RPC adapter."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from .base import QueuedAdapter, QueuedJob
from .json_rpc import JsonRpcProcess

if TYPE_CHECKING:
    from pathlib import Path


class DroidAdapter(QueuedAdapter):
    """Drive one persistent Factory Droid session over stdio."""

    name = "droid"
    label = "Droid"
    session_init_timeout = 60.0
    message_ack_timeout = 30.0

    def __init__(self, executable: str = "droid") -> None:
        super().__init__(executable)
        self._rpc = JsonRpcProcess("Droid JSON-RPC", factory_api_version="1.0.0")

    def _run_turn(  # pyrefly: ignore[missing-override-decorator]
        self, task: QueuedJob
    ) -> None:
        self.emit(task, "starting", "Starting Droid")
        self._ensure_session(task.job.cwd)
        self.emit(task, "working", "Droid is reading the review")
        request_id: str | None = self._rpc.send_request(
            "droid.add_user_message",
            {"messageId": task.job.request_id, "text": task.job.prompt},
        )
        ack_deadline = time.monotonic() + self.message_ack_timeout
        while True:
            timeout = max(0.0, ack_deadline - time.monotonic()) if request_id is not None else None
            try:
                message = self._rpc.read(timeout_seconds=timeout)
            except TimeoutError as exc:
                detail = (
                    "Droid JSON-RPC timed out waiting for droid.add_user_message after "
                    f"{self.message_ack_timeout:g} seconds"
                )
                raise TimeoutError(detail) from exc
            if request_id is not None and message.get("id") == request_id:
                self._rpc.raise_for_error(message)
                request_id = None
                continue
            if self._handle_message(task, message):
                return

    def _handle_message(self, task: QueuedJob, message: dict[str, object]) -> bool:
        method = message.get("method")
        if method in ("droid.request_permission", "droid.ask_user"):
            detail = "Droid requested interaction during an unattended Studio turn"
            raise RuntimeError(detail)
        if method != "droid.session_notification":
            return False
        params = message.get("params")
        notification = params.get("notification") if isinstance(params, dict) else None
        return isinstance(notification, dict) and self._handle_notification(task, notification)

    def _handle_notification(self, task: QueuedJob, notification: dict[str, object]) -> bool:
        event_type = notification.get("type")
        if event_type == "agent_turn_completed":
            return self._finish_turn(task, notification)
        if detail := self._progress_detail(event_type, notification):
            self.emit(task, "working", detail)
        return False

    def _finish_turn(self, task: QueuedJob, notification: dict[str, object]) -> bool:
        reason = notification.get("reason")
        if task.cancelled or reason == "cancelled":
            return True
        if reason != "completed":
            detail = f"Droid turn ended: {reason or 'unknown'}"
            raise RuntimeError(detail)
        self.emit(task, "validating", "Droid finished; validating the rebuild")
        return True

    def _progress_detail(
        self,
        event_type: object,
        notification: dict[str, object],
    ) -> str:
        if event_type == "tool_call":
            name = self._tool_name(notification)
            return f"Droid is using {name}" if name else "Droid is editing"
        if event_type == "tool_progress_update":
            return self._tool_progress(notification)
        detail = notification.get("message")
        return detail[:280] if event_type == "error" and isinstance(detail, str) else ""

    def _ensure_session(self, cwd: Path) -> None:
        if self._rpc.running:
            return
        self._rpc.start(
            [
                self.executable,
                "exec",
                "--input-format",
                "stream-jsonrpc",
                "--output-format",
                "stream-jsonrpc",
                "--auto",
                "medium",
            ],
            cwd,
            "studio-droid-stderr",
        )
        result = self._rpc.request(
            "droid.initialize_session",
            {
                "machineId": "explainer-studio",
                "cwd": cwd.resolve().as_posix(),
                "interactionMode": "auto",
                "autonomyLevel": "medium",
                "autoRejectPermissionRequests": True,
            },
            timeout_seconds=self.session_init_timeout,
        )
        session_id = result.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            message = "Droid did not return a session ID"
            raise RuntimeError(message)
        self.session_id = session_id

    def _cancel_active(self) -> None:  # pyrefly: ignore[missing-override-decorator]
        if not self.session_id:
            self._rpc.stop()
            return
        self._rpc.send_request("droid.interrupt_session", {})

    def _stop_session(self) -> None:  # pyrefly: ignore[missing-override-decorator]
        self._rpc.stop()
        self.session_id = ""

    @staticmethod
    def _tool_name(notification: dict[str, object]) -> str:
        for key in ("toolName", "name"):
            value = notification.get(key)
            if isinstance(value, str):
                return value[:80]
        tool_use = notification.get("toolUse")
        value = tool_use.get("name") if isinstance(tool_use, dict) else None
        return value[:80] if isinstance(value, str) else ""

    @staticmethod
    def _tool_progress(notification: dict[str, object]) -> str:
        update = notification.get("update")
        if not isinstance(update, dict):
            return ""
        tool = update.get("toolName") or notification.get("toolName")
        status = update.get("status") or update.get("text")
        parts = [value for value in (tool, status) if isinstance(value, str) and value]
        return " · ".join(parts)[:280]
