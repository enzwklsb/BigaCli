// Build-time only. Users receive the pinned files through the normal file updater.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const desktopVersion='0.32.0';
export const desktopVendor=fileURLToPath(new URL('../vendor/cua-driver/',import.meta.url));
const exeHash='d2477595e8b5ae850d119b48c8bbe5c16a1f229f3e99e706bd84622c2d7d98ae';
export async function prepareDesktop(){
 const exe=path.join(desktopVendor,'cua-driver.exe');
 if(fs.existsSync(exe)&&createHash('sha256').update(fs.readFileSync(exe)).digest('hex')===exeHash&&fs.existsSync(path.join(desktopVendor,'skills/SKILL.md')))return;
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'biga-cua-build-'));
 async function archive(name,hash){
  const response=await fetch(`https://github.com/trycua/cua/releases/download/cua-driver-rs-v${desktopVersion}/${name}`,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(`Desktop driver download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Desktop driver archive checksum mismatch');
  const file=path.join(stage,name);fs.writeFileSync(file,bytes);execFileSync('tar.exe',['-xf',file,'-C',stage],{windowsHide:true});
 }
 try{
  await archive(`cua-driver-rs-${desktopVersion}-windows-x86_64.zip`,'6d70b45c8c901db773010dd720c8bb9d58c59bb301e9891c58ca1d3860e75652');
  await archive(`cua-driver-rs-v${desktopVersion}-skills.tar.gz`,'2351af55f9ccbd63efd45246c8ec8ea00bdca546ee3b75504f2e2cbb9b55ab2f');
  fs.mkdirSync(desktopVendor,{recursive:true});
  for(const name of ['cua-driver.exe','LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(stage,`cua-driver-rs-${desktopVersion}-windows-x86_64`,name),path.join(desktopVendor,name));
  fs.cpSync(path.join(stage,`cua-driver-rs-v${desktopVersion}-skills`),path.join(desktopVendor,'skills'),{recursive:true});
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
