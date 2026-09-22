# One-shot local setup for Windows PowerShell.   Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Python virtualenv + dependencies"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
.\.venv\Scripts\python.exe -m pip install -r scraper\requirements-dev.txt

Write-Host "==> Backend dependencies"
Push-Location backend
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Pop-Location

Write-Host "==> Frontend dependencies"
Push-Location frontend
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
Pop-Location

Write-Host ""
Write-Host "Setup finished. Next:"
Write-Host "  1) .\.venv\Scripts\python.exe -m scraper.run     # first data load (optional - the UI can trigger it too)"
Write-Host "  2) cd backend;  npm start                        # API on http://localhost:4000"
Write-Host "  3) cd frontend; npm run dev                      # UI  on http://localhost:3000"
