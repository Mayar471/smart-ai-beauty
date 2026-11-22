@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.11 or newer is required.
  pause
  exit /b 1
)
node launch.mjs
if errorlevel 1 pause
