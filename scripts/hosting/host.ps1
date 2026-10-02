param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'start', 'stop', 'status', 'backup', 'install-task', 'uninstall-task')]
  [string]$Action = 'status',
  [string]$RuntimeRoot = (Join-Path $env:USERPROFILE 'YilutekServices\DayTradeTycoon')
)

$ErrorActionPreference = 'Stop'
$taskName = 'DayTradeTycoonHost'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtimePath = [IO.Path]::GetFullPath($RuntimeRoot)
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$supervisorPath = Join-Path $PSScriptRoot 'supervisor.mjs'
. (Join-Path $PSScriptRoot 'task-start.ps1')

function Quote-TaskArgument([string]$Value) {
  if ($Value.Contains('"') -or $Value.EndsWith('\')) { throw 'Unsupported quote or trailing slash in task path.' }
  return '"' + $Value + '"'
}

if ($Action -eq 'init') {
  if ($runtimePath.StartsWith($workspaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $runtimePath -eq $workspaceRoot) {
    throw 'Runtime data and secrets must be outside the repository.'
  }
  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  # Protect the entire runtime, including future logs and backup copies of secrets.
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $runtimePath -AclObject $acl
  foreach ($directoryName in @('data', 'secrets', 'logs', 'backups')) {
    New-Item -ItemType Directory -Path (Join-Path $runtimePath $directoryName) -Force | Out-Null
  }
  $configPath = Join-Path $runtimePath 'hosting.json'
  if (-not (Test-Path -LiteralPath $configPath)) {
    $cloudflared = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    $configuration = [ordered]@{
      appEntry = (Join-Path $workspaceRoot '.output\server\index.mjs')
      port = 8790
      cloudflaredPath = $(if ($cloudflared) { $cloudflared.Source } else { '' })
      tunnelConfig = (Join-Path $runtimePath 'secrets\tunnel.yml')
      publicUrl = 'https://rich.yilutek.com'
      previousDns = @{ type = 'CNAME'; hostname = 'rich.yilutek.com'; target = '14c2250074a6dbcc.vercel-dns-013.com'; proxied = $false }
    }
    [IO.File]::WriteAllText($configPath, ($configuration | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  }
  Write-Output "Initialized protected runtime: $runtimePath"
  Write-Output 'Next: configure secrets/app.env and a dedicated secrets/tunnel.yml. No service or DNS was changed.'
  exit 0
}

if ($Action -eq 'install-task') {
  if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'hosting.json'))) { throw 'Run init first.' }
  $taskArguments = (Quote-TaskArgument $supervisorPath) + ' run --runtime ' + (Quote-TaskArgument $runtimePath)
  $taskAction = New-ScheduledTaskAction -Execute $nodePath -Argument $taskArguments -WorkingDirectory $workspaceRoot
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1))
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    $existingActions = @($existingTask.Actions)
    if ($existingActions.Count -ne 1 -or $existingActions[0].Execute -ne $nodePath -or $existingActions[0].Arguments -ne $taskArguments) {
      throw "Task name $taskName already belongs to another command. Refusing to replace it."
    }
  }
  Register-ScheduledTask -TaskName $taskName -Description 'DayTradeTycoon local web service and dedicated tunnel. Starts only after this user logs on.' -Action $taskAction -Principal $principal -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Output "Installed current-user logon task: $taskName"
  Write-Output 'This task does not start at boot before login. It has not been started by this command.'
  exit 0
}

if ($Action -eq 'start') {
  $taskArguments = (Quote-TaskArgument $supervisorPath) + ' run --runtime ' + (Quote-TaskArgument $runtimePath)
  $scheduledStart = Start-HostingScheduledTask -TaskName $taskName -NodePath $nodePath -TaskArguments $taskArguments -WorkspaceRoot $workspaceRoot -SupervisorPath $supervisorPath -RuntimePath $runtimePath
  if ($null -ne $scheduledStart) {
    $scheduledStart | ConvertTo-Json -Depth 5
    exit 0
  }
  # A runtime without an installed task (for example an isolated test fixture)
  # retains the direct hidden-background start implemented by the supervisor.
}

if ($Action -eq 'uninstall-task') {
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $existingTask) { Write-Output 'Task not installed.'; exit 0 }
  $expected = (Quote-TaskArgument $supervisorPath) + ' run --runtime ' + (Quote-TaskArgument $runtimePath)
  if (@($existingTask.Actions).Count -ne 1 -or $existingTask.Actions[0].Execute -ne $nodePath -or $existingTask.Actions[0].Arguments -ne $expected) {
    throw 'Task ownership does not match this workspace/runtime. Refusing to remove it.'
  }
  & $nodePath $supervisorPath stop --runtime $runtimePath
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output 'Removed the dedicated task. Runtime data, tunnel and DNS were retained.'
  exit 0
}

& $nodePath $supervisorPath $Action --runtime $runtimePath
exit $LASTEXITCODE
