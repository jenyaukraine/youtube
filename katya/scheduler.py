"""Scheduled runs of saved macros.

A schedule says "run macro X on this cron expression (or every N minutes)".
When it is due, the scheduler opens a fresh tab the same way POST /api/start
does, runs the macro as the start scenario, and closes the tab afterwards.
The outcome (ok/error, steps, duration) lands in `last_result` and the log.

Cron: five fields (minute hour day-of-month month day-of-week) with `*`,
numbers, lists `1,15`, ranges `9-18`, steps `*/5` and `1-30/10`; day-of-week
accepts 0-7 (0 and 7 = Sunday) or mon..sun. As in classic cron, when both the
day-of-month and the day-of-week fields are restricted, either one matching
makes the day match. Times are local time.

Schedules are stored in data/schedules.json so they survive restarts.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Dict, List, Optional, Set

from pydantic import BaseModel, Field

SCHEDULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "schedules.json")
CHECK_INTERVAL = 15          # seconds between checks for due schedules
MAX_EVERY_MINUTES = 7 * 24 * 60

_DOW_NAMES = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
_MONTH_NAMES = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


class Schedule(BaseModel):
    id: str = ""
    macro_name: str = Field(min_length=1, max_length=80)
    cron: str = ""                 # five cron fields, or empty when every_minutes is used
    every_minutes: int = 0         # run every N minutes (0 = use cron)
    url: str = ""                  # page to open; empty = the macro's start_url
    workers: int = 1               # tabs opened per run
    enabled: bool = True
    last_run: float = 0.0          # unix time of the last start
    last_result: str = ""          # human-readable outcome of the last run
    next_run: float = 0.0          # unix time of the next start (0 = never)


# ---------------- cron parsing ----------------
def _parse_value(token: str, names: Dict[str, int]) -> int:
    token = token.strip().lower()
    if token in names:
        return names[token]
    if not token.isdigit():
        raise ValueError(f"неверное значение «{token}»")
    return int(token)


def _parse_field(field: str, low: int, high: int, names: Optional[Dict[str, int]] = None) -> Set[int]:
    """Expand one cron field into the set of matching integers."""
    names = names or {}
    values: Set[int] = set()
    for part in field.split(","):
        part = part.strip()
        if not part:
            raise ValueError("пустой элемент списка")
        step = 1
        if "/" in part:
            part, step_text = part.split("/", 1)
            if not step_text.isdigit() or int(step_text) < 1:
                raise ValueError(f"неверный шаг «{step_text}»")
            step = int(step_text)
        if part == "*":
            start, end = low, high
        elif "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = _parse_value(start_text, names), _parse_value(end_text, names)
        else:
            start = _parse_value(part, names)
            end = high if step > 1 else start
        if not (low <= start <= high and low <= end <= high):
            raise ValueError(f"значение вне диапазона {low}-{high}")
        if start > end:
            raise ValueError(f"диапазон {start}-{end} задан наоборот")
        values.update(range(start, end + 1, step))
    return values


class CronSpec:
    """Parsed five-field cron expression."""

    def __init__(self, expression: str):
        fields = expression.split()
        if len(fields) != 5:
            raise ValueError("cron должен состоять из 5 полей: минуты часы дни месяцы дни_недели")
        self.expression = " ".join(fields)
        self.minutes = _parse_field(fields[0], 0, 59)
        self.hours = _parse_field(fields[1], 0, 23)
        self.days = _parse_field(fields[2], 1, 31)
        self.months = _parse_field(fields[3], 1, 12, _MONTH_NAMES)
        dows = _parse_field(fields[4], 0, 7, _DOW_NAMES)
        self.dows = {0 if d == 7 else d for d in dows}
        self.any_day = fields[2].strip() == "*"
        self.any_dow = fields[4].strip() == "*"

    def day_matches(self, dt: datetime) -> bool:
        dom_ok = dt.day in self.days
        dow_ok = (dt.isoweekday() % 7) in self.dows     # Monday=1 .. Sunday=0
        if self.any_day and self.any_dow:
            return True
        if self.any_day:
            return dow_ok
        if self.any_dow:
            return dom_ok
        return dom_ok or dow_ok

    def next_after(self, after: datetime) -> datetime:
        """First matching minute strictly after `after` (naive local time)."""
        dt = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
        limit_year = after.year + 6
        while dt.year <= limit_year:
            if dt.month not in self.months:
                year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
                dt = dt.replace(year=year, month=month, day=1, hour=0, minute=0)
                continue
            if not self.day_matches(dt):
                dt = (dt + timedelta(days=1)).replace(hour=0, minute=0)
                continue
            if dt.hour not in self.hours:
                dt = (dt + timedelta(hours=1)).replace(minute=0)
                continue
            if dt.minute not in self.minutes:
                dt += timedelta(minutes=1)
                continue
            return dt
        raise ValueError("cron никогда не сработает")


def parse_cron(expression: str) -> CronSpec:
    return CronSpec(expression)


def next_cron_run(expression: str, after: float) -> float:
    """Unix time of the first cron match strictly after the unix time `after`."""
    return CronSpec(expression).next_after(datetime.fromtimestamp(after)).timestamp()


def compute_next_run(schedule: Schedule, after: float) -> float:
    if schedule.every_minutes > 0:
        return after + schedule.every_minutes * 60
    return next_cron_run(schedule.cron, after)


def validate_schedule(schedule: Schedule) -> Optional[str]:
    if schedule.every_minutes and schedule.cron.strip():
        return "Укажи либо cron, либо every_minutes"
    if schedule.every_minutes:
        if not (1 <= schedule.every_minutes <= MAX_EVERY_MINUTES):
            return f"every_minutes должен быть от 1 до {MAX_EVERY_MINUTES}"
    else:
        if not schedule.cron.strip():
            return "Укажи cron (5 полей) или every_minutes"
        if len(schedule.cron) > 120:
            return "Слишком длинное cron-выражение"
        try:
            CronSpec(schedule.cron)
        except ValueError as e:
            return f"cron: {e}"
    if not (1 <= schedule.workers <= 64):
        return "workers должен быть от 1 до 64"
    if len(schedule.url) > 2048:
        return "Слишком длинный URL"
    return None


def format_result(result: dict, seconds: float) -> str:
    completed = int(result.get("completed", 0))
    total = int(result.get("total", completed))
    if result.get("ok"):
        return f"ok: {completed} шагов за {seconds:.1f} с"
    error = str(result.get("error", "ошибка"))[:120]
    return f"ошибка: {error} ({completed}/{total} шагов, {seconds:.1f} с)"


# ---------------- scheduler ----------------
Runner = Callable[[Schedule], Awaitable[dict]]


class Scheduler:
    """Keeps schedules on disk and runs them in the background.

    `runner(schedule)` opens the tab(s), runs the macro and returns
    {"ok": bool, "completed": int, "total": int, "error": str}.
    """

    def __init__(self, path: str = SCHEDULES_PATH, log=None, runner: Optional[Runner] = None,
                 interval: float = CHECK_INTERVAL):
        self.path = path
        self.log = log or (lambda msg: None)
        self.runner = runner
        self.interval = interval
        self.schedules: Dict[str, Schedule] = {}
        self.running: Set[str] = set()
        self._task: Optional[asyncio.Task] = None
        self._run_tasks: Set[asyncio.Task] = set()
        self.load()

    # ---- persistence ----
    def load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                for item in json.load(fh):
                    schedule = Schedule(**item)
                    self.schedules[schedule.id] = schedule
        except FileNotFoundError:
            pass
        except Exception as e:
            self.log(f"schedules load failed: {str(e)[:80]}")

    def save(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump([s.model_dump() for s in self.schedules.values()], fh, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except Exception as e:
            self.log(f"schedules save failed: {str(e)[:80]}")

    # ---- CRUD ----
    def add(self, schedule: Schedule, now: Optional[float] = None) -> Schedule:
        """Create or update (same id). Run history is kept on update."""
        now = time.time() if now is None else now
        schedule.cron = " ".join(schedule.cron.split())
        if not schedule.id:
            schedule.id = uuid.uuid4().hex[:8]
        previous = self.schedules.get(schedule.id)
        if previous:
            schedule.last_run = previous.last_run
            schedule.last_result = previous.last_result
        schedule.next_run = compute_next_run(schedule, now) if schedule.enabled else 0.0
        self.schedules[schedule.id] = schedule
        self.save()
        return schedule

    def remove(self, schedule_id: str) -> bool:
        if self.schedules.pop(schedule_id, None) is None:
            return False
        self.save()
        return True

    def set_enabled(self, schedule_id: str, enabled: bool, now: Optional[float] = None) -> bool:
        schedule = self.schedules.get(schedule_id)
        if not schedule:
            return False
        schedule.enabled = enabled
        schedule.next_run = compute_next_run(schedule, time.time() if now is None else now) if enabled else 0.0
        self.save()
        return True

    def snapshot(self) -> List[dict]:
        return [{**s.model_dump(), "running": s.id in self.running} for s in self.schedules.values()]

    # ---- running ----
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())
            self.log(f"scheduler started: {len(self.schedules)} schedules")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        for task in list(self._run_tasks):
            task.cancel()
        self._run_tasks.clear()
        self.running.clear()

    async def _loop(self) -> None:
        while True:
            try:
                self.tick()
            except Exception as e:
                self.log(f"scheduler tick failed: {str(e)[:80]}")
            await asyncio.sleep(self.interval)

    def due(self, now: Optional[float] = None) -> List[Schedule]:
        now = time.time() if now is None else now
        return [s for s in self.schedules.values()
                if s.enabled and s.next_run and s.next_run <= now and s.id not in self.running]

    def tick(self, now: Optional[float] = None) -> List[Schedule]:
        started = self.due(now)
        for schedule in started:
            self._launch(schedule)
        return started

    def run_now(self, schedule_id: str) -> Optional[str]:
        """Start a schedule immediately. Returns an error message or None."""
        schedule = self.schedules.get(schedule_id)
        if not schedule:
            return "Расписание не найдено"
        if schedule.id in self.running:
            return "Расписание уже выполняется"
        self._launch(schedule)
        return None

    def _launch(self, schedule: Schedule) -> None:
        self.running.add(schedule.id)
        task = asyncio.create_task(self._execute(schedule))
        self._run_tasks.add(task)
        task.add_done_callback(self._run_tasks.discard)

    async def _execute(self, schedule: Schedule) -> None:
        started = time.time()
        schedule.last_run = started
        schedule.next_run = compute_next_run(schedule, started) if schedule.enabled else 0.0
        self.save()
        self.log(f"schedule {schedule.id} '{schedule.macro_name}' starting")
        try:
            if self.runner is None:
                result = {"ok": False, "error": "Планировщик не подключён", "completed": 0, "total": 0}
            else:
                result = await self.runner(schedule)
        except asyncio.CancelledError:
            result = {"ok": False, "error": "Остановлено", "completed": 0, "total": 0}
        except Exception as e:
            result = {"ok": False, "error": str(e)[:120], "completed": 0, "total": 0}
        finally:
            self.running.discard(schedule.id)
        schedule.last_result = format_result(result, time.time() - started)
        if schedule.id in self.schedules:        # unless deleted while running
            self.save()
        self.log(f"schedule {schedule.id} '{schedule.macro_name}': {schedule.last_result}")
