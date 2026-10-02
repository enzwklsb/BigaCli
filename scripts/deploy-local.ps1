param([string]$InstallRoot=(Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'BigaCli-local'),[switch]$MigrateLegacy,[switch]$AppOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$version=(Get-Content (Join-Path $repo 'release.json') -Raw | ConvertFrom-Json).version
$source=Join-Path $repo "build/$version/components/app"
$root=(Resolve-Path -LiteralPath $InstallRoot).Path
$log=Join-Path $repo "build/$version/local-deploy.log"
$switched=$false
$backup=Join-Path $root ('downloads/deploy-backup-'+[guid]::NewGuid().ToString('N'))
$boot=@();if(-not $AppOnly){$boot=@('start.cmd','foreground.ps1','launcher.cjs','local-start.cjs','update-files.cjs')}
function Get-AppFiles([string]$Directory){
 foreach($entry in Get-ChildItem -LiteralPath $Directory -Force){
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
  if($entry.PSIsContainer){Get-AppFiles $entry.FullName}else{$entry}
 }
}
try {
 $active=Get-Content (Join-Path $root 'active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 $sourceFiles=@(Get-AppFiles $source | Sort-Object FullName)
 $hashes=$sourceFiles | Get-FileHash
 $sha=[Security.Cryptography.SHA256]::Create()
 try {$identity=($hashes | ForEach-Object {$_.Path.Substring($source.Length+1)+' '+$_.Hash}) -join "`n";$id=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
 $dest=Join-Path $root "store/app/$id"
 if(!(Test-Path -LiteralPath $dest)){
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  foreach($file in $sourceFiles){$target=Join-Path $dest $file.FullName.Substring($source.Length+1);New-Item -ItemType Directory -Force (Split-Path $target -Parent)|Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $target}
 }
 "Staged $version; waiting for running tasks to finish." | Set-Content -LiteralPath $log
 do {
  if($MigrateLegacy){
   # One-time bootstrap: the old server has no reservation endpoint.
   $running=Invoke-RestMethod 'http://127.0.0.1:3101/api/providers/sessions/running'
   if($null -eq $running.data.sessions){throw 'Cannot confirm running tasks'}
   $idle=@($running.data.sessions).Count -eq 0
  }else{$idle=(Invoke-RestMethod 'http://127.0.0.1:3101/api/bigacli/update/reserve-switch' -Method Post).idle}
  if(-not $idle){Start-Sleep -Seconds 2}
 } while(-not $idle)
 New-Item -ItemType Directory -Force $backup | Out-Null
 foreach($name in ($boot+@('active.json','previous.json'))){$file=Join-Path $root $name;if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination (Join-Path $backup $name)}}
 $listener=Get-NetTCPConnection -State Listen -LocalPort 3101 | Select-Object -First 1
 $server=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
 $launcher=Get-CimInstance Win32_Process -Filter "ProcessId=$($server.ParentProcessId)"
 if(!$server.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or !$launcher.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $launcher.CommandLine -notmatch 'launcher\.cjs'){throw '3101 is not owned by the expected BigaCli launcher'}
 $active.version=$version
 $active.components.app.id=$id
 $active.components.app.sha256=$id
 $switched=$true
 Stop-Process -Id $launcher.ProcessId
 Stop-Process -Id $server.ProcessId -ErrorAction SilentlyContinue
 Copy-Item -LiteralPath (Join-Path $root 'active.json') -Destination (Join-Path $root 'previous.json') -Force
 [IO.File]::WriteAllText((Join-Path $root 'active.json'),($active|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
 foreach($name in $boot){$temp=Join-Path $root ($name+'.new');Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $temp -Force;Move-Item -LiteralPath $temp -Destination (Join-Path $root $name) -Force}
 (New-Object -ComObject Shell.Application).ShellExecute('powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root 'foreground.ps1')+'" -StartService'),$root,'open',0)
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 500
  try {$health=Invoke-RestMethod 'http://127.0.0.1:3101/health';$state=Invoke-RestMethod 'http://127.0.0.1:3101/api/bigacli/update/status';if($health.bigaVersion -eq $version -and $state.appId -eq $id){"PASS: 3101 running $version ($id)" | Add-Content -LiteralPath $log;exit 0}} catch {}
 }
 throw 'Local build did not become healthy'
} catch {
 $_ | Out-String | Add-Content -LiteralPath $log
 if($switched){
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -match 'launcher\.cjs|dist-server[\\/]server[\\/]index\.js' } | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  foreach($name in ($boot+@('active.json','previous.json'))){$old=Join-Path $backup $name;$dest=Join-Path $root $name;if(Test-Path -LiteralPath $old){Copy-Item -LiteralPath $old -Destination ($dest+'.restore') -Force;Move-Item -LiteralPath ($dest+'.restore') -Destination $dest -Force}elseif($name -eq 'previous.json' -and (Test-Path -LiteralPath $dest)){Remove-Item -LiteralPath $dest -Force}}
  (New-Object -ComObject Shell.Application).ShellExecute('powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $root 'foreground.ps1')+'" -StartService'),$root,'open',0)
  'Restored previous application and launcher files.' | Add-Content -LiteralPath $log
 }else{try{Invoke-RestMethod 'http://127.0.0.1:3101/api/bigacli/update/release-switch' -Method Post | Out-Null}catch{}}
 exit 1
}
