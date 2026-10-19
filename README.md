# Katya ViewBot

FastAPI and Playwright application with a web dashboard for browser sessions.

## Run

```bash
python3 -m pip install -r requirements.txt
python3 -m playwright install chromium
python3 app.py
```

The server listens on port 8010. The production systemd unit is in `deploy/katya-viewbot.service`.
