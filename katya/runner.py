"""Run a saved scenario in its own Chromium without the dashboard or the server.

    from katya.runner import run_scenario
    report = run_scenario(json.load(open("examples/search-wikipedia.json")), variables={"query": "Playwright"})

The scenario is the same JSON the dashboard, the scenarios page and `/api/macros`
use: {name, steps[], start_url, settings{headers, user_agent_mode, profile, dialogs},
variables{}}. Steps are executed by `katya.actions.run_steps`, so the CLI, the
panel and the MCP server behave identically.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import time
from typing import Any, Callable, Dict, List, Optional

from playwright.async_api import async_playwright

from katya.actions import Macro, Step, normalize_url, run_steps, validate_step
from katya.profiles import context_options, find_profile, random_profile

VARIABLE_RE = re.compile(r"{{\s*([a-zA-Z][\w]*)\s*}}")
TEMPLATE_FIELDS = ("value", "query")      # step fields where {{variables}} are allowed
DEFAULT_WORDS = "Бэтмен, Супермен"


class ScenarioError(Exception):
    """A problem with the scenario itself (schema, variables, URL) — not a step failure."""


def browser_channel() -> str:
    """Same choice as app.py: KATYA_BROWSER_CHANNEL, else installed Chrome on Windows, else bundled Chromium."""
    channel = os.environ.get("KATYA_BROWSER_CHANNEL", "").strip()
    if not channel and os.name == "nt":
        chrome = os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"),
                              "Google", "Chrome", "Application", "chrome.exe")
        if os.path.isfile(chrome):
            channel = "chrome"
    return channel


def scenario_variables(scenario: Dict[str, Any]) -> List[str]:
    """Names of {{variables}} used in the steps (and start_url), in order of first use."""
    found: List[str] = []
    sources = [str(scenario.get("start_url") or "")]
    for step in scenario.get("steps") or []:
        if isinstance(step, dict):
            sources.extend(str(step.get(field) or "") for field in TEMPLATE_FIELDS)
    for source in sources:
        for name in VARIABLE_RE.findall(source):
            if name not in found:
                found.append(name)
    return found


def expand_template(raw: str, n: int, words: List[str], randoms: Dict[int, str]) -> str:
    """{n} → repeat number, {rand4} → four digits (stable within one repeat), {word} → word n."""
    def rand(match):
        digits = min(12, int(match.group(1)))
        if digits not in randoms:
            randoms[digits] = "".join(str(secrets.randbelow(10)) for _ in range(digits))
        return randoms[digits]
    text = str(raw or "").replace("{n}", str(n))
    text = re.sub(r"\{rand(\d{1,2})\}", rand, text)
    return text.replace("{word}", words[(n - 1) % len(words)] if words else "")


def resolve_variables(scenario: Dict[str, Any], variables: Optional[Dict[str, str]], n: int = 1) -> Dict[str, str]:
    """Merge scenario.variables with the values passed in; every used variable must have a value."""
    values: Dict[str, str] = {}
    stored = scenario.get("variables") or {}
    if isinstance(stored, dict):
        values.update({str(k): str(v) for k, v in stored.items() if k != "password" and v not in (None, "")})
    values.update({str(k): str(v) for k, v in (variables or {}).items() if v is not None})
    needed = scenario_variables(scenario)
    missing = [name for name in needed if not values.get(name)]
    if missing:
        if "password" in missing:
            raise ScenarioError("Сценарий использует {{password}}, а пароль в сценарии не хранится: "
                                "передай его при запуске (--var password=...)")
        raise ScenarioError("Не заданы переменные: " + ", ".join(missing) + " (передай --var имя=значение)")
    words = [w.strip() for w in str(scenario.get("wordList") or DEFAULT_WORDS).split(",") if w.strip()]
    randoms: Dict[int, str] = {}
    return {name: expand_template(values[name], n, words, randoms) for name in needed}


def substitute(raw: str, values: Dict[str, str]) -> str:
    return VARIABLE_RE.sub(lambda m: values.get(m.group(1), ""), str(raw or ""))


def build_steps(scenario: Dict[str, Any], values: Dict[str, str]) -> List[Step]:
    """Validate the scenario against the shared schema and substitute variables."""
    try:
        macro = Macro.model_validate({**scenario, "name": scenario.get("name") or "scenario"})
    except Exception as e:  # pydantic.ValidationError
        raise ScenarioError(f"Сценарий не соответствует схеме: {str(e).splitlines()[0][:200]}") from e
    steps = []
    for index, step in enumerate(macro.steps, 1):
        step = step.model_copy(update={field: substitute(getattr(step, field), values) for field in TEMPLATE_FIELDS})
        error = validate_step(step)
        if error:
            raise ScenarioError(f"Шаг {index} ({step.action}): {error}")
        steps.append(step)
    return steps


def _accept_language_locale(headers: Dict[str, str]) -> str:
    language = next((v for k, v in headers.items() if k.lower() == "accept-language"), "")
    requested = language.split(",", 1)[0].split(";", 1)[0].strip()
    return requested if re.fullmatch(r"[a-z]{2}(?:-[A-Z]{2})?", requested) else "ru-RU"


async def run_scenario_async(scenario: Dict[str, Any], *, url: Optional[str] = None, headless: bool = True,
                             variables: Optional[Dict[str, str]] = None, repeat: int = 1,
                             screenshots_dir: Optional[str] = None,
                             on_step: Optional[Callable[[Dict[str, Any]], None]] = None,
                             delay_ms: int = 300, start_delay: Optional[float] = None) -> Dict[str, Any]:
    """Async core of `run_scenario`; same arguments and result."""
    started = time.monotonic()
    repeat = max(1, int(repeat))
    report: Dict[str, Any] = {"ok": False, "completed": 0, "total": 0, "error": None,
                              "duration_ms": 0, "screenshot": None, "results": []}

    def finish(ok: bool, error: Optional[str] = None) -> Dict[str, Any]:
        report["ok"] = ok
        report["error"] = error
        report["duration_ms"] = round((time.monotonic() - started) * 1000)
        return report

    if start_delay is None:
        start_delay = float(os.environ.get("KATYA_SCENARIO_DELAY", "1"))
    settings = scenario.get("settings") if isinstance(scenario.get("settings"), dict) else {}
    headers = settings.get("headers") if isinstance(settings.get("headers"), dict) else {}
    headers = {str(k): str(v) for k, v in headers.items()}
    dialogs = settings.get("dialogs", "dismiss")

    try:
        first_values = resolve_variables(scenario, variables, 1)
        steps = build_steps(scenario, first_values)
        report["total"] = len(steps) * repeat
        raw_url = url or substitute(str(scenario.get("start_url") or scenario.get("startUrl") or ""), first_values)
        start_url = normalize_url(raw_url) if raw_url else None
        if raw_url and not start_url:
            raise ScenarioError(f"Неверный стартовый адрес: {raw_url}")
        if not start_url and steps[0].action != "navigate":
            raise ScenarioError("Укажи адрес страницы: --url или start_url в сценарии (или первый шаг navigate)")
        profile = None
        if settings.get("profile"):
            profile = find_profile(str(settings["profile"]))
            if not profile:
                raise ScenarioError(f"Неизвестный профиль браузера: {settings['profile']}")
        elif settings.get("user_agent_mode") == "random":
            profile = random_profile()
    except ScenarioError as e:
        return finish(False, str(e))

    if screenshots_dir:
        os.makedirs(screenshots_dir, exist_ok=True)

    async def screenshot_sink(image: bytes, name: str) -> Optional[str]:
        if not screenshots_dir:
            return None
        safe = re.sub(r"[^\w.-]+", "_", name or "shot", flags=re.UNICODE)[:60] or "shot"
        path = os.path.join(screenshots_dir, f"{safe}-{int(time.time() * 1000)}.jpg")
        with open(path, "wb") as fh:
            fh.write(image)
        return path

    launch_options: Dict[str, Any] = {"headless": headless, "args": ["--mute-audio"]}
    if os.name != "nt":
        launch_options["args"] += ["--disable-dev-shm-usage", "--no-sandbox"]
    channel = browser_channel()
    if channel:
        launch_options["channel"] = channel

    page = None
    playwright = browser = None
    try:
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(**launch_options)
        context = await browser.new_context(**(context_options(profile) if profile else {}),
                                            extra_http_headers=headers,
                                            locale=_accept_language_locale(headers),
                                            accept_downloads=True)
        page = await context.new_page()

        async def on_dialog(dialog):
            try:
                await (dialog.accept() if dialogs == "accept" else dialog.dismiss())
            except Exception:
                pass
        page.on("dialog", lambda d: asyncio.create_task(on_dialog(d)))

        for n in range(1, repeat + 1):
            values = first_values if n == 1 else resolve_variables(scenario, variables, n)
            run_steps_list = steps if n == 1 else build_steps(scenario, values)
            if start_url:
                await page.goto(start_url, wait_until="domcontentloaded", timeout=60_000)
                if start_delay > 0:
                    await asyncio.sleep(start_delay)

            def progress(index, status, result, n=n, run_steps_list=run_steps_list):
                if on_step:
                    on_step({"repeat": n, "repeats": repeat, "index": index, "total": len(run_steps_list),
                             "step": run_steps_list[index].model_dump(), "status": status, "result": result})

            outcome = await run_steps(page, run_steps_list, delay_ms=delay_ms,
                                      screenshot_sink=screenshot_sink, on_progress=progress)
            report["results"].extend({"repeat": n, **r} for r in outcome["results"])
            report["completed"] += outcome["completed"]
            if not outcome["ok"]:
                failed = outcome["completed"] + 1
                error = f"Повтор {n}/{repeat}, шаг {failed}: {outcome['error']}" if repeat > 1 \
                    else f"Шаг {failed}: {outcome['error']}"
                report["screenshot"] = await _error_screenshot(page, screenshots_dir)
                return finish(False, error)
        return finish(True)
    except ScenarioError as e:
        return finish(False, str(e))
    except Exception as e:
        report["screenshot"] = await _error_screenshot(page, screenshots_dir)
        return finish(False, f"Браузер: {str(e).splitlines()[0][:200]}")
    finally:
        for closer in (browser, playwright):
            if closer is not None:
                try:
                    await (closer.close() if closer is browser else closer.stop())
                except Exception:
                    pass


async def _error_screenshot(page, screenshots_dir: Optional[str]) -> Optional[str]:
    if page is None or not screenshots_dir:
        return None
    try:
        path = os.path.join(screenshots_dir, f"error-{int(time.time() * 1000)}.jpg")
        await page.screenshot(path=path, type="jpeg", quality=70, timeout=8000)
        return path
    except Exception:
        return None


def run_scenario(scenario: Dict[str, Any], *, url: Optional[str] = None, headless: bool = True,
                 variables: Optional[Dict[str, str]] = None, repeat: int = 1,
                 screenshots_dir: Optional[str] = None,
                 on_step: Optional[Callable[[Dict[str, Any]], None]] = None, **options) -> Dict[str, Any]:
    """Run a scenario in a fresh Chromium and return a report:

    {"ok": bool, "completed": int, "total": int, "error": str | None, "duration_ms": int,
     "screenshot": path | None (taken on failure when screenshots_dir is set),
     "results": [{"repeat", "step", "ok", ...per-step data...}]}

    `url` overrides scenario.start_url; `variables` fills {{name}} placeholders ({{password}} is
    never read from the scenario file); `repeat` reopens the start page and runs the steps N times;
    `on_step(event)` is called before and after every step. Never raises for scenario or browser
    problems — they come back as `error`.
    """
    return asyncio.run(run_scenario_async(scenario, url=url, headless=headless, variables=variables,
                                          repeat=repeat, screenshots_dir=screenshots_dir, on_step=on_step,
                                          **options))
