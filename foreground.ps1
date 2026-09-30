$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle='BigaCli - close this window to stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BigaJob {
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] public struct Limits { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int type,ref Limits limits,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
 public static IntPtr Create() { var job=CreateJobObject(IntPtr.Zero,null);var limits=new Limits();limits.basic.flags=0x2000;if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new System.ComponentModel.Win32Exception();return job; }
 public static void Add(IntPtr job,int pid) { using(var process=System.Diagnostics.Process.GetProcessById(pid)){if(!AssignProcessToJobObject(job,process.Handle))throw new System.ComponentModel.Win32Exception();} }
}
'@
$mutex=New-Object Threading.Mutex($false,'Local\BigaCli-3101-window')
if(-not $mutex.WaitOne(0)){Write-Host 'BigaCli already has a running window.';Start-Sleep -Seconds 2;exit}
$job=[IntPtr]::Zero
try {
 $job=[BigaJob]::Create()
 $listener=Get-NetTCPConnection -State Listen -LocalPort 3101 -ErrorAction SilentlyContinue|Select-Object -First 1
 if($listener){
  # Adopt the old background instance without restarting its tasks.
  $processes=@(Get-CimInstance Win32_Process)
  $server=$processes|Where-Object ProcessId -EQ $listener.OwningProcess
  if(-not $server.ExecutablePath.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Port 3101 belongs to another program.'}
  $parent=$processes|Where-Object ProcessId -EQ $server.ParentProcessId
  $rootId=$server.ProcessId
  if($parent -and $parent.CommandLine -match 'launcher\.cjs' -and $parent.ExecutablePath.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)){$rootId=$parent.ProcessId}
  $ids=[Collections.Generic.List[int]]::new();$ids.Add($rootId)
  for($i=0;$i -lt $ids.Count;$i++){
   [BigaJob]::Add($job,$ids[$i])
   foreach($child in ($processes|Where-Object ParentProcessId -EQ $ids[$i])){$ids.Add($child.ProcessId)}
  }
 }else{
  [BigaJob]::Add($job,$PID)
  $active=Get-Content active.json -Raw|ConvertFrom-Json
  $node=Join-Path $PSScriptRoot ('store/node/'+$active.components.node.id+'/node.exe')
  & $node (Join-Path $PSScriptRoot 'local-start.cjs')
  if($LASTEXITCODE -ne 0){throw 'BigaCli startup failed. See downloads/local-patch.log.'}
 }
 Write-Host 'BigaCli is running at http://127.0.0.1:3101'
 Write-Host 'Close this window to stop BigaCli and all its tasks.'
 # Ask the desktop shell to open the browser outside the service job.
 (New-Object -ComObject Shell.Application).ShellExecute('http://127.0.0.1:3101')
 [void](Read-Host 'Press Enter to stop')
}catch{Write-Host $_ -ForegroundColor Red;[void](Read-Host 'Press Enter to close')}
finally{if($job -ne [IntPtr]::Zero){[void][BigaJob]::CloseHandle($job)};$mutex.ReleaseMutex();$mutex.Dispose()}
