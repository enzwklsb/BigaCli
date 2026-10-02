import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const contextFile=process.env.BIGACLI_DESKTOP_CONTEXT;
if(!contextFile)throw Error('Desktop tools must be started by BigaCli');
const readers=new Set(['list_apps','list_windows','get_window_state','get_desktop_state','get_accessibility_tree','get_screen_size','get_cursor_position','zoom','verify_state','health_report']);
const writers=new Set(['launch_app','click','double_click','right_click','type_text','set_value','press_key','hotkey','scroll','drag','invoke_menu','bring_to_front','set_window_frame','kill_app']);
const names=new Set([...readers,...writers]);
const client=new Client({name:'bigacli-desktop',version:'1'},{capabilities:{}});
const server=new Server({name:'bigacli-desktop',version:'1'},{capabilities:{tools:{}},instructions:'Windows desktop tools. Read DESKTOP_GUIDE.md supplied by the host before using. Inspect exact windows before actions and verify afterward. Prefer background delivery; existing browser tools are preferred for websites.'});
let transport,connecting,catalog,closing=false,consent=null,approvalPending,ownsLock=false;
const lock=path.join(os.homedir(),'.codexlite','desktop-use.lock');
const error=message=>({isError:true,content:[{type:'text',text:message}]});
function acquire(){
 if(ownsLock)return;
 fs.mkdirSync(path.dirname(lock),{recursive:true});
 for(let i=0;i<2;i++){
  try{fs.writeFileSync(lock,String(process.pid),{flag:'wx'});ownsLock=true;return;}
  catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(lock,'utf8'));if(!pid)throw Error('Desktop control is busy');try{process.kill(pid,0);throw Error('Desktop control is in use by another BigaCli task');}catch(alive){if(alive.code!=='ESRCH')throw alive;fs.unlinkSync(lock);}}
 }
 throw Error('Desktop control is busy');
}
async function driver(){
 return connecting ||= (async()=>{
  // No installer, global PATH lookup, browser profile, or independent daemon.
  const env={...process.env,DO_NOT_TRACK:'1',CUA_DRIVER_PERMISSION_MODE:'unrestricted',CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS:'1'};
  for(const key of ['CUA_DRIVER_CAPABILITY_MANIFEST_FILE','CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED','CUA_DRIVER_POLICY_FILE','CUA_DRIVER_MANAGED_POLICY_FILE'])delete env[key];
  transport=new StdioClientTransport({command:path.join(root,'vendor/cua-driver.exe'),args:['mcp','--direct','--no-overlay'],env,stderr:'pipe'});
  transport.stderr?.on('data',data=>process.stderr.write(data));
  await client.connect(transport);
  const result=await client.listTools();
  catalog=result.tools.filter(t=>names.has(t.name)).map(t=>{
   const schema=structuredClone(t.inputSchema);
   // Captures stay inline. Arbitrary file writes are owned by Codex file tools.
   delete schema.properties?.screenshot_out_file;
   return {...t,inputSchema:schema};
  });
 })();
}
async function approve(){
 if(consent!==null)return consent;
 return approvalPending ||= server.elicitInput({mode:'form',message:'Allow desktop control for this turn? It can click and type in Windows apps outside the workspace and may bring windows to the foreground.',requestedSchema:{type:'object',properties:{allow:{type:'boolean',title:'Allow desktop control for this turn'}},required:['allow']}},{timeout:600000}).then(r=>consent=r.action==='accept'&&r.content?.allow===true);
}
server.setRequestHandler(ListToolsRequestSchema,async()=>{await driver();return {tools:catalog};});
async function call(request,extra){
 try{
  const {name,arguments:args={}}=request.params;
  if(!names.has(name))return error('Desktop tool is not exposed by this integration');
  if(Object.hasOwn(args,'screenshot_out_file'))return error('Use inline screenshots; file output is managed by Codex file permissions');
  const context=JSON.parse(fs.readFileSync(contextFile,'utf8'));
  if(writers.has(name)){
   const type=context.sandbox?.type;
   if(type!=='dangerFullAccess'){
    if(type!=='workspaceWrite')return error('Desktop changes are not allowed by the effective Codex permission profile');
    if(context.approvalPolicy==='never')return error('Desktop changes require approval, but the Codex approval policy is never');
    if(!context.approved&&!await approve())return error('Desktop control was declined for this turn');
   }
   if(closing||extra.signal.aborted||!fs.existsSync(contextFile))return error('Desktop task was stopped');
   acquire();
  }
  await driver();
  if(closing||extra.signal.aborted)return error('Desktop task was stopped');
  return await client.callTool({name,arguments:args},undefined,{signal:extra.signal,timeout:120000});
 }catch(e){return error(e.message);}
}
let tail=Promise.resolve();
server.setRequestHandler(CallToolRequestSchema,(request,extra)=>{
 const next=tail.then(()=>call(request,extra));tail=next.catch(()=>{});return next;
});
async function close(){
 if(closing)return;closing=true;clearInterval(watchdog);
 try{await client.close();}finally{
  if(ownsLock&&fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);
  await server.close();process.exit(0);
 }
}
const watchdog=setInterval(()=>{
 try{if(!fs.existsSync(contextFile))return void close();const parent=Number(process.env.BIGACLI_DESKTOP_PARENT);if(parent)process.kill(parent,0);}catch{void close();}
},250);
process.stdin.on('end',()=>void close());
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
await server.connect(new StdioServerTransport());
