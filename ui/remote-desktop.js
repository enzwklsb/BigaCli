// User-operated screen sharing, separate from the Agent's desktop tools.
const t=(key)=>window.BigaI18n.t(key);
// Device type, not viewport width: include desktop-mode iPads, exclude touch PCs.
const desktopUserAgent=navigator.userAgent;
const desktopPlatform=navigator.userAgentData?.platform||navigator.platform||'';
const desktopAvailable=!/Windows|Win32|Win64/i.test(desktopUserAgent+' '+desktopPlatform)&&(/Android|iPhone|iPad|iPod/i.test(desktopUserAgent)||(/Mac/i.test(desktopPlatform)&&navigator.maxTouchPoints>1));
document.getElementById('remoteDesktopButton').hidden=!desktopAvailable;
const style=document.createElement('style');
style.textContent=`#remoteDesktopNotice{position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:89;max-width:90vw;padding:10px 16px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--panel);color:var(--text)}
#remoteDesktopPanel{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;height:var(--drawer-height,var(--app-height));background:var(--popup-shade);touch-action:none;overscroll-behavior:contain}#remoteDesktopPanel[hidden],#remoteDesktopNotice[hidden]{display:none}
#remoteDesktopStatus{padding:8px 20px;font-size:12px;color:var(--muted);margin:0;overflow-wrap:anywhere}#remoteDesktopSetup{padding:16px;font-size:14px;line-height:1.6}#remoteDesktopScreen{flex:1;min-height:0;overflow:auto;background:transparent}#remoteDesktopButton{display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--text);padding:8px}`;
document.head.append(style);
style.textContent+='#remoteDesktopButton[hidden]{display:none}';
style.textContent+='#remoteDesktopScreen{min-width:0;overflow:hidden}#remoteDesktopScreen,#remoteDesktopScreen *{touch-action:none;overscroll-behavior:contain}';
const panel=document.createElement('div');panel.id='remoteDesktopPanel';panel.className='usageModalBackdrop';panel.hidden=true;
panel.innerHTML='<section class="usageModal" role="dialog" aria-modal="true" aria-labelledby="remoteDesktopTitle"><div class="conversationFilesHead"><span id="remoteDesktopTitle"></span></div><p id="remoteDesktopStatus" role="status"></p><div id="remoteDesktopSetup"><p id="remoteDesktopHelp"></p><button id="remoteDesktopEnable" type="button"></button></div><div id="remoteDesktopScreen"></div></section>';
const notice=document.createElement('button');notice.id='remoteDesktopNotice';notice.hidden=true;notice.type='button';
document.body.append(panel,notice);
const el=id=>document.getElementById(id);let rfb=null,epoch=0,lastAttention=false,status=null,connecting=false,failed=false;
function label(id,key){el(id).textContent=t(key);if(id==='remoteDesktopStatus')el(id).hidden=false}
function enableLocalGestures(client){
 // noVNC 1.7.0's display scale also maps pointer coordinates back to the desktop.
 // Keep that mapping intact instead of applying a separate CSS transform.
 const screen=client._screen,canvas=client._canvas,display=client._display;
 const updateScale=client._updateScale.bind(client);
 let scale=null,gesture=null,midpoint=null;
 const fit=()=>Math.min(screen.clientWidth/canvas.width,screen.clientHeight/canvas.height);
 client._updateScale=()=>{
  if(scale===null){updateScale();return}
  scale=Math.max(fit(),Math.min(4,scale));display.scale=scale;
 };
 function zoom(next,x,y,anchor){
  const before=canvas.getBoundingClientRect(),old=display.scale;
  const point=anchor||{x:(x-before.left)/old,y:(y-before.top)/old};
  scale=next;client._updateScale();
  const after=canvas.getBoundingClientRect();
  screen.scrollLeft+=after.left+point.x*display.scale-x;
  screen.scrollTop+=after.top+point.y*display.scale-y;
 }
 canvas.addEventListener('touchmove',event=>{
  if(event.touches.length===2){const [a,b]=event.touches;midpoint={x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2}}
 },{capture:true,passive:true});
 function handle(event){
  const d=event.detail;if(d.type!=='pinch'&&d.type!=='twodrag')return;
  event.stopImmediatePropagation();
  if(event.type==='gesturestart'){
   const rect=canvas.getBoundingClientRect();
   gesture={scale:display.scale,distance:Math.max(1,Math.hypot(d.magnitudeX,d.magnitudeY)),x:(d.clientX-rect.left)/display.scale,y:(d.clientY-rect.top)/display.scale,dx:0,dy:0};
  }else if(event.type==='gesturemove'&&gesture){
   if(d.type==='pinch'){
    const center=midpoint||{x:d.clientX,y:d.clientY};
    zoom(gesture.scale*Math.hypot(d.magnitudeX,d.magnitudeY)/gesture.distance,center.x,center.y,gesture);
   }else{
    screen.scrollLeft-=d.magnitudeX-gesture.dx;screen.scrollTop-=d.magnitudeY-gesture.dy;
    gesture.dx=d.magnitudeX;gesture.dy=d.magnitudeY;
   }
  }else if(event.type==='gestureend'){gesture=null;midpoint=null}
 }
 for(const type of ['gesturestart','gesturemove','gestureend'])canvas.addEventListener(type,handle,true);
}
async function request(route,method='GET'){
 const response=await fetch('/api/remote-desktop/'+route,{method,headers:method==='POST'?{'Content-Type':'application/json'}:undefined,body:method==='POST'?'{}':undefined});
 const value=await response.json();if(!response.ok)throw Error(t(value.error||'电脑画面连接失败，请重试。'));return value;
}
function disconnect(){epoch++;connecting=false;failed=false;rfb?.disconnect();rfb=null;el('remoteDesktopScreen').replaceChildren()}
function close(){panel.hidden=true;disconnect();notice.hidden=!status?.needsAttention;el('remoteDesktopButton').focus()}
async function connect(){
 if(!desktopAvailable)return;
 if(connecting||rfb||failed)return;const current=++epoch;connecting=true;label('remoteDesktopStatus','正在连接电脑画面…');
 try{
  const [{default:RFB},credentials]=await Promise.all([import('/api/remote-desktop/novnc/core/rfb.js'),request('connect','POST')]);
  if(current!==epoch||panel.hidden)return;
  const url=new URL('/remote-desktop',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('token',credentials.ticket);
  rfb=new RFB(el('remoteDesktopScreen'),url.href,{credentials:{password:credentials.password}});
  rfb.scaleViewport=true;rfb.resizeSession=false;rfb.showDotCursor=true;rfb.background='transparent';
  enableLocalGestures(rfb);
  rfb.addEventListener('connect',()=>{if(current===epoch){label('remoteDesktopStatus','已连接，可直接点击电脑画面。');el('remoteDesktopStatus').hidden=true}});
  rfb.addEventListener('disconnect',()=>{if(current===epoch){rfb=null;failed=true;el('remoteDesktopScreen').replaceChildren();label('remoteDesktopStatus','连接已断开，请重试；仍失败时可重新启用。');el('remoteDesktopSetup').hidden=false;label('remoteDesktopEnable','重新启用')}});
  rfb.addEventListener('securityfailure',()=>{if(current===epoch)label('remoteDesktopStatus','电脑画面连接失败，请重试。')});
 }catch(error){if(current===epoch){failed=true;el('remoteDesktopStatus').textContent=error.message}}
 finally{if(current===epoch)connecting=false}
}
function render(){
 el('remoteDesktopStatus').hidden=!!rfb&&rfb._rfbConnectionState==='connected'&&!status?.error&&!status?.operation;
 label('remoteDesktopTitle','电脑桌面');
 label('remoteDesktopHelp','首次启用需在电脑端允许一次 Windows 授权。之后可在这里查看和点击授权弹窗。小型桌面服务随 Windows 启动，仅监听本机，不改变 Agent 权限。');
 el('remoteDesktopSetup').hidden=!!status?.installed&&!status?.error&&!failed;
 label('remoteDesktopEnable',status?.operation?'正在等待电脑端授权。':status?.installed?'重新启用':'启用电脑画面');
 el('remoteDesktopEnable').disabled=!!status?.operation||status?.supported===false;
 if(status?.supported===false)label('remoteDesktopStatus','此功能需要 Windows 10 或以上的 x64 电脑。');
 else if(status?.error)el('remoteDesktopStatus').textContent=t(status.error);
 else if(status?.operation)label('remoteDesktopStatus','正在等待电脑端授权。');
 else if(!status?.installed)label('remoteDesktopStatus','请先启用电脑画面。');
 label('remoteDesktopNotice','电脑有授权窗口待处理，点击查看');
}
async function refresh(){
 if(!desktopAvailable)return;
 try{
  status=await request('status');
  if(document.hidden)return;
  const attention=status.needsAttention===true;
  notice.hidden=!attention||!panel.hidden;
  if(attention&&!lastAttention&&status.installed&&panel.hidden)open();
  lastAttention=attention;
  if(!panel.hidden){render();if(status.installed&&!status.operation&&!status.error)await connect()}
 }catch(error){if(!panel.hidden)el('remoteDesktopStatus').textContent=error.message}
}
function open(){if(!desktopAvailable)return;panel.hidden=false;notice.hidden=true;render();void refresh()}
window.BigaDesktop={open,available:desktopAvailable};
el('remoteDesktopButton').onclick=open;notice.onclick=open;
panel.addEventListener('click',event=>{if(event.target===panel)close()});
el('remoteDesktopEnable').onclick=async()=>{el('remoteDesktopEnable').disabled=true;try{disconnect();await request('enable','POST');await refresh()}catch(error){el('remoteDesktopStatus').textContent=error.message;el('remoteDesktopEnable').disabled=false}};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();event.stopImmediatePropagation()}},true);
window.addEventListener('pagehide',disconnect);
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else void refresh()});
if(desktopAvailable){setInterval(()=>{if(!document.hidden)void refresh()},2500);void refresh();}
