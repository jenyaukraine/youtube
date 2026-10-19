@echo off
rem Katya from the command line, no dashboard needed:
rem   Katya-Run.bat run examples\search-wikipedia.json --var query=Playwright --shots data\cli-shots
rem   Katya-Run.bat validate my-scenario.json
rem   Katya-Run.bat export-macros backup
rem   Katya-Run.bat import backup\my-macro.json
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [Katya] Run Start-Katya.bat first to install dependencies. 1>&2
  exit /b 1
)
".venv\Scripts\python.exe" -m katya.cli %*
exit /b %errorlevel%
