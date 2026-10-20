import asyncio

import app


def test_browser_launch_failure_is_visible_in_job_snapshot(monkeypatch):
    class BrokenPlaywright:
        async def start(self):
            raise RuntimeError("browser executable missing")

    monkeypatch.setattr(app, "async_playwright", BrokenPlaywright)
    job = app.Job("launch-test", "http://example.test", 1, 0, [])

    asyncio.run(app.run_job(job))

    assert job.status == "error"
    assert "browser executable missing" in job.snapshot()["launch_error"]
