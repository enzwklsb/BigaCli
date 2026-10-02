const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'..'),install=path.resolve(repo,'../BigaCli-local'),active=JSON.parse(fs.readFileSync(path.join(install,'active.json'))),version=JSON.parse(fs.readFileSync(path.join(repo,'release.json'))).version;
const app=path.join(repo,'build',version,'components/app/cloudcli'),link=path.join(app,'node_modules'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-permissions-'));
process.env.DATABASE_PATH=path.join(temp,'auth.db');
fs.symlinkSync(path.join(install,'store/deps',active.components.deps.id,'node_modules'),link,'junction');
const service=name=>import(pathToFileURL(path.join(app,'dist-server/server/modules/providers/services',name+'.service.js')));
(async()=>{try{
 const {readCodexPermissionProfiles,nativePermissionId}=await service('codex-permissions');
 const profiles=await readCodexPermissionProfiles('default',temp);
 assert(profiles.data.some(p=>p.id===':danger-full-access'&&p.allowed));
 assert.equal(nativePermissionId('bypassPermissions'),':danger-full-access');assert.equal(nativePermissionId('new-native-profile'),'new-native-profile');
 console.log('PASS actual CLI permissionProfile/list, allowed flag, old selection migration and native IDs');
 if(process.argv.includes('--agent')){
  const {streamCodexTurn}=await service('codex-stream'),{buildCodexEnv}=await service('codex-account'),{readCodexModelCatalog}=await service('codex-models');
  const catalog=await readCodexModelCatalog('default');let completed=false,transcript;
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
  try{for await(const event of streamCodexTurn('Reply with OK only. Do not call tools.',{workingDirectory:temp,permissionMode:':danger-full-access',model:catalog.DEFAULT,env:buildCodexEnv('default'),sessionId:'permission-verification',onThreadReady:r=>{transcript=r.path}},abort.signal)){
   if(event.type==='turn.failed')throw Error(event.error?.message||'Agent failed');
   if(event.type==='turn.completed')completed=true;
  }}finally{clearTimeout(timer)}
  assert(completed,'Minimal Agent turn must complete');
  const rows=fs.readFileSync(transcript,'utf8').trim().split('\n').map(JSON.parse),context=rows.findLast(r=>r.type==='turn_context')?.payload;
  assert.equal(context?.sandbox_policy?.type,'danger-full-access');
  console.log('PASS actual stream adapter Agent turn; native transcript confirms danger-full-access; approval='+context.approval_policy);
 }
}finally{const db=await import(pathToFileURL(path.join(app,'dist-server/server/modules/database/index.js')));db.getConnection().close();fs.unlinkSync(link);require('../update-files.cjs').removeTree(temp,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
