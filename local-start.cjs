// Receives the legacy Android ZIP layout without changing the delivery service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
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
    try{response=await fetch(`http://127.0.0.1:${port}/api/providers/sessions/running`,{signal:AbortSignal.timeout(3000)})}
    catch(error){if(error.cause?.code==='ECONNREFUSED')break;throw error}
    if(!response.ok)throw Error('Cannot read running tasks: '+response.status);
    const value=await response.json();
    if(!Array.isArray(value.data?.sessions))throw Error('Invalid running-task response');
    if(!value.data.sessions.length)break;
    await sleep(2000);
  }
  const stage=path.join(root,'downloads','local-app-'+crypto.randomUUID());
  fs.cpSync(component(active,'app'),stage,{recursive:true,filter:source=>path.basename(source)!=='node_modules'});
  fs.cpSync(patch,path.join(stage,'cloudcli'),{recursive:true});
  const versionFile=path.join(root,'runtime/version.json');
  if(fs.existsSync(versionFile))fs.copyFileSync(versionFile,path.join(stage,'version.json'));
  const version=JSON.parse(fs.readFileSync(path.join(stage,'version.json'))).version;
  const files=fs.readdirSync(stage,{recursive:true}).filter(f=>fs.statSync(path.join(stage,f)).isFile()).sort();
  const hash=crypto.createHash('sha256');
  for(const file of files){hash.update(file);hash.update(fs.readFileSync(path.join(stage,file)))}
  const id=hash.digest('hex'),destination=path.join(root,'store/app',id);
  if(!fs.existsSync(destination))moveDirectory(stage,destination);
  // The old receiver only recognizes runtime/node. Stop only this install's launcher/server.
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const server=path.join(component(active,'app'),'cloudcli/dist-server/server/index.js');
  const script=`$ErrorActionPreference='Stop'; $r=${quote(root+path.sep)}; $s=${quote(server)}; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and ($_.CommandLine.IndexOf($s,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine -match '(^|[\\s"\\\\/])launcher\\.cjs([\\s"]|$)') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const stopScript=script.replace('Stop-Process -Id $_.ProcessId -Force', '$targetId=$_.ProcessId; try { Stop-Process -Id $targetId -Force -ErrorAction Stop } catch { if (Get-Process -Id $targetId -ErrorAction SilentlyContinue) { throw } }');
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',stopScript],{windowsHide:true,env});
  const next={...active,version,components:{...active.components,app:{...active.components.app,id,sha256:id}}};
  atomic(path.join(root,'previous.json'),active);atomic(activeFile,next);
  // Consume the inbox: later small patches must not replay stale files after a GitHub update.
  moveDirectory(patch,path.join(root,'downloads','applied-patch-'+crypto.randomUUID()));
  if(fs.existsSync(versionFile))fs.unlinkSync(versionFile);
  log('Applied '+version+'; starting service.');
  return next;
}
async function main(){
  let active=JSON.parse(fs.readFileSync(activeFile));
  const applied=fs.existsSync(patch);
  try { if(applied)active=await applyPatch(active); }
  finally {
    // A failed switch may already have stopped the old service. Start the selected app either way.
    const selected=JSON.parse(fs.readFileSync(activeFile));
    const node=path.join(component(selected,'node'),'node.exe');
    const child=spawn(node,[path.join(root,'launcher.cjs')],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  }
  if(applied){
    for(let i=0;i<40;i++){await sleep(500);try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).bigaVersion===active.version){log('PASS: service healthy on '+port);return}}catch{}}
    throw Error('Updated service did not become healthy; see server log.');
  }
}
main().catch(error=>{log('ERROR: '+error.message);process.exitCode=1});
