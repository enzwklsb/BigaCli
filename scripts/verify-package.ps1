param([string]$Version='0.1.0', [string[]]$Components=@('app','deps','node'))
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.IO.Compression.FileSystem
$count=0
foreach($name in $Components){
 $source=Join-Path $repo "build/$Version/components/$name"
 $zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $repo "build/$Version/assets/$name-win-x64.zip"))
 try{
  foreach($entry in $zip.Entries){
   $file=Join-Path $source $entry.FullName
   if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing source: $file"}
   $sha=[Security.Cryptography.SHA256]::Create();$stream=$entry.Open()
   try{$digest=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$stream.Dispose();$sha.Dispose()}
   if($digest -ne (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash){throw "ZIP mismatch: $file"}
   $count++
  }
 }finally{$zip.Dispose()}
}
Write-Output "PASS: $count component entries match source bytes"
