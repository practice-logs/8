import { db, auth } from "../api/firebase.js";
import { ref, get, onValue, remove }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

/* ─────────────────────────────────────
   CONFIG
───────────────────────────────────── */
const PAGE_SIZE = 15;
const PKG = {
  whatsapp: 'com.whatsapp',
  telegram: 'org.telegram.messenger',
  snapchat: 'com.snapchat.android'
};

const WA_SVG = `<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>`;
const TG_SVG = `<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>`;
const SC_SVG = `<path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.024.358-.029.53.14.07.305.134.51.134.358 0 .732-.149 1.11-.443.17-.129.345-.196.508-.196.145 0 .275.047.375.134.19.164.286.438.286.813 0 .684-.548 1.22-1.248 1.22-.36 0-.67-.04-.956-.11-.03.09-.06.185-.09.28-.022.067-.04.13-.054.188.21.051.414.075.613.075.49 0 .9-.148 1.316-.308.27-.102.547-.208.835-.242.04-.006.082-.008.124-.008.385 0 .714.184.86.477.086.171.09.353.013.51-.253.53-1.039.734-1.726.905-.063.015-.126.03-.186.044-.52.123-1.17.222-2.08.354-.17.026-.342.052-.517.08.04.113.088.213.136.315.14.3.294.634.34 1.03.047.395-.068.706-.31.898-.39.3-.918.326-1.416.293l-.024-.002a8.81 8.81 0 01-2.02.37 5.48 5.48 0 01-.21.01c-.92 0-1.674-.335-2.27-.657-.02-.012-.042-.014-.065-.014-.022 0-.043.002-.063.013-.597.323-1.35.658-2.272.658-.07 0-.14-.003-.21-.01a8.81 8.81 0 01-2.02-.37l-.023.002c-.498.033-1.026.007-1.416-.293-.242-.192-.357-.503-.31-.898.046-.396.2-.73.34-1.03.048-.102.096-.202.136-.315-.175-.028-.347-.054-.517-.08-.91-.132-1.56-.23-2.08-.354-.06-.014-.123-.03-.186-.044-.687-.17-1.473-.374-1.726-.905-.077-.157-.073-.339.013-.51.146-.293.475-.477.86-.477.042 0 .084.002.124.008.288.034.565.14.835.242.416.16.826.308 1.316.308.2 0 .403-.024.613-.075-.014-.058-.032-.121-.054-.188-.03-.095-.06-.19-.09-.28-.286.07-.596.11-.956.11-.7 0-1.248-.536-1.248-1.22 0-.375.096-.65.286-.813.1-.087.23-.134.375-.134.163 0 .338.067.508.196.378.294.752.443 1.11.443.205 0 .37-.064.51-.134-.005-.172-.017-.35-.029-.53l-.003-.06c-.104-1.628-.23-3.654.299-4.847C7.859 1.07 11.216.793 12.206.793z"/>`;

/* ─────────────────────────────────────
   STATE
───────────────────────────────────── */
let uid = null, deviceId = null;
let activeApp    = null;   // 'whatsapp' | 'telegram' | 'snapchat' | null
let activeSender = null;
const notifStore = { whatsapp: {}, telegram: {}, snapchat: {} };

let cachedMessages  = [];
let loadedMsgCount  = 0;
let isFetchingPage  = false;

/* ─────────────────────────────────────
   DOM REFS
───────────────────────────────────── */
const getEl   = id => document.getElementById(id);
const appRoot = getEl('ntf-app');

const elLanding        = getEl('ntf-landing');
const elSidebarPanel   = getEl('ntf-sidebar-panel');
const elMessagePanel   = getEl('ntf-message-panel');
const elEmptyState     = getEl('ntf-empty-state');
const elThreadHeader   = getEl('ntf-thread-header');
const elMessagesArea   = getEl('ntf-messages-area');
const elThreadStatusbar= getEl('ntf-thread-statusbar');
const elThreadList     = getEl('ntf-thread-list');
const elSearchInput    = getEl('ntf-search-input');
const elLoadTrigger    = getEl('ntf-load-trigger');
const elFsOverlay      = getEl('ntf-fullscreen-overlay');
const elFsImg          = getEl('ntf-fullscreen-img');
const elPillIcon       = getEl('ntf-pill-icon');
const elPillLabel      = getEl('ntf-pill-label');
const elConvCount      = getEl('ntf-h-conv-count');

/* ─────────────────────────────────────
   HELPERS
───────────────────────────────────── */
function esc(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}
function initials(n) {
  return (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─────────────────────────────────────
   THEME / APP CLASSES
───────────────────────────────────── */
function applyAppTheme(app) {
  appRoot.classList.remove(
    'ntf-wa-active', 'ntf-tg-active', 'ntf-sc-active',
    'ntf-tg-mode', 'ntf-sc-mode',
    'ntf-has-app', 'ntf-show-convs', 'ntf-show-thread'
  );
  if (app === 'whatsapp') {
    appRoot.classList.add('ntf-wa-active', 'ntf-has-app');
    elPillIcon.innerHTML = WA_SVG;
    elPillLabel.textContent = 'WhatsApp';
  } else if (app === 'telegram') {
    appRoot.classList.add('ntf-tg-active', 'ntf-tg-mode', 'ntf-has-app');
    elPillIcon.innerHTML = TG_SVG;
    elPillLabel.textContent = 'Telegram';
  } else if (app === 'snapchat') {
    appRoot.classList.add('ntf-sc-active', 'ntf-sc-mode', 'ntf-has-app');
    elPillIcon.innerHTML = SC_SVG;
    elPillLabel.textContent = 'Snapchat';
  }
  const labelMap = { whatsapp: 'WhatsApp', telegram: 'Telegram', snapchat: 'Snapchat' };
  getEl('ntf-empty-title').textContent = app
    ? (labelMap[app] || app) + ' chats'
    : 'Select a chat';
}

/* ─────────────────────────────────────
   SCREEN STATE MACHINE
───────────────────────────────────── */
function showLanding() {
  elLanding.classList.remove('ntf-gone');
  appRoot.classList.remove(
    'ntf-has-app', 'ntf-show-convs', 'ntf-show-thread',
    'ntf-wa-active', 'ntf-tg-active', 'ntf-sc-active',
    'ntf-tg-mode', 'ntf-sc-mode'
  );
  activeApp = null; activeSender = null;
  elConvCount.style.display = 'none';
  getEl('ntf-h-thread-title').style.display = 'none';
  getEl('ntf-h-clear').style.display = 'none';
}

function showConvsScreen() {
  elLanding.classList.add('ntf-gone');
  appRoot.classList.add('ntf-show-convs');
  appRoot.classList.remove('ntf-show-thread');
  elConvCount.style.display = '';
  getEl('ntf-h-thread-title').style.display = 'none';
  getEl('ntf-h-clear').style.display = 'none';
  showEmptyState();
}

function showEmptyState() {
  elEmptyState.classList.remove('ntf-visually-hidden');
  elThreadHeader.style.display = '';
  elMessagesArea.classList.add('ntf-visually-hidden');
  elThreadStatusbar.style.display = '';
  appRoot.classList.remove('ntf-show-thread');
}

function showThreadScreen() {
  appRoot.classList.add('ntf-show-thread');
  elEmptyState.classList.add('ntf-visually-hidden');
  elMessagesArea.classList.remove('ntf-visually-hidden');
}

/* ─────────────────────────────────────
   LANDING CLICKS
───────────────────────────────────── */
getEl('ntf-land-wa').addEventListener('click', () => activateApp('whatsapp'));
getEl('ntf-land-tg').addEventListener('click', () => activateApp('telegram'));
getEl('ntf-land-sc').addEventListener('click', () => activateApp('snapchat'));

function activateApp(app) {
  if (activeApp === app && appRoot.classList.contains('ntf-show-convs')) return;
  activeApp = app; activeSender = null; cachedMessages = []; loadedMsgCount = 0;
  applyAppTheme(app);
  showConvsScreen();
  renderThreadList();
}

/* ─────────────────────────────────────
   BACK BUTTON
───────────────────────────────────── */
getEl('ntf-btn-back').addEventListener('click', () => {
  if (appRoot.classList.contains('ntf-show-thread') && window.innerWidth <= 768) {
    appRoot.classList.remove('ntf-show-thread');
    activeSender = null;
    getEl('ntf-h-thread-title').style.display = 'none';
    getEl('ntf-h-clear').style.display = 'none';
    elConvCount.style.display = '';
    showEmptyState();
  } else {
    showLanding();
  }
});

/* ─────────────────────────────────────
   SEARCH
───────────────────────────────────── */
elSearchInput.addEventListener('input', renderThreadList);

/* ─────────────────────────────────────
   CLEAR THREAD
───────────────────────────────────── */
function clearActiveThread() {
  if (!activeSender || !activeApp || !uid || !deviceId) return;
  Object.entries(notifStore[activeApp] || {}).forEach(([key, d]) => {
    if ((d.title || d.appName || 'Unknown') !== activeSender) return;
    remove(ref(db, `users/${uid}/devices/${deviceId}/notification/live/${key}`));
  });
  activeSender = null;
  appRoot.classList.remove('ntf-show-thread');
  getEl('ntf-h-thread-title').style.display = 'none';
  getEl('ntf-h-clear').style.display = 'none';
  elConvCount.style.display = '';
  showEmptyState();
  renderThreadList();
}
getEl('ntf-h-clear').addEventListener('click', clearActiveThread);
getEl('ntf-clear-thread-desk').addEventListener('click', clearActiveThread);

/* ─────────────────────────────────────
   LANDING BADGES
───────────────────────────────────── */
function updateLandingBadge(app) {
  const idMap = { whatsapp: 'ntf-badge-wa', telegram: 'ntf-badge-tg', snapchat: 'ntf-badge-sc' };
  const cntMap= { whatsapp: 'ntf-badge-wa-count', telegram: 'ntf-badge-tg-count', snapchat: 'ntf-badge-sc-count' };
  const count  = Object.keys(notifStore[app] || {}).length;
  const badge  = getEl(idMap[app]);
  const countEl= getEl(cntMap[app]);
  if (badge && countEl) {
    countEl.textContent = count;
    badge.classList.toggle('ntf-badge-visible', count > 0);
  }
}

/* ─────────────────────────────────────
   EXTRACT MESSAGES FROM NOTIFICATION
───────────────────────────────────── */
function extractMsgs(d) {
  if (Array.isArray(d.messages) && d.messages.length > 0)
    return d.messages.map(m => ({
      sender: m.sender || d.title || '',
      text: m.text || '',
      ts: m.timestamp || d.timestamp || 0,
      bigPicture: ''
    }));
  if (Array.isArray(d.textLines) && d.textLines.length > 0)
    return d.textLines.map((line, i) => ({
      sender: d.title || '',
      text: line,
      ts: d.timestamp ? (d.timestamp - (d.textLines.length - 1 - i) * 800) : 0,
      bigPicture: ''
    }));
  if (d.bigText)
    return [{ sender: d.title || '', text: d.bigText, ts: d.timestamp || 0, bigPicture: d.bigPicture || '' }];
  return [{ sender: d.title || '', text: d.text || '', ts: d.timestamp || 0, bigPicture: d.bigPicture || '' }];
}

/* ─────────────────────────────────────
   BUILD CONVERSATION LIST
───────────────────────────────────── */
function buildConvList(app) {
  const convs = {};
  Object.values(notifStore[app] || {}).forEach(d => {
    const sender = d.title || d.appName || 'Unknown';
    const msgs   = extractMsgs(d);
    const last   = msgs[msgs.length - 1] || {};
    if (!convs[sender]) {
      convs[sender] = { sender, lastMsg: last.text || '', lastTs: d.timestamp || 0, count: msgs.length, icon: d.largeIcon || '' };
    } else {
      convs[sender].count += msgs.length;
      if ((d.timestamp || 0) > convs[sender].lastTs) {
        convs[sender].lastTs  = d.timestamp || 0;
        convs[sender].lastMsg = last.text || '';
      }
    }
  });
  return Object.values(convs).sort((a, b) => b.lastTs - a.lastTs);
}

/* ─────────────────────────────────────
   RENDER THREAD LIST (SIDEBAR)
───────────────────────────────────── */
function renderThreadList() {
  if (!activeApp) return;
  const q     = elSearchInput.value.toLowerCase().trim();
  const convs = buildConvList(activeApp).filter(c => !q || c.sender.toLowerCase().includes(q));

  elThreadList.innerHTML = '';
  elConvCount.textContent = convs.length + ' chat' + (convs.length === 1 ? '' : 's');

  if (!convs.length) {
    elThreadList.innerHTML = `<div class="ntf-thread-empty">No notifications yet.<br>Messages will appear<br>when received.</div>`;
    return;
  }

  convs.forEach(c => {
    const li  = document.createElement('li');
    li.className = 'ntf-thread-row' + (activeSender === c.sender ? ' ntf-row-active' : '');
    const av  = c.icon
      ? `<img src="data:image/png;base64,${c.icon}" alt=""/>`
      : `<span>${initials(c.sender)}</span>`;
    li.innerHTML = `
      <div class="ntf-row-avatar">${av}</div>
      <div class="ntf-row-content">
        <div class="ntf-row-name">${esc(c.sender)}</div>
        <div class="ntf-row-preview">${esc(c.lastMsg)}</div>
      </div>
      <div class="ntf-row-meta">
        <span class="ntf-row-time">${fmtTime(c.lastTs)}</span>
        ${c.count > 1 ? `<span class="ntf-row-unread-dot">${c.count}</span>` : ''}
      </div>`;
    li.addEventListener('click', () => {
      activeSender = c.sender;
      document.querySelectorAll('.ntf-thread-row').forEach(r => r.classList.remove('ntf-row-active'));
      li.classList.add('ntf-row-active');
      openThread();
    });
    elThreadList.appendChild(li);
  });
}

/* ─────────────────────────────────────
   COLLECT MESSAGES FOR ACTIVE THREAD
───────────────────────────────────── */
function collectThreadMessages() {
  const arr = [];
  let iconB64 = '';
  Object.values(notifStore[activeApp] || {}).forEach(d => {
    if ((d.title || d.appName || 'Unknown') !== activeSender) return;
    if (!iconB64 && d.largeIcon) iconB64 = d.largeIcon;
    extractMsgs(d).forEach(m => arr.push({ ...m, bigPicture: d.bigPicture || '' }));
  });
  arr.sort((a, b) => a.ts - b.ts);
  return { msgs: arr, iconB64 };
}

/* ─────────────────────────────────────
   OPEN THREAD
───────────────────────────────────── */
function openThread() {
  if (!activeSender || !activeApp) return;
  showThreadScreen();

  const labelMap = { whatsapp: 'WhatsApp', telegram: 'Telegram', snapchat: 'Snapchat' };
  const appLabel = labelMap[activeApp] || activeApp;

  // Desktop thread header
  getEl('ntf-thread-sender-name').textContent = activeSender;
  getEl('ntf-thread-app-badge').textContent   = appLabel;
  getEl('ntf-statusbar-appname').textContent  = appLabel;

  // Mobile top header
  getEl('ntf-h-thread-title').style.display = 'flex';
  getEl('ntf-ht-name').textContent          = activeSender;
  getEl('ntf-h-clear').style.display        = 'flex';
  elConvCount.style.display                 = 'none';

  const { msgs, iconB64 } = collectThreadMessages();
  cachedMessages  = msgs;
  loadedMsgCount  = 0;

  // Avatar
  const avEl = getEl('ntf-thread-av');
  avEl.innerHTML = iconB64
    ? `<img src="data:image/png;base64,${iconB64}" alt=""/>`
    : initials(activeSender);

  // Counts
  const msgWord = n => n + ' message' + (n !== 1 ? 's' : '');
  getEl('ntf-statusbar-info').textContent = `${msgWord(msgs.length)} · ${activeSender}`;
  getEl('ntf-ht-sub').textContent         = msgWord(msgs.length);
  getEl('ntf-thread-msg-count').textContent = msgs.length + ' msg' + (msgs.length !== 1 ? 's' : '');

  // Clear messages area, keep sentinel
  while (elMessagesArea.children.length > 1) elMessagesArea.removeChild(elMessagesArea.lastChild);
  elLoadTrigger.innerHTML = '';

  loadMessagesPage(true);
  setupScrollObserver();
}

/* ─────────────────────────────────────
   PAGINATED RENDER
───────────────────────────────────── */
function loadMessagesPage(isFirst = false) {
  if (isFetchingPage) return;
  const total = cachedMessages.length;
  if (loadedMsgCount >= total) { elLoadTrigger.innerHTML = ''; return; }

  isFetchingPage = true;
  elLoadTrigger.innerHTML = `<div class="ntf-page-spinner"></div>`;

  requestAnimationFrame(() => {
    const end   = total - loadedMsgCount;
    const start = Math.max(0, end - PAGE_SIZE);
    const batch = cachedMessages.slice(start, end);
    loadedMsgCount += batch.length;

    const prevScrollH   = elMessagesArea.scrollHeight;
    const prevScrollTop = elMessagesArea.scrollTop;

    const frag = document.createDocumentFragment();
    let lastDate = '';

    batch.forEach(m => {
      const dateStr = fmtDate(m.ts);
      if (dateStr !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'ntf-date-divider';
        sep.textContent = dateStr;
        frag.appendChild(sep);
        lastDate = dateStr;
      }
      frag.appendChild(buildBubble(m));
    });

    const refNode = elLoadTrigger.nextSibling;
    if (refNode) elMessagesArea.insertBefore(frag, refNode);
    else         elMessagesArea.appendChild(frag);

    if (!isFirst) {
      elMessagesArea.scrollTop = elMessagesArea.scrollHeight - prevScrollH + prevScrollTop;
    } else {
      elMessagesArea.scrollTop = elMessagesArea.scrollHeight;
    }

    const remaining = total - loadedMsgCount;
    if (remaining > 0) {
      const loadCount = Math.min(remaining, PAGE_SIZE);
      elLoadTrigger.innerHTML = `<button class="ntf-load-older-btn">Load ${loadCount} older messages</button>`;
      elLoadTrigger.querySelector('.ntf-load-older-btn').addEventListener('click', () => loadMessagesPage(false));
    } else {
      elLoadTrigger.innerHTML = '';
    }

    isFetchingPage = false;
  });
}

function buildBubble(m) {
  const wrap = document.createElement('div');
  wrap.className = 'ntf-msg-group ntf-msg-in';
  const showSender = m.sender && m.sender !== activeSender;
  const imgHtml = m.bigPicture
    ? `<img class="ntf-msg-media-thumb" src="data:image/png;base64,${m.bigPicture}" alt="media" loading="lazy"/>`
    : '';
  wrap.innerHTML = `
    ${showSender ? `<div class="ntf-msg-sender-tag">${esc(m.sender)}</div>` : ''}
    <div class="ntf-msg-bubble">${esc(m.text)}${imgHtml}</div>
    <div class="ntf-msg-timestamp">${fmtTime(m.ts)}</div>`;
  const thumb = wrap.querySelector('.ntf-msg-media-thumb');
  if (thumb) thumb.addEventListener('click', () => {
    elFsImg.src = thumb.src;
    elFsOverlay.classList.add('ntf-overlay-open');
  });
  return wrap;
}

/* ─────────────────────────────────────
   INTERSECTION OBSERVER (auto-load on scroll to top)
───────────────────────────────────── */
let scrollObserver = null;
function setupScrollObserver() {
  if (scrollObserver) scrollObserver.disconnect();
  scrollObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && loadedMsgCount < cachedMessages.length && !isFetchingPage)
        loadMessagesPage(false);
    });
  }, { root: elMessagesArea, threshold: 0.1 });
  scrollObserver.observe(elLoadTrigger);
}

/* ─────────────────────────────────────
   FULLSCREEN IMAGE
───────────────────────────────────── */
elFsOverlay.addEventListener('click', () => elFsOverlay.classList.remove('ntf-overlay-open'));

/* ─────────────────────────────────────
   FIREBASE
───────────────────────────────────── */
async function getDeviceId() {
  return new Promise((res, rej) => {
    onAuthStateChanged(auth, async user => {
      if (!user) return rej('Not authenticated');
      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      res(snap.val());
    });
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) return;
  uid      = user.uid;
  deviceId = await getDeviceId();

  const historyRef = ref(db, `users/${uid}/devices/${deviceId}/notification/history`);
  onValue(historyRef, snap => {
    notifStore.whatsapp = {};
    notifStore.telegram = {};
    notifStore.snapchat = {};
    snap.forEach(child => {
      const d = child.val();
      if (!d || !d.packageName) return;
      if      (d.packageName === PKG.whatsapp) notifStore.whatsapp[child.key] = d;
      else if (d.packageName === PKG.telegram) notifStore.telegram[child.key] = d;
      else if (d.packageName === PKG.snapchat) notifStore.snapchat[child.key] = d;
    });
    updateLandingBadge('whatsapp');
    updateLandingBadge('telegram');
    updateLandingBadge('snapchat');
    if (activeApp) {
      renderThreadList();
      if (activeSender) openThread();
    }
  });
});