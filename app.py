"""Katya Browser Lab: Playwright browser sessions with a dashboard, uniform actions,
triggers, macros, a file store and an HTTP API usable by AI agents (see app/mcp_server.py)."""
import asyncio
import json
import os
import re
import secrets
import sys
import time
import uuid
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, Header, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from playwright.async_api import async_playwright, Browser, Page, Playwright

from katya.actions import Macro, Step, normalize_url, run_step, run_steps, validate_step
from katya.profiles import PROFILES, context_options, find_profile
from katya.triggers import Trigger, TriggerEngine, validate_trigger

app = FastAPI(title="Katya Browser Lab")

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA = os.environ.get("KATYA_DATA_DIR", os.path.join(ROOT, "data"))
FILES_DIR = os.path.join(DATA, "files")
MACROS_PATH = os.path.join(DATA, "macros.json")
HEADLESS = os.environ.get("KATYA_HEADLESS", "1") not in ("0", "false", "no")
BROWSER_CHANNEL = os.environ.get("KATYA_BROWSER_CHANNEL", "").strip()
if not BROWSER_CHANNEL and os.name == "nt":
    chrome_path = os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"),
                               "Google", "Chrome", "Application", "chrome.exe")
    if os.path.isfile(chrome_path):
        BROWSER_CHANNEL = "chrome"
MAX_WORKERS = max(1, min(int(os.environ.get("KATYA_MAX_TABS", "8")), 64))
os.makedirs(FILES_DIR, exist_ok=True)


def _load_api_token() -> str:
    """API token for agents (MCP, scripts). Generated once and kept in data/api_token.txt."""
    token = os.environ.get("KATYA_API_TOKEN", "").strip()
    if token:
        return token
    path = os.path.join(DATA, "api_token.txt")
    try:
        with open(path, encoding="ascii") as fh:
            token = fh.read().strip()
    except FileNotFoundError:
        token = ""
    if not token:
        token = secrets.token_urlsafe(32)
        with open(path, "w", encoding="ascii") as fh:
            fh.write(token)
    return token


API_TOKEN = _load_api_token()

# ---------------- state ----------------
class Worker:
    def __init__(self, wid, url, cookies=None, ua=None, profile=""):
        self.id = wid
        self.url = url
        self.cookies = cookies or []
        self.ua = ua
        self.profile = profile
        self.state = "starting"      # starting|checking|blocked|paused|watching|reloading|error|stopped
        self.watch_seconds = 0.0
        self.loop = 0
        self.last_action = ""
        self.error = ""
        self.started = time.time()
        self.triggers_fired = 0
        self.scenario_phase = ""
        self.scenario_completed = 0
        self.scenario_current = -1
        self.scenario_total = 0
        self.scenario_wait_until = 0.0

    def snapshot(self):
        return {
            "id": self.id,
            "url": self.url,
            "user_agent": self.ua,
            "profile": self.profile,
            "state": self.state,
            "watch_seconds": round(self.watch_seconds, 1),
            "loop": self.loop,
            "last_action": self.last_action,
            "error": self.error,
            "uptime": round(time.time() - self.started, 1),
            "triggers_fired": self.triggers_fired,
            "scenario": {"phase": self.scenario_phase, "completed": self.scenario_completed,
                         "current": self.scenario_current, "total": self.scenario_total,
                         "wait_until": self.scenario_wait_until},
        }

SAFE_VALUE_ACTIONS = {"wait", "scroll", "press", "navigate", "select", "attribute", "wait_url", "screenshot", "page_text"}


def public_step(step: Step) -> dict:
    """Step as shown in the dashboard: coordinates and selectors yes, typed text and passwords no."""
    return {"action": step.action, "name": step.name, "kind": step.kind, "query": step.query, "role": step.role,
            "x": step.x, "y": step.y, "end_x": step.end_x, "end_y": step.end_y, "nth": step.nth,
            "value": step.value if step.action in SAFE_VALUE_ACTIONS else "",
            "duration_ms": step.value if step.action == "wait" else ""}


class Job:
    def __init__(self, jid, url, workers, duration, cookies, user_agent_mode="chrome",
                 dialogs="dismiss", profile=""):
        self.id = jid
        self.url = url
        self.workers = workers
        self.duration = duration        # seconds a worker stays on the page (0 = until stopped)
        self.cookies = cookies          # shared cookie list for logged-in accounts
        self.user_agent_mode = user_agent_mode
        self.dialogs = dialogs          # what to do with alert/confirm/prompt: dismiss|accept
        self.profile = profile          # fixed profile name, or "" for random
        self.headers: Dict[str, str] = {}
        self.steps: List[Step] = []     # run after load in every tab
        self.workers_list: List[Worker] = []
        self.status = "pending"         # pending|running|stopped
        self.created = time.time()
        self.pages: Dict[str, Page] = {}
        self.worker_tasks: Dict[str, asyncio.Task] = {}
        self.stop_flag = False
        self.stop_lock = asyncio.Lock()
        self.control_token = secrets.token_urlsafe(24)
        self.screenshots: Dict[str, tuple] = {}
        self.screenshot_locks: Dict[str, asyncio.Lock] = {}
        self.page_locks: Dict[str, asyncio.Lock] = {}

    def total_watch(self):
        return sum(w.watch_seconds for w in self.workers_list)

    def page_lock(self, worker_id: str) -> asyncio.Lock:
        return self.page_locks.setdefault(worker_id, asyncio.Lock())

    def snapshot(self, with_token=False):
        data = {
            "id": self.id,
            "url": self.url,
            "status": self.status,
            "workers": self.workers,
            "duration": self.duration,
            "dialogs": self.dialogs,
            "total_watch_seconds": round(self.total_watch(), 1),
            "total_watch_hours": round(self.total_watch() / 3600, 3),
            "created": self.created,
            "workers_list": [w.snapshot() for w in self.workers_list],
            "scenario_steps": [public_step(step) for step in self.steps],
        }
        if with_token:
            data["control_token"] = self.control_token
        return data

JOBS: Dict[str, Job] = {}
LOGS: List[str] = []
BROWSERS: Dict[str, Browser] = {}
PLAYWRIGHTS: Dict[str, Playwright] = {}
BROWSER_LOCK = asyncio.Lock()
CPU_LAST = None


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    LOGS.append(line)
    if len(LOGS) > 500:
        del LOGS[:-500]


TRIGGERS = TriggerEngine(os.path.join(DATA, "triggers.json"), log=log)


def system_metrics():
    """Host CPU/RAM and Chromium process count. /proc on Linux, psutil elsewhere."""
    global CPU_LAST
    if os.path.exists("/proc/stat"):
        try:
            with open("/proc/stat", encoding="ascii") as fh:
                ticks = [int(x) for x in fh.readline().split()[1:]]
            total = sum(ticks)
            idle = ticks[3] + ticks[4]
            if CPU_LAST is None:
                cpu = 0.0
            else:
                prev_total, prev_idle = CPU_LAST
                delta = total - prev_total
                cpu = 100.0 * (1.0 - (idle - prev_idle) / delta) if delta > 0 else 0.0
            CPU_LAST = (total, idle)
            mem = {}
            with open("/proc/meminfo", encoding="ascii") as fh:
                for line in fh:
                    key, value = line.split(":", 1)
                    if key in ("MemTotal", "MemAvailable"):
                        mem[key] = int(value.split()[0])
            used = 100.0 * (1.0 - mem["MemAvailable"] / mem["MemTotal"])
            chromium = 0
            for item in os.listdir("/proc"):
                if not item.isdigit():
                    continue
                try:
                    with open(f"/proc/{item}/comm", encoding="ascii") as fh:
                        if fh.read().strip() in ("headless_shell", "chrome", "chromium"):
                            chromium += 1
                except (OSError, ProcessLookupError):
                    continue
            return {"cpu_percent": round(max(0.0, min(cpu, 100.0)), 1),
                    "memory_percent": round(used, 1), "chromium_processes": chromium}
        except (OSError, ValueError, KeyError, IndexError):
            pass
    try:
        import psutil
        chromium = sum(1 for p in psutil.process_iter(["name"])
                       if (p.info["name"] or "").lower() in ("chrome.exe", "chromium.exe", "headless_shell.exe",
                                                             "chrome", "chromium", "headless_shell"))
        return {"cpu_percent": round(psutil.cpu_percent(interval=None), 1),
                "memory_percent": round(psutil.virtual_memory().percent, 1),
                "chromium_processes": chromium}
    except Exception:
        return {"cpu_percent": 0.0, "memory_percent": 0.0, "chromium_processes": 0}


def safe_name(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "").strip("._")[:60]
    return name or "file"


def make_screenshot_sink(worker_id: str):
    async def sink(image: bytes, name: str) -> str:
        file_name = f"{safe_name(name or 'shot')}-{worker_id}-{int(time.time())}.jpg"
        path = os.path.join(FILES_DIR, file_name)
        await asyncio.to_thread(lambda: open(path, "wb").write(image))
        return file_name
    return sink


def cookies_from_string(s: str) -> List[dict]:
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out.append({"name": k.strip(), "value": v.strip(), "domain": ".youtube.com", "path": "/"})
    return out


# ---------------- worker loop ----------------
PLAYBACK_JS = r"""() => {
  const text = document.body?.innerText || '';
  const video = document.querySelector('video');
  const playerError = document.querySelector('.ytp-error-content');
  const visibleError = playerError && playerError.getClientRects().length
    ? playerError.innerText.trim().slice(0, 180) : '';
  return {
    verification: /Войдите в аккаунт, чтобы подтвердить, что вы не бот|Sign in to confirm (?:you are|you're|you’re) not a bot/i.test(text),
    consent: location.hostname.startsWith('consent.') ||
      (/(^|\.)youtube\.com$/.test(location.hostname) &&
       /Прежде чем перейти к YouTube|Before you continue to YouTube|Bevor Sie zu YouTube weitergehen|Avant de continuer sur YouTube|Перш ніж перейти на YouTube|Принять все|Accept all|Alle akzeptieren/i.test(text)),
    time: video ? video.currentTime : null,
    paused: video ? video.paused : true,
    ready: video ? video.readyState : 0,
    error: visibleError || (video?.error ? `Media error ${video.error.code}` : '')
  };
}"""


async def worker_loop(job: Job, w: Worker, page: Page):
    w.state = "starting"
    try:
        await page.goto(job.url, wait_until="domcontentloaded", timeout=60000)
        w.state = "checking"
        w.last_action = "Проверяю страницу"
        log(f"worker {w.id} loaded {job.url[:40]} as {w.profile or 'chromium'}")
        if job.steps:
            w.scenario_total = len(job.steps)
            w.scenario_phase = "waiting"
            w.scenario_wait_until = time.time() + 10
            w.last_action = "Сценарий начнётся через 10 секунд"
            await asyncio.sleep(10)
            w.scenario_wait_until = 0
            def on_scenario_progress(index, phase, result):
                w.scenario_current = index
                w.scenario_phase = phase if phase == "running" else "running"
                w.scenario_completed = index + 1 if phase == "done" or (phase == "error" and job.steps[index].optional) else index
                w.last_action = (f"Сценарий: шаг {index + 1}/{w.scenario_total} · {job.steps[index].action}"
                                 if phase == "running" else
                                 f"Сценарий: {w.scenario_completed}/{w.scenario_total} шагов")
            result = await run_steps(page, job.steps,
                                     delay_ms=0 if any(step.action == "wait" for step in job.steps) else 1500,
                                     lock=job.page_lock(w.id),
                                     screenshot_sink=make_screenshot_sink(w.id),
                                     on_progress=on_scenario_progress)
            w.scenario_phase = "done" if result["ok"] else "error"
            w.last_action = (f"Сценарий выполнен: {result['completed']} шагов" if result["ok"]
                             else f"Сценарий остановлен на шаге {result['completed'] + 1}: {result.get('error', '')[:60]}")
            log(f"worker {w.id} start scenario: {result['completed']}/{len(job.steps)} steps")
            job.screenshots.pop(w.id, None)

        last_tick = time.time()
        last_video_time = None
        while not job.stop_flag and w.state != "stopped":
            await asyncio.sleep(1)
            now = time.time()
            elapsed = now - last_tick
            last_tick = now
            if page.is_closed():
                break
            try:
                playback = await page.evaluate(PLAYBACK_JS)
                w.url = page.url
                video_time = playback["time"]
                progress = video_time - last_video_time if video_time is not None and last_video_time is not None else 0
                if playback["verification"]:
                    w.state = "blocked"
                    w.last_action = "YouTube требует подтверждения, что вы не бот"
                elif playback["consent"]:
                    w.state = "blocked"
                    w.last_action = "Окно согласия YouTube"
                elif playback["error"]:
                    w.state = "error"
                    w.error = playback["error"]
                    w.last_action = "Ошибка видеоплеера"
                elif video_time is None:
                    w.state = "ready"
                    w.last_action = "Страница открыта"
                elif not playback["paused"] and playback["ready"] >= 2 and 0.15 < progress <= elapsed + 0.5:
                    w.state = "watching"
                    w.last_action = "Видео воспроизводится"
                    w.watch_seconds += progress
                else:
                    w.state = "paused"
                    w.last_action = "Видео не воспроизводится"
                if not playback["error"]:
                    w.error = ""
                last_video_time = video_time
            except Exception as e:
                w.state = "checking"
                w.last_action = f"Проверка страницы: {str(e)[:35]}"
                last_video_time = None

            # trigger rules ("when X appears, do Y")
            if TRIGGERS.triggers and not job.page_lock(w.id).locked():
                try:
                    fired = await TRIGGERS.check(page, w.id, job.id, lock=job.page_lock(w.id),
                                                 screenshot_sink=make_screenshot_sink(w.id))
                    if os.environ.get("KATYA_DEBUG"):
                        log(f"debug {w.id}: checked {len(TRIGGERS.triggers)} triggers, fired {len(fired)}, url {page.url}")
                    if fired:
                        w.triggers_fired += len(fired)
                        w.last_action = "Триггер: " + ", ".join(f["name"] for f in fired)[:80]
                        job.screenshots.pop(w.id, None)
                except Exception as e:
                    log(f"trigger check failed in {w.id}: {str(e)[:80]}")

            if job.duration > 0 and now - w.started >= job.duration:
                w.last_action = "duration reached"
                break
    except Exception as e:
        w.state = "error"
        w.error = str(e)[:200]
        log(f"worker {w.id} error: {str(e)[:120]}")
    finally:
        w.state = "stopped"


# ---------------- job runner ----------------
LAUNCH_ARGS = ["--mute-audio"]
if os.name != "nt":
    LAUNCH_ARGS += ["--disable-dev-shm-usage", "--no-sandbox"]
if os.environ.get("KATYA_LOW_MEMORY", "0") == "1":
    LAUNCH_ARGS += ["--disable-gpu", "--renderer-process-limit=2", "--js-flags=--max-old-space-size=180"]


def attach_page_handlers(job: Job, w: Worker, page: Page):
    async def on_dialog(dialog):
        try:
            if job.dialogs == "accept":
                await dialog.accept()
            else:
                await dialog.dismiss()
            log(f"worker {w.id} {dialog.type} dialog {job.dialogs}: {dialog.message[:60]}")
        except Exception:
            pass

    async def on_download(download):
        file_name = f"{safe_name(download.suggested_filename)}-{w.id}-{int(time.time())}"
        try:
            await download.save_as(os.path.join(FILES_DIR, file_name))
            log(f"worker {w.id} downloaded {file_name}")
        except Exception as e:
            log(f"worker {w.id} download failed: {str(e)[:80]}")

    page.on("dialog", lambda d: asyncio.create_task(on_dialog(d)))
    page.on("download", lambda d: asyncio.create_task(on_download(d)))


async def run_job(job: Job):
    tasks = []
    job.status = "running"
    log(f"job {job.id} starting {job.workers} workers for {job.url}")
    try:
        async with BROWSER_LOCK:
            if job.id not in BROWSERS:
                pw = await async_playwright().start()
                PLAYWRIGHTS[job.id] = pw
                launch_options = {"headless": HEADLESS, "args": LAUNCH_ARGS}
                if BROWSER_CHANNEL:
                    launch_options["channel"] = BROWSER_CHANNEL
                BROWSERS[job.id] = await pw.chromium.launch(**launch_options)
        browser = BROWSERS[job.id]
        language_header = next((value for name, value in job.headers.items() if name.lower() == "accept-language"), "")
        requested_locale = language_header.split(",", 1)[0].split(";", 1)[0].strip()
        locale = requested_locale if re.fullmatch(r"[a-z]{2}(?:-[A-Z]{2})?", requested_locale) else "ru-RU"

        for i in range(job.workers):
            if job.stop_flag:
                break
            profile = None
            if job.profile:
                profile = find_profile(job.profile)
            elif job.user_agent_mode == "random":
                names = ("Desktop Chrome", "Desktop Edge")
                available = [name for name in names if name in PLAYWRIGHTS[job.id].devices]
                if available:
                    name = secrets.choice(available)
                    profile = {**PLAYWRIGHTS[job.id].devices[name], "name": name}
            w = Worker(f"{job.id}-{i}", job.url, cookies=job.cookies,
                       ua=profile["user_agent"] if profile else None,
                       profile=profile["name"] if profile else ("Installed Chrome" if BROWSER_CHANNEL == "chrome" else "Bundled Chromium"))
            job.workers_list.append(w)
            # Each tab has an isolated browser context and its own identity profile.
            ctx = await browser.new_context(
                **(context_options(profile) if profile else {}),
                extra_http_headers=job.headers,
                locale=locale,
                accept_downloads=True,
            )
            if job.cookies:
                try:
                    await ctx.add_cookies(job.cookies)
                except Exception as e:
                    log(f"cookie load failed for {w.id}: {str(e)[:80]}")
            page = await ctx.new_page()
            if not profile:
                w.ua = await page.evaluate("navigator.userAgent")
            attach_page_handlers(job, w, page)
            job.pages[w.id] = page
            task = asyncio.create_task(worker_loop(job, w, page))
            job.worker_tasks[w.id] = task
            tasks.append(task)
            await asyncio.sleep(0.5)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as e:
        log(f"job {job.id} launch error: {str(e)[:200]}")
        job.status = "error"
    finally:
        await stop_job(job)


async def stop_job(job: Job):
    async with job.stop_lock:
        if job.stop_flag and not job.pages and job.id not in BROWSERS and job.id not in PLAYWRIGHTS:
            return
        job.stop_flag = True
        if job.status != "error":
            job.status = "stopped"
        log(f"job {job.id} stopping")
        for w in job.workers_list:
            w.state = "stopped"
        for task in job.worker_tasks.values():
            task.cancel()
        for wid, page in list(job.pages.items()):
            try:
                await page.context.close()
            except Exception:
                pass
        job.pages.clear()
        job.worker_tasks.clear()
        job.screenshots.clear()
        job.screenshot_locks.clear()
        job.page_locks.clear()
        async with BROWSER_LOCK:
            browser = BROWSERS.pop(job.id, None)
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass
            pw = PLAYWRIGHTS.pop(job.id, None)
            if pw:
                try:
                    await pw.stop()
                except Exception:
                    pass


# ---------------- auth helpers ----------------
def is_api_token(token: Optional[str]) -> bool:
    return bool(token) and secrets.compare_digest(token, API_TOKEN)


def authorized(job: Job, control_token: str, api_token: Optional[str]) -> bool:
    """Tab control needs the job's control token (dashboard) or the API token (agents)."""
    if is_api_token(api_token):
        return True
    return bool(control_token) and secrets.compare_digest(control_token, job.control_token)


def find_page(job_id: str, worker_id: str):
    job = JOBS.get(job_id)
    if not job or job.status != "running":
        return None, None
    page = job.pages.get(worker_id)
    if not page or page.is_closed():
        return job, None
    return job, page


def writer_authorized(api_token: Optional[str], job_id: Optional[str], control_token: Optional[str]) -> bool:
    """Writes to triggers/macros: agents use the API token; the dashboard proves itself with a tab it opened."""
    if is_api_token(api_token):
        return True
    job = JOBS.get(job_id or "")
    return bool(job and job.status == "running" and control_token
                and secrets.compare_digest(control_token, job.control_token))


def forbidden():
    return JSONResponse({"ok": False, "error": "Нет доступа"}, status_code=403)


# ---------------- API: jobs and tabs ----------------
class StartReq(BaseModel):
    url: str
    workers: int = 1
    duration: int = 0          # 0 = until stopped
    cookies: str = ""           # raw cookie string (optional)
    headers: Dict[str, str] = {}
    user_agent_mode: Literal["chrome", "random", "browser"] = "chrome"
    profile: str = ""           # fixed profile name from /api/profiles (optional)
    dialogs: Literal["dismiss", "accept"] = "dismiss"
    steps: List[Step] = []      # scenario to run in every tab right after the page loads

HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
FORBIDDEN_HEADERS = {"authorization", "cookie", "proxy-authorization", "host", "content-length",
                     "connection", "transfer-encoding", "upgrade", "set-cookie", "x-api-key",
                     "api-key", "x-auth-token", "x-access-token"}

def validate_headers(headers: Dict[str, str]) -> Optional[str]:
    if len(headers) > 16:
        return "Не больше 16 заголовков"
    for name, value in headers.items():
        if not isinstance(name, str) or not HEADER_NAME.fullmatch(name) or len(name) > 80:
            return "Неверное имя HTTP-заголовка"
        if name.lower() in FORBIDDEN_HEADERS or name.lower().startswith(("x-auth-", "x-token-")):
            return f"Заголовок {name} здесь недоступен"
        if not isinstance(value, str) or len(value) > 1024 or any(c in value for c in "\r\n\x00"):
            return f"Неверное значение заголовка {name}"
    return None


@app.post("/api/start")
async def start(req: StartReq):
    url = normalize_url(req.url)
    if not url:
        return JSONResponse({"ok": False, "error": "Укажи полный http:// или https:// URL"}, status_code=400)
    header_error = validate_headers(req.headers)
    if header_error:
        return JSONResponse({"ok": False, "error": header_error}, status_code=400)
    if req.profile and not find_profile(req.profile):
        return JSONResponse({"ok": False, "error": "Неизвестный профиль браузера"}, status_code=400)
    workers = max(1, min(int(req.workers), MAX_WORKERS))
    duration = max(0, int(req.duration))
    jid = uuid.uuid4().hex[:8]
    cookies = cookies_from_string(req.cookies)
    for step in req.steps:
        step_error = validate_step(step)
        if step_error:
            return JSONResponse({"ok": False, "error": f"Сценарий: {step_error}"}, status_code=400)
    job = Job(jid, url, workers, duration, cookies, req.user_agent_mode, req.dialogs, req.profile)
    job.headers = req.headers
    job.steps = req.steps[:200]
    JOBS[jid] = job
    asyncio.create_task(run_job(job))
    log(f"NEW JOB {jid} url={job.url} workers={workers} duration={duration} cookies={'yes' if cookies else 'no'}")
    return {"ok": True, "id": jid, "workers": workers,
            "worker_ids": [f"{jid}-{i}" for i in range(workers)],
            "control_token": job.control_token}


@app.get("/api/status")
async def status():
    return {
        "ok": True,
        "jobs": [j.snapshot() for j in JOBS.values()],
        "log": LOGS[-80:],
        "system": system_metrics(),
        "headless": HEADLESS,
    }


@app.get("/api/jobs")
async def jobs_with_tokens(x_katya_token: Optional[str] = Header(default=None)):
    """Agents with the API token get control tokens too, so they can drive any tab."""
    if not is_api_token(x_katya_token):
        return forbidden()
    return {"ok": True, "jobs": [j.snapshot(with_token=True) for j in JOBS.values() if j.status == "running"]}


@app.get("/api/profiles")
async def profiles():
    return {"ok": True, "profiles": [{"name": p["name"], "user_agent": p["user_agent"],
                                      "viewport": p["viewport"]} for p in PROFILES]}


@app.post("/api/stop")
async def stop():
    for j in list(JOBS.values()):
        if j.status == "running":
            asyncio.create_task(stop_job(j))
    return {"ok": True}

@app.post("/api/job/{job_id}/stop")
async def stop_one_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return JSONResponse({"ok": False, "error": "Сессия не найдена"}, status_code=404)
    if job.status == "running":
        asyncio.create_task(stop_job(job))
    return {"ok": True}

@app.post("/api/worker/{job_id}/{worker_id}/stop")
async def stop_worker(job_id: str, worker_id: str):
    job = JOBS.get(job_id)
    if not job or job.status != "running":
        return JSONResponse({"ok": False, "error": "Сессия не найдена"}, status_code=404)
    page = job.pages.pop(worker_id, None)
    worker = next((w for w in job.workers_list if w.id == worker_id), None)
    if not page or not worker:
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    worker.state = "stopped"
    worker.last_action = "stopped by user"
    task = job.worker_tasks.pop(worker_id, None)
    if task:
        task.cancel()
    job.screenshots.pop(worker_id, None)
    job.screenshot_locks.pop(worker_id, None)
    job.page_locks.pop(worker_id, None)
    try:
        await page.context.close()
    except Exception:
        pass
    log(f"worker {worker_id} stopped by user")
    if not job.pages:
        asyncio.create_task(stop_job(job))
    return {"ok": True}


@app.post("/api/worker/{job_id}/{worker_id}/reload")
async def reload_worker(job_id: str, worker_id: str):
    job, page = find_page(job_id, worker_id)
    worker = next((w for w in job.workers_list if w.id == worker_id), None) if job else None
    if not page or not worker:
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    worker.state = "reloading"
    worker.last_action = "Ручная перезагрузка страницы"
    try:
        async with job.page_lock(worker_id):
            await page.reload(wait_until="domcontentloaded", timeout=30000)
        worker.state = "checking"
        worker.loop += 1
        job.screenshots.pop(worker_id, None)
        return {"ok": True}
    except Exception as e:
        worker.state = "checking"
        worker.last_action = f"Перезагрузка: {str(e)[:60]}"
        return JSONResponse({"ok": False, "error": "Не удалось перезагрузить вкладку"}, status_code=503)


# ---------------- API: actions ----------------
class ActionReq(Step):
    control_token: str = ""


class StepsReq(BaseModel):
    steps: List[Step] = Field(min_length=1, max_length=200)
    delay_ms: int = 300
    control_token: str = ""


@app.post("/api/worker/{job_id}/{worker_id}/action")
async def browser_action(job_id: str, worker_id: str, req: ActionReq,
                         x_katya_token: Optional[str] = Header(default=None)):
    job = JOBS.get(job_id)
    if not job or not authorized(job, req.control_token, x_katya_token):
        return forbidden()
    job, page = find_page(job_id, worker_id)
    if not page:
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    step = Step(**req.model_dump(exclude={"control_token"}))
    error = validate_step(step)
    if error:
        return JSONResponse({"ok": False, "error": error}, status_code=400)
    async with job.page_lock(worker_id):
        result = await run_step(page, step, screenshot_sink=make_screenshot_sink(worker_id))
        if result["ok"] and step.action in {"type", "fill"}:
            try:
                result["input_focus"] = await page.evaluate("""() => ({
                  tag: document.activeElement?.tagName.toLowerCase() || '',
                  type: (document.activeElement?.getAttribute('type') || '').toLowerCase()
                })""")
            except Exception:
                result["input_focus"] = {"tag": "", "type": ""}
    if not result["ok"]:
        return JSONResponse(result, status_code=503 if "Не удалось" in result["error"] else 400)
    worker = next((w for w in job.workers_list if w.id == worker_id), None)
    if worker:
        worker.url = page.url
    if step.action not in {"inspect", "move"}:
        job.screenshots.pop(worker_id, None)
        log(f"worker {worker_id} action {step.action}")
    return {"message": "Действие выполнено", **result}


@app.post("/api/worker/{job_id}/{worker_id}/steps")
async def browser_steps(job_id: str, worker_id: str, req: StepsReq,
                        x_katya_token: Optional[str] = Header(default=None)):
    """Run a whole macro (list of steps) in one tab."""
    job = JOBS.get(job_id)
    if not job or not authorized(job, req.control_token, x_katya_token):
        return forbidden()
    job, page = find_page(job_id, worker_id)
    if not page:
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    for step in req.steps:
        error = validate_step(step)
        if error:
            return JSONResponse({"ok": False, "error": error}, status_code=400)
    result = await run_steps(page, req.steps, delay_ms=max(0, min(req.delay_ms, 10000)),
                             lock=job.page_lock(worker_id), screenshot_sink=make_screenshot_sink(worker_id))
    job.screenshots.pop(worker_id, None)
    log(f"worker {worker_id} macro: {result['completed']}/{len(req.steps)} steps")
    return result


@app.get("/api/worker/{job_id}/{worker_id}/text")
async def worker_text(job_id: str, worker_id: str, limit: int = 20000,
                      control_token: str = "", x_katya_token: Optional[str] = Header(default=None)):
    job = JOBS.get(job_id)
    if not job or not authorized(job, control_token, x_katya_token):
        return forbidden()
    job, page = find_page(job_id, worker_id)
    if not page:
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    async with job.page_lock(worker_id):
        result = await run_step(page, Step(action="page_text", value=str(max(100, min(limit, 200000)))))
    result["title"] = await page.title() if result["ok"] else ""
    return result


@app.get("/api/worker/{job_id}/{worker_id}/screenshot")
async def worker_screenshot(job_id: str, worker_id: str, force: bool = False,
                            x_katya_token: Optional[str] = Header(default=None)):
    job, page = find_page(job_id, worker_id)
    if not job or not page:
        return JSONResponse({"error": "Вкладка не найдена"}, status_code=404)
    # The dashboard may be public. Never expose an authenticated browser session to it.
    if job.cookies and not is_api_token(x_katya_token):
        return JSONResponse({"error": "Скриншот аккаунта недоступен"}, status_code=403)
    lock = job.screenshot_locks.setdefault(worker_id, asyncio.Lock())
    async with lock:
        cached = job.screenshots.get(worker_id)
        if cached and time.monotonic() - cached[0] < (0.3 if force else 15):
            return Response(cached[1], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=10"})
        try:
            image = await page.screenshot(type="jpeg", quality=60, timeout=8000)
        except Exception:
            return JSONResponse({"error": "Снимок пока недоступен"}, status_code=503)
        job.screenshots[worker_id] = (time.monotonic(), image)
        return Response(image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=10"})


# ---------------- API: triggers ----------------
@app.get("/api/triggers")
async def list_triggers():
    return {"ok": True, "triggers": TRIGGERS.snapshot()}


@app.post("/api/triggers")
async def add_trigger(trigger: Trigger, x_katya_token: Optional[str] = Header(default=None),
                      x_katya_job: Optional[str] = Header(default=None),
                      x_katya_control_token: Optional[str] = Header(default=None)):
    if not writer_authorized(x_katya_token, x_katya_job, x_katya_control_token):
        return forbidden()
    error = validate_trigger(trigger)
    if error:
        return JSONResponse({"ok": False, "error": error}, status_code=400)
    if len(TRIGGERS.triggers) >= 100 and trigger.id not in TRIGGERS.triggers:
        return JSONResponse({"ok": False, "error": "Слишком много триггеров"}, status_code=400)
    saved = TRIGGERS.add(trigger)
    log(f"trigger '{saved.name}' saved ({saved.id})")
    return {"ok": True, "trigger": saved.model_dump()}


@app.delete("/api/triggers/{trigger_id}")
async def delete_trigger(trigger_id: str, x_katya_token: Optional[str] = Header(default=None),
                         x_katya_job: Optional[str] = Header(default=None),
                         x_katya_control_token: Optional[str] = Header(default=None)):
    if not writer_authorized(x_katya_token, x_katya_job, x_katya_control_token):
        return forbidden()
    if not TRIGGERS.remove(trigger_id):
        return JSONResponse({"ok": False, "error": "Триггер не найден"}, status_code=404)
    return {"ok": True}


@app.post("/api/triggers/{trigger_id}/enabled")
async def toggle_trigger(trigger_id: str, enabled: bool = Query(...),
                         x_katya_token: Optional[str] = Header(default=None),
                         x_katya_job: Optional[str] = Header(default=None),
                         x_katya_control_token: Optional[str] = Header(default=None)):
    if not writer_authorized(x_katya_token, x_katya_job, x_katya_control_token):
        return forbidden()
    if not TRIGGERS.set_enabled(trigger_id, enabled):
        return JSONResponse({"ok": False, "error": "Триггер не найден"}, status_code=404)
    return {"ok": True}


# ---------------- API: macros ----------------
def load_macros() -> Dict[str, dict]:
    try:
        with open(MACROS_PATH, encoding="utf-8") as fh:
            return {m["name"]: m for m in json.load(fh)}
    except FileNotFoundError:
        return {}
    except Exception as e:
        log(f"macros load failed: {str(e)[:80]}")
        return {}


def save_macros(macros: Dict[str, dict]) -> None:
    tmp = MACROS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(list(macros.values()), fh, ensure_ascii=False, indent=1)
    os.replace(tmp, MACROS_PATH)


@app.get("/api/macros")
async def list_macros():
    return {"ok": True, "macros": list(load_macros().values())}


@app.post("/api/macros")
async def save_macro(macro: Macro, x_katya_token: Optional[str] = Header(default=None),
                     x_katya_job: Optional[str] = Header(default=None),
                     x_katya_control_token: Optional[str] = Header(default=None)):
    if not writer_authorized(x_katya_token, x_katya_job, x_katya_control_token):
        return forbidden()
    headers = macro.settings.get("headers") if isinstance(macro.settings, dict) else None
    if headers is not None:
        if not isinstance(headers, dict):
            return JSONResponse({"ok": False, "error": "settings.headers должен быть объектом"}, status_code=400)
        header_error = validate_headers(headers)
        if header_error:
            return JSONResponse({"ok": False, "error": header_error}, status_code=400)
    for step in macro.steps:
        error = validate_step(step)
        if error:
            return JSONResponse({"ok": False, "error": error}, status_code=400)
    macros = load_macros()
    if len(macros) >= 200 and macro.name not in macros:
        return JSONResponse({"ok": False, "error": "Слишком много макросов"}, status_code=400)
    macros[macro.name] = macro.model_dump()
    save_macros(macros)
    return {"ok": True, "macro": macros[macro.name]}


@app.delete("/api/macros/{name}")
async def delete_macro(name: str, x_katya_token: Optional[str] = Header(default=None),
                       x_katya_job: Optional[str] = Header(default=None),
                       x_katya_control_token: Optional[str] = Header(default=None)):
    if not writer_authorized(x_katya_token, x_katya_job, x_katya_control_token):
        return forbidden()
    macros = load_macros()
    if macros.pop(name, None) is None:
        return JSONResponse({"ok": False, "error": "Макрос не найден"}, status_code=404)
    save_macros(macros)
    return {"ok": True}


class RunMacroReq(BaseModel):
    job_id: str
    worker_id: str
    control_token: str = ""
    delay_ms: int = 300


@app.post("/api/macros/{name}/run")
async def run_macro(name: str, req: RunMacroReq, x_katya_token: Optional[str] = Header(default=None)):
    macro = load_macros().get(name)
    if not macro:
        return JSONResponse({"ok": False, "error": "Макрос не найден"}, status_code=404)
    steps = StepsReq(steps=macro["steps"], delay_ms=req.delay_ms, control_token=req.control_token)
    return await browser_steps(req.job_id, req.worker_id, steps, x_katya_token)


# ---------------- API: files (screenshots, downloads) ----------------
@app.get("/api/files")
async def list_files(x_katya_token: Optional[str] = Header(default=None)):
    if not is_api_token(x_katya_token):
        return forbidden()
    items = []
    for name in sorted(os.listdir(FILES_DIR)):
        path = os.path.join(FILES_DIR, name)
        if os.path.isfile(path):
            stat = os.stat(path)
            items.append({"name": name, "size": stat.st_size, "modified": stat.st_mtime})
    return {"ok": True, "files": items}


@app.get("/api/files/{name}")
async def get_file(name: str, x_katya_token: Optional[str] = Header(default=None), token: str = ""):
    if not (is_api_token(x_katya_token) or is_api_token(token)):
        return forbidden()
    if name != safe_name(name) and not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        return JSONResponse({"ok": False, "error": "Неверное имя файла"}, status_code=400)
    path = os.path.join(FILES_DIR, name)
    if not os.path.isfile(path):
        return JSONResponse({"ok": False, "error": "Файл не найден"}, status_code=404)
    return FileResponse(path)


@app.delete("/api/files/{name}")
async def delete_file(name: str, x_katya_token: Optional[str] = Header(default=None)):
    if not is_api_token(x_katya_token):
        return forbidden()
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        return JSONResponse({"ok": False, "error": "Неверное имя файла"}, status_code=400)
    path = os.path.join(FILES_DIR, name)
    if not os.path.isfile(path):
        return JSONResponse({"ok": False, "error": "Файл не найден"}, status_code=404)
    os.remove(path)
    return {"ok": True}


# ---------------- live feed ----------------
@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = json.dumps({
                "jobs": [j.snapshot() for j in JOBS.values()],
                "log": LOGS[-60:],
                "system": system_metrics(),
                "triggers": TRIGGERS.snapshot(),
            })
            await websocket.send_text(payload)
            active_scenario = any(w.scenario_phase in ("waiting", "running")
                                  for job in JOBS.values() if job.status == "running"
                                  for w in job.workers_list)
            await asyncio.sleep(0.5 if active_scenario else 2)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@app.get("/healthz")
async def healthz():
    return {"ok": True, "jobs": len(JOBS)}


@app.middleware("http")
async def no_cache_static(request, call_next):
    """The dashboard is edited often; make browsers revalidate HTML/CSS/JS on every load."""
    response = await call_next(request)
    if request.url.path.endswith((".html", ".css", ".js")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("KATYA_PORT", "8010"))
    print(f"Katya Browser Lab on http://127.0.0.1:{port}  headless={HEADLESS}  data={DATA}", file=sys.stderr)
    print(f"API token (for MCP/agents) is in {os.path.join(DATA, 'api_token.txt')}", file=sys.stderr)
    uvicorn.run(app, host=os.environ.get("KATYA_BIND_HOST", "0.0.0.0"), port=port)
