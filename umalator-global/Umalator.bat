@echo off
echo Starting Umalator...
cd /d "%~dp0"
start http://localhost:8000
node build.mjs --serve