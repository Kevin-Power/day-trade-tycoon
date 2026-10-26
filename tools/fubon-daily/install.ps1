<#
  Installs or updates the Fubon daily market-data fetcher outside the repository.
  Run from the repository root:
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -Sdk     # venv + official SDK 2.4.0 (download)
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -App     # copy the committed fetcher
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -Task    # weekday 16:45 / 18:00 / 19:00
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -BooksTask  # weekday 08:40 books recorder
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -BooksTask -BooksNoPublish  # record only
#>
param(
  [switch]$Sdk,
  [switch]$App,
  [switch]$Task,
  [switch]$BooksTask,
  [switch]$BooksNoPublish,
  [string]$Runtime = (Join-Path $env:USERPROFILE 'YilutekServices\DayTradeTycoon'),
  [string]$Credentials = (Join-Path $env:USERPROFILE '.fubon\credentials.local.py')
)
$ErrorActionPreference = 'Stop'
$fetcher = Join-Path $Runtime 'fetcher'
$venv = Join-Path $fetcher '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$sdkName = 'fubon_neo-2.4.0-cp37-abi3-win_amd64.zip'
$sdkUrl = "https://www.fbs.com.tw/TradeAPI_SDK/fubon_binary/$sdkName"
$lockPath = Join-Path $fetcher 'sdk-lock.json'
foreach ($directory in @($fetcher, (Join-Path $fetcher 'downloads'), (Join-Path $fetcher 'work'), (Join-Path $Runtime 'market-data'))) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

if ($Sdk) {
  if (-not (Test-Path $venvPython)) {
    & py -3.12 -m venv $venv
    if ($LASTEXITCODE) { throw 'Python 3.12 virtual environment could not be created.' }
  }
  $zip = Join-Path $fetcher "downloads\$sdkName"
  if (-not (Test-Path $zip)) { Invoke-WebRequest -Uri $sdkUrl -OutFile $zip -UseBasicParsing }
  $zipHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
  $extract = Join-Path $fetcher 'downloads\fubon_neo-2.4.0'
  if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
  Expand-Archive -Path $zip -DestinationPath $extract
  $wheel = Get-ChildItem -Path $extract -Recurse -Filter '*.whl' | Select-Object -First 1
  if (-not $wheel) { throw 'The SDK archive contains no wheel.' }
  $wheelHash = (Get-FileHash -Algorithm SHA256 $wheel.FullName).Hash.ToLowerInvariant()
  if (Test-Path $lockPath) {
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
    if ($lock.zipSha256 -ne $zipHash -or $lock.wheelSha256 -ne $wheelHash) {
      throw 'SDK archive hash differs from sdk-lock.json; refusing to install.'
    }
  } else {
    [ordered]@{ url = $sdkUrl; zipSha256 = $zipHash; wheel = $wheel.Name; wheelSha256 = $wheelHash; recordedAt = (Get-Date).ToString('o') } |
      ConvertTo-Json | Set-Content -Encoding UTF8 $lockPath
  }
  & $venvPython -m pip install --disable-pip-version-check $wheel.FullName
  if ($LASTEXITCODE) { throw 'pip install failed.' }
  & $venvPython -m pip freeze --disable-pip-version-check | Set-Content -Encoding UTF8 (Join-Path $fetcher 'requirements.lock.txt')
  & $venvPython -c "from importlib.metadata import version; print('fubon_neo', version('fubon_neo'))"
}

if ($App) {
  $dirty = git -C $PSScriptRoot status --porcelain -- .
  if ($dirty) { throw 'tools/fubon-daily has uncommitted changes; commit them before installing.' }
  $commit = (git -C $PSScriptRoot rev-parse HEAD).Trim()
  $target = Join-Path $fetcher 'app'
  $staging = Join-Path $fetcher ('app.staging-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot 'fubon_daily') -Destination (Join-Path $staging 'fubon_daily') -Recurse
  Copy-Item -Path (Join-Path $PSScriptRoot 'fetch_daily.py') -Destination $staging
  Copy-Item -Path (Join-Path $PSScriptRoot 'record_books.py') -Destination $staging
  Get-ChildItem -Path $staging -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
  Set-Content -Encoding ASCII -Path (Join-Path $staging 'VERSION.txt') -Value $commit
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item -Path $staging -Destination $target
  Write-Output "fetcher installed from $commit"
}

if ($Task) {
  $pythonw = Join-Path $venv 'Scripts\pythonw.exe'
  if (-not (Test-Path $pythonw)) { throw 'Run -Sdk first.' }
  $entry = Join-Path $fetcher 'app\fetch_daily.py'
  if (-not (Test-Path $entry)) { throw 'Run -App first.' }
  $arguments = '-X utf8 "{0}" --data "{1}" --credentials "{2}"' -f $entry, (Join-Path $Runtime 'market-data'), $Credentials
  $action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory (Join-Path $fetcher 'work')
  $days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
  $triggers = @('16:45', '18:00', '19:00') | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $_ }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Queue -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'DayTradeTycoonMarketData' -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description 'DayTradeTycoon: weekday Fubon 1-minute candles for TWSE common stocks (read-only market data)' -Force | Out-Null
  Get-ScheduledTask -TaskName 'DayTradeTycoonMarketData' | Select-Object TaskName, State
}

if ($BooksTask) {
  $pythonw = Join-Path $venv 'Scripts\pythonw.exe'
  if (-not (Test-Path $pythonw)) { throw 'Run -Sdk first.' }
  $entry = Join-Path $fetcher 'app\record_books.py'
  if (-not (Test-Path $entry)) { throw 'Run -App first.' }
  $workBooks = Join-Path $fetcher 'work-books'
  New-Item -ItemType Directory -Force -Path $workBooks | Out-Null
  $arguments = '-X utf8 "{0}" --data "{1}" --credentials "{2}"' -f $entry, (Join-Path $Runtime 'market-data'), $Credentials
  # After its stop time the recorder publishes the day's books (stage 2); -BooksNoPublish records only.
  if ($BooksNoPublish) { $arguments += ' --no-publish' }
  $action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory $workBooks
  $days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
  # 08:40 starts the session. Every 10 minutes until 13:20 a trigger restarts a recorder that crashed: Windows
  # ignores it while one is running, and a finished day (or one with no more login attempts) exits at once.
  $booksTimes = 0..28 | ForEach-Object { ([datetime]'08:40').AddMinutes(10 * $_).ToString('HH:mm') }
  $booksTriggers = $booksTimes | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $_ }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'DayTradeTycoonBooks' -Action $action -Trigger $booksTriggers -Settings $settings `
    -Principal $principal -Description 'DayTradeTycoon: weekday Fubon real-time order books for TWSE common stocks, 08:44-13:36 (read-only market data)' -Force | Out-Null
  Get-ScheduledTask -TaskName 'DayTradeTycoonBooks' | Select-Object TaskName, State
}

if (-not ($Sdk -or $App -or $Task -or $BooksTask)) { Write-Output 'Choose -Sdk, -App, -Task and/or -BooksTask.' }
