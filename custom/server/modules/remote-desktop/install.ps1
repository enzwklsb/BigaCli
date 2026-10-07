param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Ini)
$ErrorActionPreference='Stop'
try {
 $name='BigaCliRemoteDesktop'
 $destination=Join-Path $env:ProgramFiles $name
 $existing=Get-Service $name -ErrorAction SilentlyContinue
 if($existing){Stop-Service $name -ErrorAction Stop}
 New-Item -ItemType Directory -Path $destination -Force | Out-Null
 foreach($file in @('winvnc.exe','vnchooks.dll','ddengine64.dll','LICENSE.txt','SOURCE.txt')){Copy-Item -LiteralPath (Join-Path $Source $file) -Destination (Join-Path $destination $file) -Force}
 New-Item -ItemType File -Path (Join-Path $destination 'ultravnc.portable') -Force | Out-Null
 foreach($file in @('ultravnc.ini',"$name.ini")){Copy-Item -LiteralPath $Ini -Destination (Join-Path $destination $file) -Force}
 if(!$existing){New-Service -Name $name -DisplayName 'BigaCli remote desktop (localhost only)' -BinaryPathName ('"'+(Join-Path $destination 'winvnc.exe')+'" -service') -StartupType Automatic | Out-Null}
 Start-Service $name
 # Retire only the isolated feasibility service that preceded this feature.
 if(Get-Service BigaCliDesktopProbe -ErrorAction SilentlyContinue){Stop-Service BigaCliDesktopProbe; & sc.exe delete BigaCliDesktopProbe | Out-Null}
 exit 0
} catch {Write-Host $_ -ForegroundColor Red;Start-Sleep -Seconds 5;exit 1}
