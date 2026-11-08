<#
.SYNOPSIS
  Registers (or removes) the DayTradeTycoonWatchdog task: watchdog.ps1 every five minutes while this user is
  logged on, the same principal as the DayTradeTycoonHost task (no stored password).

.DESCRIPTION
  Two triggers carry the five-minute repetition: one from now, so the task runs without a new logon, and one at
  each logon of this user. Re-running this script replaces the task only when its action is this script's; a
  task of the same name that runs something else is refused, as host.ps1 -Action install-task does.
#>
param(
  [string]$RuntimeRoot = (Join-Path $env:USERPROFILE 'YilutekServices\DayTradeTycoon'),
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'DayTradeTycoonWatchdog'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scriptPath = Join-Path $PSScriptRoot 'watchdog.ps1'
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Quote-TaskArgument([string]$Value) {
  if ($Value.Contains('"') -or $Value.EndsWith('\')) { throw 'Unsupported quote or trailing slash in task path.' }
  return '"' + $Value + '"'
}

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote-TaskArgument $scriptPath) + ' -RuntimeRoot ' + (Quote-TaskArgument $runtimePath)
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing) {
  $actions = @($existing.Actions)
  if ($actions.Count -ne 1 -or
      -not [string]::Equals($actions[0].Execute, $powershellPath, [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals($actions[0].Arguments, $arguments, [StringComparison]::Ordinal)) {
    throw "Task name $taskName already belongs to another command. Refusing to replace it."
  }
}

if ($Uninstall) {
  if ($existing) { Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false; Write-Output "Removed $taskName." }
  else { Write-Output 'Task not installed.' }
  exit 0
}

if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing $scriptPath" }
if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'hosting.json'))) { throw 'Run host.ps1 init first.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $workspaceRoot
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$every = New-TimeSpan -Minutes 5
$fromNow = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval $every
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $identity
$atLogon.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval $every).Repetition
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew -Hidden
Register-ScheduledTask -TaskName $taskName -TaskPath '\' `
  -Description 'DayTradeTycoon watchdog: every five minutes, starts the host task again when its supervisor is gone on two checks in a row. Runs only while this user is logged on.' `
  -Action $action -Principal $principal -Trigger @($atLogon, $fromNow) -Settings $settings -Force | Out-Null
Write-Output "Installed current-user task: $taskName (every 5 minutes while this user is logged on)."
Write-Output "Log: $(Join-Path $runtimePath 'logs\watchdog.log')"
