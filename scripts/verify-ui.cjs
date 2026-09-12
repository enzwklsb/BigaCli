const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const version=JSON.parse(fs.readFileSync('release.json')).version;
const root=path.resolve(`build/${version}/components/app/cloudcli/dist`);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-ui-'));
const fixture=`<script>
(async()=>{let count=0;const check=(ok,name)=>{if(!ok)throw Error(name);count++};try{
clearChat();closeDrawer();
const table='| 问题 | 结论 |\\n|---|---|\\n| **模型** | Astra |\\n| 速度 | 普通 |';
addAssistant(table);check($('chat').querySelectorAll('tbody tr').length===2,'GFM table');check(!!$('chat').querySelector('td strong'),'inline formatting');
addAssistant('<img src=x onerror=alert(1)>');check(!$('chat').querySelector('img'),'HTML escaped');
addAssistant('[危险](javascript:alert(1))');check(!$('chat').querySelector('a[href^="javascript:"]'),'unsafe URL blocked');
addAssistant('[报告](C:/work/report.md)');check($('chat').querySelector('.file-link[data-file="C:/work/report.md"]'),'workspace link preserved');
renderMessageStream({itemId:'table-stream',content:'| A | B |\\n|---|---|\\n'});renderMessageStream({itemId:'table-stream',content:'| 1 | 2 |'});check($('chat').querySelectorAll('table').length===2,'stream table');
renderMessageStream({itemId:'table-stream',content:'| A | B |\\n|---|---|\\n| 1 | 2 |',phase:'final_answer'},true);check($('chat').querySelectorAll('table').length===2,'no duplicate final');
currentSession={id:'ui-test'};currentProvider='codex';currentModel='gpt-6-astra';providerModels={OPTIONS:[{value:currentModel,label:'GPT-6 Astra',serviceTiers:[{id:'priority'}],effort:{values:[{value:'low'},{value:'ultra'}]}}]};fillModelSelect();fillEffortSelect();fillSpeedSelect();
check($('speedSelect').value==='default','ordinary by default');check(sendOptions().serviceTier==='default','explicit ordinary send');
$('speedSelect').value='priority';$('speedSelect').dispatchEvent(new Event('change'));check(sendOptions().serviceTier==='priority','fast send');check($('composerModelLabel').textContent.includes('快速'),'fast visible');fillSpeedSelect();check($('speedSelect').value==='priority','session preference restored');
currentSession={id:'another-session'};fillSpeedSelect();check($('speedSelect').value==='default','new session ordinary');
providerModels.OPTIONS[0].serviceTiers=[];fillSpeedSelect();check($('speedSelect').options[1].disabled,'unsupported fast disabled');
$('modelPicker').open=true;await new Promise(r=>requestAnimationFrame(r));
check(document.documentElement.scrollWidth<=innerWidth,'no page horizontal overflow');check(getComputedStyle($('chat').querySelector('.tableScroll')).overflowX==='auto','table horizontal scroll');
document.body.dataset.testResult='PASS '+count;document.body.dataset.testError='';
}catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.message}fetch('/result',{method:'POST',body:JSON.stringify({result:document.body.dataset.testResult,error:document.body.dataset.testError})})})();
</script>`;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('</body>',fixture+'</body>');
let completed=false;
const watchdog=setTimeout(()=>{if(!completed){console.error('Browser checks timed out');process.exitCode=1;server.close()}},30000);
const server=http.createServer((req,res)=>{if(req.url==='/result'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const result=JSON.parse(body);completed=true;clearTimeout(watchdog);console.log(result);if(!result.result.startsWith('PASS'))process.exitCode=1;res.end('ok');setTimeout(()=>server.close(),3000)});return}if(req.url==='/biga-markdown.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'biga-markdown.js')))}else{res.setHeader('Content-Type','text/html');res.end(html)}});
server.listen(3194,'127.0.0.1',()=>{
 const edge=process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const p=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(temp,'profile'),'--window-size=500,900','--virtual-time-budget=2500','--dump-dom','--screenshot='+path.join(temp,'ui.png'),'http://127.0.0.1:3194'],{windowsHide:true});
 p.stdout.resume();p.stderr.resume();p.on('error',e=>{console.error(e);process.exitCode=1;clearTimeout(watchdog);server.close()});console.log('Screenshot: '+path.join(temp,'ui.png'));
});
