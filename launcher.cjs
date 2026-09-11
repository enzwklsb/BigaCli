// Stable launcher: runs the selected release and installs complete changed components.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork,spawn}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const root=__dirname, activeFile=path.join(root,'active.json');
let active=JSON.parse(fs.readFileSync(activeFile)),child,busy=false;
let state={phase:'idle',version:active.version,available:null,error:null};
const componentPath=(m,k)=>path.join(root,'store',k,m.components[k].id);
const atomic=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file)};
function validate(m){
 if(!/^\d+\.\d+\.\d+$/.test(m.version))throw Error('Invalid release version');
 for(const k of ['app','deps','node']){
  const c=m.components?.[k];
  if(!c||!/^[a-f0-9]{64}$/.test(c.id)||c.sha256!==c.id)throw Error('Invalid component: '+k);
  if(!c.url.startsWith('https://github.com/enzwklsb/BigaCli/releases/download/'))throw Error('Invalid download source');
 }
 return m;
}
async function check(){
 if(busy)return state;
 try{
  const r=await fetch('https://github.com/enzwklsb/BigaCli/releases/latest/download/release.json',{signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!r.ok)throw Error('检查更新失败：HTTP '+r.status);
  const m=validate(await r.json());
  const cmp=m.version.split('.').map(Number),now=active.version.split('.').map(Number);
  const i=cmp.findIndex((n,i)=>n!==now[i]);
  state.available=i>=0&&cmp[i]>now[i]?m:null;state.error=null;
 }catch(e){state.error=e.message}
 return state;
}
function command(exe,args){return new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(err||'Command failed: '+c)))})}
async function downloadComponent(m,k){
 const c=m.components[k],target=componentPath(m,k);if(fs.existsSync(target))return;
 const downloads=path.join(root,'downloads');fs.mkdirSync(downloads,{recursive:true});
 const zip=path.join(downloads,k+'-'+c.id+'.zip');
 const r=await fetch(c.url,{signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error('下载失败：HTTP '+r.status);
 const hash=createHash('sha256'),stream=Readable.fromWeb(r.body);stream.on('data',b=>hash.update(b));
 await pipeline(stream,fs.createWriteStream(zip));
 if(hash.digest('hex')!==c.sha256)throw Error('下载校验失败，请重试');
 const temp=target+'.'+randomUUID()+'.tmp';fs.mkdirSync(path.dirname(target),{recursive:true});
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(temp)} -Force`]);
 fs.renameSync(temp,target);fs.unlinkSync(zip);
}
function start(m){
 const app=path.join(componentPath(m,'app'),'cloudcli'),deps=path.join(componentPath(m,'deps'),'node_modules');
 const link=path.join(app,'node_modules');
 // Each app component owns a junction to the dependency version in its release.
 if(fs.existsSync(link)){if(fs.realpathSync(link)!==fs.realpathSync(deps))fs.unlinkSync(link)}
 if(!fs.existsSync(link))fs.symlinkSync(deps,link,'junction');
 const logDir=path.join(os.homedir(),'.bigacli','logs');fs.mkdirSync(logDir,{recursive:true});
 const log=fs.openSync(path.join(logDir,'server.log'),'a');
 child=fork(path.join(app,'dist-server/server/index.js'),[],{execPath:path.join(componentPath(m,'node'),'node.exe'),cwd:app,env:{...process.env,HOST:'0.0.0.0',SERVER_PORT:process.env.BIGACLI_PORT||'3101',BIGACLI_VERSION:m.version},windowsHide:true,stdio:['ignore',log,log,'ipc']});fs.closeSync(log);
 child.on('message',async msg=>{
  if(msg?.type!=='bigacli-update')return;
  const reply=value=>{if(child?.connected)child.send({type:'bigacli-update-result',id:msg.id,value})};
  if(msg.action==='status')reply(state);
  else if(msg.action==='check')reply(await check());
  else if(msg.action==='install'){
   if(busy){reply(state);return}if(!state.available){reply({...state,error:'没有可安装的更新'});return}
   busy=true;reply({...state,phase:'downloading'});void install(state.available);
  }
 });
}
async function health(version){
 for(let i=0;i<40;i++){
  try{const r=await fetch('http://127.0.0.1:'+(process.env.BIGACLI_PORT||3101)+'/health',{signal:AbortSignal.timeout(1500)});const j=await r.json();if(r.ok&&j.bigaVersion===version)return true}catch{}
  await new Promise(r=>setTimeout(r,500));
 }return false;
}
async function stop(){if(!child||child.exitCode!==null)return;const p=child;await new Promise(resolve=>{p.once('exit',resolve);p.kill()});}
async function install(m){
 const previous=active;
 try{
  state={...state,phase:'downloading',error:null};
  for(const k of ['app','deps','node']){state.component=k;await downloadComponent(m,k)}
  state.phase='waiting';
  // Ask the existing server to reserve the switch only when all runs are idle.
  while(true){
   const idle=await new Promise(resolve=>{const id=randomUUID();const timer=setTimeout(()=>{child.off('message',on);resolve(false)},3000);const on=msg=>{if(msg?.type==='bigacli-idle'&&msg.id===id){clearTimeout(timer);child.off('message',on);resolve(msg.idle)}};child.on('message',on);child.send({type:'bigacli-prepare-switch',id})});
   if(idle)break;await new Promise(r=>setTimeout(r,1000));
  }
  state.phase='restarting';await stop();atomic(path.join(root,'previous.json'),previous);atomic(activeFile,m);start(m);
  if(!await health(m.version))throw Error('新版启动失败');
  active=m;state={phase:'idle',version:m.version,available:null,error:null};
 }catch(e){
  if(state.phase==='restarting'){await stop();atomic(activeFile,previous);start(previous)}
  state={phase:'idle',version:previous.version,available:m,error:e.message};
 }finally{busy=false}
}
async function main(){
 try{const r=await fetch('http://127.0.0.1:'+(process.env.BIGACLI_PORT||3101)+'/health',{signal:AbortSignal.timeout(1000)});if((await r.json()).bigaVersion){process.exit();return}}catch{}
 start(active);setTimeout(check,3000);setInterval(check,60000);
}
main();
process.on('message',async m=>{if(m?.type==='shutdown'){await stop();process.exit()}});
process.on('SIGTERM',async()=>{await stop();process.exit()});
