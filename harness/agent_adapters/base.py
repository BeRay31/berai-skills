"""Shared contract and queue lifecycle for Studio-owned agent sessions."""

from __future__ import annotations

import queue
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path


@dataclass(frozen=True)
class AgentJob:
    """One turn for a Studio-owned harness session."""

    request_id: str
    prompt: str
    cwd: Path


@dataclass(frozen=True)
class AgentUpdate:
    """Small, UI-safe progress event emitted by a harness adapter."""

    phase: str
    detail: str
    session_id: str = ""


UpdateCallback = Callable[[AgentUpdate], None]


class HarnessAdapter(Protocol):
    """Minimal lifecycle shared by every harness implementation."""

    name: str = "none"

    def submit(self, job: AgentJob, callback: UpdateCallback) -> None:
        """Queue a turn without blocking the caller."""
        ...

    def cancel(self, request_id: str) -> bool:
        """Stop a queued or active turn and report whether it is safe to unlock."""
        ...

    def close(self) -> None:
        """Stop accepting work and release child processes."""
        ...


@dataclass
class QueuedJob:
    """Internal queue entry shared by the protocol adapters."""

    job: AgentJob
    callback: UpdateCallback
    cancelled: bool = False
    done: threading.Event = field(default_factory=threading.Event)


class QueuedAdapter:
    """Serialize turns and retire idle adapter resources after five minutes."""

    idle_seconds = 300.0
    name = "agent"
    label = "Agent"

    def __init__(self, executable: str) -> None:
        resolved = shutil.which(executable)
        if resolved is None:
            message = f"{self.label} adapter requires an authenticated `{executable}` CLI on PATH"
            raise RuntimeError(message)
        self.executable = resolved
        self.session_id = ""
        self._queue: queue.Queue[QueuedJob | None] = queue.Queue()
        self._tasks: dict[str, QueuedJob] = {}
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._active: QueuedJob | None = None
        self._closed = False

    def submit(self, job: AgentJob, callback: UpdateCallback) -> None:
        """Queue a turn, starting the worker only when work exists."""
        task = QueuedJob(job, callback)
        with self._lock:
            if self._closed:
                message = f"{self.label} adapter is closed"
                raise RuntimeError(message)
            self._tasks[job.request_id] = task
            callback(AgentUpdate("queued", f"Queued for {self.label}", self.session_id))
            self._queue.put(task)
            self._start_worker()

    def cancel(self, request_id: str) -> bool:
        """Cancel a queued turn or interrupt the active protocol turn."""
        task, active = self._mark_cancelled(request_id)
        if task is None or not active:
            return True
        try:
            self._cancel_active()
        except (OSError, RuntimeError):
            self._stop_session()
        if task.done.wait(5):
            return True
        self._stop_session()
        return task.done.wait(2)

    def close(self) -> None:
        """Reject new work and release the worker and child process."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            tasks = tuple(self._tasks.values())
            worker = self._worker
        for task in tasks:
            task.cancelled = True
        if worker is not None:
            self._queue.put(None)
        self._stop_session()
        if worker is not None:
            worker.join(timeout=2)

    def emit(self, task: QueuedJob, phase: str, detail: str) -> None:
        """Send one update with the current child-session ID."""
        task.callback(AgentUpdate(phase, detail, self.session_id))

    def _start_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(
            target=self._work,
            name=f"studio-{self.name}",
            daemon=True,
        )
        self._worker.start()

    def _mark_cancelled(self, request_id: str) -> tuple[QueuedJob | None, bool]:
        with self._lock:
            task = self._tasks.get(request_id)
            if task is None:
                return None, False
            task.cancelled = True
            return task, self._active is task

    def _work(self) -> None:
        try:
            while (task := self._next_task()) is not None:
                self._run_task(task)
        finally:
            with self._lock:
                if self._worker is threading.current_thread():
                    self._worker = None

    def _next_task(self) -> QueuedJob | None:
        while True:
            received, task = self._wait_for_task()
            if received:
                return task
            with self._lock:
                if not self._tasks and self._queue.empty():
                    self._stop_session()
                    self._worker = None
                    return None

    def _wait_for_task(self) -> tuple[bool, QueuedJob | None]:
        try:
            return True, self._queue.get(timeout=self.idle_seconds)
        except queue.Empty:
            return False, None

    def _run_task(self, task: QueuedJob) -> None:
        with self._lock:
            self._active = task
        try:
            if not task.cancelled:
                self._run_turn(task)
        except Exception as exc:  # noqa: BLE001 - adapter errors belong in Studio
            if not task.cancelled:
                self.emit(task, "failed", self._clean_error(exc))
            self._stop_session()
        finally:
            with self._lock:
                self._tasks.pop(task.job.request_id, None)
                self._active = None
            task.done.set()

    @staticmethod
    def _clean_error(exc: Exception) -> str:
        message = " ".join(str(exc).split()) or type(exc).__name__
        return message[:280]

    def _run_turn(self, task: QueuedJob) -> None:
        raise NotImplementedError

    def _cancel_active(self) -> None:
        raise NotImplementedError

    def _stop_session(self) -> None:
        raise NotImplementedError
