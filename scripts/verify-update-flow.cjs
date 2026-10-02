const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{spawn}=require('node:child_process');
const u=require('../update-files.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-update-flow-')),port=39128,id=n=>String(n).repeat(64);
const old={version:'1.0.0',components:{}},next={version:'1.2.0',components:{},fileIndex:{}},base='https://github.com/enzwklsb/BigaCli/releases/download/v1.2.0/';
for(const k of ['app','deps','node','boot']){old.components[k]={id:id(1)};next.components[k]={id:id(k==='app'?2:1),sha256:id(k==='app'?2:1),url:base+k+'.zip',size:10000}}
const source=`const http=require('node:http');let n=0;const pending=new Map();process.on('message',m=>{if(m.type==='bigacli-prepare-switch')process.send({type:'bigacli-idle',id:m.id,idle:true});if(m.type==='bigacli-update-result'){const r=pending.get(m.id);if(r){r.end(JSON.stringify(m.value));pending.delete(m.id)}}});http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');if(q.url==='/health')return r.end(JSON.stringify({bigaVersion:process.env.BIGACLI_VERSION}));const key=String(++n);pending.set(key,r);process.send({type:'bigacli-update',id:key,action:q.url.slice(1)})}).listen(process.env.SERVER_PORT,'127.0.0.1');`;
const server='cloudcli/dist-server/server/index.js',app=u.component(root,old,'app');fs.mkdirSync(path.dirname(path.join(app,server)),{recursive:true});fs.writeFileSync(path.join(app,server),source);
fs.mkdirSync(path.join(u.component(root,old,'deps'),'node_modules'),{recursive:true});fs.writeFileSync(path.join(u.component(root,old,'deps'),'package.json'),'{}');
fs.mkdirSync(u.component(root,old,'node'),{recursive:true});fs.copyFileSync(process.execPath,path.join(u.component(root,old,'node'),'node.exe'));
for(const name of u.bootNames)fs.copyFileSync(path.resolve(name),path.join(root,name));
const index={format:1,version:next.version,files:[]},payloads={};
function add(component,p,bytes,download=false){const zipped=download?zlib.deflateRawSync(bytes):Buffer.alloc(1),offset=index.files.length*100;
 index.files.push({component,path:p,size:bytes.length,sha256:u.hash(bytes),offset,compressedSize:zipped.length,method:download?8:0});if(download)payloads[offset]=zipped.toString('base64')}
add('app',server,Buffer.from(source+'\n// new version'),true);add('deps','package.json',Buffer.from('{}'));add('node','node.exe',fs.readFileSync(process.execPath));
for(const name of u.bootNames)add('boot',name,fs.readFileSync(path.join(root,name)));
const body=Buffer.from(JSON.stringify(index));next.fileIndex={url:base+'files.json',sha256:u.hash(body),size:body.length};
fs.writeFileSync(path.join(root,'active.json'),JSON.stringify(old));fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({next,index,payloads}));
const hook=path.join(root,'network.cjs');fs.writeFileSync(hook,`const fs=require('fs'),path=require('path'),f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'))),native=fetch;global.fetch=async(url,options={})=>{if(!String(url).startsWith('https://github.com/'))return native(url,options);if(String(url).endsWith('release.json'))return new Response(JSON.stringify(f.next));if(String(url).endsWith('files.json'))return new Response(JSON.stringify(f.index));const m=/bytes=(\\d+)-(\\d+)/.exec(options.headers.Range);fs.appendFileSync(path.join(__dirname,'requests.txt'),m[0]+'\\n');return new Response(Buffer.from(f.payloads[m[1]],'base64'),{status:206,headers:{'Content-Range':'bytes '+m[1]+'-'+m[2]+'/10000'}})};`);
const env={...process.env,HOME:root,USERPROFILE:root,BIGACLI_PORT:String(port)},pause=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function api(action){return (await fetch('http://127.0.0.1:'+port+'/'+action)).json()}
(async()=>{try{
 child=spawn(path.join(u.component(root,old,'node'),'node.exe'),['--require',hook,path.join(root,'launcher.cjs')],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});child.stderr.on('data',b=>process.stderr.write(b));
 for(let i=0;i<60;i++){try{if((await api('health')).bigaVersion===old.version)break}catch{}await pause(200)}
 assert.equal((await api('check')).available.version,next.version);await api('install');
 let state;for(let i=0;i<150;i++){await pause(200);try{state=await api('status');if(state.installError)throw Error(state.installError);if(state.version===next.version&&state.phase==='idle')break}catch(e){if(!String(e).includes('fetch failed'))throw e}}
 assert.equal(state.version,next.version);assert.equal(state.phase,'idle');assert.equal(fs.readFileSync(path.join(root,'requests.txt'),'utf8').trim().split('\n').length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'previous.json'))).version,old.version);
 console.log('PASS: actual launcher check → range download → idle reservation → restart → healthy, one changed file, previous retained');
}finally{if(child?.connected)child.send({type:'shutdown'});if(child&&child.exitCode===null)await new Promise(r=>child.once('exit',r));u.removeTree(root,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
