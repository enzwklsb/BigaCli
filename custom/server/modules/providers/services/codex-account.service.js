import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { connectedClients, WS_OPEN_STATE } from '../../websocket/services/websocket-state.service.js';
import { DatabaseSync, backup } from 'node:sqlite';

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
function copyIfExists(src,dst){ try{if(!fs.statSync(src).isFile())return;const data=fs.readFileSync(src);if(fs.existsSync(dst)&&data.equals(fs.readFileSync(dst)))return;fs.writeFileSync(dst+'.tmp',data);fs.renameSync(dst+'.tmp',dst)}catch{} }
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
  for(const file of ['AGENTS.md','AGENTS.override.md']) copyIfExists(path.join(DEFAULT_HOME,file),path.join(home,file));
  const configPath=path.join(home,'config.toml');
  let existing=''; try{existing=fs.readFileSync(configPath,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
  let config=existing; try{config=fs.readFileSync(path.join(DEFAULT_HOME,'config.toml'),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
  if(/^\s*cli_auth_credentials_store\s*=/m.test(config)) config=config.replace(/^\s*cli_auth_credentials_store\s*=.*$/m,'cli_auth_credentials_store = "file"');
  else config=`cli_auth_credentials_store = "file"\n${config}`;
  if(config!==existing){fs.writeFileSync(configPath+'.tmp',config,'utf8');fs.renameSync(configPath+'.tmp',configPath)}
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
export async function seedCodexHistoryIndex(home){
  // Codex 0.153.4 uses state_5.sqlite. SQLite backup includes committed WAL data.
  const source=path.join(DEFAULT_HOME,'state_5.sqlite'),target=path.join(home,'state_5.sqlite');
  if(!fs.existsSync(source)||fs.existsSync(target))return;
  const db=new DatabaseSync(source,{readOnly:true});
  try{if(db.prepare('SELECT status FROM backfill_state WHERE id=1').get()?.status==='complete')await backup(db,target)}finally{db.close()}
}
export async function createCodexAccount(){
  const id='acct_'+crypto.randomUUID().replaceAll('-','').slice(0,12); const home=prepareProfileHome(path.join(PROFILE_ROOT,id));
  await seedCodexHistoryIndex(home);
  const s=loadStore(); const n=Math.max(0,...s.accounts.map(a=>Number(/^账号\s+(\d+)$/.exec(String(a.label||''))?.[1])||0))+1;
  const account={id,label:`账号 ${n}`,codexHome:home,isDefault:false}; s.accounts.push(account); saveStore(s); return {...account,authenticated:false};
}
export function deleteCodexAccount(id){
  if(id==='default') throw new Error('默认账号不能删除');
  const s=loadStore(); if(!s.accounts.some(a=>a.id===id))throw new Error('账号不存在');
  s.accounts=s.accounts.filter(a=>a.id!==id);
  if(s.currentAccountId===id)s.currentAccountId='default';
  saveStore(s); return true;
}
export function getSessionCodexAccountConfig(sessionId){
  const s=loadStore(); const cfg=s.sessions[sessionId]||{};
  // One-time migration: keep the account of the first opened conversation.
  if(!s.currentAccountId){
    const previous=cfg.currentAccountId||cfg.preferredAccountId;
    s.currentAccountId=s.accounts.some(a=>a.id===previous)?previous:'default';
    s.mode=cfg.mode==='auto'?'auto':'manual'; saveStore(s);
  }
  const requestedId=s.currentAccountId; const current=getCodexAccount(requestedId);
  if(!current)throw new Error(`账号不存在：${requestedId}`);
  return {mode:s.mode==='auto'?'auto':'manual',currentAccountId:current.id,preferredAccountId:current.id,accountChangedAt:s.accountChangedAt||null,threadAccountId:cfg.threadAccountId||cfg.currentAccountId||cfg.preferredAccountId||'default'};
}
export function setSessionCodexAccountConfig(sessionId,{accountId,mode}){
  const s=loadStore(); const account=s.accounts.find(a=>a.id===accountId); if(!account)throw new Error('账号不存在');
  const changed=s.currentAccountId!==account.id;
  if(changed)s.accountChangedAt=Date.now();
  s.currentAccountId=account.id; if(mode!==undefined)s.mode=mode==='auto'?'auto':'manual'; saveStore(s);
  const config=getSessionCodexAccountConfig(sessionId);
  if(changed){const data=JSON.stringify({kind:'codex_account_changed',config});for(const client of connectedClients)if(client.readyState===WS_OPEN_STATE)client.send(data);}
  return config;
}
export function setSessionCodexMode(sessionId,mode){ const s=loadStore(); s.mode=mode==='auto'?'auto':'manual'; saveStore(s); return getSessionCodexAccountConfig(sessionId); }
export function recordCodexThreadAccount(sessionId,accountId){
  const s=loadStore(); s.sessions[sessionId]={...s.sessions[sessionId],threadAccountId:accountId}; saveStore(s);
}
export function buildCodexEnv(accountId){
  const account=getCodexAccount(accountId); if(!account)throw new Error('账号不存在'); if(account.isDefault)ensureDir(account.codexHome);else prepareProfileHome(account.codexHome);
  return {...process.env,CODEX_HOME:account.codexHome};
}
