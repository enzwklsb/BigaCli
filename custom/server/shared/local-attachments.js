import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const store=()=>path.join(os.homedir(),'.cloudcli','local-attachments.json');
function read(){try{return JSON.parse(fs.readFileSync(store(),'utf8'))}catch(error){if(error.code==='ENOENT')return [];throw error}}
export function isRegisteredLocalAttachment(file){return path.isAbsolute(file)&&read().includes(path.resolve(file))}
export function registerLocalAttachments(files){const paths=new Set(read());for(const file of files)paths.add(path.resolve(file));fs.mkdirSync(path.dirname(store()),{recursive:true});fs.writeFileSync(store()+'.tmp',JSON.stringify([...paths]));fs.renameSync(store()+'.tmp',store())}
