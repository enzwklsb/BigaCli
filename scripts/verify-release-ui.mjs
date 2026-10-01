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
const expectedVersion=JSON.parse(fs.readFileSync('release.json','utf8')).version;
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
 for(let i=0;i<60;i++){if(await evaluate(`typeof BigaI18n!=="undefined" && !!document.getElementById("settingsSystemInfo")?.textContent.includes(${JSON.stringify(expectedVersion)})`))break;await sleep(200)}
 assert.ok(await evaluate(`document.getElementById("settingsSystemInfo").textContent.includes(${JSON.stringify(expectedVersion)})`),'release version visible');
 assert.ok(await evaluate(`(async()=>{for(const locale of ['zh-CN','en-US','ja-JP']){$('languageSelect').value=locale;$('languageSelect').onchange();$('settingsBtn').click();$('reportIssueBtn').click();await new Promise(r=>setTimeout(r,300));const p=$('reportIssuePane').querySelector('section').getBoundingClientRect();if(p.left<0||p.right>innerWidth||getComputedStyle($('reportIssueTitle')).fontSize!=='22px'||getComputedStyle($('reportIssueText')).fontSize!=='16px')return false;setOverlay($('reportIssuePane'),false)}return true})()`),'mobile report popup and three languages');
 assert.deepEqual(errors,[],'No startup JavaScript exceptions');
 if(process.env.BIGA_TEST_SYNC==='1'){
  assert.ok(await evaluate(`(async()=>{
   const originalApi=api;let resolveHistory;let sent=0;
   currentSession={id:'sync-test',provider:'codex'};historyState={sid:'sync-test',offset:20,loading:false};clearChat();setProcessing(false);
   const started=Date.now()-120000;
   handleEvent({kind:'chat_subscribed',sessionId:'sync-test',runStartedAt:started,isProcessing:true});
   if(activityStartedAt!==started||!processing)return false;
   api=async p=>p.includes('/messages?')?{messages:[{kind:'user',content:'question'},{kind:'text',content:'restored final',phase:'final_answer'}],hasMore:false}:{};
   handleEvent({kind:'chat_subscribed',sessionId:'sync-test',runStartedAt:started,isProcessing:false});
   await new Promise(r=>setTimeout(r,50));if(!$('chat').textContent.includes('restored final'))return false;
   const recovery={sessionIds:['sync-test'],ticket:'paused-test',reason:'',accountIds:{'sync-test':'a'},currentAccountId:'a',appointment:{at:Date.now()+600000,label:'A'}};
   renderAccountRecovery(recovery);const card=$('accountRecoveryNotice'),message=$('chat').querySelector('.msg');
   await syncCompletedHistory();if($('accountRecoveryNotice')!==card||$('chat').querySelector('.msg')!==message)return false;
   historyState.displayedMessages=null;await syncCompletedHistory();if($('accountRecoveryNotice')!==card)return false;
   renderAccountRecovery({...recovery,reason:'manual',appointment:null});if(!$('accountRecoveryNotice'))return false;
   renderAccountRecovery({...recovery,reason:'manual',currentAccountId:'b',appointment:null});if($('accountRecoveryNotice'))return false;
   renderAccountRecovery({...recovery,sessionIds:['other']});if($('accountRecoveryNotice'))return false;
   renderAccountRecovery(recovery);renderAccountRecovery({sessionIds:[]});if($('accountRecoveryNotice'))return false;
   const oldSend=sendWs;sendWs=()=>{sent++;return true};const oldWs=ws;ws={readyState:1};resumeChatSync();if(sent!==1)return false;sendWs=oldSend;ws=oldWs;
   api=async p=>p.includes('/messages?')?new Promise(r=>resolveHistory=r):{};
   const stale=syncCompletedHistory();handleEvent({kind:'chat_run_started',sessionId:'sync-test',runStartedAt:started+1});
   resolveHistory({messages:[{kind:'text',content:'STALE'}]});await stale;if($('chat').textContent.includes('STALE'))return false;
   clearChat();setProcessing(true);addThinking('working');
   const fold=processGroup.querySelector('.processFold'),animate=fold.animate;fold.animate=()=>({finished:new Promise(()=>{}),cancel(){}});
   handleEvent({kind:'text',sessionId:'sync-test',role:'assistant',phase:'final_answer',content:'delivered despite stalled animation'});
   await new Promise(r=>setTimeout(r,400+FINAL_REPLY_DELAY_MS+100));
   if(finalReplyGateActive||!$('chat').textContent.includes('delivered despite stalled animation'))return false;
   fold.animate=animate;setProcessing(false);api=originalApi;return true;
  })()`),'server elapsed time, completed reply resync, foreground subscription, stale history guard, stalled animation');
  console.log('PASS: synchronization recovery scenarios');
 }
 if(process.env.BIGA_TEST_UPDATE==='1'){
  assert.ok(await evaluate(`(async()=>{
   const original=api;let installs=0;let mock={phase:'idle',version:'0.2.5',available:{version:bigaBundledRelease.version},error:null};
   api=async(p,o)=>{if(p.startsWith('/api/bigacli/update/')){if(p.endsWith('/install')){installs++;mock.phase='downloading'}return mock}return original(p,o)};
   const pause=()=>new Promise(r=>setTimeout(r,300));
   localStorage.removeItem('bigacli-ignored-update');await bigaStatus('check');await pause();
   if(bigaBanner.classList.contains('hidden')||bigaBanner.querySelectorAll('li').length!==bigaBundledRelease.items.length)return false;
   $('bigaUpdateClose').click();await pause();await bigaStatus();if(!bigaBanner.classList.contains('hidden'))return false;
   await bigaStatus('check');await pause();$('bigaUpdateIgnore').click();await pause();bigaDismissedVersion=null;await bigaStatus();if(!bigaBanner.classList.contains('hidden'))return false;
   await bigaStatus('check');await pause();if(bigaBanner.classList.contains('hidden'))return false;
   for(const language of ['zh-CN','en-US','ja-JP']){BigaI18n.setLanguage(language);renderBigaUpdate(mock);if(!bigaBanner.querySelector('li').textContent.includes(bigaBundledRelease.items[0].text[language]))return false}
   await bigaStatus('install');await pause();if(installs!==1||!$('bigaUpdateInstall').disabled)return false;
   bigaBanner.click();await pause();await bigaStatus();if(!bigaBanner.classList.contains('hidden'))return false;
   await bigaStatus('check');await pause();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await pause();if(!bigaBanner.classList.contains('hidden'))return false;
   api=original;return true;
  })()`),'update notes, close, skip, manual reopen, three languages, close during mocked download');
  console.log('PASS: update popup interactions; no actual install requested');
 }
 console.log('PASS: packaged page loads scripts, version '+expectedVersion+', mobile settings/report popup, three languages');
}finally{ws?.close();browser.kill()}
