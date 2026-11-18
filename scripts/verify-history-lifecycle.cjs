// Whole history lifecycle with a real isolated database; no account or model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{zstdCompressSync}=require('node:zlib');
if(process.argv[2]!=='--isolated'){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'biga-history-'));
 try{const result=spawnSync(process.execPath,[__filename,'--isolated'],{env:{...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:home+'/.codex',DATABASE_PATH:home+'/auth.db'},windowsHide:true,encoding:'utf8'});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.status!==0)process.exitCode=1;}
 finally{fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}else(async()=>{
 const version=JSON.parse(fs.readFileSync('release.json')).version,cloud=path.resolve('build/'+version+'/components/app/cloudcli');
 const a=JSON.parse(fs.readFileSync('../BigaCli-local/active.json'));if(!fs.existsSync(cloud+'/node_modules'))fs.symlinkSync(path.resolve('../BigaCli-local/store/deps',a.components.deps.id,'node_modules'),cloud+'/node_modules','junction');
 const load=rel=>import(pathToFileURL(cloud+'/dist-server/server/'+rel));
 const db=await load('modules/database/index.js');await db.initializeDatabase();
 try{
 const files=await load('modules/providers/services/codex-history-files.service.js');
 const {readCodexTranscriptLines}=await load('modules/providers/services/codex-transcript.service.js');
 await load('modules/providers/index.js');
 const {CodexSessionSynchronizer}=await load('modules/providers/list/codex/codex-session-synchronizer.provider.js');
 const {CodexSessionsProvider}=await load('modules/providers/list/codex/codex-sessions.provider.js');
 const {sessionSynchronizerService}=await load('modules/providers/services/session-synchronizer.service.js');
 const folder=path.join(os.homedir(),'.codex/sessions/2026/01/01');fs.mkdirSync(folder,{recursive:true});
 const make=(id,extra={})=>JSON.stringify({type:'session_meta',payload:{id,cwd:os.homedir(),...extra}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'user_message',message:'question '+id}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'task_complete',last_agent_message:'answer '+id}})+'\n';
 const write=(id,compressed,extra)=>{const file=path.join(folder,'rollout-test-'+id+'.jsonl'+(compressed?'.zst':''));fs.writeFileSync(file,compressed?zstdCompressSync(Buffer.from(make(id,extra))):make(id,extra));return file};
 const plain=write('plain',false),packed=write('packed',true),sub=write('subagent',true,{thread_source:'subagent'});
 // Startup repairs older files even when the global cursor is newer than them.
 const sync=new CodexSessionSynchronizer();assert.equal(await sync.synchronize(new Date(Date.now()+60000)),2);
 assert.equal(db.sessionsDb.getSessionById('packed').jsonl_path,packed);assert.equal(db.sessionsDb.getSessionById('subagent'),null);
 const provider=new CodexSessionsProvider();assert((await provider.fetchHistory('packed')).messages.some(m=>m.content?.includes('question packed')));
 fs.writeFileSync(plain+'.zst',zstdCompressSync(fs.readFileSync(plain)));fs.unlinkSync(plain);
 // A stale plain path remains readable and is not an orphan during compression.
 await sessionSynchronizerService.synchronizeSessions();assert(db.sessionsDb.getSessionById('plain'));
 assert((await provider.fetchHistory('plain')).messages.some(m=>m.content?.includes('question plain')));
 assert.equal(await sync.synchronizeFile(plain+'.zst'),'plain');
 fs.writeFileSync(plain,make('plain'));assert.equal((await files.findCodexTranscriptFiles(path.join(os.homedir(),'.codex/sessions'))).filter(p=>files.codexTranscriptKey(p)===plain).length,1);
 db.getConnection().prepare('UPDATE sessions SET isArchived=1 WHERE session_id=?').run('packed');await sync.synchronizeFile(packed);assert.equal(db.sessionsDb.getSessionById('packed').isArchived,1);
 // Fork parent is on disk but absent from the visible index (e.g. a subagent).
 const child=write('child',true,{history_base:{thread_id:'subagent',end_byte_offset:Buffer.byteLength(make('subagent',{thread_source:'subagent'}))}});
 const history=[];for await(const line of readCodexTranscriptLines(child))history.push(line);assert(history.some(line=>line.includes('question subagent')));
 fs.unlinkSync(plain);fs.unlinkSync(plain+'.zst');await sessionSynchronizerService.synchronizeSessions();assert.equal(db.sessionsDb.getSessionById('plain'),null);
 const watcher=await load('modules/providers/services/sessions-watcher.service.js');
 await watcher.initializeSessionsWatcher();
 try{await new Promise(r=>setTimeout(r,500));write('watched',true);for(let i=0;i<90&&!db.sessionsDb.getSessionById('watched');i++)await new Promise(r=>setTimeout(r,100));assert(db.sessionsDb.getSessionById('watched'),'Compressed files must be picked up by the real watcher');}
 finally{await watcher.closeSessionsWatcher()}
 const broken=write('broken',false);await sync.synchronizeFile(broken);fs.writeFileSync(broken+'.zst','invalid zstd');fs.unlinkSync(broken);
 await assert.rejects(provider.fetchHistory('broken'),e=>e.code==='HISTORY_READ_FAILED');
 const result=await sessionSynchronizerService.synchronizeSessions();assert(result.failures.length>0);assert.equal(result.prunedOrphans,0);assert(db.sessionsDb.getSessionById('broken'));
 console.log('PASS: old compressed discovery, message loading, compression transition, file-event sync, duplicate representations, archived/subagent exclusion, unindexed fork parent, genuine deletion, corrupt-history visibility and no pruning after failed scan.');
 }finally{db.closeConnection()}
})().catch(e=>{console.error(e);process.exitCode=1});
