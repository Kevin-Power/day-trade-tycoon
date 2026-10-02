@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 當沖大富翁 地端教室
echo 當沖大富翁 地端教室 - 關閉本視窗即停止。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 (
  echo 啟動失敗。若 18765 已使用，請關閉先前的教室視窗。
  pause
)
