"""Run with: python tests/test_cli.py (needs Playwright Chromium, no pytest)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["KATYA_SCENARIO_DELAY"] = "0"

from katya.runner import run_scenario  # noqa: E402

PAGE = b"""<!doctype html><html><body>
<h1 id="title">Fixture</h1>
<input id="name" placeholder="Name">
<button id="btn" onclick="document.getElementById('out').textContent='hello '+document.getElementById('name').value">Say hi</button>
<p id="out"></p>
</body></html>"""


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *_):
        pass


def cli(*args, cwd=None):
    proc = subprocess.run([sys.executable, "-m", "katya.cli", *args], cwd=cwd or ROOT,
                          capture_output=True, text=True, encoding="utf-8", errors="replace",
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    return proc.returncode, proc.stdout, proc.stderr


def scenario(url=""):
    return {
        "name": "fixture", "start_url": url, "settings": {"headers": {"Accept-Language": "en-US"}},
        "variables": {"who": "world"},
        "steps": [
            {"action": "fill", "kind": "css", "query": "#name", "value": "{{who}}"},
            {"action": "click", "kind": "css", "query": "#btn"},
            {"action": "text", "kind": "css", "query": "#out", "timeout_ms": 3000},
            {"action": "wait", "value": "100"},
        ],
    }


def test_validate(tmp: Path):
    good = tmp / "good.json"
    good.write_text(json.dumps(scenario("http://127.0.0.1:1/")), encoding="utf-8")
    code, out, err = cli("validate", str(good))
    assert code == 0, (code, out, err)
    assert "OK" in out and "who" in out, out

    broken = tmp / "broken.json"
    broken.write_text(json.dumps({"name": "x", "start_url": "nope", "steps": [
        {"action": "click", "kind": "css", "query": ""},          # element required
        {"action": "fly"},                                        # unknown action
        {"action": "wait", "value": "1", "timeout_ms": 1},        # timeout out of range
    ]}), encoding="utf-8")
    code, out, err = cli("validate", str(broken))
    assert code == 1, (code, out, err)
    assert "fly" in out or "action" in out, out

    code, out, err = cli("validate", str(broken), "--json")
    data = json.loads(out)
    assert data["ok"] is False and data["problems"], data

    broken2 = tmp / "broken2.json"
    broken2.write_text(json.dumps({"name": "x", "steps": [{"action": "click", "kind": "css", "query": ""},
                                                           {"action": "wait", "value": "1", "timeout_ms": 1}]}),
                       encoding="utf-8")
    code, out, _ = cli("validate", str(broken2), "--json")
    problems = json.loads(out)["problems"]
    assert code == 1 and len(problems) == 2, problems
    print("validate: ok")


def test_run(tmp: Path, url: str):
    report = run_scenario(scenario(url), screenshots_dir=str(tmp / "shots"))
    assert report["ok"] is True, report
    assert report["completed"] == 4 and report["total"] == 4, report
    assert report["results"][2]["text"] == "hello world", report["results"]
    assert report["error"] is None and report["screenshot"] is None
    assert report["duration_ms"] > 0

    # variables override the stored value; --url overrides start_url; {n} expands per repeat
    events = []
    report = run_scenario(scenario(), url=url, variables={"who": "run {n}"}, repeat=2, on_step=events.append)
    assert report["ok"], report
    assert report["completed"] == 8 and report["total"] == 8, report
    texts = [r["text"] for r in report["results"] if r.get("text") is not None]
    assert texts == ["hello run 1", "hello run 2"], texts
    assert {e["repeat"] for e in events} == {1, 2} and any(e["status"] == "done" for e in events)

    # missing variable is a clear error without launching the browser
    bare = scenario(url)
    bare["variables"] = {}
    report = run_scenario(bare)
    assert report["ok"] is False and "who" in report["error"], report

    # {{password}} is never read from the scenario file
    secret = scenario(url)
    secret["variables"] = {"who": "x", "password": "stored"}
    secret["steps"][0]["value"] = "{{password}}"
    report = run_scenario(secret)
    assert report["ok"] is False and "password" in report["error"], report
    report = run_scenario(secret, variables={"password": "given"})
    assert report["ok"] and report["results"][2]["text"] == "hello given", report

    # a failing step stops the run, reports the step number and leaves an error screenshot
    failing = scenario(url)
    failing["steps"].insert(2, {"action": "click", "kind": "css", "query": "#missing", "timeout_ms": 500})
    report = run_scenario(failing, screenshots_dir=str(tmp / "shots"))
    assert report["ok"] is False and report["completed"] == 2 and report["total"] == 5, report
    assert "Шаг 3" in report["error"], report["error"]
    assert report["screenshot"] and os.path.isfile(report["screenshot"]), report
    print("run: ok")


def test_cli_run(tmp: Path, url: str):
    path = tmp / "cli.json"
    path.write_text(json.dumps(scenario()), encoding="utf-8")
    code, out, err = cli("run", str(path), "--url", url, "--var", "who=cli", "--json")
    assert code == 0, (code, out, err)
    data = json.loads(out)
    assert data["ok"] and data["completed"] == 4 and data["results"][2]["text"] == "hello cli", data

    code, out, err = cli("run", str(path), "--url", url, "--var", "who=human")
    assert code == 0, (code, out, err)
    assert "Заполнить" in out and "Клик:" in out and "Пауза 0.1 с" in out and "hello human" in out, out

    code, out, err = cli("run", str(path), "--url", url)   # variable from the file
    assert code == 0 and "hello world" in out, (code, out, err)

    code, out, err = cli("run", str(path))   # no URL at all
    assert code == 1 and "адрес" in err, (code, out, err)
    print("cli run: ok")


def main():
    server = HTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    with tempfile.TemporaryDirectory() as folder:
        tmp = Path(folder)
        test_validate(tmp)
        test_run(tmp, url)
        test_cli_run(tmp, url)
    server.shutdown()
    print("all tests passed")


if __name__ == "__main__":
    main()
