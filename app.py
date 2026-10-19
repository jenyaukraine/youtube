"""Browser session dashboard with live process and resource monitoring."""
import asyncio
import json
import os
import re
import secrets
import time
import uuid
from urllib.parse import urlsplit
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, Page, Playwright

app = FastAPI(title="Katya Browser Lab")

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# ---------------- state ----------------
class Worker:
    def __init__(self, wid, url, cookies=None, ua=None):
        self.id = wid
        self.url = url
        self.cookies = cookies or []
        self.ua = ua
        self.state = "starting"      # starting|checking|blocked|paused|watching|reloading|error|stopped
        self.watch_seconds = 0.0
        self.loop = 0
        self.last_action = ""
        self.error = ""
        self.started = time.time()

    def snapshot(self):
        return {
            "id": self.id,
            "url": self.url,
            "user_agent": self.ua,
            "state": self.state,
            "watch_seconds": round(self.watch_seconds, 1),
            "loop": self.loop,
            "last_action": self.last_action,
            "error": self.error,
            "uptime": round(time.time() - self.started, 1),
        }

class Job:
    def __init__(self, jid, url, workers, duration, cookies, user_agent_mode="random"):
        self.id = jid
        self.url = url
        self.workers = workers
        self.duration = duration        # seconds a worker stays on the video (0 = until stopped)
        self.cookies = cookies          # shared cookie list for logged-in accounts
        self.user_agent_mode = user_agent_mode
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

    def snapshot(self):
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

JOBS: Dict[str, Job] = {}
LOGS: List[str] = []
BROWSERS: Dict[str, Browser] = {}
PLAYWRIGHTS: Dict[str, Playwright] = {}
BROWSER_LOCK = asyncio.Lock()
CPU_LAST = None

def system_metrics():
    """Read host CPU/RAM and count Chromium processes owned by this service."""
    global CPU_LAST
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
                with open(f"/proc/{item}/cgroup", encoding="ascii") as fh:
                    if "katya-viewbot.service" not in fh.read():
                        continue
                with open(f"/proc/{item}/comm", encoding="ascii") as fh:
                    if fh.read().strip() in ("headless_shell", "chrome", "chromium"):
                        chromium += 1
            except (OSError, ProcessLookupError):
                continue
        return {"cpu_percent": round(max(0.0, min(cpu, 100.0)), 1),
                "memory_percent": round(used, 1), "chromium_processes": chromium}
    except (OSError, ValueError, KeyError, IndexError):
        return {"cpu_percent": 0.0, "memory_percent": 0.0, "chromium_processes": 0}

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    LOGS.append(line)
    if len(LOGS) > 500:
        del LOGS[:-500]

def parse_video_id(url: str) -> Optional[str]:
    import re
    m = re.search(r"(?:youtu\.be/|v=|/videos/|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    if re.match(r"^[A-Za-z0-9_-]{11}$", url):
        return url
    return None

def normalize_browser_url(raw: str) -> Optional[str]:
    raw = raw.strip()
    if len(raw) > 2048 or any(ch in raw for ch in "\r\n\x00"):
        return None
    if not raw.startswith(("http://", "https://")):
        video_id = parse_video_id(raw)
        return f"https://www.youtube.com/watch?v={video_id}" if video_id else None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if not parts.hostname or parts.username or parts.password:
        return None
    return raw

# ---------------- worker loop ----------------
async def worker_loop(job: Job, w: Worker, page: Page):
    w.state = "starting"
    base = job.url
    try:
        await page.goto(base, wait_until="domcontentloaded", timeout=60000)
        w.state = "checking"
        w.last_action = "Проверяю воспроизведение"
        log(f"worker {w.id} loaded {job.url[:40]}")

        last_tick = time.time()
        last_video_time = None
        while not job.stop_flag and w.state != "stopped":
            await asyncio.sleep(1)
            now = time.time()
            elapsed = now - last_tick
            last_tick = now

            try:
                playback = await page.evaluate(r"""() => {
                  const text = document.body?.innerText || '';
                  const video = document.querySelector('video');
                  return {
                    consent: location.hostname.startsWith('consent.') ||
                      (/(^|\.)youtube\.com$/.test(location.hostname) &&
                       /Прежде чем перейти к YouTube|Before you continue to YouTube|Bevor Sie zu YouTube weitergehen|Avant de continuer sur YouTube|Перш ніж перейти на YouTube|Принять все|Accept all|Alle akzeptieren/i.test(text)),
                    time: video ? video.currentTime : null,
                    paused: video ? video.paused : true,
                    ready: video ? video.readyState : 0
                  };
                }""")
                w.url = page.url
                video_time = playback["time"]
                progress = video_time - last_video_time if video_time is not None and last_video_time is not None else 0
                if playback["consent"]:
                    w.state = "blocked"
                    w.last_action = "Окно согласия YouTube"
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
                last_video_time = video_time
            except Exception as e:
                w.state = "checking"
                w.last_action = f"Проверка плеера: {str(e)[:35]}"
                last_video_time = None

            # honor duration cap
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
async def run_job(job: Job):
    pw: Optional[Playwright] = None
    tasks = []
    job.status = "running"
    log(f"job {job.id} starting {job.workers} workers for {job.url}")
    try:
        async with BROWSER_LOCK:
            if job.id not in BROWSERS:
                pw = await async_playwright().start()
                PLAYWRIGHTS[job.id] = pw
                browser = await pw.chromium.launch(
                    headless=True,
                    args=["--disable-dev-shm-usage", "--mute-audio", "--no-sandbox",
                          "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
                          "--disable-extensions", "--disable-background-networking",
                          "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
                          "--disable-renderer-backgrounding", "--disable-features=CalculateNativeWinOcclusion",
                          "--renderer-process-limit=2", "--js-flags=--max-old-space-size=180",
                          "--force-color-profile=srgb", "--hide-scrollbars"],
                )
                BROWSERS[job.id] = browser
        browser = BROWSERS[job.id]
        language_header = next((value for name, value in job.headers.items() if name.lower() == "accept-language"), "")
        requested_locale = language_header.split(",", 1)[0].split(";", 1)[0].strip()
        locale = requested_locale if re.fullmatch(r"[a-z]{2}(?:-[A-Z]{2})?", requested_locale) else "ru-RU"

        for i in range(job.workers):
            if job.stop_flag:
                break
            profile = None
            if job.user_agent_mode == "random":
                names = [name for name in ("Desktop Chrome", "Desktop Edge") if name in pw.devices]
                if names:
                    profile = {key: value for key, value in pw.devices[secrets.choice(names)].items()
                               if key != "default_browser_type"}
            w = Worker(f"{job.id}-{i}", job.url, cookies=job.cookies,
                       ua=profile.get("user_agent") if profile else None)
            job.workers_list.append(w)
            # Each tab has an isolated browser context and its own device profile.
            ctx = await browser.new_context(
                **(profile or {}),
                extra_http_headers=job.headers,
                locale=locale,
            )
            if job.cookies:
                try:
                    await ctx.add_cookies(job.cookies)
                except Exception as e:
                    log(f"cookie load failed for {w.id}: {str(e)[:80]}")
            page = await ctx.new_page()
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

# ---------------- API ----------------
class StartReq(BaseModel):
    url: str
    workers: int = 3
    duration: int = 0          # 0 = until stopped
    cookies: str = ""           # raw cookie string (optional)
    headers: Dict[str, str] = {}
    user_agent_mode: Literal["random", "browser"] = "random"

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

def cookies_from_string(s: str) -> List[dict]:
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out.append({"name": k.strip(), "value": v.strip(), "domain": ".youtube.com", "path": "/"})
    return out

@app.post("/api/start")
async def start(req: StartReq):
    url = normalize_browser_url(req.url)
    if not url:
        return JSONResponse({"ok": False, "error": "Укажи полный http:// или https:// URL"}, status_code=400)
    header_error = validate_headers(req.headers)
    if header_error:
        return JSONResponse({"ok": False, "error": header_error}, status_code=400)
    workers = max(1, min(int(req.workers), 8))
    duration = max(0, int(req.duration))
    jid = uuid.uuid4().hex[:8]
    cookies = cookies_from_string(req.cookies)
    job = Job(jid, url, workers, duration, cookies, req.user_agent_mode)
    job.headers = req.headers
    JOBS[jid] = job
    asyncio.create_task(run_job(job))
    log(f"NEW JOB {jid} url={job.url} workers={workers} duration={duration} cookies={'yes' if cookies else 'no'}")
    return {"ok": True, "id": jid, "workers": workers,
            "control_token": job.control_token}

@app.get("/api/status")
async def status():
    return {
        "ok": True,
        "jobs": [j.snapshot() for j in JOBS.values()],
        "log": LOGS[-80:],
        "system": system_metrics(),
    }

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
    job = JOBS.get(job_id)
    page = job.pages.get(worker_id) if job and job.status == "running" else None
    worker = next((w for w in job.workers_list if w.id == worker_id), None) if job else None
    if not page or not worker or page.is_closed():
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    worker.state = "reloading"
    worker.last_action = "Ручная перезагрузка страницы"
    try:
        async with job.page_locks.setdefault(worker_id, asyncio.Lock()):
            await page.reload(wait_until="domcontentloaded", timeout=30000)
        worker.state = "checking"
        worker.loop += 1
        job.screenshots.pop(worker_id, None)
        return {"ok": True}
    except Exception as e:
        worker.state = "checking"
        worker.last_action = f"Перезагрузка: {str(e)[:60]}"
        return JSONResponse({"ok": False, "error": "Не удалось перезагрузить вкладку"}, status_code=503)

class BrowserAction(BaseModel):
    action: Literal["click", "wait_click", "point", "inspect", "fill", "hover", "drag", "scroll", "press", "type", "navigate"]
    kind: Literal["css", "text", "role", "label"] = "css"
    query: str = ""
    role: str = "button"
    value: str = ""
    x: float = 0
    y: float = 0
    control_token: str

@app.post("/api/worker/{job_id}/{worker_id}/action")
async def browser_action(job_id: str, worker_id: str, req: BrowserAction):
    job = JOBS.get(job_id)
    if not job or not secrets.compare_digest(req.control_token, job.control_token):
        return JSONResponse({"ok": False, "error": "Нет доступа к этой вкладке"}, status_code=403)
    page = job.pages.get(worker_id) if job.status == "running" else None
    if not page or page.is_closed():
        return JSONResponse({"ok": False, "error": "Вкладка не найдена"}, status_code=404)
    query = req.query.strip()
    if len(query) > 200 or len(req.value) > 2048:
        return JSONResponse({"ok": False, "error": "Слишком длинный запрос"}, status_code=400)
    allowed_roles = {"button", "link", "checkbox", "radio", "tab", "menuitem", "textbox"}
    if req.kind == "role" and req.role not in allowed_roles:
        return JSONResponse({"ok": False, "error": "Неподдерживаемая роль"}, status_code=400)
    if req.action in {"click", "wait_click", "fill", "hover", "drag"} and not query:
        return JSONResponse({"ok": False, "error": "Укажи элемент"}, status_code=400)
    if (req.action in {"drag", "press", "navigate"} and not req.value.strip()) or (req.action == "type" and not req.value):
        return JSONResponse({"ok": False, "error": "Укажи значение действия"}, status_code=400)
    if req.action == "navigate" and not normalize_browser_url(req.value):
        return JSONResponse({"ok": False, "error": "Неверный URL"}, status_code=400)
    if req.action in {"point", "inspect"} and not (0 <= req.x <= 1 and 0 <= req.y <= 1):
        return JSONResponse({"ok": False, "error": "Точка вне вкладки"}, status_code=400)
    def element(q: str):
        if req.kind == "css":
            return page.locator(q)
        if req.kind == "text":
            return page.get_by_text(q, exact=False)
        if req.kind == "role":
            return page.get_by_role(req.role, name=q, exact=False)
        return page.get_by_label(q, exact=False)
    try:
        if req.action == "inspect":
            viewport = page.viewport_size
            if not viewport:
                return JSONResponse({"ok": False, "error": "Неизвестен размер вкладки"}, status_code=400)
            found = await page.evaluate("""({x,y}) => {
              let el = document.elementFromPoint(x,y);
              if(!el) return null;
              el = el.closest('button,a,input,textarea,select,label,[role]') || el;
              const tag = el.tagName.toLowerCase();
              let selector = '';
              if(el.id && document.querySelectorAll('#'+CSS.escape(el.id)).length === 1){
                selector = '#'+CSS.escape(el.id);
              } else {
                const parts = [];
                for(let node=el; node && node.nodeType===1 && parts.length<8; node=node.parentElement){
                  const name=node.tagName.toLowerCase();
                  const same=[...(node.parentElement?.children||[])].filter(s=>s.tagName===node.tagName);
                  parts.unshift(name+(same.length>1 ? ':nth-of-type('+(same.indexOf(node)+1)+')' : ''));
                  selector=parts.join(' > ');
                  if(document.querySelectorAll(selector).length===1) break;
                }
              }
              return {selector,tag,text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,100)};
            }""", {"x": round(req.x * viewport["width"]), "y": round(req.y * viewport["height"])})
            if not found:
                return JSONResponse({"ok": False, "error": "Элемент не найден"}, status_code=404)
            return {"ok": True, **found}
        elif req.action == "point":
            viewport = page.viewport_size
            if not viewport:
                return JSONResponse({"ok": False, "error": "Неизвестен размер вкладки"}, status_code=400)
            await page.mouse.click(round(req.x * viewport["width"]), round(req.y * viewport["height"]))
        elif req.action == "navigate":
            target = normalize_browser_url(req.value)
            async with job.page_locks.setdefault(worker_id, asyncio.Lock()):
                await page.goto(target, wait_until="domcontentloaded", timeout=30000)
            worker = next((w for w in job.workers_list if w.id == worker_id), None)
            if worker:
                worker.url = page.url
        elif req.action == "scroll":
            viewport = page.viewport_size
            if viewport:
                px = req.x * viewport["width"] if 0 < req.x < 1 else viewport["width"] / 2
                py = req.y * viewport["height"] if 0 < req.y < 1 else viewport["height"] / 2
                await page.mouse.move(px, py)
            await page.mouse.wheel(0, max(-3000, min(3000, int(req.value or "500"))))
        elif req.action == "press":
            await page.keyboard.press(req.value, timeout=7000)
        elif req.action == "type":
            await page.keyboard.type(req.value, delay=0)
        else:
            locator = element(query)
            if req.action == "wait_click":
                await locator.wait_for(state="visible", timeout=120000)
            count = await locator.count()
            if count != 1:
                return JSONResponse({"ok": False, "error": f"Найдено элементов: {count}. Уточни запрос."}, status_code=400)
            if req.action in {"click", "wait_click"}:
                await locator.click(timeout=7000)
            elif req.action == "fill":
                await locator.fill(req.value, timeout=7000)
            elif req.action == "hover":
                await locator.hover(timeout=7000)
            else:
                target = element(req.value.strip())
                target_count = await target.count()
                if target_count != 1:
                    return JSONResponse({"ok": False, "error": f"Целей перетаскивания: {target_count}. Уточни запрос."}, status_code=400)
                await locator.drag_to(target, timeout=7000)
        job.screenshots.pop(worker_id, None)
        log(f"worker {worker_id} action {req.action}")
        return {"ok": True, "message": "Действие выполнено", "url": page.url}
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"Не удалось выполнить: {str(e)[:120]}"}, status_code=503)

@app.get("/api/worker/{job_id}/{worker_id}/screenshot")
async def worker_screenshot(job_id: str, worker_id: str, force: bool = False):
    job = JOBS.get(job_id)
    if not job or job.status != "running" or worker_id not in job.pages:
        return JSONResponse({"error": "Вкладка не найдена"}, status_code=404)
    # The dashboard is public. Never expose an authenticated browser session.
    if job.cookies:
        return JSONResponse({"error": "Скриншот аккаунта недоступен"}, status_code=403)
    lock = job.screenshot_locks.setdefault(worker_id, asyncio.Lock())
    async with lock:
        cached = job.screenshots.get(worker_id)
        if cached and time.monotonic() - cached[0] < (0.3 if force else 15):
            return Response(cached[1], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=10"})
        page = job.pages.get(worker_id)
        if not page or page.is_closed():
            return JSONResponse({"error": "Вкладка закрыта"}, status_code=404)
        try:
            image = await page.screenshot(type="jpeg", quality=60, timeout=8000)
        except Exception:
            return JSONResponse({"error": "Снимок пока недоступен"}, status_code=503)
        job.screenshots[worker_id] = (time.monotonic(), image)
        return Response(image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=10"})

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = json.dumps({
                "jobs": [j.snapshot() for j in JOBS.values()],
                "log": LOGS[-60:],
                "system": system_metrics(),
            })
            await websocket.send_text(payload)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

@app.get("/healthz")
async def healthz():
    return {"ok": True, "jobs": len(JOBS)}

app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("KATYA_BIND_HOST", "0.0.0.0"), port=8010)
