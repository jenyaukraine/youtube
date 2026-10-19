"""Scheduler tests: cron next_run and load/save.

Run with: python tests/test_scheduler.py   (or python -m pytest tests/test_scheduler.py)
"""
import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from katya.scheduler import (CronSpec, Schedule, Scheduler, compute_next_run, format_result,  # noqa: E402
                             next_cron_run, validate_schedule)


def nxt(expr, *after):
    return CronSpec(expr).next_after(datetime(*after))


# ---- cron parsing ----
def test_parse_fields():
    spec = CronSpec("*/15 9-18 1,15 jan,jul mon-fri")
    assert spec.minutes == {0, 15, 30, 45}
    assert spec.hours == set(range(9, 19))
    assert spec.days == {1, 15}
    assert spec.months == {1, 7}
    assert spec.dows == {1, 2, 3, 4, 5}
    assert CronSpec("0 0 * * 7").dows == {0}
    assert CronSpec("0 0 * * 0,7").dows == {0}
    assert CronSpec("1-30/10 * * * *").minutes == {1, 11, 21}
    assert CronSpec("5/20 * * * *").minutes == {5, 25, 45}
    assert CronSpec("  0   12 *  *  * ").expression == "0 12 * * *"


def test_parse_errors():
    for bad in ("* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8",
                "a * * * *", "*/0 * * * *", "10-5 * * * *", "1,,2 * * * *", "", "* * * * * *"):
        try:
            CronSpec(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted invalid cron {bad!r}")


# ---- next_run ----
def test_every_15_minutes():
    assert nxt("*/15 * * * *", 2026, 10, 19, 10, 7) == datetime(2026, 10, 19, 10, 15)
    assert nxt("*/15 * * * *", 2026, 10, 19, 10, 15) == datetime(2026, 10, 19, 10, 30)   # strictly after
    assert nxt("*/15 * * * *", 2026, 10, 19, 10, 15, 30) == datetime(2026, 10, 19, 10, 30)
    assert nxt("*/15 * * * *", 2026, 10, 19, 23, 50) == datetime(2026, 10, 20, 0, 0)       # day boundary


def test_daily_at_time():
    assert nxt("30 9 * * *", 2026, 10, 19, 8, 0) == datetime(2026, 10, 19, 9, 30)
    assert nxt("30 9 * * *", 2026, 10, 19, 9, 30) == datetime(2026, 10, 20, 9, 30)
    assert nxt("30 9 * * *", 2026, 10, 19, 12, 0) == datetime(2026, 10, 20, 9, 30)


def test_weekdays():
    # 17 Oct 2026 is a Saturday -> next weekday run is Monday 19 Oct 09:00
    assert nxt("0 9 * * 1-5", 2026, 10, 17, 10, 0) == datetime(2026, 10, 19, 9, 0)
    # Friday evening -> Monday
    assert nxt("0 9 * * mon-fri", 2026, 10, 16, 10, 0) == datetime(2026, 10, 19, 9, 0)
    # Sunday as 0 and as 7
    assert nxt("0 12 * * 0", 2026, 10, 19, 0, 0) == datetime(2026, 10, 25, 12, 0)
    assert nxt("0 12 * * 7", 2026, 10, 19, 0, 0) == datetime(2026, 10, 25, 12, 0)
    assert nxt("0 12 * * sun", 2026, 10, 25, 12, 0) == datetime(2026, 11, 1, 12, 0)


def test_month_boundaries():
    assert nxt("0 0 1 * *", 2026, 1, 31, 23, 59) == datetime(2026, 2, 1, 0, 0)
    assert nxt("0 0 1 * *", 2026, 2, 1, 0, 0) == datetime(2026, 3, 1, 0, 0)
    # 31st: February and April are skipped
    assert nxt("30 23 31 * *", 2026, 1, 31, 23, 30) == datetime(2026, 3, 31, 23, 30)
    assert nxt("30 23 31 * *", 2026, 3, 31, 23, 30) == datetime(2026, 5, 31, 23, 30)
    # year rollover
    assert nxt("0 0 1 1 *", 2026, 12, 31, 23, 59) == datetime(2027, 1, 1, 0, 0)
    assert nxt("0 0 1 1 *", 2026, 1, 1, 0, 0) == datetime(2027, 1, 1, 0, 0)
    # month restriction jumps straight to that month
    assert nxt("0 8 * 7 *", 2026, 10, 19, 10, 0) == datetime(2027, 7, 1, 8, 0)
    # 29 February only in leap years
    assert nxt("0 0 29 2 *", 2026, 1, 1, 0, 0) == datetime(2028, 2, 29, 0, 0)


def test_day_of_month_or_day_of_week():
    # both restricted: classic cron fires when either matches.
    # 2 Jan 2026 is a Friday; next Monday is 5 Jan, which comes before 1 Feb.
    assert nxt("0 0 1 * 1", 2026, 1, 2, 0, 0) == datetime(2026, 1, 5, 0, 0)
    # 30 Jan 2026 is a Friday; 1 Feb (Sunday) comes before Monday 2 Feb.
    assert nxt("0 0 1 * 1", 2026, 1, 30, 0, 0) == datetime(2026, 2, 1, 0, 0)
    # only day-of-week restricted: day-of-month is ignored
    assert nxt("0 0 * * 1", 2026, 1, 2, 0, 0) == datetime(2026, 1, 5, 0, 0)


def test_never_matching_cron():
    try:
        nxt("0 0 31 2 *", 2026, 1, 1, 0, 0)
    except ValueError:
        return
    raise AssertionError("30 February should never match")


def test_next_cron_run_timestamps():
    after = datetime(2026, 10, 19, 10, 7).timestamp()
    assert next_cron_run("*/15 * * * *", after) == datetime(2026, 10, 19, 10, 15).timestamp()
    assert next_cron_run("0 0 * * *", after) == datetime(2026, 10, 20, 0, 0).timestamp()


def test_compute_next_run_every_minutes():
    schedule = Schedule(macro_name="m", every_minutes=5)
    assert compute_next_run(schedule, 1000.0) == 1300.0
    schedule = Schedule(macro_name="m", cron="0 * * * *")
    after = datetime(2026, 10, 19, 10, 7).timestamp()
    assert compute_next_run(schedule, after) == datetime(2026, 10, 19, 11, 0).timestamp()


# ---- validation ----
def test_validate_schedule():
    assert validate_schedule(Schedule(macro_name="m", cron="*/5 * * * *")) is None
    assert validate_schedule(Schedule(macro_name="m", every_minutes=1)) is None
    assert validate_schedule(Schedule(macro_name="m")) is not None                        # neither
    assert validate_schedule(Schedule(macro_name="m", cron="* * * * *", every_minutes=1)) is not None  # both
    assert validate_schedule(Schedule(macro_name="m", cron="* * * *")) is not None         # 4 fields
    assert validate_schedule(Schedule(macro_name="m", every_minutes=0)) is not None
    assert validate_schedule(Schedule(macro_name="m", every_minutes=10081)) is not None
    assert validate_schedule(Schedule(macro_name="m", every_minutes=1, workers=0)) is not None
    assert validate_schedule(Schedule(macro_name="m", every_minutes=1, workers=65)) is not None


def test_format_result():
    assert format_result({"ok": True, "completed": 3, "total": 3}, 12.34) == "ok: 3 шагов за 12.3 с"
    assert format_result({"ok": False, "completed": 1, "total": 3, "error": "boom"}, 2.0) \
        == "ошибка: boom (1/3 шагов, 2.0 с)"


# ---- load / save ----
def test_load_save_roundtrip():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "nested", "schedules.json")
        messages = []
        scheduler = Scheduler(path, log=messages.append)
        assert scheduler.schedules == {}
        now = datetime(2026, 10, 19, 10, 7).timestamp()
        saved = scheduler.add(Schedule(macro_name="daily", cron=" 0  9 * * * ", url="https://example.com"), now=now)
        assert saved.id and len(saved.id) == 8
        assert saved.cron == "0 9 * * *"
        assert saved.next_run == datetime(2026, 10, 20, 9, 0).timestamp()
        every = scheduler.add(Schedule(macro_name="often", every_minutes=2, enabled=False), now=now)
        assert every.next_run == 0.0                                  # disabled: no next run
        assert os.path.isfile(path) and not os.path.exists(path + ".tmp")
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        assert [item["macro_name"] for item in raw] == ["daily", "often"]

        reloaded = Scheduler(path)
        assert set(reloaded.schedules) == {saved.id, every.id}
        copy = reloaded.schedules[saved.id]
        assert copy.cron == "0 9 * * *" and copy.url == "https://example.com" and copy.next_run == saved.next_run
        assert reloaded.schedules[every.id].enabled is False

        # enable -> next_run computed; update keeps history; delete
        assert reloaded.set_enabled(every.id, True, now=now)
        assert reloaded.schedules[every.id].next_run == now + 120
        reloaded.schedules[saved.id].last_run = 5.0
        reloaded.schedules[saved.id].last_result = "ok: 1 шагов за 1.0 с"
        updated = reloaded.add(Schedule(id=saved.id, macro_name="daily", cron="0 10 * * *"), now=now)
        assert updated.last_run == 5.0 and updated.last_result.startswith("ok")
        assert updated.next_run == datetime(2026, 10, 20, 10, 0).timestamp()   # 10:07 is past 10:00
        assert reloaded.remove(every.id) and not reloaded.remove(every.id)
        assert not reloaded.set_enabled("missing", True)
        assert [s["id"] for s in Scheduler(path).snapshot()] == [saved.id]
        assert messages == []


def test_load_broken_file_is_logged():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "schedules.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        messages = []
        scheduler = Scheduler(path, log=messages.append)
        assert scheduler.schedules == {}
        assert messages and "load failed" in messages[0]


# ---- due detection and execution ----
def test_tick_runs_due_schedule_and_records_result():
    async def scenario():
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "schedules.json")
            calls = []

            async def runner(schedule):
                calls.append(schedule.id)
                await asyncio.sleep(0.01)
                return {"ok": True, "completed": 2, "total": 2}

            scheduler = Scheduler(path, runner=runner)
            due = scheduler.add(Schedule(macro_name="m", every_minutes=1), now=100.0)
            later = scheduler.add(Schedule(macro_name="m", every_minutes=60), now=100.0)
            off = scheduler.add(Schedule(macro_name="m", every_minutes=1, enabled=False), now=100.0)
            assert scheduler.due(now=100.0) == []
            started = scheduler.tick(now=170.0)
            assert [s.id for s in started] == [due.id]
            assert due.id in scheduler.running
            assert scheduler.tick(now=170.0) == []           # not started twice while running
            await asyncio.sleep(0.05)
            assert calls == [due.id]
            assert due.id not in scheduler.running
            assert due.last_result == "ok: 2 шагов за 0.0 с" or due.last_result.startswith("ok: 2 шагов")
            assert due.last_run >= 100.0 and due.next_run == due.last_run + 60
            assert later.last_run == 0.0 and off.last_run == 0.0
            assert Scheduler(path).schedules[due.id].last_result == due.last_result

            # run_now on a schedule whose runner fails
            async def failing(schedule):
                raise RuntimeError("browser down")
            scheduler.runner = failing
            assert scheduler.run_now("missing") == "Расписание не найдено"
            assert scheduler.run_now(later.id) is None
            await asyncio.sleep(0.02)
            assert later.last_result.startswith("ошибка: browser down")
            await scheduler.stop()

    asyncio.run(scenario())


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"ok   {name}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}: {e.__class__.__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
