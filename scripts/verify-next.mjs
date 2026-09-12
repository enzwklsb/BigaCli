// Real HTTP/WebSocket smoke using the built app and a fresh database, away from 3001/3101.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.resolve('cloudcli/package.json'));
const WebSocket=require('ws');
const version=JSON.parse(fs.readFileSync('release.json')).version;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-next-'));
const app=path.join(temp,'app');
fs.cpSync(`build/${version}/components/app/cloudcli`,app,{recursive:true});
fs.symlinkSync(path.resolve('cloudcli/node_modules'),path.join(app,'node_modules'),'junction');
const cwd=path.join(temp,'project');fs.mkdirSync(cwd);
const server=fork(path.join(app,'dist-server/server/index.js'),[],{cwd:app,env:{...process.env,SERVER_PORT:'3193',HOST:'127.0.0.1',DATABASE_PATH:path.join(temp,'auth.db'),BIGACLI_VERSION:version},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let ws;
const base='http://127.0.0.1:3193';
async function api(url,body){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data.data??data}
try{
 let healthy=false;for(let i=0;i<60;i++){try{healthy=(await api('/health')).bigaVersion===version;if(healthy)break}catch{}await new Promise(r=>setTimeout(r,500))}assert.ok(healthy,logs.slice(-6000));
 const user=(await api('/api/auth/user')).user;assert.equal(user.username,'bigacli');
 assert.equal((await(await fetch(base+'/api/auth/user',{headers:{Authorization:'Bearer expired-browser-token'}})).json()).user.id,user.id);
 await api('/api/projects?skipSync=1&sessionsLimit=1');
 const created=await api('/api/providers/sessions',{provider:'codex',projectPath:cwd,initialMessage:'BigaCli release validation'});
 const sid=created.sessionId??created.session?.id??created.id;assert.ok(sid,JSON.stringify(created));
 const catalog=(await api('/api/providers/codex/models?sessionId='+sid)).models;
 assert.ok(catalog.OPTIONS.some(m=>m.value==='gpt-6-astra'));assert.ok(catalog.OPTIONS.find(m=>m.value==='gpt-6-astra').serviceTiers.some(t=>t.id==='priority'));
 console.log('PASS: empty database opens without login, stale browser token ignored, projects and Astra catalog accessible');
 const service=name=>import(pathToFileURL(path.join(app,'dist-server/server/modules/providers/services',name+'.service.js')));
 const {buildCodexEnv}=await service('codex-account');
 assert.throws(()=>buildCodexEnv('biga-invalid-account-id'));
 console.log('PASS: invalid account rejected without fallback');
 ws=new WebSocket('ws://127.0.0.1:3193/ws');await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 const collected=[];
 async function turn(tier){return new Promise((resolve,reject)=>{
  const rows=[];const timer=setTimeout(()=>finish(new Error('Turn timed out')),150000);
  function finish(error){clearTimeout(timer);ws.off('message',receive);error?reject(error):resolve(rows)}
  function receive(raw){const m=JSON.parse(raw);if(m.sessionId&&m.sessionId!==sid)return;rows.push(m);collected.push(m);if(m.kind==='error'||m.type==='protocol_error')finish(new Error(JSON.stringify(m)));if(m.kind==='complete'){if(m.exitCode!==0)return finish(new Error(JSON.stringify(m)));assert.ok(rows.some(r=>r.kind==='stream_delta'));finish()}}
  ws.on('message',receive);ws.send(JSON.stringify({type:'chat.send',sessionId:sid,content:'仅回复 BigaCli_OK，不要调用工具，不要读取文件。',options:{model:'gpt-6-astra',effort:'low',serviceTier:tier,permissionMode:'default'}}));
 })}
 await turn('default');console.log('PASS: no-token WebSocket and real Astra streamed turn');
 const history=await api('/api/providers/sessions/'+sid+'/messages?limit=10');assert.ok(JSON.stringify(history).includes('BigaCli_OK'));
 console.log('PASS: persisted history readable without web login');
}finally{ws?.close();server.kill();}
