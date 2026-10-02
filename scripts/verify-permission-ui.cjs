const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../../demo/video-tools/node_modules/playwright');
const repo=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(repo,'release.json'))).version,dist=path.join(repo,'build',version,'components/app/cloudcli/dist');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('http://127.0.0.1:3101/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(dist,'index.html'),'utf8')}));
 for(const name of ['i18n.js','biga-markdown.js','preview-ui.js'])await page.route('**/'+name+'*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(dist,name),'utf8')}));
 await page.route('**/api/**',r=>r.fulfill({json:{}}));await page.routeWebSocket('**',()=>{});
 await page.goto('http://127.0.0.1:3101/');
 const result=await page.evaluate(async()=>{
  currentSession={id:'permission-test',provider:'codex'};currentProvider='codex';
  api=async url=>url.includes('/permissions?')?{data:{data:[{id:':read-only',allowed:true},{id:':workspace',allowed:true},{id:':danger-full-access',allowed:true},{id:'future-profile',allowed:true,description:'Native profile description'},{id:'managed-denied',allowed:false}],defaultId:':workspace'}}:url.endsWith('/capabilities')?{data:{providers:[]}}:{data:{}};
  localStorage.setItem('permissionMode-permission-test','bypassPermissions');await loadProviderControls();syncPanelChoices();
  const migrated=$('permissionSelect').value===':danger-full-access';
  const future=$('permissionChoices').querySelector('[data-mode="future-profile"]');future.click();
  const dynamic=sendOptions().permissionMode==='future-profile';
  const denied=$('permissionChoices').querySelector('[data-mode="managed-denied"]').disabled;
  localStorage.setItem('permissionMode-permission-test','');await loadProviderControls();syncPanelChoices();
  const nativeOnly=$('permissionSelect').options.length===5&&![...$('permissionSelect').options].some(o=>!o.value);
  const configuredDefault=$('permissionSelect').value===':workspace';
  setComposerPicker($('permissionPicker'),true);await new Promise(r=>setTimeout(r,200));
  const icon=$('permissionChoices').querySelector('.permissionIcon'),info=$('permissionChoices').querySelector('.permissionInfo');
  const a=icon.getBoundingClientRect(),b=info.getBoundingClientRect();
  return {migrated,dynamic,denied,nativeOnly,configuredDefault,centered:Math.abs(a.top+a.height/2-b.top-b.height/2)<1,description:future.textContent.includes('Native profile description')};
 });for(const [key,value] of Object.entries(result))assert.equal(value,true,key);console.log('PASS permission UI: '+JSON.stringify(result));
 await page.evaluate(()=>{codexPermissionProfiles.data=codexPermissionProfiles.data.slice(0,3);fillPermissionSelect();syncPanelChoices()});
 await page.screenshot({path:path.resolve(repo,'../artifacts/permission-panel-mobile.png')});
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
