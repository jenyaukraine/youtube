"""Run with: python tests/test_extension_flow.py (needs Playwright Chromium)."""
import json
import io
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/tone.wav":
            out = io.BytesIO()
            with wave.open(out, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(b"\x00\x00" * 8000 * 5)
            body, mime = out.getvalue(), "audio/wav"
            byte_range = self.headers.get("Range")
            if byte_range:
                start = int(byte_range.split("=")[1].split("-")[0])
                end = len(body) - 1
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
                body = body[start:]
            else:
                self.send_response(200)
            self.send_header("Accept-Ranges", "bytes")
        else:
            body = b'<html><body style="margin:0"><button id="target" style="position:absolute;top:50px;left:50px;width:200px;height:80px" onclick="this.dataset.count=String(+(this.dataset.count||0)+1)">Click</button><video src="/tone.wav" preload="auto" style="position:absolute;top:200px;width:200px"></video></body></html>'
            mime = "text/html; charset=utf-8"
            self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def bridge(page, command, payload=None):
    return page.evaluate("""([command,payload]) => new Promise(resolve => {
      const id=crypto.randomUUID();
      const listener=event=>{if(event.data?.source==='katya-extension'&&event.data.id===id){window.removeEventListener('message',listener);resolve(event.data.reply)}};
      window.addEventListener('message',listener);
      window.postMessage({source:'katya-dashboard',id,command,payload},location.origin);
      setTimeout(()=>{window.removeEventListener('message',listener);resolve({ok:false,error:'timeout'})},10000);
    })""", [command, payload or {}])


def main():
    server = HTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fixture_url = f"http://127.0.0.1:{server.server_port}/"
    with tempfile.TemporaryDirectory() as profile, sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, channel="chromium", headless=True,
            args=[f"--disable-extensions-except={ROOT / 'chrome-extension'}", f"--load-extension={ROOT / 'chrome-extension'}"])
        try:
            target = context.new_page()
            target.goto(fixture_url)
            panel = context.new_page()
            panel.goto("http://127.0.0.1:8010/?method=chrome")
            panel.wait_for_function("window.chromePanel && window.BrowserCore")
            tabs = bridge(panel, "tabs")
            assert tabs["ok"], tabs
            entry = next(tab for tab in tabs["tabs"] if tab["url"] == fixture_url)
            attached = bridge(panel, "attach", {"tabId": entry["id"]})
            assert attached["ok"], attached
            panel.bring_to_front()
            panel.evaluate("window.chromePanel.refresh()")
            point = bridge(panel, "execute", {"step": {"action": "point", "kind": "css", "query": "#gone", "x": 0.1, "y": 0.1}})
            assert point["ok"], point
            target.wait_for_function("document.querySelector('#target').dataset.count === '1'")
            target.wait_for_function("document.querySelector('video').readyState >= 1")
            seek = bridge(panel, "media-action", {"type": "seek", "time": 3})
            assert seek["ok"], seek
            target.wait_for_function("Math.abs(document.querySelector('video').currentTime - 3) < 0.5", timeout=5000)
            panel.wait_for_function("!document.querySelector('#chromeVideoControls').hidden", timeout=5000)
            panel.locator(".chrome-manual summary").click()
            panel.locator("#chromeManualQuery").fill("#target")
            panel.locator("#chromeManualRun").click()
            target.wait_for_function("document.querySelector('#target').dataset.count === '2'")
            scenario = {"id": "resume", "name": "Resume", "startUrl": fixture_url,
                        "steps": [{"action": "click", "kind": "css", "query": "#absent"},
                                  {"action": "click", "kind": "css", "query": "#target"}]}
            panel.evaluate("s => localStorage.setItem('katya_scenarios_v1',JSON.stringify([s]))", scenario)
            panel.reload()
            panel.locator("#startScenario").select_option("scenario:resume")
            panel.locator("#chromeStepList li").nth(1).click()
            assert "шага 2" in panel.locator("#btnStart").inner_text()
            panel.locator("#url").fill(fixture_url)
            panel.locator("#chromeRunFrom").click()
            target.wait_for_function("document.querySelector('#target').dataset.count === '3'", timeout=20000)
            panel.wait_for_function("document.querySelector('#chromeRunState').textContent.includes('Готово')", timeout=20000)
            panel.screenshot(path=str(Path(tempfile.gettempdir()) / "katya-unified-panel.png"), full_page=True)
            assert len(context.pages) >= 2
            print(json.dumps({"ok": True, "point_fallback": True, "resume_step": 2, "manual_action": True, "media_seek": True, "target_count": 3}))
        finally:
            context.close()
            server.shutdown()


if __name__ == "__main__":
    main()
