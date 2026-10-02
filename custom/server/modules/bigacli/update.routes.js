import express from 'express';
import { randomUUID } from 'node:crypto';
import { chatRunRegistry } from '../websocket/services/chat-run-registry.service.js';
export let updateSwitchPending=false;
process.on('message',m=>{if(m?.type==='bigacli-prepare-switch'){const idle=chatRunRegistry.listRunningRuns().length===0;if(idle)updateSwitchPending=true;process.send?.({type:'bigacli-idle',id:m.id,idle})}});
const router=express.Router();
router.post('/reserve-switch',(req,res)=>{const idle=chatRunRegistry.listRunningRuns().length===0;if(idle)updateSwitchPending=true;res.json({idle})});
router.post('/release-switch',(req,res)=>{updateSwitchPending=false;res.json({ok:true})});
router.all('/:action',async(req,res)=>{
 const action=req.params.action;
 if(!['status','check','install'].includes(action)||(action!=='status'&&req.method!=='POST'))return res.sendStatus(405);
 if(!process.send)return res.status(503).json({error:'请使用 BigaCli 启动入口'});
 const id=randomUUID();const timer=setTimeout(()=>{process.off('message',on);res.status(504).json({error:'更新服务响应超时'})},20000);
 const on=m=>{if(m?.type==='bigacli-update-result'&&m.id===id){clearTimeout(timer);process.off('message',on);res.json(m.value)}};
 process.on('message',on);process.send({type:'bigacli-update',id,action});
});
export default router;
