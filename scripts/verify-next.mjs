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
let token,ws;
const base='http://127.0.0.1:3193';
async function api(url,body){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data.data??data}
try{
 let healthy=false;for(let i=0;i<60;i++){try{healthy=(await api('/health')).bigaVersion===version;if(healthy)break}catch{}await new Promise(r=>setTimeout(r,500))}assert.ok(healthy,logs.slice(-6000));
 token=(await api('/api/auth/register',{username:'next-release-smoke',password:crypto.randomUUID()})).token;assert.ok(token);
 const created=await api('/api/providers/sessions',{provider:'codex',projectPath:cwd,initialMessage:'BigaCli release validation'});
 const sid=created.sessionId??created.session?.id??created.id;assert.ok(sid,JSON.stringify(created));
 const catalog=(await api('/api/providers/codex/models?sessionId='+sid)).models;
 assert.ok(catalog.OPTIONS.some(m=>m.value==='gpt-6-astra'));assert.ok(catalog.OPTIONS.find(m=>m.value==='gpt-6-astra').serviceTiers.some(t=>t.id==='priority'));
 console.log('PASS: fresh server, authenticated dynamic Astra catalog and native speed capabilities');
 const service=name=>import(pathToFileURL(path.join(app,'dist-server/server/modules/providers/services',name+'.service.js')));
 const {listCodexAccounts,buildCodexEnv}=await service('codex-account');
 const {readCodexAccountInfo}=await service('codex-account-info');
 const {readCodexModels}=await service('codex-models');
 const {readCodexRateLimits}=await service('codex-rate-limits');
 for(const account of listCodexAccounts()){
  if(!(await readCodexAccountInfo(account.id)).account){console.log('Unauthenticated account: '+account.id);continue}
  for(let i=0;i<3;i++){assert.ok((await readCodexAccountInfo(account.id)).account);assert.ok((await readCodexModels(account.id)).some(model=>model.model==='gpt-6-astra'))}
  const [info,models,quota]=await Promise.all([readCodexAccountInfo(account.id),readCodexModels(account.id),readCodexRateLimits(8000,account.id)]);
  assert.ok(info.account);assert.ok(models.length);assert.ok(quota);
  console.log('PASS: authenticated '+account.id+', successive and concurrent account/model/quota reads');
 }
 assert.throws(()=>buildCodexEnv('biga-invalid-account-id'));
 console.log('PASS: invalid account rejected without fallback');
 ws=new WebSocket('ws://127.0.0.1:3193/ws?token='+encodeURIComponent(token));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 const collected=[];
 async function turn(tier){return new Promise((resolve,reject)=>{
  const rows=[];const timer=setTimeout(()=>finish(new Error('Turn timed out')),150000);
  function finish(error){clearTimeout(timer);ws.off('message',receive);error?reject(error):resolve(rows)}
  function receive(raw){const m=JSON.parse(raw);if(m.sessionId&&m.sessionId!==sid)return;rows.push(m);collected.push(m);if(m.kind==='error'||m.type==='protocol_error')finish(new Error(JSON.stringify(m)));if(m.kind==='complete'){if(m.exitCode!==0)return finish(new Error(JSON.stringify(m)));assert.ok(rows.some(r=>r.kind==='stream_delta'));finish()}}
  ws.on('message',receive);ws.send(JSON.stringify({type:'chat.send',sessionId:sid,content:'仅回复 BigaCli_OK，不要调用工具，不要读取文件。',options:{model:'gpt-6-astra',effort:'low',serviceTier:tier,permissionMode:'default'}}));
 })}
 for(const tier of ['default','priority','default']){await turn(tier);console.log('PASS: real Astra streamed turn '+tier);await new Promise(r=>setTimeout(r,300))}
 const history=await api('/api/providers/sessions/'+sid+'/messages?limit=10');assert.ok(JSON.stringify(history).includes('BigaCli_OK'));
 console.log('PASS: resume fast → ordinary, persisted history after real sends');
}finally{ws?.close();server.kill();}
