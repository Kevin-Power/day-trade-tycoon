param([int]$Port = 18765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid port.' }
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app'))
$rootPrefix = $appRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'index.html'))) { throw 'Missing app/index.html. Extract the complete ZIP first.' }
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.svg'='image/svg+xml'; '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.ico'='image/x-icon'; '.woff2'='font/woff2'; '.pdf'='application/pdf'; '.txt'='text/plain; charset=utf-8' }
# TcpListener is loopback-only and needs no HttpListener URLACL/admin grant.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()
$prefix = 'http://127.0.0.1:' + $Port + '/'
if (-not $NoBrowser) { Start-Process $prefix }
Write-Host ('Offline classroom: ' + $prefix + ' Close this window to stop.')
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 10000
    $stream = $client.GetStream()
    try {
      $header = [Collections.Generic.List[byte]]::new()
      while ($header.Count -lt 16384) {
        $next = $stream.ReadByte()
        if ($next -lt 0) { break }
        $header.Add([byte]$next)
        $n = $header.Count
        if ($n -ge 4 -and $header[$n-4] -eq 13 -and $header[$n-3] -eq 10 -and $header[$n-2] -eq 13 -and $header[$n-1] -eq 10) { break }
      }
      $requestLine = ([Text.Encoding]::ASCII.GetString($header.ToArray()) -split "`r`n")[0]
      $parts = $requestLine -split ' '
      $status = 200; $reason = 'OK'; $type = 'text/plain; charset=utf-8'; $filePath = $null
      if ($parts.Count -ne 3 -or $parts[0] -notin @('GET', 'HEAD') -or -not $parts[1].StartsWith('/')) { $status=400; $reason='Bad Request' }
      else {
        $requestPath = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
        if ($requestPath -eq '/') { $requestPath = '/index.html' }
        if ($requestPath.Contains('\') -or $requestPath.Contains(':') -or $requestPath.Contains([char]0)) { $status=403; $reason='Forbidden' }
        else {
          $relativePath = $requestPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
          $candidate = [IO.Path]::GetFullPath((Join-Path $appRoot $relativePath))
          if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { $status=403; $reason='Forbidden' }
          elseif (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { $status=404; $reason='Not Found' }
          else { $filePath=$candidate; $ext=[IO.Path]::GetExtension($candidate).ToLowerInvariant(); if ($mime.ContainsKey($ext)) { $type=$mime[$ext] } else { $type='application/octet-stream' } }
        }
      }
      if ($filePath) { $length=(Get-Item -LiteralPath $filePath).Length } else { $body=[Text.Encoding]::UTF8.GetBytes($reason); $length=$body.Length }
      $responseHeader = 'HTTP/1.1 ' + $status + ' ' + $reason + "`r`nContent-Type: " + $type + "`r`nContent-Length: " + $length + "`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n`r`n"
      $responseBytes = [Text.Encoding]::ASCII.GetBytes($responseHeader)
      $stream.Write($responseBytes, 0, $responseBytes.Length)
      if ($parts[0] -ne 'HEAD') {
        if ($filePath) { $file=[IO.File]::OpenRead($filePath); try { $file.CopyTo($stream) } finally { $file.Dispose() } }
        else { $stream.Write($body, 0, $body.Length) }
      }
    } catch { Write-Warning 'A request was closed or invalid.' }
    finally { $stream.Dispose(); $client.Close() }
  }
} finally { $listener.Stop() }
