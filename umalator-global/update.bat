@echo off
setlocal

cd /d "%~dp0"

if "%~1" == "" (
  set "mastermdb=%APPDATA%\..\LocalLow\Cygames\Umamusume\master\master.mdb"
) else (
  set "mastermdb=%~1"
)

echo ==========================================
echo Updating Umalator game data...
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: node was not found. Install Node.js first.
  echo.
  pause
  exit /b 1
)

node ..\scripts\update-data.mjs "%mastermdb%"
if errorlevel 1 (
  echo.
  echo Data update FAILED.
  echo.
  pause
  exit /b 1
)

echo Building umalator-global bundle...
node build.mjs
if errorlevel 1 (
  echo.
  echo Build FAILED.
  echo.
  pause
  exit /b 1
)

echo.
echo Done. Review the update summary above.
echo.
pause
exit /b 0
