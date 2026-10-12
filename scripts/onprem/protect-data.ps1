param([Parameter(Mandatory = $true)][string]$DataPath)
$ErrorActionPreference = 'Stop'
$resolvedData = Get-Item -LiteralPath $DataPath
if (-not $resolvedData.PSIsContainer -or ($resolvedData.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected a real data directory.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
$resolvedData.SetAccessControl($acl)
