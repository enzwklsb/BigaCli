// Index existing component ZIP payloads for exact HTTP Range downloads.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {hash,validateIndex,bootNames}=require('../update-files.cjs');
function zipEntries(file,component){
 const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size;
 const read=(offset,length)=>{const b=Buffer.alloc(length);if(fs.readSync(fd,b,0,length,offset)!==length)throw Error('Truncated ZIP');return b};
 try{
  const tail=read(Math.max(0,size-65557),Math.min(size,65557));let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){end=i;break}
  if(end<0)throw Error('ZIP directory missing');const count=tail.readUInt16LE(end+10),offset=tail.readUInt32LE(end+16);
  if(count===65535||offset===0xffffffff)throw Error('ZIP64 index not supported by this packager');
  let at=offset;const files=[];
  for(let n=0;n<count;n++){
   const h=read(at,46);if(h.readUInt32LE(0)!==0x02014b50)throw Error('Invalid ZIP directory');
   const nameLength=h.readUInt16LE(28),extra=h.readUInt16LE(30),comment=h.readUInt16LE(32),name=read(at+46,nameLength).toString('utf8');at+=46+nameLength+extra+comment;
   if(name.endsWith('/'))continue;
   const flags=h.readUInt16LE(8),method=h.readUInt16LE(10),compressedSize=h.readUInt32LE(20),unpacked=h.readUInt32LE(24),local=h.readUInt32LE(42);
   if(flags&1||![0,8].includes(method)||(h.readUInt32LE(38)>>>16&0xf000)===0xa000)throw Error('Unsupported ZIP entry: '+name);
   const header=read(local,30),dataOffset=local+30+header.readUInt16LE(26)+header.readUInt16LE(28);
   const compressed=read(dataOffset,compressedSize),bytes=method===8?zlib.inflateRawSync(compressed,{maxOutputLength:Math.max(1,unpacked)}):compressed;
   if(bytes.length!==unpacked)throw Error('ZIP file length mismatch');
   files.push({component,path:name.replace(/^\.\//,''),size:unpacked,sha256:hash(bytes),offset:dataOffset,compressedSize,method});
  }return files;
 }finally{fs.closeSync(fd)}
}
function writeBootZip(root,target){
 const entries=[],chunks=[];let offset=0;
 // CRC32 is required by conventional ZIP readers; content integrity also uses SHA-256.
 const crc=b=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0};
 for(const name of bootNames){const bytes=fs.readFileSync(path.join(root,name)),data=zlib.deflateRawSync(bytes),filename=Buffer.from(name),check=crc(bytes);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(check,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(check,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  chunks.push(h,filename,data);entries.push(central,filename);offset+=h.length+filename.length+data.length;
 }
 const dir=Buffer.concat(entries),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(bootNames.length,8);end.writeUInt16LE(bootNames.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
 fs.writeFileSync(target,Buffer.concat([...chunks,dir,end]));
}
function buildIndex(assets,root){
 const releasePath=path.join(assets,'release.json'),m=JSON.parse(fs.readFileSync(releasePath)),base=m.components.app.url.replace(/[^/]+$/,'');
 const boot=path.join(assets,'boot-win-x64.zip');writeBootZip(root,boot);const bytes=fs.readFileSync(boot);
 m.components.boot={id:hash(bytes),sha256:hash(bytes),size:bytes.length,url:base+'boot-win-x64.zip'};
 const index={format:1,version:m.version,files:['app','deps','node','boot'].flatMap(k=>zipEntries(path.join(assets,k+'-win-x64.zip'),k))};validateIndex(index,m);
 const fileIndexes={};
 for(const k of ['app','deps','node','boot']){
  const content=zlib.gzipSync(Buffer.from(JSON.stringify(index.files.filter(f=>f.component===k)))),name=k+'-files.json.gz';
  fs.writeFileSync(path.join(assets,name),content);fileIndexes[k]={url:base+name,size:content.length,sha256:hash(content)};
 }
 const content=Buffer.from(JSON.stringify({format:1,version:m.version,fileIndexes}));fs.writeFileSync(path.join(assets,'files.json'),content);
 m.fileIndex={url:base+'files.json',size:content.length,sha256:hash(content)};m.fileIndexes=fileIndexes;fs.writeFileSync(releasePath,JSON.stringify(m,null,2));return m;
}
if(require.main===module)buildIndex(path.resolve(process.argv[2]),path.resolve(__dirname,'..'));
module.exports={zipEntries,writeBootZip,buildIndex};
