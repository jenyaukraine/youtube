"""Trigger rules: "when X appears on the page, do Y".

A trigger watches every open tab (or only tabs of one job). On each check the
condition is evaluated; when it matches, the trigger's steps run on that tab.
Typical use: close cookie banners, press "Continue?" buttons, dismiss pop-ups.

Triggers are stored in data/triggers.json so they survive restarts.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from typing import Dict, List, Literal, Optional

from playwright.async_api import Page
from pydantic import BaseModel, Field

from .actions import Step, locate, run_steps, validate_step, ALLOWED_ROLES

TRIGGERS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "triggers.json")


class Condition(BaseModel):
    kind: Literal["css", "text", "role", "label", "placeholder", "xpath", "url"] = "text"
    query: str = Field(min_length=1, max_length=300)
    role: str = "button"


class Trigger(BaseModel):
    id: str = ""
    name: str = Field(min_length=1, max_length=80)
    when: Condition
    then: List[Step] = Field(min_length=1, max_length=20)
    enabled: bool = True
    once_per_page: bool = False      # fire at most once per page URL
    cooldown_ms: int = 5000          # minimum pause between two firings in the same tab
    job_id: str = ""                 # empty = applies to every tab
    fired: int = 0


def validate_trigger(trigger: Trigger) -> Optional[str]:
    if trigger.when.kind == "role" and trigger.when.role not in ALLOWED_ROLES:
        return "Неподдерживаемая роль в условии"
    if trigger.when.kind == "url":
        try:
            re.compile(trigger.when.query)
        except re.error:
            return "Условие url должно быть регулярным выражением"
    for step in trigger.then:
        error = validate_step(step)
        if error:
            return error
    if not (500 <= trigger.cooldown_ms <= 3_600_000):
        return "cooldown_ms должен быть от 500 до 3600000"
    return None


class TriggerEngine:
    def __init__(self, path: str = TRIGGERS_PATH, log=None):
        self.path = path
        self.log = log or (lambda msg: None)
        self.triggers: Dict[str, Trigger] = {}
        self._last_fire: Dict[tuple, float] = {}        # (trigger_id, worker_id) -> monotonic time
        self._fired_urls: Dict[tuple, str] = {}         # (trigger_id, worker_id) -> url
        self.load()

    # ---- persistence ----
    def load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                for item in json.load(fh):
                    trigger = Trigger(**item)
                    self.triggers[trigger.id] = trigger
        except FileNotFoundError:
            pass
        except Exception as e:
            self.log(f"triggers load failed: {str(e)[:80]}")

    def save(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump([t.model_dump() for t in self.triggers.values()], fh, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except Exception as e:
            self.log(f"triggers save failed: {str(e)[:80]}")

    # ---- CRUD ----
    def add(self, trigger: Trigger) -> Trigger:
        if not trigger.id:
            trigger.id = uuid.uuid4().hex[:8]
        trigger.fired = 0
        self.triggers[trigger.id] = trigger
        self.save()
        return trigger

    def remove(self, trigger_id: str) -> bool:
        if self.triggers.pop(trigger_id, None) is None:
            return False
        self.save()
        return True

    def set_enabled(self, trigger_id: str, enabled: bool) -> bool:
        trigger = self.triggers.get(trigger_id)
        if not trigger:
            return False
        trigger.enabled = enabled
        self.save()
        return True

    def snapshot(self) -> List[dict]:
        return [t.model_dump() for t in self.triggers.values()]

    # ---- evaluation ----
    async def _matches(self, page: Page, when: Condition) -> bool:
        if when.kind == "url":
            return re.search(when.query, page.url) is not None
        loc = locate(page, when.kind, when.query, when.role).first
        try:
            return await loc.is_visible()
        except Exception as e:
            self.log(f"trigger condition error: {str(e).splitlines()[0][:80]}")
            return False

    async def check(self, page: Page, worker_id: str, job_id: str, *,
                    lock: Optional[asyncio.Lock] = None, screenshot_sink=None) -> List[dict]:
        """Evaluate all applicable triggers for one tab. Returns the list of firings."""
        fired = []
        now = time.monotonic()
        for trigger in list(self.triggers.values()):
            if not trigger.enabled or (trigger.job_id and trigger.job_id != job_id):
                continue
            key = (trigger.id, worker_id)
            if now - self._last_fire.get(key, -1e9) < trigger.cooldown_ms / 1000:
                continue
            if trigger.once_per_page and self._fired_urls.get(key) == page.url:
                continue
            if not await self._matches(page, trigger.when):
                continue
            self._last_fire[key] = now
            self._fired_urls[key] = page.url
            trigger.fired += 1
            result = await run_steps(page, trigger.then, delay_ms=200, lock=lock, screenshot_sink=screenshot_sink)
            self.log(f"trigger '{trigger.name}' fired in {worker_id}: {'ok' if result['ok'] else result.get('error')}")
            fired.append({"trigger": trigger.id, "name": trigger.name, **result})
        return fired
