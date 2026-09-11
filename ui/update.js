// Authenticated polling keeps already-open pages informed without a page refresh.
const bigaBanner=document.createElement('div');
bigaBanner.id='bigaUpdate';bigaBanner.style.cssText='display:none;position:fixed;top:70px;left:50%;transform:translateX(-50%);width:min(90vw,430px);z-index:10000;background:#fff8d9;border:1px solid #bbb;padding:12px;border-radius:10px;font-size:15px;box-shadow:0 3px 15px #0002';
document.body.appendChild(bigaBanner);
let bigaInstalling=false;
async function bigaStatus(action='status'){
 if(!token())return;
 try{
  const r=await api('/api/bigacli/update/'+action,action==='status'?{}:{method:'POST',body:'{}'});
  const s=unwrap(r),active=s.phase!=='idle';
  if(bigaInstalling&&!active&&!s.error){location.reload();return}
  bigaInstalling=active;
  if(!s.available&&!active){bigaBanner.style.display='none';return}
  bigaBanner.style.display='block';bigaBanner.replaceChildren();
  const label=document.createElement('span');label.textContent=active?({downloading:'正在下载更新，可继续聊天…',waiting:'更新已下载，等待当前任务完成…',restarting:'正在重启，稍后自动恢复…'}[s.phase]||s.phase):'BigaCli '+s.available.version+' 可更新';bigaBanner.append(label);
  if(s.error){const p=document.createElement('p');p.textContent=s.error;bigaBanner.append(p)}
  if(!active){const btn=document.createElement('button');btn.textContent=s.error?'重试更新':'下载并更新';btn.style.marginLeft='12px';btn.onclick=()=>bigaStatus('install');bigaBanner.append(btn)}
 }catch(e){if(bigaInstalling){bigaBanner.style.display='block';bigaBanner.textContent='正在重启连接，稍后自动恢复…'}}
}
const bigaAbout=document.createElement('div');bigaAbout.style.cssText='padding:12px;font-size:14px';
bigaAbout.innerHTML='<span>BigaCli __BIGA_VERSION__</span> · <a href="https://github.com/enzwklsb/BigaCli" target="_blank" rel="noopener">源码 / AGPL-3.0</a> · <button type="button">检查更新</button>';
bigaAbout.querySelector('button').onclick=async()=>{await bigaStatus('check');if(bigaBanner.style.display==='none')toast('已是最新版本，或暂时无法检查更新')};
document.querySelector('.settingsCard').appendChild(bigaAbout);
setTimeout(()=>bigaStatus(),1500);setInterval(()=>bigaStatus(),5000);
