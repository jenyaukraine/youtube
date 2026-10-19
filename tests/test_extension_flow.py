"""Run with: python tests/test_extension_flow.py (needs Playwright Chromium)."""
import json
import io
import tempfile
import threading
import time
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
            body = b'<html><body style="margin:0;height:2400px"><button id="target" style="position:absolute;top:50px;left:50px;width:200px;height:80px" onclick="this.dataset.count=String(+(this.dataset.count||0)+1)">Click</button><video src="/tone.wav" preload="auto" style="position:absolute;top:200px;width:200px"></video><button id="deep" style="position:absolute;top:1300px;left:100px;width:160px;height:80px" onclick="this.dataset.count=String(+(this.dataset.count||0)+1)">Deep</button><div id="pane" style="position:absolute;top:350px;left:400px;width:240px;height:170px;overflow:auto"><div style="height:600px"></div><button id="nested" style="height:60px" onclick="this.dataset.count=String(+(this.dataset.count||0)+1)">Nested</button></div></body></html>'
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
            panel.goto("http://127.0.0.1:8010/legacy/?method=chrome")
            panel.wait_for_function("window.chromePanel && window.BrowserCore")
            tabs = bridge(panel, "tabs")
            assert tabs["ok"], tabs
            entry = next(tab for tab in tabs["tabs"] if tab["url"] == fixture_url)
            panel.bring_to_front()
            attached = bridge(panel, "attach", {"tabId": entry["id"]})
            assert attached["ok"], attached
            panel.bring_to_front()
            assert bridge(panel, "keep-visible")["ok"]
            assert bridge(panel, "media")["media"]["visibility"] == "visible"
            panel.evaluate("window.chromePanel.refresh()")
            point = bridge(panel, "execute", {"step": {"action": "point", "kind": "css", "query": "#gone", "x": 0.1, "y": 0.1}})
            assert point["ok"], point
            target.wait_for_function("document.querySelector('#target').dataset.count === '1'")
            located = bridge(panel, "execute", {"step": {"action": "point", "kind": "css", "query": "#target", "x": 0.9, "y": 0.9}})
            assert located["ok"], located
            target.wait_for_function("document.querySelector('#target').dataset.count === '2'")
            target.wait_for_function("document.querySelector('video').readyState >= 1")
            seek = bridge(panel, "media-action", {"type": "seek", "time": 3})
            assert seek["ok"], seek
            target.wait_for_function("Math.abs(document.querySelector('video').currentTime - 3) < 0.5", timeout=5000)
            panel.wait_for_function("!document.querySelector('#chromeVideoControls').hidden", timeout=5000)
            target.evaluate("document.querySelector('video').muted = true")
            play = bridge(panel, "media-action", {"type": "play"})
            assert play["ok"], play
            target.wait_for_function("document.querySelector('video').currentTime > 3.2")
            assert panel.locator("#chromeScenarioMount .scenario-panel").count() == 1
            assert panel.evaluate("""() => BrowserCore.scenarioTemplate(true).replaceAll(/ id=\"chrome[A-Za-z]+\"/g, '') === BrowserCore.scenarioTemplate(false)""")
            assert panel.evaluate("""() => {
              const card = document.createElement('div');
              card.innerHTML = BrowserCore.scenarioTemplate();
              document.body.append(card);
              try {
                renderScenario(card, {_j: {id: 'fixture', scenario_steps: [{action: 'scroll', value: '400'}]}, scenario: {phase: 'done', completed: 1, current: 0}});
                return card.querySelector('.scenario-now-k').textContent === 'Сценарий выполнен' && card.querySelectorAll('.scenario-detail-list li').length === 1;
              } finally { card.remove(); }
            }""")
            panel.locator("#chromeScenarioMount .manual-action summary").click()
            panel.locator("#chromeManualQuery").fill("#target")
            panel.locator("#chromeManualRun").click()
            target.wait_for_function("document.querySelector('#target').dataset.count === '3'")
            scenario = {"id": "resume", "name": "Resume", "startUrl": fixture_url,
                        "steps": [{"action": "click", "kind": "css", "query": "#absent"},
                                  {"action": "click", "kind": "css", "query": "#target"}]}
            panel.evaluate("s => localStorage.setItem('katya_scenarios_v1',JSON.stringify([s]))", scenario)
            panel.reload()
            panel.locator("#startScenario").select_option("scenario:resume")
            panel.locator("#chromeStepList li").nth(1).click()
            assert "шага 2" in panel.locator("#btnStart").inner_text()
            panel.locator("#url").fill(fixture_url)
            started = time.monotonic()
            panel.locator("#chromeRunFrom").click()
            target.wait_for_function("document.querySelector('#target').dataset.count === '4'", timeout=6000)
            assert time.monotonic() - started < 6, "Resume waited too long on an already open tab"
            panel.wait_for_function("document.querySelector('#chromeRunState').textContent.includes('Готово')", timeout=20000)
            assert panel.locator("#chromeStepChips li").count() == 2
            panel.locator("#chromeRecord").click()
            target.locator("#target").click()
            panel.locator("#chromeRecord").click()
            panel.wait_for_function("document.querySelector('#chromeStepList').children.length === 1 && document.querySelector('#chromeRunState').textContent.includes('Сохранить')", timeout=5000)
            panel.locator("#chromeSave").click()
            saved = panel.evaluate("JSON.parse(localStorage.getItem('katya_scenarios_v1'))")
            assert len(saved) == 2 and saved[0]["steps"][0]["query"] == "#target", saved
            # Coordinate fallback must restore both the page and a nested scroller.
            for selector, setup, reset, expected in [
                ("#deep", "window.scrollTo(0,1000)", "window.scrollTo(0,0)", "window.scrollY"),
                ("#nested", "document.querySelector('#pane').scrollTop=500", "document.querySelector('#pane').scrollTop=0", "document.querySelector('#pane').scrollTop"),
            ]:
                target.evaluate(setup)
                bridge(panel, "record", {"enabled": True})
                target.locator(selector).click()
                bridge(panel, "record", {"enabled": False})
                events = bridge(panel, "events")["events"]
                recorded = next(event["step"] for event in events if event["step"]["action"] == "point" and event["step"]["query"] == selector)
                assert recorded["scroll_state"], recorded
                previous = int(target.evaluate(expected))
                assert previous > 0, recorded
                target.evaluate(reset)
                recorded["query"] = "#missing"  # force the coordinate path
                replayed = bridge(panel, "execute", {"step": recorded})
                assert replayed["ok"], replayed
                assert int(target.evaluate(expected)) == previous, (selector, recorded)
                assert target.locator(selector).get_attribute("data-count") == "2"
                target.evaluate("window.scrollTo(0,0);document.querySelector('#pane').scrollTop=0")
            editable = {"id": "edit", "name": "Editable", "startUrl": fixture_url,
                        "steps": [{"action": "wait", "value": "1000"}, {"action": "point", "x": 0.2, "y": 0.4}]}
            panel.evaluate("s => localStorage.setItem('katya_scenarios_v1',JSON.stringify([s,...JSON.parse(localStorage.getItem('katya_scenarios_v1'))]))", editable)
            panel.reload()
            panel.locator("#startScenario").select_option("scenario:edit")
            panel.locator("#chromeStepList li").first.click()
            editor = panel.locator("#chromeStepEditor")
            assert editor.locator("input[name=seconds]").is_visible()
            editor.locator("input[name=seconds]").fill("2.5")
            editor.locator("button[type=submit]").click()
            assert panel.evaluate("JSON.parse(localStorage.getItem('katya_scenarios_v1'))[0].steps[0].value") == "2500"
            panel.locator("#chromeStepList li").nth(1).click()
            editor.locator("button.step-editor-delete").click()
            assert len(panel.evaluate("JSON.parse(localStorage.getItem('katya_scenarios_v1'))[0].steps")) == 1
            panel.locator("#chromeScenarioMount .recorder-more summary").click()
            panel.once("dialog", lambda dialog: dialog.accept())
            panel.locator("#chromeScenarioMount .record-delete-scenario").click()
            assert all(s["id"] != "edit" for s in panel.evaluate("JSON.parse(localStorage.getItem('katya_scenarios_v1'))"))
            panel.reload()
            assert panel.locator("#chromeMacroPick option").count() >= 2
            assert panel.locator("#fxToggle").count() == 0
            assert panel.evaluate("document.documentElement.classList.contains('fx-on')")
            panel.evaluate("""() => render({system:{cpu_percent:3,memory_percent:20,chromium_processes:1},triggers:[],log:[],jobs:[{id:'fixture-job',status:'running',url:'http://example.test',scenario_steps:[{action:'wait',value:'1000'}],workers_list:[{id:'fixture-worker',state:'ready',watch_seconds:0,url:'http://example.test',last_action:'ready',scenario:{phase:'done',completed:1,current:0}}]}]})""")
            worker_card = panel.locator("#workersPanel .worker")
            assert worker_card.count() == 1 and "collapsed" in worker_card.get_attribute("class")
            worker_card.locator(".worker-tile").evaluate("button => button.click()")
            assert "collapsed" not in worker_card.get_attribute("class")
            assert worker_card.locator(".scenario-library-list .scenario-library-row").count() >= 1
            panel.screenshot(path=str(Path(tempfile.gettempdir()) / "katya-unified-panel.png"), full_page=True)
            bundle_names = ("background.js", "bridge.js", "content.js", "manifest.json", "popup.html", "popup.js")
            bundle = {name: (ROOT / "chrome-extension" / name).read_text(encoding="utf-8") for name in bundle_names}
            bundle_version = json.loads(bundle["manifest.json"])["version"]
            panel.route("**/api/extension-bundle", lambda route: route.fulfill(json={"ok": True, "version": bundle_version, "files": bundle}))
            panel.evaluate("""async () => {
              const root = await navigator.storage.getDirectory();
              const dir = await root.getDirectoryHandle('katya-updater-test', {create:true});
              const file = await dir.getFileHandle('manifest.json', {create:true});
              const writer = await file.createWritable();
              await writer.write(JSON.stringify({name:'Katya Browser Bridge',version:'0.4.0'})); await writer.close();
              window.showDirectoryPicker = async () => dir;
              window.__katyaTestDir = dir;
            }""")
            panel.evaluate("document.querySelector('.chrome-install').open = true; document.querySelector('#chromeSetup').hidden = false")
            panel.locator("#chromeUpdateExtension").click()
            panel.wait_for_function("version => document.querySelector('#chromeUpdateStatus').textContent.includes(version)", arg=bundle_version, timeout=10000)
            updated_version = panel.evaluate("""async () => JSON.parse(await (await (await window.__katyaTestDir.getFileHandle('manifest.json')).getFile()).text()).version""")
            assert updated_version == bundle_version, updated_version
            assert len(context.pages) >= 2
            print(json.dumps({"ok": True, "shared_scenario": True, "dom_first": True, "point_fallback": True, "resume_step": 2, "recording_persisted": True, "manual_action": True, "media_seek": True, "extension_update": True, "target_count": 4}))
        finally:
            context.close()
            server.shutdown()


if __name__ == "__main__":
    main()
