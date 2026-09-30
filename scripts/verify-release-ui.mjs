// Run against the isolated packaged server created by smoke.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve('cloudcli/package.json')),WebSocket=require('ws');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'biga-release-browser-'));
const port=3197,url=process.argv[2]||'http://127.0.0.1:3191';
const browser=spawn(process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
 '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
 '--user-data-dir='+profile,'--remote-debugging-port='+port,'--window-size=500,900','about:blank',
],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 let target;for(let i=0;i<60;i++){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');if(target)break}catch{}await sleep(200)}
 assert.ok(target,'Browser debugging endpoint');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 let next=0;const pending=new Map(),errors=[];
 ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text)});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
 await rpc('Runtime.enable');await rpc('Page.enable');await rpc('Page.navigate',{url});
 for(let i=0;i<60;i++){if(await evaluate('typeof BigaI18n!=="undefined" && !!document.getElementById("settingsSystemInfo")?.textContent.includes("1.0.0")'))break;await sleep(200)}
 assert.ok(await evaluate('document.getElementById("settingsSystemInfo").textContent.includes("1.0.0")'),'release version visible');
 assert.ok(await evaluate(`(async()=>{for(const locale of ['zh-CN','en-US','ja-JP']){$('languageSelect').value=locale;$('languageSelect').onchange();$('settingsBtn').click();$('reportIssueBtn').click();await new Promise(r=>setTimeout(r,300));const p=$('reportIssuePane').querySelector('section').getBoundingClientRect();if(p.left<0||p.right>innerWidth||getComputedStyle($('reportIssueTitle')).fontSize!=='22px'||getComputedStyle($('reportIssueText')).fontSize!=='16px')return false;setOverlay($('reportIssuePane'),false)}return true})()`),'mobile report popup and three languages');
 assert.deepEqual(errors,[],'No startup JavaScript exceptions');
 console.log('PASS: packaged page loads scripts, version 1.0.0, mobile settings/report popup, three languages');
}finally{ws?.close();browser.kill()}
