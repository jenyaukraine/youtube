@echo off
rem MCP server (stdio) for AI agents. Register this file as the MCP command in
rem Claude Code / Codex / Cursor; the Katya app must be running (Start-Katya.bat).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [Katya] Run Start-Katya.bat first to install dependencies. 1>&2
  exit /b 1
)
if "%KATYA_URL%"=="" set KATYA_URL=http://127.0.0.1:8010
".venv\Scripts\python.exe" -m katya.mcp_server
