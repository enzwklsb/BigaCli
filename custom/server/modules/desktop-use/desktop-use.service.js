import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
export function createDesktopContext(){
 if(process.platform!=='win32'||process.arch!=='x64')return null;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'biga-desktop-'));
 const file=path.join(directory,'permissions.json');
 let current;
 const save=data=>{current=data;fs.writeFileSync(file,JSON.stringify(data),{mode:0o600});};
 save({sandbox:{type:'readOnly'},approvalPolicy:'never'});
 return {
  config:{command:process.execPath,args:[path.join(root,'desktop-mcp.js')],env:{BIGACLI_DESKTOP_CONTEXT:file,BIGACLI_DESKTOP_PARENT:String(process.pid)},startup_timeout_sec:30,tool_timeout_sec:600},
  instructions:`Desktop tools are provided by bigacli-desktop. Before using them, read ${path.join(root,'DESKTOP_GUIDE.md')}. The host enforces the actual Codex permission profile. Use the existing browser connector for web pages.`,
  update:result=>save({sandbox:result.sandbox,approvalPolicy:result.approvalPolicy}),
  access:()=>current.sandbox?.type,
  approved:()=>current.approved===true,
  canAsk:()=>current.approvalPolicy!=='never',
  grant:()=>save({...current,approved:true}),
  close:()=>fs.rmSync(directory,{recursive:true,force:true}),
 };
}
