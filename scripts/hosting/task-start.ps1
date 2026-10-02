function Read-HostingSupervisorStatus {
  param([string]$NodePath, [string]$SupervisorPath, [string]$RuntimePath)
  $output = & $NodePath $SupervisorPath status --runtime $RuntimePath
  if ($LASTEXITCODE -ne 0) { throw 'Supervisor status probe failed; refusing an unverified start.' }
  return (($output -join "`n") | ConvertFrom-Json)
}

function Read-HostingOwnedTask {
  param(
    [string]$TaskName,
    [string]$NodePath,
    [string]$TaskArguments,
    [string]$WorkspaceRoot
  )

  try {
    $tasks = @(Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop)
  } catch {
    if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound -and
        $_.FullyQualifiedErrorId.StartsWith('CmdletizationQuery_NotFound', [StringComparison]::Ordinal)) { return $null }
    throw
  }
  if ($tasks.Count -eq 0) { return $null }
  if ($tasks.Count -ne 1) { throw 'Ambiguous dedicated task ownership; refusing to start.' }
  $task = $tasks[0]
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or
      -not [string]::Equals($actions[0].Execute, $NodePath, [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals($actions[0].Arguments, $TaskArguments, [StringComparison]::Ordinal) -or
      -not [string]::Equals($actions[0].WorkingDirectory, $WorkspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Dedicated task ownership does not match this workspace/runtime. Refusing to start or fall back.'
  }
  if ([string]$task.State -eq 'Disabled') { throw 'Dedicated task is disabled. Enable it explicitly before starting.' }
  return $task
}

function Start-HostingScheduledTask {
  param(
    [string]$TaskName,
    [string]$NodePath,
    [string]$TaskArguments,
    [string]$WorkspaceRoot,
    [string]$SupervisorPath,
    [string]$RuntimePath,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 95
  )

  $taskQuery = @{ TaskName = $TaskName; NodePath = $NodePath; TaskArguments = $TaskArguments; WorkspaceRoot = $WorkspaceRoot }
  if ($null -eq (Read-HostingOwnedTask @taskQuery)) { return $null }

  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  $status = Read-HostingSupervisorStatus $NodePath $SupervisorPath $RuntimePath
  $alreadyRunning = [bool]$status.supervisorRunning
  $startRequested = $false
  while ($true) {
    if ($status.runtimeOwner -and $status.runtimeOwner.kind -ne 'service') {
      throw 'Runtime maintenance is active; refusing to start the scheduled task.'
    }
    if ($status.supervisorRunning -and -not $startRequested) { $alreadyRunning = $true }
    if ($status.supervisorRunning -and $status.healthy -and $status.state.status -eq 'running' -and
        $status.runtimeOwner.kind -eq 'service' -and $status.runtimeOwner.pid -eq $status.state.supervisorPid) {
      return [pscustomobject]@{ alreadyRunning = $alreadyRunning; launchMode = $(if ($alreadyRunning) { 'existing-supervisor' } else { 'scheduled-task' }); healthy = $true; state = $status.state }
    }
    if ($elapsed.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
      throw 'Scheduled startup readiness timed out. No direct process was started; inspect task history and runtime logs.'
    }
    if (-not $startRequested -and -not $status.runtimeOwner -and -not $status.supervisorRunning) {
      # The pipe can close before Task Scheduler finishes the previous action.
      # IgnoreNew would discard a start while that action is still Running.
      $task = Read-HostingOwnedTask @taskQuery
      if ($null -eq $task) { throw 'Dedicated task disappeared during startup; refusing direct fallback.' }
      switch ([string]$task.State) {
        'Ready' {
          Start-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
          $startRequested = $true
          $alreadyRunning = $false
        }
        'Running' { }
        'Queued' { }
        default { throw 'Dedicated task is not ready to start; inspect its scheduler state.' }
      }
    }
    Start-Sleep -Milliseconds 500
    $status = Read-HostingSupervisorStatus $NodePath $SupervisorPath $RuntimePath
  }
}
