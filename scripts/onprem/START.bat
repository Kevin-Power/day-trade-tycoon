@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 請先安裝 Node.js 24：https://nodejs.org
  pause
  exit /b 1
)
node launcher.mjs start
set "classroom_exit=%errorlevel%"
pause
exit /b %classroom_exit%
