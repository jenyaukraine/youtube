"""Notifications about scenario runs: Telegram bot and Discord webhook.

Settings live in data/notify.json:

    {"telegram_bot_token": "123:abc", "telegram_chat_id": "-100123",
     "discord_webhook_url": "https://discord.com/api/webhooks/...",
     "on": ["error"], "base_url": "http://my-host:8010"}

`notify(record, settings)` sends one short message per channel when the run's
outcome is listed in `on`. Network errors never raise: they are logged and
returned in the result dict.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Callable, Dict, List, Literal, Optional

import httpx
from pydantic import BaseModel, Field

from .history import RunRecord

Outcome = Literal["error", "success"]
TIMEOUT_S = 10.0
TEXT_LIMIT = 1800        # Discord allows 2000, Telegram 4096


class NotifySettings(BaseModel):
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    discord_webhook_url: str = ""
    on: List[Outcome] = Field(default_factory=lambda: ["error"])
    base_url: str = ""   # public address of the app, used to build screenshot links

    @property
    def enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id) or bool(self.discord_webhook_url)


def validate_settings(settings: NotifySettings) -> Optional[str]:
    if settings.discord_webhook_url and not settings.discord_webhook_url.startswith("https://"):
        return "Discord webhook должен начинаться с https://"
    if settings.telegram_bot_token and ":" not in settings.telegram_bot_token:
        return "Токен Telegram-бота выглядит как 123456:ABC-DEF..."
    if settings.base_url and not settings.base_url.startswith(("http://", "https://")):
        return "base_url должен начинаться с http:// или https://"
    for value in (settings.telegram_bot_token, settings.telegram_chat_id, settings.discord_webhook_url, settings.base_url):
        if len(value) > 512 or any(ch in value for ch in "\r\n\x00 "):
            return "Недопустимые символы в настройках"
    return None


def mask(value: str, keep: int = 4) -> str:
    """'123456:ABCDEF' -> '•••CDEF'; empty stays empty."""
    if not value:
        return ""
    return "•••" + value[-keep:] if len(value) > keep else "•••"


def masked(settings: NotifySettings) -> dict:
    data = settings.model_dump()
    data["telegram_bot_token"] = mask(settings.telegram_bot_token)
    data["discord_webhook_url"] = mask(settings.discord_webhook_url, keep=6)
    data["telegram_configured"] = bool(settings.telegram_bot_token and settings.telegram_chat_id)
    data["discord_configured"] = bool(settings.discord_webhook_url)
    return data


def load_settings(path: str) -> NotifySettings:
    try:
        with open(path, encoding="utf-8") as fh:
            return NotifySettings(**json.load(fh))
    except FileNotFoundError:
        return NotifySettings()
    except Exception:
        return NotifySettings()


def save_settings(path: str, settings: NotifySettings) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(settings.model_dump(), fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def merge_settings(current: NotifySettings, incoming: Dict[str, Any]) -> NotifySettings:
    """Apply a POST body; a masked secret (starts with •••) or a missing key keeps the stored value."""
    data = current.model_dump()
    for key in ("telegram_bot_token", "telegram_chat_id", "discord_webhook_url", "base_url"):
        if key in incoming and isinstance(incoming[key], str):
            value = incoming[key].strip()
            if value.startswith("•••"):
                continue
            data[key] = value
    if "on" in incoming:
        data["on"] = incoming["on"]
    return NotifySettings(**data)


def screenshot_link(record: RunRecord, base_url: str = "") -> str:
    if not record.screenshot:
        return ""
    return f"{base_url.rstrip('/')}/api/files/{record.screenshot}"


def format_message(record: RunRecord, base_url: str = "") -> str:
    status = "✅ выполнен" if record.ok else "❌ ошибка"
    lines = [f"Катя: {record.title} — {status}",
             f"Шагов: {record.completed} из {record.total}"]
    if record.duration_ms:
        lines.append(f"Время: {record.duration_ms / 1000:.1f} с")
    if record.url:
        lines.append(f"URL: {record.url[:300]}")
    if record.worker_id:
        lines.append(f"Вкладка: {record.worker_id}")
    if record.error:
        lines.append(f"Ошибка: {record.error[:300]}")
    link = screenshot_link(record, base_url)
    if link:
        lines.append(f"Скриншот: {link}")
    return "\n".join(lines)[:TEXT_LIMIT]


async def _post(client: httpx.AsyncClient, url: str, payload: dict) -> Optional[str]:
    """Returns an error string or None."""
    try:
        response = await client.post(url, json=payload)
    except httpx.HTTPError as e:
        return f"{e.__class__.__name__}: {str(e)[:120]}"
    if response.status_code >= 300:
        return f"HTTP {response.status_code}: {response.text[:160]}"
    return None


async def send_text(text: str, settings: NotifySettings, log: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    """Send to every configured channel. Returns {"ok", "sent": [...], "errors": {...}}."""
    log = log or (lambda msg: None)
    sent: List[str] = []
    errors: Dict[str, str] = {}
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        if settings.telegram_bot_token and settings.telegram_chat_id:
            error = await _post(client, f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                                {"chat_id": settings.telegram_chat_id, "text": text,
                                 "disable_web_page_preview": True})
            if error:
                errors["telegram"] = error
            else:
                sent.append("telegram")
        if settings.discord_webhook_url:
            error = await _post(client, settings.discord_webhook_url, {"content": text[:2000]})
            if error:
                errors["discord"] = error
            else:
                sent.append("discord")
    for channel, error in errors.items():
        log(f"notify {channel} failed: {error}")
    return {"ok": not errors and bool(sent), "sent": sent, "errors": errors}


async def notify(record: RunRecord, settings: NotifySettings, *, log: Optional[Callable[[str], None]] = None,
                 force: bool = False) -> Dict[str, Any]:
    """Notify about a finished run if its outcome is enabled in settings (or `force`)."""
    outcome: Outcome = "success" if record.ok else "error"
    if not settings.enabled:
        return {"ok": False, "sent": [], "errors": {}, "skipped": "Каналы не настроены"}
    if not force and outcome not in settings.on:
        return {"ok": True, "sent": [], "errors": {}, "skipped": f"Уведомления о событии {outcome} выключены"}
    return await send_text(format_message(record, settings.base_url), settings, log=log)


def sample_record() -> RunRecord:
    now = time.time()
    return RunRecord(id="test", started=now - 2.3, finished=now, source="macro", macro_name="проверка связи",
                     url="https://example.com", total=3, completed=3, ok=True, duration_ms=2300,
                     steps_summary=["navigate = https://example.com", "click text=Accept all", "screenshot"])


async def send_test(settings: NotifySettings, log: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    """Send a sample message regardless of the `on` filter."""
    if not settings.enabled:
        return {"ok": False, "sent": [], "errors": {}, "error": "Каналы не настроены: укажи Telegram или Discord"}
    text = "🔔 Пробное уведомление Katya Browser Lab\n" + format_message(sample_record(), settings.base_url)
    return await send_text(text, settings, log=log)
