const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../demo/video-tools/node_modules/playwright');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'release.json'))).version,dist=path.join(root,'build',version,'components/app/cloudcli/dist');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('http://127.0.0.1:3101/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(dist,'index.html'),'utf8')}));
 for(const name of ['i18n.js','biga-markdown.js','preview-ui.js'])await page.route('**/'+name+'*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(dist,name),'utf8')}));
 await page.routeWebSocket('**',()=>{});await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:3101/');await page.waitForTimeout(700);
 const result=await page.evaluate(async()=>{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));api=async()=>({});loadProjects=()=>{};
  currentSession={id:'isolated-test',provider:'codex'};currentProvider='codex';clearChat();setProcessing(true);
  const send=m=>receiveChatEvent({sessionId:'isolated-test',...m});
  send({kind:'stream_delta',itemId:'thought',messageKind:'thinking',content:'测试思考过程的连续播放。'.repeat(20)});
  await pause(400);const during=processGroup.querySelector('.processActivity').hidden;
  await pause(800);const justEnded=processGroup.querySelector('.processActivity').hidden;
  await pause(1000);const stalled=!processGroup.querySelector('.processActivity').hidden;
  send({kind:'stream_delta',itemId:'thought',messageKind:'thinking',content:'恢复播放'.repeat(10)});await pause(250);const resumed=processGroup.querySelector('.processActivity').hidden;
  drainStreamPlayback();setProcessing(false,'已停止响应');await pause(1150);const stopped=[...$('chat').querySelectorAll('.processActivity')].every(n=>n.hidden);
  $('modelChoices').innerHTML=Array.from({length:50},(_,i)=>`<button>Model ${i}</button>`).join('');setComposerPicker($('modelPicker'),true);await pause(200);
  const list=$('modelChoices'),effort=$('effortChoices'),fast=$('fastModeToggle'),before=[effort.getBoundingClientRect().top,fast.getBoundingClientRect().top];
  list.scrollTop=500;const after=[effort.getBoundingClientRect().top,fast.getBoundingClientRect().top];
  return {during,justEnded,stalled,resumed,stopped,scrolls:list.scrollHeight>list.clientHeight&&list.scrollTop>0,fixed:JSON.stringify(before)===JSON.stringify(after),overflow:getComputedStyle(list).overscrollBehaviorY};
 });for(const key of ['during','justEnded','stalled','resumed','stopped','scrolls','fixed'])assert.equal(result[key],true,key);assert.equal(result.overflow,'contain');console.log('PASS chat UI: '+JSON.stringify(result));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
