// Presentation adapter only: upstream retains parsing, filtering, extraction and rendering.
window.BigaPreviewUI = function(container){
  const root=container.shadowRoot||container;
  const style=document.createElement('style');style.textContent=`
  .file-viewer-web-shell{--file-viewer-font:14px/1.5 var(--font-sans);--file-viewer-text:var(--text);--file-viewer-bg:var(--bg);--file-viewer-content-bg:var(--panel);background:var(--bg)!important;color:var(--text)!important}
  button{border-radius:var(--button-radius,8px)!important;font-size:12px!important}
  *{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}
  .archive-shell.archive-viewer{display:grid!important;grid-template-columns:290px minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important;gap:12px!important;padding:12px 16px!important;background:var(--bg)!important;color:var(--text)!important}
  .archive-sidebar{background:transparent!important;padding:0 12px 0 0!important;gap:8px!important;border-color:var(--border-subtle)!important}
  .archive-head-main>span,.archive-head-main>strong,.archive-sidebar-toggle,.archive-preview-title>span{display:none!important}
  .archive-head p{font-size:12px!important;color:var(--muted)!important;margin:0!important}
  .archive-search{height:36px!important;min-height:36px!important;border:1px solid var(--border-subtle)!important;border-radius:8px!important;background:var(--panel)!important;color:var(--text)!important;font-size:14px!important}
  .archive-list{gap:0!important;scrollbar-width:thin}
  .archive-entry{position:relative!important;min-height:34px!important;flex-shrink:0!important;display:flex!important;align-items:center!important;gap:6px!important;margin:0!important;padding:0 8px 0 12px!important;background:transparent!important;border:0!important;box-shadow:none!important;color:var(--text)!important;border-radius:0!important}
  .archive-entry.active::before{content:'';position:absolute;left:2px;top:5px;bottom:5px;width:2.5px;background:var(--text);border-radius:2px}
  .archive-entry .entry-ext{display:none!important}
  .bigaMonoIcon{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
  .archive-entry,.archive-entry strong{transition:color .2s ease,background-color .2s ease}
  .archive-nested-target>*{animation:bigaPreviewEnter .24s ease both}
  @keyframes bigaPreviewEnter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.archive-nested-target>*{animation:none}}
  .archive-entry .entry-copy{flex:1;min-width:0}.archive-entry strong{font-size:14px!important;font-weight:400!important;color:var(--muted)!important}.archive-entry.active strong{font-weight:600!important;color:var(--text)!important}
  .archive-entry em{display:none!important}.archive-entry small{font-size:12px!important;color:var(--muted)!important}
  .bigaArchiveFolder{flex-shrink:0}.bigaArchiveFolder>summary{height:34px;display:flex;align-items:center;gap:6px;padding-left:12px;cursor:pointer;font:14px/1.5 var(--font-sans);color:var(--muted)}
  .bigaArchiveFolder>summary::before{display:none}.bigaArchiveFolder>div{padding-left:20px}
  .bigaArchiveFolder>summary{font-size:13.5px;list-style:none}.bigaArchiveFolder>summary::-webkit-details-marker{display:none}
  .archive-list{position:relative!important;padding:0 4px 0 0!important;overflow-anchor:none}
  .archive-entry{width:100%!important;height:34px!important;min-height:34px!important;overflow:visible!important;transition:color 120ms ease!important}
  .archive-entry.active::before{left:calc(2px - var(--biga-depth,0)*20px)!important}
  .archive-entry .bigaMonoIcon{color:var(--muted)}.archive-entry.active .bigaMonoIcon{color:var(--text)}
  .archive-entry strong{font-size:13.5px!important}.archive-entry small{font-size:11.5px!important;margin-left:8px!important}
  .archive-state{display:none!important}
  .bigaArchiveSearch{grid-column:1/-1;display:flex;align-items:center;gap:10px;min-width:0}
  .bigaArchiveSearch input{flex:1;min-width:0;width:0!important;font-size:13.5px!important;padding:0 10px!important}
  .bigaArchiveSearch p{font-size:12px;white-space:nowrap;color:var(--muted);margin:0}
  .archive-shell.archive-viewer{grid-template-rows:36px minmax(0,1fr)!important}
  .archive-sidebar{grid-row:2!important}.archive-preview{grid-row:2!important}
  .archive-preview{background:var(--panel)!important;border:1px solid var(--border-subtle)!important;border-radius:16px!important;overflow:hidden!important}
  .archive-preview-toolbar{padding:8px 12px!important;min-height:44px!important;background:transparent!important;border-color:var(--border-subtle)!important}
  .archive-preview-title{min-width:0;flex:1}.archive-preview-title strong{font-size:13px!important;color:var(--text)!important;margin:0!important}
  .archive-download-button{background:var(--action-bg)!important;color:var(--action-fg)!important;border:1px solid transparent!important;height:28px!important;box-shadow:none!important;font-weight:500!important;transition:background-color .15s ease}
  .archive-download-button:hover{background:color-mix(in srgb,var(--action-bg) 88%,var(--panel))!important}
  .archive-nested-target{background:transparent!important;padding:12px!important}
  .markdown-body{font-size:14px!important;background:transparent!important;color:var(--text)!important;padding:0!important;box-shadow:none!important;border:0!important}.markdown-body h1,.markdown-body h2{font-size:18px!important}
  @media(max-width:767px){.archive-shell.archive-viewer{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:36px minmax(0,240px) minmax(0,1fr)!important}.archive-sidebar{grid-column:1!important;grid-row:2!important;padding:0!important;border:0!important}.archive-preview{grid-column:1!important;grid-row:3!important}}
  `;root.appendChild(style);
  const lists=new Map(),folderState=new Map();let savedScroll=0;
  const icon=folder=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.classList.add('bigaMonoIcon');svg.innerHTML=folder?'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>':'<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>';return svg};
  function group(list){
    const entries=[...list.querySelectorAll('.archive-entry')];if(!entries.length)return;
    const observer=lists.get(list);observer?.disconnect();
    for(const d of list.querySelectorAll('details'))folderState.set(d.dataset.path,d.open);
    const fragment=document.createDocumentFragment(),folders=new Map();
    for(const entry of entries){const parts=entry.title.split('/').filter(Boolean);parts.pop();let parent=fragment,key='';
      for(const part of parts){key+=part+'/';if(!folders.has(key)){const folder=document.createElement('details');folder.className='bigaArchiveFolder';folder.dataset.path=key;folder.open=folderState.get(key)??true;const label=document.createElement('summary');label.append(icon(true),document.createTextNode(part+'/'));const children=document.createElement('div');folder.append(label,children);folder.ontoggle=()=>folderState.set(folder.dataset.path,folder.open);parent.appendChild(folder);folders.set(key,children)}parent=folders.get(key)}
      entry.style.setProperty('--biga-depth',parts.length);if(!entry.querySelector('.bigaMonoIcon'))entry.prepend(icon(false));
      parent.appendChild(entry);
    }
    list.replaceChildren(fragment);list.scrollTop=savedScroll;observer?.observe(list,{childList:true});
  }
  function scan(){
    const shell=root.querySelector('.archive-shell'),search=root.querySelector('.archive-search'),stats=root.querySelector('.archive-head p,.bigaArchiveSearch p');
    if(shell&&search&&!shell.querySelector('.bigaArchiveSearch')){const bar=document.createElement('div');bar.className='bigaArchiveSearch';search.placeholder=BigaI18n.t("筛选文件路径 (如: src/components)...");bar.append(search);if(stats)bar.append(stats);shell.prepend(bar);const head=shell.querySelector('.archive-head');if(head)head.style.display='none';}
    if(stats&&stats.textContent.split(' · ').length>2)stats.textContent=stats.textContent.split(' · ').slice(0,2).join(' · ');
    for(const title of root.querySelectorAll('.archive-preview-title strong'))if(title.title&&title.textContent!==title.title)title.textContent=title.title;
    for(const list of root.querySelectorAll('.archive-list')){if(lists.has(list))continue;list.addEventListener('click',()=>{savedScroll=list.scrollTop},true);list.addEventListener('scroll',()=>{savedScroll=list.scrollTop},{passive:true});const observer=new MutationObserver(()=>group(list));lists.set(list,observer);group(list);observer.observe(list,{childList:true})}}
  const watcher=new MutationObserver(scan);watcher.observe(root,{childList:true,subtree:true});scan();
  return ()=>{watcher.disconnect();for(const observer of lists.values())observer.disconnect();style.remove()};
};
