import spawn from 'cross-spawn';
import { spawnCodex } from './codex-command.service.js';
import { buildCodexEnv } from './codex-account.service.js';
function send(proc,payload){proc.stdin.write(`${JSON.stringify(payload)}\n`)}
export function readCodexAccountInfo(accountId='default',timeoutMs=8000){return new Promise((resolve,reject)=>{
 const proc=spawnCodex(spawn,['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:buildCodexEnv(accountId)}); let buffer='',stderr='',settled=false,result;
 const finish=(e,v)=>{if(settled)return;if(e){settled=true;clearTimeout(timer);try{proc.kill()}catch{};reject(e)}else{result=v;proc.stdin.end()}}; const timer=setTimeout(()=>finish(new Error('Codex account request timed out')),timeoutMs);
 proc.on('error',e=>finish(e)); proc.stdin.on('error',e=>finish(e)); proc.stderr.on('data',c=>stderr=(stderr+String(c)).slice(-4000)); proc.stdout.on('data',c=>{buffer+=String(c);while(true){const nl=buffer.indexOf('\n');if(nl<0)break;const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}if(m.id===1){if(m.error)return finish(new Error(m.error.message||'Codex initialize failed'));send(proc,{method:'initialized'});send(proc,{id:2,method:'account/read',params:{refreshToken:false}})}else if(m.id===2){if(m.error)return finish(new Error(m.error.message||'Codex account read failed'));return finish(null,m.result||{})}}});
 proc.on('close',code=>{if(settled)return;if(code===0&&result!==undefined){settled=true;clearTimeout(timer);resolve(result)}else finish(new Error(stderr.trim()||`codex app-server exited with code ${code}`))}); send(proc,{id:1,method:'initialize',params:{clientInfo:{name:'codex-shell',title:'Codex Shell',version:'1'},capabilities:null}})
})}
