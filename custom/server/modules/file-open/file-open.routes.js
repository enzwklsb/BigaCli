import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),router=express.Router();
router.post('/',async(req,res)=>{
 try{
  let origin;try{origin=new URL(req.headers.origin)}catch{}
  if(!origin||origin.host!==req.headers.host)return res.sendStatus(403);
  const file=req.body?.path;
  if(process.platform!=='win32')return res.status(400).json({error:'此功能仅支持 Windows。'});
  if(typeof file!=='string'||! /^[a-z]:[\\/]/i.test(file)||file.includes('\0'))return res.status(400).json({error:'需要本机文件的绝对路径。'});
  if(!(await fs.stat(file)).isFile())return res.status(400).json({error:'请选择文件。'});
  const literal=value=>"'"+value.replaceAll("'","''")+"'";
  const ps1=path.extname(file).toLowerCase()==='.ps1';
  // User-initiated OS open. Literal file argument, no elevation or policy override.
  const script=`$ErrorActionPreference='Stop';$shell=New-Object -ComObject Shell.Application;`+(ps1?
   `$shell.ShellExecute('powershell.exe',${literal('-NoProfile -NoExit -File "'+file+'"')},${literal(path.dirname(file))},'open',1)`:
   `$shell.ShellExecute(${literal(file)},'',${literal(path.dirname(file))},'open',1)`);
  await run(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});
  res.json({success:true});
 }catch(error){res.status(400).json({error:error.code==='ENOENT'?'文件不存在。':'无法在电脑上打开，请检查电脑端提示。'})}
});
export default router;
