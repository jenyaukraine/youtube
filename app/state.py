"""Shared state and persistence for the view-bot.

Counters are persisted to disk so accumulated watch time survives process
restarts (systemd restarts, reboots, deploys).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

STATE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "state.json"
)

GOAL_HOURS = 4000  # YouTube monetization threshold


@dataclass
class Worker:
    id: str
    url: str
    state: str = "starting"          # starting | watching | reloading | error | stopped
    watch_seconds: float = 0.0
    loop: int = 0
    last_action: str = ""
    error: str = ""
    started: float = field(default_factory=time.time)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "watch_seconds": round(self.watch_seconds, 1),
            "loop": self.loop,
            "last_action": self.last_action,
            "error": self.error,
            "uptime": round(time.time() - self.started, 1),
        }


@dataclass
class Job:
    id: str
    url: str
    workers: int
    duration: int = 0                # 0 = run until stopped
    status: str = "pending"          # pending | running | stopped
    created: float = field(default_factory=time.time)
    workers_list: List[Worker] = field(default_factory=list)

    def total_watch(self) -> float:
        return sum(w.watch_seconds for w in self.workers_list)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "status": self.status,
            "workers": self.workers,
            "duration": self.duration,
            "total_watch_seconds": round(self.total_watch(), 1),
            "total_watch_hours": round(self.total_watch() / 3600, 3),
            "created": self.created,
            "workers_list": [w.snapshot() for w in self.workers_list],
        }


class Store:
    """Holds live jobs + persisted lifetime totals."""

    def __init__(self, path: str = STATE_PATH):
        self.path = path
        self.jobs: Dict[str, Job] = {}
        self.lifetime_watch_seconds: float = 0.0
        self.lifetime_views: int = 0
        self.load()

    # ---- persistence ----
    def load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            self.lifetime_watch_seconds = float(data.get("lifetime_watch_seconds", 0.0))
            self.lifetime_views = int(data.get("lifetime_views", 0))
            # restore stopped jobs so their totals keep showing
            for j in data.get("jobs", []):
                job = Job(
                    id=j.get("id", uuid.uuid4().hex[:8]),
                    url=j.get("url", ""),
                    workers=int(j.get("workers", 0)),
                    duration=int(j.get("duration", 0)),
                    status=j.get("status", "stopped"),
                    created=float(j.get("created", time.time())),
                )
                for w in j.get("workers_list", []):
                    job.workers_list.append(
                        Worker(
                            id=w.get("id", ""),
                            url=job.url,
                            state=w.get("state", "stopped"),
                            watch_seconds=float(w.get("watch_seconds", 0.0)),
                            loop=int(w.get("loop", 0)),
                            last_action=w.get("last_action", ""),
                            error=w.get("error", ""),
                        )
                    )
                self.jobs[job.id] = job
        except FileNotFoundError:
            pass
        except Exception:
            pass

    def save(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            data = {
                "lifetime_watch_seconds": self.lifetime_watch_seconds,
                "lifetime_views": self.lifetime_views,
                "saved_at": time.time(),
                "jobs": [j.snapshot() for j in self.jobs.values()],
            }
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(tmp, self.path)
        except Exception:
            pass

    # ---- helpers ----
    def add_job(self, url: str, workers: int, duration: int) -> Job:
        job = Job(id=uuid.uuid4().hex[:8], url=url, workers=workers, duration=duration)
        self.jobs[job.id] = job
        return job

    def total_hours(self) -> float:
        # lifetime is authoritative; live running jobs add on top of the saved baseline
        live = 0.0
        for j in self.jobs.values():
            if j.status == "running":
                live += j.total_watch()
        return (self.lifetime_watch_seconds + live) / 3600

    def active_workers(self) -> int:
        n = 0
        for j in self.jobs.values():
            if j.status == "running":
                for w in j.workers_list:
                    if w.state in ("watching", "reloading", "starting"):
                        n += 1
        return n

    def log_lines(self, n: int = 60) -> List[str]:
        return LOG[-n:]


# simple in-memory ring log
class _Log:
    def __init__(self, cap: int = 500):
        self.lines: List[str] = []
        self.cap = cap

    def __call__(self, msg: str) -> None:
        self.lines.append(f"[{time.strftime('%H:%M:%S')}] {msg}")
        if len(self.lines) > self.cap:
            del self.lines[:-self.cap]

    def tail(self, n: int) -> List[str]:
        return self.lines[-n:]

    def __len__(self) -> int:
        return len(self.lines)


LOG = _Log()
store = Store()
