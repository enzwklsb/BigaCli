const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),install=path.resolve(repo,'../BigaCli-local'),active=JSON.parse(fs.readFileSync(path.join(install,'active.json')));
const app=path.join(repo,'build',JSON.parse(fs.readFileSync(path.join(repo,'release.json'))).version,'components/app/cloudcli');
const link=path.join(app,'node_modules');if(!fs.existsSync(link))fs.symlinkSync(path.join(install,'store/deps',active.components.deps.id,'node_modules'),link,'junction');
const req=createRequire(path.join(app,'package.json')),{Client}=req('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=req('@modelcontextprotocol/sdk/client/stdio.js'),{ElicitRequestSchema}=req('@modelcontextprotocol/sdk/types.js');
const root=path.join(app,'dist-server/server/modules/desktop-use'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-desktop-test-'));
let asks=0,pid,windowId,full;
async function connect(type,allow=false,policy='on-request'){
 const file=path.join(temp,Math.random()+'.json');fs.writeFileSync(file,JSON.stringify({sandbox:{type},approvalPolicy:policy}));
 const client=new Client({name:'desktop-verification',version:'1'},{capabilities:{elicitation:{form:{}}}});
 client.setRequestHandler(ElicitRequestSchema,async()=>{asks++;return {action:allow?'accept':'decline',content:allow?{allow:true}:undefined};});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'desktop-mcp.js')],env:{...process.env,BIGACLI_DESKTOP_CONTEXT:file,BIGACLI_DESKTOP_PARENT:String(process.pid)},stderr:'pipe'});
 transport.stderr?.on('data',b=>process.stderr.write(b));await client.connect(transport);await client.listTools();
 return {client,file,transport,call:(name,args={})=>client.callTool({name,arguments:args}),close:async()=>{await client.close();fs.rmSync(file,{force:true});await new Promise(r=>setTimeout(r,300));}};
}
function ok(r){assert(!r.isError,JSON.stringify(r));return r.structuredContent;}
(async()=>{try{
 const readonly=await connect('readOnly');
 try{ok(await readonly.call('list_windows'));assert((await readonly.call('launch_app',{name:'notepad'})).isError);assert((await readonly.call('get_desktop_state',{screenshot_out_file:path.join(temp,'forbidden.png')})).isError);assert(!fs.existsSync(path.join(temp,'forbidden.png')));}finally{await readonly.close();}
 console.log('PASS read-only: observation works, mutation and capture file writes denied');
 const denied=await connect('workspaceWrite');
 try{assert((await denied.call('launch_app',{name:'notepad'})).isError);assert.equal(asks,1);assert((await denied.call('launch_app',{name:'notepad'})).isError);assert.equal(asks,1);}finally{await denied.close();}
 console.log('PASS workspace decline, no repeated approval in same turn');
 const never=await connect('workspaceWrite',true,'never');
 try{assert((await never.call('launch_app',{name:'notepad'})).isError);assert.equal(asks,1);}finally{await never.close();}
 const allowed=await connect('workspaceWrite',true);
 const file=path.join(temp,'desktop-test.txt');fs.writeFileSync(file,'BigaCli desktop test\r\n');
 try{
  const launch=await allowed.call('launch_app',{path:'C:\\Windows\\System32\\notepad.exe',additional_arguments:[file]});ok(launch);fs.writeFileSync(path.join(temp,'launch.json'),JSON.stringify(launch));
  console.log('LAUNCH',JSON.stringify(launch).slice(0,900));assert.equal(asks,2);
 }finally{await allowed.close();}
 full=await connect('dangerFullAccess');
 const windows=ok(await full.call('list_windows'));fs.writeFileSync(path.join(temp,'windows.json'),JSON.stringify(windows));
 const rows=windows._legacy_windows||windows.windows;const w=rows.find(w=>w.title.includes('desktop-test'));assert(w,'New test Notepad window');pid=w.pid;windowId=w.window_id;
 const snapshot=await full.call('get_window_state',{pid,window_id:windowId,max_elements:60});const state=ok(snapshot);
 fs.writeFileSync(path.join(temp,'snapshot.json'),JSON.stringify({...snapshot,content:snapshot.content.filter(c=>c.type!=='image')}));
 const edit=state.elements.find(e=>e.role==='Edit'||e.role?.toLowerCase().includes('edit'));assert(edit,'Notepad edit control');
 console.log('EDIT',JSON.stringify(edit).slice(0,650));
 const typed=await full.call('type_text',{pid,window_id:windowId,element_token:edit.element_token,text:'Cua desktop input verified 123',delivery_mode:'background'});ok(typed);console.log('TYPE',JSON.stringify(typed));
 let after=await full.call('get_window_state',{pid,window_id:windowId,max_elements:60});ok(after);
 if(!JSON.stringify(after.structuredContent).includes('Cua desktop input verified 123')){
  console.log('Background text did not reach classic Notepad; verifying explicitly authorized foreground delivery');
  const fresh=after.structuredContent.elements.find(e=>e.role==='Edit');
  const clicked=await full.call('click',{pid,window_id:windowId,x:100,y:100,delivery_mode:'foreground'});ok(clicked);
  const set=await full.call('type_text',{pid,window_id:windowId,text:'Cua desktop input verified 123',delivery_mode:'foreground'});ok(set);console.log('FOREGROUND',JSON.stringify(set));
  after=await full.call('get_window_state',{pid,window_id:windowId,max_elements:60});ok(after);
 }
 assert(JSON.stringify(after.structuredContent).includes('Cua desktop input verified 123'),'UIA read-back');
 const image=after.content.find(c=>c.type==='image');assert(image,'MCP image response');fs.writeFileSync(path.join(repo,'../artifacts/cua-probe/notepad.png'),Buffer.from(image.data,'base64'));
 const busy=await connect('dangerFullAccess');try{assert((await busy.call('type_text',{pid,window_id:windowId,text:'must not write'})).isError);}finally{await busy.close();}
 console.log('PASS workspace grant; full-access Notepad click/input, UIA read-back, screenshot and desktop exclusion');
 // Closing the test document without saving avoids any user document changes.
 ok(await full.call('kill_app',{pid}));pid=null;
 if(process.argv.includes('--calculator')){
  let rows=ok(await full.call('list_windows'))._legacy_windows;let win=rows.find(w=>w.title==='计算器');
  assert(process.argv.includes('--resume-calculator')||!win,'Do not touch an existing calculator');
  if(!win){ok(await full.call('launch_app',{aumid:'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'}));await new Promise(r=>setTimeout(r,700));rows=ok(await full.call('list_windows'))._legacy_windows;win=rows.find(w=>w.title==='计算器');}
  assert(win);const calcPid=win.pid;
  const state=ok(await full.call('get_window_state',{pid:calcPid,window_id:win.window_id,max_elements:150}));
  console.log('CALC ELEMENTS',JSON.stringify(state.elements.map(e=>({label:e.label,role:e.role,value:e.value,token:e.element_token}))));
  const seven=state.elements.find(e=>e.role==='Button'&&/^(七|7|Seven)$/i.test(e.label));assert(seven,'Calculator 7 button');
  const clicked=await full.call('click',{pid:calcPid,window_id:win.window_id,element_token:seven.element_token,delivery_mode:'background'});ok(clicked);console.log('BACKGROUND CLICK',JSON.stringify(clicked));
  const result=await full.call('get_window_state',{pid:calcPid,window_id:win.window_id,max_elements:150});ok(result);assert(result.structuredContent.elements.some(e=>/显示|Display|结果/i.test(e.label)&&/7/.test(e.label+' '+e.value)),'Calculator display changed to 7');
  const image=result.content.find(c=>c.type==='image');if(image)fs.writeFileSync(path.join(repo,'../artifacts/cua-probe/calculator.png'),Buffer.from(image.data,'base64'));
  console.log('PASS real Calculator background click and display read-back');const closeButton=result.structuredContent.elements.find(e=>e.role==='Button'&&/^(关闭|Close)/.test(e.label));if(closeButton)ok(await full.call('click',{pid:calcPid,window_id:win.window_id,element_token:closeButton.element_token,delivery_mode:'background'}));
 }
 const childPid=full.transport.pid;fs.unlinkSync(full.file);await new Promise(r=>setTimeout(r,1500));assert.throws(()=>process.kill(childPid,0));
 console.log('PASS revoked context closes MCP process');
}finally{if(full)await full.close();if(pid)require('node:child_process').execFileSync('taskkill.exe',['/PID',String(pid),'/F'],{windowsHide:true});fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
