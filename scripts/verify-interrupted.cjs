const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'release.json'))).version;
const app=path.join(root,'build',version,'components/app/cloudcli'),install=path.resolve(root,'../BigaCli-local'),active=JSON.parse(fs.readFileSync(path.join(install,'active.json')));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'biga-interrupted-'));process.env.DATABASE_PATH=path.join(temp,'auth.db');
const link=path.join(app,'node_modules');try{if(fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link)}catch(error){if(error.code!=='ENOENT')throw error}fs.symlinkSync(path.join(install,'store/deps',active.components.deps.id,'node_modules'),link,'junction');
(async()=>{try{
 const service=await import(pathToFileURL(path.join(app,'dist-server/server/modules/providers/services/codex-interrupted.service.js')));
 const parts=new Map();service.captureInterruptedPart(parts,{kind:'stream_delta',itemId:'reply',messageKind:'text',phase:'final_answer',content:'已显示',timestamp:'2026-10-02T01:43:22Z'});
 service.captureInterruptedPart(parts,{kind:'stream_delta',itemId:'reply',messageKind:'text',content:'和已收到的缓存'});service.saveInterruptedReplies('session','thread',parts);
 let messages=[];service.mergeInterruptedReplies('session','thread',messages);assert.equal(messages[0].message.content,'已显示和已收到的缓存');
 messages=[{uuid:'reply',type:'assistant',timestamp:'2026-10-02T01:43:26Z',message:{role:'assistant',content:'native full'}}];service.mergeInterruptedReplies('session','thread',messages);assert.equal(messages.length,1);
 assert.equal(service.mergeInterruptedReplies('other','thread',[]).length,0);
 const db=(await import(pathToFileURL(path.join(app,'dist-server/server/modules/database/index.js')))).getConnection();db.close();
 console.log('PASS interrupted reply persisted in isolated database, native deduplication and session isolation');
}finally{fs.unlinkSync(link);require('../update-files.cjs').removeTree(temp,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
