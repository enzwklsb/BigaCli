// Uses an already verified release ZIP, isolated user directories and no real Codex account.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const childProcess=require('node:child_process');
const {ensureInstalled,validateInstall}=require('../npm/install.cjs');
const zip=path.resolve(process.argv[2]),version=process.argv[3]||'1.0.0';
const temp=process.env.BIGA_NPM_TEST_REUSE||fs.mkdtempSync(path.join(os.tmpdir(),'bigacli-npm-test-'));
const root=path.join(temp,'BigaCli'),originalFetch=global.fetch;
async function main(){
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(zip))hash.update(chunk);const digest=hash.digest('hex');
 let requests=0;
 global.fetch=async url=>{requests++;assert.ok(url.startsWith('https://github.com/enzwklsb/BigaCli/releases/download/v'+version+'/'));return url.endsWith('SHA256SUMS.txt')?new Response(digest+'  BigaCli-win-x64.zip\n'):new Response(Readable.toWeb(fs.createReadStream(zip)))};
 await ensureInstalled(root,version);assert.equal(requests,process.env.BIGA_NPM_TEST_REUSE?0:2);assert.equal(validateInstall(root).version,version);
 global.fetch=()=>{throw Error('An existing installation must not download or be downgraded')};
 await ensureInstalled(root,'0.0.1');await ensureInstalled(root,'9.0.0');
 const spawn=childProcess.spawn,local=process.env.LOCALAPPDATA;let launched=false;
 try{
  process.env.LOCALAPPDATA=temp;
  childProcess.spawn=(exe,args,options)=>{assert.equal(exe,'powershell.exe');assert.equal(args.at(-1),path.join(root,'foreground.ps1'));assert.equal(options.cwd,root);assert.equal(options.stdio,'inherit');launched=true;const p=new EventEmitter();queueMicrotask(()=>p.emit('exit',0));return p};
  await require('../bin/bigacli.cjs').main([]);assert.ok(launched);
 }finally{childProcess.spawn=spawn;if(local===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=local}
 const manifest=validateInstall(root);
 childProcess.execFileSync(path.join(root,'store/node',manifest.components.node.id,'node.exe'),['scripts/smoke.mjs',root],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',env:{...process.env,BIGACLI_TEST_PORT:process.env.BIGACLI_TEST_PORT||'3194',BIGA_TEST_BROWSER:'',BIGA_TEST_UPDATE:''}});
 const bad=path.join(temp,'invalid');
 global.fetch=async url=>url.endsWith('SHA256SUMS.txt')?new Response('0'.repeat(64)+'  BigaCli-win-x64.zip'):new Response('broken archive');
 await assert.rejects(ensureInstalled(bad,version),/checksum mismatch/);assert.ok(!fs.existsSync(bad));
 global.fetch=async()=>new Response('Not found',{status:404});
 await assert.rejects(ensureInstalled(bad,version),/HTTP 404/);assert.ok(!fs.existsSync(bad));
 assert.ok(!fs.readdirSync(temp).some(name=>name.startsWith('.bigacli-install-')));
 console.log('PASS: verified first install, existing install reuse, npm startup dispatch, isolated service startup, corrupt download and unpublished release handling.');
 console.log('Isolated test installation: '+root);
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{global.fetch=originalFetch});
