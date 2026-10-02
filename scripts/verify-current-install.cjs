const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const u=require('../update-files.cjs'),repo=path.resolve(__dirname,'..'),install=path.resolve(repo,'../BigaCli-local'),active=JSON.parse(fs.readFileSync(path.join(install,'active.json'))),version=JSON.parse(fs.readFileSync(path.join(repo,'release.json'))).version;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'biga-current-'));
(async()=>{try{
 const m={...active,version};fs.writeFileSync(path.join(root,'active.json'),JSON.stringify(m));
 for(const file of u.bootNames)fs.copyFileSync(path.join(repo,file),path.join(root,file));
 for(const k of ['app','deps','node']){const target=u.component(root,m,k);fs.mkdirSync(path.dirname(target),{recursive:true});const source=k==='app'?path.join(repo,'build',version,'components/app'):u.component(install,active,k);fs.symlinkSync(source,target,'junction')}
 const p=spawn(process.execPath,['scripts/smoke.mjs',root],{cwd:repo,windowsHide:true,stdio:'inherit',env:{...process.env,BIGACLI_TEST_PORT:'39127',BIGA_TEST_BROWSER:'1',BIGA_TEST_SYNC:'1',BIGA_TEST_UPDATE:'1'}});
 const code=await new Promise(resolve=>p.once('exit',resolve));if(code)throw Error('Isolated app verification failed');
}finally{const link=path.join(repo,'build',version,'components/app/cloudcli/node_modules');try{if(fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link)}catch(error){if(error.code!=='ENOENT')throw error}u.removeTree(root,os.tmpdir())}})().catch(e=>{console.error(e);process.exitCode=1});
