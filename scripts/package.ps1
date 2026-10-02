param([string]$NodeDirectory, [switch]$ReuseDependencies, [switch]$ComponentsOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repo
$release=Get-Content release.json -Raw | ConvertFrom-Json
$stage=Join-Path $repo ('build/'+$release.version)
$components=Join-Path $stage 'components'
$assets=Join-Path $stage 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null
if(!$ReuseDependencies){
 $dep=Join-Path $components 'deps'
 New-Item -ItemType Directory -Force $dep | Out-Null
 Copy-Item cloudcli/package.json,cloudcli/package-lock.json -Destination $dep
 Push-Location $dep
 try {
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if($LASTEXITCODE){throw 'Dependency installation failed'}
  npm rebuild better-sqlite3 bcrypt node-pty @vscode/ripgrep
  if($LASTEXITCODE){throw 'Native dependency installation failed'}
 } finally {Pop-Location}
}
if($release.nodeArchive){
 $nodeZip=Join-Path $assets 'node-win-x64.zip'
 if(!(Test-Path -LiteralPath $nodeZip) -or (Get-FileHash -LiteralPath $nodeZip).Hash.ToLowerInvariant() -ne $release.nodeArchive.sha256){
  & curl.exe --fail --location --retry 3 --output $nodeZip $release.nodeArchive.url
  if($LASTEXITCODE){throw 'Node component download failed'}
 }
 if((Get-FileHash -LiteralPath $nodeZip).Hash.ToLowerInvariant() -ne $release.nodeArchive.sha256){throw 'Node component checksum mismatch'}
 New-Item -ItemType Directory -Force (Join-Path $components 'node') | Out-Null
 & tar.exe -xf $nodeZip -C (Join-Path $components 'node')
 if($LASTEXITCODE){throw 'Node component extraction failed'}
}elseif($NodeDirectory){
 New-Item -ItemType Directory -Force (Join-Path $components 'node') | Out-Null
 Copy-Item -LiteralPath (Join-Path $NodeDirectory 'node.exe') -Destination (Join-Path $components 'node/node.exe')
 if(Test-Path (Join-Path $NodeDirectory 'LICENSE')){Copy-Item (Join-Path $NodeDirectory 'LICENSE') (Join-Path $components 'node/LICENSE')}
}
# Stable timestamps allow unchanged component ZIPs to retain their hash across releases.
Add-Type -AssemblyName System.IO.Compression
function Write-Zip([string]$source,[string]$target){
 $base=(Resolve-Path -LiteralPath $source).Path.TrimEnd('\')
 $stream=[IO.File]::Open($target,[IO.FileMode]::Create)
 $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
 try {
  Get-ChildItem -LiteralPath $base -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
   $relative=$_.FullName.Substring($base.Length+1).Replace('\','/')
   $entry=$archive.CreateEntry($relative,[IO.Compression.CompressionLevel]::Optimal)
   $entry.LastWriteTime=[DateTimeOffset]::new(2026,1,1,0,0,0,[TimeSpan]::Zero)
   $inputStream=[IO.File]::OpenRead($_.FullName);$outputStream=$entry.Open()
   try{$inputStream.CopyTo($outputStream)}finally{$inputStream.Dispose();$outputStream.Dispose()}
  }
 }finally{$archive.Dispose();$stream.Dispose()}
}
$manifest=[ordered]@{version=$release.version;cloudcli=$release.cloudcli;codex=$release.codex;components=[ordered]@{}}
$notes=Get-Content (Join-Path $repo 'releases/update-notes.json') -Raw -Encoding utf8 | ConvertFrom-Json
if($notes.version -ne $release.version){throw 'Update notes must be written for this release version'}
$manifest.releaseNotes=$notes
$full=Join-Path $stage 'BigaCli'
if(!$ComponentsOnly -and (Test-Path -LiteralPath $full)){
 $resolved=(Resolve-Path -LiteralPath $full).Path
 if($resolved -ne [IO.Path]::GetFullPath((Join-Path $repo ('build/'+$release.version+'/BigaCli')))){throw 'Unexpected build output path'}
 # PowerShell 5 Remove-Item fails on deep node_modules paths.
 & attrib.exe -R ($resolved+'\*') /S /D
 & attrib.exe -R $resolved
 [IO.Directory]::Delete(('\\?\'+$resolved),$true)
}
if(!$ComponentsOnly){New-Item -ItemType Directory -Force $full | Out-Null}
foreach($name in @('app','deps','node')){
 $zip=Join-Path $assets ($name+'-win-x64.zip')
 if(!($name -eq 'node' -and $release.nodeArchive) -and ($name -eq 'app' -or !$ReuseDependencies -or !(Test-Path -LiteralPath $zip))){Write-Zip (Join-Path $components $name) $zip}
 $hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
 $manifest.components[$name]=[ordered]@{id=$hash;sha256=$hash;size=(Get-Item $zip).Length;url=('https://github.com/'+$release.repository+'/releases/download/v'+$release.version+'/'+$name+'-win-x64.zip')}
 if($ComponentsOnly){continue}
 $dest=Join-Path $full ('store/'+$name+'/'+$hash)
 New-Item -ItemType Directory -Force $dest | Out-Null
 & tar.exe -xf $zip -C $dest
 if($LASTEXITCODE){throw ('Could not assemble '+$name+' component')}
}
$json=$manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $assets 'release.json'),$json)
# Reuse component ZIPs as file-level range sources. No full-package fallback in updates.
& (Join-Path $components 'node/node.exe') (Join-Path $repo 'scripts/index-release.cjs') $assets
if($LASTEXITCODE){throw 'File update index generation failed'}
Copy-Item -LiteralPath (Join-Path $assets 'boot-win-x64.zip') -Destination (Join-Path $assets 'BigaCli-updater-win-x64.zip')
$json=Get-Content (Join-Path $assets 'release.json') -Raw -Encoding UTF8
function Write-Checksums {
 $lines=Get-ChildItem -LiteralPath $assets -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name }
 [IO.File]::WriteAllLines((Join-Path $assets 'SHA256SUMS.txt'),[string[]]$lines)
}
if($ComponentsOnly){Write-Checksums; Get-ChildItem $assets -File | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize; return}
[IO.File]::WriteAllText((Join-Path $full 'active.json'),$json)
Copy-Item start.cmd,foreground.ps1,launcher.cjs,local-start.cjs,update-files.cjs,LICENSE,README.md -Destination $full
$fullZip=Join-Path $assets 'BigaCli-win-x64.zip'
& tar.exe -a -cf $fullZip -C $full .
if($LASTEXITCODE){throw 'Could not create full package'}
Write-Checksums
Get-ChildItem $assets -File | Get-FileHash -Algorithm SHA256 | Format-Table -AutoSize
