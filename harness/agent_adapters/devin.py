"""Devin Agent Client Protocol adapter."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import QueuedAdapter, QueuedJob
from .json_rpc import JsonRpcProcess

if TYPE_CHECKING:
    from pathlib import Path


class DevinAdapter(QueuedAdapter):
    """Drive one persistent Devin ACP v1 session over stdio."""

    name = "devin"
    label = "Devin"

    def __init__(self, executable: str = "devin") -> None:
        super().__init__(executable)
        self._rpc = JsonRpcProcess("Devin ACP")
        self._tool_titles: dict[str, str] = {}
        self._last_detail = ""

    def _run_turn(  # pyrefly: ignore[missing-override-decorator]
        self, task: QueuedJob
    ) -> None:
        self._tool_titles.clear()
        self._last_detail = ""
        self.emit(task, "starting", "Starting Devin")
        self._ensure_session(task.job.cwd)
        self._working(task, "Devin is reading the review")
        request_id = self._rpc.send_request(
            "session/prompt",
            {
                "sessionId": self.session_id,
                "prompt": [{"type": "text", "text": task.job.prompt}],
            },
        )
        while True:
            message = self._rpc.read()
            if message.get("id") == request_id:
                self._finish_turn(task, message)
                return
            self._handle_message(task, message)

    def _finish_turn(self, task: QueuedJob, message: dict[str, object]) -> None:
        self._rpc.raise_for_error(message)
        result = message.get("result")
        reason = result.get("stopReason") if isinstance(result, dict) else None
        if task.cancelled or reason == "cancelled":
            return
        if reason != "end_turn":
            detail = f"Devin turn ended: {reason or 'unknown'}"
            raise RuntimeError(detail)
        self.emit(task, "validating", "Devin finished; validating the rebuild")

    def _handle_message(self, task: QueuedJob, message: dict[str, object]) -> None:
        method = message.get("method")
        if method == "session/update":
            self._handle_update(task, message)
            return
        if method == "session/request_permission" and "id" in message:
            self._answer_permission(task, message)
            return
        if isinstance(method, str) and "id" in message:
            self._rpc.respond_error(message["id"], -32601, f"unsupported ACP request: {method}")

    def _answer_permission(self, task: QueuedJob, message: dict[str, object]) -> None:
        request_id = message["id"]
        if task.cancelled:
            self._rpc.respond(request_id, self._cancelled_permission())
            return
        params = message.get("params")
        allow_once = self._option_id(params, "allow_once")
        if allow_once is not None:
            outcome: dict[str, object] = {
                "outcome": {"outcome": "selected", "optionId": allow_once}
            }
            self._rpc.respond(request_id, outcome)
            return
        reject_once = self._option_id(params, "reject_once")
        outcome = (
            {"outcome": {"outcome": "selected", "optionId": reject_once}}
            if reject_once is not None
            else self._cancelled_permission()
        )
        self._rpc.respond(request_id, outcome)
        message_text = "Devin requested permission without a one-turn approval option"
        raise RuntimeError(message_text)

    def _handle_update(self, task: QueuedJob, message: dict[str, object]) -> None:
        params = message.get("params")
        update = params.get("update") if isinstance(params, dict) else None
        if not isinstance(update, dict):
            return
        update_type = update.get("sessionUpdate")
        if update_type in ("tool_call", "tool_call_update"):
            if detail := self._tool_detail(update):
                self._working(task, detail)
            return
        if update_type == "plan" and (detail := self._active_plan_entry(update)):
            self._working(task, detail)
            return
        if update_type == "agent_thought_chunk":
            self._working(task, "Devin is thinking")
            return
        if update_type == "agent_message_chunk":
            self._working(task, "Devin is writing")

    def _ensure_session(self, cwd: Path) -> None:
        if self._rpc.running:
            return
        self._rpc.start([self.executable, "acp"], cwd, "studio-devin-stderr")
        initialized = self._rpc.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {},
                "clientInfo": {
                    "name": "explainer-studio",
                    "title": "Explainer Studio",
                    "version": "1",
                },
            },
        )
        version = initialized.get("protocolVersion")
        if version != 1:
            message = f"Devin selected unsupported ACP version {version!r}"
            raise RuntimeError(message)
        created = self._rpc.request(
            "session/new",
            {"cwd": cwd.resolve().as_posix(), "mcpServers": []},
        )
        session_id = created.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            message = "Devin did not return an ACP session ID"
            raise RuntimeError(message)
        self.session_id = session_id

    def _cancel_active(self) -> None:  # pyrefly: ignore[missing-override-decorator]
        self._rpc.notify("session/cancel", {"sessionId": self.session_id})

    def _stop_session(self) -> None:  # pyrefly: ignore[missing-override-decorator]
        self._rpc.stop()
        self.session_id = ""

    @staticmethod
    def _option_id(params: object, kind: str) -> str | None:
        options = params.get("options") if isinstance(params, dict) else None
        if not isinstance(options, list):
            return None
        option = next(
            (item for item in options if isinstance(item, dict) and item.get("kind") == kind),
            None,
        )
        option_id = option.get("optionId") if isinstance(option, dict) else None
        return option_id if isinstance(option_id, str) else None

    @staticmethod
    def _cancelled_permission() -> dict[str, object]:
        return {"outcome": {"outcome": "cancelled"}}

    def _working(self, task: QueuedJob, detail: str) -> None:
        """Emit a working update only when the visible text actually changes."""
        if detail == self._last_detail:
            return
        self._last_detail = detail
        self.emit(task, "working", detail)

    def _tool_detail(self, update: dict[str, object]) -> str:
        """Describe a tool call by title, remembered across status-only updates.

        ACP ``tool_call_update`` notifications carry only changed fields, so a
        bare ``status: completed`` must not overwrite the tool's title — the
        panel would otherwise read "completed" for the rest of the turn.
        """
        tool_call_id = update.get("toolCallId")
        tool_call_id = tool_call_id if isinstance(tool_call_id, str) else ""
        title = update.get("title")
        if isinstance(title, str) and title:
            self._tool_titles[tool_call_id] = title[:200]
        elif tool_call_id:
            title = self._tool_titles.get(tool_call_id)
        status = update.get("status")
        if status == "completed":
            return ""
        if not isinstance(title, str) or not title:
            return "Devin is editing"
        if status == "failed":
            return f"Devin is using {title} · failed"[:280]
        return f"Devin is using {title}"[:280]

    @staticmethod
    def _active_plan_entry(update: dict[str, object]) -> str:
        entries = update.get("entries")
        if not isinstance(entries, list):
            return ""
        detail = next(
            (
                entry.get("content")
                for entry in entries
                if isinstance(entry, dict) and entry.get("status") == "in_progress"
            ),
            None,
        )
        return detail[:280] if isinstance(detail, str) else ""
