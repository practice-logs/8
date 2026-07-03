  import { db, auth } from "../api/firebase.js";
  import {
    ref, get, set, push, remove, onValue, update
  } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

  /* ─────────────────────────────────────────
     STATE
  ───────────────────────────────────────── */
  let uid       = null;
  let deviceId  = null;
  let rawSms    = {};
  let convs     = [];
  let activeAddr = null;
  let activeConv = null;
  let filter    = 'all';
  let loadedN   = 30;
  let smsSync   = true;
  let callSync  = true;
  const BATCH   = 30;

  // conversation multi-select
  let convSelectMode = false;
  let convSelected   = new Set();  // addresses

  // message multi-select
  let msgSelectMode = false;
  let msgSelected   = new Set();   // smsIds

  /* ─────────────────────────────────────────
     DOM
  ───────────────────────────────────────── */
  const $$ = id => document.getElementById(id);

  const smsLeft      = $$('smsLeft');
  const smsRight     = $$('smsRight');
  const smsChatEmpty = $$('smsChatEmpty');
  const smsChatCont  = $$('smsChatContent');
  const smsChatMsgs  = $$('smsChatMsgs');
  const smsTA        = $$('smsTA');
  const smsSendBtn   = $$('smsSendBtn');
  const smsCharCount = $$('smsCharCount');
  const smsSearch    = $$('smsSearch');
  const smsConvList  = $$('smsConvList');
  const smsConvSelBar = $$('smsConvSelBar');
  const smsConvSelCount = $$('smsConvSelCount');
  const smsMsgSelBar  = $$('smsMsgSelBar');
  const smsMsgSelCount = $$('smsMsgSelCount');
  const smsChatMsgsEl = $$('smsChatMsgs');

  /* ─────────────────────────────────────────
     TOAST
  ───────────────────────────────────────── */
  const TICONS = { success:'fa-circle-check', error:'fa-circle-xmark', info:'fa-circle-info', warning:'fa-triangle-exclamation' };
  let _toastTimer;

  function toast(msg, type = 'success') {
    const el = $$('smsToast');
    $$('smsToastIcon').className = `fa-solid ${TICONS[type]}`;
    $$('smsToastMsg').textContent = msg;
    el.className = `sms-toast ${type} visible`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
  }

  /* ─────────────────────────────────────────
     CONFIRM DIALOG
  ───────────────────────────────────────── */
  let _dialogRes = null;

  function smsDialog(title, msg, confirmLabel = 'Delete') {
    $$('smsDialogTitle').textContent = title;
    $$('smsDialogMsg').textContent   = msg;
    $$('smsDialogOk').textContent    = confirmLabel;
    $$('smsOverlay').classList.add('open');
    return new Promise(r => { _dialogRes = r; });
  }

  window.smsCloseDialog = function(result = false) {
    $$('smsOverlay').classList.remove('open');
    if (_dialogRes) { _dialogRes(result); _dialogRes = null; }
  };
  $$('smsDialogOk').onclick = () => window.smsCloseDialog(true);

  /* ─────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────── */
  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initials(name, addr) {
    if (name && name !== addr && name.trim().length > 0) {
      const p = name.trim().split(/\s+/);
      return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : p[0].slice(0,2).toUpperCase();
    }
    const d = (addr||'').replace(/\D/g,'');
    return d.slice(-2) || '??';
  }

  function avClass(str) {
    let h = 0;
    for (const c of str) h = (Math.imul(h,31) + c.charCodeAt(0)) | 0;
    return 'av-' + (Math.abs(h) % 8);
  }

  function mkAvatar(name, addr, size = 42) {
    const d = document.createElement('div');
    d.className = `sms-avatar ${avClass(addr||name||'')}`;
    d.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px;`;
    d.textContent = initials(name, addr);
    return d;
  }

  function fmtConvTime(ts) {
    const d = new Date(ts), now = new Date();
    const dd = Math.floor((now - d) / 86400000);
    if (dd === 0) return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    if (dd === 1) return 'Yesterday';
    if (dd < 7)  return d.toLocaleDateString([], {weekday:'short'});
    return d.toLocaleDateString([], {day:'2-digit',month:'short'});
  }

  function fmtMsgTime(ts) {
    return new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }

  function fmtDateSep(ts) {
    const d = new Date(ts), now = new Date();
    const dd = Math.floor((now - d) / 86400000);
    if (dd === 0) return 'Today';
    if (dd === 1) return 'Yesterday';
    return d.toLocaleDateString([], {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  }

  /* ─────────────────────────────────────────
     BUILD CONVERSATIONS
  ───────────────────────────────────────── */
  function buildConvs(raw) {
    const map = {};
    for (const [id, sms] of Object.entries(raw)) {
      const key = (sms.address || 'unknown').replace(/\s+/g,'');
      if (!map[key]) {
        map[key] = { address: sms.address||'Unknown', name: sms.name||sms.address||'Unknown', msgs:[], unread:0, lastTs:0 };
      }
      const m = { id, ...sms };
      map[key].msgs.push(m);
      if ((sms.timestamp||0) > map[key].lastTs) {
        map[key].lastTs = sms.timestamp;
        if (sms.name && sms.name.trim() && sms.name !== sms.address) map[key].name = sms.name;
      }
      if (sms.read === false && sms.type === 'INBOX') map[key].unread++;
    }
    for (const c of Object.values(map)) c.msgs.sort((a,b) => (a.timestamp||0) - (b.timestamp||0));
    return Object.values(map).sort((a,b) => b.lastTs - a.lastTs);
  }

  function applyFilter(list, f, q) {
    let r = list;
    if (f === 'unread') r = r.filter(c => c.unread > 0);
    else if (f === 'inbox') r = r.filter(c => c.msgs.some(m => m.type === 'INBOX'));
    else if (f === 'sent')  r = r.filter(c => c.msgs.some(m => m.type === 'SENT' || m.type === 'OTHER'));
    if (q) {
      const lq = q.toLowerCase();
      r = r.filter(c =>
        c.name.toLowerCase().includes(lq) ||
        c.address.toLowerCase().includes(lq) ||
        c.msgs.some(m => (m.body||'').toLowerCase().includes(lq))
      );
    }
    return r;
  }

  /* ─────────────────────────────────────────
     RENDER CONVERSATION LIST
  ───────────────────────────────────────── */
  function renderConvList() {
    const q        = smsSearch.value.trim();
    const filtered = applyFilter(convs, filter, q);

    if (!filtered.length) {
      smsConvList.innerHTML = `<div class="sms-conv-empty"><i class="fa-regular fa-comment-dots"></i>${q ? 'No results for "'+esc(q)+'"' : 'No conversations'}</div>`;
      return;
    }

    smsConvList.innerHTML = '';
    filtered.forEach(conv => {
      const last    = conv.msgs[conv.msgs.length - 1];
      const isActive = conv.address === activeAddr;
      const unread  = conv.unread;
      const preview = last ? (last.type !== 'INBOX' ? '➤ ' : '') + (last.body||'').slice(0,52) : '';
      const isSel   = convSelected.has(conv.address);

      const item = document.createElement('div');
      item.className = `sms-conv-item${isActive ? ' active' : ''}${isSel ? ' selected' : ''}${convSelectMode ? ' sms-select-mode' : ''}`;
      item.dataset.addr = conv.address;

      // Checkbox
      const chk = document.createElement('div');
      chk.className = `sms-conv-check${isSel ? ' checked' : ''}`;
      chk.innerHTML = isSel ? '<i class="fa-solid fa-check"></i>' : '';
      chk.onclick = (e) => { e.stopPropagation(); smsConvToggleSel(conv.address); };
      item.appendChild(chk);

      // Avatar
      item.appendChild(mkAvatar(conv.name, conv.address));

      // Info
      const info = document.createElement('div');
      info.className = 'sms-conv-info';
      info.innerHTML = `
        <div class="sms-conv-top">
          <span class="sms-conv-name">${esc(conv.name)}</span>
          <span class="sms-conv-time">${last ? fmtConvTime(last.timestamp) : ''}</span>
        </div>
        <div class="sms-conv-bottom">
          <span class="sms-conv-preview${unread ? ' unread' : ''}">${esc(preview)}</span>
          ${unread ? `<span class="sms-unread-badge">${unread}</span>` : ''}
        </div>`;

      // Long-press → enter select mode
      let pressTimer;
      item.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => { smsConvEnterSelect(conv.address); }, 550);
      });
      item.addEventListener('pointerup', () => clearTimeout(pressTimer));
      item.addEventListener('pointerleave', () => clearTimeout(pressTimer));

      item.onclick = () => {
        if (convSelectMode) { smsConvToggleSel(conv.address); return; }
        openConv(conv.address);
      };

      item.appendChild(info);
      smsConvList.appendChild(item);
    });
  }

  /* ─────────────────────────────────────────
     CONV MULTI-SELECT
  ───────────────────────────────────────── */
  function smsConvEnterSelect(addr) {
    convSelectMode = true;
    convSelected.add(addr);
    smsConvSelBar.classList.add('visible');
    updateConvSelCount();
    renderConvList();
  }

  window.smsConvExitSelect = function() {
    convSelectMode = false;
    convSelected.clear();
    smsConvSelBar.classList.remove('visible');
    renderConvList();
  };

  function smsConvToggleSel(addr) {
    if (convSelected.has(addr)) convSelected.delete(addr);
    else convSelected.add(addr);
    updateConvSelCount();
    renderConvList();
    if (convSelected.size === 0) window.smsConvExitSelect();
  }

  window.smsConvSelAll = function() {
    const q = smsSearch.value.trim();
    const filtered = applyFilter(convs, filter, q);
    filtered.forEach(c => convSelected.add(c.address));
    updateConvSelCount();
    renderConvList();
  };

  function updateConvSelCount() {
    smsConvSelCount.textContent = `${convSelected.size} selected`;
  }

  window.smsConvDelSelected = async function() {
    if (!convSelected.size) return;
    const ok = await smsDialog(
      'Delete conversations?',
      `Delete ${convSelected.size} conversation(s) and all their messages from Firebase?`
    );
    if (!ok) return;

    for (const addr of convSelected) {
      const conv = convs.find(c => c.address === addr);
      if (!conv) continue;
      for (const m of conv.msgs) {
        try { await remove(ref(db, `users/${uid}/devices/${deviceId}/data/sms/${m.id}`)); } catch(_) {}
      }
    }
    toast(`${convSelected.size} conversation(s) deleted`, 'success');
    if (convSelected.has(activeAddr)) smsGoBack();
    window.smsConvExitSelect();
  };

  /* ─────────────────────────────────────────
     OPEN CONVERSATION
  ───────────────────────────────────────── */
  function openConv(addr) {
    activeAddr = addr;
    loadedN    = BATCH;
    activeConv = convs.find(c => c.address === addr);
    if (!activeConv) return;

    // Mobile slide
    smsLeft.classList.add('hidden');
    smsRight.classList.add('open');

    smsChatEmpty.style.display  = 'none';
    smsChatCont.style.display   = 'flex';

    // Header
    const av = mkAvatar(activeConv.name, activeConv.address, 36);
    const chatAv = $$('smsChatAv');
    chatAv.className = av.className;
    chatAv.style.cssText = av.style.cssText;
    chatAv.textContent = av.textContent;
    $$('smsChatName').textContent = activeConv.name;
    $$('smsChatNum').textContent  = activeConv.address;

    renderConvList();
    renderMsgs();
    autoMarkRead(activeConv);
  }

  /* ─────────────────────────────────────────
     RENDER MESSAGES
  ───────────────────────────────────────── */
  function renderMsgs() {
    if (!activeConv) return;
    const all     = activeConv.msgs;
    const total   = all.length;
    const start   = Math.max(0, total - loadedN);
    const visible = all.slice(start);

    smsChatMsgs.innerHTML = '';

    if (start > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'sms-load-more';
      const btn = document.createElement('button');
      btn.className = 'sms-load-more-btn';
      btn.textContent = `Load ${Math.min(BATCH, start)} earlier`;
      btn.onclick = loadMore;
      wrap.appendChild(btn);
      smsChatMsgs.appendChild(wrap);
    }

    const firstUnreadIdx = visible.findIndex(m => m.read === false && m.type === 'INBOX');
    let lastDate = '', lastType = '', lastTs = 0;

    visible.forEach((msg, i) => {
      const msgDate = new Date(msg.timestamp||0).toDateString();

      if (msgDate !== lastDate) {
        lastDate = msgDate;
        lastType = ''; lastTs = 0;
        const sep = document.createElement('div');
        sep.className = 'sms-date-sep';
        sep.textContent = fmtDateSep(msg.timestamp||0);
        smsChatMsgs.appendChild(sep);
      }

      if (i === firstUnreadIdx && i > 0) {
        const us = document.createElement('div');
        us.className = 'sms-unread-sep';
        us.textContent = 'New messages';
        smsChatMsgs.appendChild(us);
      }

      const dir   = msg.type === 'INBOX' ? 'in' : 'out';
      const isSeq = lastType === msg.type && (msg.timestamp - lastTs) < 90000;
      const isSel = msgSelected.has(msg.id);

      const row = document.createElement('div');
      row.className = `sms-msg-row ${dir}${isSeq ? ' seq' : ''}${msgSelectMode ? ' sms-msg-select-mode' : ''}${isSel ? ' selected' : ''}`;
      row.dataset.id = msg.id;

      // Checkbox
      const chk = document.createElement('div');
      chk.className = `sms-msg-chk${isSel ? ' checked' : ''}`;
      chk.innerHTML = isSel ? '<i class="fa-solid fa-check"></i>' : '';
      chk.onclick = (e) => { e.stopPropagation(); smsMsgToggleSel(msg.id); };
      row.appendChild(chk);

      const bbl = document.createElement('div');
      bbl.className = `sms-bubble ${dir}`;
      bbl.innerHTML = `${esc(msg.body||'')}<span class="sms-bubble-time">${fmtMsgTime(msg.timestamp||0)}</span>`;

      // Per-bubble delete button (non-select mode)
      const delBtn = document.createElement('div');
      delBtn.className = 'sms-msg-del';
      delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      delBtn.title = 'Delete this message';
      delBtn.onclick = (e) => { e.stopPropagation(); smsDelSingleMsg(msg.id); };
      bbl.appendChild(delBtn);

      row.onclick = () => {
        if (msgSelectMode) { smsMsgToggleSel(msg.id); }
      };

      row.appendChild(bbl);
      smsChatMsgs.appendChild(row);

      lastType = msg.type;
      lastTs   = msg.timestamp||0;
    });

    requestAnimationFrame(() => { smsChatMsgs.scrollTop = smsChatMsgs.scrollHeight; });
  }

  function loadMore() {
    if (!activeConv) return;
    const prevH = smsChatMsgs.scrollHeight;
    loadedN += BATCH;
    renderMsgs();
    requestAnimationFrame(() => { smsChatMsgs.scrollTop = smsChatMsgs.scrollHeight - prevH; });
  }

  /* ─────────────────────────────────────────
     MESSAGE MULTI-SELECT
  ───────────────────────────────────────── */
  window.smsMsgEnterSelect = function() {
    msgSelectMode = true;
    msgSelected.clear();
    smsMsgSelBar.classList.add('visible');
    updateMsgSelCount();
    renderMsgs();
  };

  window.smsMsgExitSelect = function() {
    msgSelectMode = false;
    msgSelected.clear();
    smsMsgSelBar.classList.remove('visible');
    renderMsgs();
  };

  function smsMsgToggleSel(id) {
    if (msgSelected.has(id)) msgSelected.delete(id);
    else msgSelected.add(id);
    updateMsgSelCount();
    renderMsgs();
  }

  function updateMsgSelCount() {
    smsMsgSelCount.textContent = `${msgSelected.size} selected`;
  }

  window.smsMsgDelSelected = async function() {
    if (!msgSelected.size) return;
    const ok = await smsDialog(
      'Delete messages?',
      `Delete ${msgSelected.size} selected message(s) from Firebase?`
    );
    if (!ok) return;

    for (const id of msgSelected) {
      try { await remove(ref(db, `users/${uid}/devices/${deviceId}/data/sms/${id}`)); } catch(_) {}
    }
    toast(`${msgSelected.size} message(s) deleted`, 'success');
    window.smsMsgExitSelect();
  };

  /* ─────────────────────────────────────────
     DELETE SINGLE MESSAGE (hover button)
  ───────────────────────────────────────── */
  async function smsDelSingleMsg(id) {
    const ok = await smsDialog('Delete message?', 'Remove this message from Database?');
    if (!ok) return;
    try {
      await remove(ref(db, `users/${uid}/devices/${deviceId}/data/sms/${id}`));
      toast('Message deleted', 'success');
    } catch(e) {
      toast('Delete failed', 'error');
    }
  }

  /* ─────────────────────────────────────────
     AUTO MARK READ
  ───────────────────────────────────────── */
  async function autoMarkRead(conv) {
    if (!uid || !deviceId) return;
    const unread = conv.msgs.filter(m => m.read === false && m.type === 'INBOX');
    for (const m of unread) {
      try {
        await set(ref(db, `users/${uid}/devices/${deviceId}/data/sms/${m.id}/read`), true);
      } catch(_) {}
    }
  }

  /* ─────────────────────────────────────────
     MARK ALL READ (button)
  ───────────────────────────────────────── */
  window.smsMarkAllRead = async function() {
    if (!activeConv || !uid || !deviceId) return;
    await autoMarkRead(activeConv);

    // Also send mark_read commands to device for each unread
    const unread = activeConv.msgs.filter(m => m.read === false && m.type === 'INBOX');
    for (const m of unread) {
      try {
        await push(ref(db, `users/${uid}/devices/${deviceId}/data/commands`), {
          action: 'mark_read', target: m.id, read: true, timestamp: Date.now()
        });
      } catch(_) {}
    }
    toast('Marked all as read', 'info');
  };

  /* ─────────────────────────────────────────
     DELETE CONVERSATION
  ───────────────────────────────────────── */
  window.smsPromptDelConv = async function() {
    if (!activeConv) return;
    const ok = await smsDialog(
      'Delete conversation?',
      `Delete all ${activeConv.msgs.length} message(s) with ${activeConv.name} from Firebase?`
    );
    if (!ok) return;

    for (const m of activeConv.msgs) {
      try { await remove(ref(db, `users/${uid}/devices/${deviceId}/data/sms/${m.id}`)); } catch(_) {}
    }
    toast('Conversation deleted', 'success');
    smsGoBack();
  };

  /* ─────────────────────────────────────────
     GO BACK (mobile)
  ───────────────────────────────────────── */
  window.smsGoBack = function() {
    activeAddr = null;
    activeConv = null;
    smsLeft.classList.remove('hidden');
    smsRight.classList.remove('open');
    smsChatCont.style.display = 'none';
    smsChatEmpty.style.display = 'flex';
    if (msgSelectMode) window.smsMsgExitSelect();
  };

  /* ─────────────────────────────────────────
     COMPOSE
  ───────────────────────────────────────── */
  window.smsOnCompose = function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    const len = el.value.length;
    const sms = Math.ceil(len / 160) || 1;
    const rem = sms * 160 - len;
    if (len === 0) {
      smsCharCount.textContent = '';
      smsCharCount.className   = 'sms-char-count';
    } else if (len >= 130) {
      smsCharCount.textContent = `${rem}/${sms}`;
      smsCharCount.className   = `sms-char-count${rem < 20 ? ' over' : rem < 50 ? ' warn' : ''}`;
    } else {
      smsCharCount.textContent = '';
    }
    smsSendBtn.disabled = el.value.trim().length === 0;
  };

  window.smsOnKey = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!smsSendBtn.disabled) smsSend();
    }
  };

  /* ─────────────────────────────────────────
     SEND SMS → Firebase command
  ───────────────────────────────────────── */
  window.smsSend = async function() {
    const body = smsTA.value.trim();
    if (!body || !activeAddr || !uid || !deviceId) return;

    smsSendBtn.disabled = true;
    try {
      await push(ref(db, `users/${uid}/devices/${deviceId}/data/commands`), {
        action    : 'send_sms',
        target    : activeAddr,
        message   : body,
        timestamp : Date.now()
      });
      smsTA.value = '';
      smsTA.style.height = 'auto';
      smsCharCount.textContent = '';
      toast('Message queued for delivery', 'success');
    } catch(e) {
      toast('Failed to queue message', 'error');
    } finally {
      smsSendBtn.disabled = smsTA.value.trim().length === 0;
    }
  };

  /* ─────────────────────────────────────────
     SYNC TOGGLES
  ───────────────────────────────────────── */
  window.smsTglSync = async function(type) {
    if (!uid || !deviceId) { toast('Not connected', 'error'); return; }
    const cur = type === 'sms' ? smsSync : callSync;
    const nv  = !cur;
    try {
      await set(ref(db, `users/${uid}/devices/${deviceId}/settings/${type}Sync`), nv);
      toast(`${type.toUpperCase()} sync ${nv ? 'enabled' : 'paused'}`, nv ? 'success' : 'warning');
    } catch(e) {
      toast('Failed to update setting', 'error');
    }
  };

  /* ─────────────────────────────────────────
     FILTER TABS
  ───────────────────────────────────────── */
  document.querySelectorAll('.sms-ftab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.sms-ftab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filter = tab.dataset.f;
      renderConvList();
    };
  });

  /* Search */
  let _st;
  smsSearch.oninput = () => { clearTimeout(_st); _st = setTimeout(renderConvList, 180); };

  /* ─────────────────────────────────────────
     FIREBASE — AUTH & DATA
  ───────────────────────────────────────── */
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      smsConvList.innerHTML = `<div class="sms-conv-empty"><i class="fa-solid fa-lock"></i>Sign in to view messages</div>`;
      return;
    }

    uid = user.uid;
    const snap = await get(ref(db, `users/${uid}/storeId`));
    deviceId   = snap.val();

    if (!deviceId) {
      smsConvList.innerHTML = `<div class="sms-conv-empty"><i class="fa-solid fa-mobile-screen-button"></i>No device selected.</div>`;
      return;
    }

    /* Connection indicator */
    onValue(ref(db, '.info/connected'), s => {
      const ok = s.val();
      $$('smsLive').className  = `sms-live ${ok ? 'connected' : 'offline'}`;
      $$('smsLiveText').textContent = ok ? 'Live' : 'Offline';
    });

    /* Settings */
    onValue(ref(db, `users/${uid}/devices/${deviceId}/settings`), s => {
      const v = s.val() || {};
      smsSync  = v.smsSync  !== false;
      callSync = v.callSync !== false;
      $$('smsSyncTrack').className  = `sms-ts-track${smsSync  ? ' on' : ''}`;
      $$('callSyncTrack').className = `sms-ts-track${callSync ? ' on' : ''}`;
    });

    /* SMS data — real-time */
    onValue(ref(db, `users/${uid}/devices/${deviceId}/data/sms`), s => {
      rawSms = {};
      s.forEach(child => { rawSms[child.key] = { id: child.key, ...child.val() }; });

      convs = buildConvs(rawSms);
      renderConvList();

      if (activeAddr) {
        activeConv = convs.find(c => c.address === activeAddr);
        if (activeConv) {
          $$('smsChatName').textContent = activeConv.name;
          renderMsgs();
        } else {
          smsGoBack();
        }
      }
    });

  });