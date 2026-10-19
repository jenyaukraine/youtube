"""Katya from the command line: run and validate scenarios, exchange macros with a server.

    python -m katya.cli run examples/search-wikipedia.json --var query=Playwright --shots data/cli-shots
    python -m katya.cli validate examples/search-wikipedia.json
    python -m katya.cli export-macros --url http://127.0.0.1:8010 backup/
    python -m katya.cli import backup/my-macro.json --token ...

Exit code 0 on success, 1 on any failure, so the commands fit into CI and agent scripts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional

from katya.actions import Macro, normalize_url, validate_step
from katya.runner import ScenarioError, run_scenario, scenario_variables

DEFAULT_SERVER = os.environ.get("KATYA_URL", "http://127.0.0.1:8010")
KIND_LABELS = {"css": "селектор", "text": "текст", "role": "роль", "label": "подпись",
               "placeholder": "placeholder", "xpath": "xpath"}


# ---------------- helpers ----------------
def load_scenario(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8-sig") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ScenarioError("В файле должен быть один объект сценария {name, steps, ...}")
    if "steps" not in data and "startUrl" in data:   # export from the scenarios page
        data["start_url"] = data.get("startUrl", "")
    return data


def parse_vars(items: Optional[List[str]]) -> Dict[str, str]:
    """--var name=value, plus KATYA_VAR_<NAME> environment variables (CI secrets)."""
    values: Dict[str, str] = {}
    for key, value in os.environ.items():
        if key.startswith("KATYA_VAR_") and len(key) > 10:
            values[key[10:].lower()] = value
    for item in items or []:
        name, sep, value = item.partition("=")
        if not sep or not re.fullmatch(r"[a-zA-Z]\w*", name):
            raise ScenarioError(f"Переменная должна быть вида имя=значение: {item}")
        values[name] = value
    return values


def pct(value: float) -> str:
    return f"{round(float(value or 0) * 100)}%"


def describe_step(step: Dict[str, Any]) -> str:
    """Human label for a step, same wording as the dashboard (Клик: …, Пауза 1.5 с)."""
    action = step.get("action", "")
    query = str(step.get("query") or "")[:40]
    kind = step.get("kind") or "css"
    target = f"{KIND_LABELS.get(kind, kind)} «{query}»" if query else ""
    value = str(step.get("value") or "")
    secret = re.search(r"{{\s*password\s*}}", value) or step.get("secret")
    text = "••••••" if secret else (f"«{value[:28]}…»" if len(value) > 28 else f"«{value}»")
    if action == "wait":
        try:
            ms = float(value or 1000)
        except ValueError:
            ms = 0
        return f"Пауза {ms / 1000:.1f} с"
    labels = {
        "point": lambda: f"Клик по точке {pct(step.get('x'))}, {pct(step.get('y'))}",
        "move": lambda: f"Курсор к {pct(step.get('x'))}, {pct(step.get('y'))}",
        "mouse_drag": lambda: f"Выделение мышью {pct(step.get('x'))}, {pct(step.get('y'))} → "
                              f"{pct(step.get('end_x'))}, {pct(step.get('end_y'))}",
        "inspect": lambda: f"Осмотр точки {pct(step.get('x'))}, {pct(step.get('y'))}",
        "click": lambda: f"Клик: {target or 'элемент'}",
        "wait_click": lambda: f"Дождаться и кликнуть: {target}",
        "dblclick": lambda: f"Двойной клик: {target}",
        "hover": lambda: f"Навести на {target}",
        "scroll": lambda: (f"Прокрутить к {target}" if target else
                           f"Прокрутка {'вверх' if value.startswith('-') else 'вниз'} на {value.lstrip('-') or 500} px"),
        "type": lambda: f"Ввод текста {text}" if value else "Ввод текста",
        "fill": lambda: f"Заполнить {target} → {text if value else '…'}",
        "select": lambda: f"Выбрать {text} в {target}",
        "press": lambda: f"Клавиша {value or '?'}",
        "navigate": lambda: "Открыть " + re.sub(r"^https?://", "", value)[:48],
        "reload": lambda: "Перезагрузить страницу",
        "back": lambda: "Назад",
        "wait_for": lambda: f"Ждать появления {target}",
        "wait_gone": lambda: f"Ждать исчезновения {target}",
        "wait_url": lambda: f"Ждать URL {text}",
        "screenshot": lambda: "Скриншот" + (f" «{step['name']}»" if step.get("name") else ""),
        "page_text": lambda: "Прочитать текст страницы",
        "text": lambda: f"Прочитать текст {target}",
        "attribute": lambda: f"Атрибут {value} у {target}",
        "exists": lambda: f"Есть ли {target}",
        "count": lambda: f"Сколько {target}",
        "drag": lambda: f"Перетащить {target} → {text}",
    }
    label = labels.get(action, lambda: action)()
    if step.get("optional"):
        label += " (необязательно)"
    return label


def server_token(explicit: Optional[str]) -> str:
    """API token: --token, then KATYA_API_TOKEN, then data/api_token.txt next to the repo."""
    if explicit:
        return explicit
    token = os.environ.get("KATYA_API_TOKEN", "").strip()
    if token:
        return token
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(os.environ.get("KATYA_DATA_DIR", os.path.join(root, "data")), "api_token.txt")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w.-]+", "-", name, flags=re.UNICODE).strip("-.")
    return (cleaned or "macro")[:80]


def print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=1))


# ---------------- commands ----------------
def cmd_validate(args) -> int:
    problems = validate_file(args.scenario)
    if args.json:
        print_json({"ok": not problems, "file": args.scenario, "problems": problems})
    elif problems:
        print(f"Сценарий {args.scenario}: найдено проблем — {len(problems)}")
        for problem in problems:
            print(f"  - {problem}")
    else:
        scenario = load_scenario(args.scenario)
        names = scenario_variables(scenario)
        print(f"OK: «{scenario.get('name')}», шагов: {len(scenario['steps'])}"
              + (f", переменные: {', '.join(names)}" if names else ""))
    return 1 if problems else 0


def validate_file(path: str) -> List[str]:
    problems: List[str] = []
    try:
        scenario = load_scenario(path)
    except (OSError, ValueError, ScenarioError) as e:
        return [f"Не удалось прочитать файл: {e}"]
    try:
        macro = Macro.model_validate({**scenario, "name": scenario.get("name") or "scenario"})
    except Exception as e:   # pydantic.ValidationError: list every field problem
        errors = getattr(e, "errors", None)
        if callable(errors):
            for item in errors():
                where = ".".join(str(part) for part in item.get("loc", ())) or "сценарий"
                problems.append(f"{where}: {item.get('msg')}")
        else:
            problems.append(str(e).splitlines()[0])
        return problems
    for index, step in enumerate(macro.steps, 1):
        error = validate_step(step)
        if error:
            problems.append(f"шаг {index} ({describe_step(step.model_dump())}): {error}")
    start_url = str(scenario.get("start_url") or "")
    if start_url and "{{" not in start_url and not normalize_url(start_url):
        problems.append(f"start_url: неверный адрес «{start_url}»")
    settings = scenario.get("settings")
    if settings is not None and not isinstance(settings, dict):
        problems.append("settings: должен быть объектом")
    elif isinstance(settings, dict):
        headers = settings.get("headers")
        if headers is not None and not (isinstance(headers, dict)
                                        and all(isinstance(k, str) and isinstance(v, str) for k, v in headers.items())):
            problems.append("settings.headers: должен быть объектом строка → строка")
        mode = settings.get("user_agent_mode")
        if mode not in (None, "", "chrome", "random", "browser"):
            problems.append(f"settings.user_agent_mode: неизвестный режим «{mode}»")
    variables = scenario.get("variables")
    if variables is not None and not isinstance(variables, dict):
        problems.append("variables: должен быть объектом имя → значение")
    return problems


def cmd_run(args) -> int:
    try:
        scenario = load_scenario(args.scenario)
        variables = parse_vars(args.var)
    except (OSError, ValueError, ScenarioError) as e:
        if args.json:
            print_json({"ok": False, "error": str(e)})
        else:
            print(f"Ошибка: {e}", file=sys.stderr)
        return 1
    quiet = args.json
    if not quiet:
        print(f"Сценарий «{scenario.get('name') or args.scenario}», шагов: {len(scenario.get('steps') or [])}"
              + (f", повторов: {args.repeat}" if args.repeat > 1 else ""))

    def on_step(event):
        if quiet or event["status"] == "running":
            return
        result = event["result"] or {}
        prefix = f"[{event['repeat']}/{event['repeats']}] " if event["repeats"] > 1 else ""
        line = f"{prefix}{event['index'] + 1:>3}. {describe_step(event['step'])}"
        if result.get("ok"):
            extra = ""
            if "text" in result:
                extra = " → " + " ".join(str(result["text"]).split())[:80]
            elif "count" in result:
                extra = f" → {result['count']}"
            elif result.get("file"):
                extra = f" → {result['file']}"
            elif "value" in result and event["step"]["action"] == "attribute":
                extra = f" → {result['value']}"
            print(f"  ok   {line}{extra}  ({result.get('ms', 0)} мс)")
        else:
            marker = "skip" if event["step"].get("optional") else "FAIL"
            print(f"  {marker} {line}: {result.get('error')}")

    report = run_scenario(scenario, url=args.url, headless=not args.headed, variables=variables,
                          repeat=args.repeat, screenshots_dir=args.shots, on_step=on_step)
    if quiet:
        print_json(report)
    elif report["ok"]:
        print(f"Готово: {report['completed']} из {report['total']} шагов за {report['duration_ms'] / 1000:.1f} с")
    else:
        sys.stdout.flush()
        print(f"Сбой: {report['error']}", file=sys.stderr)
        print(f"Выполнено {report['completed']} из {report['total']} шагов за {report['duration_ms'] / 1000:.1f} с",
              file=sys.stderr)
        if report.get("screenshot"):
            print(f"Скриншот ошибки: {report['screenshot']}", file=sys.stderr)
    return 0 if report["ok"] else 1


def cmd_export(args) -> int:
    import httpx
    base = args.url.rstrip("/")
    headers = {"X-Katya-Token": server_token(args.token)} if server_token(args.token) else {}
    try:
        response = httpx.get(f"{base}/api/macros", headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"Не удалось получить макросы с {base}: {str(e)[:200]}", file=sys.stderr)
        return 1
    macros = data.get("macros") if isinstance(data, dict) else None
    if not isinstance(macros, list):
        print("Сервер вернул неожиданный ответ", file=sys.stderr)
        return 1
    os.makedirs(args.dir, exist_ok=True)
    written = []
    for macro in macros:
        path = os.path.join(args.dir, safe_filename(str(macro.get("name") or "macro")) + ".json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(macro, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
        written.append(path)
    if args.json:
        print_json({"ok": True, "files": written})
    else:
        for path in written:
            print(path)
        print(f"Сохранено макросов: {len(written)} в {args.dir}")
    return 0


def cmd_import(args) -> int:
    import httpx
    try:
        scenario = load_scenario(args.scenario)
    except (OSError, ValueError, ScenarioError) as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 1
    problems = validate_file(args.scenario)
    if problems:
        print("Сценарий не прошёл проверку:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    token = server_token(args.token)
    if not token:
        print("Нужен API-токен: --token, KATYA_API_TOKEN или data/api_token.txt", file=sys.stderr)
        return 1
    base = args.url.rstrip("/")
    try:
        response = httpx.post(f"{base}/api/macros", json=scenario, headers={"X-Katya-Token": token}, timeout=15)
        data = response.json()
    except Exception as e:
        print(f"Не удалось отправить на {base}: {str(e)[:200]}", file=sys.stderr)
        return 1
    if not (isinstance(data, dict) and data.get("ok")):
        error = data.get("error") if isinstance(data, dict) else f"HTTP {response.status_code}"
        print(f"Сервер отказал: {error}", file=sys.stderr)
        return 1
    if args.json:
        print_json(data)
    else:
        print(f"Сохранено на сервере: «{data['macro']['name']}», шагов: {len(data['macro']['steps'])}")
    return 0


# ---------------- argparse ----------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="katya", description="Katya Browser Lab: сценарии из командной строки")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="выполнить сценарий в своём Chromium")
    run.add_argument("scenario", help="JSON-файл сценария")
    run.add_argument("--url", help="стартовый адрес вместо start_url из файла")
    run.add_argument("--var", action="append", metavar="name=value", help="значение переменной {{name}}")
    run.add_argument("--repeat", type=int, default=1, help="сколько раз выполнить (страница открывается заново)")
    run.add_argument("--headed", action="store_true", help="показать окно браузера")
    run.add_argument("--shots", metavar="DIR", help="папка для скриншотов (шаги screenshot и скриншот ошибки)")
    run.add_argument("--json", action="store_true", help="печатать отчёт в JSON")
    run.set_defaults(func=cmd_run)

    validate = sub.add_parser("validate", help="проверить файл сценария по схеме")
    validate.add_argument("scenario")
    validate.add_argument("--json", action="store_true")
    validate.set_defaults(func=cmd_validate)

    export = sub.add_parser("export-macros", help="скачать серверные макросы в папку")
    export.add_argument("dir", help="куда сохранить файлы")
    export.add_argument("--url", default=DEFAULT_SERVER, help=f"адрес сервера (по умолчанию {DEFAULT_SERVER})")
    export.add_argument("--token", help="API-токен (иначе KATYA_API_TOKEN или data/api_token.txt)")
    export.add_argument("--json", action="store_true")
    export.set_defaults(func=cmd_export)

    imp = sub.add_parser("import", help="отправить сценарий на сервер как макрос")
    imp.add_argument("scenario")
    imp.add_argument("--url", default=DEFAULT_SERVER)
    imp.add_argument("--token")
    imp.add_argument("--json", action="store_true")
    imp.set_defaults(func=cmd_import)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):   # Russian output on Windows consoles with a legacy code page
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("Остановлено", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
