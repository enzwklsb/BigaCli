'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const roots=['app','deps','node','boot'];
const bootNames=['launcher.cjs','local-start.cjs','foreground.ps1','start.cmd','update-files.cjs'];
function inside(base,relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)))throw Error('Invalid update path: '+relative);
 const target=path.resolve(base,relative);if(!target.startsWith(path.resolve(base)+path.sep))throw Error('Update path escapes installation');
 let cursor=base;for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('Update path crosses a link: '+relative)}
 return target;
}
function removeTree(target,base){
 const resolved=path.resolve(target),parent=path.resolve(base);
 if(!resolved.startsWith(parent+path.sep))throw Error('Cleanup outside managed directory');
 // Node removes junctions themselves, never their targets.
 fs.rmSync(resolved,{recursive:true,force:true});
}
function component(root,m,k){return path.join(root,'store',k,m.components[k].id)}
function prune(base,files){
 if(!fs.existsSync(base))return;
 const keep=new Set();for(const f of files){const parts=f.path.split('/');while(parts.length){keep.add(parts.join('/'));parts.pop()}}
 function visit(folder,relative=''){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const rel=relative?relative+'/'+entry.name:entry.name,target=path.join(folder,entry.name);
  if(!keep.has(rel)){removeTree(target,base);continue}
  if(entry.isSymbolicLink())throw Error('Unexpected link in update staging: '+rel);
  if(entry.isDirectory())visit(target,rel);
 }}visit(base);
}
function matches(file,f){try{const s=fs.lstatSync(file);return s.isFile()&&s.size===f.size&&hash(fs.readFileSync(file))===f.sha256}catch(e){if(['ENOENT','ENOTDIR'].includes(e.code))return false;throw e}}
function validateIndex(index,m){
 if(index.version!==m.version||index.format!==1||!Array.isArray(index.files))throw Error('Invalid update file index');
 const seen=new Set();for(const f of index.files){
  if(!roots.includes(f.component)||!Number.isSafeInteger(f.size)||f.size<0||!Number.isSafeInteger(f.offset)||f.offset<0||!Number.isSafeInteger(f.compressedSize)||f.compressedSize<0||!['0','8'].includes(String(f.method))||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid update file');
  inside(path.resolve('validation'),f.path);
  if(!m.components?.[f.component]||f.offset+f.compressedSize>m.components[f.component].size)throw Error('File range exceeds component');
  if(f.component==='boot'&&!bootNames.includes(f.path))throw Error('Unexpected launcher file');
  const key=f.component+'/'+f.path.toLowerCase();if(seen.has(key))throw Error('Conflicting update paths');seen.add(key);
 }
 for(const key of seen){const parts=key.split('/');while(parts.length>2){parts.pop();if(seen.has(parts.join('/')))throw Error('File/directory conflict')}}
 for(const k of roots){if(!m.components[k]||!index.files.some(f=>f.component===k))throw Error('Missing component: '+k)}
}
function trustedUrl(url){if(!url?.startsWith('https://github.com/enzwklsb/BigaCli/releases/download/'))throw Error('Invalid update source');return url}
async function readLimited(response,limit){
 if(!response.body)throw Error('Empty update response');const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>limit)throw Error('Update response exceeded expected size');chunks.push(chunk)}return Buffer.concat(chunks);
}
async function loadIndex(m,root){
 if(!m.fileIndex)throw Error('This release does not provide file-level updates. No full package was downloaded.');
 if(!/^[a-f0-9]{64}$/.test(m.fileIndex.sha256)||!Number.isSafeInteger(m.fileIndex.size)||m.fileIndex.size<1)throw Error('Invalid index metadata');
 const cache=root?path.join(root,'downloads/file-update',m.fileIndex.sha256,'index.gz'):null;
 let b=cache&&fs.existsSync(cache)?fs.readFileSync(cache):null;
 const indexCached=!!b&&hash(b)===m.fileIndex.sha256;
 if(!indexCached){const r=await fetch(trustedUrl(m.fileIndex.url),{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Update index HTTP '+r.status);b=await readLimited(r,m.fileIndex.size);if(hash(b)!==m.fileIndex.sha256)throw Error('Update index checksum mismatch')}
 const index=JSON.parse(m.fileIndex.encoding==='gzip'?zlib.gunzipSync(b,{maxOutputLength:128*1024*1024}):b);
 if(index.fileIndexes){index.files=[];for(const k of roots){
  const ref=index.fileIndexes[k];if(!ref||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.size)||ref.size<1)throw Error('Invalid component index');
  const local=root?path.join(root,'downloads/file-index',ref.sha256+'.gz'):null;
  let bytes=local&&fs.existsSync(local)?fs.readFileSync(local):null;
  const cached=!!bytes&&hash(bytes)===ref.sha256;
  if(!cached){const r=await fetch(trustedUrl(ref.url),{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('File index HTTP '+r.status);bytes=await readLimited(r,ref.size);if(hash(bytes)!==ref.sha256)throw Error('File index checksum mismatch')}
  const entries=JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:128*1024*1024}));if(!Array.isArray(entries)||entries.some(f=>f.component!==k))throw Error('Invalid component index contents');index.files.push(...entries);
  if(local&&!cached){fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,bytes)}
 }}
 validateIndex(index,m);if(cache&&!indexCached){fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,b)}return index;
}
async function downloadFile(c,f){
 if(!f.compressedSize){if(f.size!==0||hash(Buffer.alloc(0))!==f.sha256)throw Error('Invalid empty file');return Buffer.alloc(0)}
 const end=f.offset+f.compressedSize-1;
 const response=await fetch(trustedUrl(c.url),{headers:{Range:`bytes=${f.offset}-${end}`},signal:AbortSignal.timeout(120000)});
 if(response.status!==206||response.headers.get('content-range')!==`bytes ${f.offset}-${end}/${c.size}`){await response.body?.cancel();throw Error('Server did not honor the file range; full-package download refused')}
 const compressed=await readLimited(response,f.compressedSize);if(compressed.length!==f.compressedSize)throw Error('Incomplete file download');
 const b=f.method===8?zlib.inflateRawSync(compressed,{maxOutputLength:Math.max(1,f.size)}):compressed;
 if(b.length!==f.size||hash(b)!==f.sha256)throw Error('Downloaded file checksum mismatch: '+f.path);return b;
}
function readPrevious(root){try{return JSON.parse(fs.readFileSync(path.join(root,'previous.json')))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function prepare(root,current,target,index,onProgress=()=>{}){
 validateIndex(index,target);
 const previous=readPrevious(root),cacheRoot=path.join(root,'downloads','file-update'),stage=path.join(cacheRoot,target.fileIndex.sha256);
 fs.mkdirSync(stage,{recursive:true});
 const unchanged=new Set(['app','deps','node'].filter(k=>current.components[k]?.id===target.components[k]?.id&&fs.existsSync(component(root,current,k))));
 for(const k of roots){const folder=path.join(stage,k);if(unchanged.has(k)){if(fs.existsSync(folder))removeTree(folder,stage)}else prune(folder,index.files.filter(f=>f.component===k))}
 const plan=[],missingHashes=new Set();let downloadBytes=0,extraBytes=0;
 const reusable=new Map(),observed=new Map(),seenPaths=new Set(),sizes=new Set(index.files.filter(f=>!unchanged.has(f.component)).map(f=>f.size));let scanned=0;
 async function remember(file){if(seenPaths.has(file))return;seenPaths.add(file);const s=fs.lstatSync(file);if(s.isSymbolicLink())return;
  if(++scanned%64===0)await new Promise(resolve=>setImmediate(resolve));
  if(s.isDirectory()){for(const name of fs.readdirSync(file))await remember(path.join(file,name));return}
  if(s.isFile()&&sizes.has(s.size)){const digest=hash(fs.readFileSync(file));observed.set(file,digest);if(!reusable.has(digest))reusable.set(digest,file)}
 }
 for(const m of [current,previous,target]){for(const k of ['app','deps','node']){if(unchanged.has(k)||!m?.components?.[k])continue;const base=component(root,m,k);if(fs.existsSync(base))await remember(base)}}
 for(const name of bootNames){const file=path.join(root,name);if(fs.existsSync(file))await remember(file)}
 // Reuse useful completed files even when the target release changed.
 for(const name of fs.readdirSync(cacheRoot)){if(/^[a-f0-9]{64}$/.test(name))for(const k of roots){const folder=path.join(cacheRoot,name,k);if(fs.existsSync(folder))await remember(folder)}}
 for(const f of index.files){
  if(unchanged.has(f.component))continue;
  // A verified target component already in store needs no second staged tree.
  if(f.component!=='boot'&&observed.get(path.join(component(root,target,f.component),f.path))===f.sha256)continue;
  const dest=inside(path.join(stage,f.component),f.path);let source=null;
  if(matches(dest,f)){plan.push({f,dest,ready:true});continue}
  source=reusable.get(f.sha256)||null;
  if(!source&&!missingHashes.has(f.sha256)){missingHashes.add(f.sha256);downloadBytes+=f.compressedSize;extraBytes+=f.size+f.compressedSize}
  plan.push({f,dest,source});
  if(plan.length%64===0)await new Promise(resolve=>setImmediate(resolve));
 }
 // Inability to query space is not a prohibition on updating.
 let free=null;try{const s=fs.statfsSync(root);free=s.bavail*s.bsize}catch{}
 if(free!==null&&free<extraBytes)throw Error(`Insufficient disk space: need approximately ${extraBytes} bytes, available ${free}`);
 let downloadedBytes=0;onProgress({downloadBytes,downloadedBytes});
 let position=0,failed=null;const fetched=new Map();
 await Promise.allSettled(Array.from({length:4},async()=>{try{while(!failed&&position<plan.length){const item=plan[position++],{f,dest,source}=item;if(item.ready)continue;
  fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(dest))fs.unlinkSync(dest);
  if(source){try{fs.linkSync(source,dest)}catch(e){if(!['EXDEV','ENOTSUP','EPERM','EACCES'].includes(e.code))throw e;fs.copyFileSync(source,dest)}continue}
  if(fetched.has(f.sha256)){const existing=await fetched.get(f.sha256);fs.linkSync(existing,dest);continue}
  const download=(async()=>{const b=await downloadFile(target.components[f.component],f),tmp=dest+'.partial-'+crypto.randomUUID();
   try{fs.writeFileSync(tmp,b);fs.renameSync(tmp,dest)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
   downloadedBytes+=f.compressedSize;onProgress({downloadBytes,downloadedBytes});return dest})();
  fetched.set(f.sha256,download);await download;
 }}catch(error){failed=error;throw error}}));
 if(failed)throw failed;
 for(const name of fs.readdirSync(cacheRoot)){if(name!==target.fileIndex.sha256&&/^[a-f0-9]{64}$/.test(name))try{removeTree(path.join(cacheRoot,name),cacheRoot)}catch{}}
 return {stage,index,bootChanged:index.files.some(f=>f.component==='boot'&&!matches(path.join(root,f.path),f))};
}
function promote(root,target,index,stage){
 // Called after the running application has stopped. Repair only incorrect files in an existing component.
 for(const k of ['app','deps','node']){
  const dest=component(root,target,k),src=path.join(stage,k);
  // prepare already verified every file when no repairs were staged.
  if(fs.existsSync(dest)&&!fs.existsSync(src))continue;
  if(fs.existsSync(dest)){
   const required=index.files.filter(f=>f.component===k);
   for(const f of required){const file=inside(dest,f.path);if(!matches(file,f))replaceFile(inside(src,f.path),file)}
   prune(dest,required);
  }else{fs.mkdirSync(path.dirname(dest),{recursive:true});fs.renameSync(src,dest)}
 }
}
function cleanup(root,current,previous){
 const warnings=[];
 for(const k of ['app','deps','node']){const base=path.join(root,'store',k);if(!fs.existsSync(base))continue;
  const keep=new Set([current?.components[k]?.id,previous?.components[k]?.id]);
  for(const name of fs.readdirSync(base)){if(!/^[a-f0-9]{64}$/.test(name)||keep.has(name))continue;try{removeTree(path.join(base,name),base)}catch(e){warnings.push(e.message)}}
 }
 const indexDir=path.join(root,'downloads/file-index'),keepIndexes=new Set([current,previous].flatMap(m=>Object.values(m?.fileIndexes||{}).map(ref=>ref.sha256+'.gz')));
 if(fs.existsSync(indexDir)&&keepIndexes.size)for(const name of fs.readdirSync(indexDir)){if(/^[a-f0-9]{64}\.gz$/.test(name)&&!keepIndexes.has(name))try{fs.unlinkSync(path.join(indexDir,name))}catch(e){warnings.push(e.message)}}
 const downloads=path.join(root,'downloads');
 if(fs.existsSync(downloads))for(const name of fs.readdirSync(downloads)){
  if(!/^(?:unpack-[a-f0-9-]{36}|(?:app|deps|node)-[a-f0-9]{64}\.zip)$/.test(name))continue;
  try{removeTree(path.join(downloads,name),downloads)}catch(e){warnings.push(e.message)}
 }
 return warnings;
}
function replaceFile(source,dest){fs.mkdirSync(path.dirname(dest),{recursive:true});const temp=dest+'.new';fs.copyFileSync(source,temp);fs.renameSync(temp,dest)}
module.exports={hash,inside,removeTree,component,matches,validateIndex,loadIndex,downloadFile,prepare,promote,cleanup,readPrevious,replaceFile,bootNames};
