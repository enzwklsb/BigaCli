const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-delivery-'));
const port=3196,nodeId='1'.repeat(64),appId='2'.repeat(64),depsId='3'.repeat(64);
const node=path.join(root,'store/node',nodeId,'node.exe');fs.mkdirSync(path.dirname(node),{recursive:true});fs.copyFileSync(process.execPath,node);
const app=path.join(root,'store/app',appId),server=path.join(app,'cloudcli/dist-server/server');fs.mkdirSync(server,{recursive:true});
fs.mkdirSync(path.join(root,'store/deps',depsId,'node_modules'),{recursive:true});
fs.writeFileSync(path.join(app,'version.json'),JSON.stringify({version:'0.2.5'}));
fs.writeFileSync(path.join(server,'index.js'),`const http=require('node:http');http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.includes('running')?{data:{sessions:[]}}:{bigaVersion:process.env.BIGACLI_VERSION,pid:process.pid,marker:'before'}))}).listen(process.env.SERVER_PORT,'127.0.0.1');`);
fs.writeFileSync(path.join(root,'active.json'),JSON.stringify({version:'0.2.5',components:{app:{id:appId},node:{id:nodeId},deps:{id:depsId}}}));
for(const file of ['launcher.cjs','local-start.cjs'])fs.copyFileSync(file,path.join(root,file));
const env={...process.env,BIGACLI_PORT:String(port)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function health(){return (await fetch('http://127.0.0.1:'+port+'/health')).json()}
async function waitFor(test){for(let i=0;i<60;i++){try{const x=await health();if(test(x))return x}catch{}await sleep(200)}throw Error('Service timeout')}
let launcher;
(async()=>{try{
 launcher=spawn(node,[path.join(root,'launcher.cjs')],{env,windowsHide:true,stdio:'ignore'});
 const before=await waitFor(x=>x.marker==='before');
 const dest=path.join(root,'runtime/cloudcli/dist-server/server');fs.mkdirSync(dest,{recursive:true});
 fs.writeFileSync(path.join(dest,'index.js'),fs.readFileSync(path.join(server,'index.js'),'utf8').replace("marker:'before'","marker:'after'"));
 if(process.platform==='win32')for(const folder of [app,path.join(root,'runtime/cloudcli')])require('node:child_process').execFileSync('attrib.exe',['+R',folder],{windowsHide:true});
 const p=spawn(node,[path.join(root,'local-start.cjs')],{env,windowsHide:true,stdio:'inherit'});
 const exit=await new Promise(resolve=>p.once('exit',resolve));assert.equal(exit,0);
 const after=await waitFor(x=>x.marker==='after');assert.notEqual(after.pid,before.pid);
 assert.equal(fs.existsSync(path.join(root,'runtime/cloudcli')),false);
 const active=JSON.parse(fs.readFileSync(path.join(root,'active.json')));assert.equal(active.components.deps.id,depsId);assert.equal(active.components.node.id,nodeId);assert.notEqual(active.components.app.id,appId);
 assert.ok(fs.readFileSync(path.join(root,'downloads/local-patch.log'),'utf8').includes('PASS:'));
 console.log('PASS: legacy inbox applied, server restarted, inbox consumed, dependencies unchanged');
 }finally{
 launcher?.kill();
 const command=`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -like '${root.replaceAll("'","''")}\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
 const cleanEnv={...process.env};for(const k of Object.keys(cleanEnv))if(k.toLowerCase()==='psmodulepath')delete cleanEnv[k];
 require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command',command],{env:cleanEnv,windowsHide:true});
 }} )().catch(e=>{console.error(e);process.exitCode=1});
