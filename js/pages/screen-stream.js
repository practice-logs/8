// ── Imports ────────────────────────────────────────────────────────────────
import { db, auth } from "../api/firebase.js";
import {
  ref, set, push, get, onValue, onChildAdded, remove, onDisconnect
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';

// ── Auth ───────────────────────────────────────────────────────────────────
let uid      = null;
let deviceId = null;

async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return reject('Not logged in');
      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}

// ── ICE Servers ────────────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const HEARTBEAT_MS = 5000;

function getBasePath() { return `users/${uid}/devices/${deviceId}/screen_webrtc`; }
function fbRef(sub) { return ref(db, `${getBasePath()}/${sub}`); }

// ── DOM ────────────────────────────────────────────────────────────────────
const video       = document.getElementById('remoteVideo');
const fsVideo     = document.getElementById('fsVideo');
const btnStart    = document.getElementById('btnStart');
const btnStop     = document.getElementById('btnStop');
const btnFs       = document.getElementById('btnFs');
const fsOverlay   = document.getElementById('fsOverlay');
const fsClose     = document.getElementById('fsClose');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const screenIdle  = document.getElementById('screenIdle');
const idleMsg     = document.getElementById('idleMsg');
const idleSub     = document.getElementById('idleSub');
const spinner     = document.getElementById('spinner');
const phone       = document.getElementById('phone');
const phoneWrap   = document.getElementById('phoneWrap');
const phoneScreen = document.getElementById('phoneScreen');
const statIce     = document.getElementById('statIce');
const statConn    = document.getElementById('statConn');
const statHb      = document.getElementById('statHb');
const deviceBadge = document.getElementById('deviceBadge');
const deviceName  = document.getElementById('deviceName');
const deviceIdDisplay = document.getElementById('deviceIdDisplay');
const devicePing  = document.getElementById('devicePing');
const footerUid   = document.getElementById('footerUid');
const liveIndicator = document.getElementById('liveIndicator');

const btnScreenOn  = document.getElementById('btnScreenOn');
const btnScreenOff = document.getElementById('btnScreenOff');
const toast        = document.getElementById('toast');

// ── Toast helper ───────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Send command to devices/commands/current ───────────────────────────────
function sendDeviceCommand(action) {
  if (!uid || !deviceId) { showToast('Device not connected', 'red'); return; }
  const cmdRef = ref(db, `users/${uid}/devices/${deviceId}/commands/current`);
  set(cmdRef, { action })
    .then(() => {
      if (action === 'screenOn')    showToast('Screen turned ON',  'green');
      if (action === 'lockDevice')  showToast('Screen turned OFF', 'red');
    })
    .catch(() => showToast('Command failed', 'red'));
}

btnScreenOn.addEventListener('click',  () => sendDeviceCommand('screenOn'));
btnScreenOff.addEventListener('click', () => sendDeviceCommand('lockDevice'));

const btnBack     = document.getElementById('btnBack');
const btnHome     = document.getElementById('btnHome');
const btnRecents  = document.getElementById('btnRecents');
const fsBtnBack   = document.getElementById('fsBtnBack');
const fsBtnHome   = document.getElementById('fsBtnHome');
const fsBtnRecents= document.getElementById('fsBtnRecents');

// ── State ──────────────────────────────────────────────────────────────────
let pc             = null;
let heartbeatTimer = null;
let unsubOffer     = null;
let unsubAndIce    = null;
let unsubStatus    = null;
let pendingAndIce  = [];
let remoteDescSet  = false;
let running        = false;
let hbCount        = 0;
let isStreaming    = false;

// ── UI Helpers ─────────────────────────────────────────────────────────────
function setStatus(dotClass, msg) {
  statusDot.className = 'status-dot ' + (dotClass || '');
  statusText.textContent = msg;
}

function setIdle(msg, sub = '', showSpinner = false) {
  screenIdle.classList.remove('hidden');
  idleMsg.textContent = msg;
  idleSub.textContent = sub;
  spinner.classList.toggle('on', showSpinner);

  // Video: use opacity to hide (keeps DOM & srcObject intact for desktop)
  video.classList.remove('active');
  phone.classList.remove('live');
  phoneWrap.classList.remove('live');
  liveIndicator.classList.remove('active');
  devicePing.classList.remove('live');
  isStreaming = false;
}

function setStreaming() {
  screenIdle.classList.add('hidden');

  // KEY FIX: make video visible on desktop (was being hidden by display:none previously)
  video.classList.add('active');

  phone.classList.add('live');
  phoneWrap.classList.add('live');
  liveIndicator.classList.add('active');
  devicePing.classList.add('live');
  isStreaming = true;
}

function dotClass(s) {
  switch (s) {
    case 'streaming': case 'connected':                   return 'live';
    case 'ready':                                          return 'ok';
    case 'stopped': case 'heartbeat_timeout':
    case 'projection_revoked': case 'system_projection_stop':
    case 'ice_failed': case 'error': case 'error_webrtc':
    case 'error_offer': case 'permission_denied':
    case 'unsupported_android_version':                    return 'err';
    case 'requesting_permission':                          return 'wait';
    default:                                               return 'wait';
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
async function startStream() {
  if (!uid || !deviceId) { setStatus('err', 'Not authenticated'); return; }
  if (running) return;
  running = true;
  btnStart.disabled = true;
  btnStop.disabled  = false;

  setStatus('wait', 'Clearing previous session…');
  setIdle('Connecting…', 'Please wait…', true);

  await onDisconnect(fbRef('command')).set('stop');

  await Promise.allSettled([
    remove(fbRef('command')), remove(fbRef('offer')), remove(fbRef('answer')),
    remove(fbRef('android_ice')), remove(fbRef('web_ice')),
    remove(fbRef('status')), remove(fbRef('gesture')),
  ]);

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.ontrack = (e) => {
    console.log('[SV] ontrack');
    const stream = e.streams[0];

    // ── DESKTOP FIX: set srcObject + force play on both elements ──
    video.srcObject   = stream;
    fsVideo.srcObject = stream;

    // Unmute only after user interaction (autoplay policy)
    video.muted   = true;
    fsVideo.muted = true;

    // play() returns a Promise — always await it to avoid unhandled rejections
    Promise.all([
      video.play().catch(() => {}),
      fsVideo.play().catch(() => {}),
    ]).then(() => {
      setStreaming();
      setStatus('live', 'Streaming live');
      devicePing.textContent = 'LIVE';
    });
  };

  pc.onicecandidate = (e) => { if (e.candidate) pushWebIce(e.candidate); };

  pc.oniceconnectionstatechange = () => {
    const s = pc?.iceConnectionState ?? '—';
    statIce.textContent = s;
    if (s === 'failed' || s === 'disconnected' || s === 'closed') onStreamEnded();
  };

  pc.onconnectionstatechange = () => {
    statConn.textContent = pc?.connectionState ?? '—';
  };

  unsubOffer  = onValue(fbRef('offer'), (snap) => { if (snap.exists()) handleOffer(snap.val()); });
  unsubAndIce = onChildAdded(fbRef('android_ice'), (snap) => { if (snap.exists()) applyAndroidIce(snap.val()); });
  unsubStatus = onValue(fbRef('status'), (snap) => {
    const v = snap.val();
    if (!v) return;
    console.log('[SV] device status:', v);
    if (v === 'requesting_permission') {
      setStatus('wait', 'Allow screen capture on device…');
      setIdle('Waiting for permission', 'Allow on the device', true);
    } else if (!isStreaming) {
      setStatus(dotClass(v), 'Device: ' + v);
      idleSub.textContent = v;
    } else {
      statusText.textContent = 'Live · ' + v;
    }
  });

  startHeartbeat();
  await set(fbRef('command'), 'start_screen');
  setStatus('wait', 'Waiting for device response…');
}

// ── Stop ───────────────────────────────────────────────────────────────────
async function stopStream() {
  if (!running) return;
  running = false;
  btnStart.disabled = false;
  btnStop.disabled  = true;
  cleanup();
  setStatus('', 'Stopped');
  setIdle('Tap Start to connect', 'Session ended', false);
  statIce.textContent = statConn.textContent = statHb.textContent = '—';
  devicePing.textContent = '—';
  try { await set(fbRef('command'), 'stop'); } catch (e) {}
}

// ── Offer ──────────────────────────────────────────────────────────────────
async function handleOffer(rawOffer) {
  if (!pc || remoteDescSet) return;
  try {
    const parsed = typeof rawOffer === 'string' ? JSON.parse(rawOffer) : rawOffer;
    const sdp    = parsed.sdp ?? parsed;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    remoteDescSet = true;
    setStatus('wait', 'Negotiating connection…');
    for (const c of pendingAndIce) await pc.addIceCandidate(c).catch(e => console.warn(e));
    pendingAndIce = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(fbRef('answer'), JSON.stringify({ sdp: answer.sdp, type: answer.type }));
  } catch (e) { console.error('[SV] handleOffer', e); }
}

// ── Android ICE ────────────────────────────────────────────────────────────
async function applyAndroidIce(raw) {
  try {
    const parsed    = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const candidate = new RTCIceCandidate({
      candidate: parsed.sdp, sdpMid: parsed.sdpMid ?? '0', sdpMLineIndex: parsed.sdpMLineIndex ?? 0,
    });
    if (!remoteDescSet) { pendingAndIce.push(candidate); return; }
    await pc.addIceCandidate(candidate);
  } catch (e) { console.warn('[SV] applyAndroidIce', e); }
}

function pushWebIce(c) {
  push(fbRef('web_ice'), JSON.stringify({ sdp: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex })).catch(() => {});
}

// ── Heartbeat ──────────────────────────────────────────────────────────────
function startHeartbeat() {
  stopHeartbeat();
  set(fbRef('heartbeat'), Date.now());
  heartbeatTimer = setInterval(() => {
    if (!running) { stopHeartbeat(); return; }
    set(fbRef('heartbeat'), Date.now()).catch(() => {});
    hbCount++;
    statHb.textContent = hbCount + ' ♥';
  }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  try { remove(fbRef('heartbeat')); } catch (e) {}
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanup() {
  isStreaming = false;
  stopHeartbeat();
  if (unsubOffer)  { unsubOffer();  unsubOffer  = null; }
  if (unsubAndIce) { unsubAndIce(); unsubAndIce = null; }
  if (unsubStatus) { unsubStatus(); unsubStatus = null; }
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  video.pause();   video.srcObject = null;
  fsVideo.pause(); fsVideo.srcObject = null;
  remoteDescSet = false; pendingAndIce = []; hbCount = 0;
  try { remove(fbRef('gesture')); } catch (e) {}
}

function onStreamEnded() {
  if (!running) return;
  cleanup(); running = false;
  btnStart.disabled = false; btnStop.disabled = true;
  setStatus('err', 'Stream ended — tap Start to reconnect');
  setIdle('Stream disconnected', 'Tap Start to retry', false);
  devicePing.textContent = '—';
  devicePing.classList.remove('live');
}

// ═══════════════════════════════════════════
//  GESTURE / TOUCH CONTROL
// ═══════════════════════════════════════════
function sendGesture(payload) {
  if (!running || !uid || !deviceId) return;
  payload.ts = Date.now();
  push(fbRef('gesture'), JSON.stringify(payload)).catch(() => {});
}

function getVideoContentRect(el) {
  const elW = el.clientWidth, elH = el.clientHeight;
  const vidW = el.videoWidth  || elW;
  const vidH = el.videoHeight || elH;
  const elAR = elW / elH, vidAR = vidW / vidH;
  let cW, cH, oX, oY;
  if (vidAR > elAR) { cW = elW; cH = elW / vidAR; oX = 0; oY = (elH - cH) / 2; }
  else              { cH = elH; cW = elH * vidAR;  oY = 0; oX = (elW - cW) / 2; }
  return { cW, cH, oX, oY };
}

function normalise(el, clientX, clientY) {
  const rect = el.getBoundingClientRect();
  const { cW, cH, oX, oY } = getVideoContentRect(el);
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left - oX) / cW)),
    y: Math.max(0, Math.min(1, (clientY - rect.top  - oY) / cH)),
  };
}

function showRipple(container, clientX, clientY) {
  const rect = container.getBoundingClientRect();
  const dot  = document.createElement('div');
  dot.className = 'touch-ripple';
  dot.style.left = (clientX - rect.left) + 'px';
  dot.style.top  = (clientY - rect.top)  + 'px';
  container.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove());
}

const pointers = {};
const SWIPE_THRESHOLD = 12;

function onPointerDown(e, videoEl, container) {
  if (!isStreaming) return;
  e.preventDefault();
  pointers[e.pointerId] = { sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, el: videoEl, container, startTime: Date.now() };
  try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerMove(e) {
  if (!pointers[e.pointerId]) return;
  e.preventDefault();
  pointers[e.pointerId].cx = e.clientX;
  pointers[e.pointerId].cy = e.clientY;
}

function onPointerUp(e) {
  const p = pointers[e.pointerId];
  if (!p) return;
  delete pointers[e.pointerId];
  e.preventDefault();
  const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const startCoords = normalise(p.el, p.sx, p.sy);
  const endCoords   = normalise(p.el, e.clientX, e.clientY);
  if (dist < SWIPE_THRESHOLD) {
    showRipple(p.container, p.sx, p.sy);
    sendGesture({ type: 'tap', x: startCoords.x, y: startCoords.y });
  } else {
    const durationMs = Math.max(80, Math.min(800, Date.now() - p.startTime));
    showRipple(p.container, p.sx, p.sy);
    showRipple(p.container, e.clientX, e.clientY);
    sendGesture({ type: 'swipe', x: startCoords.x, y: startCoords.y, x2: endCoords.x, y2: endCoords.y, duration: durationMs });
  }
}
function onPointerCancel(e) { delete pointers[e.pointerId]; }

function attachTouchListeners(videoEl, container) {
  container.addEventListener('pointerdown',   (e) => onPointerDown(e, videoEl, container), { passive: false });
  container.addEventListener('pointermove',   onPointerMove,  { passive: false });
  container.addEventListener('pointerup',     onPointerUp,    { passive: false });
  container.addEventListener('pointercancel', onPointerCancel, { passive: false });
  container.addEventListener('contextmenu',   (e) => e.preventDefault());
}

attachTouchListeners(video,   phoneScreen);
attachTouchListeners(fsVideo, fsOverlay);

// ── Nav buttons ────────────────────────────────────────────────────────────
function navPress(type, btnEl) {
  if (!running) return;
  btnEl.classList.add('pressed');
  setTimeout(() => btnEl.classList.remove('pressed'), 200);
  sendGesture({ type });
}

btnBack.addEventListener('click',    () => navPress('back',    btnBack));
btnHome.addEventListener('click',    () => navPress('home',    btnHome));
btnRecents.addEventListener('click', () => navPress('recents', btnRecents));
fsBtnBack.addEventListener('click',    () => navPress('back',    fsBtnBack));
fsBtnHome.addEventListener('click',    () => navPress('home',    fsBtnHome));
fsBtnRecents.addEventListener('click', () => navPress('recents', fsBtnRecents));

// ── Fullscreen ─────────────────────────────────────────────────────────────
btnFs.addEventListener('click', () => {
  fsOverlay.classList.add('active');
  // Ensure fsVideo has the stream and plays (critical for desktop)
  if (video.srcObject && !fsVideo.srcObject) {
    fsVideo.srcObject = video.srcObject;
  }
  fsVideo.play().catch(() => {});
});
fsClose.addEventListener('click', () => fsOverlay.classList.remove('active'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fsOverlay.classList.remove('active'); });

// ── Main Buttons ───────────────────────────────────────────────────────────
btnStart.addEventListener('click', startStream);
btnStop.addEventListener('click',  stopStream);

// ── beforeunload ───────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (!running || !uid || !deviceId) return;
  running = false;
  stopHeartbeat();
  try {
    const dbUrl = db.app.options.databaseURL;
    const url   = `${dbUrl}/${getBasePath()}/command.json`;
    const blob  = new Blob([JSON.stringify('stop')], { type: 'application/json' });
    if (navigator.sendBeacon) navigator.sendBeacon(url, blob);
    else { const xhr = new XMLHttpRequest(); xhr.open('PUT', url, false); xhr.setRequestHeader('Content-Type','application/json'); xhr.send(JSON.stringify('stop')); }
  } catch (e) {}
});

// ── Init ───────────────────────────────────────────────────────────────────
setIdle('Authenticating…', 'Connecting to Firebase…', true);
setStatus('wait', 'Waiting for auth…');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setStatus('err', 'Not logged in — please sign in');
    setIdle('Authentication required', 'Please log in to continue', false);
    return;
  }
  uid      = user.uid;
  deviceId = await getDeviceIdSafe();

  const shortId = deviceId ? deviceId.toString().slice(0, 12) + '…' : 'Unknown';
  deviceBadge.textContent   = deviceId || '—';
  deviceName.textContent    = 'Device ' + (deviceId || '—');
  deviceIdDisplay.textContent = 'uid: ' + user.uid.slice(0, 16) + '…';
  footerUid.textContent     = 'uid: ' + user.uid.slice(0, 10) + '…';

  btnStart.disabled = false;
  btnScreenOn.disabled  = false;
  btnScreenOff.disabled = false;
  setIdle('Ready to stream', 'Device paired', false);
  setStatus('ok', 'Authenticated — press Start');
  console.log('[SV] Auth ready — uid:', uid, '| deviceId:', deviceId);
});




// const isMobileDevice = () =>
//   window.innerWidth <= 768 ||
//   /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// let contentLoaded = false;

// const loadDevice = async (url) => {
//   if (contentLoaded) return;

//   const deviceLook = document.querySelector("#deviceLook");

//   try {
//     const res = await fetch(url);
//     if (!res.ok) throw new Error("HTTP " + res.status);

//     const html = await res.text();

//     const temp = document.createElement("div");
//     temp.innerHTML = html;

//     deviceLook.innerHTML = "";

//     temp.querySelectorAll("script").forEach(s => s.remove());

//     deviceLook.append(...temp.childNodes);

//     contentLoaded = true;

//   } catch (e) {
//     console.error("Load failed:", e);
//     alert("Load failed: " + e.message);
//   }
// };

// const toggleDeviceLook = async (show) => {
//   if (show && !contentLoaded) {
//     await loadDevice("pages/device.html"); // TRY THIS PATH FIRST
//   }

//   const deviceLook = document.querySelector("#deviceLook");
//   deviceLook.style.display = show ? "block" : "none";
// };

// const init = async () => {
//   const deviceLook = document.querySelector("#deviceLook");

//   if (!deviceLook) {
//     console.error("deviceLook not found");
//     return;
//   }

//   const isMobile = isMobileDevice();

//   if (!isMobile) {
//     deviceLook.style.display = "block";
//     await loadDevice("pages/device.html");
//   } else {
//     deviceLook.style.display = "none";
//   }
// };

// if (document.readyState === "loading") {
//   document.addEventListener("DOMContentLoaded", init);
// } else {
//   init();
// }