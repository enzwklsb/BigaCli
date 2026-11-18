// Exercise the real stream adapter against a local protocol fixture. No model requests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),{createInterface}=require('node:readline');
const folder=path.resolve(__dirname,'../custom/server/modules/providers/services');
const helper=fs.readFileSync(folder+'/codex-request-status.service.js','utf8').replaceAll('export ','');
const adapter=fs.readFileSync(folder+'/codex-stream.service.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^const agentRules =.*;\r?\n/m,"const agentRules = '';\n").replaceAll('export ','');
async function run(scenario){
 const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();let closed=false;
 const close=()=>{if(closed)return;closed=true;proc.stdout.end();setImmediate(()=>proc.emit('close',0))};proc.kill=close;
 const emit=message=>{if(!closed)proc.stdout.write(JSON.stringify(message)+'\n')};
 const output=()=>{emit({method:'item/agentMessage/delta',params:{itemId:'reply',delta:'OK'}});emit({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}})};
 proc.stdin=new Writable({write(chunk,encoding,done){const m=JSON.parse(chunk.toString());done();if(!m.method)return;
  const results={initialize:{},'config/read':{config:{}},'thread/start':{thread:{id:'thread'}},'turn/start':{turn:{id:'turn'}},'turn/interrupt':{}};
  setImmediate(()=>{
   if(scenario==='rpc-upgrade'&&m.method==='thread/start'){emit({id:m.id,error:{message:'This model requires a newer Codex CLI version.'}});return}
   if(m.id)emit({id:m.id,result:results[m.method]||{}});
   if(m.method!=='turn/start')return;
   if(scenario==='capacity'){
    emit({method:'error',params:{willRetry:true,error:{message:'Selected model is at capacity. Please try a different model.',codexErrorInfo:'serverOverloaded'}}});setTimeout(output,85);
   }else if(scenario==='upgrade'){
    const error={message:'Please upgrade Codex CLI to use this model.'};emit({method:'error',params:{willRetry:false,error}});emit({method:'turn/completed',params:{turn:{id:'turn',status:'failed',error}}});
   }else if(scenario==='network'){
    emit({method:'error',params:{willRetry:true,error:{message:'Connection reset by peer'}}});setTimeout(output,85);
   }else if(scenario==='silent'||scenario==='abort')setTimeout(output,85);
   else output();
  });
 },final(done){close();done()}});
 const sandbox={console,Map,Set,JSON,Error,Promise,AbortController,URL,createInterface,randomUUID:()=>String(Math.random()),spawn:{},spawnCodex:()=>proc,createDesktopContext:()=>null,nativePermissionId:v=>v,getReplyPreference:()=>({verbosity:'medium'}),browserUseService:{getAgentMcpConfig:()=>({})},clearTimeout,setTimeout:(f,ms)=>setTimeout(f,ms===60000?30:ms),AppError:Error};
 vm.createContext(sandbox);vm.runInContext(helper+'\n'+adapter+'\nglobalThis.testStream=streamCodexTurn;globalThis.describe=describeCodexRequestError;',sandbox);
 const abort=new AbortController(),events=[];const timer=scenario==='abort'?setTimeout(()=>abort.abort(),10):null;
 try{for await(const event of sandbox.testStream('probe',{sessionId:'isolated',model:'gpt-6.2-sol',permissionMode:':workspace'},abort.signal))events.push(event)}catch(error){if(!['abort','rpc-upgrade'].includes(scenario))throw error;events.error=error}finally{clearTimeout(timer)}
 const notices=events.filter(e=>e.message?.kind==='request_wait').map(e=>e.message);
 if(scenario==='capacity'){assert.match(notices[0].text,/容量已满/);assert(!notices.some(n=>/检查.*更新/.test(n.text)));assert.equal(notices.at(-1).text,'');assert(events.some(e=>e.type==='turn.completed'));}
 if(scenario==='silent'){assert.match(notices[0].text,/尚未收到/);assert.match(notices[0].text,/检查 BigaCli 更新/);assert.equal(notices.at(-1).text,'');}
 if(scenario==='normal'||scenario==='abort')assert.equal(notices.length,0);
 if(scenario==='network'){assert.match(notices[0].text,/正在重试/);assert.match(notices[0].detail,/Connection reset/);}
 if(scenario==='upgrade')assert.match(events.find(e=>e.type==='turn.failed').error.message,/检查 BigaCli 更新/);
 if(scenario==='rpc-upgrade')assert.match(events.error.message,/检查 BigaCli 更新/);
 if(scenario==='abort')assert.equal(events.error.name,'AbortError');
 assert(!sandbox.describe({message:'Model not found for this account'},false).text.includes('版本'));
}
(async()=>{for(const scenario of ['capacity','silent','normal','network','upgrade','rpc-upgrade','abort'])await run(scenario);console.log('PASS: capacity and retry reasons, delayed first response, normal completion, version errors, RPC errors and abort cleanup; no model usage.');})().catch(error=>{console.error(error);process.exitCode=1});
