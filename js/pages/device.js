 import { db, auth } from "../api/firebase.js";
  import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

  // ── State ──
  let uid = null, deviceId = null;

  // ── Auth + get deviceId ──
  async function getDeviceIdSafe() {
    return new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        if (!user) return reject("Not logged in");
        const snap = await get(ref(db, `users/${user.uid}/storeId`));
        resolve(snap.val());
      });
    });
  }

  // ─────────────────────────────────────────────
  // LIVE CLOCK
  // ─────────────────────────────────────────────
  function pad(n){ return String(n).padStart(2,'0'); }

  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  function updateClock(){
    const now  = new Date();
    const h    = now.getHours();
    const m    = now.getMinutes();
    const s    = now.getSeconds();
    const h12  = h % 12 || 12;

    document.getElementById('lockClock').textContent  = `${h12}:${pad(m)}`;
    document.getElementById('statusTime').textContent = `${h12}:${pad(m)}`;

    const day = DAYS[now.getDay()];
    const mon = MONTHS[now.getMonth()];
    document.getElementById('lockDate').textContent = `${day}, ${mon} ${now.getDate()}`;

    const hDeg = ((h % 12) / 12) * 360 + (m / 60) * 30;
    const mDeg = (m / 60) * 360 + (s / 60) * 6;
    const sDeg = (s / 60) * 360;
    rotateHand('hourHand',   hDeg, 22, 22, 22, 11);
    rotateHand('minuteHand', mDeg, 22, 22, 22, 7);
    rotateHand('secondHand', sDeg, 22, 22, 22, 6);
  }

  function rotateHand(id, deg, cx, cy, x2, y2) {
    const el = document.getElementById(id);
    if (!el) return;
    const rad = (deg - 90) * Math.PI / 180;
    const len = Math.sqrt((x2-cx)**2 + (y2-cy)**2);
    const nx2 = cx + Math.cos(rad) * len;
    const ny2 = cy + Math.sin(rad) * len;
    el.setAttribute('x2', nx2.toFixed(2));
    el.setAttribute('y2', ny2.toFixed(2));
  }

  updateClock();
  setInterval(updateClock, 1000);

  // ─────────────────────────────────────────────
  // APPLY BATTERY UI (called from Firebase listener)
  // ─────────────────────────────────────────────
  function applyBattery(pct, isCharging) {
    if (pct == null || isNaN(pct)) return;
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    const pctStr = pct + '%';

    document.getElementById('battPct').textContent     = pctStr;
    document.getElementById('battCardPct').textContent = pctStr;
    document.getElementById('battBar').style.width     = pct + '%';
    document.getElementById('battFill').style.width    = Math.max(0, pct - 5) + '%';

    // Battery fill colour
    const fill = document.getElementById('battFill');
    const bar  = document.getElementById('battBar');
    if (pct > 40) {
      fill.style.background = '#30d158';
      bar.style.background  = 'linear-gradient(to right,#30d158,#4cd964)';
    } else if (pct > 20) {
      fill.style.background = '#ffd60a';
      bar.style.background  = 'linear-gradient(to right,#ffd60a,#ffe53b)';
    } else {
      fill.style.background = '#ff3b30';
      bar.style.background  = 'linear-gradient(to right,#ff3b30,#ff6259)';
    }

    // Battery dot
    const battDot = document.getElementById('battDot');
    if (pct > 20) {
      battDot.className = 'dot dot-green';
    } else {
      battDot.className = 'dot dot-red dot-animate';
    }

    // Charging bolt
    const bolt         = document.getElementById('boltIcon');
    const cardBolt     = document.getElementById('battCardBolt');
    const battPctEl    = document.getElementById('battPct');

    if (isCharging) {
      bolt.style.opacity = '1';
      bolt.style.color   = '#FFD700';
      cardBolt.style.display = 'inline';
    } else {
      bolt.style.opacity = '0.3';
      bolt.style.color   = 'rgba(255,255,255,0.4)';
      cardBolt.style.display = 'none';
    }

    battPctEl.style.color = pct <= 20 ? '#ff3b30' : 'rgba(255,255,255,0.9)';
  }

  // ─────────────────────────────────────────────
  // APPLY WALLPAPER (base64 from Firebase)
  // ─────────────────────────────────────────────
  function applyWallpaper(base64) {
    if (!base64 || base64 === '') return;
    const el = document.getElementById('wallpaperImg');
    el.style.backgroundImage = `url('${base64}')`;
    // Slight delay to let image decode before fade-in
    requestAnimationFrame(() => {
      setTimeout(() => el.classList.add('loaded'), 60);
    });
  }

  // ─────────────────────────────────────────────
  // APPLY WIFI STATUS
  // ─────────────────────────────────────────────
  function applyWifi(wifiOn) {
    const dot   = document.getElementById('wifiDot');
    const label = document.getElementById('wifiLabel');
    const icon  = document.getElementById('wifiIcon');

    if (wifiOn) {
      dot.className     = 'dot dot-green dot-animate';
      label.textContent = 'Online';
      icon.className    = 'fa-solid fa-wifi';
      icon.style.color  = '#30d158';
    } else {
      dot.className     = 'dot dot-red';
      label.textContent = 'Offline';
      icon.className    = 'fa-solid fa-wifi-slash';
      icon.style.color  = 'rgba(255,255,255,0.5)';
    }
  }

  // ─────────────────────────────────────────────
  // FIREBASE AUTH + LISTENERS
  // ─────────────────────────────────────────────
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    uid      = user.uid;
    deviceId = await getDeviceIdSafe();

    // ── 1. Listen to deviceStatus (wifi, charging, etc.) ──
    // Path: users/{uid}/devices/{deviceId}/deviceStatus
    onValue(ref(db, `users/${uid}/devices/${deviceId}/deviceStatus`), snap => {
      const d = snap.val();
      if (!d) return;

      // WiFi
      if (d.wifi !== undefined) applyWifi(!!d.wifi);

      // Battery — DeviceStatusModule pushes battery under deviceStatus
      // Some builds push battery.level + battery.charging as nested object
      if (d.battery) {
        const lvl      = d.battery.level ?? d.battery.percentage ?? null;
        const charging = d.battery.charging ?? d.battery.isCharging ?? false;
        if (lvl !== null) applyBattery(lvl, charging);
      }
      // Fallback: some modules push batteryLevel / batteryCharging flat
      if (d.batteryLevel !== undefined) {
        applyBattery(d.batteryLevel, !!d.batteryCharging);
      }
    });

    // ── 2. Listen to wallpaper ──
    // Path: users/{uid}/devices/{deviceId}/wallpaper
    // Structure: { wallpaper: { base64: "data:image/jpeg;base64,...", id, isLive }, timestamp }
    onValue(ref(db, `users/${uid}/devices/${deviceId}/wallpaper`), snap => {
      const d = snap.val();
      if (!d) return;
      const wp = d.wallpaper || d; // handle both nested and flat
      if (wp.base64 && wp.base64 !== '') {
        applyWallpaper(wp.base64);
      }
    });

    // ── 3. Listen to battery node (if pushed separately) ──
    // Some builds push to a dedicated /battery path
    onValue(ref(db, `users/${uid}/devices/${deviceId}/battery`), snap => {
      const d = snap.val();
      if (!d) return;
      const lvl      = d.level ?? d.percentage ?? d.batteryLevel ?? null;
      const charging = d.charging ?? d.isCharging ?? d.batteryCharging ?? false;
      if (lvl !== null) applyBattery(lvl, charging);
    });
  });

  // ─────────────────────────────────────────────
  // LOCK DEVICE BUTTON
  // ─────────────────────────────────────────────
  document.getElementById('lockAppBtn').addEventListener('click', () => {
    if (!uid || !deviceId) return;
    // Send lockDevice command — same pattern as previous device.js
    set(ref(db, `users/${uid}/devices/${deviceId}/commands/current`), { action: "lockDevice" })
      .then(() => {
        // Visual feedback: briefly tint the lock icon
        const icon = document.querySelector('#lockAppBtn .app-icon');
        icon.style.boxShadow = '0 0 0 3px rgba(255,59,48,0.8), 0 4px 14px rgba(0,0,0,0.5)';
        setTimeout(() => {
          icon.style.boxShadow = '';
        }, 800);
      })
      .catch(e => console.error('Lock command failed:', e));
  });