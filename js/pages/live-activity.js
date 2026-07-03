import { db, auth } from "../api/firebase.js";
import {
  ref, set, get, remove, onValue, onDisconnect
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════
let uid=null,did=null;
let devW=1080,devH=2340,phoneW=300,phoneH=650,scX=1,scY=1;
let tapOn=false,swOn=false,bpOn=false,pdOn=false,cklOn=false,labelOn=false;
let autoScanOn=false,autoScanPosOn=false;
let autoTimer=null,autoAnimTimer=null,autoFrame=0;
let swStart=null,curSnap=null;
let progTimer=null,progVal=0;
let pendingAction=null,resultUnsub=null;
let pingTs=0,durTimer=null;
let lastPrevPkg='',lastPrevEl=0,lastPrevClk=0;

// In-memory (Rule 3 — no localStorage ever)
let memSnaps=[],memClicks=[],memSessions=[],memStats={totalClicks:0,totalSnaps:0,byPkg:{},byHour:{}};
let memCurrentSnap=null,currentSessionId=null,sessionStartTime=0,sessionSnapCount=0,sessionClickCount=0;

// A11y state
let a11yActive=false,a11yFilter='all';
let currentClickables=[],currentElements=[];

// Firebase unsubs
let unMeta=null,unLive=null,unLastClick=null;

// Timing for connection timeline
const timing={};
function recTiming(k){timing[k]=Date.now()}

// History state
let clickHistory=[],clickHistFiltered=[],pkgFilter='all',histSearch='',histLoaded=false;
let selSessId=null,sessEntries=[],sessDurTimer=null,sessSnapUnsub=null;

// ════════════════════════════════════════════
//  DOM HELPERS
// ════════════════════════════════════════════
const g=id=>document.getElementById(id);
const pf=g('pf'),pfs=g('pfs');
const bpSvg=g('bpSvg'),pdLayer=g('pdLayer'),cklLayer=g('cklLayer'),ehc=g('ehc'),swCvs=g('swCvs');

// Expose to window for inline onclick
const expo=['sendCmd','setRTab','confirmClear','closeDlg','doDlgAction','toggleInteract',
 'toggleBp','togglePd','toggleCklOverlay','toggleAutoScan','toggleAutoScanPos',
 'cmdReadScreen','cmdReadScreenPos','cmdStartReader','cmdStopReader','cmdScreenOn','doPing',
 'loadSessions','backToSessions','filterHistory','setPkgFilter','exportHistory',
 'toggleLabel','g','copyTxt','mobileShowLive','mobileShowDrawer','setDrawerTab',
 'toggleDrawer','closeElemSheet','toggleA11y','setA11yFilter','renderA11yList',
 'tapElementA11y','toggleCklSection','loadSnapPhone'];
expo.forEach(k=>window[k]=eval(k));

// ════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const tFmt=ms=>ms?new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const tLong=ms=>ms?new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const durFmt=ms=>{const s=Math.floor(ms/1000);return`${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`};
const shortPkg=p=>p?p.split('.').pop():'?';
const shortCls=c=>c?c.split('.').pop():'';

function toast(ico,msg,ms=2500,type=''){
  const el=g('toast');
  el.className='on'+(type?' t'+type:'');
  g('tIco').textContent=ico;g('tMsg').textContent=msg;
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>el.className='',ms);
}
function setStatus(t){g('topStatus').textContent=t}
function setBbR(t){g('bbResult').textContent=t}

function startProg(){
  progVal=0;g('progFill').style.width='0%';
  clearInterval(progTimer);
  progTimer=setInterval(()=>{progVal=progVal<80?progVal+Math.random()*6:progVal;g('progFill').style.width=progVal+'%'},200);
}
function stopProg(){
  clearInterval(progTimer);
  g('progFill').style.width='100%';
  setTimeout(()=>g('progFill').style.width='0%',400);
}

function animBump(id){
  const el=g(id);if(!el)return;
  el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');
  setTimeout(()=>el.classList.remove('bump'),400);
}

// ════════════════════════════════════════════
//  FIREBASE PATHS
// ════════════════════════════════════════════
function rp(sub){return ref(db,sub?`users/${uid}/devices/${did}/reader/${sub}`:`users/${uid}/devices/${did}/reader`)}

// ════════════════════════════════════════════
//  PHONE SIZING
// ════════════════════════════════════════════
function sizePf(w,h){
  devW=w||1080;devH=h||2340;
  const canvas=g('phoneCanvas');if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  const isMobile=window.innerWidth<=900;
  let fw,fh;
  if(isMobile){
    fw=rect.width;fh=rect.height;
  } else {
    const maxH=rect.height-28,maxW=Math.min(rect.width*.52,300);
    const ar=devH/devW;
    fw=maxW;fh=fw*ar;
    if(fh>maxH){fh=maxH;fw=fh/ar}
  }
  phoneW=Math.round(fw);phoneH=Math.round(fh);
  scX=phoneW/devW;scY=phoneH/devH;
  pf.style.width=isMobile?'100%':phoneW+'px';
  pf.style.height=isMobile?'100%':phoneH+'px';
  pfs.style.width=isMobile?'100%':phoneW+'px';
  pfs.style.height=isMobile?'100%':phoneH+'px';
  swCvs.width=phoneW;swCvs.height=phoneH;
  bpSvg.style.width=isMobile?'100%':phoneW+'px';
  bpSvg.style.height=isMobile?'100%':phoneH+'px';
  if(bpOn&&curSnap)renderBp(curSnap);
  if(pdOn&&curSnap)renderPd(curSnap);
  if(cklOn)renderCklOverlay();
}
window.addEventListener('resize',()=>{
  const pfw=g('pfWrap');
  if(pfw)sizePf(devW,devH);
});

// ════════════════════════════════════════════
//  TAB MANAGEMENT
// ════════════════════════════════════════════
function setRTab(t){
  ['inspect','clicks','a11y','sessions','history'].forEach(id=>{
    g('rtab-'+id)?.classList.toggle('on',id===t);
    g('rpane-'+id)?.classList.toggle('on',id===t);
  });
  if(t==='sessions')loadSessions();
  if(t==='history')loadHistoryLazy();
  if(t==='a11y')renderA11yList();
}

// ════════════════════════════════════════════
//  MOBILE
// ════════════════════════════════════════════
let drawerOpen=false;
let currentDrawerTab='clicks';

function mobileShowLive(){
  ['mn-live','mn-clicks','mn-a11y','mn-sessions','mn-device'].forEach(id=>g(id)?.classList.remove('on'));
  g('mn-live')?.classList.add('on');
  g('mobileDrawer')?.classList.remove('open');
  drawerOpen=false;
}

function mobileShowDrawer(tab){
  ['mn-live','mn-clicks','mn-a11y','mn-sessions','mn-device'].forEach(id=>g(id)?.classList.remove('on'));
  g('mn-'+tab)?.classList.add('on');
  setDrawerTab(tab);
  g('mobileDrawer')?.classList.add('open');
  drawerOpen=true;
}

function toggleDrawer(){
  drawerOpen=!drawerOpen;
  g('mobileDrawer')?.classList.toggle('open',drawerOpen);
}

function setDrawerTab(tab){
  currentDrawerTab=tab;
  ['clicks','a11y','sessions','device','history'].forEach(t=>{
    g('dtab-'+t)?.classList.toggle('on',t===tab);
  });
  renderDrawerContent(tab);
}

function renderDrawerContent(tab){
  const body=g('drawerBody');if(!body)return;
  if(tab==='device'){
    body.innerHTML=`
      <div class="ins-pane">
        <div class="ins-sec">
          <div class="ins-title">Connection</div>
          <div class="ins-row"><span class="ins-k">Status</span><span class="ins-v m" id="mIStatus">${g('iStatus')?.textContent||'—'}</span></div>
          <div class="ins-row"><span class="ins-k">Mode</span><span class="ins-v a">🔥 Firebase</span></div>
          <div class="ins-row"><span class="ins-k">Device</span><span class="ins-v m" id="mIModel">${g('iModel')?.textContent||'—'}</span></div>
          <div class="ins-row"><span class="ins-k">Screen</span><span class="ins-v" id="mIScreen">${g('iScreen')?.textContent||'—'}</span></div>
          <div class="ins-row"><span class="ins-k">Session</span><span class="ins-v g" id="mISessDur">${g('iSessDur')?.textContent||'—'}</span></div>
        </div>
        <div class="ins-sec">
          <div class="ins-title">Last Click</div>
          <div id="mLastClickDom" style="font-family:var(--mono);font-size:9px;color:var(--dm2)">${g('lastClickDom')?.innerHTML||'No click data'}</div>
        </div>
        <div class="ins-sec">
          <div class="ins-title">Commands</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">
            <button style="flex:1;min-width:100px;padding:10px;border-radius:10px;border:1px solid var(--bd2);background:var(--s1);color:var(--t);font-family:var(--disp);font-size:11px;font-weight:700;cursor:pointer" onclick="cmdReadScreen()">📋 Read</button>
            <button style="flex:1;min-width:100px;padding:10px;border-radius:10px;border:1px solid rgba(0,240,122,.3);background:var(--gg);color:var(--g);font-family:var(--disp);font-size:11px;font-weight:700;cursor:pointer" onclick="cmdStartReader(false)">▶ Reader</button>
            <button style="flex:1;min-width:100px;padding:10px;border-radius:10px;border:1px solid rgba(255,59,92,.3);background:var(--rg);color:var(--r);font-family:var(--disp);font-size:11px;font-weight:700;cursor:pointer" onclick="cmdStopReader()">⏹ Stop</button>
            <button style="flex:1;min-width:100px;padding:10px;border-radius:10px;border:1px solid rgba(192,79,255,.3);background:var(--pg);color:var(--p);font-family:var(--disp);font-size:11px;font-weight:700;cursor:pointer" onclick="toggleA11y()">♿ A11y</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
            <button style="flex:1;padding:10px;border-radius:10px;border:1px solid var(--bd);background:var(--s1);color:var(--dm);font-family:var(--disp);font-size:12px;cursor:pointer" onclick="sendCmd({action:'home'})">⬤ Home</button>
            <button style="flex:1;padding:10px;border-radius:10px;border:1px solid var(--bd);background:var(--s1);color:var(--dm);font-family:var(--disp);font-size:12px;cursor:pointer" onclick="sendCmd({action:'back'})">◀ Back</button>
            <button style="flex:1;padding:10px;border-radius:10px;border:1px solid var(--bd);background:var(--s1);color:var(--dm);font-family:var(--disp);font-size:12px;cursor:pointer" onclick="sendCmd({action:'recents'})">▣ Recent</button>
          </div>
        </div>
      </div>`;
  } else if(tab==='clicks'){
    body.innerHTML=`
      <div style="padding:4px 8px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--dm)">
        <span>Live Click Log</span><span id="mClickCount" style="color:var(--c)">${memClicks.length}</span>
      </div>
      <div id="mClickFeed" style="padding:0"></div>`;
    const feed=g('mClickFeed');if(!feed)return;
    const frag=document.createDocumentFragment();
    memClicks.slice(0,40).forEach(c=>{
      const lb=c.lb||c.txt||c.d||'?';
      const div=document.createElement('div');
      div.className='click-item';
      div.style.padding='10px 14px';
      div.innerHTML=`
        <div class="ci-row1">
          <span class="ci-label" style="font-size:13px">${esc(lb)}</span>
          <span class="ci-time">${tFmt(c.t)}</span>
        </div>
        <div class="ci-pkg" style="font-size:10px">${esc(shortPkg(c.pkg||''))} · <span class="ci-xy">(${c.x||0},${c.y||0})</span></div>`;
      div.onclick=()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk');toast('🎯',lb.slice(0,30),1200)};
      frag.appendChild(div);
    });
    if(!memClicks.length)feed.innerHTML='<div class="dim-msg">Awaiting clicks…</div>';
    else feed.appendChild(frag);
  } else if(tab==='a11y'){
    body.innerHTML=`
      <div style="padding:10px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-family:var(--disp);font-size:14px;font-weight:700;color:var(--t3)">♿ Live Accessibility</div>
          <span class="a11y-badge" id="mA11yBadge" style="font-family:var(--mono);font-size:7px;padding:2px 7px;border-radius:20px;border:1px solid var(--bd);color:var(--dm)">${a11yActive?'LIVE':'Stopped'}</span>
        </div>
        <button onclick="toggleA11y()" style="padding:14px;border-radius:14px;border:1px solid rgba(192,79,255,.4);background:rgba(192,79,255,.1);color:var(--p);font-family:var(--disp);font-size:13px;font-weight:700;cursor:pointer;width:100%;transition:all .2s" id="mA11yBtn">${a11yActive?'⏹ Stop Live A11y':'▶ Start Live A11y'}</button>
        <div style="display:flex;gap:4px">
          <button class="a11y-filter-btn${a11yFilter==='all'?' on':''}" onclick="setA11yFilter('all',this);renderMobileA11y()">All (${currentElements.length})</button>
          <button class="a11y-filter-btn${a11yFilter==='ck'?' on':''}" onclick="setA11yFilter('ck',this);renderMobileA11y()">Clickable</button>
          <button class="a11y-filter-btn${a11yFilter==='ed'?' on':''}" onclick="setA11yFilter('ed',this);renderMobileA11y()">Editable</button>
        </div>
        ${currentClickables.length?`
        <div style="padding:8px 10px;border:1px solid rgba(0,229,255,.2);border-radius:10px;background:rgba(0,229,255,.04)">
          <div style="font-family:var(--mono);font-size:8px;color:var(--c);margin-bottom:6px">⚡ Last Click Clickables (${currentClickables.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px" id="mCklCards"></div>
        </div>`:''}
      </div>
      <div id="mA11yList" style="padding:0 10px 80px"></div>`;
    // Populate clickables
    const mCklCards=g('mCklCards');
    if(mCklCards){
      currentClickables.forEach(c=>{
        const card=document.createElement('div');
        card.className='ckl-card'+(c.ed?' ed':'');
        card.innerHTML=`<span class="ckl-card-lbl">${esc((c.lb||'?').slice(0,20))}</span><span class="ckl-card-pos">(${c.x||0},${c.y||0})</span>`;
        card.onclick=()=>{sendCmd({action:'tap',x:c.x,y:c.y});spawnRipple((c.x||0)*scX,(c.y||0)*scY,'tap');toast('✛',(c.lb||'?').slice(0,20),1200)};
        mCklCards.appendChild(card);
      });
    }
    renderMobileA11y();
  } else if(tab==='sessions'){
    body.innerHTML=`<div id="mSessContent" style="padding:10px"></div>`;
    renderMobileSessions();
  } else if(tab==='history'){
    body.innerHTML=`
      <div style="padding:8px;border-bottom:1px solid var(--bd)">
        <input class="ch-search" placeholder="Search…" oninput="window._mhSearch=this.value;renderMobileHistory()" style="width:100%"/>
      </div>
      <div id="mHistFeed" style="padding:0"></div>`;
    renderMobileHistory();
  }
}

function renderMobileA11y(){
  const listEl=g('mA11yList');if(!listEl)return;
  let items=currentElements;
  if(a11yFilter==='ck')items=items.filter(e=>e.ck||e.clickable);
  if(a11yFilter==='ed')items=items.filter(e=>e.ed||e.editable);
  const frag=document.createDocumentFragment();
  items.slice(0,80).forEach(el=>{
    const txt=el.t||el.text||'';const dsc=el.d||el.desc||'';const vi=(el.vi||'').split('/').pop();const cls=shortCls(el.cl||'');
    const label=txt||dsc||vi||cls||'?';
    const ck=el.ck||el.clickable;const ed=el.ed||el.editable;const bx=el.b||el.bounds||{};
    const div=document.createElement('div');
    div.className='a11y-item'+(ck?' ck':'')+(ed?' ed':'');
    div.style.marginBottom='6px';
    div.innerHTML=`
      <div class="ai-header"><span class="ai-label" style="font-size:13px">${esc(label.slice(0,40))}</span>${ck?'<span class="ai-tag ck">click</span>':''}${ed?'<span class="ai-tag ed">edit</span>':''}</div>
      <div class="ai-meta"><span class="ai-cls">${esc(cls)}</span><span class="ai-pos">(${Math.round(bx.x||0)},${Math.round(bx.y||0)})</span><span class="ai-size">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
      ${ck?`<button class="ai-tap-btn" style="margin-top:6px;padding:8px 16px;font-size:10px" onclick="tapElementA11y(${Math.round(bx.x||0)},${Math.round(bx.y||0)});closeElemSheet()">✛ Tap This Element</button>`:''}`;
    div.onclick=()=>showMobileElem(label,el,bx,ck,ed,cls,vi);
    frag.appendChild(div);
  });
  listEl.innerHTML='';
  if(!items.length)listEl.innerHTML='<div class="dim-msg">'+(a11yActive?'No elements found':'Start Live A11y to see elements')+'</div>';
  else listEl.appendChild(frag);
}

function renderMobileSessions(){
  const dom=g('mSessContent');if(!dom)return;
  if(!memSessions.length){
    dom.innerHTML='<div class="dim-msg">No sessions yet<br><span style="font-size:8px">Start a reader session</span></div>';
    return;
  }
  const frag=document.createDocumentFragment();
  memSessions.forEach(s=>{
    const div=document.createElement('div');div.className='sv-card';
    div.style.marginBottom='8px';
    div.innerHTML=`
      <div class="svc-top">
        <span class="svc-id">${String(s.sessionId||'').slice(-10)}</span>
        <span class="svc-badge stop">■ SAVED</span>
      </div>
      <div class="svc-row">
        <span>Duration<span class="svc-val">${durFmt(s.durationMs||0)}</span></span>
        <span>Snaps<span class="svc-val">${s.totalSnaps||0}</span></span>
        <span>App<span class="svc-val">${shortPkg(s.finalPkg||'—')}</span></span>
      </div>`;
    frag.appendChild(div);
  });
  dom.innerHTML='';dom.appendChild(frag);
}

function renderMobileHistory(){
  const dom=g('mHistFeed');if(!dom)return;
  const q=(window._mhSearch||'').toLowerCase();
  const items=clickHistory.filter(c=>!q||(c.lb||c.txt||'').toLowerCase().includes(q));
  const frag=document.createDocumentFragment();
  items.slice(0,50).forEach((c,i)=>{
    const lb=c.lb||c.txt||'?';
    const div=document.createElement('div');div.className='ch-item';div.style.padding='10px 14px';
    div.innerHTML=`<div class="ch-num">${items.length-i}</div><div class="ch-body"><div class="ch-label" style="font-size:12px">${esc(lb)}</div><div class="ch-pkg">${esc(c.pkg||'')}</div><div class="ch-meta2"><span class="ch-xy">(${c.x||0},${c.y||0})</span><span class="ch-ts">${tFmt(c.t)}</span></div></div>`;
    div.onclick=()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk');toast('🎯',lb.slice(0,30),1200)};
    frag.appendChild(div);
  });
  dom.innerHTML='';
  if(!items.length)dom.innerHTML='<div class="dim-msg">No history yet</div>';
  else dom.appendChild(frag);
}

function showMobileElem(label,el,bx,ck,ed,cls,vi){
  if(window.innerWidth>900)return;
  g('escTitle').textContent=label;
  const bdy=g('escBody');
  bdy.innerHTML=`
    <div class="ins-row"><span class="ins-k">Class</span><span class="ins-v m">${esc(cls||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">ViewId</span><span class="ins-v m">${esc(vi||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Position</span><span class="ins-v r">(${Math.round(bx.x||0)}, ${Math.round(bx.y||0)})</span></div>
    <div class="ins-row"><span class="ins-k">Size</span><span class="ins-v">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
    <div style="margin-top:8px">
      ${ck?'<span class="ins-tag ck">clickable</span>':''}
      ${ed?'<span class="ins-tag ed">editable</span>':''}
    </div>`;
  const acts=g('escActions');
  acts.innerHTML='';
  if(ck){
    const btn=document.createElement('button');
    btn.className='esc-btn primary';btn.textContent='✛ Tap This Element';
    btn.onclick=()=>{tapElementA11y(Math.round(bx.x||0),Math.round(bx.y||0));closeElemSheet()};
    acts.appendChild(btn);
  }
  const closeBtn=document.createElement('button');
  closeBtn.className='esc-btn';closeBtn.textContent='Close';
  closeBtn.onclick=closeElemSheet;
  acts.appendChild(closeBtn);
  g('elemSheet').classList.add('on');
}
function closeElemSheet(){g('elemSheet')?.classList.remove('on')}

// ════════════════════════════════════════════
//  ENABLE/DISABLE ALL CONTROLS
// ════════════════════════════════════════════
function enableAll(){
  ['btnRS','btnRSP','btnSR','btnSRP','btnStop','btnBack','btnHome','btnRec',
   'btnSU','btnSD','btnScr','btnHome2','btnBack2','btnRec2','btnWake','btnA11y',
   'qaHome','qaBack','qaRec','qaRS','qaUp','qaDown','qaLeft2','qaRight2','qaWake',
   'a11yStartBtnRP'].forEach(id=>{
    const el=g(id);if(el){el.disabled=false;el.removeAttribute('disabled')}
  });
}

// ════════════════════════════════════════════
//  COMMAND SENDER
// ════════════════════════════════════════════
function sendCmd(payload){
  if(!uid||!did){toast('⚠','Device not ready',2000,'a');return false}
  set(rp('commands/current'),{...payload,ts:Date.now()})
    .catch(e=>toast('❌','Send failed: '+e.message,3000,'r'));
  setBbR('→ '+payload.action+'…');
  return true;
}

function listenResult(cb,timeout=18000){
  if(resultUnsub){resultUnsub();resultUnsub=null}
  let done=false;
  resultUnsub=onValue(rp('commands/result'),snap=>{
    const d=snap.val();if(!d)return;
    const msg=typeof d==='object'?(d.msg||JSON.stringify(d)):String(d);
    if(done)return;done=true;
    if(resultUnsub){resultUnsub();resultUnsub=null}
    g('sbFoot').textContent=msg.slice(0,50);
    setBbR(msg.slice(0,36));
    stopProg();
    cb(msg);
  });
  setTimeout(()=>{
    if(!done){done=true;if(resultUnsub){resultUnsub();resultUnsub=null}
      stopProg();toast('⏱','Device timeout',3000,'a')}
  },timeout);
}

// ════════════════════════════════════════════
//  COMMANDS
// ════════════════════════════════════════════
function cmdReadScreen(){
  if(!sendCmd({action:'readScreen'}))return;
  startProg();setStatus('📋 Reading screen…');toast('📋','Capturing…');
  listenResult(msg=>setStatus('✅ '+msg));
}
function cmdReadScreenPos(){
  if(!sendCmd({action:'readScreenPos'}))return;
  startProg();setStatus('📌 Read + Positions…');toast('📌','Capturing with positions…');
  listenResult(msg=>setStatus('✅ '+msg));
}
function cmdStartReader(withPos){
  if(!sendCmd({action:withPos?'startReaderPos':'startReader'}))return;
  startProg();setStatus('📡 Starting reader…');toast('📡',withPos?'Reader+Pos…':'Reader starting…');
  listenResult(msg=>{
    if(msg.startsWith('reader_started:')){
      const sid=msg.split(':')[1];
      currentSessionId=sid;sessionStartTime=Date.now();
      sessionSnapCount=0;sessionClickCount=0;
      setSessInd(sid,true);
      startDurTimer();
      setStatus('✅ Reader active · '+String(sid).slice(-6));
      toast('✅','Reader started!',3000,'g');
      setRTab('sessions');setTimeout(loadSessions,1500);
    } else setStatus('✅ '+msg);
  },22000);
}
function cmdStopReader(){
  if(!sendCmd({action:'stopReader'}))return;
  setStatus('⏹ Stopping…');toast('⏹','Stop sent…');
  listenResult(msg=>{
    if(msg.startsWith('reader_stopped:')){
      buildAndSaveSession();
      setSessInd(null,false);
      stopDurTimer();
      toast('✅','Stopped',2500,'g');
    }
    setStatus('✅ '+msg);
  },12000);
}
function cmdScreenOn(){
  if(!sendCmd({action:'screenOn'}))return;
  toast('☀','Waking screen…');
  listenResult(msg=>toast(msg.includes('ok')?'✅':'ℹ',msg,2000,msg.includes('ok')?'g':'a'));
}

function doPing(){
  if(!uid||!did){toast('⚠','Not connected',2000,'a');return}
  pingTs=Date.now();const btn=g('pingBtn');
  g('pingTxt').textContent='…';btn.className='ping-badge';
  sendCmd({action:'ping'});
  startProg();
  listenResult(msg=>{
    const lat=Date.now()-pingTs;
    g('pingTxt').textContent=lat+'ms';
    btn.className='ping-badge '+(lat<600?'ok':lat<1500?'warn':'bad');
    toast('⚡',`Pong ${lat}ms`,1800);
  },8000);
}

// ════════════════════════════════════════════
//  A11Y
// ════════════════════════════════════════════
function toggleA11y(){
  if(!uid||!did){toast('⚠','Not connected',2000,'a');return}
  if(!a11yActive){
    startA11y();
  } else {
    stopA11y();
  }
}

function startA11y(){
  if(!sendCmd({action:'startLiveA11y'}))return;
  startProg();
  toast('♿','Starting Live A11y…',2000,'p');
  listenResult(msg=>{
    if(msg.includes('reader_started')){
      a11yActive=true;
      updateA11yUI();
      toast('✅','Live A11y active!',3000,'g');
    }
  },22000);
}

function stopA11y(){
  a11yActive=false;
  updateA11yUI();
  sendCmd({action:'stopReader'});
  toast('⏹','A11y stopped',1500,'a');
}

function updateA11yUI(){
  const badge=g('a11yBadgeRP'),btn=g('a11yStartBtnRP');
  const sbBadge=g('a11yBtnTxt');
  if(a11yActive){
    if(badge){badge.textContent='LIVE';badge.className='a11y-badge live'}
    if(btn){btn.textContent='⏹ Stop Live A11y';btn.className='a11y-start-btn live'}
    if(sbBadge)sbBadge.textContent='Stop Live A11y';
    g('btnA11y')?.classList.add('live');
  } else {
    if(badge){badge.textContent='Stopped';badge.className='a11y-badge'}
    if(btn){btn.textContent='▶ Start Live A11y';btn.className='a11y-start-btn'}
    if(sbBadge)sbBadge.textContent='Start Live A11y';
    g('btnA11y')?.classList.remove('live');
  }
  // Update mobile drawer if open
  const mA11yBtn=g('mA11yBtn');
  if(mA11yBtn)mA11yBtn.textContent=a11yActive?'⏹ Stop Live A11y':'▶ Start Live A11y';
  const mA11yBadge=g('mA11yBadge');
  if(mA11yBadge){mA11yBadge.textContent=a11yActive?'LIVE':'Stopped';mA11yBadge.className='a11y-badge'+(a11yActive?' live':'')}
}

function setA11yFilter(f,el){
  a11yFilter=f;
  document.querySelectorAll('.a11y-filter-btn').forEach(b=>b.classList.remove('on'));
  el?.classList.add('on');
  renderA11yList();
}

function renderA11yList(){
  const listEl=g('a11yList');if(!listEl)return;
  const search=(g('a11ySearch')?.value||'').toLowerCase();
  let items=[...currentElements];
  if(a11yFilter==='ck')items=items.filter(e=>e.ck||e.clickable);
  if(a11yFilter==='ed')items=items.filter(e=>e.ed||e.editable);
  if(search)items=items.filter(e=>{
    const lb=(e.t||e.text||e.d||e.desc||'').toLowerCase();
    const vi=(e.vi||'').toLowerCase();
    return lb.includes(search)||vi.includes(search);
  });
  // Update stats
  const total=currentElements.length;
  const ckCount=currentElements.filter(e=>e.ck||e.clickable).length;
  const edCount=currentElements.filter(e=>e.ed||e.editable).length;
  g('a11yElTotal').textContent=total;
  g('a11yClkTotal').textContent=ckCount;
  g('a11yEdTotal').textContent=edCount;
  if(!items.length){
    listEl.innerHTML='<div class="dim-msg">'+(a11yActive?'No elements matching filter':'Start Live A11y to see elements<br><span style="font-size:8px;opacity:.6">or read screen once</span>')+'</div>';
    return;
  }
  const scroll=listEl.scrollTop;
  const frag=document.createDocumentFragment();
  items.slice(0,100).forEach(el=>{
    const txt=el.t||el.text||'';const dsc=el.d||el.desc||'';const vi=(el.vi||'').split('/').pop();
    const cls=shortCls(el.cl||'');
    const label=txt||dsc||vi||cls||'?';
    const ck=el.ck||el.clickable;const ed=el.ed||el.editable;const bx=el.b||el.bounds||{};
    const div=document.createElement('div');
    div.className='a11y-item'+(ck?' ck':'')+(ed?' ed':'');
    div.innerHTML=`
      <div class="ai-header">
        <span class="ai-label">${esc(label.slice(0,40))}</span>
        ${ck?'<span class="ai-tag ck">click</span>':''}
        ${ed?'<span class="ai-tag ed">edit</span>':''}
      </div>
      <div class="ai-meta">
        ${cls?`<span class="ai-cls">${esc(cls)}</span>`:''}
        <span class="ai-pos">(${Math.round(bx.x||0)},${Math.round(bx.y||0)})</span>
        <span class="ai-size">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span>
      </div>
      ${vi?`<div class="ai-vid">${esc(vi)}</div>`:''}
      <div class="ai-footer" style="margin-top:4px">
        <span class="ai-vid">${esc(vi||cls)}</span>
        ${ck?`<button class="ai-tap-btn" onclick="tapElementA11y(${Math.round(bx.x||0)},${Math.round(bx.y||0)})">Tap →</button>`:''}
      </div>`;
    div.addEventListener('mouseenter',()=>showEhc(el,(bx.l||0)*scX,(bx.t||0)*scY,(bx.w||0)*scX,(bx.h||0)*scY));
    div.addEventListener('mouseleave',()=>{ehc.style.display='none'});
    frag.appendChild(div);
  });
  listEl.innerHTML='';listEl.appendChild(frag);
  if(scroll>0)listEl.scrollTop=scroll;
}

function tapElementA11y(x,y){
  sendCmd({action:'tap',x,y});
  spawnRipple(x*scX,y*scY,'tap');
  toast('✛',`Tap (${x},${y})`,1200);
}

function toggleCklSection(){
  const body=g('cklSecBody'),hdr=g('cklSecHdr'),chev=g('cklSecChev');
  const on=body?.classList.toggle('on');
  hdr?.classList.toggle('open',on);
  if(chev)chev.textContent=on?'▲':'▼';
}

function updateClickables(clickables){
  currentClickables=clickables||[];
  g('cklCountBadge').textContent=currentClickables.length;
  const body=g('cklSecBody');if(!body)return;
  if(!currentClickables.length){body.innerHTML='<div class="dim-msg" style="font-size:9px;padding:12px">No clickables data</div>';return}
  const frag=document.createDocumentFragment();
  currentClickables.forEach(c=>{
    const card=document.createElement('div');
    card.className='ckl-card'+(c.ed?' ed':'');
    card.innerHTML=`<span class="ckl-card-lbl">${esc((c.lb||'?').slice(0,20))}</span><span class="ckl-card-pos">(${c.x||0},${c.y||0})</span>`;
    card.onclick=()=>{sendCmd({action:'tap',x:c.x,y:c.y});spawnRipple((c.x||0)*scX,(c.y||0)*scY,'tap');toast('✛',(c.lb||'?').slice(0,20),1200)};
    frag.appendChild(card);
  });
  body.innerHTML='';body.appendChild(frag);
}

// ════════════════════════════════════════════
//  CLICKABLES OVERLAY ON PHONE
// ════════════════════════════════════════════
function toggleCklOverlay(){
  cklOn=!cklOn;
  cklLayer.style.display=cklOn?'block':'none';
  g('togCkl').classList.toggle('on-p',cklOn);
  if(cklOn)renderCklOverlay();
  else cklLayer.innerHTML='';
}

function renderCklOverlay(){
  cklLayer.innerHTML='';
  if(!cklOn)return;
  const items=currentClickables.length?currentClickables:currentElements.filter(e=>e.ck||e.ed||e.clickable||e.editable);
  items.forEach(el=>{
    const bx=el.b||el.bounds||{};
    const l=(bx.l!==undefined?bx.l:(bx.x||0)-(bx.w||0)/2)*scX;
    const t=(bx.t!==undefined?bx.t:(bx.y||0)-(bx.h||0)/2)*scY;
    const w=(bx.w||el.w||0)*scX;const h=(bx.h||el.h||0)*scY;
    // For clickables from click events (no b object), use x,y,w,h directly
    let left=l,top=t,width=w,height=h;
    if(!bx.l&&el.x!==undefined){
      left=(el.x-(el.w||0)/2)*scX;top=(el.y-(el.h||0)/2)*scY;
      width=(el.w||0)*scX;height=(el.h||0)*scY;
    }
    if(width<2||height<2)return;
    const div=document.createElement('div');
    div.className='ckl-rect'+(el.ed||el.editable?' ed':' ck');
    div.style.cssText=`left:${Math.max(0,left)}px;top:${Math.max(0,top)}px;width:${width}px;height:${height}px`;
    div.title=el.lb||el.t||el.text||'';
    div.onclick=e=>{
      e.stopPropagation();
      const x=el.x||(bx.x||0);const y=el.y||(bx.y||0);
      sendCmd({action:'tap',x,y});spawnRipple(x*scX,y*scY,'tap');
      toast('✛',(el.lb||el.t||'element').slice(0,20),1200);
    };
    cklLayer.appendChild(div);
  });
}

// ════════════════════════════════════════════
//  SNAP RENDERER
// ════════════════════════════════════════════
function renderSnap(snap){
  if(!snap)return;curSnap=snap;memCurrentSnap=snap;
  g('pfEmpty').style.display='none';
  // Flash logic
  const pkg=snap.pkg||snap.packageName||'';
  const el=snap.ec||0;const clk=snap.cc||0;
  const pkgChg=pkg!==lastPrevPkg;
  const clkChg=clk!==lastPrevClk&&lastPrevClk>=0;
  const contChg=!pkgChg&&el!==lastPrevEl;
  pf.classList.remove('fl-c','fl-p','fl-g');void pf.offsetWidth;
  if(pkgChg)pf.classList.add('fl-p');
  else if(clkChg)pf.classList.add('fl-g');
  else pf.classList.add('fl-c');
  // Counter animation if changed
  if(el!==lastPrevEl)animBump('curEl');
  if(clk!==lastPrevClk&&lastPrevClk>=0)animBump('curClk');
  lastPrevPkg=pkg;lastPrevEl=el;lastPrevClk=clk;
  g('curPkg').textContent=pkg||'—';
  g('curEl').textContent=el;g('curApi').textContent=snap.api||'—';
  g('curClk').textContent=clk;
  g('snapTime').textContent=snap.ts?tFmt(snap.ts):'';
  const sc=snap.scr||snap.screen;
  if(sc&&(sc.w||sc.width))sizePf(sc.w||sc.width,sc.h||sc.height);
  if(bpOn)renderBp(snap);
  if(pdOn)renderPd(snap);
  // Update A11y from snap
  currentElements=snap.els||snap.elements||[];
  renderA11yList();
  if(cklOn)renderCklOverlay();
  // Update memory
  memSnaps.unshift(snap);
  if(memSnaps.length>100)memSnaps.pop();
  memStats.totalSnaps++;
  if(currentSessionId){sessionSnapCount++;g('iSessSnaps').textContent=sessionSnapCount}
  g('statSnaps').textContent=memStats.totalSnaps;
  // Mobile drawer update if open
  if(drawerOpen&&currentDrawerTab==='a11y')renderMobileA11y();
}

// ════════════════════════════════════════════
//  BLUEPRINT
// ════════════════════════════════════════════
function renderBp(snap){
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  bpSvg.setAttribute('viewBox',`0 0 ${vw} ${vh}`);
  bpSvg.innerHTML='';
  const els=snap.els||snap.elements||[];
  const sorted=[...els].sort((a,b)=>(a.dp||0)-(b.dp||0));
  sorted.forEach(el=>{
    const b=el.b||el.bounds;if(!b)return;
    const l=(b.l!==undefined?b.l:b.left||0)*sx;const t=(b.t!==undefined?b.t:b.top||0)*sy;
    const w=(b.w!==undefined?b.w:((b.right||0)-(b.left||0)))*sx;
    const h=(b.h!==undefined?b.h:((b.bottom||0)-(b.top||0)))*sy;
    if(w<2||h<2)return;
    const ck=el.ck||el.clickable,ed=el.ed||el.editable;
    const depth=el.dp||0;
    const col=ed?'#ffae00':ck?'#00f07a':'#00e5ff';
    const sOp=Math.max(0.07,0.55-depth*.035);const fOp=Math.max(0,0.025-depth*.003);
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',Math.max(0,l));rect.setAttribute('y',Math.max(0,t));
    rect.setAttribute('width',Math.min(w,vw-Math.max(0,l)));rect.setAttribute('height',Math.min(h,vh-Math.max(0,t)));
    rect.setAttribute('fill',col);rect.setAttribute('fill-opacity',String(fOp));
    rect.setAttribute('stroke',col);rect.setAttribute('stroke-width',ck?'1.5':'0.6');
    rect.setAttribute('stroke-opacity',String(sOp));rect.setAttribute('rx','2');
    rect.style.cursor='pointer';
    rect.addEventListener('mouseenter',()=>showEhc(el,l,t,w,h));
    rect.addEventListener('mouseleave',()=>{ehc.style.display='none'});
    rect.addEventListener('click',()=>{
      if(tapOn){
        const bx=el.b||el.bounds||{};const ex=bx.x||Math.round(l/sx+w/sx/2);const ey=bx.y||Math.round(t/sy+h/sy/2);
        sendCmd({action:'tap',x:ex,y:ey});spawnRipple(l+w/2,t+h/2,'tap');
      } else showMobileElem(el.t||el.text||'?',el,el.b||el.bounds||{},ck,ed,shortCls(el.cl||''),el.vi||'');
    });
    bpSvg.appendChild(rect);
    const txt=(el.t||el.text||'').trim();
    if((ck||ed)&&w>40&&h>12&&txt){
      const te=document.createElementNS('http://www.w3.org/2000/svg','text');
      te.setAttribute('x',Math.max(0,l)+3);te.setAttribute('y',Math.min(Math.max(10,Math.max(0,t)+10),vh-2));
      te.setAttribute('font-size','7');te.setAttribute('font-family','DM Mono,monospace');
      te.setAttribute('fill',col);te.setAttribute('fill-opacity','0.9');te.setAttribute('pointer-events','none');
      const mc=Math.max(3,Math.floor(w/5));
      te.textContent=txt.length>mc?txt.slice(0,mc)+'…':txt;
      bpSvg.appendChild(te);
    }
  });
}

function showEhc(el,l,t,w,h){
  const txt=(el.t||el.text||'').trim();const dsc=(el.d||el.desc||'').trim();
  const cls=shortCls(el.cl||'');const vi=(el.vi||'').split('/').pop();
  const bx=el.b||el.bounds||{};const ck=el.ck||el.clickable,ed=el.ed||el.editable;
  ehc.style.display='block';
  const vw=pfs.clientWidth||phoneW;
  const right=(l+w+6+195)<vw;
  ehc.style.left=(right?l+w+4:l-198)+'px';
  ehc.style.top=Math.min(Math.max(t,2),(pfs.clientHeight||phoneH)-200)+'px';
  ehc.innerHTML=`
    <div class="ehc-name">${esc(txt||dsc||cls||'element')}</div>
    ${vi?`<div class="ehc-row"><span class="ehc-k">id</span><span class="ehc-v">${esc(vi)}</span></div>`:''}
    ${cls?`<div class="ehc-row"><span class="ehc-k">cls</span><span class="ehc-v">${esc(cls)}</span></div>`:''}
    <div class="ehc-row"><span class="ehc-k">pos</span><span class="ehc-v">${Math.round(bx.x||0)},${Math.round(bx.y||0)}</span></div>
    <div class="ehc-row"><span class="ehc-k">size</span><span class="ehc-v">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
    <div class="ehc-tags">${ck?'<span class="ehc-tag ck">clickable</span>':''}${ed?'<span class="ehc-tag ed">editable</span>':''}</div>
    ${ck?`<button class="ehc-tap" onclick="sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}});spawnRipple(${Math.round(l+w/2)},${Math.round(t+h/2)},'tap')">✛ Tap</button>`:''}`;
  g('elemDom').innerHTML=`
    <div class="ins-row"><span class="ins-k">Text</span><span class="ins-v">${esc(txt||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Desc</span><span class="ins-v m">${esc(dsc||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Class</span><span class="ins-v m">${esc(el.cl||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">ViewId</span><span class="ins-v m">${esc(vi||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Pos</span><span class="ins-v r">${Math.round(bx.x||0)},${Math.round(bx.y||0)}</span></div>
    <div class="ins-row"><span class="ins-k">Size</span><span class="ins-v">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
    <div style="margin-top:4px">${ck?'<span class="ins-tag ck">clickable</span>':''}${ed?'<span class="ins-tag ed">editable</span>':''}</div>
    ${ck?`<button style="margin-top:8px;width:100%;padding:5px;border-radius:4px;border:1px solid rgba(0,229,255,.3);background:var(--cg);color:var(--c);font-family:var(--mono);font-size:9px;cursor:pointer" onclick="sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}})">✛ Tap This Element</button>`:''}`;
}

// ════════════════════════════════════════════
//  POSITION DOTS
// ════════════════════════════════════════════
function renderPd(snap){
  pdLayer.innerHTML='';
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  const pos=snap.cpos||snap.clickablePositions||[];
  pos.forEach(p=>{
    const x=(p.x||0)*sx,y=(p.y||0)*sy;
    const dot=document.createElement('div');dot.className='pd';
    dot.style.left=x+'px';dot.style.top=y+'px';
    const isEd=p.ed||p.editable;const lbl=p.lb||p.label||'?';
    dot.innerHTML=`<div class="pd-dot${isEd?' ed':''}"></div><div class="pd-tip">${esc(lbl.slice(0,24))}</div>`;
    dot.addEventListener('click',e=>{
      e.stopPropagation();
      if(uid){sendCmd({action:'tap',x:p.x,y:p.y});spawnRipple(x,y,'tap');toast('✛',lbl.slice(0,20),1200)}
    });
    pdLayer.appendChild(dot);
  });
}

// ════════════════════════════════════════════
//  RIPPLE + LABEL
// ════════════════════════════════════════════
function spawnRipple(x,y,type,label){
  const r=document.createElement('div');r.className='ripple '+(type||'clk');
  r.style.left=x+'px';r.style.top=y+'px';
  pfs.appendChild(r);setTimeout(()=>r.remove(),900);
  if(label){
    const lbl=document.createElement('div');lbl.className='ripple-label';
    lbl.style.left=x+'px';lbl.style.top=y+'px';lbl.textContent=label.slice(0,24);
    pfs.appendChild(lbl);setTimeout(()=>lbl.remove(),1300);
  }
}

// ════════════════════════════════════════════
//  PHONE INTERACTIONS
// ════════════════════════════════════════════
pf.addEventListener('click',e=>{
  if(!tapOn||!uid)return;
  const rect=pfs.getBoundingClientRect();
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  const dx=Math.round((e.clientX-rect.left)/sx);const dy=Math.round((e.clientY-rect.top)/sy);
  if(dx<0||dy<0||dx>devW||dy>devH)return;
  sendCmd({action:'tap',x:dx,y:dy});
  spawnRipple(e.clientX-rect.left,e.clientY-rect.top,'tap');
  g('ptInfo').textContent=`→ Tap (${dx}, ${dy})`;
  toast('✛',`Tap (${dx},${dy})`,1200);
});
pf.addEventListener('mousedown',e=>{
  if(!swOn||!uid)return;
  const rect=pfs.getBoundingClientRect();
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  swStart={cx:e.clientX-rect.left,cy:e.clientY-rect.top,dx:Math.round((e.clientX-rect.left)/sx),dy:Math.round((e.clientY-rect.top)/sy)};
});
pf.addEventListener('mousemove',e=>{
  if(!swOn||!swStart)return;
  const rect=pfs.getBoundingClientRect();
  const ex=e.clientX-rect.left,ey=e.clientY-rect.top;
  const ctx=swCvs.getContext('2d');
  ctx.clearRect(0,0,swCvs.width,swCvs.height);
  ctx.beginPath();ctx.moveTo(swStart.cx,swStart.cy);ctx.lineTo(ex,ey);
  ctx.strokeStyle='rgba(192,79,255,.8)';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.stroke();
  ctx.setLineDash([]);ctx.beginPath();ctx.arc(ex,ey,5,0,Math.PI*2);ctx.fillStyle='#c04fff';ctx.fill();
});
document.addEventListener('mouseup',e=>{
  if(!swOn||!swStart||!uid){swStart=null;return}
  const rect=pfs.getBoundingClientRect();
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  const ex=Math.round((e.clientX-rect.left)/sx);const ey=Math.round((e.clientY-rect.top)/sy);
  swCvs.getContext('2d').clearRect(0,0,swCvs.width,swCvs.height);
  if(Math.abs(ex-swStart.dx)>8||Math.abs(ey-swStart.dy)>8){
    sendCmd({action:'swipe',x1:swStart.dx,y1:swStart.dy,x2:ex,y2:ey,dur:350});
    g('ptInfo').textContent=`Swipe (${swStart.dx},${swStart.dy})→(${ex},${ey})`;
    toast('⟺','Swipe sent',1200);
  }
  swStart=null;
});
pf.addEventListener('mousemove',e=>{
  if(!tapOn)return;
  const rect=pfs.getBoundingClientRect();
  const vw=pfs.clientWidth||phoneW;const vh=pfs.clientHeight||phoneH;
  const sx=vw/devW;const sy=vh/devH;
  const dx=Math.round((e.clientX-rect.left)/sx);const dy=Math.round((e.clientY-rect.top)/sy);
  if(dx>=0&&dy>=0&&dx<=devW&&dy<=devH)g('ptInfo').textContent=`(${dx}, ${dy})`;
});

// ════════════════════════════════════════════
//  TOGGLES
// ════════════════════════════════════════════
function toggleInteract(){
  tapOn=!tapOn;swOn=tapOn;
  g('togInteract').classList.toggle('on',tapOn);
  pf.classList.toggle('tap-mode',tapOn);pf.classList.toggle('sw-mode',tapOn);
  g('ptInfo').textContent=tapOn?'Tap or drag on phone':'Ready';
}
function toggleBp(){
  bpOn=!bpOn;bpSvg.style.display=bpOn?'block':'none';g('togBp').classList.toggle('on-a',bpOn);
  if(bpOn&&curSnap)renderBp(curSnap);
}
function togglePd(){
  pdOn=!pdOn;pdLayer.style.display=pdOn?'block':'none';g('togPd').classList.toggle('on-g',pdOn);
  if(pdOn&&curSnap)renderPd(curSnap);
}
function toggleLabel(){
  labelOn=!labelOn;pdLayer.classList.toggle('labels-on',labelOn);g('togLabel').classList.toggle('on-g',labelOn);
}
const autoFrames=['⟳ Scanning','⟳ Scanning.','⟳ Scanning..','⟳ Scanning...'];
function toggleAutoScan(){
  autoScanPosOn=false;g('togAutoP').classList.remove('on-g');
  autoScanOn=!autoScanOn;g('togAuto').classList.toggle('on',autoScanOn);
  if(autoScanOn){
    clearInterval(autoTimer);clearInterval(autoAnimTimer);
    autoTimer=setInterval(()=>{if(uid&&did)sendCmd({action:'readScreen'})},5000);
    autoAnimTimer=setInterval(()=>{g('ptInfo').textContent=autoFrames[autoFrame++%4]},500);
    toast('⟳','Auto-Scan ON',2000,'g');
  } else {
    clearInterval(autoTimer);clearInterval(autoAnimTimer);
    g('ptInfo').textContent='Ready';toast('⟳','Auto-Scan OFF',1500);
  }
}
function toggleAutoScanPos(){
  autoScanOn=false;g('togAuto').classList.remove('on');
  autoScanPosOn=!autoScanPosOn;g('togAutoP').classList.toggle('on-g',autoScanPosOn);
  if(autoScanPosOn){
    clearInterval(autoTimer);clearInterval(autoAnimTimer);
    autoTimer=setInterval(()=>{if(uid&&did)sendCmd({action:'readScreenPos'})},5000);
    autoAnimTimer=setInterval(()=>{g('ptInfo').textContent=autoFrames[autoFrame++%4]},500);
    toast('⟳','Auto+Pos ON',2000,'g');
  } else {
    clearInterval(autoTimer);clearInterval(autoAnimTimer);
    g('ptInfo').textContent='Ready';toast('⟳','Auto+Pos OFF',1500);
  }
}

// ════════════════════════════════════════════
//  META
// ════════════════════════════════════════════
function updateMeta(meta){
  if(!meta)return;
  const on=meta.status==='active';
  g('iStatus').textContent=meta.status||'—';g('iStatus').className='ins-v '+(on?'g':'r');
  g('iModel').textContent=meta.model||'—';g('iBrand').textContent=meta.brand||'—';
  g('iApiL').textContent=meta.api||'—';g('iVer').textContent=meta.version||'—';
  g('iSeen').textContent=meta.seen?tFmt(meta.seen):'—';
  const sc=meta.scr;
  if(sc){g('iScreen').textContent=`${sc.w}×${sc.h}`;g('iDpi').textContent=sc.dpi||'—';sizePf(sc.w,sc.h)}
  g('devChip').className='dev-chip '+(on?'on':'off');
  g('devLabel').textContent=(meta.model||'Device')+' · '+(on?'ONLINE':'OFFLINE');
  setStatus(on?`🟢 ${meta.model||'Device'} connected`:'🔴 Device offline');
}

// ════════════════════════════════════════════
//  LAST CLICK
// ════════════════════════════════════════════
function handleClick(c){
  if(!c)return;
  const lb=c.lb||c.txt||c.text||c.d||'?';
  updateLastClickDom(c,lb);
  addToClickLog(c);
  // Update clickables from click payload
  if(c.clickables&&Array.isArray(c.clickables)){
    updateClickables(c.clickables);
    if(cklOn)renderCklOverlay();
  }
  spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);
  // Memory
  memClicks.unshift(c);if(memClicks.length>500)memClicks.pop();
  memStats.totalClicks++;
  const hour=new Date(c.t||Date.now()).getHours();
  memStats.byHour[hour]=(memStats.byHour[hour]||0)+1;
  const pkg=c.pkg||'?';memStats.byPkg[pkg]=(memStats.byPkg[pkg]||0)+1;
  if(currentSessionId){sessionClickCount++;g('iSessClicks').textContent=sessionClickCount}
  g('statClicks').textContent=memStats.totalClicks;
  // Update badge
  const badge=g('mnClickBadge');
  if(badge&&window.innerWidth<=900){badge.textContent=memClicks.length>9?'9+':memClicks.length;badge.classList.add('on')}
  renderStatBars();
  // Update mobile drawer if showing clicks
  if(drawerOpen&&currentDrawerTab==='clicks')renderDrawerContent('clicks');
}

function updateLastClickDom(c,lb){
  g('lastClickDom').innerHTML=`
    <div class="ins-row"><span class="ins-k">Label</span><span class="ins-v">${esc(lb)}</span></div>
    <div class="ins-row"><span class="ins-k">App</span><span class="ins-v m">${esc(shortPkg(c.pkg||'—'))}</span></div>
    <div class="ins-row"><span class="ins-k">Coords</span><span class="ins-v r">(${c.x||0}, ${c.y||0})</span></div>
    ${c.cls?`<div class="ins-row"><span class="ins-k">Class</span><span class="ins-v m">${esc(shortCls(c.cls))}</span></div>`:''}
    <div class="ins-row"><span class="ins-k">Time</span><span class="ins-v m">${tFmt(c.t)}</span></div>
    ${(c.clickables||[]).length?`<div class="ins-row"><span class="ins-k">Clickables</span><span class="ins-v g">${c.clickables.length} on screen</span></div>`:''}`;
}

function addToClickLog(c){
  const dom=g('clickLogDom');if(!dom)return;
  const lb=c.lb||c.txt||c.text||c.d||'?';
  // Scroll preservation
  const atTop=dom.scrollTop<20;
  const div=document.createElement('div');div.className='click-item';
  div.innerHTML=`
    <div class="ci-row1"><span class="ci-label">${esc(lb)}</span><span class="ci-time">${tFmt(c.t)}</span></div>
    <div class="ci-pkg">${esc(shortPkg(c.pkg||''))} · <span class="ci-xy">(${c.x||0},${c.y||0})</span></div>`;
  div.onclick=()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);toast('🎯',lb.slice(0,30),1200)};
  if(dom.children[0]?.className==='dim-msg')dom.innerHTML='';
  dom.insertBefore(div,dom.firstChild);
  if(atTop)dom.scrollTop=0;
  const kids=dom.children;while(kids.length>60)dom.removeChild(dom.lastChild);
  g('clickCountBadge').textContent=memClicks.length;
  clickHistory.unshift({...c});if(clickHistory.length>500)clickHistory.pop();
}

function renderStatBars(){
  const entries=Object.entries(memStats.byPkg).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=entries[0]?entries[0][1]:1;
  const dom=g('pkgBars');if(!dom)return;
  if(!entries.length){dom.innerHTML='';return}
  dom.innerHTML=entries.map(([pkg,cnt])=>{
    const pct=Math.round(cnt/max*100);const sp=shortPkg(pkg);
    return`<div class="stat-bar-row"><span class="sbl" title="${pkg}">${esc(sp)}</span><div class="sbb"><div class="sbf" style="width:${pct}%"></div></div><span class="sbn">${cnt}</span></div>`;
  }).join('');
}

// ════════════════════════════════════════════
//  SESSION INDICATOR + TIMER
// ════════════════════════════════════════════
function setSessInd(sid,on){
  const el=g('sessInd');el.classList.toggle('on',on);
  g('sessIndTxt').textContent=on?'Session: '+String(sid||'').slice(-6):'No session';
  g('iSessActive').textContent=on?'Yes':'No';g('iSessActive').className='ins-v '+(on?'g':'m');
}
function startDurTimer(){
  clearInterval(durTimer);
  durTimer=setInterval(()=>{
    const ms=Date.now()-sessionStartTime;
    const s=durFmt(ms);
    g('iSessDur').textContent=s;
  },1000);
}
function stopDurTimer(){clearInterval(durTimer);g('iSessDur').textContent='—'}

// Rule 5: Build session summary on stop
function buildAndSaveSession(){
  if(!currentSessionId)return;
  const summary={
    sessionId:currentSessionId,startTime:sessionStartTime,endTime:Date.now(),
    durationMs:Date.now()-sessionStartTime,totalSnaps:sessionSnapCount,totalClicks:sessionClickCount,
    finalPkg:memCurrentSnap?.pkg||'—',finalText:(memCurrentSnap?.ft||'').slice(0,300),
    topPkgs:Object.entries(memStats.byPkg).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([pkg,count])=>({pkg,count})),
    clicksByHour:{...memStats.byHour}
  };
  if(uid&&did)set(rp('lastSession'),summary).catch(()=>{});
  memSessions.unshift(summary);if(memSessions.length>20)memSessions.pop();
  currentSessionId=null;sessionStartTime=0;sessionSnapCount=0;sessionClickCount=0;
}

// ════════════════════════════════════════════
//  SESSIONS
// ════════════════════════════════════════════
function loadSessions(){
  const dom=g('svList');if(!dom)return;
  // Show in-memory sessions + load last saved
  renderSessionsList();
}

function renderSessionsList(){
  const dom=g('svList');if(!dom)return;
  if(!memSessions.length){
    dom.innerHTML='<div class="sv-empty"><div class="sv-empty-ico">📡</div><div>No sessions yet</div><div style="font-size:9px;margin-top:4px;opacity:.6">Start a reader session to track data</div></div>';
    return;
  }
  dom.innerHTML='';
  const isLive=!!currentSessionId;
  if(isLive){
    const card=document.createElement('div');card.className='sv-card live';
    card.innerHTML=`
      <div class="svc-top">
        <span class="svc-id">${String(currentSessionId).slice(-10)}</span>
        <span class="svc-badge run">▶ LIVE</span>
      </div>
      <div class="svc-row">
        <span>Snaps<span class="svc-val">${sessionSnapCount}</span></span>
        <span>Clicks<span class="svc-val">${sessionClickCount}</span></span>
        <span>App<span class="svc-val">${shortPkg(memCurrentSnap?.pkg||'—')}</span></span>
      </div>
      <span class="svc-arr">›</span>`;
    card.onclick=()=>showSessDetail({sessionId:currentSessionId,totalSnaps:sessionSnapCount,totalClicks:sessionClickCount,startTime:sessionStartTime});
    dom.appendChild(card);
  }
  memSessions.forEach(s=>{
    const card=document.createElement('div');card.className='sv-card';
    card.innerHTML=`
      <div class="svc-top">
        <span class="svc-id">${String(s.sessionId||'').slice(-10)}</span>
        <span class="svc-badge stop">■ SAVED</span>
      </div>
      <div class="svc-row">
        <span>Dur<span class="svc-val">${durFmt(s.durationMs||0)}</span></span>
        <span>Snaps<span class="svc-val">${s.totalSnaps||0}</span></span>
        <span>App<span class="svc-val">${shortPkg(s.finalPkg||'—')}</span></span>
      </div>
      <span class="svc-arr">›</span>`;
    card.onclick=()=>showSessDetail(s);
    dom.appendChild(card);
  });
}

function showSessDetail(s){
  selSessId=s.sessionId;
  g('svBackId').textContent=String(s.sessionId||'').slice(-12);
  g('svSnaps').textContent=s.totalSnaps||0;
  g('svPkg').textContent=shortPkg(s.finalPkg||s.currentPkg||'—');
  const isLive=s.sessionId===currentSessionId;
  if(isLive){
    clearInterval(sessDurTimer);
    sessDurTimer=setInterval(()=>g('svDur').textContent=durFmt(Date.now()-sessionStartTime),1000);
  } else {
    clearInterval(sessDurTimer);
    g('svDur').textContent=s.durationMs?durFmt(s.durationMs):'—';
  }
  // Show snaps from memory that match session
  const snaps=memSnaps.filter(sn=>sn.sid===s.sessionId);
  renderSessSnapFeed(snaps);
  g('svList').classList.add('hidden');g('svDetail').classList.add('visible');
}

function backToSessions(){
  clearInterval(sessDurTimer);
  g('svList').classList.remove('hidden');g('svDetail').classList.remove('visible');
  renderSessionsList();
}

function renderSessSnapFeed(snaps){
  const feed=g('svSnapFeed');if(!feed)return;
  if(!snaps.length){
    feed.innerHTML='<div class="sv-empty"><div class="sv-empty-ico">🔍</div><div>No snapshots in memory<br><span style="font-size:8px">Snaps are stored in-memory during the session</span></div></div>';
    return;
  }
  feed.innerHTML='';
  snaps.forEach((snap,idx)=>{
    const latest=idx===0;const pkc=snap.pkc||snap.packageChanged;
    const ec=snap.ec||0,cc=snap.cc||0;const pkg=snap.pkg||'?';const ft=snap.ft||'';
    const div=document.createElement('div');div.className='sv-snap'+(latest?' latest':'')+(pkc?' pkgchg':'');
    div.innerHTML=`
      <div class="sv-snap-hdr${latest?' open':''}">
        <span class="sv-snap-ts">${tFmt(snap.ts)}</span>
        <span class="sv-snap-pkg">${esc(pkg)}</span>
        <div class="sv-snap-pills">
          <span class="sv-pill c">${ec}</span>
          ${cc?`<span class="sv-pill g">📌${cc}</span>`:''}
          ${pkc?`<span class="sv-pill p">PKG↗</span>`:''}
        </div>
        <span class="sv-snap-chev">▶</span>
      </div>
      <div class="sv-snap-body${latest?' on':''}">
        <div class="sv-snap-ft">${esc(ft||'(no text)')}</div>
        <div class="sv-snap-acts">
          <button class="sv-snap-act" onclick="copyTxt('${esc(ft.replace(/'/g,"\\'").slice(0,500))}')">📋 Copy</button>
          <button class="sv-snap-act" onclick="loadSnapPhone(${idx})">📱 View</button>
        </div>
      </div>`;
    const hdr=div.querySelector('.sv-snap-hdr');const body=div.querySelector('.sv-snap-body');
    hdr.addEventListener('click',()=>{const o=body.classList.toggle('on');hdr.classList.toggle('open',o)});
    feed.appendChild(div);
  });
}

let _sessSnaps=[];
function loadSnapPhone(idx){if(_sessSnaps[idx])renderSnap(_sessSnaps[idx]);else if(memSnaps[idx])renderSnap(memSnaps[idx]);toast('📱','Snap loaded',1500,'g')}

// ════════════════════════════════════════════
//  HISTORY
// ════════════════════════════════════════════
function loadHistoryLazy(){filterHistory()}
function setPkgFilter(pkg,el){
  pkgFilter=pkg;
  document.querySelectorAll('#chFilters .ch-f').forEach(f=>f.classList.remove('on'));
  el?.classList.add('on');
  filterHistory();
}
function filterHistory(){
  histSearch=g('chSearch')?.value.trim().toLowerCase()||'';
  clickHistFiltered=clickHistory.filter(c=>{
    if(pkgFilter!=='all'&&(c.pkg||'')!==pkgFilter)return false;
    if(!histSearch)return true;
    return(c.lb||c.txt||'').toLowerCase().includes(histSearch)||(c.pkg||'').toLowerCase().includes(histSearch)||(c.vid||'').toLowerCase().includes(histSearch);
  });
  renderHistFeed();
  g('chTotal').textContent=clickHistory.length;
  g('chUniq').textContent=[...new Set(clickHistory.map(c=>c.lb||c.txt||'?'))].length;
  g('chPkgs').textContent=[...new Set(clickHistory.map(c=>c.pkg||'?'))].length;
}
function renderHistFeed(){
  const feed=g('chFeed');if(!feed)return;
  if(!clickHistFiltered.length){feed.innerHTML='<div class="dim-msg">No matches</div>';return}
  const frag=document.createDocumentFragment();
  clickHistFiltered.forEach((c,idx)=>{
    const lb=c.lb||c.txt||c.d||'?';
    const div=document.createElement('div');div.className='ch-item';
    div.innerHTML=`
      <div class="ch-num">${clickHistFiltered.length-idx}</div>
      <div class="ch-body">
        <div class="ch-label">${esc(lb)}</div>
        <div class="ch-pkg">${esc(c.pkg||'?')}</div>
        <div class="ch-meta2">
          <span class="ch-xy">(${c.x||0},${c.y||0})</span>
          <span class="ch-ts">${tFmt(c.t)}</span>
          ${c.cls?`<span class="ch-cls">${esc(shortCls(c.cls))}</span>`:''}
        </div>
      </div>`;
    div.addEventListener('click',()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);toast('🎯',lb.slice(0,30),1200)});
    frag.appendChild(div);
  });
  feed.innerHTML='';feed.appendChild(frag);
}
function exportHistory(){
  if(!clickHistory.length){toast('⚠','No history',2000,'a');return}
  const blob=new Blob([JSON.stringify(clickHistory,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`click_history_${Date.now()}.json`;a.click();
  toast('⤓','Exported '+clickHistory.length+' entries',2000,'g');
}
function copyTxt(t){
  navigator.clipboard?.writeText(t).then(()=>toast('📋','Copied!',1500,'g'))
    .catch(()=>{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('📋','Copied!',1500,'g')});
}

// ════════════════════════════════════════════
//  CONFIRM + CLEAR
// ════════════════════════════════════════════
function confirmClear(action,title,msg){
  pendingAction=action;g('dlgTitle').textContent=title;g('dlgMsg').textContent=msg;g('dlgOverlay').classList.add('on');
}
function closeDlg(){g('dlgOverlay').classList.remove('on');pendingAction=null}
async function doDlgAction(){
  closeDlg();if(!pendingAction||!uid||!did)return;
  toast('🗑','Clearing…',2000,'r');
  try{
    if(pendingAction==='clearAll'||pendingAction==='clearClicks'){
      await remove(rp('live/lastClick')).catch(()=>{});
    }
    if(pendingAction==='clearAll'){
      await remove(rp('live')).catch(()=>{});
      await remove(rp('debug')).catch(()=>{});
    }
    if(pendingAction==='clearSessions'){
      memSessions=[];renderSessionsList();
    }
    // Reset in-memory
    memClicks=[];memSessions=[];memStats={totalClicks:0,totalSnaps:0,byPkg:{},byHour:{}};
    clickHistory=[];clickHistFiltered=[];
    g('clickLogDom').innerHTML='<div class="dim-msg">Cleared</div>';
    g('clickCountBadge').textContent='0';g('statClicks').textContent='0';g('pkgBars').innerHTML='';
    toast('✅','Cleared!',2500,'g');
  }catch(e){toast('❌','Clear failed: '+e.message,3500,'r')}
  sendCmd({action:pendingAction});
}

// ════════════════════════════════════════════
//  CONNECTION TIMELINE
// ════════════════════════════════════════════
function showTimeline(){
  const t0=timing.auth||Date.now();
  const steps=[];
  if(timing.auth)steps.push(`Auth: 0ms`);
  if(timing.device)steps.push(`Device: ${timing.device-t0}ms`);
  if(timing.live)steps.push(`Live: ${timing.live-t0}ms`);
  const tip=g('tlTip');
  tip.innerHTML=`<div style="font-family:var(--disp);font-size:10px;font-weight:700;color:var(--c);margin-bottom:6px">Connection Timeline</div>`+
    steps.map(s=>`<div class="tl-step"><span class="tl-k">${s.split(':')[0]}</span><span class="tl-v">${s.split(':')[1]}</span></div>`).join('');
  tip.classList.add('on');
  setTimeout(()=>tip.classList.remove('on'),5000);
}

// ════════════════════════════════════════════
//  FIREBASE LISTENERS
// ════════════════════════════════════════════
function startListeners(){
  g('iUid').textContent=uid.slice(0,8)+'…';g('iDid').textContent=did.slice(0,10)+'…';
  // Meta
  unMeta=onValue(rp('meta'),snap=>{const m=snap.val();if(m){updateMeta(m);if(!timing.live){recTiming('live');showTimeline()}}});
  // Live screen
  unLive=onValue(rp('live/currentScreen'),snap=>{
    const d=snap.val();if(d)renderSnap(d);
  });
  // Live last click — ALL clickables included in payload by Java
  unLastClick=onValue(rp('live/lastClick'),snap=>{
    const c=snap.val();if(c)handleClick(c);
  });
  // Load last session
  get(rp('lastSession')).then(snap=>{
    const ls=snap.val();
    if(ls&&ls.sessionId){
      memSessions.push(ls);
      renderSessionsList();
    }
  }).catch(()=>{});
}

// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
onAuthStateChanged(auth,async user=>{
  recTiming('auth');
  if(!user){
    setStatus('🔴 Not authenticated — please log in');g('devChip').className='dev-chip';g('devLabel').textContent='Not signed in';
    toast('🔴','Please sign in',4000,'r');return;
  }
  uid=user.uid;setStatus('Authenticating…');
  try{
    const snap=await get(ref(db,`users/${uid}/storeId`));
    did=snap?.val();
    recTiming('device');
    if(!did){setStatus('❌ No device found');toast('❌','No device linked',4000,'r');return}
    g('devLabel').textContent='Device: '+String(did).slice(0,10)+'…';
    g('devChip').className='dev-chip on';
    setStatus('🟢 Connected');
    enableAll();
    sizePf(1080,2340);
    startListeners();
    toast('🟢','Device connected!',2500,'g');
  }catch(e){setStatus('❌ '+e.message);toast('❌','Auth error: '+e.message,4000,'r')}
});

// Expose spawnRipple for inline handlers
window.spawnRipple=spawnRipple;