#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '請先安裝 Node.js 24：https://nodejs.org'
  exit 1
fi
exec node launcher.mjs start
