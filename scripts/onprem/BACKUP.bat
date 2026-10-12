@echo off
chcp 65001 >nul
cd /d "%~dp0"
node launcher.mjs backup
set "classroom_exit=%errorlevel%"
pause
exit /b %classroom_exit%
