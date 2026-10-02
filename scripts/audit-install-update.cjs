// Real released ZIP + real launcher/server; only GitHub transport is redirected locally.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process');
const {Readable}=require('node:stream');
const u=require('../update-files.cjs'),{buildIndex}=require('./index-release.cjs'),repo=path.resolve(__dirname,'..');
const JSZip=require(path.join(repo,'build/1.1.0/components/deps/node_modules/jszip'));
const work=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'biga-update-audit-')),root=path.join(work,'install'),assets=path.join(work,'assets');
if(path.dirname(work)!==os.tmpdir()||!path.basename(work).startsWith('biga-update-audit-'))throw Error('Invalid audit directory');
const reportDir=path.resolve(repo,'../artifacts/update-audit');fs.mkdirSync(reportDir,{recursive:true});fs.mkdirSync(assets,{recursive:true});
const sourceAssets=path.join(repo,'build/1.1.0/assets'),events=[],requests=[],started=Date.now(),port=39129;
const elapsed=()=>Date.now()-started,wait=ms=>new Promise(r=>setTimeout(r,ms));
function snapshot(base){let logical=0,allocated=0,count=0,links=0;const seen=new Set();
 function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),s=fs.lstatSync(p,{bigint:true});if(s.isSymbolicLink()){links++;continue}if(s.isDirectory()){walk(p);continue}count++;logical+=Number(s.size);const key=s.dev+':'+s.ino;if(!seen.has(key)){seen.add(key);allocated+=Number(s.blocks)*512}}}walk(base);return {files:count,logical,allocated,unique:seen.size,links};}
function record(stage,base=root,details={}){const row={ms:elapsed(),stage,...snapshot(base),...details};events.push(row);console.log(JSON.stringify(row));return row;}
const originalFetch=fetch;let child,server;
(async()=>{try{
 const zipPath=path.join(sourceAssets,'BigaCli-win-x64.zip'),zipSize=fs.statSync(zipPath).size;
 const expected=fs.readFileSync(path.join(sourceAssets,'SHA256SUMS.txt'),'utf8').split(/\r?\n/).find(s=>s.endsWith('  BigaCli-win-x64.zip')).split(' ')[0];
 assert.equal(u.hash(fs.readFileSync(zipPath)),expected,'Existing official ZIP checksum');
 global.fetch=async url=>{
  if(String(url).endsWith('SHA256SUMS.txt'))return new Response(expected+'  BigaCli-win-x64.zip');
  assert(String(url).endsWith('BigaCli-win-x64.zip'));requests.push({phase:'first-install',bytes:zipSize});
  return new Response(Readable.toWeb(fs.createReadStream(zipPath)));
 };
 const originalRename=fs.renameSync;
 fs.renameSync=function(from,to){if(to===root)record('install-extracted-before-promotion',work,{zipBytes:zipSize});return originalRename.apply(this,arguments)};
 const {ensureInstalled}=require('../npm/install.cjs');
 try{record('install-start',work);await ensureInstalled(root,'1.1.0');record('install-finished');const count=requests.length;await ensureInstalled(root,'1.1.1');assert.equal(requests.length,count,'Existing npm install must not download again');}finally{fs.renameSync=originalRename;global.fetch=originalFetch}
 const old=JSON.parse(fs.readFileSync(path.join(root,'active.json')));
 // This is the new-updater test baseline, not a claim that the old public launcher migrates itself.
 for(const name of u.bootNames)fs.copyFileSync(path.join(repo,name),path.join(root,name));
 fs.writeFileSync(path.join(u.component(root,old,'app'),'audit-obsolete.txt'),'deleted in target');
 const archive=await JSZip.loadAsync(fs.readFileSync(path.join(sourceAssets,'app-win-x64.zip')));
 archive.file('audit-added.txt','New file\n');archive.file('version.json',JSON.stringify({version:'1.1.1'}));
 const appBytes=await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'});fs.writeFileSync(path.join(assets,'app-win-x64.zip'),appBytes);
 for(const k of ['deps','node'])if(!fs.existsSync(path.join(assets,k+'-win-x64.zip')))fs.linkSync(path.join(sourceAssets,k+'-win-x64.zip'),path.join(assets,k+'-win-x64.zip'));
 const next=structuredClone(old);next.version='1.1.1';for(const k of ['app','deps','node'])next.components[k].url=next.components[k].url.replace('/v1.1.0/','/v1.1.1/');
 Object.assign(next.components.app,{id:u.hash(appBytes),sha256:u.hash(appBytes),size:appBytes.length});
 fs.writeFileSync(path.join(assets,'release.json'),JSON.stringify(next));const target=buildIndex(assets,repo);
 record('update-baseline');
 server=http.createServer((req,res)=>{
  const name=path.basename(new URL(req.url,'http://localhost').pathname),file=path.join(assets,name);
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return}
  const size=fs.statSync(file).size,range=req.headers.range;
  if(range){const match=/^bytes=(\d+)-(\d+)$/.exec(range);if(!match){res.writeHead(400);res.end();return}const start=+match[1],end=+match[2];requests.push({ms:elapsed(),phase:'update',file:name,range,bytes:end-start+1});res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res)}
  else{requests.push({ms:elapsed(),phase:'metadata',file:name,bytes:size});res.writeHead(200,{'Content-Length':size});fs.createReadStream(file).pipe(res)}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const fixturePort=server.address().port;
 const auditLog=path.join(work,'worker.jsonl'),hook=path.join(work,'hook.cjs');
 fs.writeFileSync(auditLog,'');
 fs.writeFileSync(hook,`const fs=require('node:fs'),path=require('node:path'),native=fetch;global.fetch=(url,opts)=>native(String(url).startsWith('https://github.com/enzwklsb/BigaCli/')?'http://127.0.0.1:${fixturePort}/'+path.basename(new URL(url).pathname):url,opts);
const root=${JSON.stringify(root)},log=${JSON.stringify(auditLog)},start=${started};const write=fs.writeFileSync,append=fs.appendFileSync,link=fs.linkSync,rename=fs.renameSync;
function event(v){append(log,JSON.stringify({ms:Date.now()-start,...v})+'\\n')}
${snapshot.toString()}
const u=require(path.join(root,'update-files.cjs'));let reads=0;const read=fs.readFileSync;fs.readFileSync=function(p,...rest){const result=read.call(this,p,...rest);if(String(p).startsWith(root)&&++reads%5000===0)event({operation:'scan',filesRead:reads,path:path.relative(root,String(p))});return result};
for(const key of ['loadIndex','prepare']){const fn=u[key];u[key]=async function(...a){event({stage:key+'-start',...snapshot(root)});try{return await fn(...a)}finally{event({stage:key+'-end',...snapshot(root)})}}}
for(const key of ['promote','cleanup']){const fn=u[key];u[key]=function(...a){event({stage:key+'-start',...snapshot(root)});try{return fn(...a)}finally{event({stage:key+'-end',...snapshot(root)})}}}
let linked=0;fs.linkSync=function(a,b){const r=link.apply(this,arguments);if(String(b).startsWith(root))linked++;return r};
fs.writeFileSync=function(p,b,...rest){const r=write.call(this,p,b,...rest);if(String(p).startsWith(root))event({operation:'write',path:path.relative(root,String(p)),bytes:fs.statSync(p).size});return r};
fs.renameSync=function(a,b){const r=rename.apply(this,arguments);if(String(b).startsWith(root))event({operation:'rename',from:path.relative(root,String(a)),path:path.relative(root,String(b)),hardlinksCreated:linked});return r};`);
 const env={...process.env,HOME:work,USERPROFILE:work,CODEX_HOME:path.join(work,'codex-home'),DATABASE_PATH:path.join(work,'auth.db'),BIGACLI_PORT:String(port),NODE_OPTIONS:'--require '+JSON.stringify(hook)};
 child=spawn(path.join(u.component(root,old,'node'),'node.exe'),[path.join(root,'launcher.cjs')],{env,cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});child.stderr.on('data',b=>process.stderr.write(b));
 const api=async(action,method='GET')=>(await originalFetch(`http://127.0.0.1:${port}/api/bigacli/update/${action}`,{method})).json();
 for(let i=0;i<80;i++){try{if((await api('status')).version===old.version)break}catch{}await wait(250)}
 assert.equal((await api('check','POST')).available?.version,target.version);await api('install','POST');
 let state;
 for(let i=0;i<2400;i++){await wait(250);try{state=await api('status');if(state.installError)throw Error(state.installError);if(state.version===target.version&&state.phase==='idle')break}catch(e){if(!String(e).includes('fetch failed'))throw e}}
 assert.equal(state?.version,target.version);assert.equal(state?.phase,'idle');record('update-healthy-cleaned');
 const active=JSON.parse(fs.readFileSync(path.join(root,'active.json')));assert.equal(active.components.deps.id,old.components.deps.id);assert.equal(active.components.node.id,old.components.node.id);
 assert(!fs.existsSync(path.join(u.component(root,active,'app'),'audit-obsolete.txt')));assert(fs.existsSync(path.join(u.component(root,old,'app'),'audit-obsolete.txt')));
 assert.equal(fs.statSync(path.join(u.component(root,old,'app'),'cloudcli/dist/index.html'),{bigint:true}).ino,fs.statSync(path.join(u.component(root,active,'app'),'cloudcli/dist/index.html'),{bigint:true}).ino);
 const contentRequests=requests.filter(r=>r.phase==='update');assert.equal(contentRequests.length,2,'Only added file and version.json fetched');assert(contentRequests.every(r=>r.file==='app-win-x64.zip'));
 assert(!fs.readdirSync(path.join(root,'downloads/file-update')).length,'Successful staging cleaned');
 events.push(...fs.readFileSync(auditLog,'utf8').trim().split('\n').map(JSON.parse));events.sort((a,b)=>a.ms-b.ms);
 fs.writeFileSync(path.join(reportDir,'timeline.json'),JSON.stringify({events,requests,result:'PASS',transport:'local HTTP serving unchanged official ZIP bytes and synthetic target app ZIP',sourceZip:{bytes:zipSize,sha256:expected}},null,2));
 console.log('PASS real full ZIP install, no repeat npm download, actual application update, two changed file ranges, deletion, hardlink sharing, cleanup');
}finally{
 global.fetch=originalFetch;if(child?.connected)child.send({type:'shutdown'});if(child&&child.exitCode===null)await new Promise(r=>child.once('exit',r));if(server)await new Promise(r=>server.close(r));
 if(fs.existsSync(path.join(work,'worker.jsonl')))fs.copyFileSync(path.join(work,'worker.jsonl'),path.join(reportDir,'worker-last.jsonl'));
 u.removeTree(work,os.tmpdir());
}})().catch(e=>{console.error(e);process.exitCode=1});
