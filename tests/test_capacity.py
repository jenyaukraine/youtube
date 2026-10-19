from types import SimpleNamespace

import app


def test_tab_limit_counts_all_jobs(monkeypatch):
    monkeypatch.setattr(app, "MAX_WORKERS", 4)
    monkeypatch.setattr(app, "system_metrics", lambda: {"memory_percent": 25})
    monkeypatch.setattr(app, "JOBS", {
        "first": SimpleNamespace(status="running", workers=2, workers_list=[SimpleNamespace(state="ready"), SimpleNamespace(state="ready")]),
        "second": SimpleNamespace(status="pending", workers=1, workers_list=[]),
    })
    assert app.launch_capacity_error(1) is None
    assert "Общий лимит: 4" in app.launch_capacity_error(2)


def test_high_memory_prevents_new_tabs(monkeypatch):
    monkeypatch.setattr(app, "MAX_WORKERS", 8)
    monkeypatch.setattr(app, "MAX_MEMORY_PERCENT", 90)
    monkeypatch.setattr(app, "JOBS", {})
    monkeypatch.setattr(app, "system_metrics", lambda: {"memory_percent": 91.4})
    assert "91.4%" in app.launch_capacity_error(1)
