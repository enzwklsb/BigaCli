const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const u=require('../update-files.cjs'),base=fs.mkdtempSync(path.join(os.tmpdir(),'biga-update-failures-')),nativeFetch=fetch,nativeStat=fs.statfsSync,nativeWrite=fs.writeFileSync;
const id=n=>String(n).repeat(64),pause=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
function fixture(name){const root=path.join(base,name);fs.mkdirSync(root);const current={version:'1.0.0',components:{}},target={version:'2.0.0',components:{},fileIndex:{sha256:id(9)}},index={format:1,version:'2.0.0',files:[]},payloads=new Map();let offset=0;
 for(const k of ['app','deps','node','boot']){current.components[k]={id:id(1)};target.components[k]={id:id(k==='app'?2:1),url:'https://github.com/enzwklsb/BigaCli/releases/download/v2/'+k+'.zip',size:20000000}}
 function file(k,p,bytes,existing=false){const compressed=zlib.deflateRawSync(bytes),f={component:k,path:p,size:bytes.length,sha256:u.hash(bytes),offset,compressedSize:compressed.length,method:8};offset+=compressed.length;index.files.push(f);payloads.set(f.offset,compressed);if(existing){const dest=path.join(k==='boot'?root:u.component(root,current,k),p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes)}}
 file('app','unchanged.txt',Buffer.from('unchanged'),true);for(let i=0;i<5;i++)file('app','new-'+i+'.bin',crypto.randomBytes(256*1024));
 file('deps','node_modules/keep.txt',Buffer.from('dependency'),true);file('node','node.exe',Buffer.from('node'),true);for(const name of u.bootNames)file('boot',name,Buffer.from(name),true);
 fs.writeFileSync(path.join(root,'active.json'),JSON.stringify(current));return {root,current,target,index,payloads};}
async function test(name,run){const f=fixture(name);const active=fs.readFileSync(path.join(f.root,'active.json'),'utf8');let requests=[];
 global.fetch=async(url,opts)=>{const m=/bytes=(\d+)-(\d+)/.exec(opts.headers.Range);requests.push(+m[1]);return new Response(f.payloads.get(+m[1]),{status:206,headers:{'Content-Range':`bytes ${m[1]}-${m[2]}/20000000`}})};
 try{await run(f,requests);assert.equal(fs.readFileSync(path.join(f.root,'active.json'),'utf8'),active);results.push(name);console.log('PASS '+name)}finally{global.fetch=nativeFetch;fs.statfsSync=nativeStat;fs.writeFileSync=nativeWrite}}
(async()=>{try{
 await test('insufficient-space-before-download',async(f,requests)=>{fs.statfsSync=()=>({bavail:0,bsize:4096});await assert.rejects(()=>u.prepare(f.root,f.current,f.target,f.index),/Insufficient disk space/);assert.equal(requests.length,0)});
 await test('disk-full-stops-writes-and-retries-only-missing',async(f,requests)=>{
  let fail=true,writes=0;fs.writeFileSync=function(file,...args){if(String(file).includes('.partial-')){writes++;if(fail&&writes===2){const e=Error('disk full');e.code='ENOSPC';throw e}}return nativeWrite.call(this,file,...args)};
  await assert.rejects(()=>u.prepare(f.root,f.current,f.target,f.index),/disk full/);const stopped=[writes,requests.length];await pause(700);assert.deepEqual([writes,requests.length],stopped,'No continuing work after failure');
  const stage=path.join(f.root,'downloads/file-update',id(9),'app'),ready=fs.readdirSync(stage).filter(n=>n.startsWith('new-')).length;assert(!fs.readdirSync(stage).some(n=>n.includes('.partial-')));
  fail=false;const before=requests.length;await u.prepare(f.root,f.current,f.target,f.index);assert.equal(requests.length-before,5-ready);results.push({readyRetained:ready,downloadsOnRetry:requests.length-before});
 });
 await test('checksum-failure-keeps-old-installation',async f=>{global.fetch=async(url,opts)=>{const m=/bytes=(\d+)-(\d+)/.exec(opts.headers.Range),b=Buffer.from(f.payloads.get(+m[1]));b[b.length-1]^=255;return new Response(b,{status:206,headers:{'Content-Range':`bytes ${m[1]}-${m[2]}/20000000`}})};await assert.rejects(()=>u.prepare(f.root,f.current,f.target,f.index));assert.equal(fs.readFileSync(path.join(u.component(f.root,f.current,'app'),'unchanged.txt'),'utf8'),'unchanged')});
 await test('no-full-zip-fallback',async f=>{let canceled=false;global.fetch=async()=>new Response(new ReadableStream({cancel(){canceled=true}}),{status:200});await assert.rejects(()=>u.prepare(f.root,f.current,f.target,f.index),/full-package download refused/);assert(canceled)});
 fs.writeFileSync(path.resolve(__dirname,'../../artifacts/update-audit/failures.json'),JSON.stringify(results,null,2));
}finally{global.fetch=nativeFetch;fs.statfsSync=nativeStat;fs.writeFileSync=nativeWrite;u.removeTree(base,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
