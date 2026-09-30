// Release notes are handwritten and shipped in the update manifest.
const bigaBundledRelease=__BIGA_RELEASE_NOTES__;
const bigaUpdateStyle=document.createElement('style');
bigaUpdateStyle.textContent=`
#bigaUpdate{z-index:240}
#bigaUpdate [hidden]{display:none}
#bigaUpdate .usageModal{width:min(100%,400px);max-height:calc(var(--app-height) - 40px);padding:0;border-radius:14px;overflow:auto;background:var(--popup-bg,var(--panel));color:var(--text)}
#bigaUpdate header{padding:18px 20px 12px;display:flex;justify-content:space-between;align-items:flex-start}
#bigaUpdate .releaseTitle{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}
#bigaUpdate .releaseVersion{font:11px ui-monospace,Consolas,monospace;background:var(--hover-bg);color:var(--muted);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 6px}
#bigaUpdate time{display:block;font:11px ui-monospace,Consolas,monospace;color:var(--muted);margin-top:4px}
#bigaUpdateClose{width:28px;height:28px;padding:0;border:0;background:transparent;color:var(--muted);font-size:22px;line-height:1}
#bigaUpdate .releaseBody{padding:0 20px 16px;font-size:13px;line-height:1.5}
#bigaUpdate ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
#bigaUpdate li{display:flex;align-items:flex-start;gap:10px}
#bigaUpdate .releaseType{flex-shrink:0;font:600 10px ui-monospace,Consolas,monospace;color:var(--muted);border:1px solid var(--border-subtle);border-radius:3px;padding:2px 5px;margin-top:2px}
#bigaUpdateStatus{margin:12px 0 0;white-space:pre-wrap}
#bigaUpdate footer{padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px}
#bigaUpdate footer button{height:34px;padding:0 12px;font-size:12px;border-radius:6px}
#bigaUpdateIgnore{background:transparent;border:0;color:var(--muted)}
`;
document.head.append(bigaUpdateStyle);
const bigaBanner=document.createElement('div');
bigaBanner.id='bigaUpdate';bigaBanner.className='usageModalBackdrop hidden';
bigaBanner.innerHTML='<section class="usageModal" role="dialog" aria-modal="true" aria-labelledby="bigaUpdateTitle"><header><div><div class="releaseTitle"><span id="bigaUpdateTitle">BigaCli</span><span class="releaseVersion"></span></div><time></time></div><button id="bigaUpdateClose" type="button">×</button></header><div class="releaseBody"><ul></ul><p id="bigaUpdateStatus" role="status"></p></div><footer><button id="bigaUpdateIgnore" type="button"></button><button id="bigaUpdateInstall" type="button" class="primary"></button></footer></section>';
document.body.append(bigaBanner);
let bigaInstalling=false,bigaLoadedAppId=null,bigaDismissedVersion=null,bigaUpdateState=null;
function closeBigaUpdate(){bigaDismissedVersion=bigaUpdateState?.available?.version||'active';setOverlay(bigaBanner,false)}
$('bigaUpdateClose').onclick=closeBigaUpdate;
bigaBanner.onclick=e=>{if(e.target===bigaBanner)closeBigaUpdate()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!bigaBanner.classList.contains('hidden')){e.preventDefault();closeBigaUpdate()}});
$('bigaUpdateIgnore').onclick=()=>{localStorage.setItem('bigacli-ignored-update',bigaUpdateState.available.version);closeBigaUpdate()};
$('bigaUpdateInstall').onclick=()=>bigaStatus('install');
function renderBigaUpdate(s){
 const available=s.available,active=s.phase!=='idle';
 const notes=available?.releaseNotes||(available?.version===bigaBundledRelease.version?bigaBundledRelease:null);
 bigaBanner.querySelector('.releaseVersion').textContent='v'+(available?.version||s.version);
 const date=bigaBanner.querySelector('time');date.textContent=notes?.date||'';date.hidden=!date.textContent;
 const list=bigaBanner.querySelector('ul');list.replaceChildren();
 for(const item of notes?.items||[]){const li=document.createElement('li'),type=document.createElement('span'),desc=document.createElement('span');type.className='releaseType';type.textContent=item.type;desc.textContent=item.text?.[BigaI18n.language]||item.text?.['zh-CN']||'';li.append(type,desc);list.append(li)}
 const status=$('bigaUpdateStatus');status.textContent=s.error||(active?({downloading:BigaI18n.t('正在下载更新，可继续聊天…'),waiting:BigaI18n.t('更新已下载，等待当前任务完成…'),restarting:BigaI18n.t('正在重启，稍后自动恢复…')}[s.phase]||s.phase):!notes?.items?.length?BigaI18n.t('此版本未提供更新说明'): '');status.hidden=!status.textContent;
 $('bigaUpdateClose').setAttribute('aria-label',BigaI18n.t('关闭'));
 $('bigaUpdateIgnore').textContent=BigaI18n.t('此版本不再提示');$('bigaUpdateIgnore').hidden=active||!available;
 $('bigaUpdateInstall').textContent=BigaI18n.t(s.error?'重试更新':'立即更新');$('bigaUpdateInstall').disabled=active;$('bigaUpdateInstall').hidden=!available;
}
async function bigaStatus(action='status'){
 try{
  if(action==='install')$('bigaUpdateInstall').disabled=true;
  const r=await api('/api/bigacli/update/'+action,action==='status'?{}:{method:'POST',body:'{}'});
  const s=unwrap(r),active=s.phase!=='idle';
  if(s.appId){if(bigaLoadedAppId&&bigaLoadedAppId!==s.appId){location.reload();return}bigaLoadedAppId=s.appId}
  if(bigaInstalling&&!active&&!s.error){location.reload();return}
  bigaInstalling=active;bigaUpdateState=s;
  if(!s.available&&!active){setOverlay(bigaBanner,false);if(action==='check')toast(s.error?BigaI18n.t('检查更新失败：')+s.error:BigaI18n.t('已是最新版本'));return}
  renderBigaUpdate(s);
  const version=s.available?.version||'active';
  if(action!=='status'){bigaDismissedVersion=null;setOverlay(bigaBanner,true)}
  else if(bigaDismissedVersion!==version&&localStorage.getItem('bigacli-ignored-update')!==version)setOverlay(bigaBanner,true);
 }catch(e){if(bigaInstalling){$('bigaUpdateStatus').hidden=false;$('bigaUpdateStatus').textContent=BigaI18n.t('正在重启连接，稍后自动恢复…')}else {if(bigaUpdateState)renderBigaUpdate({...bigaUpdateState,error:e.message});if(action==='check')toast(BigaI18n.t('检查更新失败：')+e.message)}}
}
const bigaAbout=document.getElementById('settingsSystemInfo');
bigaAbout.innerHTML='<span>BigaCli __BIGA_VERSION__</span><button type="button" class="action-btn">'+BigaI18n.t('检查更新')+'</button>';
bigaAbout.querySelector('button').onclick=()=>bigaStatus('check');
setTimeout(()=>bigaStatus(),1500);setInterval(()=>bigaStatus(),5000);
