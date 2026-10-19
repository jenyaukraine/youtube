"""MCP server: lets AI agents (Claude Code, Codex, OpenClaw, Cursor...) drive Katya tabs.

It is a thin bridge over the HTTP API, so the dashboard and the agents share
the same browser sessions. Run it with stdio transport:

    python -m katya.mcp_server

Environment:
    KATYA_URL        base URL of the running app (default http://127.0.0.1:8010)
    KATYA_API_TOKEN  API token; if unset, data/api_token.txt next to app.py is read
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
try:
    from mcp.server.mcpserver import MCPServer as FastMCP, Image  # mcp >= 2
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP, Image

logging.getLogger("httpx").setLevel(logging.WARNING)

BASE_URL = os.environ.get("KATYA_URL", "http://127.0.0.1:8010").rstrip("/")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _token() -> str:
    token = os.environ.get("KATYA_API_TOKEN", "").strip()
    if token:
        return token
    path = os.path.join(os.environ.get("KATYA_DATA_DIR", os.path.join(ROOT, "data")), "api_token.txt")
    try:
        with open(path, encoding="ascii") as fh:
            return fh.read().strip()
    except FileNotFoundError:
        return ""


mcp = FastMCP(
    "katya-browser",
    instructions=(
        "Katya Browser Lab controls real Chromium tabs. Typical flow: katya_open(url) -> "
        "katya_text / katya_screenshot to see the page -> katya_run(steps) to act -> katya_close. "
        "Every step is {action, kind, query, value, x, y, nth, timeout_ms, optional}. "
        "Actions: navigate, reload, back, click, wait_click, dblclick, point, inspect, fill, type, press, "
        "hover, drag, scroll, select, wait, wait_for, wait_gone, wait_url, text, attribute, exists, count, "
        "screenshot, page_text. kind: css, text, role, label, placeholder, xpath."
    ),
)


async def _call(method: str, path: str, **kwargs) -> Dict[str, Any]:
    headers = {"X-Katya-Token": _token()}
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as client:
            response = await client.request(method, path, headers=headers, **kwargs)
    except httpx.HTTPError as e:
        return {"ok": False, "error": f"Katya app is not reachable at {BASE_URL} ({e.__class__.__name__}). "
                                      "Start it first (Start-Katya.bat or python app.py) or set KATYA_URL."}
    if response.headers.get("content-type", "").startswith("image/"):
        return {"ok": True, "image": response.content}
    try:
        return response.json()
    except ValueError:
        return {"ok": False, "error": f"HTTP {response.status_code}: {response.text[:200]}"}


def _pretty(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1)


@mcp.tool()
async def katya_status() -> str:
    """Server status: running jobs, their tabs (worker ids), states, system load."""
    data = await _call("GET", "/api/status")
    data.pop("log", None)
    return _pretty(data)


@mcp.tool()
async def katya_tabs() -> str:
    """List open tabs with job_id and worker_id needed by the other tools."""
    data = await _call("GET", "/api/jobs")
    tabs = []
    for job in data.get("jobs", []):
        for worker in job.get("workers_list", []):
            if worker["state"] != "stopped":
                tabs.append({"job_id": job["id"], "worker_id": worker["id"], "url": worker["url"],
                             "state": worker["state"], "profile": worker.get("profile", "")})
    return _pretty({"ok": data.get("ok", False), "tabs": tabs, "error": data.get("error")})


@mcp.tool()
async def katya_open(url: str, tabs: int = 1, headers: Optional[Dict[str, str]] = None,
                     dialogs: str = "dismiss", profile: str = "", duration_seconds: int = 0) -> str:
    """Open a URL in one or more new isolated tabs (each gets a random popular user agent unless
    `profile` names one from katya_profiles). Returns job_id and worker_ids."""
    payload = {"url": url, "workers": tabs, "duration": duration_seconds, "headers": headers or {},
               "dialogs": dialogs, "profile": profile, "user_agent_mode": "random"}
    return _pretty(await _call("POST", "/api/start", json=payload))


@mcp.tool()
async def katya_close(job_id: str, worker_id: str = "") -> str:
    """Close one tab (worker_id) or, with empty worker_id, every tab of the job."""
    if worker_id:
        return _pretty(await _call("POST", f"/api/worker/{job_id}/{worker_id}/stop"))
    data = await _call("GET", "/api/jobs")
    results = []
    for job in data.get("jobs", []):
        if job["id"] == job_id:
            for worker in job.get("workers_list", []):
                results.append(await _call("POST", f"/api/worker/{job_id}/{worker['id']}/stop"))
    return _pretty(results or {"ok": False, "error": "job not found"})


@mcp.tool()
async def katya_stop_all() -> str:
    """Close every tab and browser."""
    return _pretty(await _call("POST", "/api/stop"))


@mcp.tool()
async def katya_action(job_id: str, worker_id: str, action: str, kind: str = "css", query: str = "",
                       value: str = "", x: float = 0, y: float = 0, nth: int = 0,
                       timeout_ms: int = 7000) -> str:
    """Run one action in a tab. Examples: click kind=text query="Accept all";
    fill kind=label query="Email" value="a@b.c"; press value="Enter"; navigate value=URL;
    point x=0.5 y=0.4 (fractions of the viewport); scroll value="600"; text kind=css query="h1"."""
    payload = {"action": action, "kind": kind, "query": query, "value": value, "x": x, "y": y,
               "nth": nth, "timeout_ms": timeout_ms}
    return _pretty(await _call("POST", f"/api/worker/{job_id}/{worker_id}/action", json=payload))


@mcp.tool()
async def katya_run(job_id: str, worker_id: str, steps: List[Dict[str, Any]], delay_ms: int = 300) -> str:
    """Run a list of steps (a macro) in order; stops at the first failing non-optional step.
    Each step: {"action": ..., "kind": ..., "query": ..., "value": ..., "optional": false}."""
    return _pretty(await _call("POST", f"/api/worker/{job_id}/{worker_id}/steps",
                               json={"steps": steps, "delay_ms": delay_ms}))


@mcp.tool()
async def katya_text(job_id: str, worker_id: str, limit: int = 20000) -> str:
    """Visible text of the page (main content first) plus its title and URL."""
    return _pretty(await _call("GET", f"/api/worker/{job_id}/{worker_id}/text", params={"limit": limit}))


@mcp.tool()
async def katya_screenshot(job_id: str, worker_id: str) -> Image:
    """Fresh JPEG screenshot of the tab."""
    data = await _call("GET", f"/api/worker/{job_id}/{worker_id}/screenshot", params={"force": 1})
    if "image" not in data:
        raise RuntimeError(data.get("error", "screenshot failed"))
    return Image(data=data["image"], format="jpeg")


@mcp.tool()
async def katya_inspect(job_id: str, worker_id: str, x: float, y: float) -> str:
    """Describe the element at a viewport point (fractions 0..1): CSS selector, tag, text, box."""
    return _pretty(await _call("POST", f"/api/worker/{job_id}/{worker_id}/action",
                               json={"action": "inspect", "x": x, "y": y}))


@mcp.tool()
async def katya_profiles() -> str:
    """Available browser identity profiles (user agent + viewport)."""
    return _pretty(await _call("GET", "/api/profiles"))


@mcp.tool()
async def katya_triggers() -> str:
    """List trigger rules ("when element X is visible, run steps Y")."""
    return _pretty(await _call("GET", "/api/triggers"))


@mcp.tool()
async def katya_trigger_add(name: str, when_kind: str, when_query: str, then: List[Dict[str, Any]],
                            when_role: str = "button", job_id: str = "", once_per_page: bool = False,
                            cooldown_ms: int = 5000) -> str:
    """Add a trigger. when_kind: css|text|role|label|placeholder|xpath|url (url = regex on page URL).
    `then` is a list of steps. Empty job_id applies to every tab."""
    payload = {"name": name, "when": {"kind": when_kind, "query": when_query, "role": when_role},
               "then": then, "job_id": job_id, "once_per_page": once_per_page, "cooldown_ms": cooldown_ms}
    return _pretty(await _call("POST", "/api/triggers", json=payload))


@mcp.tool()
async def katya_trigger_delete(trigger_id: str) -> str:
    """Delete a trigger by id."""
    return _pretty(await _call("DELETE", f"/api/triggers/{trigger_id}"))


@mcp.tool()
async def katya_macros() -> str:
    """List saved macros."""
    return _pretty(await _call("GET", "/api/macros"))


@mcp.tool()
async def katya_macro_save(name: str, steps: List[Dict[str, Any]], description: str = "") -> str:
    """Save (or overwrite) a named macro for later replay."""
    return _pretty(await _call("POST", "/api/macros", json={"name": name, "steps": steps, "description": description}))


@mcp.tool()
async def katya_macro_run(name: str, job_id: str, worker_id: str) -> str:
    """Replay a saved macro in a tab."""
    return _pretty(await _call("POST", f"/api/macros/{name}/run", json={"job_id": job_id, "worker_id": worker_id}))


@mcp.tool()
async def katya_schedules() -> str:
    """List scheduled macro runs with their next_run, last_run and last_result."""
    return _pretty(await _call("GET", "/api/schedules"))


@mcp.tool()
async def katya_schedule_add(macro_name: str, cron: str = "", every_minutes: int = 0, url: str = "",
                             enabled: bool = True, workers: int = 1, schedule_id: str = "") -> str:
    """Schedule a saved macro: `cron` (5 fields, e.g. "0 9 * * 1-5", "*/30 * * * *") or `every_minutes`.
    Empty url = the macro's start_url. Pass schedule_id to update an existing schedule."""
    payload = {"id": schedule_id, "macro_name": macro_name, "cron": cron, "every_minutes": every_minutes,
               "url": url, "enabled": enabled, "workers": workers}
    return _pretty(await _call("POST", "/api/schedules", json=payload))


@mcp.tool()
async def katya_schedule_delete(schedule_id: str) -> str:
    """Delete a schedule by id."""
    return _pretty(await _call("DELETE", f"/api/schedules/{schedule_id}"))


@mcp.tool()
async def katya_schedule_run(schedule_id: str) -> str:
    """Run a schedule's macro right now (in a new tab that closes when the macro finishes)."""
    return _pretty(await _call("POST", f"/api/schedules/{schedule_id}/run"))


@mcp.tool()
async def katya_files() -> str:
    """List stored files: screenshots taken with the `screenshot` step and browser downloads."""
    return _pretty(await _call("GET", "/api/files"))


@mcp.tool()
async def katya_file(name: str) -> Any:
    """Fetch a stored file. Images are returned as images, other files as base64 (up to 2 MB)."""
    headers = {"X-Katya-Token": _token()}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=60) as client:
        response = await client.get(f"/api/files/{name}", headers=headers)
    if response.status_code != 200:
        return response.text
    kind = response.headers.get("content-type", "")
    if kind.startswith("image/"):
        return Image(data=response.content, format=kind.split("/", 1)[1].split(";")[0])
    body = response.content[:2_000_000]
    return _pretty({"name": name, "content_type": kind, "size": len(response.content),
                    "base64": base64.b64encode(body).decode("ascii")})


if __name__ == "__main__":
    mcp.run()
