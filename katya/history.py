"""Run history: a ring journal of scenario executions.

Every place that runs a list of steps (the startup scenario of a tab, the
`/steps` endpoint, a server macro, a trigger reaction) opens a record with
`RunHistory.begin(...)` and closes it with `complete(...)`/`finish(...)`.
Records live in data/runs.json (at most `limit` newest ones, written
atomically) and are served by `/api/runs`; a failed run gets a JPEG screenshot
of the tab stored through the app's screenshot sink.

The journal never stores typed text or passwords: `steps_summary` keeps the
action and its target, and the value only for actions whose value is not user
input (wait, scroll, press, navigate...).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Literal, Optional

from pydantic import BaseModel

RunSource = Literal["startup", "steps", "macro", "trigger"]

# Values of these actions are durations, selectors, keys or URLs, never user input.
SAFE_VALUE_ACTIONS = {"wait", "scroll", "press", "navigate", "select", "attribute", "wait_url",
                      "screenshot", "page_text", "drag"}
MASK = "•••"
SUMMARY_MAX_ITEMS = 200
SUMMARY_MAX_CHARS = 100

SOURCE_TITLES = {"startup": "стартовый сценарий", "steps": "сценарий", "macro": "макрос", "trigger": "триггер"}


class RunRecord(BaseModel):
    id: str
    started: float                     # unix time
    finished: float = 0                # 0 while running
    source: RunSource
    macro_name: str = ""               # macro or trigger name, "" for ad-hoc runs
    job_id: str = ""
    worker_id: str = ""
    url: str = ""
    total: int = 0
    completed: int = 0
    ok: Optional[bool] = None          # None while running
    error: str = ""
    screenshot: str = ""               # file name in data/files, "" if none
    duration_ms: int = 0
    steps_summary: List[str] = []

    @property
    def title(self) -> str:
        """Human name: «macro» for macros/triggers, the source kind otherwise."""
        base = SOURCE_TITLES.get(self.source, self.source)
        return f"{base} «{self.macro_name}»" if self.macro_name else base


def summarize_step(step: Any) -> str:
    """One short line per step without typed text. Accepts a Step model or a dict."""
    get = (lambda key, default="": getattr(step, key, default)) if not isinstance(step, dict) \
        else (lambda key, default="": step.get(key, default))
    action = str(get("action", "?"))
    parts = [action]
    name = str(get("name", "")).strip()
    if name:
        parts.append(f"[{name}]")
    query = str(get("query", "")).strip()
    if query:
        kind = str(get("kind", "css"))
        if kind == "role":
            kind = f"role:{get('role', 'button')}"
        parts.append(f"{kind}={query}")
    if action in {"point", "move", "inspect", "mouse_drag"}:
        parts.append(f"({float(get('x', 0)):.2f}, {float(get('y', 0)):.2f})")
    value = str(get("value", ""))
    if value:
        parts.append(f"= {value}" if action in SAFE_VALUE_ACTIONS else f"= {MASK}")
    if get("optional", False):
        parts.append("(необязательный)")
    line = " ".join(parts)
    return line if len(line) <= SUMMARY_MAX_CHARS else line[:SUMMARY_MAX_CHARS - 1] + "…"


def summarize_steps(steps: Iterable[Any]) -> List[str]:
    steps = list(steps)
    summary = [summarize_step(step) for step in steps[:SUMMARY_MAX_ITEMS]]
    if len(steps) > SUMMARY_MAX_ITEMS:
        summary.append(f"… ещё {len(steps) - SUMMARY_MAX_ITEMS}")
    return summary


class RunHistory:
    """Ring journal of the newest `limit` runs, persisted to a JSON file."""

    def __init__(self, path: str, limit: int = 500, log: Optional[Callable[[str], None]] = None):
        self.path = path
        self.limit = max(1, limit)
        self.log = log or (lambda msg: None)
        self.records: List[RunRecord] = []       # oldest first
        self.on_finish: Optional[Callable[[RunRecord], Any]] = None   # set by the app (notifications)
        self.load()

    # ---- persistence ----
    def load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                items = json.load(fh)
        except FileNotFoundError:
            return
        except Exception as e:
            self.log(f"runs load failed: {str(e)[:80]}")
            return
        loaded: List[RunRecord] = []
        for item in items if isinstance(items, list) else []:
            try:
                record = RunRecord(**item)
            except Exception:
                continue
            if record.ok is None:                 # the app died mid-run
                record.ok = False
                record.error = record.error or "Прервано: сервер остановлен во время выполнения"
                record.finished = record.finished or record.started
            loaded.append(record)
        self.records = loaded[-self.limit:]

    def save(self) -> None:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            tmp = f"{self.path}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump([r.model_dump() for r in self.records], fh, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except Exception as e:
            self.log(f"runs save failed: {str(e)[:80]}")

    # ---- lifecycle ----
    def begin(self, source: RunSource, *, steps: Iterable[Any] = (), job_id: str = "", worker_id: str = "",
              url: str = "", macro_name: str = "", started: Optional[float] = None) -> RunRecord:
        """Open a record. It is already visible in `list()` with ok=None."""
        steps = list(steps)
        record = RunRecord(id=uuid.uuid4().hex[:10], started=started or time.time(), source=source,
                           macro_name=(macro_name or "")[:80], job_id=job_id, worker_id=worker_id,
                           url=(url or "")[:2048], total=len(steps), steps_summary=summarize_steps(steps))
        self.records.append(record)
        if len(self.records) > self.limit:
            del self.records[:-self.limit]
        return record

    def finish(self, record: RunRecord, result: Dict[str, Any], screenshot: str = "") -> RunRecord:
        """Close a record with the dict `run_steps` returned ({ok, completed, error?})."""
        record.finished = time.time()
        record.ok = bool(result.get("ok"))
        record.completed = int(result.get("completed", 0) or 0)
        record.error = "" if record.ok else str(result.get("error") or "Сценарий не выполнен")[:300]
        record.screenshot = screenshot or ""
        record.duration_ms = max(0, round((record.finished - record.started) * 1000))
        self.save()
        if self.on_finish:
            try:
                self.on_finish(record)
            except Exception as e:
                self.log(f"run hook failed: {str(e)[:80]}")
        return record

    async def complete(self, record: RunRecord, result: Dict[str, Any], *, page=None,
                       screenshot_sink: Optional[Callable[[bytes, str], Awaitable[str]]] = None) -> RunRecord:
        """`finish` plus a JPEG screenshot of the tab when the run failed."""
        screenshot = ""
        if not result.get("ok") and page is not None and screenshot_sink is not None:
            try:
                image = await page.screenshot(type="jpeg", quality=60, timeout=8000)
                screenshot = await screenshot_sink(image, f"fail-{record.source}")
            except Exception as e:
                self.log(f"run {record.id}: failure screenshot skipped: {str(e).splitlines()[0][:80]}")
        return self.finish(record, result, screenshot)

    # ---- queries ----
    def list(self, limit: int = 50, source: str = "", macro_name: str = "") -> List[dict]:
        """Newest first."""
        out = []
        for record in reversed(self.records):
            if source and record.source != source:
                continue
            if macro_name and record.macro_name != macro_name:
                continue
            out.append(record.model_dump())
            if len(out) >= max(1, limit):
                break
        return out

    def get(self, run_id: str) -> Optional[RunRecord]:
        for record in reversed(self.records):
            if record.id == run_id:
                return record
        return None
