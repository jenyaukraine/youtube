"""Browser session dashboard with live process and resource monitoring."""
import asyncio
import json
import os
import random
import time
import uuid
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, Page, Playwright

app = FastAPI(title="Katya ViewBot")

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# ---------------- state ----------------
class Worker:
    def __init__(self, wid, url, cookies=None, ua=None):
        self.id = wid
        self.url = url
        self.cookies = cookies or []
        self.ua = ua
        self.state = "starting"      # starting|watching|reloading|error|stopped
        self.watch_seconds = 0.0
        self.loop = 0
        self.last_action = ""
        self.error = ""
        self.started = time.time()

    def snapshot(self):
        return {
            "id": self.id,
            "state": self.state,
            "watch_seconds": round(self.watch_seconds, 1),
            "loop": self.loop,
            "last_action": self.last_action,
            "error": self.error,
            "uptime": round(time.time() - self.started, 1),
        }

class Job:
    def __init__(self, jid, url, workers, duration, cookies):
        self.id = jid
        self.url = url
        self.workers = workers
        self.duration = duration        # seconds a worker stays on the video (0 = until stopped)
        self.cookies = cookies          # shared cookie list for logged-in accounts
        self.workers_list: List[Worker] = []
        self.status = "pending"         # pending|running|stopped
        self.created = time.time()
        self.pages: Dict[str, Page] = {}
        self.stop_flag = False
        self.stop_lock = asyncio.Lock()

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

# ---------------- user agents (rotation) ----------------
UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

def parse_video_id(url: str) -> Optional[str]:
    import re
    m = re.search(r"(?:youtu\.be/|v=|/videos/|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    if re.match(r"^[A-Za-z0-9_-]{11}$", url):
        return url
    return None

# ---------------- worker loop ----------------
async def worker_loop(job: Job, w: Worker, page: Page):
    w.state = "starting"
    base = f"https://www.youtube.com/watch?v={parse_video_id(job.url)}"
    try:
        # random-ish entry
        await page.goto(base, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(random.uniform(1.5, 4.0))
        w.state = "watching"
        w.last_action = "loaded"
        log(f"worker {w.id} started watching {job.url[:40]}")

        last_tick = time.time()
        next_refresh = time.time() + random.uniform(25, 45)
        while not job.stop_flag and w.state != "stopped":
            await asyncio.sleep(1)
            now = time.time()
            if w.state == "watching":
                w.watch_seconds += (now - last_tick)
            last_tick = now

            # periodic "human" touch: nudge so it doesn't look frozen
            try:
                await page.mouse.move(random.randint(120, 900), random.randint(200, 500), steps=3)
            except Exception:
                pass

            if w.state == "watching" and now >= next_refresh:
                # simulate a real viewer: occasionally restart / small seek
                r = random.random()
                try:
                    if r < 0.25:
                        # hard reload to look like a new visit
                        w.loop += 1
                        w.last_action = f"reload #{w.loop}"
                        w.state = "reloading"
                        await page.reload(wait_until="domcontentloaded", timeout=60000)
                        await asyncio.sleep(random.uniform(1.5, 3.5))
                        w.state = "watching"
                    else:
                        # small forward seek to keep "active"
                        w.last_action = "seek"
                        await page.evaluate(
                            "if(window.player){window.player.seekTo(window.player.getCurrentTime()+5, true);}"
                        )
                except Exception as e:
                    w.last_action = f"touch:{str(e)[:30]}"
                next_refresh = time.time() + random.uniform(25, 45)

            # if video ended, auto-restart to keep accruing
            try:
                ended = await page.evaluate(
                    "window.player ? (window.player.getCurrentTime() >= window.player.getDuration() - 1.5) : false"
                )
                if ended and w.state == "watching":
                    w.loop += 1
                    w.last_action = f"restarted #{w.loop}"
                    try:
                        await page.evaluate("if(window.player){window.player.seekTo(0, true); window.player.playVideo();}")
                    except Exception:
                        pass
            except Exception:
                pass

            # honor duration cap
            if job.duration > 0 and w.watch_seconds >= job.duration:
                w.last_action = "duration reached"
                break
    except Exception as e:
        w.state = "error"
        w.error = str(e)[:200]
        log(f"worker {w.id} error: {str(e)[:120]}")
    finally:
        if not job.stop_flag:
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

        for i in range(job.workers):
            if job.stop_flag:
                break
            w = Worker(f"{job.id}-{i}", job.url, cookies=job.cookies, ua=random.choice(UAS))
            job.workers_list.append(w)
            # own context per worker => isolated cookies/account + UA
            ctx = await browser.new_context(
                user_agent=w.ua,
                viewport={"width": random.randint(1280, 1520), "height": random.randint(720, 900)},
                locale=random.choice(["en-US", "ru-RU", "de-DE", "fr-FR"]),
                device_scale_factor=1,
            )
            if job.cookies:
                try:
                    await ctx.add_cookies(job.cookies)
                except Exception as e:
                    log(f"cookie load failed for {w.id}: {str(e)[:80]}")
            page = await ctx.new_page()
            job.pages[w.id] = page
            tasks.append(asyncio.create_task(worker_loop(job, w, page)))
            await asyncio.sleep(random.uniform(0.5, 2.0))  # stagger starts
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
        for wid, page in list(job.pages.items()):
            try:
                await page.context.close()
            except Exception:
                pass
        job.pages.clear()
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
    vid = parse_video_id(req.url)
    if not vid:
        return JSONResponse({"ok": False, "error": "Не могу распознать YouTube-ссылку"}, status_code=400)
    workers = max(1, min(int(req.workers), 8))
    duration = max(0, int(req.duration))
    jid = uuid.uuid4().hex[:8]
    cookies = cookies_from_string(req.cookies)
    job = Job(jid, f"https://www.youtube.com/watch?v={vid}", workers, duration, cookies)
    JOBS[jid] = job
    asyncio.create_task(run_job(job))
    log(f"NEW JOB {jid} url={job.url} workers={workers} duration={duration} cookies={'yes' if cookies else 'no'}")
    return {"ok": True, "id": jid, "video_id": vid, "workers": workers}

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
    try:
        await page.context.close()
    except Exception:
        pass
    log(f"worker {worker_id} stopped by user")
    return {"ok": True}

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
    uvicorn.run(app, host="0.0.0.0", port=8010)
