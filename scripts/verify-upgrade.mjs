// Run an untouched public baseline on 3192 and install the actual draft components.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const baseline=path.resolve(process.argv[2]);
const version=JSON.parse(fs.readFileSync('release.json')).version;
const assets=path.resolve(`build/${version}/assets`),target=JSON.parse(fs.readFileSync(path.join(assets,'release.json')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-upgrade-'));
execFileSync('tar.exe',['-xf',baseline,'-C',root],{windowsHide:true});
const initial=JSON.parse(fs.readFileSync(path.join(root,'active.json')));
assert.equal(initial.version,'0.2.0');assert.equal(initial.components.node.id,target.components.node.id);
const downloads=path.join(root,'requested.txt');
const home=path.join(root,'test-home');fs.mkdirSync(home);
const p=spawn(path.join(root,'store/node',initial.components.node.id,'node.exe'),['--import',pathToFileURL(path.resolve('scripts/verify-upgrade-hook.mjs')).href,path.join(root,'launcher.cjs')],{cwd:root,env:{...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex'),BIGACLI_PORT:'3192',DATABASE_PATH:path.join(root,'test.db'),BIGA_TEST_ASSETS:assets,BIGA_TEST_DOWNLOAD_LOG:downloads},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
p.stderr.on('data',b=>process.stderr.write(b));
let token;
async function api(url,body){const r=await fetch('http://127.0.0.1:3192'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data.data??data}
try{
 let healthy=false;for(let i=0;i<60;i++){try{healthy=(await api('/health')).bigaVersion===initial.version;if(healthy)break}catch{}await new Promise(r=>setTimeout(r,500))}assert.ok(healthy);
 token=(await api('/api/auth/register',{username:'upgrade-user',password:crypto.randomUUID()})).token;assert.ok(token);
 const user=(await api('/api/auth/user')).user;
 const project=path.join(root,'project');fs.mkdirSync(project);
 const created=await api('/api/providers/sessions',{provider:'codex',projectPath:project,initialMessage:'upgrade retains this session'});
 const sid=created.sessionId??created.session?.id??created.id;assert.ok(sid);
 assert.equal((await api('/api/bigacli/update/check',{})).available.version,version);
 assert.equal((await api('/api/bigacli/update/install',{})).phase,'downloading');
 console.log('Started real '+initial.version+' → '+version+' component install');
 let done=false,lastPhase='';
 for(let i=0;i<300;i++){
  await new Promise(r=>setTimeout(r,1000));
  try{const state=await api('/api/bigacli/update/status');if(state.error)throw Error(state.error);if(state.phase!==lastPhase){console.log('Upgrade: '+state.phase);lastPhase=state.phase}if(state.version===version&&state.phase==='idle'){done=true;break}}
  catch(e){if(!String(e).includes('fetch failed'))throw e}
 }
 assert.ok(done,'Upgrade did not complete');assert.equal((await api('/health')).bigaVersion,version);
 token=null;
 assert.equal((await api('/api/auth/user')).user.id,user.id);
 assert.equal((await api('/api/auth/user')).user.username,user.username);
 const retained=await api('/api/providers/sessions/'+sid);assert.ok(JSON.stringify(retained).includes(sid));
 const accounts=await api('/api/providers/codex/accounts');assert.ok(!JSON.stringify(accounts).includes('@'),'isolated account store');
 assert.deepEqual(fs.readFileSync(downloads,'utf8').trim().split('\n'),['app']);
 assert.equal(fs.readdirSync(path.join(root,'store/node')).length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'previous.json'))).version,initial.version);
 console.log('PASS: 0.2.0 → '+version+', app-only download, original user/session retained, update status and accounts accessible without login');
}finally{if(p.connected)p.send({type:'shutdown'})}
