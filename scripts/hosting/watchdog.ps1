<#
.SYNOPSIS
  Brings the DayTradeTycoon host back when its supervisor is gone (2026-11-08, after the 11/06 outage: the host
  task's processes were killed at 16:18 and nobody noticed until 23:38).

.DESCRIPTION
  Asks supervisor.mjs for its status and acts on one case only: no live supervisor on two checks in a row
  (five minutes apart under the scheduled task) starts the dedicated host task through host.ps1 -Action start.
  Everything else is left alone and logged:
    - the runtime owned by maintenance (a release switch or a backup) is skipped;
    - a running but unhealthy supervisor restarts the application itself;
    - a single missed check only counts, so a deliberate stop of a few seconds never races a start.
  Maintenance longer than five minutes: disable the DayTradeTycoonWatchdog task first, enable it after.

  One line per check goes to <runtime>\logs\watchdog.log (rotated at 2 MB), the public health code beside it.
  Nothing here reads the runtime's secrets or data.

.PARAMETER StatusJson
  Tests only: read this file as the supervisor status instead of asking it, and never start anything.
#>
param(
  [string]$RuntimeRoot = (Join-Path $env:USERPROFILE 'YilutekServices\DayTradeTycoon'),
  [string]$StatusJson = '',
  [switch]$DryRun,
  [string]$LogPath = '',
  [string]$StateFile = '',
  # '' reads hosting.json's publicUrl; 'none' skips the public check.
  [string]$PublicUrl = '',
  [ValidateRange(1, 10)][int]$RequiredMisses = 2
)

$ErrorActionPreference = 'Stop'
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$hostScript = Join-Path $PSScriptRoot 'host.ps1'
$supervisorPath = Join-Path $PSScriptRoot 'supervisor.mjs'
if (-not $LogPath) { $LogPath = Join-Path $runtimePath 'logs\watchdog.log' }
if (-not $StateFile) { $StateFile = Join-Path $runtimePath 'logs\watchdog-state.json' }
$testing = [bool]$StatusJson -or [bool]$DryRun

function Write-WatchdogLog([string]$Message) {
  $dir = Split-Path -Parent $LogPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -ge 2MB) {
    $previous = $LogPath + '.1'
    if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
    Move-Item -LiteralPath $LogPath -Destination $previous
  }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  Add-Content -LiteralPath $LogPath -Value ($stamp + ' ' + $Message) -Encoding utf8
  Write-Output $Message
}

function Read-SupervisorStatus {
  if ($StatusJson) { return (Get-Content -LiteralPath $StatusJson -Raw | ConvertFrom-Json) }
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $output = & $nodePath $supervisorPath status --runtime $runtimePath
  if ($LASTEXITCODE -ne 0) { throw "supervisor status exited $LASTEXITCODE" }
  return (($output -join "`n") | ConvertFrom-Json)
}

function Read-WatchdogState {
  if (Test-Path -LiteralPath $StateFile) {
    try { return (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json) } catch { }
  }
  return [pscustomobject]@{ misses = 0; lastStartAt = $null }
}

function Save-WatchdogState($State) {
  $dir = Split-Path -Parent $StateFile
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $State | ConvertTo-Json -Compress | Set-Content -LiteralPath $StateFile -Encoding utf8
}

function Test-PublicHealth {
  if ($PublicUrl -eq 'none') { return 'skipped' }
  $url = $PublicUrl
  if (-not $url) {
    $configPath = Join-Path $runtimePath 'hosting.json'
    if (-not (Test-Path -LiteralPath $configPath)) { return 'no-config' }
    try { $url = ((Get-Content -LiteralPath $configPath -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json).publicUrl } catch { return 'no-config' }
  }
  if (-not $url) { return 'no-url' }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $response = Invoke-WebRequest -Uri ($url.TrimEnd('/') + '/api/health') -UseBasicParsing -TimeoutSec 15
    return [string]$response.StatusCode
  } catch { return 'fail' }
}

$state = Read-WatchdogState
try { $status = Read-SupervisorStatus } catch { Write-WatchdogLog ('status-error ' + $_.Exception.Message); exit 1 }
$public = Test-PublicHealth
$owner = $status.runtimeOwner

if ($owner -and $owner.kind -ne 'service') {
  $state.misses = 0
  Save-WatchdogState $state
  Write-WatchdogLog ('maintenance owner=' + $owner.kind + ' public=' + $public + ' (left alone)')
  exit 0
}
if ($status.supervisorRunning) {
  $state.misses = 0
  Save-WatchdogState $state
  if ($status.healthy) { Write-WatchdogLog ('ok supervisor=yes healthy=yes public=' + $public) }
  else { Write-WatchdogLog ('unhealthy supervisor=yes healthy=no public=' + $public + ' (the supervisor restarts the app itself)') }
  exit 0
}

# No live supervisor.
$state.misses = [int]$state.misses + 1
if ($state.misses -lt $RequiredMisses) {
  Save-WatchdogState $state
  Write-WatchdogLog ('down supervisor=no miss=' + $state.misses + '/' + $RequiredMisses + ' public=' + $public + ' (waiting for the next check)')
  exit 0
}
$state.misses = 0
$state.lastStartAt = (Get-Date).ToUniversalTime().ToString('o')
Save-WatchdogState $state
if ($testing) {
  Write-WatchdogLog ('down supervisor=no public=' + $public + ' -> would start the host task (test, nothing started)')
  exit 0
}
Write-WatchdogLog ('down supervisor=no public=' + $public + ' -> starting the host task')
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
  $output = & $hostScript -Action start -RuntimeRoot $runtimePath
  $summary = (($output | Out-String) -replace '\s+', ' ').Trim()
  if ($summary.Length -gt 240) { $summary = $summary.Substring(0, 240) + '...' }
  Write-WatchdogLog ('started seconds=' + [int]$watch.Elapsed.TotalSeconds + ' ' + $summary)
  exit 0
} catch {
  Write-WatchdogLog ('start-failed seconds=' + [int]$watch.Elapsed.TotalSeconds + ' ' + $_.Exception.Message)
  exit 1
}
