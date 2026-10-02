#!/bin/bash
cd "$(dirname "$0")/app" || exit 1
PORT=18765
echo "當沖大富翁 地端教室：http://127.0.0.1:$PORT/；關閉本視窗即停止。"
(sleep 1; open "http://127.0.0.1:$PORT/" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT/" 2>/dev/null) &
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1 && python -c "import sys; assert sys.version_info.major == 3" >/dev/null 2>&1; then
  python -m http.server "$PORT" --bind 127.0.0.1
else
  echo "Mac / Linux 需要 Python 3；Windows 請使用 START.bat。"
  exit 1
fi
