// Runs the distributed package, using a fresh application database; prints no credentials.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const root=path.resolve(process.argv[2]),m=JSON.parse(fs.readFileSync(path.join(root,'active.json'))),port=process.env.BIGACLI_TEST_PORT||'3191';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bigacli-smoke-'));
const p=spawn(path.join(root,'store/node',m.components.node.id,'node.exe'),[path.join(root,'launcher.cjs')],{cwd:root,env:{...process.env,BIGACLI_PORT:port,DATABASE_PATH:path.join(temp,'auth.db')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let errors='';p.stderr.on('data',b=>errors+=b);p.stdout.resume();
const url='http://127.0.0.1:'+port;
try{
 let health;for(let i=0;i<60;i++){try{health=await(await fetch(url+'/health')).json();if(health.bigaVersion===m.version)break}catch{}await new Promise(r=>setTimeout(r,500))}
 assert.equal(health?.bigaVersion,m.version,errors||'Server did not start');
 const user=await(await fetch(url+'/api/auth/user')).json();
 assert.equal(user.user.username,'bigacli','Internal user was not initialized');
 const status=await(await fetch(url+'/api/bigacli/update/status')).json();assert.equal(status.version,m.version);
 const html=await(await fetch(url)).text();assert.ok(html.includes('bigaStatus'));assert.ok(html.includes('BigaCli '+m.version));
 assert.ok(!html.includes('id="loginBtn"'));
 console.log('PASS: packaged startup, automatic internal user, no-token update status, page update entry, no web login form');
}finally{
 // Tell the supervisor to terminate its child through a dedicated shutdown signal.
 if(p.connected)p.send({type:'shutdown'});
}
