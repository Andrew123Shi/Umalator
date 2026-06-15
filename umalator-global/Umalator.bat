@echo off
echo Starting Umalator...
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install it from https://nodejs.org/ ^(LTS recommended^), then run this again.
  echo.
  pause
  exit /b 1
)

start http://localhost:8000
node build.mjs --serve