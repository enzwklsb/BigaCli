'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {execFile}=require('node:child_process');
function validateInstall(root,expectedVersion){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'active.json'),'utf8').replace(/^\uFEFF/,''));
 if(expectedVersion&&manifest.version!==expectedVersion)throw Error('The downloaded package has an unexpected version.');
 for(const name of ['app','deps','node']){
  if(!/^[a-f0-9]{64}$/.test(manifest.components?.[name]?.id||''))throw Error('Invalid installed component: '+name);
 }
 const component=name=>path.join(root,'store',name,manifest.components[name].id);
 for(const file of [path.join(root,'foreground.ps1'),path.join(root,'local-start.cjs'),path.join(root,'launcher.cjs'),path.join(component('node'),'node.exe'),path.join(component('app'),'cloudcli','dist-server','server','index.js'),path.join(component('deps'),'node_modules','@openai','codex-sdk','package.json')]){
  if(!fs.existsSync(file))throw Error('Installation is incomplete: '+file);
 }
 return manifest;
}
async function ensureInstalled(root,version){
 // The application updater owns this directory. Never replace an existing installation.
 if(fs.existsSync(root)){validateInstall(root);return root}
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid package version.');
 fs.mkdirSync(path.dirname(root),{recursive:true});
 const staging=fs.mkdtempSync(path.join(path.dirname(root),'.bigacli-install-'));
 try{
  const base='https://github.com/enzwklsb/BigaCli/releases/download/v'+version+'/';
  console.log('Downloading BigaCli '+version+' (first run only)…');
  const response=await fetch(base+'SHA256SUMS.txt',{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Could not read release checksums (HTTP '+response.status+'). The matching GitHub release must be published first.');
  const expected=(await response.text()).split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts[1]==='BigaCli-win-x64.zip')?.[0];
  if(!/^[a-f0-9]{64}$/i.test(expected||''))throw Error('Missing SHA-256 for the Windows package.');
  const download=await fetch(base+'BigaCli-win-x64.zip',{signal:AbortSignal.timeout(600000)});
  if(!download.ok||!download.body)throw Error('Download failed (HTTP '+download.status+'). Run bigacli again to retry.');
  const hash=createHash('sha256'),zip=path.join(staging,'package.zip');
  await pipeline(Readable.fromWeb(download.body),new Transform({transform(chunk,encoding,done){hash.update(chunk);done(null,chunk)}}),fs.createWriteStream(zip));
  if(hash.digest('hex')!==expected.toLowerCase())throw Error('Download checksum mismatch. Run bigacli again to retry.');
  console.log('Verified download. Installing…');
  const unpacked=path.join(staging,'app');fs.mkdirSync(unpacked);
  await new Promise((resolve,reject)=>execFile('tar.exe',['-xf',zip,'-C',unpacked],{windowsHide:true},error=>error?reject(error):resolve()));
  validateInstall(unpacked,version);
  // Another first launch may have completed while this one was downloading.
  if(fs.existsSync(root))validateInstall(root);else fs.renameSync(unpacked,root);
  console.log('Installed in '+root);
  return root;
 }finally{
  // Only remove the temporary directory created by this call, never user data.
  const resolved=path.resolve(staging),parent=path.resolve(path.dirname(root));
  if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('.bigacli-install-'))throw Error('Unexpected installation staging directory.');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
module.exports={ensureInstalled,validateInstall};
