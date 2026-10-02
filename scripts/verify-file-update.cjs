const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const u=require('../update-files.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-files-'));
const originalFetch=global.fetch;
const id=n=>String(n).repeat(64),old={version:'1.0.0',components:{}},next={version:'3.0.0',components:{},fileIndex:{sha256:id(9)}};
for(const k of ['app','deps','node','boot']){old.components[k]={id:id(1)};next.components[k]={id:id(2),url:'https://github.com/enzwklsb/BigaCli/releases/download/v3/'+k+'.zip',size:10000}}
const index={format:1,version:next.version,files:[]},payloads=new Map();let offset=100,requested=[];
function add(k,p,text,local){const b=Buffer.from(text),compressed=zlib.deflateRawSync(b),f={component:k,path:p,size:b.length,sha256:u.hash(b),offset,compressedSize:compressed.length,method:8};offset+=compressed.length;index.files.push(f);payloads.set(f.offset,compressed);if(local!==undefined){const target=path.join(k==='boot'?root:u.component(root,old,k),p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,local)}return f}
add('app','keep.js','keep','keep');add('app','changed.js','new','local modification');add('app','added.js','added');
add('deps','codex.exe','already upgraded','already upgraded');add('node','node.exe','node','node');
for(const name of u.bootNames)add('boot',name,'boot '+name,'boot '+name);
const obsolete=path.join(u.component(root,old,'app'),'removed.js');fs.writeFileSync(obsolete,'old');
global.fetch=async(url,options)=>{const match=/bytes=(\d+)-(\d+)/.exec(options.headers.Range),start=Number(match[1]);requested.push(start);return new Response(payloads.get(start),{status:206,headers:{'Content-Range':`bytes ${match[1]}-${match[2]}/10000`}})};
(async()=>{try{
 const p=await u.prepare(root,old,next,index);u.promote(root,next,index,p.stage);assert.equal(requested.length,2,'only changed and added files fetched across versions');
 assert.equal(fs.existsSync(path.join(u.component(root,next,'app'),'removed.js')),false);
 const oldKeep=path.join(u.component(root,old,'app'),'keep.js'),newKeep=path.join(u.component(root,next,'app'),'keep.js');
 assert.equal(fs.statSync(oldKeep).ino,fs.statSync(newKeep).ino,'unchanged content shares disk');
 const replacement=path.join(root,'replacement');fs.writeFileSync(replacement,'new keep');u.replaceFile(replacement,newKeep);assert.equal(fs.readFileSync(oldKeep,'utf8'),'keep','replacement does not mutate previous');
 // Corrupt one file only: no component-wide download, and verified retry output is reused.
 fs.unlinkSync(path.join(p.stage,'boot',u.bootNames[0]));const f=index.files.find(x=>x.component==='boot');
 fs.writeFileSync(path.join(root,f.path),'broken');requested=[];
 // Completed component remains authoritative in this test; restore deliberate local test edit.
 fs.unlinkSync(newKeep);fs.linkSync(oldKeep,newKeep);
 await u.prepare(root,old,next,index);assert.deepEqual(requested,[f.offset]);
 global.fetch=async()=>new Response('entire package',{status:200});await assert.rejects(()=>u.downloadFile(next.components.app,index.files[1]),/full-package download refused/);
 const invalid={...index,files:[...index.files,{...index.files[0],path:'../escape'}]};assert.throws(()=>u.validateIndex(invalid,next));
 const ancient=path.join(root,'store/app',id(3));fs.mkdirSync(ancient,{recursive:true});u.cleanup(root,next,old);assert.equal(fs.existsSync(ancient),false);assert.ok(fs.existsSync(oldKeep));
 console.log('PASS: cross-version minimal download, local pre-upgrade reuse, deletion, hardlink isolation, retry, range refusal, boundaries, two-version cleanup');
}finally{global.fetch=originalFetch;u.removeTree(root,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
