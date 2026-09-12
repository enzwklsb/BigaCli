// Substitute release transport only; all updater download/hash/extract/restart code stays real.
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
const original=globalThis.fetch;
const assets=process.env.BIGA_TEST_ASSETS;
const manifest=JSON.parse(fs.readFileSync(path.join(assets,'release.json')));
globalThis.fetch=async(url,options)=>{
 const address=String(url);
 if(address==='https://github.com/enzwklsb/BigaCli/releases/latest/download/release.json')return Response.json(manifest);
 for(const [name,component] of Object.entries(manifest.components))if(address===component.url){
  fs.appendFileSync(process.env.BIGA_TEST_DOWNLOAD_LOG,name+'\n');
  return new Response(Readable.toWeb(fs.createReadStream(path.join(assets,name+'-win-x64.zip'))));
 }
 return original(url,options);
};
