// Human-operated desktop sharing. This is deliberately not an Agent/MCP tool.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import express from 'express';
import {DESECBCipher} from './vendor/novnc/core/crypto/des.js';

const run=promisify(execFile), directory=path.dirname(fileURLToPath(import.meta.url));
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const data=path.join(process.env.LOCALAPPDATA||os.homedir(),'BigaCli','remote-desktop');
const configFile=path.join(data,'connection.json');
const supported=process.platform==='win32'&&process.arch==='x64';
let operation=null, lastError=null, checking=null, cached=null, checkedAt=0;
const tickets=new Map();
function config(){try{return JSON.parse(fs.readFileSync(configFile,'utf8'))}catch{return null}}
function sameOrigin(req){try{return new URL(req.headers.origin).host===req.headers.host}catch{return false}}
function quote(value){return "'"+value.replaceAll("'","''")+"'"}
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})}
export async function desktopStatus(){
  if(!supported)return {supported:false};
  if(checking)return checking;
  if(cached&&Date.now()-checkedAt<2000)return {...cached,operation,error:lastError};
  checking=(async()=>{
    // A small built-in process query, only while a web page polls; no resident helper.
    const {stdout}=await run('tasklist.exe',['/FI','IMAGENAME eq consent.exe','/FO','CSV','/NH'],{windowsHide:true,timeout:5000});
    cached={supported:true,installed:!!config(),needsAttention:/"consent\.exe"/i.test(stdout)};
    checkedAt=Date.now();return {...cached,operation,error:lastError};
  })().finally(()=>{checking=null});
  return checking;
}
async function install(){
  if(operation)throw Error('正在等待电脑端授权。');
  if(!supported)throw Error('此功能需要 Windows 10 或以上的 x64 电脑。');
  operation='installing';lastError=null;
  try{
    fs.mkdirSync(data,{recursive:true});
    // Reuse credentials on repair; keep them independent of Codex accounts and app versions.
    const current=config()||{port:await freePort(),password:crypto.randomBytes(6).toString('base64')};
    const cipher=DESECBCipher.importKey(new Uint8Array([23,82,107,6,35,78,88,7]));
    const bytes=Buffer.from(cipher.encrypt({},Buffer.from(current.password)));
    const encrypted=bytes.toString('hex')+Buffer.from([bytes.reduce((sum,n)=>sum+n,0)&255]).toString('hex');
    const ini=path.join(data,'setup.ini');
    fs.writeFileSync(ini,`[admin]\nUseRegistry=0\nAuthRequired=1\nLoopbackOnly=1\nAllowLoopback=1\nSocketConnect=1\nHTTPConnect=0\nAutoPortSelect=0\nPortNumber=${current.port}\nFileTransferEnabled=0\nQuerySetting=2\nDisableTrayIcon=1\nSecure=0\n[ultravnc]\npasswd=${encrypted}\n[poll]\nEnableDriver=0\nEnableHook=0\nPollFullScreen=1\n`);
    const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'install.ps1'),'-Source',path.join(directory,'vendor/ultravnc'),'-Ini',ini];
    const argumentsText=args.map(a=>'"'+a+'"').join(' ');
    const script=`try{$p=Start-Process -FilePath ${quote(powershell)} -Verb RunAs -ArgumentList ${quote(argumentsText)} -Wait -PassThru -ErrorAction Stop;exit $p.ExitCode}catch{exit 1223}`;
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore'});
    const finish=error=>{try{if(!error)fs.writeFileSync(configFile,JSON.stringify(current));lastError=error}catch{lastError='启用失败，请重试并查看电脑端提示。'}finally{operation=null;cached=null}};
    child.once('error',()=>finish('无法发起 Windows 授权，请重试。'));
    child.once('exit',code=>finish(code===0?null:code===1223?'已取消电脑端授权。':'启用失败，请重试并查看电脑端提示。'));
  }catch(error){operation=null;throw error}
}
export const remoteDesktopRoutes=express.Router();
remoteDesktopRoutes.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
remoteDesktopRoutes.get('/status',async(req,res)=>{try{res.json(await desktopStatus())}catch{res.status(503).json({error:'暂时无法读取电脑状态。'})}});
remoteDesktopRoutes.post('/enable',async(req,res)=>{
  if(!sameOrigin(req))return res.sendStatus(403);
  try{await install();res.json({operation})}catch(error){res.status(409).json({error:error.message})}
});
remoteDesktopRoutes.post('/connect',(req,res)=>{
  if(!sameOrigin(req))return res.sendStatus(403);
  const current=config();if(!current)return res.status(409).json({error:'请先启用电脑画面。'});
  for(const [key,value] of tickets)if(value.expires<Date.now())tickets.delete(key);
  const ticket=crypto.randomBytes(24).toString('hex');
  tickets.set(ticket,{expires:Date.now()+15000,origin:req.headers.origin});
  res.json({ticket,password:current.password});
});
remoteDesktopRoutes.use('/novnc',express.static(path.join(directory,'vendor/novnc'),{dotfiles:'deny'}));
export function handleRemoteDesktop(ws,req){
  const url=new URL(req.url,'http://localhost'),ticket=url.searchParams.get('token'),grant=tickets.get(ticket);
  tickets.delete(ticket);
  const current=config();
  if(!grant||grant.expires<Date.now()||grant.origin!==req.headers.origin||!sameOrigin(req)||!current){ws.close(1008);return}
  const tcp=net.connect(current.port,'127.0.0.1');
  const close=()=>{tcp.destroy();if(ws.readyState===1)ws.close()};
  tcp.setTimeout(5000,close);tcp.once('connect',()=>tcp.setTimeout(0));
  ws.on('message',bytes=>{if(tcp.writableLength>4*1024*1024)return close();tcp.write(bytes)});
  tcp.on('data',bytes=>{if(ws.readyState!==1||ws.bufferedAmount>4*1024*1024)return close();ws.send(bytes)});
  ws.on('close',()=>tcp.destroy());ws.on('error',()=>tcp.destroy());
  tcp.on('error',close);tcp.on('close',()=>{if(ws.readyState===1)ws.close()});
}
