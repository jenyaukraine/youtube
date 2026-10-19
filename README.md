# Katya Browser Lab

Automation core for real Chromium tabs, driven from a dashboard, an HTTP API, or AI agents over MCP.
Open an HTTP(S) URL in isolated tabs, inspect or click on the screenshot, find elements by CSS / text / role / label /
placeholder / XPath, fill fields, scroll, drag, record a sequence as a **macro**, and define **triggers** that react to
pop-ups ("when *Accept all* is visible, click it"). Every tab gets a random popular desktop browser profile (user agent +
viewport). Screenshots and downloads land in a file store that the API exposes. The watch-time counter shows observed video
playback and is **not** verified YouTube watch time.

## Windows desktop

Install Python 3.11+ from python.org (tick "Add to PATH"), then double-click:

- `Start-Katya.bat` — creates `.venv`, installs dependencies and Chromium on first run, then starts the app on
  <http://127.0.0.1:8010/>. Browser windows are visible by default (`KATYA_HEADLESS=0`); up to 32 tabs (`KATYA_MAX_TABS`). On Windows, installed Chrome is used when available; set `KATYA_BROWSER_CHANNEL` to choose another Playwright channel. Each session uses a separate browser profile.
- `Katya-MCP.bat` — MCP server for AI agents (see below). The app must already be running.

The API token for agents is generated on first start and stored in `data/api_token.txt`. Paste it into the
"API-ключ" field of the dashboard to save triggers and macros and to see files from the browser.

## One-command Docker setup (Linux desktop, ARM mini PC, VPS)

```bash
git clone https://github.com/jenyaukraine/youtube.git && cd youtube && docker compose up --build -d
```

Open <http://127.0.0.1:8010/>. Docker builds for the native architecture (`linux/amd64` or `linux/arm64`). The service
binds to loopback because the dashboard has no login; reach a headless device through an SSH tunnel:

```bash
ssh -L 8010:127.0.0.1:8010 user@mini-device
```

`KATYA_PORT` changes the local port, `KATYA_BIND_IP` the listening address (exposing the dashboard to the Internet is
unsafe). Useful: `docker compose logs -f`, `docker compose ps`, `docker compose down`, `docker compose up --build -d`.

## Run without Docker

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install --with-deps chromium
python3 app.py
```

Environment: `KATYA_PORT` (8010), `KATYA_BIND_HOST` (0.0.0.0), `KATYA_HEADLESS` (1), `KATYA_MAX_TABS` (8),
`KATYA_DATA_DIR` (./data), `KATYA_API_TOKEN` (otherwise generated), `KATYA_LOW_MEMORY=1` for small VPS/ARM boxes.
The VPS systemd unit is in `deploy/katya-viewbot.service`.

## Uniform action schema

Every action, from the dashboard, a macro, a trigger, the API or MCP, is the same JSON step:

```json
{"action": "click", "kind": "text", "query": "Accept all", "value": "", "x": 0, "y": 0,
 "nth": 0, "timeout_ms": 7000, "optional": false, "name": ""}
```

| action | needs | meaning |
|---|---|---|
| `navigate`, `reload`, `back` | `value` = URL for navigate | page navigation |
| `click`, `wait_click`, `dblclick`, `hover` | element | `wait_click` waits up to 2 min for the element |
| `point` | `x`, `y` (0..1 fractions of the viewport) | click at a point on the screenshot |
| `inspect` | `x`, `y` | returns CSS selector, tag, text and box of the element at that point |
| `fill`, `type`, `select` | element + `value` | set a field, type by keystrokes, choose an option |
| `press` | `value` = key, e.g. `Enter`, `Escape` | keyboard |
| `scroll` | `value` = pixels, or element | wheel scroll or scroll element into view |
| `drag` | element + `value` = target element | drag and drop |
| `wait`, `wait_for`, `wait_gone`, `wait_url` | ms / element / element / regex | waiting |
| `text`, `attribute`, `exists`, `count` | element (+ `value` = attribute name) | read data from the page |
| `screenshot` | optional `name`, `value` = `full` | JPEG saved to the file store |
| `page_text` | optional `value` = char limit | visible text of the page |

`kind` is one of `css`, `text`, `role` (+ `role` name), `label`, `placeholder`, `xpath`. When several elements match,
set `nth` (1-based) or refine the query. A failing step marked `optional` does not stop a macro.

## HTTP API

Tab control needs either the `control_token` returned by `/api/start` (what the dashboard uses) or the API token in
the `X-Katya-Token` header (what agents use). Writes to triggers, macros and files need the API token.

| method and path | purpose |
|---|---|
| `POST /api/start` `{url, workers, duration, headers, user_agent_mode, profile, dialogs}` | open tabs; returns `id`, `worker_ids`, `control_token` |
| `GET /api/status`, `GET /api/jobs` (token) | state of jobs and tabs; `/api/jobs` includes control tokens |
| `GET /api/profiles` | browser identity profiles |
| `POST /api/stop`, `POST /api/worker/{job}/{tab}/stop`, `.../reload` | close or reload |
| `POST /api/worker/{job}/{tab}/action` | run one step |
| `POST /api/worker/{job}/{tab}/steps` `{steps, delay_ms}` | run a macro |
| `GET /api/worker/{job}/{tab}/text`, `.../screenshot?force=1` | read the page |
| `GET/POST /api/triggers`, `DELETE /api/triggers/{id}`, `POST /api/triggers/{id}/enabled?enabled=` | trigger rules |
| `GET/POST /api/macros`, `DELETE /api/macros/{name}`, `POST /api/macros/{name}/run` | saved macros |
| `GET /api/files`, `GET/DELETE /api/files/{name}` | screenshots and downloads |
| `WS /ws` | live state every 2 s |

`dialogs` chooses what happens to `alert`/`confirm`/`prompt` pop-ups: `dismiss` (default) or `accept`.

### Triggers

```json
{"name": "cookies", "when": {"kind": "text", "query": "Accept all"},
 "then": [{"action": "click", "kind": "text", "query": "Accept all", "optional": true}],
 "once_per_page": false, "cooldown_ms": 5000, "job_id": ""}
```

`when.kind` may also be `url` with a regular expression. Triggers are checked in every tab about once a second and are
stored in `data/triggers.json`.

## MCP for AI agents (Claude Code, Codex, OpenClaw, Cursor)

`python -m katya.mcp_server` (or `Katya-MCP.bat`) is a stdio MCP server that talks to the running app, so agents and
the dashboard share the same tabs. Tools: `katya_open`, `katya_tabs`, `katya_action`, `katya_run`, `katya_text`,
`katya_screenshot`, `katya_inspect`, `katya_close`, `katya_stop_all`, `katya_profiles`, `katya_triggers`,
`katya_trigger_add`, `katya_trigger_delete`, `katya_macros`, `katya_macro_save`, `katya_macro_run`, `katya_files`,
`katya_file`.

Claude Code (Windows):

```bash
claude mcp add katya -- cmd /c D:\Projects\youtube\Katya-MCP.bat
```

Any client: command `python`, args `-m katya.mcp_server`, working directory = this repo, env `KATYA_URL`
(default `http://127.0.0.1:8010`) and `KATYA_API_TOKEN` (or leave it to read `data/api_token.txt`).
