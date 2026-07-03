import { db, auth } from "../api/firebase.js";
import {
  ref, get, set, remove, push,
  onValue, onChildAdded, onDisconnect
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ═══════════════════════
//  ICE / PC CONFIG
// ═══════════════════════
const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',                username:'openrelayproject',credential:'openrelayproject'},
    { urls: 'turn:openrelay.metered.ca:443',               username:'openrelayproject',credential:'openrelayproject'},
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject',credential:'openrelayproject'},
    { urls: 'turn:openrelay.metered.ca:80?transport=tcp',  username:'openrelayproject',credential:'openrelayproject'},
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy:      'max-bundle',
  rtcpMuxPolicy:     'require',
  iceTransportPolicy:'all',
};

// ═══════════════════════
//  IDENTITY
// ═══════════════════════
let UID = null, DID = null;

// ═══════════════════════
//  STATE
// ═══════════════════════
let pc                = null;
let micStream         = null;
let isTalking         = false;
let isAndMuted        = false;
let isStreaming       = false;
let isBusy            = false;
let cfgAud            = false;  // web mic at start
let lastAnsweredSdp   = null;
let appliedAndIceKeys = new Set();
let andIceUnsub       = null;
let iceRetryCount     = 0;
let iceRetryTimer     = null;
let offerTimeoutTimer = null;
let elapsedTimer      = null;
let streamStart       = null;
const MAX_ICE_RETRIES = 5;

// Waveform
let audioCtx     = null;
let analyser     = null;
let waveAnimId   = null;
let srcNode      = null;

const getRtcPath      = () => `users/${UID}/devices/${DID}/webrtc`;
const getSettingsPath = () => `users/${UID}/devices/${DID}/settings`;

// ═══════════════════════
//  TOAST
// ═══════════════════════
let toastTid = null;
function toast(msg, ms=3000) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTid);
  toastTid = setTimeout(() => el.classList.remove('on'), ms);
}

// ═══════════════════════
//  OVERLAYS
// ═══════════════════════
function showPre() {
  document.getElementById('preOverlay').classList.remove('hidden');
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('controlsArea').style.display = 'none';
  document.getElementById('infoGrid').style.display = 'none';
  document.getElementById('btnStart').disabled = false;
  isBusy = false;
}
function hidePre() { document.getElementById('preOverlay').classList.add('hidden'); }
function showLoading(msg, sub) {
  document.getElementById('loadingMsg').textContent = msg || 'CONNECTING…';
  document.getElementById('loadingSub').textContent = sub || '';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

// ═══════════════════════
//  STATUS
// ═══════════════════════
function setConnDot(s) { document.getElementById('connDot').className = 'conn-dot ' + s; }
function setStatus(label, sub, col) {
  document.getElementById('statusLabel').textContent = label;
  document.getElementById('statusSub').textContent   = sub;
  const icon = document.getElementById('statusIcon');
  icon.className = 'status-icon ' + (col || '');
}
function setIce(s) {
  document.getElementById('iIce').textContent = s;
}
function startElapsed() {
  streamStart = Date.now();
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    const s = Math.floor((Date.now() - streamStart) / 1000);
    const el = document.getElementById('iElapsed');
    if (el) el.textContent = String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  }, 1000);
}
function stopElapsed() {
  clearInterval(elapsedTimer);
  const el = document.getElementById('iElapsed'); if (el) el.textContent = '—';
}

// ═══════════════════════
//  WAVEFORM VISUALIZER
// ═══════════════════════
function startWave(stream) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (analyser) { try { analyser.disconnect(); } catch(_){} }
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    if (srcNode) { try { srcNode.disconnect(); } catch(_){} }
    srcNode = audioCtx.createMediaStreamSource(stream);
    srcNode.connect(analyser);
    const canvas = document.getElementById('wave');
    const ctx2   = canvas.getContext('2d');
    const buf    = new Uint8Array(analyser.frequencyBinCount);
    document.getElementById('waveOverlay').classList.add('hidden');
    const draw = () => {
      waveAnimId = requestAnimationFrame(draw);
      canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      analyser.getByteTimeDomainData(buf);
      ctx2.beginPath();
      ctx2.strokeStyle = '#14b8a6';
      ctx2.lineWidth   = 2;
      const sliceW = canvas.width / buf.length;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128;
        const y = (v * canvas.height) / 2;
        i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
        x += sliceW;
      }
      ctx2.stroke();
    };
    cancelAnimationFrame(waveAnimId);
    draw();
  } catch(e) { console.warn('Wave error:', e); }
}

function stopWave() {
  cancelAnimationFrame(waveAnimId);
  try { if (srcNode) srcNode.disconnect(); } catch(_){}
  const canvas = document.getElementById('wave');
  const ctx2   = canvas.getContext('2d');
  if (ctx2) ctx2.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('waveOverlay').classList.remove('hidden');
}

// ═══════════════════════
//  AUDIO UNLOCK
// ═══════════════════════
window.unlockAudio = async function() {
  document.getElementById('unlockBar').classList.remove('show');
  const aEl = document.getElementById('androidAudio');
  if (aEl && aEl.paused && aEl.srcObject) try { await aEl.play(); } catch(_){}
};

async function safeAudioPlay(aEl) {
  aEl.muted = isAndMuted;
  try {
    await aEl.play();
    document.getElementById('unlockBar').classList.remove('show');
  } catch(_) {
    document.getElementById('unlockBar').classList.add('show');
    const unlock = async () => {
      try { await aEl.play(); document.getElementById('unlockBar').classList.remove('show'); } catch(_){}
      document.removeEventListener('click',      unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click',      unlock, {once:true});
    document.addEventListener('touchstart', unlock, {once:true, passive:true});
  }
}

// ═══════════════════════
//  MIC
// ═══════════════════════
async function ensureMic() {
  if (micStream && micStream.active && micStream.getAudioTracks().length > 0) return micStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      video: false
    });
    micStream.getAudioTracks().forEach(t => t.enabled = false);
    return micStream;
  } catch(e) { toast('Mic permission denied'); return null; }
}

// ═══════════════════════
//  CONFIG
// ═══════════════════════
window.selectAud = function(on) {
  cfgAud = on;
  document.getElementById('selAudOn').classList.toggle('sel',  on);
  document.getElementById('selAudOff').classList.toggle('sel', !on);
};

// ═══════════════════════
//  START
// ═══════════════════════
window.startAudioStream = async function() {
  if (isBusy) return;
  if (!UID || !DID) { toast('Not connected to device'); return; }
  isBusy = true;
  isTalking = cfgAud;
  document.getElementById('btnStart').disabled = true;
  hidePre();
  showLoading('CONNECTING…', 'Starting audio stream…');

  lastAnsweredSdp = null; appliedAndIceKeys.clear(); iceRetryCount = 0;
  clearTimeout(iceRetryTimer); clearTimeout(offerTimeoutTimer);

  try {
    await ensureMic();
    if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = isTalking);

    await Promise.allSettled([
      remove(ref(db, getRtcPath()+'/offer')),
      remove(ref(db, getRtcPath()+'/answer')),
      remove(ref(db, getRtcPath()+'/android_ice')),
      remove(ref(db, getRtcPath()+'/web_ice')),
      remove(ref(db, getRtcPath()+'/video_call_active')),
      remove(ref(db, getRtcPath()+'/overlay_close')),
    ]);

    // Start camera stream on Android — audio arrives bundled in the same PC
    await set(ref(db, getRtcPath()+'/command'), 'start_front');

    showLoading('WAITING…', 'Device starting audio stream…');
    scheduleOfferTimeout();
  } catch(e) {
    toast('Failed to reach device');
    showPre();
  }
};

function scheduleOfferTimeout() {
  clearTimeout(offerTimeoutTimer);
  offerTimeoutTimer = setTimeout(async () => {
    if (isStreaming) return;
    try { await set(ref(db, getRtcPath()+'/command'), 'start_front'); scheduleOfferTimeout(); }
    catch(_){}
  }, 12000);
}

// ═══════════════════════
//  STOP
// ═══════════════════════
window.stopStream = async function() {
  if (isBusy && !isStreaming) return;
  isBusy = true;
  clearTimeout(iceRetryTimer); clearTimeout(offerTimeoutTimer);

  stopWave();
  stopElapsed();
  if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = false);
  const aEl = document.getElementById('androidAudio');
  aEl.srcObject = null;
  isTalking = false; isStreaming = false;
  document.getElementById('unlockBar').classList.remove('show');

  await closePc();

  try {
    await Promise.allSettled([
      remove(ref(db, getRtcPath()+'/offer')),
      remove(ref(db, getRtcPath()+'/answer')),
      remove(ref(db, getRtcPath()+'/android_ice')),
      remove(ref(db, getRtcPath()+'/web_ice')),
    ]);
    await set(ref(db, getRtcPath()+'/command'), 'stop');
    await set(ref(db, getRtcPath()+'/overlay_close'), true);
  } catch(_){}

  setStatus('Stopped', 'Idle', '');
  setIce('closed');
  document.getElementById('iWebMic').textContent = 'off';
  document.getElementById('btnTalk').classList.remove('m-on');
  document.getElementById('talkLabel').textContent = 'Talk';

  showPre();
};

// ═══════════════════════
//  PEER CONNECTION
// ═══════════════════════
async function closePc() {
  lastAnsweredSdp = null; appliedAndIceKeys.clear();
  clearTimeout(iceRetryTimer);
  if (andIceUnsub) { try { andIceUnsub(); } catch(_){} andIceUnsub = null; }
  if (pc) {
    pc.ontrack = pc.onicecandidate = pc.oniceconnectionstatechange = null;
    try { pc.close(); } catch(_){}
    pc = null;
  }
}

async function buildPc() {
  await closePc();
  pc = new RTCPeerConnection(PC_CONFIG);

  // Always add mic track
  const ms = await ensureMic();
  if (ms && ms.getAudioTracks().length > 0) {
    const at = ms.getAudioTracks()[0];
    at.enabled = isTalking;
    try { pc.addTrack(at, ms); } catch(_){}
  }

  pc.ontrack = async e => {
    if (!e.track) return;
    // We only care about audio — ignore video track completely
    if (e.track.kind !== 'audio') return;

    const stream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
    const aEl    = document.getElementById('androidAudio');
    aEl.srcObject = stream;
    aEl.muted     = isAndMuted;
    try { aEl.volume = parseInt(document.getElementById('volSlider').value) / 100; } catch(_){}
    await safeAudioPlay(aEl);

    // Start waveform visualizer
    startWave(stream);

    // Show controls
    hideLoading();
    isStreaming = true;
    isBusy      = false;
    clearTimeout(offerTimeoutTimer);
    document.getElementById('controlsArea').style.display = 'flex';
    document.getElementById('controlsArea').style.flexDirection = 'column';
    document.getElementById('infoGrid').style.display = 'grid';
    setStatus('Streaming', 'Android audio live', 'teal');
    document.getElementById('iWebMic').textContent = isTalking ? 'on' : 'off';
    document.getElementById('btnTalk').classList.toggle('m-on', isTalking);
    document.getElementById('talkLabel').textContent = isTalking ? 'Talk (ON)' : 'Talk';
    startElapsed();
    toast('Audio stream live');
  };

  pc.onicecandidate = async e => {
    if (!e.candidate || !UID || !DID) return;
    const c = e.candidate;
    try {
      await push(ref(db, getRtcPath()+'/web_ice'),
        JSON.stringify({ sdp:c.candidate, sdpMid:c.sdpMid, sdpMLineIndex:c.sdpMLineIndex }));
    } catch(_){}
  };

  pc.oniceconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.iceConnectionState;
    setIce(s);
    if (s === 'connected' || s === 'completed') {
      iceRetryCount = 0; clearTimeout(iceRetryTimer);
    }
    if (s === 'failed') {
      lastAnsweredSdp = null; appliedAndIceKeys.clear();
      if (iceRetryCount < MAX_ICE_RETRIES) {
        iceRetryCount++;
        const delay = Math.min(iceRetryCount * 2000, 10000);
        clearTimeout(iceRetryTimer);
        iceRetryTimer = setTimeout(doReoffer, delay);
      } else {
        setStatus('Error', 'ICE failed — stop and retry', 'red');
        isBusy = false;
      }
    }
    if (s === 'disconnected') {
      clearTimeout(iceRetryTimer);
      iceRetryTimer = setTimeout(async () => {
        if (pc && pc.iceConnectionState === 'disconnected') await doReoffer();
      }, 8000);
    }
  };

  attachAndIceListener();
}

async function doReoffer() {
  if (!isStreaming) return;
  lastAnsweredSdp = null; appliedAndIceKeys.clear();
  try {
    await remove(ref(db, getRtcPath()+'/android_ice'));
    await set(ref(db, getRtcPath()+'/command'), 'reoffer');
  } catch(_){}
}

function attachAndIceListener() {
  if (!UID || !DID || andIceUnsub) return;
  andIceUnsub = onChildAdded(ref(db, getRtcPath()+'/android_ice'), snap => {
    if (!pc || !snap.key || appliedAndIceKeys.has(snap.key)) return;
    let d;
    try { const v = snap.val(); d = typeof v==='string' ? JSON.parse(v) : v; } catch(_){ return; }
    if (!d || !d.sdp) return;
    addIceCandidate(d);
    appliedAndIceKeys.add(snap.key);
  });
}

function addIceCandidate(d) {
  if (!pc) return;
  const sdp          = d.sdp;
  const sdpMid       = d.sdpMid != null ? String(d.sdpMid) : '0';
  const sdpMLineIndex= parseInt(d.sdpMLineIndex) || 0;
  pc.addIceCandidate(new RTCIceCandidate({ candidate:sdp, sdpMid, sdpMLineIndex }))
    .catch(() => pc.addIceCandidate(new RTCIceCandidate({ candidate:sdp, sdpMLineIndex })).catch(()=>{}));
}

async function drainAndIce() {
  if (!pc || !UID || !DID) return;
  try {
    const snap = await get(ref(db, getRtcPath()+'/android_ice'));
    if (!snap.exists()) return;
    snap.forEach(child => {
      if (!child.key || appliedAndIceKeys.has(child.key)) return;
      let d;
      try { const v=child.val(); d=typeof v==='string'?JSON.parse(v):v; } catch(_){ return; }
      if (!d||!d.sdp) return;
      addIceCandidate(d); appliedAndIceKeys.add(child.key);
    });
  } catch(_){}
}

// ═══════════════════════
//  HANDLE OFFER
// ═══════════════════════
async function handleOffer(offerData) {
  let sdp;
  try {
    if (typeof offerData==='string') sdp = JSON.parse(offerData).sdp;
    else if (offerData && typeof offerData==='object') sdp = offerData.sdp;
  } catch(_){ return; }
  if (!sdp || sdp === lastAnsweredSdp) return;

  showLoading('NEGOTIATING…', 'Exchanging handshake…');
  await buildPc();

  try {
    await pc.setRemoteDescription({ type:'offer', sdp });
    await drainAndIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(ref(db, getRtcPath()+'/answer'), JSON.stringify({ sdp:answer.sdp, type:'answer' }));
    lastAnsweredSdp = sdp;
  } catch(e) {
    toast('Handshake error — retrying…');
    setTimeout(async () => { if (!isStreaming) await doReoffer(); }, 3000);
  }
}

// ═══════════════════════
//  CONTROL BUTTONS
// ═══════════════════════
window.toggleTalk = async function() {
  const btn = document.getElementById('btnTalk');
  if (!isTalking) {
    const ms = await ensureMic();
    if (!ms) { toast('Mic permission denied'); return; }
    isTalking = true;
    if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = true);
    if (pc) {
      const s = pc.getSenders().find(s => s.track && s.track.kind==='audio');
      if (s && s.track) s.track.enabled = true;
    }
    btn.classList.add('m-on');
    document.getElementById('talkLabel').textContent = 'Talk (ON)';
    document.getElementById('iWebMic').textContent   = 'on';
    toast('Mic enabled — speak now');
  } else {
    isTalking = false;
    if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = false);
    if (pc) {
      const s = pc.getSenders().find(s => s.track && s.track.kind==='audio');
      if (s && s.track) s.track.enabled = false;
    }
    btn.classList.remove('m-on');
    document.getElementById('talkLabel').textContent = 'Talk';
    document.getElementById('iWebMic').textContent   = 'off';
  }
};

window.toggleMute = function() {
  const btn = document.getElementById('btnMute');
  isAndMuted = !isAndMuted;
  const aEl = document.getElementById('androidAudio');
  if (aEl) {
    aEl.muted = isAndMuted;
    if (!isAndMuted && aEl.paused && aEl.srcObject) aEl.play().catch(()=>{});
  }
  if (isAndMuted) {
    btn.classList.remove('a-on');
    document.getElementById('muteLabel').textContent = 'Speaker Off';
    toast('Android audio muted');
  } else {
    btn.classList.add('a-on');
    document.getElementById('muteLabel').textContent = 'Speaker On';
    toast('Android audio on');
  }
};

// ═══════════════════════
//  VOLUME SLIDER
// ═══════════════════════
function setupVolume() {
  const slider = document.getElementById('volSlider');
  const label  = document.getElementById('volVal');
  slider.addEventListener('input', () => {
    label.textContent = slider.value + '%';
    const aEl = document.getElementById('androidAudio');
    if (aEl && !aEl.muted) aEl.volume = parseInt(slider.value) / 100;
  });
}

// ═══════════════════════
//  FIREBASE LISTENERS
// ═══════════════════════
function listenFirebase() {
  onValue(ref(db, getRtcPath()+'/status'), snap => {
    const s = snap.val(); if (!s) return;
    if (s === 'ready') {
      setConnDot('ok');
      setStatus('Device ready', 'Waiting for command', 'amber');
    } else if (s.startsWith('streaming_')) {
      setStatus('Streaming', 'Audio live', 'teal');
    } else if (s === 'stopped') {
      setStatus('Stopped', 'Idle', '');
    } else if (s === 'permission_denied') {
      setStatus('Error', 'Camera permission denied', 'red');
      toast('Camera permission denied on device');
      showPre();
    } else if (s === 'camera_not_found') {
      toast('Camera not found on device'); showPre();
    } else if (s === 'error') {
      setStatus('Error', 'Device error', 'red'); showPre();
    }
  });

  onValue(ref(db, getRtcPath()+'/offer'), snap => {
    const v = snap.val(); if (v) handleOffer(v);
  });
}

function setupAutoStop() {
  if (!UID || !DID) return;
  onDisconnect(ref(db, getRtcPath()+'/command')).set('stop');
  onDisconnect(ref(db, getRtcPath()+'/overlay_close')).set(true);

  window.addEventListener('pagehide',     cleanup);
  window.addEventListener('beforeunload', cleanup);
}

function cleanup() {
  if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = false);
  if (pc) { try { pc.close(); } catch(_){} }
  if (!UID || !DID) return;
  const base   = `users/${UID}/devices/${DID}/webrtc`;
  const dbHost = location.hostname.replace(/\.(firebaseapp|web)\.com.*/, '');
  const dbUrl  = `https://${dbHost}-default-rtdb.firebaseio.com`;
  const opts   = { keepalive:true, method:'PUT', headers:{'Content-Type':'application/json'} };
  try {
    fetch(`${dbUrl}/${base}/command.json`,        {...opts, body:'"stop"'});
    fetch(`${dbUrl}/${base}/overlay_close.json`,  {...opts, body:'true'});
  } catch(_){}
}

// ═══════════════════════
//  INIT
// ═══════════════════════
function init() {
  document.getElementById('headerDeviceId').textContent = DID;
  setupVolume();
  setupAutoStop();
  listenFirebase();
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    setConnDot('err');
    setStatus('Not signed in', 'Please log in', 'red');
    return;
  }
  UID = user.uid;
  try {
    const snap = await get(ref(db, `users/${UID}/storeId`));
    DID = snap.val();
  } catch(e) {}
  if (!DID) {
    setConnDot('err');
    setStatus('No device', 'Go to Settings to select device', 'red');
    return;
  }
  setConnDot('ok');
  init();
});