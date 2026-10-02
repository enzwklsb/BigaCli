import { getConnection } from '../../database/index.js';

function database(){
    const db=getConnection();
    db.exec(`CREATE TABLE IF NOT EXISTS biga_interrupted_replies (
      session_id TEXT NOT NULL, thread_id TEXT NOT NULL, item_id TEXT NOT NULL,
      timestamp TEXT NOT NULL, content TEXT NOT NULL, phase TEXT, kind TEXT NOT NULL,
      PRIMARY KEY(session_id,thread_id,item_id))`);
    return db;
}
export function captureInterruptedPart(parts,message){
    if(!['stream_delta','stream_end'].includes(message.kind)||!message.itemId)return;
    // Completed items are already handled by the native transcript; retain only unfinished streams.
    if(message.kind==='stream_end'){parts.delete(message.itemId);return;}
    const old=parts.get(message.itemId);
    const content=message.kind==='stream_end'&&typeof message.content==='string'
      ?message.content:(old?.content||'')+(message.content||'');
    parts.set(message.itemId,{...message,content,timestamp:old?.timestamp||message.timestamp||new Date().toISOString()});
}
export function saveInterruptedReplies(sessionId,threadId,parts){
    if(!sessionId||!threadId||!parts.size)return;
    const db=database(),write=db.prepare('INSERT OR REPLACE INTO biga_interrupted_replies VALUES (?,?,?,?,?,?,?)');
    db.transaction(()=>{for(const [id,m] of parts){if(m.content?.trim())write.run(sessionId,threadId,id,m.timestamp,m.content,m.phase||null,m.messageKind||'text')}})();
}
export function mergeInterruptedReplies(sessionId,threadId,messages){
    const rows=database().prepare('SELECT * FROM biga_interrupted_replies WHERE session_id=? AND thread_id=? ORDER BY timestamp').all(sessionId,threadId);
    for(const row of rows){
        // Completed native items remain authoritative. Limit content fallback to this item's time window.
        if(messages.some(m=>m.uuid===row.item_id||m.type===(row.kind==='thinking'?'thinking':'assistant')&&
          Math.abs(Date.parse(m.timestamp)-Date.parse(row.timestamp))<60000&&m.message?.content===row.content))continue;
        messages.push({uuid:row.item_id,interrupted:true,type:row.kind==='thinking'?'thinking':'assistant',timestamp:row.timestamp,
          phase:row.phase,message:{role:'assistant',content:row.content}});
    }
    if(rows.length)messages.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    return messages;
}
