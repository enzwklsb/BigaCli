@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=Get-Content active.json -Raw|ConvertFrom-Json; $n=Join-Path (Get-Location) ('store/node/'+$r.components.node.id+'/node.exe'); Start-Process -FilePath $n -ArgumentList 'launcher.cjs' -WorkingDirectory (Get-Location) -WindowStyle Hidden"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3101"
