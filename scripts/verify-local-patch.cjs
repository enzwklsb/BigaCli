const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-delivery-'));
const port=Number(process.env.BIGACLI_TEST_PORT||39126),nodeId='1'.repeat(64),appId='2'.repeat(64),depsId='3'.repeat(64);
const node=path.join(root,'store/node',nodeId,'node.exe');fs.mkdirSync(path.dirname(node),{recursive:true});fs.copyFileSync(process.execPath,node);
const app=path.join(root,'store/app',appId),server=path.join(app,'cloudcli/dist-server/server');fs.mkdirSync(server,{recursive:true});
fs.mkdirSync(path.join(root,'store/deps',depsId,'node_modules'),{recursive:true});
fs.writeFileSync(path.join(app,'version.json'),JSON.stringify({version:'0.2.5'}));
fs.writeFileSync(path.join(server,'index.js'),`const http=require('node:http');http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.includes('reserve-switch')?{idle:true}:req.url.includes('running')?{data:{sessions:[]}}:{bigaVersion:process.env.BIGACLI_VERSION,pid:process.pid,marker:'before'}))}).listen(process.env.SERVER_PORT,'127.0.0.1');`);
fs.writeFileSync(path.join(server,'obsolete.js'),'obsolete');
fs.writeFileSync(path.join(root,'active.json'),JSON.stringify({version:'0.2.5',components:{app:{id:appId},node:{id:nodeId},deps:{id:depsId}}}));
for(const file of require('../update-files.cjs').bootNames)fs.copyFileSync(file,path.join(root,file));
const env={...process.env,BIGACLI_PORT:String(port),HOME:root,USERPROFILE:root};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function health(){return (await fetch('http://127.0.0.1:'+port+'/health')).json()}
async function waitFor(test){for(let i=0;i<60;i++){try{const x=await health();if(test(x))return x}catch{}await sleep(200)}throw Error('Service timeout')}
let launcher;
(async()=>{try{
 launcher=spawn(node,[path.join(root,'launcher.cjs')],{env,windowsHide:true,stdio:'ignore'});
 const before=await waitFor(x=>x.marker==='before');
 const dest=path.join(root,'runtime/cloudcli/dist-server/server');fs.mkdirSync(dest,{recursive:true});
 fs.writeFileSync(path.join(dest,'index.js'),fs.readFileSync(path.join(server,'index.js'),'utf8').replace("marker:'before'","marker:'after'"));
 fs.writeFileSync(path.join(root,'runtime/delete-files.json'),JSON.stringify(['dist-server/server/obsolete.js']));
 if(process.platform==='win32')for(const folder of [app,path.join(root,'runtime/cloudcli')])require('node:child_process').execFileSync('attrib.exe',['+R',folder],{windowsHide:true});
 const p=spawn(node,[path.join(root,'local-start.cjs')],{env,windowsHide:true,stdio:'inherit'});
 const exit=await new Promise(resolve=>p.once('exit',resolve));if(exit)console.error(fs.readFileSync(path.join(root,'downloads/local-patch.log'),'utf8'));assert.equal(exit,0);
 const after=await waitFor(x=>x.marker==='after');assert.notEqual(after.pid,before.pid);
 assert.equal(fs.existsSync(path.join(root,'runtime/cloudcli')),false);
 const active=JSON.parse(fs.readFileSync(path.join(root,'active.json')));assert.equal(active.components.deps.id,depsId);assert.equal(active.components.node.id,nodeId);assert.notEqual(active.components.app.id,appId);
 assert.equal(fs.existsSync(path.join(root,'store/app',active.components.app.id,'cloudcli/dist-server/server/obsolete.js')),false);
 assert.ok(fs.existsSync(path.join(server,'obsolete.js')),'previous version retains deleted file');
 assert.ok(fs.readFileSync(path.join(root,'downloads/local-patch.log'),'utf8').includes('PASS:'));
 const previous=fs.readFileSync(path.join(root,'previous.json'),'utf8');
 fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'index.js'),'throw new Error("isolated startup failure")');
 const broken=spawn(node,[path.join(root,'local-start.cjs')],{env,windowsHide:true,stdio:'ignore'});
 assert.notEqual(await new Promise(resolve=>broken.once('exit',resolve)),0);
 try{await waitFor(x=>x.marker==='after')}catch(error){console.error(fs.readFileSync(path.join(root,'downloads/local-patch.log'),'utf8'));console.error(fs.readFileSync(path.join(root,'.bigacli/logs/server.log'),'utf8'));throw error}assert.equal(JSON.parse(fs.readFileSync(path.join(root,'active.json'))).components.app.id,active.components.app.id);
 assert.equal(fs.readFileSync(path.join(root,'previous.json'),'utf8'),previous);
 assert.equal(fs.existsSync(path.join(root,'runtime/cloudcli')),false);
 console.log('PASS: patch deletion, previous retained, failed startup restores active/previous and service, failed inbox isolated');
 // Test root-file rollback from an entry that is independent of the replacement launcher.
 const stage=path.join(root,'downloads','boot-test');fs.mkdirSync(path.join(stage,'boot'),{recursive:true});
 const helpers=require('../update-files.cjs');for(const file of helpers.bootNames)fs.copyFileSync(path.join(root,file),path.join(stage,'boot',file));
 fs.writeFileSync(path.join(stage,'boot','launcher.cjs'),'throw new Error("isolated launcher failure")');
 const originalLauncher=fs.readFileSync(path.join(root,'launcher.cjs'),'utf8');
 fs.writeFileSync(path.join(root,'pending-update.json'),JSON.stringify({target:{...active,version:'0.2.6'},previous:active,older:JSON.parse(previous),stage}));
 // Stop only this fixture's current service through the existing launcher IPC-independent process filter.
 const stop=`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -like '${root.replaceAll("'","''")}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
 const clean={...env};for(const key of Object.keys(clean))if(key.toLowerCase()==='psmodulepath')delete clean[key];
 require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command',stop],{env:clean,windowsHide:true});
 const boot=spawn(node,[path.join(root,'local-start.cjs'),'--pending-update'],{env,windowsHide:true,stdio:'ignore'});
 assert.notEqual(await new Promise(resolve=>boot.once('exit',resolve)),0);await waitFor(x=>x.marker==='after');
 assert.equal(fs.readFileSync(path.join(root,'launcher.cjs'),'utf8'),originalLauncher);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'active.json'))).version,active.version);
 console.log('PASS: failed launcher upgrade restores root files and previous service');
 }finally{
 launcher?.kill();
 const command=`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -like '${root.replaceAll("'","''")}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
 const cleanEnv={...process.env};for(const k of Object.keys(cleanEnv))if(k.toLowerCase()==='psmodulepath')delete cleanEnv[k];
 require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command',command],{env:cleanEnv,windowsHide:true});
 require('../update-files.cjs').removeTree(root,os.tmpdir());
 }} )().catch(e=>{console.error(e);process.exitCode=1});
