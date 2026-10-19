"""Run with: python tests/test_history.py (no pytest, no browser needed)."""
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from katya.actions import Step                                    # noqa: E402
from katya.history import RunHistory, RunRecord, summarize_steps  # noqa: E402
from katya import notify                                          # noqa: E402

CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


def test_begin_finish(tmp):
    history = RunHistory(os.path.join(tmp, "runs.json"))
    steps = [Step(action="navigate", value="https://example.com"), Step(action="click", kind="text", query="Войти")]
    record = history.begin("steps", steps=steps, job_id="j1", worker_id="j1-0", url="https://example.com")
    check(record.ok is None and record.finished == 0, "a fresh record is open")
    check(record.total == 2 and len(record.steps_summary) == 2, "total and summary follow the steps")
    check(history.list()[0]["id"] == record.id and history.list()[0]["ok"] is None, "open run is listed")
    history.finish(record, {"ok": False, "completed": 1, "error": "Элемент не найден"}, screenshot="fail.jpg")
    check(record.ok is False and record.completed == 1, "finish copies ok/completed")
    check(record.error == "Элемент не найден" and record.screenshot == "fail.jpg", "finish copies error/screenshot")
    check(record.finished >= record.started and record.duration_ms >= 0, "timestamps are consistent")
    check(history.get(record.id) is record and history.get("nope") is None, "get by id")
    with open(os.path.join(tmp, "runs.json"), encoding="utf-8") as fh:
        saved = json.load(fh)
    check(len(saved) == 1 and saved[0]["id"] == record.id, "finish persists the journal")
    check(not any(name.endswith(".tmp") for name in os.listdir(tmp)), "atomic write leaves no temp file")

    ok_record = history.begin("macro", steps=steps, macro_name="login", url="https://example.com")
    history.finish(ok_record, {"ok": True, "completed": 2})
    check(ok_record.ok is True and ok_record.error == "", "successful run has no error")
    check(ok_record.title == "макрос «login»" and record.title == "сценарий", "human titles")

    reloaded = RunHistory(os.path.join(tmp, "runs.json"))
    check([r["id"] for r in reloaded.list()] == [ok_record.id, record.id], "reload keeps order (newest first)")


def test_list_filters(tmp):
    history = RunHistory(os.path.join(tmp, "runs2.json"))
    for i in range(5):
        source = "trigger" if i % 2 else "macro"
        record = history.begin(source, steps=[Step(action="wait", value="1")], macro_name=f"m{i % 2}")
        history.finish(record, {"ok": True, "completed": 1})
    check(len(history.list(limit=2)) == 2, "limit applies")
    check(all(r["source"] == "trigger" for r in history.list(source="trigger")), "source filter")
    check(len(history.list(source="trigger")) == 2, "source filter count")
    check(len(history.list(macro_name="m0")) == 3, "macro filter")
    check(history.list()[0]["started"] >= history.list()[-1]["started"], "newest first")


def test_ring_limit(tmp):
    path = os.path.join(tmp, "runs3.json")
    history = RunHistory(path, limit=500)
    first = None
    for i in range(520):
        record = history.begin("startup", steps=[], job_id=f"j{i}")
        if i == 0:
            first = record.id
        history.finish(record, {"ok": True, "completed": 0})
    check(len(history.records) == 500, "journal keeps 500 records")
    check(history.get(first) is None, "oldest records are evicted")
    check(history.list(limit=1)[0]["job_id"] == "j519", "newest record is the last begun")
    check(len(history.list(limit=1000)) == 500, "list never exceeds the ring")
    with open(path, encoding="utf-8") as fh:
        check(len(json.load(fh)) == 500, "file holds at most 500")


def test_summary_masks_secrets():
    steps = [
        Step(action="fill", kind="label", query="Пароль", value="S3cret!pass"),
        Step(action="type", value="hunter2"),
        Step(action="fill", kind="css", query="#email", value="me@example.com"),
        Step(action="press", value="Enter"),
        Step(action="scroll", value="600"),
        Step(action="wait", value="1500", optional=True),
        Step(action="point", x=0.5, y=0.25),
        Step(action="click", kind="role", role="link", query="Далее", name="next"),
    ]
    summary = summarize_steps(steps)
    joined = "\n".join(summary)
    check("S3cret!pass" not in joined and "hunter2" not in joined, "passwords are never in the summary")
    check("me@example.com" not in joined, "typed text is masked too")
    check(summary[0] == "fill label=Пароль = •••", f"masked fill: {summary[0]}")
    check(summary[3] == "press = Enter" and summary[4] == "scroll = 600", "safe values are shown")
    check("(необязательный)" in summary[5], "optional flag is shown")
    check("(0.50, 0.25)" in summary[6], "coordinates are shown")
    check(summary[7] == "click [next] role:link=Далее", f"role and name: {summary[7]}")
    long_steps = [{"action": "click", "kind": "css", "query": "x" * 300}] * 250
    long_summary = summarize_steps(long_steps)
    check(len(long_summary) == 201 and long_summary[-1] == "… ещё 50", "summary is capped at 200 items")
    check(all(len(line) <= 100 for line in long_summary), "lines are capped at 100 chars")


def test_interrupted_run_on_reload(tmp):
    path = os.path.join(tmp, "runs4.json")
    history = RunHistory(path)
    record = history.begin("steps", steps=[Step(action="wait", value="1")])
    history.save()                       # simulate a crash while the run is open
    reloaded = RunHistory(path)
    loaded = reloaded.get(record.id)
    check(loaded is not None and loaded.ok is False and "Прервано" in loaded.error, "open runs become failed on reload")


def test_notify_settings_and_message(tmp):
    path = os.path.join(tmp, "notify.json")
    check(notify.load_settings(path).enabled is False, "missing file -> disabled defaults")
    settings = notify.merge_settings(notify.NotifySettings(), {
        "telegram_bot_token": "123456:ABCDEFGHIJ", "telegram_chat_id": "-100777",
        "discord_webhook_url": "https://discord.com/api/webhooks/1/abcdef", "on": ["error", "success"]})
    check(notify.validate_settings(settings) is None, "valid settings pass")
    notify.save_settings(path, settings)
    again = notify.load_settings(path)
    check(again.telegram_bot_token == "123456:ABCDEFGHIJ" and again.enabled, "settings round-trip")
    shown = notify.masked(again)
    check("123456:ABCDEFGHIJ" not in json.dumps(shown) and shown["telegram_bot_token"].endswith("GHIJ"), "token masked")
    check("abcdef" not in shown["discord_webhook_url"][:-6] and shown["discord_webhook_url"].startswith("•••"), "webhook masked")
    check(shown["telegram_configured"] and shown["discord_configured"], "configured flags")
    kept = notify.merge_settings(again, {"telegram_bot_token": shown["telegram_bot_token"], "telegram_chat_id": "42"})
    check(kept.telegram_bot_token == "123456:ABCDEFGHIJ" and kept.telegram_chat_id == "42", "masked token keeps stored value")
    bad = notify.merge_settings(again, {"discord_webhook_url": "http://evil"})
    check(notify.validate_settings(bad) is not None, "non-https webhook rejected")

    record = RunRecord(id="r1", started=time.time() - 1, finished=time.time(), source="trigger", macro_name="cookies",
                       url="https://example.com/page", total=3, completed=1, ok=False, error="Элемент не найден",
                       screenshot="fail-trigger-j1-0-1.jpg", duration_ms=1000, worker_id="j1-0")
    text = notify.format_message(record, "http://host:8010/")
    check(text.startswith("Катя: триггер «cookies» — ❌ ошибка"), f"message header: {text.splitlines()[0]}")
    check("Шагов: 1 из 3" in text and "http://host:8010/api/files/fail-trigger-j1-0-1.jpg" in text, "steps and link")
    check("Элемент не найден" in text, "error in message")

    async def filtered():
        off = notify.NotifySettings(telegram_bot_token="1:a", telegram_chat_id="1", on=["success"])
        return await notify.notify(record, off)
    outcome = asyncio.run(filtered())
    check(outcome["sent"] == [] and "skipped" in outcome, "outcome filter skips without network")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        test_begin_finish(tmp)
        test_list_filters(tmp)
        test_ring_limit(tmp)
        test_summary_masks_secrets()
        test_interrupted_run_on_reload(tmp)
        test_notify_settings_and_message(tmp)
    print(f"OK: {CHECKS} checks passed")


if __name__ == "__main__":
    main()
