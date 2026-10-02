import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const helper = fileURLToPath(new URL('./task-start.ps1', import.meta.url));
const windowsOnly = { skip: process.platform !== 'win32', timeout: 15000 };

async function scenario(setup) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${helper.replaceAll("'", "''")}'
$script:starts = 0
$script:probes = 0
$script:taskReads = 0
$script:startStates = @()
$script:taskStates = $null
$script:changeOwnerOnRead = 0
$script:missing = $false
$script:queryDenied = $false
$script:startDenied = $false
$parameters = @{
  TaskName = 'DedicatedFixture'; NodePath = 'C:\fixture\node.exe'; TaskArguments = 'fixture run --runtime isolated'
  WorkspaceRoot = 'C:\fixture'; SupervisorPath = 'C:\fixture\supervisor.mjs'; RuntimePath = 'C:\isolated'; TimeoutSeconds = 1
}
$script:task = [pscustomobject]@{ State = 'Ready'; Actions = @([pscustomobject]@{ Execute = $parameters.NodePath; Arguments = $parameters.TaskArguments; WorkingDirectory = $parameters.WorkspaceRoot }) }
$absent = [pscustomobject]@{ supervisorRunning = $false; runtimeOwner = $null; healthy = $false; state = $null }
$healthy = [pscustomobject]@{ supervisorRunning = $true; runtimeOwner = [pscustomobject]@{ kind = 'service'; pid = 123 }; healthy = $true; state = [pscustomobject]@{ status = 'running'; supervisorPid = 123 } }
$unhealthy = [pscustomobject]@{ supervisorRunning = $true; runtimeOwner = [pscustomobject]@{ kind = 'service'; pid = 123 }; healthy = $false; state = [pscustomobject]@{ status = 'unhealthy'; supervisorPid = 123 } }
$maintenance = [pscustomobject]@{ supervisorRunning = $false; runtimeOwner = [pscustomobject]@{ kind = 'backup'; pid = 456 }; healthy = $false; state = $null }
$script:statuses = @($absent, $healthy)
function Get-ScheduledTask {
  param($TaskName, $TaskPath, $ErrorAction)
  if ($TaskName -ne 'DedicatedFixture' -or $TaskPath -ne '\') { throw 'Unexpected task query' }
  if ($script:queryDenied) { throw [UnauthorizedAccessException]::new('Fixture access denied') }
  if ($script:missing) { throw [Management.Automation.ErrorRecord]::new([Exception]::new('Fixture missing'), 'CmdletizationQuery_NotFound', [Management.Automation.ErrorCategory]::ObjectNotFound, $TaskName) }
  if ($null -ne $script:taskStates) { $script:task.State = $script:taskStates[[Math]::Min($script:taskReads, $script:taskStates.Count - 1)] }
  $script:taskReads++
  if ($script:changeOwnerOnRead -gt 0 -and $script:taskReads -ge $script:changeOwnerOnRead) { $script:task.Actions[0].Arguments = 'changed task owner' }
  return $script:task
}
function Start-ScheduledTask {
  param($TaskName, $TaskPath, $ErrorAction)
  if ($TaskName -ne 'DedicatedFixture' -or $TaskPath -ne '\') { throw 'Unexpected task start' }
  $script:starts++
  $script:startStates += $script:task.State
  if ($script:startDenied) { throw [UnauthorizedAccessException]::new('Fixture start denied') }
}
function Read-HostingSupervisorStatus {
  param($NodePath, $SupervisorPath, $RuntimePath)
  $index = [Math]::Min($script:probes, $script:statuses.Count - 1)
  $script:probes++
  return $script:statuses[$index]
}
${setup}
$result = $null
$failure = $null
try { $result = Start-HostingScheduledTask @parameters } catch { $failure = $_.Exception.Message }
[pscustomobject]@{ result = $result; starts = $script:starts; probes = $script:probes; taskReads = $script:taskReads; startStates = $script:startStates; failure = $failure } | ConvertTo-Json -Depth 8 -Compress
`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 12000 });
  return JSON.parse(stdout.trim());
}

test('matching task starts through the scheduler and waits for owned health readiness', windowsOnly, async () => {
  const actual = await scenario('');
  assert.equal(actual.failure, null);
  assert.equal(actual.starts, 1);
  assert.equal(actual.probes, 2);
  assert.equal(actual.result.launchMode, 'scheduled-task');
  assert.equal(actual.result.healthy, true);
});

test('existing healthy or recovering supervisor is never restarted', windowsOnly, async () => {
  for (const statuses of ['@($healthy)', '@($unhealthy, $healthy)']) {
    const actual = await scenario(`$script:statuses = ${statuses}`);
    assert.equal(actual.failure, null);
    assert.equal(actual.starts, 0);
    assert.equal(actual.result.alreadyRunning, true);
    assert.equal(actual.result.launchMode, 'existing-supervisor');
  }
  const replaced = await scenario('$parameters.TimeoutSeconds = 3; $script:statuses = @($unhealthy, $absent, $healthy)');
  assert.equal(replaced.failure, null);
  assert.equal(replaced.starts, 1);
  assert.equal(replaced.result.alreadyRunning, false);
  assert.equal(replaced.result.launchMode, 'scheduled-task');
});

test('missing task delegates to the existing direct-start path without any scheduled action', windowsOnly, async () => {
  const actual = await scenario('$script:missing = $true');
  assert.equal(actual.failure, null);
  assert.equal(actual.result, null);
  assert.equal(actual.starts, 0);
  assert.equal(actual.probes, 0);
});

test('foreign task executable, arguments, directory or multiple actions refuse all startup', { ...windowsOnly, timeout: 25000 }, async () => {
  for (const mutation of [
    '$script:task.Actions[0].Execute = "foreign.exe"',
    '$script:task.Actions[0].Arguments = "other runtime"',
    '$script:task.Actions[0].WorkingDirectory = "C:\\foreign"',
    '$script:task.Actions = @($script:task.Actions[0], $script:task.Actions[0])',
  ]) {
    const actual = await scenario(mutation);
    assert.match(actual.failure, /ownership does not match/);
    assert.equal(actual.starts, 0);
    assert.equal(actual.probes, 0);
  }
});

test('disabled tasks and task query errors never silently fall back to direct startup', windowsOnly, async () => {
  for (const setup of ['$script:task.State = "Disabled"', '$script:queryDenied = $true']) {
    const actual = await scenario(setup);
    assert.ok(actual.failure);
    assert.equal(actual.starts, 0);
    assert.equal(actual.probes, 0);
  }
});

test('maintenance ownership is rejected before scheduling any start', windowsOnly, async () => {
  const actual = await scenario('$script:statuses = @($maintenance)');
  assert.match(actual.failure, /maintenance is active/);
  assert.equal(actual.starts, 0);
});

test('scheduler failure and unhealthy startup fail closed without direct-process fallback', windowsOnly, async () => {
  const denied = await scenario('$script:startDenied = $true');
  assert.match(denied.failure, /start denied/);
  assert.equal(denied.starts, 1);
  const unhealthy = await scenario('$script:statuses = @($absent)');
  assert.match(unhealthy.failure, /readiness timed out/);
  assert.equal(unhealthy.starts, 1);
});

test('stale running state cannot satisfy readiness for a different runtime owner', windowsOnly, async () => {
  const actual = await scenario('$healthy.state.supervisorPid = 999; $script:statuses = @($healthy)');
  assert.match(actual.failure, /readiness timed out/);
  assert.equal(actual.starts, 0);
});

test('a finishing Running task must become Ready before the next start request', windowsOnly, async () => {
  const actual = await scenario('$parameters.TimeoutSeconds = 3; $script:taskStates = @("Running", "Running", "Ready"); $script:statuses = @($absent, $absent, $healthy)');
  assert.equal(actual.failure, null);
  assert.equal(actual.starts, 1);
  assert.deepEqual(actual.startStates, ['Ready']);
  assert.equal(actual.taskReads, 3);
  assert.equal(actual.result.launchMode, 'scheduled-task');
});

test('owner appearing while a task is Running or Queued is reused without another start', windowsOnly, async () => {
  for (const state of ['Running', 'Queued']) {
    const actual = await scenario(`$script:task.State = "${state}"; $script:statuses = @($absent, $healthy)`);
    assert.equal(actual.failure, null);
    assert.equal(actual.starts, 0);
    assert.equal(actual.result.alreadyRunning, true);
    assert.equal(actual.result.launchMode, 'existing-supervisor');
  }
});

test('a stuck Running task times out without submitting an IgnoreNew start request', windowsOnly, async () => {
  const actual = await scenario('$script:task.State = "Running"; $script:statuses = @($absent)');
  assert.match(actual.failure, /readiness timed out/);
  assert.equal(actual.starts, 0);
});

test('maintenance or changed task ownership during the finishing window prevents startup', windowsOnly, async () => {
  const maintenance = await scenario('$script:task.State = "Running"; $script:statuses = @($absent, $maintenance)');
  assert.match(maintenance.failure, /maintenance is active/);
  assert.equal(maintenance.starts, 0);
  const changed = await scenario('$parameters.TimeoutSeconds = 3; $script:taskStates = @("Running", "Running", "Ready"); $script:statuses = @($absent); $script:changeOwnerOnRead = 3');
  assert.match(changed.failure, /ownership does not match/);
  assert.equal(changed.starts, 0);
});
