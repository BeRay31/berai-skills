"""Small newline-delimited JSON-RPC subprocess transport."""

from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


class JsonRpcProcess:
    """Own one child process and its synchronized JSON-RPC streams."""

    def __init__(self, label: str, *, factory_api_version: str | None = None) -> None:
        self.label = label
        self._factory_api_version = factory_api_version
        self._process: subprocess.Popen[str] | None = None
        self._write_lock = threading.Lock()
        self._messages: queue.Queue[dict[str, object] | None] = queue.Queue()
        self._next_id = 0
        self._stderr_tail = ""

    @property
    def running(self) -> bool:
        """Return whether the child process is alive."""
        return self._process is not None and self._process.poll() is None

    def start(self, command: list[str], cwd: Path, stderr_thread_name: str) -> None:
        """Start the child process; the caller owns protocol initialization."""
        self.stop()
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._process = process
        self._stderr_tail = ""
        messages: queue.Queue[dict[str, object] | None] = queue.Queue()
        self._messages = messages
        threading.Thread(
            target=self._drain_stdout,
            args=(process, messages),
            name=f"{stderr_thread_name.removesuffix('-stderr')}-stdout",
            daemon=True,
        ).start()
        threading.Thread(
            target=self._drain_stderr,
            args=(process,),
            name=stderr_thread_name,
            daemon=True,
        ).start()

    def request(
        self,
        method: str,
        params: dict[str, object],
        *,
        timeout_seconds: float = 30.0,
    ) -> dict[str, object]:
        """Send a request and return its validated object result."""
        request_id = self.send_request(method, params)
        deadline = time.monotonic() + timeout_seconds
        try:
            while True:
                remaining = max(0.0, deadline - time.monotonic())
                message = self.read(timeout_seconds=remaining)
                if message.get("id") == request_id:
                    self.raise_for_error(message)
                    result = message.get("result")
                    if isinstance(result, dict):
                        return result
                    detail = f"{self.label} returned an invalid result for {method}"
                    raise RuntimeError(detail)
        except TimeoutError as exc:
            detail = (
                f"{self.label} timed out waiting for {method} after "
                f"{timeout_seconds:g} seconds{self._stderr_suffix()}"
            )
            self.stop()
            raise TimeoutError(detail) from exc

    def send_request(self, method: str, params: dict[str, object]) -> str:
        """Send a JSON-RPC request and return its ID."""
        with self._write_lock:
            self._next_id += 1
            request_id = str(self._next_id)
            self._write(self._envelope("request", id=request_id, method=method, params=params))
        return request_id

    def notify(self, method: str, params: dict[str, object]) -> None:
        """Send a JSON-RPC notification."""
        self._send(self._envelope("notification", method=method, params=params))

    def respond(self, request_id: object, result: dict[str, object]) -> None:
        """Respond to a request initiated by the child."""
        self._send(self._envelope("response", id=request_id, result=result))

    def respond_error(self, request_id: object, code: int, message: str) -> None:
        """Reject an unsupported request initiated by the child."""
        self._send(
            self._envelope(
                "response",
                id=request_id,
                error={"code": code, "message": message},
            )
        )

    def read(self, *, timeout_seconds: float | None = None) -> dict[str, object]:
        """Read the next valid JSON-RPC object from stdout."""
        process = self._process
        if process is None:
            message = f"{self.label} process is not running"
            raise RuntimeError(message)
        try:
            message = self._messages.get(timeout=timeout_seconds)
        except queue.Empty as exc:
            detail = f"{self.label} produced no protocol message{self._stderr_suffix()}"
            raise TimeoutError(detail) from exc
        if message is not None:
            if "error" in message and message.get("id") is None:
                self.raise_for_error(message)
            return message
        code = process.poll()
        detail = f"{self.label} process exited ({code}){self._stderr_suffix()}"
        raise RuntimeError(detail)

    def raise_for_error(self, message: dict[str, object]) -> None:
        """Raise a compact error when a response contains a JSON-RPC error."""
        error = message.get("error")
        if not isinstance(error, dict):
            return
        detail = error.get("message")
        if not isinstance(detail, str):
            detail = f"{self.label} request failed"
        raise RuntimeError(detail)

    def stop(self) -> None:
        """Terminate the child and close all three pipes."""
        process = self._process
        self._process = None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()

    def _send(self, message: dict[str, object]) -> None:
        with self._write_lock:
            self._write(message)

    def _write(self, message: dict[str, object]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            detail = f"{self.label} process is not running"
            raise RuntimeError(detail)
        process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        process.stdin.flush()

    def _envelope(self, message_type: str, **fields: object) -> dict[str, object]:
        message: dict[str, object] = {"jsonrpc": "2.0"}
        if self._factory_api_version is not None:
            message.update(
                {
                    "factoryApiVersion": self._factory_api_version,
                    "type": message_type,
                }
            )
        message.update(fields)
        return message

    @staticmethod
    def _drain_stdout(
        process: subprocess.Popen[str],
        messages: queue.Queue[dict[str, object] | None],
    ) -> None:
        stdout = process.stdout
        try:
            if stdout is not None:
                for line in stdout:
                    try:
                        value = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(value, dict):
                        messages.put(value)
        except (OSError, ValueError):
            pass
        finally:
            messages.put(None)

    def _stderr_suffix(self) -> str:
        return f": {self._stderr_tail}" if self._stderr_tail else ""

    def _drain_stderr(self, process: subprocess.Popen[str]) -> None:
        if process.stderr is None:
            return
        for line in process.stderr:
            if process is self._process:
                self._stderr_tail = (self._stderr_tail + " " + line.strip())[-2000:]
