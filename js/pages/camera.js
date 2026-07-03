import { db, auth } from "../api/firebase.js";
import {
  ref, get, set, remove, push, off,
  onValue, onChildAdded, onDisconnect
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ═══════════════════════════════════════════════════════════════════════
//  ICE SERVERS
// ═══════════════════════════════════════════════════════════════════════
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80?transport=tcp',  username: 'openrelayproject', credential: 'openrelayproject' },
];

const PC_CONFIG = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
  bundlePolicy:      'max-bundle',
  rtcpMuxPolicy:     'require',
  iceTransportPolicy:'all',
};

// ═══════════════════════════════════════════════════════════════════════
//  IDENTITY & FIREBASE
// ═══════════════════════════════════════════════════════════════════════
let UID = null, DID = null, rtcRef = null;

// ═══════════════════════════════════════════════════════════════════════
//  STREAM CONFIG
// ═══════════════════════════════════════════════════════════════════════
let cfgCam = 'front', cfgAud = false;

// ═══════════════════════════════════════════════════════════════════════
//  CONNECTION STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════
const STATE = {
  IDLE:           'idle',
  CONNECTING:     'connecting',
  NEGOTIATING:    'negotiating',
  STREAMING:      'streaming',
  RECONNECTING:   'reconnecting',
  ERROR:          'error',
  CLEANUP:        'cleanup'
};

let connectionState = STATE.IDLE;

// ═══════════════════════════════════════════════════════════════════════
//  PEER CONNECTION & STREAMS
// ═══════════════════════════════════════════════════════════════════════
let pc                     = null;
let pcBuildInProgress      = false;          // Prevent concurrent PC builds
let micStream              = null;           // Cached mic — reused, never stopped
let localVideoStream       = null;           // Camera for video call
let remoteVideoStream      = null;
let dataChannel            = null;           // Future: RTCDataChannel for control

// ═══════════════════════════════════════════════════════════════════════
//  NEGOTIATION STATE
// ═══════════════════════════════════════════════════════════════════════
let currentCam             = null;
let lastProcessedOfferSdp  = null;           // Track processed offer to avoid duplicates
let lastAnswerSent         = null;           // Track sent answer
let awaitingRemoteDesc     = false;          // True while waiting for remote description to be applied
let pendingIceCandidates   = [];             // Buffer ICE candidates until remote desc is set
let appliedAndIceKeys      = new Set();      // Track applied ICE keys
let andIceUnsub            = null;           // Unsubscribe callback for Android ICE listener

// ═══════════════════════════════════════════════════════════════════════
//  TIMERS & LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════
let streamStart            = null;
let elapsedTimer           = null;
let offerTimeoutTimer      = null;
let videoTrackTimer        = null;
let iceRetryTimer          = null;
let reconnectDelayTimer    = null;
let iceRestartTimer        = null;
let firebaseStatusUnsub    = null;           // Unsubscribe from status listener
let firebaseOfferUnsub     = null;           // Unsubscribe from offer listener
let firebaseVideoCallUnsub = null;           // Unsubscribe from video call listener

const MAX_ICE_RETRIES      = 5;
let iceRetryCount          = 0;

// ═══════════════════════════════════════════════════════════════════════
//  CONTROL STATE
// ═══════════════════════════════════════════════════════════════════════
let isTalking              = false;
let isAndAudioMuted        = false;
let isVideoCallActive      = false;
let isSelfViewSwapped      = false;
let isPiPActive            = false;
let isStreaming            = false;
let liveResumeType         = null;
let liveResumeCam          = null;

// ═══════════════════════════════════════════════════════════════════════
//  GUARD: Prevents double-click on start/stop buttons
// ═══════════════════════════════════════════════════════════════════════
let isBusy = false;

// ═══════════════════════════════════════════════════════════════════════
//  DOM CACHE — Reduce repeated getElementById
// ═══════════════════════════════════════════════════════════════════════
const DOM = {
  preOverlay:         null,
  loadingOverlay:     null,
  loadingMsg:         null,
  loadingDetail:      null,
  controlsBar:        null,
  volPanel:           null,
  selfViewWrap:       null,
  remoteVideo:        null,
  selfView:           null,
  androidAudio:       null,
  statusLabel:        null,
  statusSub:          null,
  statusIcon:         null,
  iceDot:             null,
  iceLabel:           null,
  iIce:               null,
  connDot:            null,
  liveBadge:          null,
  camLabel:           null,
  audioBadge:         null,
  vcallBadge:         null,
  pipBadge:           null,
  iElapsed:           null,
  iCamera:            null,
  iSdp:               null,
  iWebMic:            null,
  iAndMic:            null,
  iMode:              null,
  headerDeviceId:     null,
  btnStart:           null,
  btnVcallStart:      null,
  btnTalk:            null,
  btnAndMic:          null,
  btnVcall:           null,
  btnPip:             null,
  volSlider:          null,
  volVal:             null,
  logBody:            null,
  toast:              null,
  audioUnlockBar:     null,
  liveDetectBanner:   null,
  liveDetectSub:      null,
  resumeBtn:          null,
  selFront:           null,
  selBack:            null,
  selAudOn:           null,
  selAudOff:          null,
};

function cacheDomElements() {
  const ids = Object.keys(DOM);
  for (const id of ids) {
    const camelId = id.replace(/([A-Z])/g, c => 'lstep' + c || c.toLowerCase());
    let element = document.getElementById(id);
    if (!element && id.startsWith('lstep')) {
      element = document.getElementById(id);
    }
    DOM[id] = element;
  }
  // Special: load steps
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById('lstep' + i);
    if (!DOM['lstep' + i]) DOM['lstep' + i] = el;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  BANDWIDTH INJECTION
// ═══════════════════════════════════════════════════════════════════════
function injectBandwidth(sdp, kbps) {
  try {
    return sdp.split(/(?=m=)/).map(s => {
      if (s.startsWith('m=video')) {
        s = s.replace(/b=AS:\d+\r\n/g,'').replace(/b=TIAS:\d+\r\n/g,'');
        const i = s.indexOf('\r\n');
        if (i >= 0)
          s = s.slice(0,i+2)+`b=AS:${kbps}\r\nb=TIAS:${kbps*1000}\r\n`+s.slice(i+2);
      }
      return s;
    }).join('');
  } catch(e) {
    log('Bandwidth injection failed: ' + e.message, 'warn');
    return sdp;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  LOGGING & TOAST
// ═══════════════════════════════════════════════════════════════════════
function log(msg, type='') {
  const body = DOM.logBody;
  if (!body) return;
  const t = new Date().toTimeString().slice(0,8);
  const el = document.createElement('div');
  el.className = 'le';
  el.innerHTML = `<span class="lt">${t}</span><span class="lm ${type}">${escHtml(msg)}</span>`;
  body.prepend(el);
  if (body.children.length > 200) body.lastChild?.remove();
  console.log(`[${t}] ${msg}`);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTid = null;
function toast(msg, ms=3500) {
  const el = DOM.toast;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTid);
  toastTid = setTimeout(() => el.classList.remove('on'), ms);
}

// ═══════════════════════════════════════════════════════════════════════
//  LOADING STEPS
// ═══════════════════════════════════════════════════════════════════════
function setLoadingStep(idx, detail='') {
  for (let i = 0; i < 5; i++) {
    const el = DOM['lstep' + i];
    if (!el) continue;
    const ic = el.querySelector('.lstep-icon');
    el.classList.remove('active','done');
    if (i < idx) {
      el.classList.add('done');
      ic.innerHTML='<svg viewBox="0 0 10 10" fill="none" width="10" height="10"><path d="M2 5l2.5 2.5L8 3" stroke="#22c55e" stroke-width="1.4" stroke-linecap="round"/></svg>';
    } else if (i===idx) {
      el.classList.add('active');
      ic.innerHTML='<div class="lstep-spin"></div>';
    } else {
      ic.innerHTML='';
    }
  }
  if (detail && DOM.loadingDetail) DOM.loadingDetail.textContent = detail;
}

function showLoading(msg) {
  if (DOM.loadingMsg) DOM.loadingMsg.textContent = msg||'Please wait…';
  if (DOM.loadingOverlay) DOM.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  if (DOM.loadingOverlay) DOM.loadingOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════
//  PRE-OVERLAY
// ═══════════════════════════════════════════════════════════════════════
function showPreOverlay() {
  hideLoading();
  if (DOM.preOverlay) DOM.preOverlay.classList.remove('hidden');
  if (DOM.controlsBar) DOM.controlsBar.classList.remove('visible');
  if (DOM.volPanel) DOM.volPanel.style.display = 'none';
  if (DOM.selfViewWrap) DOM.selfViewWrap.style.display = 'none';
  setStartButtonsDisabled(false);
  isBusy = false;
}

function hidePreOverlay() {
  if (DOM.preOverlay) DOM.preOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════
//  STATUS HELPERS
// ═══════════════════════════════════════════════════════════════════════
function setStatus(label, sub, col) {
  if (DOM.statusLabel) DOM.statusLabel.textContent = label;
  if (DOM.statusSub) DOM.statusSub.textContent = sub;
  const map={green:'rgba(34,197,94,.12)',amber:'rgba(245,158,11,.12)',red:'rgba(239,68,68,.12)',gray:'var(--surface2)'};
  if (DOM.statusIcon) DOM.statusIcon.style.background = map[col]||map.gray;
}

function setIce(s) {
  if (DOM.iceDot) {
    DOM.iceDot.className='ice-dot'+(s==='connected'||s==='completed'?' ok':s==='checking'?' chk':s==='failed'?' fail':'');
  }
  if (DOM.iceLabel) DOM.iceLabel.textContent = s;
  if (DOM.iIce) DOM.iIce.textContent = s;
}

function setConnDot(s) {
  if (DOM.connDot) DOM.connDot.className='conn-dot '+s;
}

function showLive(cam) {
  if (DOM.liveBadge) DOM.liveBadge.classList.add('on');
  if (DOM.camLabel) DOM.camLabel.textContent=(cam||'?').toUpperCase();
}

function hideLive() {
  ['liveBadge','audioBadge','vcallBadge','pipBadge'].forEach(id => {
    const el = DOM[id];
    if (el) el.classList.remove('on');
  });
}

function setAudioBadge(v) {
  if (DOM.audioBadge) DOM.audioBadge.classList.toggle('on',v);
}

function setVcallBadge(v) {
  if (DOM.vcallBadge) DOM.vcallBadge.classList.toggle('on',v);
}

function setPipBadge(v) {
  if (DOM.pipBadge) DOM.pipBadge.classList.toggle('on',v);
}

function startElapsed() {
  streamStart = Date.now();
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(()=>{
    const s = Math.floor((Date.now()-streamStart)/1000);
    if(DOM.iElapsed) DOM.iElapsed.textContent = String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  },1000);
}

function stopElapsed() {
  clearInterval(elapsedTimer);
  if(DOM.iElapsed) DOM.iElapsed.textContent='—';
}

// ═══════════════════════════════════════════════════════════════════════
//  FIREBASE PATHS
// ═══════════════════════════════════════════════════════════════════════
const getRtcPath      = () => `users/${UID}/devices/${DID}/webrtc`;
const getSettingsPath = () => `users/${UID}/devices/${DID}/settings`;

// ═══════════════════════════════════════════════════════════════════════
//  CONFIG SELECTORS
// ═══════════════════════════════════════════════════════════════════════
window.selectCam = function(cam) {
  cfgCam = cam;
  if (DOM.selFront) DOM.selFront.classList.toggle('sel', cam==='front');
  if (DOM.selBack) DOM.selBack.classList.toggle('sel',  cam==='back');
};

window.selectAud = function(on) {
  cfgAud = on;
  if (DOM.selAudOn) DOM.selAudOn.classList.toggle('sel',  on);
  if (DOM.selAudOff) DOM.selAudOff.classList.toggle('sel', !on);
};

function setStartButtonsDisabled(v) {
  if (DOM.btnStart) DOM.btnStart.disabled = v;
  if (DOM.btnVcallStart) DOM.btnVcallStart.disabled = v;
}

// ═══════════════════════════════════════════════════════════════════════
//  MICROPHONE — Cached across sessions, NEVER stopped
// ═══════════════════════════════════════════════════════════════════════
async function ensureMicStream() {
  if (micStream && micStream.active && micStream.getAudioTracks().length > 0) {
    log('🎤 Mic stream already available', 'ok');
    return micStream;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 },
      video:false
    });
    micStream.getAudioTracks().forEach(t => t.enabled = false);
    log('🎤 Mic access granted','ok');
    return micStream;
  } catch(e) {
    log('❌ Mic denied: '+e.message,'err');
    return null;
  }
}

async function getCamera() {
  if (localVideoStream && localVideoStream.active && localVideoStream.getVideoTracks().length>0) {
    log('📷 Camera already available', 'ok');
    return localVideoStream;
  }
  try {
    localVideoStream = await navigator.mediaDevices.getUserMedia({
      video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},
      audio:false
    });
    log('📷 Camera access granted', 'ok');
    return localVideoStream;
  } catch(e) {
    log('❌ Camera denied: '+e.message,'err');
    toast('❌ Camera permission denied for video call');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIO UNLOCK (browser autoplay policy)
// ═══════════════════════════════════════════════════════════════════════
let audioUnlocked = false;

async function ensureAudioContext() {
  if (audioUnlocked) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(1,1,22050);
    const src = ac.createBufferSource();
    src.buffer = buf; src.connect(ac.destination); src.start(0);
    await ac.resume(); await ac.close();
    audioUnlocked = true;
    log('🔊 Audio context unlocked', 'ok');
  } catch(e) {
    log('Audio context unlock failed: ' + e.message, 'warn');
  }
}

async function safeVideoPlay(vid, stream) {
  if (!vid || !stream) return;
  vid.srcObject = stream;
  vid.muted = true;
  try {
    await vid.play();
    vid.muted = false;
    hideAudioUnlockBar();
    log('📹 Video playback started', 'ok');
  } catch(e) {
    vid.muted = false;
    showAudioUnlockBar();
    log('Autoplay blocked — tap to enable audio','warn');
    const unlock = async () => {
      try {
        await vid.play();
        hideAudioUnlockBar();
        log('🔓 Unlocked via user interaction', 'ok');
      } catch(_) {
        log('Unlock failed', 'warn');
      }
      document.removeEventListener('click',      unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click',      unlock, {once:true});
    document.addEventListener('touchstart', unlock, {once:true, passive:true});
  }
}

async function safeAudioPlay(aEl) {
  if (!aEl) return;
  aEl.muted = isAndAudioMuted;
  try {
    await aEl.play();
    if (!isAndAudioMuted) {
      setAudioBadge(true);
      hideAudioUnlockBar();
      log('🔊 Android audio live','ok');
    }
  } catch(e) {
    showAudioUnlockBar();
    log('Audio autoplay blocked — tap to enable','warn');
    const unlock = async () => {
      try {
        await aEl.play();
        if (!isAndAudioMuted) {
          setAudioBadge(true);
          hideAudioUnlockBar();
          log('🔊 Audio enabled via unlock','ok');
        }
      } catch(_) {
        log('Audio unlock failed', 'warn');
      }
      document.removeEventListener('click',      unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click',      unlock, {once:true});
    document.addEventListener('touchstart', unlock, {once:true, passive:true});
  }
}

function showAudioUnlockBar() {
  if (DOM.audioUnlockBar) DOM.audioUnlockBar.classList.add('show');
}

function hideAudioUnlockBar() {
  if (DOM.audioUnlockBar) DOM.audioUnlockBar.classList.remove('show');
}

window.unlockAudio = async function() {
  hideAudioUnlockBar();
  await ensureAudioContext();
  if (DOM.remoteVideo && !DOM.remoteVideo.paused && DOM.remoteVideo.srcObject) {
    try { await DOM.remoteVideo.play(); } catch(_) {}
  }
  if (DOM.androidAudio && !DOM.androidAudio.paused && DOM.androidAudio.srcObject) {
    try { await DOM.androidAudio.play(); } catch(_) {}
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  PICTURE-IN-PICTURE
// ═══════════════════════════════════════════════════════════════════════
window.togglePiP = async function() {
  const vid = DOM.remoteVideo;
  const btn = DOM.btnPip;
  if (!document.pictureInPictureEnabled) {
    toast('⚠️ PiP not supported on this browser');
    log('PiP not supported','warn');
    return;
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      if (!vid || !vid.srcObject) {
        toast('Start streaming first');
        return;
      }
      await vid.requestPictureInPicture();
    }
  } catch(e) {
    log('PiP error: '+e.message,'err');
    toast('PiP failed — try after stream starts');
  }
};

document.addEventListener('enterpictureinpicture', () => {
  isPiPActive = true;
  if (DOM.btnPip) DOM.btnPip.classList.add('pip-on');
  setPipBadge(true);
  log('🎬 PiP active — video floating','ok');
});

document.addEventListener('leavepictureinpicture', () => {
  isPiPActive = false;
  if (DOM.btnPip) DOM.btnPip.classList.remove('pip-on');
  setPipBadge(false);
  log('PiP closed','warn');
});

// Auto-enter PiP when navigating away
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (isStreaming && document.pictureInPictureEnabled && DOM.remoteVideo) {
      if (DOM.remoteVideo.srcObject && !document.pictureInPictureElement) {
        try {
          await DOM.remoteVideo.requestPictureInPicture();
        } catch(_) {}
      }
    }
    if (micStream) {
      micStream.getAudioTracks().forEach(t => {
        if (!isTalking) t.enabled = false;
      });
    }
  } else {
    if (micStream && isTalking) {
      micStream.getAudioTracks().forEach(t => t.enabled = true);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  FIREBASE CLEANUP
// ═══════════════════════════════════════════════════════════════════════
async function clearRtcSignals() {
  if (!rtcRef) return;
  try {
    await Promise.allSettled([
      remove(ref(db, getRtcPath()+'/offer')),
      remove(ref(db, getRtcPath()+'/answer')),
      remove(ref(db, getRtcPath()+'/android_ice')),
      remove(ref(db, getRtcPath()+'/web_ice')),
    ]);
    log('✅ Cleared RTC signals', 'ok');
  } catch(e) {
    log('⚠️ Signal cleanup error: ' + e.message, 'warn');
  }
}

async function signalOverlayClose() {
  if (!UID||!DID) return;
  try {
    await set(ref(db, getRtcPath()+'/overlay_close'), true);
    log('📤 Sent overlay_close signal', 'ok');
  } catch(e) {
    log('⚠️ overlay_close failed: ' + e.message, 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  LIVE STREAM DETECTION
// ═══════════════════════════════════════════════════════════════════════
async function checkLiveStream() {
  if (!rtcRef) return;
  try {
    const snap   = await get(ref(db, getRtcPath()+'/status'));
    const status = snap.val();
    if (!status) return;
    const banner = DOM.liveDetectBanner;
    const sub    = DOM.liveDetectSub;
    if (status === 'streaming_front' || status === 'streaming_back') {
      liveResumeType = 'video';
      liveResumeCam  = status.replace('streaming_','');
      if (sub) sub.textContent = `📷 ${liveResumeCam.toUpperCase()} camera — tap Resume`;
      if (banner) banner.classList.add('show');
      log(`📡 Live stream detected: ${liveResumeCam}`,'ok');
    }
  } catch(e) {
    log('⚠️ Live check error: '+e.message,'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  RESUME STREAM
// ═══════════════════════════════════════════════════════════════════════
window.resumeStream = async function() {
  if (!rtcRef || !liveResumeType) return;
  const resumeBtn = DOM.resumeBtn;
  if (resumeBtn) resumeBtn.disabled = true;
  if (DOM.liveDetectBanner) DOM.liveDetectBanner.classList.remove('show');

  currentCam = liveResumeCam || 'front';
  cfgCam     = currentCam;
  isStreaming = false;
  lastProcessedOfferSdp = null;
  lastAnswerSent = null;
  appliedAndIceKeys.clear();
  iceRetryCount = 0;
  isBusy = true;
  connectionState = STATE.RECONNECTING;

  hidePreOverlay();
  showLoading('Reconnecting to live stream…');
  setLoadingStep(0,'Sending reconnect signal…');
  log('🔄 Resuming stream: '+currentCam,'ok');

  try {
    await ensureMicStream();
    await clearRtcSignals();
    await set(ref(db, getRtcPath()+'/reconnect'), true);
    scheduleOfferTimeout(currentCam==='back'?'start_back':'start_front', true);
  } catch(e) {
    log('❌ Resume failed: '+e.message,'err');
    toast('❌ Resume failed — try again');
    showPreOverlay();
    connectionState = STATE.IDLE;
    isBusy = false;
    if (resumeBtn) resumeBtn.disabled = false;
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  START STREAM
// ═══════════════════════════════════════════════════════════════════════
window.startStream = async function() {
  if (!rtcRef) {
    toast('❌ Not ready — no device connected');
    return;
  }
  if (isStreaming) {
    log('Already streaming', 'warn');
    return;
  }
  if (isBusy) {
    log('Already busy — wait for previous operation', 'warn');
    return;
  }

  isBusy = true;
  connectionState = STATE.CONNECTING;

  await ensureAudioContext();
  setStartButtonsDisabled(true);
  hidePreOverlay();
  showLoading('Sending start command…');
  setLoadingStep(0,'Reaching Firebase…');
  log('▶ Starting — cam:'+cfgCam+' webMic:'+cfgAud,'ok');

  currentCam = cfgCam;
  isTalking  = cfgAud;
  if (DOM.iCamera) DOM.iCamera.textContent = cfgCam;
  lastProcessedOfferSdp = null;
  lastAnswerSent = null;
  appliedAndIceKeys.clear();
  iceRetryCount = 0;
  clearTimeout(iceRetryTimer);
  clearTimeout(offerTimeoutTimer);
  clearTimeout(reconnectDelayTimer);

  const cmd = cfgCam==='front' ? 'start_front' : 'start_back';

  try {
    await ensureMicStream();
    if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = isTalking);

    await Promise.allSettled([
      remove(ref(db, getRtcPath()+'/video_call_active')),
      remove(ref(db, getRtcPath()+'/overlay_close')),
    ]);
    await clearRtcSignals();
    await set(ref(db, getRtcPath()+'/command'), cmd);
    setLoadingStep(1,'Device starting '+cfgCam+' camera…');
    scheduleOfferTimeout(cmd, false);
  } catch(e) {
    log('❌ Start failed: '+e.message,'err');
    toast('❌ Failed to reach device');
    showPreOverlay();
    connectionState = STATE.ERROR;
    isBusy = false;
  }
};

window.startVideoCallFromConfig = async function() {
  if (!rtcRef) {
    toast('❌ Not ready');
    return;
  }
  if (isStreaming) {
    window.toggleVideoCall();
    return;
  }
  log('📹 Video Call — starting stream first…','ok');
  const oldBusy = isBusy;
  const pendingVcall = true;
  await window.startStream();
  if (isStreaming) {
    setTimeout(() => window.toggleVideoCall(), 1000);
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  OFFER TIMEOUT
// ═══════════════════════════════════════════════════════════════════════
function scheduleOfferTimeout(cmd, isResume=false) {
  clearTimeout(offerTimeoutTimer);
  offerTimeoutTimer = setTimeout(async () => {
    if (lastProcessedOfferSdp || isStreaming) return;
    log('⏱ No offer yet — resending command…','warn');
    try {
      if (isResume) {
        await set(ref(db, getRtcPath()+'/reconnect'), true);
      } else {
        await set(ref(db, getRtcPath()+'/command'), cmd);
      }
      scheduleOfferTimeout(cmd, isResume);
    } catch(e) {
      log('❌ Retry cmd error: '+e.message,'err');
    }
  }, 12000);
}

// ═══════════════════════════════════════════════════════════════════════
//  STOP ALL
// ═══════════════════════════════════════════════════════════════════════
window.stopStream = async function() {
  if (isBusy && !isStreaming) return;
  isBusy = true;
  connectionState = STATE.CLEANUP;
  log('⏹ Stop requested','warn');

  clearTimeout(iceRetryTimer);
  clearTimeout(offerTimeoutTimer);
  clearTimeout(videoTrackTimer);
  clearTimeout(reconnectDelayTimer);
  clearTimeout(iceRestartTimer);

  try {
    if (isVideoCallActive) await stopVideoCallInternal(false);

    // Stop web camera — NOT mic
    if (localVideoStream) {
      localVideoStream.getTracks().forEach(t=>{
        try { t.stop(); } catch(_) {}
      });
      localVideoStream=null;
    }

    // Disable mic (don't stop — keep cached)
    if (micStream) {
      micStream.getAudioTracks().forEach(t => {
        try { t.enabled = false; } catch(_) {}
      });
    }

    // Clear video elements
    if (DOM.remoteVideo) DOM.remoteVideo.srcObject = null;
    if (DOM.androidAudio) DOM.androidAudio.srcObject = null;
    if (DOM.selfView) DOM.selfView.srcObject = null;
    if (DOM.selfViewWrap) DOM.selfViewWrap.style.display = 'none';
    hideAudioUnlockBar();

    // Exit PiP
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch(_) {}
    }

    isSelfViewSwapped = false;
    hideLive();
    stopElapsed();

    setStatus('Stopped','Idle','gray');
    setIce('closed');
    if (DOM.iCamera) DOM.iCamera.textContent='—';
    if (DOM.iSdp) DOM.iSdp.textContent='—';
    if (DOM.iWebMic) DOM.iWebMic.textContent = 'off';
    if (DOM.iAndMic) DOM.iAndMic.textContent = 'on';
    if (DOM.iMode) DOM.iMode.textContent   = 'idle';
    if (DOM.volPanel) DOM.volPanel.style.display = 'none';

    isTalking=false;
    isAndAudioMuted=false;
    isVideoCallActive=false;
    isStreaming=false;
    lastProcessedOfferSdp=null;
    lastAnswerSent=null;
    remoteVideoStream=null;

    ['btnTalk','btnAndMic','btnVcall','btnPip'].forEach(id=>{
      const el = DOM[id];
      if (el) el.classList.remove('a-on','vc-on','pip-on');
    });

    await closePc();

    if (rtcRef) {
      try {
        await clearRtcSignals();
        await remove(ref(db, getRtcPath()+'/video_call_active'));
        await signalOverlayClose();
        await set(ref(db, getRtcPath()+'/command'),'stop');
      } catch(e) {
        log('⚠️ Signal error during stop: ' + e.message, 'warn');
      }
    }
  } catch(e) {
    log('❌ Stop error: '+e.message,'err');
  } finally {
    showPreOverlay();
    connectionState = STATE.IDLE;
    isBusy = false;
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  PEER CONNECTION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════
async function closePc() {
  log('Closing PeerConnection…', 'ok');
  lastProcessedOfferSdp = null;
  lastAnswerSent = null;
  appliedAndIceKeys.clear();
  pendingIceCandidates = [];
  awaitingRemoteDesc = false;
  clearTimeout(iceRetryTimer);
  clearTimeout(iceRestartTimer);

  if (andIceUnsub) {
    try { andIceUnsub(); } catch(_) {}
    andIceUnsub = null;
  }

  if (dataChannel) {
    try { dataChannel.close(); } catch(_) {}
    dataChannel = null;
  }

  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.oniceconnectionstatechange = null;
    pc.ondatachannel = null;
    try { pc.close(); } catch(e) { log('PC close error: ' + e.message, 'warn'); }
    pc = null;
  }
  pcBuildInProgress = false;
  log('✅ PeerConnection closed', 'ok');
}

/**
 * Build PeerConnection with proper initialization.
 * Mic is ALWAYS added to SDP so Talk button never triggers reoffer.
 */
async function buildPc() {
  if (pcBuildInProgress) {
    log('⚠️ PC build already in progress — skipping', 'warn');
    return;
  }

  pcBuildInProgress = true;

  try {
    await closePc();
    connectionState = STATE.NEGOTIATING;

    pc = new RTCPeerConnection(PC_CONFIG);
    log('✅ PeerConnection created', 'ok');

    // Always add mic track (enabled based on isTalking state)
    const ms = await ensureMicStream();
    if (ms && ms.getAudioTracks().length > 0) {
      const at = ms.getAudioTracks()[0];
      at.enabled = isTalking;
      try {
        pc.addTrack(at, ms);
        log(`🎤 Mic added (enabled=${at.enabled})`, 'ok');
      } catch(e) {
        log('⚠️ Mic addTrack failed: ' + e.message, 'warn');
      }
    }

    // Video call: add camera track if active
    if (isVideoCallActive && localVideoStream && localVideoStream.active) {
      const vt = localVideoStream.getVideoTracks()[0];
      if (vt) {
        try {
          pc.addTrack(vt, localVideoStream);
          log('📹 Camera track added', 'ok');
        } catch(e) {
          log('⚠️ Camera addTrack failed: ' + e.message, 'warn');
        }
      }
    }

    // Track received
    pc.ontrack = async e => {
      if (!e.track) return;
      log(`📥 Track received: kind=${e.track.kind}`, 'ok');

      if (e.track.kind === 'video') {
        clearTimeout(videoTrackTimer);
        const stream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
        remoteVideoStream = stream;

        const vid = DOM.remoteVideo;
        if (!isSelfViewSwapped) {
          await safeVideoPlay(vid, stream);
          if (vid) vid.style.transform = '';
        } else {
          const sv = DOM.selfView;
          if (sv) {
            sv.srcObject = stream;
            sv.style.transform = '';
          }
        }

        // Request max bitrate
        try {
          if (pc && pc.getReceivers) {
            pc.getReceivers().forEach(rx => {
              if (rx.track && rx.track.kind==='video') {
                try {
                  const p = rx.getParameters();
                  if (p && p.encodings) {
                    p.encodings.forEach(enc => {
                      enc.maxBitrate = 4_000_000;
                      enc.maxFramerate = 30;
                    });
                    rx.setParameters(p).catch(e => {
                      log('⚠️ setParameters failed: ' + e.message, 'warn');
                    });
                  }
                } catch(_) {}
              }
            });
          }
        } catch(e) {
          log('⚠️ Bitrate config error: ' + e.message, 'warn');
        }

        hideLoading();
        if (DOM.controlsBar) DOM.controlsBar.classList.add('visible');
        if (DOM.volPanel) DOM.volPanel.style.display = 'block';
        isStreaming = true;
        isBusy      = false;
        connectionState = STATE.STREAMING;
        clearTimeout(offerTimeoutTimer);
        showLive(currentCam || '?');
        setStatus('Streaming', (currentCam||'?')+' camera', 'green');
        if (DOM.iMode) DOM.iMode.textContent = 'video';
        startElapsed();
        if (DOM.btnTalk) DOM.btnTalk.classList.toggle('a-on', isTalking);
        if (DOM.iWebMic) DOM.iWebMic.textContent = isTalking ? 'on' : 'off';
        log('📹 Video live','ok');
      }

      if (e.track.kind === 'audio') {
        const aStream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
        const aEl = DOM.androidAudio;
        if (aEl) {
          aEl.srcObject = aStream;
          aEl.muted = isAndAudioMuted;
          try {
            if (DOM.volSlider) aEl.volume = parseInt(DOM.volSlider.value) / 100;
          } catch(_) {}
          await safeAudioPlay(aEl);
          if (!isAndAudioMuted && DOM.iAndMic) {
            DOM.iAndMic.textContent = 'on';
          }
        }
      }
    };

    // ICE candidates
    pc.onicecandidate = async e => {
      if (!e.candidate || !rtcRef) return;
      const c = e.candidate;
      try {
        await push(ref(db, getRtcPath()+'/web_ice'),
          JSON.stringify({ sdp:c.candidate, sdpMid:c.sdpMid, sdpMLineIndex:c.sdpMLineIndex }));
      } catch(e) {
        log('⚠️ ICE push failed: ' + e.message, 'warn');
      }
    };

    // ICE state machine
    pc.oniceconnectionstatechange = async () => {
      if (!pc) return;
      const s = pc.iceConnectionState;
      setIce(s);
      log(`ICE → ${s}`, s==='connected'||s==='completed'?'ok':s==='failed'||s==='disconnected'?'warn':'');

      if (s === 'checking') {
        setLoadingStep(3,'Finding best network path…');
      }

      if (s === 'connected' || s === 'completed') {
        iceRetryCount = 0;
        clearTimeout(iceRetryTimer);
        setLoadingStep(4,'Waiting for first frame…');
        log('✅ ICE connected','ok');

        // Safety: if ICE connected but video never appears → reoffer
        if (!isStreaming) {
          clearTimeout(videoTrackTimer);
          videoTrackTimer = setTimeout(async()=>{
            if (!isStreaming && pc && connectionState === STATE.NEGOTIATING) {
              log('⏱ ICE ok but no video — reoffering…','warn');
              await doReoffer();
            }
          }, 8000);
        }
      }

      if (s === 'failed') {
        lastProcessedOfferSdp = null;
        lastAnswerSent = null;
        appliedAndIceKeys.clear();
        pendingIceCandidates = [];

        if (iceRetryCount < MAX_ICE_RETRIES) {
          iceRetryCount++;
          const delay = Math.min(iceRetryCount * 2000, 10000);
          log(`⚠️ ICE failed — retry ${iceRetryCount}/${MAX_ICE_RETRIES} in ${delay/1000}s`,'warn');
          clearTimeout(iceRetryTimer);
          iceRetryTimer = setTimeout(async () => {
            if (pc && connectionState === STATE.NEGOTIATING) {
              try {
                log('🔄 Attempting ICE restart…', 'ok');
                pc.restartIce();
                log('✅ ICE restart triggered', 'ok');
              } catch(e) {
                log('⚠️ ICE restart failed: ' + e.message + ' — doing reoffer', 'warn');
                await doReoffer();
              }
            }
          }, delay);
        } else {
          log('❌ ICE permanently failed after retries','err');
          setStatus('Error','ICE failed — stop and restart','red');
          await signalOverlayClose();
          isBusy = false;
          connectionState = STATE.ERROR;
        }
      }

      if (s === 'disconnected') {
        clearTimeout(iceRestartTimer);
        iceRestartTimer = setTimeout(async()=>{
          if (pc && pc.iceConnectionState === 'disconnected' && isStreaming) {
            log('⚠️ ICE disconnected for 8s — reoffering','warn');
            await doReoffer();
          }
        }, 8000);
      }
    };

    // Data channel for future control
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      log('📡 DataChannel established', 'ok');
      dataChannel.onmessage = (e) => {
        log(`📨 DataChannel message: ${e.data}`, 'ok');
      };
      dataChannel.onerror = (e) => {
        log(`⚠️ DataChannel error: ${e}`, 'warn');
      };
    };

    attachAndIceListener();
  } catch(e) {
    log('❌ buildPc error: ' + e.message, 'err');
    pcBuildInProgress = false;
    connectionState = STATE.ERROR;
    throw e;
  } finally {
    pcBuildInProgress = false;
  }
}

async function doReoffer() {
  if (!rtcRef || !isStreaming) {
    log('⚠️ Cannot reoffer: not streaming', 'warn');
    return;
  }
  if (connectionState !== STATE.STREAMING && connectionState !== STATE.NEGOTIATING) {
    log('⚠️ Cannot reoffer: wrong state (' + connectionState + ')', 'warn');
    return;
  }

  lastProcessedOfferSdp = null;
  lastAnswerSent = null;
  appliedAndIceKeys.clear();
  pendingIceCandidates = [];
  awaitingRemoteDesc = false;

  try {
    await remove(ref(db, getRtcPath()+'/android_ice'));
    await set(ref(db, getRtcPath()+'/command'), 'reoffer');
    log('🔄 Reoffer sent','ok');
  } catch(e) {
    log('❌ Reoffer error: '+e.message,'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  ANDROID ICE LISTENER
// ═══════════════════════════════════════════════════════════════════════
function attachAndIceListener() {
  if (!rtcRef || andIceUnsub) return;

  andIceUnsub = onChildAdded(ref(db, getRtcPath()+'/android_ice'), snap => {
    if (!pc || !snap.key) return;
    if (appliedAndIceKeys.has(snap.key)) {
      log(`⏭ ICE ${snap.key.slice(0,8)} already applied`, 'warn');
      return;
    }

    let d;
    try {
      const v = snap.val();
      d = typeof v==='string' ? JSON.parse(v) : v;
    } catch(e) {
      log('⚠️ ICE parse failed: ' + e.message, 'warn');
      return;
    }

    if (!d || !d.sdp) {
      log('⚠️ ICE missing sdp', 'warn');
      return;
    }

    if (!awaitingRemoteDesc) {
      applyWebIceCandidate(d);
      appliedAndIceKeys.add(snap.key);
    } else {
      log('📦 Buffering ICE (waiting for remote desc)', 'ok');
      pendingIceCandidates.push({ data: d, key: snap.key });
    }
  });
}

function applyWebIceCandidate(d) {
  if (!pc) {
    log('⚠️ No PC when applying ICE', 'warn');
    return;
  }

  const sdp          = d.sdp;
  const sdpMid       = d.sdpMid != null ? String(d.sdpMid) : '0';
  const sdpMLineIndex= parseInt(d.sdpMLineIndex) || 0;

  const tryAdd = async (candidate) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log(`✅ ICE ${sdpMid}:${sdpMLineIndex} added`, 'ok');
    } catch(e) {
      // If first attempt fails with sdpMid, try with only index
      if (candidate.sdpMid !== undefined && candidate.sdpMid !== '0') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate({ candidate: sdp, sdpMLineIndex }));
          log(`✅ ICE ${sdpMLineIndex} (index-only) added`, 'ok');
        } catch(ex) {
          log(`⚠️ ICE add failed: ${ex.message}`, 'warn');
        }
      } else {
        log(`⚠️ ICE add failed: ${e.message}`, 'warn');
      }
    }
  };

  tryAdd({ candidate: sdp, sdpMid, sdpMLineIndex });
}

async function drainPendingIce() {
  if (pendingIceCandidates.length === 0) return;

  log(`🔄 Draining ${pendingIceCandidates.length} pending ICE candidates…`, 'ok');
  const pending = pendingIceCandidates.splice(0);

  for (const item of pending) {
    if (!pc) break;
    if (appliedAndIceKeys.has(item.key)) continue;
    applyWebIceCandidate(item.data);
    appliedAndIceKeys.add(item.key);
  }

  log(`✅ Drained ${pending.length} ICE candidates`, 'ok');
}

// ═══════════════════════════════════════════════════════════════════════
//  HANDLE OFFER → CREATE ANSWER
// ═══════════════════════════════════════════════════════════════════════
async function handleOffer(offerData) {
  if (connectionState === STATE.CLEANUP) {
    log('⚠️ Ignoring offer during cleanup', 'warn');
    return;
  }

  let sdp;
  try {
    if (typeof offerData==='string') sdp = JSON.parse(offerData).sdp;
    else if (offerData && typeof offerData==='object') sdp = offerData.sdp;
  } catch(ex) {
    log('❌ Parse offer failed: '+ex.message,'err');
    return;
  }

  if (!sdp) {
    log('⚠️ Offer SDP empty','warn');
    return;
  }

  // Prevent duplicate offer processing
  if (sdp === lastProcessedOfferSdp) {
    log('⏭ Duplicate offer ignored');
    return;
  }

  log('📩 Offer received — creating answer…','ok');
  setLoadingStep(2,'Exchanging stream handshake…');
  if (DOM.iSdp) DOM.iSdp.textContent = 'offer rx';
  lastProcessedOfferSdp = sdp;

  try {
    // Build PC if not exists
    if (!pc) {
      log('🔨 Building new PeerConnection for offer…', 'ok');
      await buildPc();
    }

    awaitingRemoteDesc = true;
    await pc.setRemoteDescription({ type:'offer', sdp });
    log('✅ Remote description (offer) set','ok');

    // Drain any pending ICE
    await drainPendingIce();
    awaitingRemoteDesc = false;

    // Create answer with bandwidth injection
    const answer     = await pc.createAnswer();
    const boostedSdp = injectBandwidth(answer.sdp, 4000);
    const boosted    = new RTCSessionDescription({ type:'answer', sdp:boostedSdp });

    await pc.setLocalDescription(boosted);
    if (DOM.iSdp) DOM.iSdp.textContent = 'answer tx';
    
    // Send answer to Firebase
    await set(ref(db, getRtcPath()+'/answer'), JSON.stringify({ sdp:boosted.sdp, type:'answer' }));
    lastAnswerSent = boosted.sdp;
    log('✅ Answer sent (4 Mbps)','ok');
  } catch(ex) {
    log('❌ Answer error: '+ex.message,'err');
    awaitingRemoteDesc = false;
    // Auto-retry after 3s
    setTimeout(async()=>{
      if (!isStreaming && pc) await doReoffer();
    }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  VIDEO CALL
// ═══════════════════════════════════════════════════════════════════════
async function initiateVideoCall() {
  if (isVideoCallActive) {
    log('⚠️ Video call already active', 'warn');
    return;
  }
  if (!rtcRef || !isStreaming) {
    log('⚠️ No active stream for video call','warn');
    return;
  }

  const stream = await getCamera();
  if (!stream) return;

  isVideoCallActive = true;
  if (DOM.btnVcall) DOM.btnVcall.classList.add('vc-on');
  if (DOM.iMode) DOM.iMode.textContent = 'video+call';
  setVcallBadge(true);

  const selfWrap = DOM.selfViewWrap;
  const selfVid  = DOM.selfView;
  if (selfWrap) selfWrap.style.display = 'block';
  if (selfVid) {
    selfVid.srcObject = localVideoStream;
    selfVid.style.transform = 'scaleX(-1)';
  }

  try {
    await set(ref(db, getRtcPath()+'/video_call_active'), true);
    await new Promise(r=>setTimeout(r,300));
    await set(ref(db, getRtcPath()+'/command'), 'video_call_start');
    log('📹 video_call_start sent','ok');
  } catch(ex) {
    log('❌ video_call_start error: '+ex.message,'err');
    isVideoCallActive = false;
    if (DOM.btnVcall) DOM.btnVcall.classList.remove('vc-on');
    setVcallBadge(false);
    if (localVideoStream) {
      localVideoStream.getTracks().forEach(t=>{
        try { t.stop(); } catch(_) {}
      });
      localVideoStream=null;
    }
    if (selfWrap) selfWrap.style.display = 'none';
  }
}

async function stopVideoCallInternal(sendCommand=true) {
  if (!isVideoCallActive) return;
  isVideoCallActive = false;

  const selfWrap = DOM.selfViewWrap;
  if (selfWrap) selfWrap.style.display = 'none';

  if (isSelfViewSwapped) {
    const vid = DOM.remoteVideo;
    if (remoteVideoStream && vid) {
      vid.srcObject = remoteVideoStream;
      vid.style.transform='';
    }
    isSelfViewSwapped = false;
    if (selfWrap) selfWrap.classList.remove('swapped');
  }

  if (DOM.selfView) DOM.selfView.srcObject = null;
  if (localVideoStream) {
    localVideoStream.getTracks().forEach(t=>{
      try { t.stop(); } catch(_) {}
    });
    localVideoStream=null;
  }

  setVcallBadge(false);
  if (DOM.btnVcall) DOM.btnVcall.classList.remove('vc-on');
  if (DOM.iMode) DOM.iMode.textContent = isStreaming ? 'video' : 'idle';
  log('📵 Video call stopped','warn');

  if (sendCommand && rtcRef) {
    try {
      await set(ref(db, getRtcPath()+'/video_call_active'), false);
      await new Promise(r=>setTimeout(r,200));
      await set(ref(db, getRtcPath()+'/command'), 'video_call_stop');
      await signalOverlayClose();
    } catch(e) {
      log('⚠️ video_call_stop error: ' + e.message, 'warn');
    }
  }
}

window.toggleVideoCall = async function() {
  if (!isVideoCallActive) {
    if (!isStreaming) {
      toast('Start streaming first');
      return;
    }
    await initiateVideoCall();
  } else {
    await stopVideoCallInternal(true);
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  SELF VIEW SWAP + DRAG
// ═══════════════════════════════════════════════════════════════════════
function setupSelfViewSwap() {
  const wrap    = DOM.selfViewWrap;
  const mainVid = DOM.remoteVideo;
  const selfVid = DOM.selfView;

  if (!wrap) return;

  let isDragging=false, dragMoved=false, startX, startY, startLeft, startTop;

  const getPos = e => e.touches ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : {x:e.clientX,y:e.clientY};

  const onStart = e => {
    const pos=getPos(e);
    startX=pos.x;
    startY=pos.y;
    const rect=wrap.getBoundingClientRect();
    startLeft=rect.left;
    startTop=rect.top;
    isDragging=true;
    dragMoved=false;
    wrap.classList.add('grabbing');
    e.preventDefault();
  };

  const onMove = e => {
    if (!isDragging) return;
    const pos=getPos(e), dx=pos.x-startX, dy=pos.y-startY;
    if (Math.abs(dx)>4||Math.abs(dy)>4) {
      dragMoved=true;
      const W=window.innerWidth, H=window.innerHeight, wr=wrap.getBoundingClientRect();
      wrap.style.left   = Math.max(0,Math.min(startLeft+dx, W-wr.width))+'px';
      wrap.style.top    = Math.max(0,Math.min(startTop+dy,  H-wr.height))+'px';
      wrap.style.right  = 'auto';
      wrap.style.bottom='auto';
    }
    e.preventDefault();
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging=false;
    wrap.classList.remove('grabbing');

    if (!dragMoved) {
      // Tap → swap
      isSelfViewSwapped = !isSelfViewSwapped;
      wrap.classList.toggle('swapped', isSelfViewSwapped);

      if (isSelfViewSwapped) {
        if (remoteVideoStream && selfVid) {
          selfVid.srcObject=remoteVideoStream;
          selfVid.style.transform='';
        }
        if (localVideoStream && mainVid) {
          mainVid.srcObject=localVideoStream;
          mainVid.style.transform='scaleX(-1)';
        }
        toast('Your camera in main view');
      } else {
        if (remoteVideoStream && mainVid) {
          mainVid.srcObject=remoteVideoStream;
          mainVid.style.transform='';
        }
        if (localVideoStream && selfVid) {
          selfVid.srcObject=localVideoStream;
          selfVid.style.transform='scaleX(-1)';
        }
        toast('Android camera in main view');
      }
    }
  };

  wrap.addEventListener('mousedown',  onStart);
  wrap.addEventListener('touchstart', onStart, {passive:false});
  document.addEventListener('mousemove',  onMove);
  document.addEventListener('touchmove',  onMove, {passive:false});
  document.addEventListener('mouseup',    onEnd);
  document.addEventListener('touchend',   onEnd);
}

// ═══════════════════════════════════════════════════════════════════════
//  CONTROL BUTTONS
// ═══════════════════════════════════════════════════════════════════════
window.toggleTalk = async function() {
  const btn = DOM.btnTalk;

  if (!isTalking) {
    // Request mic if not yet acquired
    const ms = await ensureMicStream();
    if (!ms) {
      toast('❌ Mic permission denied');
      return;
    }

    isTalking = true;

    // Enable mic track in cached stream
    if (micStream) {
      micStream.getAudioTracks().forEach(t => {
        try { t.enabled = true; } catch(_) {}
      });
    }

    // Also enable via PC sender (belt + suspenders)
    if (pc && pc.getSenders) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind==='audio');
      if (sender && sender.track) {
        try { sender.track.enabled = true; } catch(_) {}
      }
    }

    if (btn) btn.classList.add('a-on');
    if (DOM.iWebMic) DOM.iWebMic.textContent = 'on';
    log('🎤 Talk ON','ok');
  } else {
    isTalking = false;

    if (micStream) {
      micStream.getAudioTracks().forEach(t => {
        try { t.enabled = false; } catch(_) {}
      });
    }

    if (pc && pc.getSenders) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind==='audio');
      if (sender && sender.track) {
        try { sender.track.enabled = false; } catch(_) {}
      }
    }

    if (btn) btn.classList.remove('a-on');
    if (DOM.iWebMic) DOM.iWebMic.textContent = 'off';
    log('🎤 Talk OFF','warn');
  }

  setAudioBadge(isTalking || !isAndAudioMuted);
};

window.toggleAndroidAudio = function() {
  const btn = DOM.btnAndMic;
  isAndAudioMuted = !isAndAudioMuted;
  const aEl = DOM.androidAudio;
  if (aEl) {
    aEl.muted = isAndAudioMuted;
    if (!isAndAudioMuted && aEl.paused && aEl.srcObject) {
      aEl.play().catch(()=>{});
    }
  }
  if (btn) btn.classList.toggle('a-on', !isAndAudioMuted);
  if (DOM.iAndMic) DOM.iAndMic.textContent = isAndAudioMuted ? 'muted' : 'on';
  setAudioBadge(isTalking || !isAndAudioMuted);
  log('🔊 Android audio '+(isAndAudioMuted?'muted':'unmuted'), isAndAudioMuted?'warn':'ok');
  toast(isAndAudioMuted ? '🔇 Android audio muted' : '🔊 Android audio on');
};

window.doSwitch = async function() {
  if (!currentCam || !isStreaming) {
    log('⚠️ No active stream to switch','warn');
    return;
  }

  const target = currentCam === 'front' ? 'back' : 'front';
  log('→ Switching to '+target,'ok');
  currentCam = target;

  if (DOM.iCamera) DOM.iCamera.textContent  = target;
  if (DOM.camLabel) DOM.camLabel.textContent = target.toUpperCase();

  lastProcessedOfferSdp = null;
  lastAnswerSent = null;
  appliedAndIceKeys.clear();
  pendingIceCandidates = [];

  try {
    await remove(ref(db, getRtcPath()+'/android_ice'));
    await set(ref(db, getRtcPath()+'/target_camera'), target);
    await set(ref(db, getRtcPath()+'/command'), 'switch');
    log('✅ Switch command sent', 'ok');
  } catch(ex) {
    log('❌ Switch error: '+ex.message,'err');
  }
};

window.toggleFullscreen = function() {
  const el = DOM.remoteVideo;
  if (!el) return;

  if (!document.fullscreenElement) {
    const fn = el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen;
    if (fn) fn.call(el);
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  VOLUME SLIDER
// ═══════════════════════════════════════════════════════════════════════
function setupVolumeSlider() {
  const slider = DOM.volSlider;
  const label  = DOM.volVal;
  if (!slider) return;

  slider.addEventListener('input', ()=>{
    if (label) label.textContent = slider.value+'%';
    const aEl = DOM.androidAudio;
    if (aEl && !aEl.muted) {
      try { aEl.volume = parseInt(slider.value)/100; } catch(_) {}
    }
  });

  let volTimer = null;
  slider.addEventListener('change', async()=>{
    const vol = parseInt(slider.value);
    if (label) label.textContent = vol+'%';
    const aEl = DOM.androidAudio;
    if (aEl && !aEl.muted) {
      try { aEl.volume = vol/100; } catch(_) {}
    }

    clearTimeout(volTimer);
    volTimer = setTimeout(async()=>{
      if (!UID||!DID) return;
      try {
        await set(ref(db, getSettingsPath()+'/volume'), vol);
        log('🔊 Vol → '+vol+'%','ok');
      } catch(e) {
        log('⚠️ Volume error: '+e.message,'err');
      }
    }, 300);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  FIREBASE LISTENERS
// ═══════════════════════════════════════════════════════════════════════
function listenFirebase() {
  // Status from Android
  firebaseStatusUnsub = onValue(ref(db, getRtcPath()+'/status'), snap => {
    const s = snap.val();
    if (!s) return;

    log(`📱 Device status: ${s}`);

    if (s === 'ready') {
      setConnDot('ok');
      setStatus('Device ready','Waiting for command','amber');
    } else if (s.startsWith('streaming_')) {
      const cam = s.replace('streaming_','');
      currentCam = cam;
      if (DOM.iCamera) DOM.iCamera.textContent = cam;
      setStatus('Streaming', cam+' camera active', 'green');
    } else if (s === 'video_call_started') {
      log('✅ Android video call active','ok');
    } else if (s === 'video_call_stopped') {
      log('📵 Android video call stopped','warn');
      if (isVideoCallActive) stopVideoCallInternal(false);
    } else if (s === 'video_call_error_not_streaming') {
      toast('⚠️ Stream not ready — try again');
      isVideoCallActive = false;
      if (DOM.btnVcall) DOM.btnVcall.classList.remove('vc-on');
      setVcallBadge(false);
    } else if (s === 'audio_started') {
      setAudioBadge(!isAndAudioMuted);
      log('✅ Android mic live','ok');
    } else if (s === 'audio_stopped') {
      log('📵 Android mic stopped','warn');
    } else if (s === 'audio_error') {
      log('❌ Android audio error','err');
      toast('⚠️ Android audio error');
    } else if (s === 'audio_permission_denied') {
      toast('❌ Android mic permission denied');
    } else if (s === 'stopped') {
      setStatus('Stopped','Idle','gray');
    } else if (s === 'permission_denied') {
      setStatus('Error','Camera permission denied','red');
      toast('❌ Android camera permission denied');
      showPreOverlay();
    } else if (s === 'camera_not_found') {
      setStatus('Error','Camera not found','red');
      toast('⚠️ Camera not found on device');
    } else if (s === 'camera_retrying') {
      setLoadingStep(1,'Camera not found — retrying…');
    } else if (s === 'ice_failed') {
      setStatus('Warning','ICE issue — retrying…','amber');
    } else if (s === 'ice_failed_permanent') {
      setStatus('Error','ICE failed permanently','red');
      signalOverlayClose().catch(()=>{});
    } else if (s === 'error') {
      setStatus('Error','Device error','red');
      toast('⚠️ Device error');
    }
  });

  // Incoming SDP offer from Android
  firebaseOfferUnsub = onValue(ref(db, getRtcPath()+'/offer'), snap => {
    const v = snap.val();
    if (v) handleOffer(v);
  });

  // video_call_active flag
  firebaseVideoCallUnsub = onValue(ref(db, getRtcPath()+'/video_call_active'), snap => {
    const v = snap.val();
    if (v===false && isVideoCallActive) {
      log('📵 Android ended video call','warn');
      stopVideoCallInternal(false);
    }
  });

  log('✅ Firebase listeners attached', 'ok');
}

function unlistenFirebase() {
  if (firebaseStatusUnsub) try { firebaseStatusUnsub(); } catch(_) {}
  if (firebaseOfferUnsub) try { firebaseOfferUnsub(); } catch(_) {}
  if (firebaseVideoCallUnsub) try { firebaseVideoCallUnsub(); } catch(_) {}
  firebaseStatusUnsub = null;
  firebaseOfferUnsub = null;
  firebaseVideoCallUnsub = null;
  log('✅ Firebase listeners detached', 'ok');
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTO-STOP ON TAB CLOSE
// ═══════════════════════════════════════════════════════════════════════
function setupAutoStop() {
  if (!rtcRef) return;

  // Server-side disconnect handlers
  onDisconnect(ref(db, getRtcPath()+'/command')).set('stop');
  onDisconnect(ref(db, getRtcPath()+'/video_call_active')).set(false);
  onDisconnect(ref(db, getRtcPath()+'/overlay_close')).set(true);
  log('🛡️ Auto-stop on disconnect armed','ok');

  window.addEventListener('pagehide',      cleanupOnUnload);
  window.addEventListener('beforeunload',  cleanupOnUnload);
}

function cleanupOnUnload() {
  // Stop tracks
  if (micStream) {
    micStream.getAudioTracks().forEach(t=>{
      try { t.enabled=false; } catch(_) {}
    });
  }
  if (localVideoStream) {
    localVideoStream.getTracks().forEach(t=>{
      try { t.stop(); } catch(_) {}
    });
  }
  if (pc) {
    try { pc.close(); } catch(_) {}
  }

  if (!UID || !DID) return;

  // Keepalive fetch
  const base   = `users/${UID}/devices/${DID}/webrtc`;
  const dbHost = location.hostname.replace(/\.(firebaseapp|web)\.com.*/, '');
  const dbUrl  = `https://${dbHost}-default-rtdb.firebaseio.com`;
  const opts   = { keepalive:true, method:'PUT', headers:{'Content-Type':'application/json'} };

  try {
    fetch(`${dbUrl}/${base}/overlay_close.json`,     {...opts, body:'true'});
    fetch(`${dbUrl}/${base}/command.json`,           {...opts, body:'"stop"'});
    fetch(`${dbUrl}/${base}/video_call_active.json`, {...opts, body:'false'});
  } catch(_) {}
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIO UNLOCK
// ═══════════════════════════════════════════════════════════════════════
function setupAudioUnlockOnInteraction() {
  const unlock = async () => {
    await ensureAudioContext();
    document.removeEventListener('click',      unlock);
    document.removeEventListener('touchstart', unlock);
  };
  document.addEventListener('click',      unlock, {once:true});
  document.addEventListener('touchstart', unlock, {once:true, passive:true});
}

// ═══════════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════
async function init() {
  if (DOM.headerDeviceId) DOM.headerDeviceId.textContent = DID;
  log('Dashboard ready — waiting for device…');
  setStatus('Connected','Firebase active','amber');
  setConnDot('warn');

  // Clear stale signals
  try {
    await Promise.allSettled([
      remove(ref(db, getRtcPath()+'/command')),
      remove(ref(db, getRtcPath()+'/answer')),
      remove(ref(db, getRtcPath()+'/web_ice')),
      remove(ref(db, getRtcPath()+'/video_call_active')),
      remove(ref(db, getRtcPath()+'/overlay_close')),
    ]);
    log('✅ Cleared stale signals', 'ok');
  } catch(e) {
    log('⚠️ Signal clear error: ' + e.message, 'warn');
  }

  setupAutoStop();
  setupVolumeSlider();
  setupSelfViewSwap();
  setupAudioUnlockOnInteraction();

  await checkLiveStream();
  listenFirebase();
  connectionState = STATE.IDLE;
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  if (!user) {
    setConnDot('err');
    setStatus('Error','Not signed in','red');
    log('❌ Not authenticated','err');
    return;
  }

  UID = user.uid;
  log(`✅ Auth OK — UID: ${UID.slice(0,8)}…`, 'ok');

  try {
    const snap = await get(ref(db, `users/${UID}/storeId`));
    DID = snap.val();
  } catch(e) {
    log('❌ Failed to get device ID: '+e.message,'err');
  }

  if (!DID) {
    setConnDot('err');
    setStatus('Error','No device — go to Settings','red');
    log('❌ No device selected','err');
    return;
  }

  rtcRef = ref(db, getRtcPath());
  setConnDot('ok');
  log(`📱 Device: ${DID}`, 'ok');

  cacheDomElements();
  init();
});