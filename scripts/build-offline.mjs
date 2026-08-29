#!/usr/bin/env node
/**
 * Pack a Windows/Mac classroom zip: unzip, double-click START.bat, no install.
 * Does not replace `npm run build` (Vercel).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const dist = join(root, "dist-offline");
const stage = join(root, "dist-offline-pack", "DayTradeTycoon");
const zipOut = join(root, "public", "daytrade-tycoon-offline.zip");
const envWrapper = join(root, "scripts", "with-app-env.mjs");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("node", [envWrapper, "vite", "build", "--config", "vite.offline.config.ts"]);

if (!existsSync(join(dist, "index.html"))) {
  console.error("[offline] missing dist-offline/index.html");
  process.exit(1);
}

rmSync(join(root, "dist-offline-pack"), { recursive: true, force: true });
mkdirSync(join(stage, "app"), { recursive: true });
cpSync(dist, join(stage, "app"), { recursive: true });
cpSync(join(root, "public", "favicon.svg"), join(stage, "app", "favicon.svg"));

writeFileSync(
  join(stage, "START.bat"),
  [
    "@echo off",
    "cd /d \"%~dp0\"",
    "title 當沖大富翁 地端教室",
    "echo.",
    "echo  當沖大富翁  地端教室",
    "echo  關閉本視窗即停止。",
    "echo.",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0serve.ps1\"",
    "if errorlevel 1 (",
    "  echo PowerShell 無法啟動，改試 Python...",
    "  cd app",
    "  start \"\" http://127.0.0.1:18765/",
    "  py -3 -m http.server 18765 2>nul",
    "  if errorlevel 1 python -m http.server 18765",
    ")",
    "",
  ].join("\r\n"),
  "utf8",
);

writeFileSync(
  join(stage, "serve.ps1"),
  `# Classroom static server — localhost only, no install.
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "app"
$port = 18765
$prefix = "http://127.0.0.1:$port/"
$mime = @{
  ".html"  = "text/html; charset=utf-8"
  ".js"    = "text/javascript; charset=utf-8"
  ".css"   = "text/css; charset=utf-8"
  ".svg"   = "image/svg+xml"
  ".json"  = "application/json"
  ".png"   = "image/png"
  ".jpg"   = "image/jpeg"
  ".jpeg"  = "image/jpeg"
  ".ico"   = "image/x-icon"
  ".woff2" = "font/woff2"
  ".map"   = "application/json"
  ".txt"   = "text/plain; charset=utf-8"
}
if (-not (Test-Path (Join-Path $root "index.html"))) {
  Write-Host "找不到 app\\index.html，請勿只解壓部分檔案。"
  pause
  exit 1
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host $_.Exception.Message
  exit 1
}
Start-Process $prefix
Write-Host "當沖大富翁教室已啟動。關閉本視窗即停止。"
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $reqPath = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
  if ($reqPath -eq "/") { $reqPath = "/index.html" }
  $rel = $reqPath.Replace("/", [IO.Path]::DirectorySeparatorChar).TrimStart("\\")
  $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
  $rootFull = [IO.Path]::GetFullPath($root)
  $res = $ctx.Response
  if (-not $full.StartsWith($rootFull)) {
    $res.StatusCode = 403
    $res.Close()
    continue
  }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    $res.StatusCode = 404
    $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
    continue
  }
  $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
  if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
  else { $res.ContentType = "application/octet-stream" }
  $bytes = [IO.File]::ReadAllBytes($full)
  $res.ContentLength64 = $bytes.Length
  $res.Headers.Add("Cache-Control", "no-cache")
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}
`,
  "utf8",
);

writeFileSync(
  join(stage, "START.sh"),
  `#!/bin/bash
cd "$(dirname "$0")/app"
PORT=18765
echo "當沖大富翁 地端教室"
echo "關閉本視窗即停止。"
(sleep 1; xdg-open "http://127.0.0.1:$PORT/" 2>/dev/null || open "http://127.0.0.1:$PORT/" 2>/dev/null) &
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT"
else
  echo "需要 Python 3 才能啟動。"
  read -r _
fi
`,
  "utf8",
);

writeFileSync(
  join(stage, "START.command"),
  `#!/bin/bash
cd "$(dirname "$0")/app"
PORT=18765
(sleep 1; open "http://127.0.0.1:$PORT/" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT/" 2>/dev/null) &
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT"
else
  echo "需要 Python 3 才能啟動。"
  read -r _
fi
`,
  "utf8",
);

const readme =
  "當沖大富翁　地端教室\r\n" +
  "====================\r\n\r\n" +
  "這份與線上教室同一套：證交所每 5 秒加權指數、個股公開日成交、自選／五檔／漲跌停、當沖費稅。\r\n" +
  "不需要安裝、不需要帳號、不需要網路（啟動後即可離線上課）。\r\n\r\n" +
  "Windows\r\n" +
  "  1. 解壓縮整包資料夾\r\n" +
  "  2. 雙擊 START.bat\r\n" +
  "  3. 瀏覽器會自己打開。下課關閉黑色視窗即可。\r\n\r\n" +
  "Mac\r\n" +
  "  雙擊 START.command（若被擋住：右鍵 → 打開）\r\n\r\n" +
  "Linux\r\n" +
  "  終端機執行 ./START.sh\r\n\r\n" +
  "請勿只打開 app 裡的 index.html，Chrome 會擋模組。一定要走 START。\r\n\r\n" +
  "學員戰績存在該電腦的瀏覽器（localStorage），換電腦不會跟著走。\r\n" +
  "同一間教室建議固定座位或同一台示範機。\r\n";

writeFileSync(join(stage, "README.txt"), "\uFEFF" + readme, "utf8");

mkdirSync(join(root, "public"), { recursive: true });
const zipScript = `
import zipfile, os, stat
src = r${JSON.stringify(join(root, "dist-offline-pack"))}
out = r${JSON.stringify(zipOut)}
os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, files in os.walk(src):
        for name in files:
            full = os.path.join(dirpath, name)
            arc = os.path.relpath(full, src)
            info = zipfile.ZipInfo.from_file(full, arc)
            if name in ("START.command", "START.bat", "START.sh"):
                info.external_attr = (0o755 << 16)
            z.write(full, arc)
print("wrote", out, os.path.getsize(out))
`;
const py = spawnSync("python3", ["-c", zipScript], { cwd: root, encoding: "utf8" });
if (py.status !== 0) {
  console.error(py.stdout, py.stderr);
  process.exit(py.status ?? 1);
}
console.log(py.stdout.trim());
console.log("[offline] classroom zip ready");
