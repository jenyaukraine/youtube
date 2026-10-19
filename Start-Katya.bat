@echo off
rem Katya Browser Lab on Windows: dashboard + HTTP API on http://127.0.0.1:8010
rem Set KATYA_HEADLESS=0 to see the Chromium windows on your desktop.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [Katya] Creating virtual environment...
  python -m venv .venv || goto :fail
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || goto :fail
  ".venv\Scripts\python.exe" -m playwright install chromium || goto :fail
)
set KATYA_BIND_HOST=127.0.0.1
if "%KATYA_HEADLESS%"=="" set KATYA_HEADLESS=0
if "%KATYA_MAX_TABS%"=="" set KATYA_MAX_TABS=32
echo [Katya] Dashboard: http://127.0.0.1:8010   headless=%KATYA_HEADLESS%   max tabs=%KATYA_MAX_TABS%
".venv\Scripts\python.exe" app.py
pause
exit /b 0
:fail
echo [Katya] Setup failed. Install Python 3.11+ from python.org and run again.
pause
exit /b 1
