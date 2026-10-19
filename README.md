# Katya Browser Lab

FastAPI dashboard for controlling Playwright Chromium browser sessions. Open an HTTP(S) URL, inspect or click on the screenshot, find elements by CSS/text/role/label, fill fields, scroll, drag, and record a sequence for replay. It also shows screenshots, browser state, server CPU/RAM, and observed video playback. The displayed time is **not** verified YouTube watch time.

## One-command Docker setup

Install Docker Engine with the Compose plugin (or Docker Desktop), clone this repository, then run from its directory:

```bash
docker compose up --build -d
```

On a fresh Linux ARM64 mini PC, cloning and starting can be done in one shell command:

```bash
git clone https://github.com/jenyaukraine/youtube.git && cd youtube && docker compose up --build -d
```

Open <http://127.0.0.1:8010/> on the same device. Docker automatically builds for the device's native architecture: `linux/amd64` on a typical desktop PC and `linux/arm64` on a 64-bit ARM mini PC. A 32-bit ARM OS is not supported. The first build downloads the Playwright image and Chromium, so it may take several minutes and needs several GB of free disk space.

The Docker service binds to loopback by default because the container dashboard has no login and can control its browser sessions. On a headless mini PC, access it from your desktop through an SSH tunnel:

```bash
ssh -L 8010:127.0.0.1:8010 user@mini-device
```

Then open <http://127.0.0.1:8010/> on the desktop. If port 8010 is occupied locally, change the left-hand port in the tunnel and open that port instead.

Useful commands:

```bash
docker compose logs -f
docker compose ps
docker compose down
docker compose up --build -d   # update after git pull
```

To use another local port, set `KATYA_PORT` before starting Compose. `KATYA_BIND_IP` can change the listening address, but exposing this unauthenticated dashboard to the Internet is unsafe. The image uses Playwright's bundled Chromium, not a separately installed Google Chrome. On a small ARM device, begin with one browser tab and watch RAM usage.

The screenshot offers two modes: **Click** sends a click at the selected point; **Pick element** finds an HTML element and fills its CSS selector into the action editor. The editor also supports text, role, and label queries. **Record steps** saves successful actions for replay in the current page session; **Copy steps** exports their JSON. Browser actions require the control token returned when the tab was opened, so another dashboard session cannot run them in your tab.

## Run without Docker

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install --with-deps chromium
python3 app.py
```

The server listens on port 8010. The existing VPS systemd unit is in `deploy/katya-viewbot.service`.
