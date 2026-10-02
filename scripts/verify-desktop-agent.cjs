const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(repo,'release.json'))).version;
const app=path.join(repo,'build',version,'components/app/cloudcli'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-desktop-agent-'));
process.env.DATABASE_PATH=path.join(temp,'auth.db');
const service=name=>import(pathToFileURL(path.join(app,'dist-server/server/modules/providers/services',name+'.service.js')));
(async()=>{try{
 const {streamCodexTurn,codexStreamPermissions}=await service('codex-stream'),{buildCodexEnv}=await service('codex-account'),{readCodexModelCatalog}=await service('codex-models');
 const catalog=await readCodexModelCatalog('default');let approvals=0,completed=false,calls=[],text='';
 fs.writeFileSync(path.join(temp,'agent-desktop-test.txt'),'BigaCli Agent desktop verification');
 const prompt=`This is an authorized integration test. Use bigacli-desktop MCP to launch Windows Notepad with ${path.join(temp,'agent-desktop-test.txt')}. Read its exact window using get_window_state and confirm the text "BigaCli Agent desktop verification" from the returned screenshot/tree. Then close ONLY that newly launched Notepad using kill_app. Do not modify anything, use shell automation, or touch existing user windows. If desktop approval is requested, wait for the host. Finish with DESKTOP_AGENT_OK if all succeeded. Read the supplied desktop guide first.`;
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),180000);
 try{for await(const event of streamCodexTurn(prompt,{workingDirectory:temp,permissionMode:':workspace',model:catalog.DEFAULT,env:buildCodexEnv('default'),sessionId:'desktop-agent-verification'},abort.signal)){
  if(event.type==='normalized'&&event.message?.kind==='permission_request'){
   assert.equal(event.message.toolName,'desktop_control','Only desktop control is authorized by this test');approvals++;console.log('Native Codex → BigaCli desktop approval');codexStreamPermissions.resolve(event.message.requestId,{allow:true});
  }
  if(event.type==='item.completed'&&event.item?.type==='mcp_tool_call'){calls.push(event.item.tool);console.log('MCP',event.item.tool,JSON.stringify(event.item.error||'').slice(0,200));}
  if(event.type==='normalized'&&event.message?.kind==='stream_delta'&&event.message.messageKind==='text')text+=event.message.content;
  if(event.type==='turn.failed')throw Error(event.error?.message||'Agent failed');
  if(event.type==='turn.completed')completed=true;
 }}finally{clearTimeout(timer);}
 fs.writeFileSync(path.join(repo,'../artifacts/cua-probe/agent-result.json'),JSON.stringify({completed,approvals,calls,text},null,2));
 assert(completed);assert.equal(approvals,1);for(const name of ['launch_app','get_window_state','kill_app'])assert(calls.includes(name),name);assert(text.includes('DESKTOP_AGENT_OK'));
 console.log('PASS real Codex Agent, native workspace permission, existing approval bridge, desktop actions and screenshot result');
}finally{const db=await import(pathToFileURL(path.join(app,'dist-server/server/modules/database/index.js')));db.getConnection().close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
