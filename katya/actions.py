"""Uniform browser action schema and executor.

One JSON shape describes every action, whether it comes from the dashboard,
a recorded macro, a trigger reaction, the HTTP API or the MCP server:

    {"action": "click", "kind": "text", "query": "Accept all"}
    {"action": "fill", "kind": "label", "query": "Email", "value": "a@b.c"}
    {"action": "type", "value": "hello"}            # types into the focused element
    {"action": "point", "x": 0.5, "y": 0.3}
    {"action": "wait", "value": "1500"}

`run_step` executes one step on a Playwright page and returns a result dict
that always has `ok`; `run_steps` executes a list in order and stops on the
first failure unless the step is marked `optional`.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlsplit

from playwright.async_api import Page
from pydantic import BaseModel, Field

ActionName = Literal[
    "navigate", "reload", "back",
    "click", "wait_click", "dblclick", "point", "mouse_drag", "inspect",
    "fill", "type", "press", "hover", "drag", "scroll", "select",
    "wait", "wait_for", "wait_gone", "wait_url",
    "text", "attribute", "exists", "count", "screenshot", "page_text",
]
TargetKind = Literal["css", "text", "role", "label", "placeholder", "xpath"]

ALLOWED_ROLES = {"button", "link", "checkbox", "radio", "tab", "menuitem", "textbox",
                 "combobox", "option", "listitem", "heading", "dialog", "img"}
ELEMENT_ACTIONS = {"click", "wait_click", "dblclick", "fill", "hover", "drag", "select",
                   "wait_for", "wait_gone", "text", "attribute", "exists", "count"}
VALUE_ACTIONS = {"drag", "press", "navigate", "attribute", "wait_url", "select"}
MAX_TIMEOUT_MS = 180_000


class Step(BaseModel):
    """One browser action. All fields except `action` are optional per action."""
    action: ActionName
    kind: TargetKind = "css"
    query: str = ""
    role: str = "button"
    value: str = ""
    x: float = 0
    y: float = 0
    end_x: float = 0                 # mouse_drag end point (fractions)
    end_y: float = 0
    nth: int = 0                     # which match to use when several elements match (0 = require exactly one)
    timeout_ms: int = 7000
    optional: bool = False           # a failing optional step does not stop a macro
    name: str = ""                   # label shown in logs and used as screenshot file name


class Macro(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    steps: List[Step] = Field(min_length=1, max_length=200)
    description: str = ""


def normalize_url(raw: str) -> Optional[str]:
    raw = raw.strip()
    if len(raw) > 2048 or any(ch in raw for ch in "\r\n\x00"):
        return None
    if not raw.startswith(("http://", "https://")):
        video = re.search(r"(?:youtu\.be/|v=|/videos/|embed/|shorts/)([A-Za-z0-9_-]{11})", raw)
        if video:
            return f"https://www.youtube.com/watch?v={video.group(1)}"
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
            return f"https://www.youtube.com/watch?v={raw}"
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if not parts.hostname or parts.username or parts.password:
        return None
    return raw


def validate_step(step: Step) -> Optional[str]:
    """Return an error message or None."""
    query = step.query.strip()
    if len(query) > 300 or len(step.value) > 4096:
        return "Слишком длинный запрос"
    if step.kind == "role" and step.role not in ALLOWED_ROLES:
        return f"Неподдерживаемая роль: {step.role}"
    if step.action in ELEMENT_ACTIONS and not query:
        return f"Действие {step.action}: укажи элемент"
    if step.action in VALUE_ACTIONS and not step.value.strip():
        return f"Действие {step.action}: укажи значение"
    if step.action == "type" and not step.value:
        return "Действие type: укажи текст"
    if step.action == "navigate" and not normalize_url(step.value):
        return "Неверный URL"
    if step.action in {"point", "inspect", "mouse_drag"} and not (0 <= step.x <= 1 and 0 <= step.y <= 1):
        return "Точка вне вкладки (x и y должны быть от 0 до 1)"
    if step.action == "mouse_drag" and not (0 <= step.end_x <= 1 and 0 <= step.end_y <= 1):
        return "Конечная точка вне вкладки (end_x и end_y от 0 до 1)"
    if not (100 <= step.timeout_ms <= MAX_TIMEOUT_MS):
        return f"timeout_ms должен быть от 100 до {MAX_TIMEOUT_MS}"
    if step.nth < 0 or step.nth > 500:
        return "nth вне диапазона"
    return None


def locate(page: Page, kind: str, query: str, role: str = "button"):
    if kind == "css":
        return page.locator(query)
    if kind == "xpath":
        return page.locator(f"xpath={query}")
    if kind == "text":
        return page.get_by_text(query, exact=False)
    if kind == "role":
        return page.get_by_role(role, name=query, exact=False)
    if kind == "placeholder":
        return page.get_by_placeholder(query, exact=False)
    return page.get_by_label(query, exact=False)


async def _single(page: Page, step: Step, kind: str, query: str):
    """Resolve a locator that must identify one element (or the nth match)."""
    loc = locate(page, kind, query, step.role)
    if step.nth > 0:
        return loc.nth(step.nth - 1), None
    count = await loc.count()
    if count == 1:
        return loc, None
    if count == 0:
        return None, "Элемент не найден"
    return None, f"Найдено элементов: {count}. Уточни запрос или укажи nth."


INSPECT_JS = """({x,y}) => {
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
  const r = el.getBoundingClientRect();
  return {selector, tag, text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim().slice(0,100),
          role: el.getAttribute('role') || '', box: {x:r.x, y:r.y, width:r.width, height:r.height}};
}"""

PAGE_TEXT_JS = """(limit) => {
  const main = document.querySelector('main, article, [role=main]') || document.body;
  return (main?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, limit);
}"""


async def run_step(page: Page, step: Step, *, screenshot_sink=None) -> Dict[str, Any]:
    """Execute one step. Never raises; returns {"ok": bool, ...}."""
    error = validate_step(step)
    if error:
        return {"ok": False, "error": error}
    query = step.query.strip()
    timeout = step.timeout_ms
    started = time.monotonic()
    try:
        result: Dict[str, Any] = {"ok": True}
        if step.action == "navigate":
            await page.goto(normalize_url(step.value), wait_until="domcontentloaded", timeout=max(timeout, 30000))
        elif step.action == "reload":
            await page.reload(wait_until="domcontentloaded", timeout=max(timeout, 30000))
        elif step.action == "back":
            await page.go_back(wait_until="domcontentloaded", timeout=max(timeout, 30000))
        elif step.action == "point":
            viewport = page.viewport_size
            if not viewport:
                return {"ok": False, "error": "Неизвестен размер вкладки"}
            await page.mouse.click(round(step.x * viewport["width"]), round(step.y * viewport["height"]))
        elif step.action == "mouse_drag":
            viewport = page.viewport_size
            if not viewport:
                return {"ok": False, "error": "Неизвестен размер вкладки"}
            await page.mouse.move(step.x * viewport["width"], step.y * viewport["height"])
            await page.mouse.down()
            try:
                await page.mouse.move(step.end_x * viewport["width"], step.end_y * viewport["height"], steps=14)
            finally:
                await page.mouse.up()
        elif step.action == "inspect":
            viewport = page.viewport_size
            if not viewport:
                return {"ok": False, "error": "Неизвестен размер вкладки"}
            found = await page.evaluate(INSPECT_JS, {"x": round(step.x * viewport["width"]),
                                                    "y": round(step.y * viewport["height"])})
            if not found:
                return {"ok": False, "error": "Элемент не найден"}
            result.update(found)
        elif step.action == "scroll":
            delta = int(step.value or "500")
            if query:
                loc, err = await _single(page, step, step.kind, query)
                if err:
                    return {"ok": False, "error": err}
                await loc.scroll_into_view_if_needed(timeout=timeout)
            else:
                viewport = page.viewport_size
                if viewport:  # wheel scrolls the element under the pointer, so place it first
                    px = step.x * viewport["width"] if 0 < step.x < 1 else viewport["width"] / 2
                    py = step.y * viewport["height"] if 0 < step.y < 1 else viewport["height"] / 2
                    await page.mouse.move(px, py)
                await page.mouse.wheel(0, max(-5000, min(5000, delta)))
        elif step.action == "press":
            await page.keyboard.press(step.value.strip())
        elif step.action == "type" and not query:
            await page.keyboard.type(step.value, delay=0)   # into whatever element has focus
        elif step.action == "wait":
            await asyncio.sleep(min(60.0, max(0.0, float(step.value or "1000") / 1000)))
        elif step.action == "wait_url":
            await page.wait_for_url(re.compile(step.value.strip()), timeout=max(timeout, 10000))
        elif step.action == "page_text":
            result["text"] = await page.evaluate(PAGE_TEXT_JS, int(step.value or "20000"))
        elif step.action == "screenshot":
            image = await page.screenshot(type="jpeg", quality=70, timeout=max(timeout, 8000),
                                          full_page=step.value.strip().lower() == "full")
            if screenshot_sink:
                result["file"] = await screenshot_sink(image, step.name)
            else:
                result["bytes"] = len(image)
        elif step.action in {"exists", "count"}:
            count = await locate(page, step.kind, query, step.role).count()
            result["count"] = count
            result["exists"] = count > 0
        elif step.action == "wait_for":
            await locate(page, step.kind, query, step.role).first.wait_for(state="visible", timeout=timeout)
        elif step.action == "wait_gone":
            await locate(page, step.kind, query, step.role).first.wait_for(state="hidden", timeout=timeout)
        else:
            if step.action == "wait_click":
                await locate(page, step.kind, query, step.role).first.wait_for(state="visible", timeout=max(timeout, 120000))
            loc, err = await _single(page, step, step.kind, query)
            if err:
                return {"ok": False, "error": err}
            if step.action in {"click", "wait_click"}:
                await loc.click(timeout=timeout)
            elif step.action == "dblclick":
                await loc.dblclick(timeout=timeout)
            elif step.action == "fill":
                await loc.fill(step.value, timeout=timeout)
            elif step.action == "type":
                await loc.press_sequentially(step.value, delay=40, timeout=max(timeout, 30000))
            elif step.action == "hover":
                await loc.hover(timeout=timeout)
            elif step.action == "select":
                await loc.select_option(step.value, timeout=timeout)
            elif step.action == "text":
                result["text"] = (await loc.inner_text(timeout=timeout)).strip()[:4000]
            elif step.action == "attribute":
                result["value"] = await loc.get_attribute(step.value.strip(), timeout=timeout)
            elif step.action == "drag":
                target, err = await _single(page, step, step.kind, step.value.strip())
                if err:
                    return {"ok": False, "error": f"Цель перетаскивания: {err}"}
                await loc.drag_to(target, timeout=timeout)
        result["url"] = page.url
        result["ms"] = round((time.monotonic() - started) * 1000)
        return result
    except Exception as e:  # Playwright errors are many; report the first line only.
        return {"ok": False, "error": f"Не удалось выполнить {step.action}: {str(e).splitlines()[0][:160]}"}


async def run_steps(page: Page, steps: List[Step], *, delay_ms: int = 300,
                    screenshot_sink=None, lock: Optional[asyncio.Lock] = None) -> Dict[str, Any]:
    """Run steps in order. Returns {"ok", "completed", "results"}."""
    results = []
    completed = 0
    for step in steps:
        if lock:
            async with lock:
                result = await run_step(page, step, screenshot_sink=screenshot_sink)
        else:
            result = await run_step(page, step, screenshot_sink=screenshot_sink)
        results.append({"step": step.name or step.action, **result})
        if not result["ok"] and not step.optional:
            return {"ok": False, "completed": completed, "results": results, "error": result["error"]}
        completed += 1
        if delay_ms:
            await asyncio.sleep(delay_ms / 1000)
    return {"ok": True, "completed": completed, "results": results}
