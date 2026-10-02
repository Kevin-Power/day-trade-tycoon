param([Parameter(Mandatory=$true)][string]$RuntimeRoot, [Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Continue'
$logPath = Join-Path $RuntimeRoot 'logs\task-diagnostic.log'
$supervisorPath = Join-Path $PSScriptRoot 'supervisor.mjs'
('Diagnostic started: ' + [DateTime]::UtcNow.ToString('o')) | Out-File -LiteralPath $logPath -Encoding utf8
('Identity: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name) | Out-File -LiteralPath $logPath -Append -Encoding utf8
('Supervisor readable: ' + (Test-Path -LiteralPath $supervisorPath)) | Out-File -LiteralPath $logPath -Append -Encoding utf8
('Runtime: ' + $RuntimeRoot) | Out-File -LiteralPath $logPath -Append -Encoding utf8
('Config readable: ' + (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'hosting.json'))) | Out-File -LiteralPath $logPath -Append -Encoding utf8
& $NodePath (Join-Path $PSScriptRoot 'diagnose-path.mjs') $RuntimeRoot 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
& $NodePath --version 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
('Version exit: ' + $LASTEXITCODE) | Out-File -LiteralPath $logPath -Append -Encoding utf8
& $NodePath $supervisorPath status --runtime $RuntimeRoot 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
('Status exit: ' + $LASTEXITCODE) | Out-File -LiteralPath $logPath -Append -Encoding utf8
