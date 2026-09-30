#!/usr/bin/env node
'use strict';
const path=require('node:path'),os=require('node:os');
const childProcess=require('node:child_process');
const installer=require('../npm/install.cjs');
const {version}=require('../package.json');
async function main(args=process.argv.slice(2)){
 if(args.length===1&&['--version','-v'].includes(args[0])){console.log('BigaCli npm launcher '+version);return}
 if(args.length===1&&['--help','-h'].includes(args[0])){
  console.log('Usage: bigacli\n\nFirst run downloads and verifies BigaCli for Windows x64.\nOpen http://localhost:3101 after startup. Update the app from Settings.\n--version shows the npm launcher version; the app version is in Settings.');return;
 }
 if(args.length)throw Error('Unknown option. Run bigacli --help.');
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('BigaCli currently supports Windows x64 only.');
 const base=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
 const root=path.join(base,'BigaCli');
 await installer.ensureInstalled(root,version);
 const child=childProcess.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'foreground.ps1')],{cwd:root,stdio:'inherit',windowsHide:true});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))});
 process.exitCode=code;
}
if(require.main===module)main().catch(error=>{console.error('BigaCli: '+error.message);process.exitCode=1});
module.exports={main};
