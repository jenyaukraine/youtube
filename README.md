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
| `GET/POST /api/schedules`, `DELETE /api/schedules/{id}`, `POST /api/schedules/{id}/enabled?enabled=`, `POST /api/schedules/{id}/run` | расписания запусков макросов |
| `GET /api/files`, `GET/DELETE /api/files/{name}` | скриншоты и загрузки |
| `GET /api/runs?limit=&source=&macro=`, `GET /api/runs/{id}` | история запусков сценариев |
| `GET/POST /api/notify`, `POST /api/notify/test` | настройки уведомлений Telegram/Discord и пробное сообщение |
| `WS /ws` | живое состояние каждые 2 с (включая `runs_recent` — 10 последних запусков) |

Триггер: `{"name","when":{"kind","query","role"},"then":[шаги],"once_per_page","cooldown_ms","job_id"}`; `when.kind`
может быть `url` с регулярным выражением. Проверяется в каждой вкладке раз в секунду, хранится в `data/triggers.json`.

## История запусков и уведомления

Каждое выполнение сценария попадает в журнал `data/runs.json` (кольцо из 500 последних записей, атомарная запись):
стартовый сценарий вкладки (`source: startup`), `POST /api/worker/{job}/{tab}/steps` (`steps`), серверный макрос
(`macro`) и реакция триггера (`trigger`). Запись: `{id, started, finished, source, macro_name, job_id, worker_id, url,
total, completed, ok, error, screenshot, duration_ms, steps_summary}`. При ошибке автоматически делается JPEG-скриншот
вкладки в `data/files`, его имя лежит в `screenshot` и доступно как `GET /api/files/{name}` (нужен API-токен).
`steps_summary` — короткие строки «действие + цель»; значения `fill`/`type` заменены на `•••`, пароли в журнал не попадают.

```bash
curl "http://127.0.0.1:8010/api/runs?limit=20&source=macro&macro=login"
```

Уведомления о результатах настраиваются в `data/notify.json` (или через `POST /api/notify` с API-токеном):

```json
{"telegram_bot_token": "123456:ABC...", "telegram_chat_id": "-1001234567890",
 "discord_webhook_url": "https://discord.com/api/webhooks/...", "on": ["error"],
 "base_url": "http://my-host:8010"}
```

`on` — при каких исходах писать: `error`, `success` или оба. `base_url` нужен, чтобы ссылка на скриншот в сообщении
была кликабельной (без него в сообщении будет путь `/api/files/{name}`). Сообщение короткое: название сценария,
результат, «шагов N из M», URL, ошибка и ссылка на скриншот. Сетевые ошибки не мешают сценариям — только строка в логе.
`GET /api/notify` отдаёт настройки с замаскированными секретами; если прислать замаскированное значение обратно,
сохранённый секрет не изменится. `POST /api/notify/test` (или MCP `katya_notify_test`) отправляет пробное сообщение.

**Telegram.** Создай бота у [@BotFather](https://t.me/BotFather) (`/newbot`) и скопируй токен. Напиши боту любое
сообщение (или добавь его в группу и напиши там), затем открой
`https://api.telegram.org/bot<ТОКЕН>/getUpdates` — в ответе `"chat":{"id":...}` и есть `telegram_chat_id`
(у групп он отрицательный, у супергрупп начинается с `-100`). Проще: перешли сообщение боту
[@userinfobot](https://t.me/userinfobot) — он покажет id.

**Discord.** Настройки канала → Интеграции → Вебхуки → «Новый вебхук» → «Копировать URL вебхука». Вставь URL в
`discord_webhook_url`.

## Расписания

Сервер сам запускает сохранённый макрос по cron-выражению или каждые N минут: открывает новую вкладку как
`POST /api/start` (URL расписания или `start_url` макроса, настройки запуска из `settings` макроса), выполняет шаги
и через 5 с закрывает вкладку. Расписания проверяются раз в 15 с, хранятся в `data/schedules.json`, результат последнего
запуска (ok/ошибка, число шагов, длительность) попадает в `last_result` и в лог. Время — локальное время сервера.

Расписание: `{"macro_name", "cron" | "every_minutes", "url", "workers", "enabled"}`; в ответах также `id`, `last_run`,
`last_result`, `next_run`, `running`. Cron из 5 полей `минуты часы дни месяцы дни_недели`: `*`, числа, списки `1,15`,
диапазоны `9-18`, шаг `*/5` и `1-30/10`, дни недели `0-7` (0 и 7 — воскресенье) или `mon..sun`. Если заданы и день
месяца, и день недели, срабатывает любой из них (как в классическом cron).

| cron | когда |
|---|---|
| `*/30 * * * *` | каждые 30 минут |
| `0 9 * * 1-5` | по будням в 9:00 |
| `15 8,20 * * *` | в 8:15 и 20:15 каждый день |
| `0 0 1 * *` | 1-го числа в полночь |
| `0 12 * * sun` | по воскресеньям в 12:00 |

```bash
curl -X POST http://127.0.0.1:8010/api/schedules -H "X-Katya-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"macro_name":"Прогрев","cron":"0 9 * * 1-5","url":"https://example.com","workers":1}'
curl -X POST http://127.0.0.1:8010/api/schedules -H "X-Katya-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"macro_name":"Прогрев","every_minutes":30}'
curl http://127.0.0.1:8010/api/schedules
curl -X POST "http://127.0.0.1:8010/api/schedules/{id}/enabled?enabled=false" -H "X-Katya-Token: $TOKEN"
curl -X POST http://127.0.0.1:8010/api/schedules/{id}/run -H "X-Katya-Token: $TOKEN"
curl -X DELETE http://127.0.0.1:8010/api/schedules/{id} -H "X-Katya-Token: $TOKEN"
```

`POST /api/schedules` с существующим `id` обновляет расписание, история запусков сохраняется. Записи принимают API-токен
или пару `X-Katya-Job` + `X-Katya-Control-Token`. Тесты планировщика: `python tests/test_scheduler.py`.

## MCP для агентов (Claude Code, Codex, OpenClaw, Cursor)

`python -m katya.mcp_server` (или `Katya-MCP.bat`) — stdio MCP-сервер поверх HTTP API: агенты и панель делят одни вкладки.
Инструменты: `katya_open`, `katya_tabs`, `katya_action`, `katya_run`, `katya_text`, `katya_screenshot`, `katya_inspect`,
`katya_close`, `katya_stop_all`, `katya_profiles`, `katya_triggers`, `katya_trigger_add`, `katya_trigger_delete`,
`katya_macros`, `katya_macro_save`, `katya_macro_run`, `katya_schedules`, `katya_schedule_add`, `katya_schedule_delete`,
`katya_schedule_run`, `katya_files`, `katya_file`, `katya_runs`, `katya_run_get`, `katya_notify_test`.

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

## React-панель (web/)

Панель по адресу `/` — React + TypeScript из папки `web/`, собранная в `static/app/` (сборка хранится в репозитории, чтобы
Windows и Docker работали без Node). Универсальные компоненты: `ScenarioPanel` (прогресс, запись, повтор, сохранение,
выбор шага), `StepList`, `TabCard` (живой кадр с кликами, колесом, клавиатурой), `StartForm`, `Automation`, страница
сценариев — всё на одном `katya-base.css` + `katya.css`. Старая панель доступна по `/legacy/`, режим «Мой Chrome» — пока там.

```bash
cd web && pnpm install
pnpm dev        # http://localhost:5173 с прокси на запущенный app.py (8010)
pnpm build      # tsc + vite -> static/app
```

## Структура репозитория

| путь | что это |
|---|---|
| `app.py` | FastAPI: вкладки, API, триггеры, макросы, расписания, история запусков, файлы, WebSocket |
| `katya/actions.py` | схема шага и исполнитель — единственное место для новых действий |
| `katya/triggers.py` | движок триггеров |
| `katya/history.py` | история запусков сценариев (`data/runs.json`) |
| `katya/notify.py` | уведомления в Telegram и Discord (`data/notify.json`) |
| `katya/scheduler.py` | планировщик запусков макросов (cron / каждые N минут) |
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
| `tests/` | `test_scheduler.py` (cron, хранилище), `test_extension_flow.py` |
