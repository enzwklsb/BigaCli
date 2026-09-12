import spawn from 'cross-spawn';
import { spawnCodex } from './codex-command.service.js';
import { buildCodexEnv } from './codex-account.service.js';

function send(proc,payload){proc.stdin.write(`${JSON.stringify(payload)}\n`)}
// Providers HTTP controls and the Codex runtime share the account's native capabilities.
export async function readCodexModelCatalog(accountId='default') {
 const models=(await readCodexModels(accountId)).filter(model=>!model.hidden);
 const OPTIONS=models.map(model=>({value:model.model||model.id,label:model.displayName||model.model||model.id,description:model.description,
  effort:{default:model.defaultReasoningEffort,values:(model.supportedReasoningEfforts||[]).map(e=>({value:typeof e==='string'?e:e.reasoningEffort}))},
  serviceTiers:model.serviceTiers||[],defaultServiceTier:model.defaultServiceTier}));
 return {OPTIONS,DEFAULT:(models.find(model=>model.isDefault)||models[0])?.model||OPTIONS[0]?.value||''};
}
export function readCodexModels(accountId='default',timeoutMs=8000){return new Promise((resolve,reject)=>{
 const proc=spawnCodex(spawn,['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:buildCodexEnv(accountId)}); let buffer='',stderr='',settled=false,result;
 const finish=(e,v)=>{if(settled)return;if(e){settled=true;clearTimeout(timer);try{proc.kill()}catch{};reject(e)}else{result=v;proc.stdin.end()}}; const timer=setTimeout(()=>finish(new Error('Codex model request timed out')),timeoutMs);
 proc.on('error',e=>finish(e)); proc.stdin.on('error',e=>finish(e)); proc.stderr.on('data',c=>stderr=(stderr+String(c)).slice(-4000)); proc.stdout.on('data',c=>{buffer+=String(c);while(true){const nl=buffer.indexOf('\n');if(nl<0)break;const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}if(m.id===1){if(m.error)return finish(new Error(m.error.message||'Codex initialize failed'));send(proc,{method:'initialized'});send(proc,{id:2,method:'model/list',params:{}})}else if(m.id===2){if(m.error)return finish(new Error(m.error.message||'Codex model read failed'));return finish(null,Array.isArray(m.result?.data)?m.result.data:[])}}});
 proc.on('close',code=>{if(settled)return;if(code===0&&result!==undefined){settled=true;clearTimeout(timer);resolve(result)}else finish(new Error(stderr.trim()||`codex app-server exited with code ${code}`))}); send(proc,{id:1,method:'initialize',params:{clientInfo:{name:'codex-shell',title:'Codex Shell',version:'1'},capabilities:null}})
})}
