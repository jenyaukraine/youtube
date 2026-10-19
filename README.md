# Katya Browser Lab

**Руки для браузера.** Записываешь действия на живой странице, сохраняешь сценарий, запускаешь на Windows-ПК, mini-PC или
сервере — сам или через ИИ-агента по MCP. Концепция и бизнес-модель: [CONCEPT.md](CONCEPT.md). Правила интерфейса:
[DESIGN.md](DESIGN.md).

Что умеет сегодня:

- **Вкладки** Chromium под управлением Playwright с живым превью: клик, прокрутка, выделение, ввод с клавиатуры прямо на кадре.
- **Сценарий** на каждой вкладке: запись шагов, повтор N раз, запуск с выбранного шага, сохранение, настройки запуска
  (адрес, заголовки, профиль браузера) внутри сценария. Редактор на странице «Сценарии» с переменными `{{имя}}`.
- **Триггеры** «когда видно X → сделать Y» с проверкой на открытой вкладке и подсветкой найденного элемента.
- **Мой Chrome** — режим через расширение `Katya-Browser-Bridge`: сценарий выполняется в подключённой вкладке твоего
  установленного Chrome (нужен для сайтов, где ты уже вошёл в аккаунт вручную).
- **MCP-сервер** с 19 инструментами для Claude Code, Codex, OpenClaw, Cursor: те же вкладки, те же сценарии.
- Файловое хранилище скриншотов и загрузок, API-токен для агентов, Docker для x86 и ARM.

Katya не обходит защиту сервисов и не накручивает метрики. Счётчик времени видео в панели — локальная диагностика, не
статистика площадки.

## Запуск на Windows

Установи Python 3.11+ с python.org (галочка «Add to PATH») и дважды кликни:

- `Start-Katya.bat` — при первом запуске создаёт `.venv`, ставит зависимости и Chromium, затем открывает панель на
  <http://127.0.0.1:8010/>. Окна браузера видимы (`KATYA_HEADLESS=0`), до 32 вкладок (`KATYA_MAX_TABS`). Если установлен
  Chrome, используется он (`KATYA_BROWSER_CHANNEL` выбирает другой канал Playwright).
- `Katya-MCP.bat` — MCP-сервер для агентов; приложение должно быть запущено.

Токен для агентов создаётся при первом старте в `data/api_token.txt`. В панели он нужен только для раздела «Файлы»:
триггеры и сценарии панель сохраняет через собственную вкладку.

## Docker (Linux-десктоп, ARM mini-PC, VPS)

```bash
git clone https://github.com/jenyaukraine/youtube.git && cd youtube && docker compose up --build -d
```

Панель: <http://127.0.0.1:8010/>. Образ собирается под архитектуру устройства (`linux/amd64` или `linux/arm64`). Сервис
слушает только loopback, потому что у панели нет входа; к безголовому устройству подключайся через SSH-туннель:

```bash
ssh -L 8010:127.0.0.1:8010 user@mini-device
```

`KATYA_PORT` меняет порт, `KATYA_BIND_IP` адрес (открывать панель в интернет небезопасно). Команды: `docker compose logs -f`,
`docker compose ps`, `docker compose down`, `docker compose up --build -d`.

## Без Docker

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install --with-deps chromium
python3 app.py
```

Переменные: `KATYA_PORT` (8010), `KATYA_BIND_HOST` (0.0.0.0), `KATYA_HEADLESS` (1), `KATYA_MAX_TABS` (8),
`KATYA_DATA_DIR` (./data), `KATYA_API_TOKEN` (иначе генерируется), `KATYA_SCENARIO_DELAY` (1 с между загрузкой страницы и
первым шагом), `KATYA_LOW_MEMORY=1` для слабых VPS/ARM. Юнит systemd для VPS: `deploy/katya-viewbot.service`.

## Ядро: один формат шага для всего

Это фундамент, на который дальше ляжет LLM: любое действие — человека, сценария, триггера, HTTP-клиента или агента по MCP —
один и тот же JSON-шаг, который исполняет `katya/actions.py`. Новые действия добавляются только туда.

```json
{"action": "click", "kind": "text", "query": "Accept all", "value": "", "x": 0, "y": 0,
 "nth": 0, "timeout_ms": 7000, "optional": false, "name": ""}
```

| action | что нужно | смысл |
|---|---|---|
| `navigate`, `reload`, `back` | `value` = URL для navigate | навигация |
| `click`, `wait_click`, `dblclick`, `hover` | элемент | `wait_click` ждёт элемент до 2 минут |
| `point`, `move` | `x`, `y` (доли окна 0..1) | клик или курсор в точке на кадре |
| `mouse_drag` | `x`, `y`, `end_x`, `end_y` | выделение или перетаскивание мышью |
| `inspect` | `x`, `y` | CSS-селектор, тег, текст и рамка элемента в точке |
| `fill`, `type`, `select` | элемент + `value` (`type` может без элемента) | заполнить поле, напечатать, выбрать option |
| `press` | `value` = клавиша: `Enter`, `Escape`, `Control+A` | клавиатура |
| `scroll` | `value` = пиксели, или элемент | прокрутка колесом или к элементу |
| `drag` | элемент + `value` = элемент-цель | drag-and-drop |
| `wait`, `wait_for`, `wait_gone`, `wait_url` | мс / элемент / элемент / regex | ожидания |
| `text`, `attribute`, `exists`, `count` | элемент (+ `value` = имя атрибута) | чтение данных со страницы |
| `screenshot` | `name`, `value` = `full` | JPEG в файловое хранилище |
| `page_text` | `value` = лимит символов | видимый текст страницы |

`kind`: `css`, `text`, `role` (+ `role`), `label`, `placeholder`, `xpath`. При нескольких совпадениях — `nth` (с 1) или
точнее запрос. Шаг с `optional: true` не останавливает сценарий при сбое.

**Сценарий** = `{name, steps[], start_url, settings{headers, user_agent_mode, profile}, variables{}}`. Один объект и в панели,
и на странице «Сценарии», и как серверный макрос (`/api/macros`).

## Командная строка

Сценарии запускаются без панели и сервера: из консоли, в CI, из скриптов агентов. Формат файла тот же, что у панели,
страницы «Сценарии» и серверных макросов; примеры с описанием лежат в `examples/`. На Windows `Katya-Run.bat`
пробрасывает аргументы в `.venv\Scripts\python.exe -m katya.cli`.

```bash
python -m katya.cli validate examples/search-wikipedia.json
```

```bash
python -m katya.cli run examples/search-wikipedia.json --var query="browser automation" --shots data/cli-shots
```

```bash
python -m katya.cli run examples/accept-cookies-template.json --url https://example.com --json
```

| команда | что делает |
|---|---|
| `run <файл> [--url URL] [--var имя=значение …] [--repeat N] [--headed] [--shots DIR] [--json]` | выполнить сценарий в своём Chromium; код выхода 0 при успехе, 1 при сбое |
| `validate <файл> [--json]` | проверить файл по схеме `Macro`/`Step` и перечислить проблемы |
| `export-macros <папка> [--url http://127.0.0.1:8010] [--token …]` | скачать серверные макросы (`GET /api/macros`) в JSON-файлы |
| `import <файл> [--url …] [--token …]` | отправить сценарий на сервер (`POST /api/macros`) |

`run` печатает отчёт по шагам («Клик: селектор «#btn»», «Пауза 1.5 с») или, с `--json`, объект
`{ok, completed, total, error, duration_ms, screenshot, results}`. При сбое шага скриншот страницы сохраняется в `--shots`.
Переменные `{{имя}}` берутся из `variables` файла, `--var` и переменных окружения `KATYA_VAR_<ИМЯ>`; `{{password}}` в файле
не хранится и передаётся только при запуске. `--repeat` заново открывает стартовый адрес на каждом повторе, в значениях
переменных работают шаблоны `{n}`, `{rand4}`, `{word}` как на странице «Сценарии». `--url` заменяет `start_url`;
`settings.headers`, `user_agent_mode`, `profile` и `dialogs` учитываются так же, как в панели. Токен для `import` и
`export-macros`: `--token`, `KATYA_API_TOKEN` или `data/api_token.txt`. Браузер: `KATYA_BROWSER_CHANNEL` и задержка перед
первым шагом `KATYA_SCENARIO_DELAY` как у сервера. Из Python: `from katya.runner import run_scenario`.

Тесты: `python tests/test_cli.py` (локальная страница на встроенном `http.server`, без pytest).

## HTTP API

Управление вкладкой: `control_token` из ответа `/api/start` (панель) или API-токен в заголовке `X-Katya-Token` (агенты).
Записи триггеров и макросов принимают API-токен или пару `X-Katya-Job` + `X-Katya-Control-Token` открытой вкладки.

| метод и путь | назначение |
|---|---|
| `POST /api/start` `{url, workers, duration, headers, user_agent_mode, profile, dialogs, steps}` | открыть вкладки; `steps` выполнятся после загрузки |
| `GET /api/status`, `GET /api/jobs` (токен) | состояние; `/api/jobs` включает control-токены |
| `GET /api/profiles` | профили браузера |
| `POST /api/stop`, `POST /api/job/{job}/stop`, `POST /api/worker/{job}/{tab}/stop`, `.../reload` | остановить, перезагрузить |
| `POST /api/worker/{job}/{tab}/action` | один шаг |
| `POST /api/worker/{job}/{tab}/steps` `{steps, delay_ms}` | сценарий |
| `GET /api/worker/{job}/{tab}/text`, `.../screenshot?force=1` | прочитать страницу |
| `GET/POST /api/triggers`, `DELETE /api/triggers/{id}`, `POST /api/triggers/{id}/enabled?enabled=` | триггеры |
| `POST /api/triggers/test` `{when, then, job_id, worker_id, run}` | проверить условие на вкладке, при `run` выполнить реакцию |
| `GET/POST /api/macros`, `DELETE /api/macros/{name}`, `POST /api/macros/{name}/run` | серверные сценарии |
| `GET /api/files`, `GET/DELETE /api/files/{name}` | скриншоты и загрузки |
| `WS /ws` | живое состояние каждые 2 с |

Триггер: `{"name","when":{"kind","query","role"},"then":[шаги],"once_per_page","cooldown_ms","job_id"}`; `when.kind`
может быть `url` с регулярным выражением. Проверяется в каждой вкладке раз в секунду, хранится в `data/triggers.json`.

## MCP для агентов (Claude Code, Codex, OpenClaw, Cursor)

`python -m katya.mcp_server` (или `Katya-MCP.bat`) — stdio MCP-сервер поверх HTTP API: агенты и панель делят одни вкладки.
Инструменты: `katya_open`, `katya_tabs`, `katya_action`, `katya_run`, `katya_text`, `katya_screenshot`, `katya_inspect`,
`katya_close`, `katya_stop_all`, `katya_profiles`, `katya_triggers`, `katya_trigger_add`, `katya_trigger_delete`,
`katya_macros`, `katya_macro_save`, `katya_macro_run`, `katya_files`, `katya_file`.

Claude Code на Windows:

```bash
claude mcp add katya -- cmd /c D:\Projects\youtube\Katya-MCP.bat
```

Любой клиент: команда `python`, аргументы `-m katya.mcp_server`, рабочая папка — репозиторий, переменные `KATYA_URL`
(по умолчанию `http://127.0.0.1:8010`) и `KATYA_API_TOKEN` (или чтение `data/api_token.txt`).

## Расширение «Мой Chrome»

Исходники в `chrome-extension/`, архив для установки собирается `python scripts/package_extension.py` в
`static/Katya-Browser-Bridge.zip` и скачивается из панели. Установка: `chrome://extensions` → режим разработчика →
«Загрузить распакованное». Расширение подключает выбранную вкладку к панели; на страницах входа Google оно не работает —
вход выполняется вручную.

## Структура репозитория

| путь | что это |
|---|---|
| `app.py` | FastAPI: вкладки, API, триггеры, макросы, файлы, WebSocket |
| `katya/actions.py` | схема шага и исполнитель — единственное место для новых действий |
| `katya/triggers.py` | движок триггеров |
| `katya/profiles.py` | профили браузера |
| `katya/runner.py` | запуск сценария в своём Chromium без сервера |
| `katya/cli.py`, `Katya-Run.bat` | командная строка: run, validate, export-macros, import |
| `examples/` | примеры сценариев с описанием |
| `tests/` | тесты: `python tests/test_cli.py`, `python tests/test_extension_flow.py` |
| `katya/mcp_server.py` | MCP-мост для агентов |
| `static/index.html` | панель (разметка и логика) |
| `static/scenarios.html` | редактор сценариев |
| `static/katya.css` | единая дизайн-система |
| `static/katya-fx.js` | фоновые эффекты (можно выключить кнопкой «Эффекты») |
| `static/chrome-panel.js` | режим «Мой Chrome» в панели |
| `chrome-extension/` | расширение-мост |
| `scripts/package_extension.py` | сборка ZIP расширения |
| `Start-Katya.bat`, `Katya-MCP.bat` | запуск на Windows |
| `Dockerfile`, `compose.yaml`, `deploy/` | сервер и mini-PC |
