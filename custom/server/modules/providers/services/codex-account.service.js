import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const CODEXLITE_DIR = path.join(os.homedir(), '.codexlite');
const STORE_PATH = path.join(CODEXLITE_DIR, 'codex-accounts.json');
const PROFILE_ROOT = path.join(CODEXLITE_DIR, 'codex-accounts');
// Account 1 follows the system Codex home used by the host environment.
// Additional CodexLite accounts use isolated homes, so switching them never
// rewrites the default account used by the original CloudCLI instance.
const DEFAULT_HOME = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const LEGACY_STORE_PATH = path.join(os.homedir(), '.cloudcli', 'codex-accounts.json');

function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback} }
function writeJsonAtomic(file,value){ ensureDir(path.dirname(file)); const tmp=file+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }
function defaultStore(){ return {version:1,accounts:[{id:'default',label:'账号 1',codexHome:DEFAULT_HOME,isDefault:true}],sessions:{}}; }
function loadStore(){ const s=readJson(STORE_PATH,null)||readJson(LEGACY_STORE_PATH,null)||defaultStore(); if(!Array.isArray(s.accounts))s.accounts=[]; if(!s.sessions||typeof s.sessions!=='object')s.sessions={}; if(!s.accounts.some(a=>a.id==='default'))s.accounts.unshift({id:'default',label:'账号 1',codexHome:DEFAULT_HOME,isDefault:true}); return s; }
function saveStore(s){ writeJsonAtomic(STORE_PATH,s); }
function copyIfExists(src,dst){ try{ if(fs.statSync(src).isFile())fs.copyFileSync(src,dst); }catch{} }
function ensureSharedDir(profileHome,name,required=false){
  const shared=path.join(DEFAULT_HOME,name), target=path.join(profileHome,name);
  ensureDir(shared);
  let targetStat=null;
  try{targetStat=fs.lstatSync(target)}catch(error){if(error?.code!=='ENOENT')throw error}
  if(targetStat){
    const actual=fs.realpathSync(target), expected=fs.realpathSync(shared);
    const matches=process.platform==='win32'?actual.toLowerCase()===expected.toLowerCase():actual===expected;
    if(!targetStat.isSymbolicLink()||!matches){
      if(required)throw new Error(`Codex Profile ${name} 不是指向默认目录的共享链接：${target}`);
      return;
    }
    return;
  }
  try{fs.symlinkSync(shared,target,process.platform==='win32'?'junction':'dir')}
  catch(error){
    if(required)throw new Error(`Codex Profile ${name} 共享链接创建失败：${target}`,{cause:error});
    try{ensureDir(target)}catch{}
  }
}
function prepareProfileHome(home){
  ensureDir(home);
  ensureSharedDir(home,'sessions',true);
  for(const name of ['archived_sessions','skills'])ensureSharedDir(home,name);
  for(const file of ['config.toml','AGENTS.md','AGENTS.override.md']) copyIfExists(path.join(DEFAULT_HOME,file),path.join(home,file));
  const configPath=path.join(home,'config.toml');
  let config=''; try{config=fs.readFileSync(configPath,'utf8')}catch{}
  if(/^\s*cli_auth_credentials_store\s*=/m.test(config)) config=config.replace(/^\s*cli_auth_credentials_store\s*=.*$/m,'cli_auth_credentials_store = "file"');
  else config=`cli_auth_credentials_store = "file"\n${config}`;
  fs.writeFileSync(configPath,config,'utf8');
  return home;
}
export function listCodexAccounts(){
  const s=loadStore();
  // The built-in/default profile is always visible. Additional profiles only
  // become real accounts after Codex login has produced auth.json. This keeps
  // cancelled/unfinished "Add account" attempts out of the account picker.
  return s.accounts
    .map(a=>({...a,authFilePresent:fs.existsSync(path.join(a.codexHome,'auth.json'))}))
    .filter(a=>a.id==='default'||a.authFilePresent);
}
export function getCodexAccount(id='default'){
  const s=loadStore(); return s.accounts.find(a=>a.id===id)||null;
}
export function createCodexAccount(){
  const s=loadStore(); const n=Math.max(0,...s.accounts.map(a=>Number(/^账号\s+(\d+)$/.exec(String(a.label||''))?.[1])||0))+1; const id='acct_'+crypto.randomUUID().replaceAll('-','').slice(0,12); const home=prepareProfileHome(path.join(PROFILE_ROOT,id));
  const account={id,label:`账号 ${n}`,codexHome:home,isDefault:false}; s.accounts.push(account); saveStore(s); return {...account,authenticated:false};
}
export function deleteCodexAccount(id){
  if(id==='default') throw new Error('默认账号不能删除');
  const s=loadStore(); if(!s.accounts.some(a=>a.id===id))throw new Error('账号不存在');
  s.accounts=s.accounts.filter(a=>a.id!==id);
  for(const [sid,cfg] of Object.entries(s.sessions)) if(cfg?.currentAccountId===id||cfg?.preferredAccountId===id) s.sessions[sid]={mode:'manual',currentAccountId:'default',preferredAccountId:'default'};
  saveStore(s); return true;
}
export function getSessionCodexAccountConfig(sessionId){
  const s=loadStore(); const cfg=s.sessions[sessionId]||{}; const requestedId=cfg.currentAccountId||cfg.preferredAccountId||'default'; const current=getCodexAccount(requestedId);
  if(!current)throw new Error(`账号不存在：${requestedId}`);
  return {mode:cfg.mode==='auto'?'auto':'manual',currentAccountId:current.id,preferredAccountId:cfg.preferredAccountId||current.id};
}
export function setSessionCodexAccountConfig(sessionId,{accountId,mode}){
  const s=loadStore(); const account=s.accounts.find(a=>a.id===accountId); if(!account)throw new Error('账号不存在');
  const prev=s.sessions[sessionId]||{}; s.sessions[sessionId]={mode:mode==='auto'?'auto':(mode==='manual'?'manual':(prev.mode||'manual')),currentAccountId:account.id,preferredAccountId:account.id}; saveStore(s); return s.sessions[sessionId];
}
export function setSessionCodexMode(sessionId,mode){ const s=loadStore(); const prev=s.sessions[sessionId]||{currentAccountId:'default',preferredAccountId:'default'}; prev.mode=mode==='auto'?'auto':'manual'; s.sessions[sessionId]=prev; saveStore(s); return prev; }
export function buildCodexEnv(accountId){
  const account=getCodexAccount(accountId); if(!account)throw new Error('账号不存在'); if(!account.isDefault)prepareProfileHome(account.codexHome);
  return {...process.env,CODEX_HOME:account.codexHome};
}
