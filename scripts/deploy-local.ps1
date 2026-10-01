param([string]$InstallRoot=(Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'BigaCli-local'))
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$version=(Get-Content (Join-Path $repo 'release.json') -Raw | ConvertFrom-Json).version
$source=Join-Path $repo "build/$version/components/app"
$root=(Resolve-Path -LiteralPath $InstallRoot).Path
$log=Join-Path $repo "build/$version/local-deploy.log"
try {
 $active=Get-Content (Join-Path $root 'active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $hashes=Get-ChildItem -LiteralPath $source -File -Recurse | Sort-Object FullName | Get-FileHash
 $sha=[Security.Cryptography.SHA256]::Create()
 try {$id=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($hashes.Hash -join '')))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
 $dest=Join-Path $root "store/app/$id"
 if(!(Test-Path -LiteralPath $dest)){New-Item -ItemType Directory -Path $dest -Force | Out-Null; Copy-Item -Path (Join-Path $source '*') -Destination $dest -Recurse}
 "Staged $version; waiting for running tasks to finish." | Set-Content -LiteralPath $log
 do {
  $running=Invoke-RestMethod 'http://127.0.0.1:3101/api/providers/sessions/running'
  if(@($running.data.sessions).Count){Start-Sleep -Seconds 3}
 } while(@($running.data.sessions).Count)
 $listener=Get-NetTCPConnection -State Listen -LocalPort 3101 | Select-Object -First 1
 $server=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
 $launcher=Get-CimInstance Win32_Process -Filter "ProcessId=$($server.ParentProcessId)"
 if(!$server.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or !$launcher.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $launcher.CommandLine -notmatch 'launcher\.cjs'){throw '3101 is not owned by the expected BigaCli launcher'}
 Copy-Item -LiteralPath (Join-Path $root 'active.json') -Destination (Join-Path $root 'previous.json') -Force
 $active.version=$version
 $active.components.app.id=$id
 $active.components.app.sha256=$id
 Stop-Process -Id $launcher.ProcessId
 Stop-Process -Id $server.ProcessId
 [IO.File]::WriteAllText((Join-Path $root 'active.json'),($active|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
 Copy-Item -LiteralPath (Join-Path $repo 'foreground.ps1') -Destination (Join-Path $root 'foreground.ps1') -Force
 (New-Object -ComObject Shell.Application).ShellExecute('powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root 'foreground.ps1')+'" -StartService'),$root,'open',1)
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 500
  try {$health=Invoke-RestMethod 'http://127.0.0.1:3101/health';if($health.bigaVersion -eq $version){"PASS: 3101 running $version" | Add-Content -LiteralPath $log;exit 0}} catch {}
 }
 throw 'Local build did not become healthy; previous.json retains the original manifest'
} catch {$_ | Out-String | Add-Content -LiteralPath $log;exit 1}
