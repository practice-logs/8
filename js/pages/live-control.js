import { db, auth } from "../api/firebase.js";
import {
  ref, set, get, remove, onValue, onChildAdded, onDisconnect
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ════════════════════════════════════════════
//  IN-MEMORY STATE (no localStorage anywhere)
// ════════════════════════════════════════════
let memSnaps    = [];   // max 100, newest first
let memClicks   = [];   // max 500, newest first
let memSessions = [];   // max 20, newest first
let memStats    = { totalClicks:0, totalSnaps:0, byPkg:{}, byHour:{} };
let memCurrentSnap = null;
let currentSessionId  = null;
let sessionStartTime  = 0;
let sessionSnapCount  = 0;
let sessionClickCount = 0;
let a11yFilter        = 'all';
let a11yListening     = false;
let clkPanelOpen      = true;
let lastClickables    = [];

// ── Auth / device ──
let uid = null, did = null;

// ── Phone sizing ──
let devW=1080, devH=2340, phoneW=300, phoneH=650, scX=1, scY=1;

// ── UI toggles ──
let tapOn=false, bpOn=false, pdOn=false, ckOn=false, labelOn=false;
let autoScanOn=false, autoScanPosOn=false;
let autoTimer=null, durTimer=null, pingInterval=null;

// ── Swipe gesture ──
let swStart = null;

// ── History / filter ──
let clickHistory=[], histFiltered=[], pkgFilter='all', histSearch='';

// ── Pending dialog action ──
let pendingAction = null;

// ── Current snap ──
let curSnap = null;

// ── Selected session ──
let selSessId = null, selSessSnaps = [];

// ── Progress ──
let progTimer = null, progVal = 0;

// ════════════════════════════════════════════
//  WEBRTC STATE MACHINE
// ════════════════════════════════════════════
let wrtcState = 0; // 0=idle 1=waiting_ready 2=offer_sent 3=ice 4=connected 5=live
let pc = null;
let screenCh = null, clicksCh = null, commandsCh = null;
let wrtcConnected = false;
let remoteDescSet = false;
let pendingDeviceCandidates = [];

// Signaling Firebase unsubs
let statusUnsub = null, answerUnsub = null, iceDevUnsub = null, metaUnsub = null;

// Ping/pong latency tracking
let latencies = [], pingTs = 0;

// Result callbacks (for WebRTC command results)
let resultCallbacks = [];
let resultTimeout = null;

// Connection timeline timestamps
const tl = { auth:0, device:0, cmd:0, ready:0, offer:0, answer:0, ice:0, live:0 };

const ICE_SERVERS = [
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'turn:openrelay.metered.ca:80',         username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443',        username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
];

// ════════════════════════════════════════════
//  DOM + UTILS
// ════════════════════════════════════════════
const g = id => document.getElementById(id);
const pf = g('pf'), pfs = g('pfs');
const bpSvg = g('bpSvg'), pdLayer = g('pdLayer'), ckOverlay = g('ckOverlay');
const ehc = g('ehc'), swCvs = g('swCvs');

// Expose globals for onclick handlers
const W = window;
['g','sendCmd','setRTab','confirmClear','closeDlg','doDlgAction','toggleInteract',
 'toggleBp','togglePd','toggleCkOverlay','toggleAutoScan','toggleAutoScanPos',
 'cmdReadScreen','cmdReadScreenPos','cmdStartReader','cmdStopReader','cmdScreenOn',
 'doPing','renderSessionList','backToSessions','filterHistory','setPkgFilter',
 'exportHistory','exportSession','loadSnapPhone','copyTxt','mobileTab',
 'toggleLabel','startWebRTCSession','stopWebRTCSession',
 'startA11y','stopA11y','setA11yFilter','renderA11y','toggleClkPanel',
 'closeMobileSheet','clearSessions'
].forEach(k=>W[k]=eval(k));

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function tFmt(ms){if(!ms)return'—';return new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function tLong(ms){if(!ms)return'—';return new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function durFmt(ms){if(!ms||ms<0)return'—';const s=Math.floor(ms/1000);return`${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`}
function shortPkg(p){return p?p.split('.').pop():'?'}

function toast(ico,msg,dur=2500,type=''){
  const el=g('toast');
  el.className='on'+(type?' t'+type:'');
  g('tIco').textContent=ico; g('tMsg').textContent=msg;
  clearTimeout(W._tt); W._tt=setTimeout(()=>el.className='',dur);
}
function setStatus(t){g('topStatus').textContent=t}
function setBbR(t){g('bbResult').textContent=t}
function setSbFoot(t){g('sbFoot').textContent=t}

function startProg(){
  progVal=0; g('progFill').style.width='0%';
  clearInterval(progTimer);
  progTimer=setInterval(()=>{
    progVal=progVal<85?progVal+Math.random()*5:progVal;
    g('progFill').style.width=progVal+'%';
  },200);
}
function stopProg(){
  clearInterval(progTimer);
  g('progFill').style.width='100%';
  setTimeout(()=>g('progFill').style.width='0%',400);
}

// Signaling step display
function sigStep(n, state){ // state: 'active'|'done'|'fail'|''
  const el=g('ss'+n);
  if(!el) return;
  el.className='sig-step'+(state?' '+state:'');
}
function sigStepDone(n){ sigStep(n,'done'); }
function sigStepActive(n){ sigStep(n,'active'); }
function sigStepFail(n){ sigStep(n,'fail'); }

// Show connection timeline tooltip
function showTimelineTip(){
  const tip=g('timelineTip');
  const steps=[
    {l:'Auth',v:tl.device-tl.auth},
    {l:'Device',v:tl.cmd-tl.device},
    {l:'Ready',v:tl.offer-tl.ready},
    {l:'Offer',v:tl.answer-tl.offer},
    {l:'Answer',v:tl.ice-tl.answer},
    {l:'ICE',v:tl.live-tl.ice},
  ].filter(s=>s.v>0&&s.v<30000);
  if(!steps.length){tip.style.display='none';return;}
  tip.style.display='flex';
  tip.innerHTML=steps.map((s,i)=>
    `${i>0?'<span class="tt-arr">›</span>':''}
     <div class="tt-step"><div class="tt-label">${s.l}</div><div class="tt-ms">${s.v}ms</div></div>`
  ).join('');
  setTimeout(()=>tip.style.display='none',5000);
}

// ════════════════════════════════════════════
//  FIREBASE PATHS (signaling + meta only)
// ════════════════════════════════════════════
function rp(sub){return ref(db,sub?`users/${uid}/devices/${did}/reader/${sub}`:`users/${uid}/devices/${did}/reader`)}
function wrtcRef(sub){return ref(db,sub?`users/${uid}/devices/${did}/webrtc/${sub}`:`users/${uid}/devices/${did}/webrtc`)}

// ════════════════════════════════════════════
//  PHONE SIZING
// ════════════════════════════════════════════
function sizePf(w,h){
  devW=w||1080; devH=h||2340;
  const canvas=g('phoneCanvas');
  if(!canvas) return;
  const rect=canvas.getBoundingClientRect();
  const maxH=rect.height-20, maxW=Math.min(rect.width*.55,320);
  const ar=devH/devW;
  let fw=maxW, fh=fw*ar;
  if(fh>maxH){fh=maxH; fw=fh/ar}
  phoneW=Math.round(fw); phoneH=Math.round(fh);
  scX=phoneW/devW; scY=phoneH/devH;
  pf.style.width=phoneW+'px'; pf.style.height=phoneH+'px';
  pfs.style.width=phoneW+'px'; pfs.style.height=phoneH+'px';
  swCvs.width=phoneW; swCvs.height=phoneH;
  bpSvg.setAttribute('viewBox',`0 0 ${phoneW} ${phoneH}`);
  bpSvg.style.width=phoneW+'px'; bpSvg.style.height=phoneH+'px';
  if(bpOn&&curSnap) renderBp(curSnap);
  if(pdOn&&curSnap) renderPd(curSnap);
}
W.addEventListener('resize',()=>sizePf(devW,devH));

// ════════════════════════════════════════════
//  TAB MANAGEMENT
// ════════════════════════════════════════════
function setRTab(t){
  ['inspect','clicks','sessions','history','a11y'].forEach(id=>{
    g('rtab-'+id)?.classList.toggle('on',id===t);
    g('rpane-'+id)?.classList.toggle('on',id===t);
  });
  if(t==='history') renderHistory();
  if(t==='sessions') renderSessionList();
}

function mobileTab(t){
  document.querySelectorAll('.mn-btn').forEach(b=>b.classList.remove('on'));
  g('mn-'+t)?.classList.add('on');
  if(t==='live'){
    closeMobileSheet();
    return;
  }
  const sheet=g('mobileSheet');
  sheet.classList.add('open');
  const titles={clicks:'🎯 Live Clicks',sessions:'📊 Sessions',a11y:'🌲 Accessibility',device:'📡 Device'};
  g('msTitle').textContent=titles[t]||t;
  const content=g('msContent');
  const paneId='rpane-'+(t==='device'?'inspect':t);
  const pane=g(paneId);
  if(pane){
    content.innerHTML='';
    content.appendChild(pane.cloneNode(true));
  }
}
function closeMobileSheet(){g('mobileSheet').classList.remove('open')}

// ════════════════════════════════════════════
//  WEBRTC STATE MACHINE — BROWSER SIDE
// ════════════════════════════════════════════

// State 0 → 1: Send startWebRTC command, listen for device ready
async function startWebRTCSession(){
  if(!uid||!did){toast('⚠','Not authenticated',2500,'a');return}
  if(wrtcConnected){toast('ℹ','Already connected',2000);return}

  teardownWebRTC(false); // clean any previous

  wrtcState=1;
  setStatus('⚡ Sending startWebRTC command…');
  sigStepActive(2);
  tl.cmd=Date.now();

  // Send command via Firebase (only Firebase write during signaling)
  await set(rp('commands/current'),{action:'startWebRTC', ts:Date.now()}).catch(e=>{
    toast('❌','Firebase write failed: '+e.message,3000,'r');
    return;
  });

  sigStepDone(2); sigStepActive(3);
  setStatus('⚡ Waiting for device ready signal…');

  // Listen for device ready on webrtc/status
  if(statusUnsub){statusUnsub();statusUnsub=null}
  statusUnsub=onValue(wrtcRef('status'),async snap=>{
    const d=snap.val();
    if(!d) return;
    if(d.state==='ready' && wrtcState===1){
      tl.ready=Date.now();
      if(statusUnsub){statusUnsub();statusUnsub=null} // detach immediately
      sigStepDone(3); sigStepActive(4);
      setStatus('⚡ Device ready! Creating offer…');
      await createAndSendOffer();
    }
  },{onlyOnce:false});

  // Timeout if device doesn't respond
  setTimeout(()=>{
    if(wrtcState===1){
      sigStepFail(3);
      setStatus('❌ Device ready timeout — is device running?');
      toast('⏱','Device ready timeout',4000,'r');
      wrtcState=0;
      if(statusUnsub){statusUnsub();statusUnsub=null}
    }
  },30000);
}

// State 1 → 2: Create peer connection + offer
async function createAndSendOffer(){
  if(!uid||!did) return;

  try {
    pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    });

    // Create 3 data channels (browser is offerer)
    screenCh   = pc.createDataChannel('screen',   {ordered:false, maxRetransmits:0});
    clicksCh   = pc.createDataChannel('clicks',   {ordered:false, maxRetransmits:0});
    commandsCh = pc.createDataChannel('commands', {ordered:true});

    // Attach handlers
    screenCh.onmessage   = e => handleScreenData(e.data);
    clicksCh.onmessage   = e => handleClickData(e.data);
    commandsCh.onmessage = e => handleResultData(e.data);

    screenCh.onopen    = checkAllChannelsOpen;
    clicksCh.onopen    = checkAllChannelsOpen;
    commandsCh.onopen  = checkAllChannelsOpen;

    screenCh.onclose   = ()=>{ if(wrtcConnected) handleDisconnect('screen ch closed'); };
    clicksCh.onclose   = ()=>{ if(wrtcConnected) handleDisconnect('clicks ch closed'); };
    commandsCh.onclose = ()=>{ if(wrtcConnected) handleDisconnect('commands ch closed'); };

    // ICE candidate: write to Firebase for device to pick up
    pc.onicecandidate = e => {
      if(e.candidate && uid && did){
        set(wrtcRef(`ice_web/${Date.now()}`),{
          candidate:  e.candidate.candidate,
          sdpMid:     e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc?.connectionState||'';
      if(s==='connected') setStatus('⚡ P2P Connected!');
      if(s==='disconnected'||s==='failed'||s==='closed'){
        if(wrtcState>=3) handleDisconnect('PC '+s);
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    tl.offer = Date.now();

    // Write offer to Firebase + onDisconnect cleanup
    const offerRef = wrtcRef('offer');
    await set(offerRef, {sdp:offer.sdp, type:offer.type, ts:Date.now()});
    onDisconnect(offerRef).remove(); // auto-remove when browser leaves — signals device to tear down

    wrtcState=2;
    sigStepDone(4); sigStepActive(5);
    setStatus('⚡ Offer sent, waiting for answer…');
    toast('⚡','Offer sent!',2000,'c');

    // Listen for answer
    listenForAnswer();

    // Listen for device ICE candidates
    listenForDeviceIce();

  } catch(err){
    sigStepFail(4);
    setStatus('❌ Offer failed: '+err.message);
    toast('❌','WebRTC offer failed',3000,'r');
    console.error('createOffer error:', err);
  }
}

// State 2 → 3: Receive and process answer
function listenForAnswer(){
  if(answerUnsub){answerUnsub();answerUnsub=null}
  answerUnsub=onValue(wrtcRef('answer'), async snap=>{
    if(!snap.exists()||!pc||wrtcState!==2) return;
    const ans=snap.val();
    if(!ans||!ans.sdp) return;
    if(answerUnsub){answerUnsub();answerUnsub=null} // detach immediately
    tl.answer=Date.now();
    sigStepDone(5); sigStepActive(6);
    setStatus('⚡ Answer received, connecting ICE…');
    try {
      await pc.setRemoteDescription({type: ans.type||'answer', sdp: ans.sdp});
      // RULE 6: After setRemoteDescription, flush pending device candidates
      remoteDescSet=true;
      if(pendingDeviceCandidates.length){
        pendingDeviceCandidates.forEach(c=>{
          pc.addIceCandidate(c).catch(e=>console.warn('flush ICE:',e));
        });
        pendingDeviceCandidates=[];
      }
      wrtcState=3;
      tl.ice=Date.now();
    } catch(e){
      sigStepFail(5);
      setStatus('❌ setRemoteDescription failed: '+e.message);
      console.error('setRemoteDesc error:', e);
    }
  });

  setTimeout(()=>{
    if(wrtcState===2){
      sigStepFail(5);
      setStatus('❌ Answer timeout');
      toast('⏱','WebRTC answer timeout',4000,'r');
    }
  },30000);
}

// State 3: ICE candidate collection from device
function listenForDeviceIce(){
  if(iceDevUnsub){iceDevUnsub();iceDevUnsub=null}
  // Use onChildAdded per RULE 6 — prevents candidate race condition
  iceDevUnsub=onChildAdded(wrtcRef('ice_dev'), snap=>{
    if(!pc) return;
    const c=snap.val();
    if(!c||!c.candidate) return;
    const cand=new RTCIceCandidate({
      candidate:  c.candidate,
      sdpMid:     c.sdpMid||'',
      sdpMLineIndex: c.sdpMLineIndex||0
    });
    if(remoteDescSet){
      pc.addIceCandidate(cand).catch(e=>console.warn('addICE:',e));
    } else {
      pendingDeviceCandidates.push(cand);
    }
  });
}

// State 4 → 5: All channels open → cleanup signaling
function checkAllChannelsOpen(){
  if(!pc||wrtcConnected) return;
  const allOpen =
    screenCh   && screenCh.readyState   ==='open' &&
    clicksCh   && clicksCh.readyState   ==='open' &&
    commandsCh && commandsCh.readyState ==='open';
  if(!allOpen) return;

  wrtcConnected=true;
  wrtcState=5;
  tl.live=Date.now();

  sigStepDone(6); sigStepDone(7);
  setStatus('⚡ WebRTC P2P LIVE!');
  toast('⚡','WebRTC connected! P2P active',3000,'g');

  g('devChip').className='dev-chip on';
  g('devLabel').textContent='⚡ P2P LIVE';
  g('latBadge').style.display='flex';
  g('iState').textContent='Connected';
  g('iState').className='ins-v g';
  g('iSess').textContent=String(Date.now()).slice(-8);

  g('btnWRTCStop').disabled=false;
  g('btnWRTC').disabled=true;

  enableAllButtons();
  showTimelineTip();

  // RULE 6: Clean up all signaling nodes after connection
  setTimeout(cleanupSignaling, 2000);

  // Start ping/pong every 2 seconds for latency display
  clearInterval(pingInterval);
  pingInterval=setInterval(doAutoPing,2000);
}

// Delete signaling nodes (Rule 6)
async function cleanupSignaling(){
  if(!uid||!did) return;
  try {
    await remove(wrtcRef('offer'));
    await remove(wrtcRef('answer'));
    await remove(wrtcRef('ice_web'));
    await remove(wrtcRef('ice_dev'));
    await remove(wrtcRef('status'));
  } catch(e){ console.warn('cleanupSignaling:', e); }
  // Stop ICE listener — no more candidates needed
  if(iceDevUnsub){iceDevUnsub();iceDevUnsub=null}
  if(statusUnsub){statusUnsub();statusUnsub=null}
  if(answerUnsub){answerUnsub();answerUnsub=null}
}

function handleDisconnect(reason){
  if(!wrtcConnected && !pc) return;
  wrtcConnected=false;
  wrtcState=0;
  clearInterval(pingInterval);
  sigStep(7,''); sigStep(6,'');
  g('devChip').className='dev-chip err';
  g('devLabel').textContent='Disconnected';
  g('latBadge').style.display='none';
  g('iState').textContent='Disconnected';
  g('iState').className='ins-v r';
  setStatus('⚠ WebRTC disconnected: '+reason);
  toast('⚠','WebRTC disconnected',3000,'a');
  disableAllButtons();
}

function teardownWebRTC(removeSignaling){
  wrtcConnected=false; wrtcState=0; remoteDescSet=false;
  pendingDeviceCandidates=[];
  clearInterval(pingInterval);
  try{ screenCh?.close(); clicksCh?.close(); commandsCh?.close(); }catch(e){}
  try{ pc?.close(); }catch(e){}
  pc=null; screenCh=null; clicksCh=null; commandsCh=null;
  if(statusUnsub){statusUnsub();statusUnsub=null}
  if(answerUnsub){answerUnsub();answerUnsub=null}
  if(iceDevUnsub){iceDevUnsub();iceDevUnsub=null}
  if(removeSignaling&&uid&&did){
    remove(wrtcRef()).catch(()=>{});
  }
}

function stopWebRTCSession(){
  if(commandsCh?.readyState==='open'){
    try{ commandsCh.send(JSON.stringify({type:'stop',ts:Date.now()})); }catch(e){}
  }
  teardownWebRTC(true);
  g('devChip').className='dev-chip'; g('devLabel').textContent='Disconnected';
  g('latBadge').style.display='none';
  [7,6,5,4,3,2].forEach(i=>sigStep(i,''));
  disableAllButtons();
  g('btnWRTCStop').disabled=true;
  g('btnWRTC').disabled=false;
  setStatus('⏹ WebRTC stopped');
  toast('⏹','WebRTC session stopped',2000,'a');
}

// ════════════════════════════════════════════
//  DATA CHANNEL HANDLERS
// ════════════════════════════════════════════

function handleScreenData(raw){
  try{
    const snap=JSON.parse(raw);
    snap._src='rtc'; snap._rcvTs=Date.now();
    processSnap(snap);
  }catch(e){ console.warn('handleScreenData:', e); }
}

function handleClickData(raw){
  try{
    const c=JSON.parse(raw);
    c._src='rtc';
    processClick(c);
  }catch(e){ console.warn('handleClickData:', e); }
}

function handleResultData(raw){
  try{
    const d=JSON.parse(raw);
    // Pong response
    if(d.type==='pong'){
      const lat=Date.now()-(d.pt||pingTs);
      updateLatency(lat);
      stopProg();
      return;
    }
    // Command result
    const msg=d.msg||d.type||String(d);
    setSbFoot(msg.slice(0,50));
    setBbR(msg.slice(0,40));
    setStatus('✅ '+msg);
    stopProg();

    // Fire pending callbacks
    if(resultCallbacks.length){
      const cb=resultCallbacks.shift();
      clearTimeout(resultTimeout);
      try{ cb(msg); }catch(e){}
    }

    // Handle session lifecycle
    if(msg.startsWith('reader_started:') || msg.startsWith('reader_started:')){
      const sid=msg.split(':')[1]?.trim();
      if(sid){ startSession(sid); }
    }
    if(msg.startsWith('reader_stopped:')){
      endSession();
    }
  }catch(e){ console.warn('handleResultData:', e); }
}

// ════════════════════════════════════════════
//  PROCESS INCOMING DATA
// ════════════════════════════════════════════

function processSnap(snap){
  if(!snap) return;
  curSnap = snap;
  g('pfEmpty').style.display='none';

  // Update pkg row
  const pkg=snap.pkg||snap.packageName||'—';
  const ec=snap.ec||0, cc=snap.cc||0;
  const prevEl=g('curEl').textContent, prevClk=g('curClk').textContent;
  g('curPkg').textContent=pkg;
  if(String(ec)!==prevEl){ g('curEl').textContent=ec; g('curEl').classList.add('count-animate'); setTimeout(()=>g('curEl').classList.remove('count-animate'),300); }
  else g('curEl').textContent=ec;
  g('curApi').textContent=snap.api||'—';
  if(String(cc)!==prevClk){ g('curClk').textContent=cc; g('curClk').classList.add('count-animate'); setTimeout(()=>g('curClk').classList.remove('count-animate'),300); }
  else g('curClk').textContent=cc;
  g('snapTime').textContent=snap.ts?tFmt(snap.ts):'';

  // Size phone if screen info available
  const sc=snap.scr||snap.screen;
  if(sc&&(sc.w||sc.width)) sizePf(sc.w||sc.width,sc.h||sc.height);

  // Flash phone frame
  const pkgChg=snap.pkc||snap.packageChanged;
  const clkChg=snap.ctc;
  pf.classList.remove('fc','fp','fg'); void pf.offsetWidth;
  if(pkgChg) pf.classList.add('fp');
  else if(clkChg) pf.classList.add('fg');
  else pf.classList.add('fc');

  // Render overlays
  if(bpOn) renderBp(snap);
  if(pdOn) renderPd(snap);

  // Memory storage (RULE 3 - all data flows)
  memSnaps.unshift(snap);
  if(memSnaps.length>100) memSnaps.pop();
  memCurrentSnap=snap;
  memStats.totalSnaps++;
  if(currentSessionId) sessionSnapCount++;

  // Update inspector
  g('sTotalSnaps').textContent=memStats.totalSnaps;
  g('iSnaps').textContent=memStats.totalSnaps;

  // If A11y tab is listening, update it
  if(a11yListening){
    g('a11yPkg').textContent=pkg;
    g('a11yCounts').textContent=(ec||0)+' els';
    renderA11y();
  }

  // Update active session
  if(currentSessionId) updateActiveSession();
}

function processClick(c){
  if(!c) return;
  const lb=c.lb||c.txt||c.text||c.d||'?';

  // Update last click display
  updateLastClick(c);

  // Click log
  memClicks.unshift(c);
  if(memClicks.length>500) memClicks.pop();
  memStats.totalClicks++;
  if(currentSessionId) sessionClickCount++;
  memStats.byPkg[c.pkg||'?']=(memStats.byPkg[c.pkg||'?']||0)+1;
  const h=new Date(c.t||Date.now()).getHours();
  memStats.byHour[h]=(memStats.byHour[h]||0)+1;

  // Add to history
  clickHistory.unshift(c);
  if(clickHistory.length>500) clickHistory.pop();

  // Render click log
  addToClickLog(c);

  // Ripple on phone frame
  spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);

  // Update stats display
  g('sTotalClicks').textContent=memStats.totalClicks;
  g('iClicks').textContent=memStats.totalClicks;
  g('clickBadge').textContent=memClicks.length;
  renderStatBars();

  // Process all clickables from the click event (from ClickTrackerModule)
  if(c.clickables && Array.isArray(c.clickables) && c.clickables.length){
    lastClickables=c.clickables;
    // Update A11y clickables panel
    renderA11yClickables();
    // Update clickables overlay if enabled
    if(ckOn) renderCkOverlay(c.clickables);
    // Show A11y clickables panel
    if(a11yListening){
      g('a11yClkPanel').style.display='flex';
      g('a11yClkPanel').style.flexDirection='column';
    }
  }

  // Update history tab if active
  if(g('rtab-history')?.classList.contains('on')) renderHistory();
  if(currentSessionId) updateActiveSession();
}

// ════════════════════════════════════════════
//  COMMAND SENDER (WebRTC data channel)
// ════════════════════════════════════════════
function sendCmd(payload){
  if(!uid||!did){toast('⚠','Not authenticated',2000,'a');return false}
  if(!wrtcConnected||commandsCh?.readyState!=='open'){
    toast('⚠','WebRTC not connected',2000,'a');return false
  }
  try{
    commandsCh.send(JSON.stringify({...payload, ts:Date.now()}));
    setBbR('⚡ '+payload.action+'…');
    return true;
  }catch(e){
    toast('❌','Send error: '+e.message,3000,'r');return false;
  }
}

function listenResult(cb, timeoutMs=18000){
  resultCallbacks.push(cb);
  clearTimeout(resultTimeout);
  resultTimeout=setTimeout(()=>{
    if(resultCallbacks.length){
      resultCallbacks.shift();
      stopProg();
      toast('⏱','Command timeout',3000,'a');
    }
  },timeoutMs);
}

// ════════════════════════════════════════════
//  COMMAND FUNCTIONS
// ════════════════════════════════════════════
function cmdReadScreen(){
  if(!sendCmd({action:'readScreen'})) return;
  startProg(); setStatus('📋 Reading screen…'); toast('📋','Capturing…');
  listenResult(msg=>setStatus('✅ '+msg));
}
function cmdReadScreenPos(){
  if(!sendCmd({action:'readScreenPos'})) return;
  startProg(); setStatus('📌 Read + Positions…'); toast('📌','Capturing…');
  listenResult(msg=>setStatus('✅ '+msg));
}
function cmdStartReader(withPos){
  const action=withPos?'startReaderPos':'startReader';
  if(!sendCmd({action})) return;
  startProg(); setStatus('📡 Starting reader…'); toast('📡',withPos?'Reader+Pos':'Reader starting…');
  listenResult(msg=>{
    if(msg.startsWith('reader_started:')){
      const sid=msg.split(':')[1]?.trim();
      if(sid) startSession(sid);
      setStatus('✅ Reader active · '+String(sid||'').slice(-6));
      toast('✅','Reader started!',3000,'g');
      setRTab('sessions');
    } else setStatus('✅ '+msg);
  },22000);
}
function cmdStopReader(){
  if(!sendCmd({action:'stopReader'})) return;
  setStatus('⏹ Stopping reader…'); toast('⏹','Stopping…');
  listenResult(msg=>{
    if(msg.startsWith('reader_stopped:')) endSession();
    setStatus('✅ '+msg);
    toast('✅','Stopped',2000,'g');
  },12000);
}
function cmdScreenOn(){
  if(!sendCmd({action:'screenOn'})) return;
  toast('☀','Waking screen…');
  listenResult(msg=>toast(msg.includes('ok')?'✅':'ℹ',msg,2000,msg.includes('ok')?'g':'a'));
}

function doPing(){
  if(!wrtcConnected||commandsCh?.readyState!=='open'){toast('⚠','Not connected',2000,'a');return}
  pingTs=Date.now();
  const b=g('pingBadge'); b.className='ping-badge'; g('pingVal').textContent='…';
  startProg();
  try{commandsCh.send(JSON.stringify({type:'ping',ts:pingTs}));}catch(e){toast('❌','Ping failed',2000,'r')}
}

function doAutoPing(){
  if(!wrtcConnected||commandsCh?.readyState!=='open') return;
  pingTs=Date.now();
  try{commandsCh.send(JSON.stringify({type:'ping',ts:pingTs}));}catch(e){}
}

function updateLatency(lat){
  if(lat<=0||lat>10000) return;
  latencies.unshift(lat);
  if(latencies.length>20) latencies.pop();
  const avg=Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length);
  const b=g('pingBadge');
  g('pingVal').textContent=lat+'ms';
  b.className='ping-badge '+(lat<50?'ok':lat<200?'warn':'bad');
  g('latVal').textContent=avg;
  const lb=g('latBadge');
  lb.className='lat-badge '+(avg<50?'':avg<200?'warn':'bad');
  g('iAvgLat').textContent=avg+'ms';
}

// ════════════════════════════════════════════
//  INTERACTION TOGGLES
// ════════════════════════════════════════════
function toggleInteract(){
  tapOn=!tapOn;
  g('togInteract').classList.toggle('on',tapOn);
  pf.classList.toggle('tap-mode',tapOn);
  pf.classList.toggle('sw-mode',tapOn);
  g('ptInfo').textContent=tapOn?'Tap or drag on phone':'Ready';
}
function toggleBp(){
  bpOn=!bpOn;
  bpSvg.style.display=bpOn?'block':'none';
  g('togBp').classList.toggle('on-a',bpOn);
  if(bpOn&&curSnap) renderBp(curSnap); else bpSvg.innerHTML='';
}
function togglePd(){
  pdOn=!pdOn;
  pdLayer.style.display=pdOn?'block':'none';
  g('togPd').classList.toggle('on-g',pdOn);
  if(pdOn&&curSnap) renderPd(curSnap); else pdLayer.innerHTML='';
}
function toggleCkOverlay(){
  ckOn=!ckOn;
  ckOverlay.style.display=ckOn?'block':'none';
  g('togCk').classList.toggle('on',ckOn);
  if(ckOn&&lastClickables.length) renderCkOverlay(lastClickables);
  else ckOverlay.innerHTML='';
}
function toggleLabel(){
  labelOn=!labelOn;
  pdLayer.classList.toggle('labels-on',labelOn);
  g('togLabel').classList.toggle('on-g',labelOn);
}
function toggleAutoScan(){
  autoScanPosOn=false; g('togAutoPos').classList.remove('on-g');
  autoScanOn=!autoScanOn;
  g('togAuto').classList.toggle('on',autoScanOn);
  clearInterval(autoTimer);
  if(autoScanOn){
    let frame=0;
    const frames=['⟳ Scanning','⟳ Scanning.','⟳ Scanning..','⟳ Scanning...'];
    g('ptInfo').textContent=frames[0];
    autoTimer=setInterval(()=>{
      if(wrtcConnected) sendCmd({action:'readScreen'});
      frame=(frame+1)%4;
      g('ptInfo').textContent=frames[frame];
    },5000);
    toast('⟳','Auto-Scan ON (5s)',2000,'g');
  } else {
    g('ptInfo').textContent='Ready';
    toast('⟳','Auto-Scan OFF',1500);
  }
}
function toggleAutoScanPos(){
  autoScanOn=false; g('togAuto').classList.remove('on');
  autoScanPosOn=!autoScanPosOn;
  g('togAutoPos').classList.toggle('on-g',autoScanPosOn);
  clearInterval(autoTimer);
  if(autoScanPosOn){
    autoTimer=setInterval(()=>{if(wrtcConnected) sendCmd({action:'readScreenPos'})},5000);
    toast('⟳','Auto+Pos ON (5s)',2000,'g');
  } else {
    g('ptInfo').textContent='Ready';
    toast('⟳','Auto+Pos OFF',1500);
  }
}

// ════════════════════════════════════════════
//  PHONE INTERACTIONS
// ════════════════════════════════════════════
pf.addEventListener('click',e=>{
  if(!tapOn||!uid||!wrtcConnected) return;
  const rect=pfs.getBoundingClientRect();
  const dx=Math.round((e.clientX-rect.left)/scX);
  const dy=Math.round((e.clientY-rect.top)/scY);
  if(dx<0||dy<0||dx>devW||dy>devH) return;
  sendCmd({action:'tap',x:dx,y:dy});
  spawnRipple(e.clientX-rect.left,e.clientY-rect.top,'tap','Tap');
  g('ptInfo').textContent=`→ (${dx}, ${dy})`;
  toast('✛',`Tap (${dx},${dy})`,900);
  if(navigator.vibrate) navigator.vibrate(10);
});

// Swipe
pf.addEventListener('mousedown',e=>{
  if(!tapOn||!uid) return;
  const rect=pfs.getBoundingClientRect();
  swStart={cx:e.clientX-rect.left,cy:e.clientY-rect.top,
    dx:Math.round((e.clientX-rect.left)/scX),dy:Math.round((e.clientY-rect.top)/scY)};
});
pf.addEventListener('mousemove',e=>{
  if(!tapOn||!swStart) return;
  const rect=pfs.getBoundingClientRect();
  const ex=e.clientX-rect.left,ey=e.clientY-rect.top;
  const ctx=swCvs.getContext('2d');
  ctx.clearRect(0,0,swCvs.width,swCvs.height);
  ctx.beginPath(); ctx.moveTo(swStart.cx,swStart.cy); ctx.lineTo(ex,ey);
  ctx.strokeStyle='rgba(192,79,255,.8)'; ctx.lineWidth=2; ctx.setLineDash([6,4]); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(ex,ey,5,0,Math.PI*2); ctx.fillStyle='#c04fff'; ctx.fill();
  if(tapOn) g('ptInfo').textContent=`(${Math.round(ex/scX)}, ${Math.round(ey/scY)})`;
});
document.addEventListener('mouseup',e=>{
  if(!tapOn||!swStart||!wrtcConnected){swStart=null;return}
  const rect=pfs.getBoundingClientRect();
  const ex=Math.round((e.clientX-rect.left)/scX);
  const ey=Math.round((e.clientY-rect.top)/scY);
  swCvs.getContext('2d').clearRect(0,0,swCvs.width,swCvs.height);
  if(Math.abs(ex-swStart.dx)>10||Math.abs(ey-swStart.dy)>10){
    sendCmd({action:'swipe',x1:swStart.dx,y1:swStart.dy,x2:ex,y2:ey,dur:350});
    g('ptInfo').textContent=`Swipe→(${ex},${ey})`;
    toast('⟺','Swipe sent',900);
  }
  swStart=null;
});

// Touch events for mobile
pf.addEventListener('touchstart',e=>{
  if(!tapOn||!uid||!wrtcConnected) return;
  e.preventDefault();
  const t=e.touches[0], rect=pfs.getBoundingClientRect();
  swStart={cx:t.clientX-rect.left,cy:t.clientY-rect.top,
    dx:Math.round((t.clientX-rect.left)/scX),dy:Math.round((t.clientY-rect.top)/scY)};
},{passive:false});
pf.addEventListener('touchend',e=>{
  if(!tapOn||!swStart||!wrtcConnected){swStart=null;return}
  e.preventDefault();
  const t=e.changedTouches[0], rect=pfs.getBoundingClientRect();
  const ex=Math.round((t.clientX-rect.left)/scX);
  const ey=Math.round((t.clientY-rect.top)/scY);
  const dist=Math.sqrt((ex-swStart.dx)**2+(ey-swStart.dy)**2);
  if(dist<15){
    sendCmd({action:'tap',x:swStart.dx,y:swStart.dy});
    spawnRipple(swStart.cx,swStart.cy,'tap','Tap');
    if(navigator.vibrate) navigator.vibrate(15);
  } else {
    sendCmd({action:'swipe',x1:swStart.dx,y1:swStart.dy,x2:ex,y2:ey,dur:350});
  }
  swStart=null;
},{passive:false});

function spawnRipple(x,y,type,label){
  const r=document.createElement('div');
  r.className='ripple '+(type||'clk');
  r.style.left=x+'px'; r.style.top=y+'px';
  pfs.appendChild(r);
  setTimeout(()=>r.remove(),900);
  if(label&&type==='clk'){
    const lbl=document.createElement('div');
    lbl.className='clk-label';
    lbl.style.left=x+'px'; lbl.style.top=(y-20)+'px';
    lbl.textContent=(label||'').slice(0,22);
    pfs.appendChild(lbl);
    setTimeout(()=>lbl.remove(),1200);
  }
}

// ════════════════════════════════════════════
//  BLUEPRINT RENDERER
// ════════════════════════════════════════════
function renderBp(snap){
  bpSvg.setAttribute('viewBox',`0 0 ${phoneW} ${phoneH}`);
  bpSvg.innerHTML='';
  const els=snap.els||snap.elements||[];
  [...els].sort((a,b)=>(a.dp||0)-(b.dp||0)).forEach(el=>{
    const b=el.b||el.bounds; if(!b) return;
    const l=(b.l!==undefined?b.l:b.left||0)*scX;
    const t=(b.t!==undefined?b.t:b.top||0)*scY;
    const w=(b.w!==undefined?b.w:((b.right||0)-(b.left||0)))*scX;
    const h=(b.h!==undefined?b.h:((b.bottom||0)-(b.top||0)))*scY;
    if(w<2||h<2||l+w<0||t+h<0||l>phoneW||t>phoneH) return;
    const ck=el.ck||el.clickable, ed=el.ed||el.editable;
    const depth=el.dp||0;
    const col=ed?'#ffae00':ck?'#00f07a':'#00e5ff';
    const sOp=Math.max(0.06,0.55-depth*0.035);
    const fOp=Math.max(0,0.02-depth*0.002);
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',Math.max(0,l));
    rect.setAttribute('y',Math.max(0,t));
    rect.setAttribute('width',Math.min(w,phoneW-Math.max(0,l)));
    rect.setAttribute('height',Math.min(h,phoneH-Math.max(0,t)));
    rect.setAttribute('fill',col); rect.setAttribute('fill-opacity',String(fOp));
    rect.setAttribute('stroke',col); rect.setAttribute('stroke-width',ck?'1.5':'0.5');
    rect.setAttribute('stroke-opacity',String(sOp)); rect.setAttribute('rx','2');
    rect.style.cursor='pointer';
    rect.addEventListener('mouseenter',()=>showEhc(el,l,t,w,h));
    rect.addEventListener('mouseleave',()=>{ehc.style.display='none'});
    rect.addEventListener('click',()=>{
      if(tapOn){
        const bx=el.b||{}; sendCmd({action:'tap',x:Math.round(bx.x||l/scX+w/scX/2),y:Math.round(bx.y||t/scY+h/scY/2)});
        spawnRipple(l+w/2,t+h/2,'tap');
      }
    });
    // On mobile: show bottom sheet
    rect.addEventListener('touchend',e=>{
      e.stopPropagation();
      showMobileElSheet(el);
    });
    bpSvg.appendChild(rect);
    // Label text
    const txt=(el.t||el.text||'').trim();
    if((ck||ed)&&w>44&&h>12&&txt){
      const te=document.createElementNS('http://www.w3.org/2000/svg','text');
      te.setAttribute('x',Math.max(0,l)+3);
      te.setAttribute('y',Math.min(Math.max(10,Math.max(0,t)+10),phoneH-2));
      te.setAttribute('font-size','7'); te.setAttribute('font-family','DM Mono,monospace');
      te.setAttribute('fill',col); te.setAttribute('fill-opacity','0.9');
      te.setAttribute('pointer-events','none');
      const mc=Math.max(3,Math.floor(w/6));
      te.textContent=txt.length>mc?txt.slice(0,mc)+'…':txt;
      bpSvg.appendChild(te);
    }
  });
}

function showEhc(el,l,t,w,h){
  const bx=el.b||{};
  const txt=(el.t||el.text||'').trim();
  const dsc=(el.d||el.desc||'').trim();
  const cls=(el.cl||el.class||'').split('.').pop();
  const vi=(el.vi||el.viewId||'').split('/').pop();
  const depth=el.dp||0;
  const ck=el.ck||el.clickable, ed=el.ed||el.editable;
  ehc.style.display='block';
  const right=(l+w+6+200)<phoneW;
  ehc.style.left=(right?l+w+4:l-202)+'px';
  ehc.style.top=Math.min(Math.max(t,2),phoneH-180)+'px';
  ehc.innerHTML=`
    <div class="ehc-name">${esc(txt||dsc||cls||'element')}</div>
    ${vi?`<div class="ehc-row"><span class="ehc-k">id</span><span class="ehc-v">${esc(vi)}</span></div>`:''}
    ${cls?`<div class="ehc-row"><span class="ehc-k">cls</span><span class="ehc-v">${esc(cls)}</span></div>`:''}
    <div class="ehc-row"><span class="ehc-k">pos</span><span class="ehc-v">${Math.round(bx.x||0)},${Math.round(bx.y||0)}</span></div>
    <div class="ehc-row"><span class="ehc-k">size</span><span class="ehc-v">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
    <div class="ehc-row"><span class="ehc-k">depth</span><span class="ehc-v">${depth}</span></div>
    <div class="ehc-tags">
      ${ck?'<span class="ehc-tag ck">clickable</span>':''}
      ${ed?'<span class="ehc-tag ed">editable</span>':''}
    </div>
    ${ck?`<button class="ehc-tap" onclick="sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}})">✛ Tap</button>`:''} `;
  // Update inspector
  g('elemDom').innerHTML=`
    <div class="ins-row"><span class="ins-k">Text</span><span class="ins-v">${esc(txt||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Desc</span><span class="ins-v m">${esc(dsc||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Class</span><span class="ins-v m">${esc(cls||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">ViewId</span><span class="ins-v m">${esc(vi||'—')}</span></div>
    <div class="ins-row"><span class="ins-k">Depth</span><span class="ins-v">${depth}</span></div>
    <div class="ins-row"><span class="ins-k">Pos</span><span class="ins-v r">${Math.round(bx.x||0)},${Math.round(bx.y||0)}</span></div>
    <div class="ins-row"><span class="ins-k">Size</span><span class="ins-v">${Math.round(bx.w||0)}×${Math.round(bx.h||0)}</span></div>
    ${ck?`<div style="margin-top:6px"><span class="ins-tag ck">clickable</span></div>`:''}
    ${ed?`<div style="margin-top:6px"><span class="ins-tag ed">editable</span></div>`:''}
    ${ck?`<button style="margin-top:8px;width:100%;padding:5px;border-radius:4px;border:1px solid rgba(0,229,255,.3);background:var(--cg);color:var(--c);font-family:var(--mono);font-size:9px;cursor:pointer" onclick="sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}})">✛ Tap This Element</button>`:''}`;
}

function showMobileElSheet(el){
  const bx=el.b||{};
  const txt=(el.t||el.text||'').trim();
  const cls=(el.cl||el.class||'').split('.').pop();
  const vi=(el.vi||el.viewId||'').split('/').pop();
  const ck=el.ck||el.clickable, ed=el.ed||el.editable;
  const name=txt||cls||vi||'element';
  g('mesContent').innerHTML=`
    <div class="mes-name">${esc(name)}</div>
    <div class="mes-grid">
      <div class="mes-cell"><div class="mes-cell-k">POSITION</div><div class="mes-cell-v">${Math.round(bx.x||0)}, ${Math.round(bx.y||0)}</div></div>
      <div class="mes-cell"><div class="mes-cell-k">SIZE</div><div class="mes-cell-v">${Math.round(bx.w||0)} × ${Math.round(bx.h||0)}</div></div>
      <div class="mes-cell"><div class="mes-cell-k">CLASS</div><div class="mes-cell-v" style="font-size:9px">${esc(cls||'—')}</div></div>
      <div class="mes-cell"><div class="mes-cell-k">VIEW ID</div><div class="mes-cell-v" style="font-size:9px">${esc(vi||'—')}</div></div>
      ${ck?`<div class="mes-cell" style="border-color:rgba(0,240,122,.3);background:rgba(0,240,122,.06)"><div class="mes-cell-k" style="color:var(--g)">CLICKABLE</div><div class="mes-cell-v" style="color:var(--g);font-size:16px">✓</div></div>`:''}
      ${ed?`<div class="mes-cell" style="border-color:rgba(255,174,0,.3);background:rgba(255,174,0,.06)"><div class="mes-cell-k" style="color:var(--a)">EDITABLE</div><div class="mes-cell-v" style="color:var(--a);font-size:16px">✓</div></div>`:''}
    </div>
    ${ck?`<button class="mes-tap-btn" onclick="sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}});g('mobileElSheet').classList.remove('open');if(navigator.vibrate)navigator.vibrate(20)">✛ TAP THIS ELEMENT</button>`:''}
  `;
  g('mobileElSheet').classList.add('open');
}

// ════════════════════════════════════════════
//  POSITION DOTS
// ════════════════════════════════════════════
function renderPd(snap){
  pdLayer.innerHTML='';
  const pos=snap.cpos||snap.clickablePositions||[];
  pos.forEach(p=>{
    const x=(p.x||0)*scX, y=(p.y||0)*scY;
    const dot=document.createElement('div'); dot.className='pd';
    dot.style.left=x+'px'; dot.style.top=y+'px';
    const isEd=p.ed||p.editable; const lbl=p.lb||p.label||'?';
    dot.innerHTML=`<div class="pd-dot${isEd?' ed':''}"></div><div class="pd-tip">${esc(lbl.slice(0,24))}</div>`;
    dot.addEventListener('click',e=>{e.stopPropagation();if(wrtcConnected){sendCmd({action:'tap',x:p.x,y:p.y});spawnRipple(x,y,'tap',lbl);toast('✛',lbl.slice(0,20),900)}});
    dot.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();if(wrtcConnected){sendCmd({action:'tap',x:p.x,y:p.y});if(navigator.vibrate)navigator.vibrate(15)}});
    pdLayer.appendChild(dot);
  });
}

// Clickables overlay dots (from ClickTrackerModule clickables array)
function renderCkOverlay(clickables){
  ckOverlay.innerHTML='';
  if(!clickables||!ckOn) return;
  clickables.forEach(c=>{
    const x=(c.x||0)*scX, y=(c.y||0)*scY;
    const dot=document.createElement('div');
    dot.className='ck-dot'+(c.ed?' ed':'');
    dot.style.left=x+'px'; dot.style.top=y+'px';
    dot.title=c.lb||'?';
    dot.addEventListener('click',e=>{
      e.stopPropagation();
      if(wrtcConnected){sendCmd({action:'tap',x:c.x,y:c.y});spawnRipple(x,y,'tap',c.lb);toast('✛',(c.lb||'?').slice(0,20),900)}
    });
    ckOverlay.appendChild(dot);
  });
}

// ════════════════════════════════════════════
//  LAST CLICK DISPLAY
// ════════════════════════════════════════════
function updateLastClick(c){
  if(!c) return;
  const lb=c.lb||c.txt||c.text||c.d||'—';
  g('lastClickDom').innerHTML=`
    <div class="ins-row"><span class="ins-k">Label</span><span class="ins-v">${esc(lb)}</span></div>
    <div class="ins-row"><span class="ins-k">App</span><span class="ins-v m">${esc(shortPkg(c.pkg||'—'))}</span></div>
    <div class="ins-row"><span class="ins-k">Coords</span><span class="ins-v r">(${c.x||0}, ${c.y||0})</span></div>
    ${c.cls?`<div class="ins-row"><span class="ins-k">Class</span><span class="ins-v m">${esc((c.cls||'').split('.').pop())}</span></div>`:''}
    <div class="ins-row"><span class="ins-k">Time</span><span class="ins-v m">${tFmt(c.t)}</span></div>
    ${c.clickables?`<div class="ins-row"><span class="ins-k">Clickables</span><span class="ins-v g">${c.clickables.length} on screen</span></div>`:''}
  `;
}

// ════════════════════════════════════════════
//  CLICK LOG
// ════════════════════════════════════════════
function addToClickLog(c){
  const lb=c.lb||c.txt||c.text||c.d||'?';
  const dom=g('clickLogDom');
  // Preserve scroll position if user scrolled up
  const atTop=dom.scrollTop<20;
  const item=document.createElement('div'); item.className='click-item';
  item.innerHTML=`
    <div class="ci-r1">
      <span class="ci-label">${esc(lb)}</span>
      <span class="ci-time">${tFmt(c.t)}</span>
    </div>
    <div class="ci-pkg">${esc(c.pkg||'?')}</div>
    <div class="ci-meta">
      <span class="ci-xy">(${c.x||0},${c.y||0})</span>
      ${c.cls?`<span class="ci-cls">${esc((c.cls||'').split('.').pop())}</span>`:''}
      ${c.clickables?`<span style="font-family:var(--mono);font-size:7px;color:var(--g);padding:1px 4px;border-radius:3px;background:var(--gg);border:1px solid rgba(0,240,122,.2)">${c.clickables.length} clk</span>`:''}
    </div>`;
  item.addEventListener('click',()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);toast('🎯',lb.slice(0,30),900)});
  if(dom.firstChild?.classList?.contains('dim-msg')) dom.innerHTML='';
  dom.insertBefore(item,dom.firstChild);
  if(atTop) dom.scrollTop=0;
  // Limit log DOM to 60 items
  while(dom.children.length>60) dom.removeChild(dom.lastChild);
}

// ════════════════════════════════════════════
//  SESSION MANAGEMENT
// ════════════════════════════════════════════
function startSession(sid){
  currentSessionId=sid; sessionStartTime=Date.now();
  sessionSnapCount=0; sessionClickCount=0;
  const ind=g('sessInd'); ind.classList.add('on');
  g('sessIndTxt').textContent='Session: '+String(sid).slice(-6);
  clearInterval(durTimer);
  durTimer=setInterval(()=>{ if(g('sSessDur')) g('sSessDur').textContent=durFmt(Date.now()-sessionStartTime) },1000);
  toast('▶','Session started: '+String(sid).slice(-6),2000,'g');
}

function endSession(){
  if(!currentSessionId) return;
  const summary={
    sessionId: currentSessionId,
    startTime: sessionStartTime,
    endTime:   Date.now(),
    durationMs:Date.now()-sessionStartTime,
    totalSnaps: sessionSnapCount,
    totalClicks:sessionClickCount,
    finalPkg:   memCurrentSnap?.pkg||'—',
    topPkgs:    Object.entries(memStats.byPkg).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([pkg,count])=>({pkg,count})),
    clicksByHour:{...memStats.byHour}
  };
  memSessions.unshift(summary);
  if(memSessions.length>20) memSessions.pop();
  // Save to Firebase (only write at session end per Rule 5)
  if(uid&&did){
    set(rp('lastSession'),summary).catch(e=>console.warn('lastSession save:',e));
  }
  clearInterval(durTimer);
  const ind=g('sessInd'); ind.classList.remove('on');
  g('sessIndTxt').textContent='No session';
  g('sSessDur').textContent='—';
  currentSessionId=null; sessionStartTime=0; sessionSnapCount=0; sessionClickCount=0;
  renderSessionList();
  toast('⏹','Session saved',2500,'g');
}

function updateActiveSession(){
  if(!currentSessionId) return;
  g('sTotalSnaps').textContent=memStats.totalSnaps;
  g('sTotalClicks').textContent=memStats.totalClicks;
  g('sApps').textContent=Object.keys(memStats.byPkg).length;
}

// ════════════════════════════════════════════
//  SESSION LIST RENDER
// ════════════════════════════════════════════
function renderSessionList(){
  const dom=g('svList');
  if(!memSessions.length){
    dom.innerHTML='<div class="sv-empty"><div class="sv-empty-ico">📡</div><div>No sessions yet</div><div style="font-size:9px;color:var(--dm2)">Sessions stored in memory only</div></div>';
    return;
  }
  dom.innerHTML='';
  memSessions.forEach((s,idx)=>{
    const card=document.createElement('div');
    card.className='sv-card';
    const dur=durFmt(s.durationMs);
    const pkg=shortPkg(s.finalPkg||'—');
    card.innerHTML=`
      <div class="svc-top">
        <span class="svc-id">${String(s.sessionId||idx).slice(-10)}</span>
        <span class="svc-badge stop">■ DONE</span>
      </div>
      <div class="svc-row">
        <span>Duration<span class="svc-val">${dur}</span></span>
        <span>Snaps<span class="svc-val">${s.totalSnaps||0}</span></span>
        <span>App<span class="svc-val">${pkg}</span></span>
      </div>
      <span class="svc-arr">›</span>`;
    card.addEventListener('click',()=>selectSession(s));
    dom.appendChild(card);
  });
  // Live session card at top if active
  if(currentSessionId){
    const liveCard=document.createElement('div');
    liveCard.className='sv-card live';
    liveCard.style.order='-1';
    liveCard.innerHTML=`
      <div class="svc-top">
        <span class="svc-id">${String(currentSessionId).slice(-10)}</span>
        <span class="svc-badge run">▶ LIVE</span>
      </div>
      <div class="svc-row">
        <span>Duration<span class="svc-val" id="liveDur">—</span></span>
        <span>Snaps<span class="svc-val">${sessionSnapCount}</span></span>
        <span>Clicks<span class="svc-val">${sessionClickCount}</span></span>
      </div>
      <span class="svc-arr">›</span>`;
    dom.insertBefore(liveCard,dom.firstChild);
  }
}

function selectSession(s){
  selSessId=s.sessionId;
  selSessSnaps=memSnaps.filter(sn=>sn.sid===s.sessionId);
  g('svBackId').textContent=String(s.sessionId||'').slice(-12);
  g('svBackBadge').textContent='■ DONE';
  g('svBackBadge').className='svc-badge stop';
  g('svSnaps').textContent=s.totalSnaps||0;
  g('svDur').textContent=durFmt(s.durationMs);
  g('svClk').textContent=s.totalClicks||0;
  g('svList').classList.add('hidden');
  g('svDetail').classList.add('visible');
  renderSnapFeed();
}

function renderSnapFeed(){
  const feed=g('svSnapFeed');
  if(!selSessSnaps.length){
    feed.innerHTML='<div class="sv-empty"><div class="sv-empty-ico">🔍</div><div>Snaps stored per-session in memory</div><div style="font-size:9px;color:var(--dm2)">Start a reader session to capture snaps</div></div>';
    return;
  }
  feed.innerHTML='';
  selSessSnaps.slice(0,100).forEach((snap,idx)=>{
    const div=document.createElement('div');
    div.className='sv-snap'+(idx===0?' latest':'');
    const ec=snap.ec||0, cc=snap.cc||0;
    const pkg=snap.pkg||'—', ft=snap.ft||'';
    div.innerHTML=`
      <div class="sv-snap-hdr${idx===0?' open':''}">
        <span class="sv-snap-ts">${tFmt(snap.ts||snap._rcvTs)}</span>
        <span class="sv-snap-pkg">${esc(pkg)}</span>
        <div class="sv-snap-pills">
          <span class="sv-pill c">${ec}</span>
          ${cc?`<span class="sv-pill g">📌${cc}</span>`:''}
        </div>
        <span class="sv-snap-chevron">▶</span>
      </div>
      <div class="sv-snap-body${idx===0?' on':''}">
        <div class="sv-snap-ft">${esc(ft||'(no text)')}</div>
        <div class="sv-snap-acts">
          <button class="sv-snap-act" onclick="loadSnapPhone(${idx})">📱 View</button>
          <button class="sv-snap-act" onclick="copyTxt('${esc(ft.replace(/'/g,"\\'").slice(0,500))}')">📋 Copy</button>
        </div>
      </div>`;
    const hdr=div.querySelector('.sv-snap-hdr');
    const body=div.querySelector('.sv-snap-body');
    hdr.addEventListener('click',()=>{const o=body.classList.toggle('on');hdr.classList.toggle('open',o)});
    feed.appendChild(div);
  });
}

function loadSnapPhone(idx){ if(selSessSnaps[idx]){renderBp(selSessSnaps[idx]);processSnap(selSessSnaps[idx]);toast('📱','Snap loaded',1200,'g')} }
function backToSessions(){ g('svList').classList.remove('hidden'); g('svDetail').classList.remove('visible'); selSessId=null; selSessSnaps=[]; }
function clearSessions(){ memSessions=[]; renderSessionList(); toast('🗑','Sessions cleared',1500,'a'); }

// ════════════════════════════════════════════
//  HISTORY
// ════════════════════════════════════════════
function filterHistory(){
  histSearch=g('chSearch').value.trim().toLowerCase();
  histFiltered=clickHistory.filter(c=>{
    if(pkgFilter!=='all'&&(c.pkg||'')!==pkgFilter) return false;
    if(!histSearch) return true;
    return (c.lb||c.txt||c.text||'').toLowerCase().includes(histSearch)||
      (c.pkg||'').toLowerCase().includes(histSearch)||
      (c.vid||'').toLowerCase().includes(histSearch);
  });
  renderHistory();
}
function setPkgFilter(pkg,el){
  pkgFilter=pkg;
  document.querySelectorAll('.ch-f').forEach(f=>f.classList.remove('on'));
  el.classList.add('on');
  filterHistory();
}
function buildPkgFilters(){
  const pkgs=[...new Set(clickHistory.map(c=>c.pkg||'?'))].sort();
  const row=g('chFilters');
  row.innerHTML=`<span class="ch-f${pkgFilter==='all'?' on':''}" data-pkg="all" onclick="setPkgFilter('all',this)">All</span>`;
  pkgs.slice(0,10).forEach(p=>{
    const sp=document.createElement('span');
    sp.className='ch-f'+(pkgFilter===p?' on':'');
    sp.dataset.pkg=p; sp.textContent=shortPkg(p);
    sp.onclick=function(){setPkgFilter(p,this)};
    row.appendChild(sp);
  });
  g('chTotal').textContent=clickHistory.length;
  g('chUniq').textContent=[...new Set(clickHistory.map(c=>c.lb||c.txt||'?'))].length;
  g('chPkgs').textContent=[...new Set(clickHistory.map(c=>c.pkg||'?'))].length;
  g('chSess').textContent=[...new Set(clickHistory.filter(c=>c.sid).map(c=>c.sid))].length;
}
function renderHistory(){
  buildPkgFilters();
  if(!histFiltered.length) histFiltered=[...clickHistory];
  const feed=g('chFeed');
  if(!histFiltered.length){feed.innerHTML='<div class="dim-msg"><span style="font-size:24px;opacity:.12">📜</span>No click history yet</div>';return}
  const frag=document.createDocumentFragment();
  histFiltered.slice(0,200).forEach((c,idx)=>{
    const lb=c.lb||c.txt||c.text||c.d||'?';
    const div=document.createElement('div'); div.className='ch-item';
    div.innerHTML=`
      <div class="ch-num">${histFiltered.length-idx}</div>
      <div class="ch-body">
        <div class="ch-label">${esc(lb)}</div>
        <div class="ch-pkg">${esc(c.pkg||'?')}</div>
        <div class="ch-meta2">
          <span class="ch-xy">(${c.x||0},${c.y||0})</span>
          <span class="ch-ts">${tFmt(c.t)}</span>
          ${c.cls?`<span class="ch-cls">${esc((c.cls||'').split('.').pop())}</span>`:''}
        </div>
      </div>`;
    div.addEventListener('click',()=>{spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);toast('🎯',lb.slice(0,30),900)});
    frag.appendChild(div);
  });
  feed.innerHTML=''; feed.appendChild(frag);
}
function exportHistory(){
  if(!clickHistory.length){toast('⚠','No history',2000,'a');return}
  const blob=new Blob([JSON.stringify(clickHistory,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`clicks_${Date.now()}.json`; a.click();
  toast('⤓','Exported '+clickHistory.length+' clicks',2000,'g');
}

// ════════════════════════════════════════════
//  STATS
// ════════════════════════════════════════════
function renderStatBars(){
  const entries=Object.entries(memStats.byPkg).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max=entries[0]?entries[0][1]:1;
  const dom=g('pkgBars');
  if(!entries.length){dom.innerHTML='';return}
  dom.innerHTML=entries.map(([pkg,cnt])=>{
    const pct=Math.round(cnt/max*100);
    return`<div class="stat-bar-row">
      <span class="sbl" title="${esc(pkg)}">${esc(shortPkg(pkg))}</span>
      <div class="sbb"><div class="sbf" style="width:${pct}%"></div></div>
      <span class="sbn">${cnt}</span>
    </div>`;
  }).join('');
  g('sApps').textContent=Object.keys(memStats.byPkg).length;
}

// ════════════════════════════════════════════
//  A11Y TAB
// ════════════════════════════════════════════
function startA11y(){
  if(!wrtcConnected){toast('⚠','Connect WebRTC first',2500,'a');return}
  // Send startLiveA11y command (device maps to startReader internally)
  if(!sendCmd({action:'startLiveA11y'})){return}
  a11yListening=true;
  g('a11yIdle').style.display='none';
  g('a11yLive').style.display='flex';
  setStatus('🌲 Live A11y listening…');
  toast('🌲','A11y listener started',2000,'p');
  listenResult(msg=>{
    if(msg.includes('reader_started')){
      const sid=msg.split(':')[1]?.trim();
      if(sid) startSession(sid);
      toast('🌲','A11y reader active!',2000,'g');
    }
    setStatus('🌲 A11y: '+msg);
  },25000);
  renderA11y();
}

function stopA11y(){
  sendCmd({action:'stopReader'});
  a11yListening=false;
  g('a11yIdle').style.display='flex';
  g('a11yLive').style.display='none';
  g('a11yClkPanel').style.display='none';
  endSession();
  toast('⏹','A11y stopped',2000,'a');
}

function setA11yFilter(f, el){
  a11yFilter=f;
  document.querySelectorAll('.a11y-f').forEach(b=>{ b.className=b.className.replace(/ on(-c)?/g,'') });
  el.classList.add(f==='all'?'on':'on-c');
  renderA11y();
}

function renderA11y(){
  if(!a11yListening||!curSnap) return;
  const tree=g('a11yTree');
  const els=curSnap.els||curSnap.elements||[];
  const search=g('a11ySearch')?.value?.trim()?.toLowerCase()||'';
  const atTop=tree.scrollTop<20;

  let filtered=els.filter(el=>{
    if(a11yFilter==='click' && !(el.ck||el.clickable)) return false;
    if(a11yFilter==='edit'  && !(el.ed||el.editable))  return false;
    if(a11yFilter==='text'  && !(el.t||el.text||el.d||el.desc)) return false;
    if(search){
      const txt=(el.t||el.text||el.d||el.desc||'').toLowerCase();
      const cls=(el.cl||el.class||'').toLowerCase();
      const vi=(el.vi||el.viewId||'').toLowerCase();
      if(!txt.includes(search)&&!cls.includes(search)&&!vi.includes(search)) return false;
    }
    return true;
  });

  if(!filtered.length){
    tree.innerHTML='<div class="dim-msg" style="font-size:9px">No elements match</div>';
    return;
  }

  g('a11yCounts').textContent=filtered.length+' els';

  const frag=document.createDocumentFragment();
  filtered.slice(0,120).forEach(el=>{
    const ck=el.ck||el.clickable, ed=el.ed||el.editable;
    const txt=(el.t||el.text||'').trim();
    const dsc=(el.d||el.desc||'').trim();
    const cls=(el.cl||el.class||'').split('.').pop();
    const vi=(el.vi||el.viewId||'').split('/').pop();
    const label=txt||dsc||vi||cls||'?';
    const bx=el.b||{};
    const depth=el.dp||0;

    const div=document.createElement('div');
    div.className='a11y-el'+(ck?' ck':ed?' ed':'');
    div.style.paddingLeft=(8+depth*4)+'px';

    const ico=ck?'🟢':ed?'🟡':'⬜';
    div.innerHTML=`
      <span class="a11y-el-ico">${ico}</span>
      <div class="a11y-el-body">
        <div class="a11y-el-label">${esc(label.slice(0,60))}</div>
        <div class="a11y-el-sub">${esc(cls||vi||'')} ${bx.w?`${Math.round(bx.w)}×${Math.round(bx.h)}`:''}${depth?' d:'+depth:''}</div>
        <div class="a11y-el-tags">
          ${ck?'<span class="a11y-el-tag ck">tap</span>':''}
          ${ed?'<span class="a11y-el-tag ed">edit</span>':''}
        </div>
      </div>
      ${ck?`<button class="a11y-el-tap" onclick="event.stopPropagation();sendCmd({action:'tap',x:${Math.round(bx.x||0)},y:${Math.round(bx.y||0)}});spawnRipple(${Math.round((bx.x||0)*scX)},${Math.round((bx.y||0)*scY)},'tap','${esc(label.slice(0,20)).replace(/'/g,"\\'")}')">✛ Tap</button>`:''}
    `;
    div.addEventListener('click',()=>{
      showEhc(el, (bx.x||0)*scX, (bx.y||0)*scY, (bx.w||0)*scX, (bx.h||0)*scY);
    });
    frag.appendChild(div);
  });
  tree.innerHTML=''; tree.appendChild(frag);
  if(atTop) tree.scrollTop=0;
}

// A11y clickables panel (all clickables from last click event)
function renderA11yClickables(){
  const list=g('a11yClkList');
  g('a11yClkBadge').textContent=lastClickables.length;
  if(!lastClickables.length){list.innerHTML='';return}
  const frag=document.createDocumentFragment();
  lastClickables.forEach(c=>{
    const lb=c.lb||'?';
    const div=document.createElement('div'); div.className='a11y-clk-item';
    div.innerHTML=`
      <span class="a11y-clk-label">${esc(lb.slice(0,28))}</span>
      <span class="a11y-clk-xy">${c.x||0},${c.y||0}</span>
      ${(c.ck||c.ed)?`<button class="a11y-clk-tap" onclick="event.stopPropagation();sendCmd({action:'tap',x:${c.x||0},y:${c.y||0}})">Tap</button>`:''}
    `;
    div.addEventListener('click',()=>{
      spawnRipple((c.x||0)*scX,(c.y||0)*scY,'clk',lb);
      toast('🎯',lb.slice(0,30),900);
    });
    frag.appendChild(div);
  });
  list.innerHTML=''; list.appendChild(frag);
}

function toggleClkPanel(){
  clkPanelOpen=!clkPanelOpen;
  g('a11yClkList').style.display=clkPanelOpen?'block':'none';
}

// ════════════════════════════════════════════
//  STATS + EXPORT
// ════════════════════════════════════════════
function exportSession(){
  const data={snaps:memSnaps,clicks:memClicks,sessions:memSessions,stats:memStats,ts:Date.now()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`nexus_session_${Date.now()}.json`; a.click();
  toast('⤓','Session exported',2000,'g');
}

function copyTxt(t){
  navigator.clipboard?.writeText(t).then(()=>toast('📋','Copied!',1500,'g')).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('📋','Copied!',1500,'g');
  });
}

// ════════════════════════════════════════════
//  BUTTON ENABLE/DISABLE
// ════════════════════════════════════════════
const ALL_BTNS=[
  'btnRS','btnRSP','btnSR','btnSRP','btnStop','btnWake','btnHome','btnBack','btnRec',
  'btnA11y','bBack','bHome','bRec','bUp','bDown','bWake',
  'qaHome','qaBack','qaRec','qaRS','qaUp','qaDown','qaLeft','qaRight','qaWake'
];
function enableAllButtons(){ALL_BTNS.forEach(id=>{const el=g(id);if(el){el.disabled=false;el.removeAttribute('disabled')}})}
function disableAllButtons(){ALL_BTNS.forEach(id=>{const el=g(id);if(el){el.disabled=true;el.setAttribute('disabled','')}})}

// ════════════════════════════════════════════
//  CONFIRM CLEAR
// ════════════════════════════════════════════
function confirmClear(action,title,msg){
  pendingAction=action; g('dlgTitle').textContent=title; g('dlgMsg').textContent=msg;
  g('dlgOverlay').classList.add('on');
}
function closeDlg(){g('dlgOverlay').classList.remove('on'); pendingAction=null}
async function doDlgAction(){
  closeDlg(); if(!pendingAction||!uid||!did) return;
  const action=pendingAction;
  toast('🗑','Clearing…',2000,'r');
  try{
    if(action==='clearClicks'||action==='clearAll'){
      await remove(rp('live/lastClick'));
      memClicks=[]; g('clickLogDom').innerHTML='<div class="dim-msg">Cleared</div>'; g('clickBadge').textContent='0';
    }
    if(action==='clearAll'){
      await remove(rp('live')); await remove(rp('debug'));
      memSnaps=[]; memCurrentSnap=null; curSnap=null;
      g('pfEmpty').style.display='flex'; bpSvg.innerHTML=''; pdLayer.innerHTML='';
      g('curPkg').textContent='—'; g('curEl').textContent='—'; g('curClk').textContent='—';
      clickHistory=[];histFiltered=[]; renderHistory();
      memStats={totalClicks:0,totalSnaps:0,byPkg:{},byHour:{}};
      g('sTotalSnaps').textContent='0'; g('sTotalClicks').textContent='0'; g('sApps').textContent='0';
    }
    toast('✅','Cleared!',2000,'g');
  }catch(e){toast('❌','Failed: '+e.message,3000,'r')}
}

// ════════════════════════════════════════════
//  DEVICE META (from Firebase)
// ════════════════════════════════════════════
function updateMeta(meta){
  if(!meta) return;
  const on=meta.status==='active';
  if(currentMode!=='wrtc'){
    g('devChip').className='dev-chip '+(on?'on':'');
    g('devLabel').textContent=(meta.model||'Device')+' · '+(on?'Online':'Offline');
  }
  g('iModel').textContent=meta.model||'—';
  g('iBrand').textContent=meta.brand||'—';
  g('iApiL').textContent=meta.api||'—';
  g('iVer').textContent=meta.version||'—';
  g('iSeen').textContent=meta.seen?tFmt(meta.seen):'—';
  const sc=meta.scr;
  if(sc){g('iScreen').textContent=`${sc.w}×${sc.h}`;sizePf(sc.w,sc.h)}
}
let currentMode='wrtc'; // always WebRTC in this file

// ════════════════════════════════════════════
//  TAB CLOSE / UNLOAD
// ════════════════════════════════════════════
window.addEventListener('beforeunload',()=>{
  // Signal device to stop via commands channel
  if(wrtcConnected&&commandsCh?.readyState==='open'){
    try{commandsCh.send(JSON.stringify({type:'stop',ts:Date.now()}));}catch(e){}
  }
  // Close peer connection
  try{pc?.close();}catch(e){}
  // The onDisconnect().remove() on the offer node will auto-signal device
});

// ════════════════════════════════════════════
//  AUTH INIT
// ════════════════════════════════════════════
onAuthStateChanged(auth, async user=>{
  tl.auth=Date.now();
  if(!user){
    setStatus('🔴 Not authenticated — sign in first');
    g('devChip').className='dev-chip err'; g('devLabel').textContent='Not signed in';
    toast('🔴','Please sign in',4000,'r');
    return;
  }
  uid=user.uid;
  sigStepDone(0); sigStepActive(1);
  g('iUid').textContent=uid.slice(0,8)+'…';
  setStatus('🔑 Authenticated, loading device…');

  tl.device=Date.now();
  const snap=await get(ref(db,`users/${uid}/storeId`)).catch(()=>null);
  did=snap?.val();
  if(!did){
    setStatus('❌ No device linked — check Firebase storeId');
    toast('❌','No device found',4000,'r');
    return;
  }
  sigStepDone(1); sigStepActive(2);
  tl.device=Date.now();
  g('iDid').textContent=did.slice(0,10)+'…';
  g('devChip').className='dev-chip';
  g('devLabel').textContent='Device ready';
  setStatus('✅ Auth OK · Device found · Ready to connect');
  toast('✅','Auth OK! Click "Connect WebRTC"',3000,'g');

  sizePf(1080,2340);

  // Load device meta (Firebase listener — just for hardware info)
  metaUnsub=onValue(rp('meta'),snap=>{updateMeta(snap.val())});

  // Load last session from Firebase (Rule 5 - read once on page load)
  get(rp('lastSession')).then(s=>{
    const d=s.val();
    if(d&&d.sessionId){
      memSessions.push(d);
      setSbFoot('Last session: '+durFmt(d.durationMs||0)+' · '+shortPkg(d.finalPkg||'—'));
    }
  }).catch(()=>{});

  g('btnWRTC').disabled=false;
  g('a11yStartBtn').disabled=true; // enabled after WebRTC connects
});
