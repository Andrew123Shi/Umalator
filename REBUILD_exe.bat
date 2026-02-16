@echo off
setlocal

echo ==========================================
echo Rebuilding Umalator release package...
echo ==========================================
echo.

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Install Node.js first.
  echo.
  pause
  exit /b 1
)

rem Ensure no stale packaged app process is locking output files.
taskkill /IM Umalator.exe /F >nul 2>nul

echo Running: npm run electron:pack
echo.
call npm run electron:pack

if errorlevel 1 (
  echo.
  echo Build FAILED.
  echo Check output above for details.
  echo.
  pause
  exit /b 1
)

set "ZIP_NAME=Umalator-Release.zip"
set "SOURCE_DIR=release-package\win-unpacked"

if not exist "%SOURCE_DIR%" (
  echo.
  echo ERROR: Build output folder not found: %SOURCE_DIR%
  echo.
  pause
  exit /b 1
)

echo Creating shareable zip: %ZIP_NAME%
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $src='%SOURCE_DIR%'; $dst='%ZIP_NAME%'; if (Test-Path $dst) { Remove-Item -Force $dst }; $ok=$false; for ($i=0; $i -lt 8 -and -not $ok; $i++) { try { Compress-Archive -Path $src -DestinationPath $dst -CompressionLevel Optimal -ErrorAction Stop; $ok=$true } catch { if ($i -eq 7) { throw }; Start-Sleep -Milliseconds 800 } }"

if errorlevel 1 (
  echo.
  echo Zip creation FAILED.
  echo.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo Output folder:
echo %~dp0release-package\win-unpacked
echo Shareable zip:
echo %~dp0%ZIP_NAME%
echo.
pause
exit /b 0
