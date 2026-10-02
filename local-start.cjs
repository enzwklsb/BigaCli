// Receives the legacy Android ZIP layout without changing the delivery service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const files=require('./update-files.cjs');
const root=__dirname,activeFile=path.join(root,'active.json'),patch=path.join(root,'runtime/cloudcli');
const port=process.env.BIGACLI_PORT||'3101';
const logFile=path.join(root,'downloads/local-patch.log');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function log(text){fs.mkdirSync(path.dirname(logFile),{recursive:true});fs.appendFileSync(logFile,new Date().toISOString()+' '+text+'\n')}
function atomic(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file)}
function component(m,key){return path.join(root,'store',key,m.components[key].id)}
function moveDirectory(source,destination){
  // ZIP extraction/copy on Windows can preserve a directory's read-only attribute.
  if(process.platform==='win32')execFileSync('attrib.exe',['-R',source],{windowsHide:true});
  fs.renameSync(source,destination);
}
async function applyPatch(active){
  log('Patch received; waiting for current tasks to finish.');
  while(true){
    let response;
    try{response=await fetch(`http://127.0.0.1:${port}/api/bigacli/update/reserve-switch`,{method:'POST',signal:AbortSignal.timeout(3000)})}
    catch(error){if(error.cause?.code==='ECONNREFUSED')break;throw error}
    if(!response.ok)throw Error('Cannot read running tasks: '+response.status);
    const value=await response.json();
    if(typeof value.idle!=='boolean')throw Error('This installation needs the update migration before applying a patch.');
    if(value.idle)break;
    await sleep(2000);
  }
  const stage=path.join(root,'downloads','local-app-'+crypto.randomUUID());
  fs.cpSync(component(active,'app'),stage,{recursive:true,filter:source=>path.basename(source)!=='node_modules'});
  fs.cpSync(patch,path.join(stage,'cloudcli'),{recursive:true});
  const deleteFile=path.join(root,'runtime/delete-files.json');
  if(fs.existsSync(deleteFile)){
    const entries=JSON.parse(fs.readFileSync(deleteFile));if(!Array.isArray(entries))throw Error('Invalid deletion list');
    for(const relative of entries){
      const target=files.inside(path.join(stage,'cloudcli'),relative);
      if(fs.existsSync(files.inside(patch,relative)))throw Error('Patch writes and deletes the same file: '+relative);
      if(fs.existsSync(target)){if(!fs.lstatSync(target).isFile())throw Error('Patch deletion must name a file');fs.unlinkSync(target)}
    }
  }
  const versionFile=path.join(root,'runtime/version.json');
  if(fs.existsSync(versionFile))fs.copyFileSync(versionFile,path.join(stage,'version.json'));
  const version=JSON.parse(fs.readFileSync(path.join(stage,'version.json'))).version;
  const stagedFiles=fs.readdirSync(stage,{recursive:true}).filter(f=>fs.statSync(path.join(stage,f)).isFile()).sort();
  const hash=crypto.createHash('sha256');
  for(const file of stagedFiles){hash.update(file);hash.update(fs.readFileSync(path.join(stage,file)))}
  const id=hash.digest('hex'),destination=path.join(root,'store/app',id);
  if(!fs.existsSync(destination))moveDirectory(stage,destination);else files.removeTree(stage,path.join(root,'downloads'));
  // The old receiver only recognizes runtime/node. Stop only this install's launcher/server.
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const server=path.join(component(active,'app'),'cloudcli/dist-server/server/index.js');
  const script=`$ErrorActionPreference='Stop'; $r=${quote(root+path.sep)}; $s=${quote(server)}; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and ($_.CommandLine.IndexOf($s,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine -match '(^|[\\s"\\\\/])launcher\\.cjs([\\s"]|$)') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const stopScript=script.replace('Stop-Process -Id $_.ProcessId -Force', '$targetId=$_.ProcessId; try { Stop-Process -Id $targetId -Force -ErrorAction Stop } catch { if (Get-Process -Id $targetId -ErrorAction SilentlyContinue) { throw } }');
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',stopScript],{windowsHide:true,env});
  const next={...active,version,components:{...active.components,app:{...active.components.app,id,sha256:id}}};
  atomic(path.join(root,'previous.json'),active);atomic(activeFile,next);
  log('Applied '+version+'; starting service.');
  return next;
}
async function main(){
  if(process.argv.includes('--pending-update'))return finishPendingUpdate();
  let active=JSON.parse(fs.readFileSync(activeFile));
  const original=active,older=files.readPrevious(root);
  const applied=fs.existsSync(patch);
  try { if(applied)active=await applyPatch(active); }
  catch(error){
    try{await fetch(`http://127.0.0.1:${port}/api/bigacli/update/release-switch`,{method:'POST',signal:AbortSignal.timeout(2000)})}catch{}
    const selected=JSON.parse(fs.readFileSync(activeFile));
    if(selected.components.app.id!==original.components.app.id){await stopInstalledProcesses();atomic(activeFile,original);restorePrevious(older)}
    if(fs.existsSync(patch))moveDirectory(patch,path.join(root,'downloads','failed-patch-'+crypto.randomUUID()));
    for(const file of ['version.json','delete-files.json'])fs.rmSync(path.join(root,'runtime',file),{force:true});
    throw error;
  }
  finally {
    // A failed switch may already have stopped the old service. Start the selected app either way.
    const selected=JSON.parse(fs.readFileSync(activeFile));
    const node=path.join(component(selected,'node'),'node.exe');
    const child=spawn(node,[path.join(root,'launcher.cjs')],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  }
  if(applied){
    for(let i=0;i<40;i++){await sleep(500);try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).bigaVersion===active.version){
      try{files.removeTree(patch,path.join(root,'runtime'));for(const file of ['version.json','delete-files.json'])fs.rmSync(path.join(root,'runtime',file),{force:true})}catch(error){log('Cleanup: '+error.message)}
      for(const warning of files.cleanup(root,active,original))log('Cleanup: '+warning);
      log('PASS: service healthy on '+port);return
    }}catch{}}
    await stopInstalledProcesses();atomic(activeFile,original);restorePrevious(older);
    if(fs.existsSync(patch))moveDirectory(patch,path.join(root,'downloads','failed-patch-'+crypto.randomUUID()));
    for(const file of ['version.json','delete-files.json'])fs.rmSync(path.join(root,'runtime',file),{force:true});
    launchSelected();throw Error('Updated service did not become healthy; previous version restored.');
  }
}
function restorePrevious(m){if(m)atomic(path.join(root,'previous.json'),m);else fs.rmSync(path.join(root,'previous.json'),{force:true})}
function launchSelected(){const m=JSON.parse(fs.readFileSync(activeFile));const child=spawn(path.join(component(m,'node'),'node.exe'),[path.join(root,'launcher.cjs')],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});child.unref();return child}
async function stopInstalledProcesses(){
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const script=`$root=${quote(root+path.sep)}; Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and ($_.CommandLine -match 'launcher\\.cjs|dist-server[\\\\/]server[\\\\/]index\\.js') } | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}`;
 const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env});
}
async function finishPendingUpdate(){
 const pendingFile=path.join(root,'pending-update.json'),pending=JSON.parse(fs.readFileSync(pendingFile));
 const stage=path.resolve(pending.stage),downloadRoot=path.join(root,'downloads');
 if(!stage.startsWith(downloadRoot+path.sep))throw Error('Invalid update staging path');
 const backup=path.join(stage,'previous-boot');fs.mkdirSync(backup,{recursive:true});
 try{
  for(const name of files.bootNames){fs.copyFileSync(path.join(root,name),path.join(backup,name))}
  for(const name of files.bootNames)files.replaceFile(path.join(stage,'boot',name),path.join(root,name));
  atomic(path.join(root,'previous.json'),pending.previous);atomic(activeFile,pending.target);launchSelected();
  let healthy=false;for(let i=0;i<40;i++){await sleep(500);try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).bigaVersion===pending.target.version){healthy=true;break}}catch{}}
  if(!healthy)throw Error('Updated launcher/application did not become healthy');
 }catch(error){
  await stopInstalledProcesses();
  for(const name of files.bootNames)if(fs.existsSync(path.join(backup,name)))files.replaceFile(path.join(backup,name),path.join(root,name));
  atomic(activeFile,pending.previous);restorePrevious(pending.older);fs.rmSync(pendingFile,{force:true});
  atomic(path.join(root,'update-failure.json'),{message:error.message});launchSelected();throw error;
 }
 fs.rmSync(pendingFile,{force:true});
 for(const warning of files.cleanup(root,pending.target,pending.previous))log(warning);
 try{files.removeTree(stage,downloadRoot)}catch(error){log('Cleanup: '+error.message)}
 log('PASS: launcher and application updated');
}
main().catch(error=>{log('ERROR: '+error.message);process.exitCode=1});
