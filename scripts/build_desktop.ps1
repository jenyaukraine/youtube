param([switch]$SkipInstaller)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repo '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run Start-Katya.bat to install Python dependencies first.' }

Push-Location (Join-Path $repo 'web')
try { pnpm build; if ($LASTEXITCODE -ne 0) { throw 'React build failed' } }
finally { Pop-Location }

$sidecar = Join-Path $repo 'build\sidecar'
$work = Join-Path $repo 'build\pyinstaller-work'
$spec = Join-Path $repo 'build'
New-Item -ItemType Directory -Force -Path $sidecar, $work, $spec | Out-Null
& $python -m PyInstaller --noconfirm --clean --onefile --name katya-server `
  --distpath $sidecar --workpath $work --specpath $spec `
  --collect-all playwright --collect-all uvicorn `
  --add-data "$(Join-Path $repo 'static');static" `
  --add-data "$(Join-Path $repo 'chrome-extension');chrome-extension" `
  (Join-Path $repo 'app.py')
if ($LASTEXITCODE -ne 0) { throw 'Python sidecar build failed' }

$triple = (& rustc --print host-tuple).Trim()
$binaries = Join-Path $repo 'web\src-tauri\binaries'
New-Item -ItemType Directory -Force -Path $binaries | Out-Null
Copy-Item -LiteralPath (Join-Path $sidecar 'katya-server.exe') -Destination (Join-Path $binaries "katya-server-$triple.exe") -Force

if (-not $SkipInstaller) {
  Push-Location (Join-Path $repo 'web')
  try { pnpm exec tauri build; if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' } }
  finally { Pop-Location }
}
