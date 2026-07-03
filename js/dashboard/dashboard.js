import { db, auth } from "../api/firebase.js";
import {
  ref, remove, onValue, onChildAdded, onChildRemoved,
  get, set, push, query, limitToFirst
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

let currentDeviceId = null;

document.addEventListener("DOMContentLoaded", () => {

  const sidebar           = document.getElementById("sidebar");
  const sidebarToggle     = document.getElementById("sidebar-toggle");
  const navbarToggle      = document.getElementById("navbar-toggle");
  const marginSide        = document.querySelector(".marginSideInput");
  const sidebarMenu       = document.getElementById("sidebar-menu");
  const flyoutLabel       = document.getElementById("flyout-label");
  const menuItems         = document.querySelectorAll("#sidebar-menu li[data-page]");
  const notifyBtn         = document.querySelector(".notify-btn");
  const notificationPanel = document.getElementById("notificationPanel");
  const notificationsDiv  = document.getElementById("notifications");
  const clearAllBtn       = document.getElementById("clearAllBtn");
  const notifBadge        = document.getElementById("notifBadge");

  let notifCount = 0;
  let isIconMode = false; // ✅ Track icon mode state

  // ✅ ICON MODE DEFAULT ON LOAD (DESKTOP ONLY)
  if (window.innerWidth > 768) {
    sidebar.classList.add("icon-mode");
    navbarToggle.classList.add("navbar-toggle-none");
    marginSide?.classList.add("margin-side");
    isIconMode = true;
  }

  function setActiveSidebar(page) {
    menuItems.forEach(li =>
      li.classList.toggle("active", li.dataset.page === page)
    );
  }

  const openSidebar = () => {
    sidebar.classList.add("show");
    document.body.classList.add("sidebar-open");
  };
  const closeSidebar = () => {
    sidebar.classList.remove("show");
    document.body.classList.remove("sidebar-open");
  };
  
  // ✅ FIXED: NAVBAR TOGGLE (HAMBURGER) - ONLY ON MOBILE
  const toggleSidebarMobile = () => {
    if (window.innerWidth <= 768) {
      // Mobile: slide in/out sidebar
      sidebar.classList.contains("show") ? closeSidebar() : openSidebar();
    } else {
      // Desktop: toggle icon mode
      isIconMode = !isIconMode;
      sidebar.classList.toggle("icon-mode");
      navbarToggle.classList.toggle("navbar-toggle-none");
      marginSide?.classList.toggle("margin-side");
    }
  };
  
  // ✅ FIXED: SIDEBAR TOGGLE BUTTON - EXPANDS ICON MODE TO FULL SIDEBAR
  const expandSidebarFromIcon = () => {
    isIconMode = false;
    sidebar.classList.remove("icon-mode");
    navbarToggle.classList.remove("navbar-toggle-none");
    marginSide?.classList.remove("margin-side");
  };

  navbarToggle?.addEventListener("click", toggleSidebarMobile);
  
  // ✅ FIXED: Sidebar toggle button expands from icon mode
  sidebarToggle?.addEventListener("click", expandSidebarFromIcon);
  
  sidebarMenu?.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-page]");
    if (!li) return;
    if (window.innerWidth <= 768) closeSidebar();
  });

  let lastMode = window.innerWidth <= 768 ? "mobile" : "desktop";
  window.addEventListener("resize", () => {
    const currentMode = window.innerWidth <= 768 ? "mobile" : "desktop";
    if (currentMode !== lastMode) { 
      lastMode = currentMode; 
      window.location.reload(); 
    }
    if (window.innerWidth > 768) closeSidebar();
  });

  document.addEventListener("click", (e) => {
    if (window.innerWidth > 768) return;
    if (!sidebar.classList.contains("show")) return;
    if (!sidebar.contains(e.target) && !(navbarToggle && navbarToggle.contains(e.target))) {
      closeSidebar();
    }
  });

  // ✅ FLYOUT LABELS - Hover tooltips for icon mode
  menuItems.forEach(item => {
    item.addEventListener("mouseenter", () => {
      if (!sidebar.classList.contains("icon-mode")) return;
      const text = item.querySelector("span")?.textContent || "";
      flyoutLabel.textContent = text;
      flyoutLabel.style.top = `${item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2 - 18}px`;
      flyoutLabel.classList.add("visible");
    });
    item.addEventListener("mouseleave", () => flyoutLabel.classList.remove("visible"));
  });

  notifyBtn?.addEventListener("click", () => {
    notificationPanel.classList.toggle("notification-flex");
    if (notificationPanel.classList.contains("notification-flex")) {
      notifCount = 0;
      updateBadge();
    }
    if (window.innerWidth <= 768) {
      document.body.style.overflow =
        notificationPanel.classList.contains("notification-flex") ? "hidden" : "";
    }
  });

  function updateBadge() {
    if (notifCount > 0) {
      notifBadge.style.display = "inline-flex";
      notifBadge.textContent = notifCount > 99 ? "99+" : notifCount;
    } else {
      notifBadge.style.display = "none";
    }
  }

  const placeholderIcon =
    "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
        <rect width="100%" height="100%" fill="#1e293b" rx="6"/>
        <text x="50%" y="55%" font-size="28" fill="#475569"
          text-anchor="middle" dy=".15em" font-family="sans-serif">?</text>
      </svg>`
    );

  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  }

  function toIconSrc(b64) {
    if (!b64 || typeof b64 !== "string" || b64.length < 20) return null;
    if (b64.startsWith("data:")) return b64;
    return "data:image/png;base64," + b64.replace(/\s/g,"");
  }

  const PKG_NAMES = {
    "com.whatsapp":                        "WhatsApp",
    "com.whatsapp.w4b":                    "WhatsApp Business",
    "com.google.android.gm":              "Gmail",
    "com.android.chrome":                 "Chrome",
    "com.instagram.android":             "Instagram",
    "com.facebook.katana":                "Facebook",
    "com.twitter.android":                "X (Twitter)",
    "org.telegram.messenger":            "Telegram",
    "com.snapchat.android":              "Snapchat",
    "com.android.mms":                   "Messages",
    "com.google.android.apps.messaging": "Messages",
    "com.microsoft.teams":               "Teams",
    "com.netflix.mediaclient":           "Netflix",
    "com.amazon.mShop.android.shopping": "Amazon",
    "com.google.android.youtube":        "YouTube",
  };

  function resolveAppName(data) {
    return data.appName
      || PKG_NAMES[data.packageName]
      || (data.packageName ? data.packageName.split(".").pop() : "Unknown");
  }

  function showEmptyState() {
    if (notificationsDiv.querySelector(".nc-empty")) return;
    notificationsDiv.innerHTML = `
      <div class="nc-empty">
        <div class="nc-empty-icon">
          <i class="fa-regular fa-bell-slash"></i>
        </div>
        <div class="nc-empty-title">No notifications yet</div>
        <div class="nc-empty-sub">Notifications from the device will appear here in real time</div>
      </div>`;
  }

  function hideEmptyState() {
    notificationsDiv.querySelector(".nc-empty")?.remove();
  }

  function sendCommand(command) {
    const user = auth.currentUser;
    if (!user || !currentDeviceId) return;
    push(ref(db, `users/${user.uid}/devices/${currentDeviceId}/commands`), command);
  }

  /* POPUP TOAST */
  const popup      = document.getElementById("popupNotification");
  const popupIcon  = document.getElementById("popupIcon");
  const popupApp   = popup.querySelector(".popup-app-name");
  const popupMsg   = popup.querySelector(".popup-message");
  const popupTime  = popup.querySelector(".popup-time");
  const popupClose = popup.querySelector(".popup-close");
  let   popupTimer = null;

  function showPopup(data) {
    if (popupTimer) clearTimeout(popupTimer);
    const src = toIconSrc(data.appIcon);
    popupIcon.src = src || placeholderIcon;
    popupIcon.onerror = () => { popupIcon.src = placeholderIcon; };
    popupApp.textContent = resolveAppName(data);
    let msg = data.text || "";
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      const last = data.messages[data.messages.length - 1];
      msg = (last.sender ? last.sender + ": " : "") + (last.text || "");
    }
    popupMsg.textContent = msg;
    popupTime.textContent = fmtTime(data.timestamp);
    popup.style.display = "flex";
    popupTimer = setTimeout(() => { popup.style.display = "none"; }, 5000);
    popupClose.onclick = e => {
      e.stopPropagation();
      clearTimeout(popupTimer);
      popup.style.display = "none";
    };
    if (!notificationPanel.classList.contains("notification-flex")) {
      notifCount++;
      updateBadge();
    }
  }

  /* MODAL */
  const modal      = document.getElementById("modalNotification");
  const modalIcon  = document.getElementById("modalIcon");
  const modalTitle = modal.querySelector(".modal-title");
  const modalText  = modal.querySelector(".modal-text");
  const modalTime  = modal.querySelector(".modal-time");
  const modalClose = modal.querySelector(".modal-close");

  function showModal(data) {
    const src = toIconSrc(data.largeIcon) || toIconSrc(data.appIcon);
    modalIcon.src = src || placeholderIcon;
    modalIcon.onerror = () => { modalIcon.src = placeholderIcon; };
    modalTitle.textContent = data.title || resolveAppName(data);
    let fullText = "";
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      fullText = data.messages
        .map(m => (m.sender ? m.sender + ":\n" : "") + (m.text || ""))
        .join("\n\n");
    } else if (Array.isArray(data.textLines) && data.textLines.length > 0) {
      fullText = data.textLines.join("\n");
    } else {
      fullText = data.bigText || data.text || "";
    }
    if (data.subText) fullText = "[" + data.subText + "]\n\n" + fullText;
    modalText.textContent = fullText;
    modalTime.textContent = new Date(data.timestamp).toLocaleString();
    modal.style.display = "flex";
  }

  modalClose.onclick = () => { modal.style.display = "none"; };
  modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });

  /* BUILD BODY */
  function buildBody(data) {
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      const rows = data.messages
        .slice(-12)
        .map(m => `
          <div class="nc-msg-item">
            ${m.sender ? `<span class="nc-msg-sender">${escHtml(m.sender)}</span>` : ""}
            <span class="nc-msg-text">${escHtml(m.text || "")}</span>
          </div>`).join("");
      return `<div class="nc-messages-wrap" data-msg-wrap="1">${rows}</div>`;
    }
    if (Array.isArray(data.textLines) && data.textLines.length > 0) {
      const rows = data.textLines.slice(0,6)
        .map(l => `<div class="nc-inbox-line">${escHtml(l)}</div>`).join("");
      return `<div class="nc-inbox-lines">${rows}</div>`;
    }
    const bodyText = data.bigText || data.text || "";
    return `
      <div class="nc-text-wrap">
        <div class="nc-text" data-full-text="${escHtml(bodyText)}">${escHtml(bodyText)}</div>
        <button class="nc-read-more" type="button">Read more</button>
      </div>`;
  }

  /* BUILD ACTIONS — text link style */
  function buildActions(actions, notifKey) {
    if (!actions || actions.length === 0) return "";
    const btns = actions.map(action => {
      const idx     = action.actionIndex ?? 0;
      const label   = action.title || "";
      const isReply = action.type === "reply" || action.hasRemoteInput;
      return `<button
        class="nc-action-btn${isReply ? " nc-reply-toggle" : ""}"
        data-notif-key="${escHtml(notifKey)}"
        data-action-index="${idx}"
        data-action-type="${isReply ? "reply" : "action"}"
        title="${escHtml(label)}">${escHtml(label)}</button>`;
    }).join("");

    const hasReply = actions.some(a => a.type === "reply" || a.hasRemoteInput);
    const replyBox = hasReply ? `
      <div class="nc-reply-box">
        <input class="nc-reply-input" type="text" placeholder="Enter a message…" maxlength="500">
        <button class="nc-reply-send" data-notif-key="${escHtml(notifKey)}" data-action-index="0" title="Send">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>` : "";

    return `<div class="nc-actions-row">${btns}</div>${replyBox}`;
  }

  /* CREATE CARD */
  function createNotification(snapshot) {
    const data       = snapshot.val();
    const historyKey = snapshot.key;
    const notifKey   = data.key || "";

    const appIconSrc   = toIconSrc(data.smallIcon);
    const largeIconSrc = toIconSrc(data.largeIcon);
    const appLabel     = resolveAppName(data);
    const time         = fmtTime(data.timestamp);
    const actions      = data.actions || [];
    const isMessaging  = Array.isArray(data.messages) && data.messages.length > 0;

    const card = document.createElement("div");
    card.className = "nc-card";
    card.dataset.key      = historyKey;
    card.dataset.notifKey = notifKey;

    card.innerHTML = `
      <div class="nc-header">
        <img class="nc-app-icon"
             src="${appIconSrc || placeholderIcon}"
             onerror="this.src='${placeholderIcon}'" alt="">
        <span class="nc-app-name">${escHtml(appLabel)}</span>
        <span class="nc-time">${time}</span>
        <button class="nc-dismiss" title="Dismiss">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6"  y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="nc-body">
        ${largeIconSrc && !isMessaging
          ? `<img class="nc-large-icon" src="${largeIconSrc}" onerror="this.style.display='none'" alt="">` : ""}
        <div class="nc-content">
          ${data.title   ? `<div class="nc-title">${escHtml(data.title)}</div>` : ""}
          ${data.subText ? `<div class="nc-subtext">${escHtml(data.subText)}</div>` : ""}
          ${buildBody(data)}
        </div>
      </div>

      ${actions.length > 0
        ? `<div class="nc-actions-wrap">${buildActions(actions, notifKey)}</div>` : ""}
    `;

    /* Auto-open reply box for messaging */
    if (isMessaging) {
      const box = card.querySelector(".nc-reply-box");
      if (box) box.style.display = "flex";
      card.querySelectorAll(".nc-reply-toggle").forEach(b => b.style.display = "none");
      requestAnimationFrame(() => {
        const wrap = card.querySelector(".nc-messages-wrap");
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      });
    }

    /* Read more */
    const ncText   = card.querySelector(".nc-text");
    const readMore = card.querySelector(".nc-read-more");
    if (ncText && readMore) {
      requestAnimationFrame(() => {
        if (ncText.scrollHeight > ncText.clientHeight + 4) {
          readMore.classList.add("visible");
        }
      });
      readMore.addEventListener("click", e => {
        e.stopPropagation();
        const expanded = ncText.classList.toggle("nc-expanded");
        readMore.textContent = expanded ? "Show less" : "Read more";
      });
    }

    /* Dismiss */
    card.querySelector(".nc-dismiss").addEventListener("click", e => {
      e.stopPropagation();
      if (notifKey) sendCommand({ type:"DISMISS", notif_key:notifKey });
      const user = auth.currentUser;
      if (user && currentDeviceId) {
        remove(ref(db, `users/${user.uid}/devices/${currentDeviceId}/notification/history/${historyKey}`));
      }
      card.classList.add("nc-slide-out");
      card.addEventListener("animationend", () => {
        card.remove();
        if (!notificationsDiv.querySelector(".nc-card")) showEmptyState();
      }, { once:true });
    });

    /* Body click → modal */
    card.querySelector(".nc-body").addEventListener("click", () => showModal(data));

    /* Reply toggle */
    card.querySelectorAll(".nc-reply-toggle").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const box = card.querySelector(".nc-reply-box");
        if (!box) return;
        const opening = box.style.display !== "flex";
        box.style.display = opening ? "flex" : "none";
        btn.classList.toggle("nc-btn-active", opening);
        if (opening) {
          const sendBtn = card.querySelector(".nc-reply-send");
          if (sendBtn) sendBtn.dataset.actionIndex = parseInt(btn.dataset.actionIndex) || 0;
          card.querySelector(".nc-reply-input")?.focus();
        }
      });
    });

    /* Reply send */
    const replyInput = card.querySelector(".nc-reply-input");
    const sendBtn    = card.querySelector(".nc-reply-send");

    function doSend() {
      const text = replyInput?.value?.trim();
      if (!text || !notifKey) return;
      const idx = parseInt(sendBtn?.dataset.actionIndex) || 0;
      sendCommand({ type:"REPLY", notif_key:notifKey, action_index:idx, text });
      replyInput.value = "";
      card.classList.add("nc-sent-pulse");
      card.addEventListener("animationend",
        () => card.classList.remove("nc-sent-pulse"), { once:true });
    }

    sendBtn?.addEventListener("click",   e => { e.stopPropagation(); doSend(); });
    replyInput?.addEventListener("keydown", e => { if (e.key==="Enter") doSend(); });

    /* Action buttons */
    card.querySelectorAll('.nc-action-btn[data-action-type="action"]').forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        sendCommand({ type:"ACTION", notif_key:btn.dataset.notifKey, action_index:parseInt(btn.dataset.actionIndex)||0 });
        btn.disabled = true;
        btn.textContent = "✓ Done";
        btn.classList.add("nc-btn-done");
      });
    });

    return card;
  }

  /* INIT NOTIFICATIONS */
  function initNotifications(userUid, deviceId) {
    notificationsDiv.innerHTML = "";
    showEmptyState();
    notifCount = 0;
    updateBadge();

    const refHistory = ref(db, `users/${userUid}/devices/${deviceId}/notification/history`);
    const refLive    = ref(db, `users/${userUid}/devices/${deviceId}/notification/live`);

    onChildAdded(refHistory, snap => {
      hideEmptyState();
      notificationsDiv.prepend(createNotification(snap));
    });

    onChildRemoved(refHistory, snap => {
      notificationsDiv.querySelector(`[data-key="${snap.key}"]`)?.remove();
      if (!notificationsDiv.querySelector(".nc-card")) showEmptyState();
    });

    const seenLiveKeys = new Set();
    get(refLive)
      .then(snap => {
        snap.forEach(child => seenLiveKeys.add(child.key));
        attachLiveListener();
      })
      .catch(() => attachLiveListener());

    function attachLiveListener() {
      onChildAdded(refLive, snap => {
        if (seenLiveKeys.has(snap.key)) return;
        seenLiveKeys.add(snap.key);
        showPopup(snap.val());
      });
    }
  }

  

  /* LOAD DEVICE */
function loadActiveDevice(userUid) {
    const storeRef = ref(db, `users/${userUid}/storeId`);
    onValue(storeRef, async snapshot => {
      let deviceId = snapshot.val();
      if (!deviceId) {
        try {
          const devSnap = await get(query(ref(db, `users/${userUid}/devices`), limitToFirst(1)));
          if (!devSnap.exists()) { loadPage("installApp"); hideLoadingSpinner(); return; }
          devSnap.forEach(child => { deviceId = child.key; });
          await set(ref(db, `users/${userUid}/storeId`), deviceId);
          loadPage("home");
        } catch(err) { console.error(err); hideLoadingSpinner(); return; }
      }
      if (currentDeviceId && currentDeviceId !== deviceId) {
        currentDeviceId = deviceId;
        loadPage(window.currentPage);
        initNotifications(userUid, deviceId);
        // ✅ ADD HERE
        onValue(ref(db, `users/${userUid}/devices/${deviceId}/wallpaper/wallpaper/base64`), snap => {
          const base64 = snap.val();
          if (base64) document.documentElement.style.setProperty('--wallpaper-bg', `url('${base64}')`);
        });
        hideLoadingSpinner(); return;
      }
      currentDeviceId = deviceId;
      initNotifications(userUid, deviceId);
      // ✅ ADD HERE
      onValue(ref(db, `users/${userUid}/devices/${deviceId}/wallpaper/wallpaper/base64`), snap => {
        const base64 = snap.val();
        if (base64) document.documentElement.style.setProperty('--wallpaper-bg', `url('${base64}')`);
      });
      hideLoadingSpinner();
    });
}

  /* AUTH */
  showLoadingSpinner();
  onAuthStateChanged(auth, user => {
    if (!user) return (location.href = "index.html");
    loadActiveDevice(user.uid);
  });

  /* CLEAR ALL */
  clearAllBtn.onclick = () => {
    const user = auth.currentUser;
    if (!user || !currentDeviceId) { alert("No device selected."); return; }
    sendCommand({ type:"DISMISS_ALL" });
    remove(ref(db, `users/${user.uid}/devices/${currentDeviceId}/notification`));
    notificationsDiv.innerHTML = "";
    showEmptyState();
    notifCount = 0;
    updateBadge();
  };

  window.setActiveSidebar = setActiveSidebar;
});

function showLoadingSpinner() {
  document.getElementById("loadingSpinner").style.display = "flex";
}
function hideLoadingSpinner() {
  document.getElementById("loadingSpinner").style.display = "none";
}










//   import { db, auth } from "../api/firebase.js";
// import {
//   ref, remove, onValue, onChildAdded, onChildRemoved,
//   get, set, push, query, limitToFirst
// } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
// import {
//   onAuthStateChanged
// } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// let currentDeviceId = null;

// document.addEventListener("DOMContentLoaded", () => {

//   const sidebar           = document.getElementById("sidebar");
//   const sidebarToggle     = document.getElementById("sidebar-toggle");
//   const navbarToggle      = document.getElementById("navbar-toggle");
//   const marginSide        = document.querySelector(".marginSideInput");
//   const sidebarMenu       = document.getElementById("sidebar-menu");
//   const flyoutLabel       = document.getElementById("flyout-label");
//   const menuItems         = document.querySelectorAll("#sidebar-menu li[data-page]");
//   const notifyBtn         = document.querySelector(".notify-btn");
//   const notificationPanel = document.getElementById("notificationPanel");
//   const notificationsDiv  = document.getElementById("notifications");
//   const clearAllBtn       = document.getElementById("clearAllBtn");
//   const notifBadge        = document.getElementById("notifBadge");

//   let notifCount = 0;

//   // sidebar.classList.add("icon-mode");

//   function setActiveSidebar(page) {
//     menuItems.forEach(li =>
//       li.classList.toggle("active", li.dataset.page === page)
//     );
//   }

//   const openSidebar = () => {
//     sidebar.classList.add("show");
//     document.body.classList.add("sidebar-open");
//   };
//   const closeSidebar = () => {
//     sidebar.classList.remove("show");
//     document.body.classList.remove("sidebar-open");
//   };
//   const toggleSidebarMobile = () => {
//     if (window.innerWidth <= 768) {
//       sidebar.classList.contains("show") ? closeSidebar() : openSidebar();
//     } else {
//       sidebar.classList.add("icon-mode");
//       navbarToggle.classList.add("navbar-toggle-none");
//       marginSide?.classList.add("margin-side");
//     }
//   };
  

//   navbarToggle?.addEventListener("click", toggleSidebarMobile);
//   sidebarToggle?.addEventListener("click", () => {
//     sidebar.classList.remove("icon-mode");
//     navbarToggle.classList.remove("navbar-toggle-none");
//     marginSide?.classList.remove("margin-side");
//   });
//   sidebarMenu?.addEventListener("click", (e) => {
//     const li = e.target.closest("li[data-page]");
//     if (!li) return;
//     if (window.innerWidth <= 768) closeSidebar();
//   });

//   let lastMode = window.innerWidth <= 768 ? "mobile" : "desktop";
//   window.addEventListener("resize", () => {
//     const currentMode = window.innerWidth <= 768 ? "mobile" : "desktop";
//     if (currentMode !== lastMode) { lastMode = currentMode; window.location.reload(); }
//     if (window.innerWidth > 768) closeSidebar();
//   });

//   document.addEventListener("click", (e) => {
//     if (window.innerWidth > 768) return;
//     if (!sidebar.classList.contains("show")) return;
//     if (!sidebar.contains(e.target) && !(navbarToggle && navbarToggle.contains(e.target))) {
//       closeSidebar();
//     }
//   });

//   menuItems.forEach(item => {
//     item.addEventListener("mouseenter", () => {
//       if (!sidebar.classList.contains("icon-mode")) return;
//       const text = item.querySelector("span")?.textContent || "";
//       flyoutLabel.textContent = text;
//       flyoutLabel.style.top = `${item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2 - 18}px`;
//       flyoutLabel.classList.add("visible");
//     });
//     item.addEventListener("mouseleave", () => flyoutLabel.classList.remove("visible"));
//   });

//   notifyBtn?.addEventListener("click", () => {
//     notificationPanel.classList.toggle("notification-flex");
//     if (notificationPanel.classList.contains("notification-flex")) {
//       notifCount = 0;
//       updateBadge();
//     }
//     if (window.innerWidth <= 768) {
//       document.body.style.overflow =
//         notificationPanel.classList.contains("notification-flex") ? "hidden" : "";
//     }
//   });

//   function updateBadge() {
//     if (notifCount > 0) {
//       notifBadge.style.display = "inline-flex";
//       notifBadge.textContent = notifCount > 99 ? "99+" : notifCount;
//     } else {
//       notifBadge.style.display = "none";
//     }
//   }

//   const placeholderIcon =
//     "data:image/svg+xml;utf8," + encodeURIComponent(
//       `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
//         <rect width="100%" height="100%" fill="#1e293b" rx="6"/>
//         <text x="50%" y="55%" font-size="28" fill="#475569"
//           text-anchor="middle" dy=".15em" font-family="sans-serif">?</text>
//       </svg>`
//     );

//   function escHtml(str) {
//     if (!str) return "";
//     return String(str)
//       .replace(/&/g,"&amp;").replace(/</g,"&lt;")
//       .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
//   }

//   function fmtTime(ts) {
//     return new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
//   }

//   function toIconSrc(b64) {
//     if (!b64 || typeof b64 !== "string" || b64.length < 20) return null;
//     if (b64.startsWith("data:")) return b64;
//     return "data:image/png;base64," + b64.replace(/\s/g,"");
//   }

//   const PKG_NAMES = {
//     "com.whatsapp":                        "WhatsApp",
//     "com.whatsapp.w4b":                    "WhatsApp Business",
//     "com.google.android.gm":              "Gmail",
//     "com.android.chrome":                 "Chrome",
//     "com.instagram.android":             "Instagram",
//     "com.facebook.katana":                "Facebook",
//     "com.twitter.android":                "X (Twitter)",
//     "org.telegram.messenger":            "Telegram",
//     "com.snapchat.android":              "Snapchat",
//     "com.android.mms":                   "Messages",
//     "com.google.android.apps.messaging": "Messages",
//     "com.microsoft.teams":               "Teams",
//     "com.netflix.mediaclient":           "Netflix",
//     "com.amazon.mShop.android.shopping": "Amazon",
//     "com.google.android.youtube":        "YouTube",
//   };

//   function resolveAppName(data) {
//     return data.appName
//       || PKG_NAMES[data.packageName]
//       || (data.packageName ? data.packageName.split(".").pop() : "Unknown");
//   }

//   function showEmptyState() {
//     if (notificationsDiv.querySelector(".nc-empty")) return;
//     notificationsDiv.innerHTML = `
//       <div class="nc-empty">
//         <div class="nc-empty-icon">
//           <i class="fa-regular fa-bell-slash"></i>
//         </div>
//         <div class="nc-empty-title">No notifications yet</div>
//         <div class="nc-empty-sub">Notifications from the device will appear here in real time</div>
//       </div>`;
//   }

//   function hideEmptyState() {
//     notificationsDiv.querySelector(".nc-empty")?.remove();
//   }

//   function sendCommand(command) {
//     const user = auth.currentUser;
//     if (!user || !currentDeviceId) return;
//     push(ref(db, `users/${user.uid}/devices/${currentDeviceId}/commands`), command);
//   }

//   /* POPUP TOAST */
//   const popup      = document.getElementById("popupNotification");
//   const popupIcon  = document.getElementById("popupIcon");
//   const popupApp   = popup.querySelector(".popup-app-name");
//   const popupMsg   = popup.querySelector(".popup-message");
//   const popupTime  = popup.querySelector(".popup-time");
//   const popupClose = popup.querySelector(".popup-close");
//   let   popupTimer = null;

//   function showPopup(data) {
//     if (popupTimer) clearTimeout(popupTimer);
//     const src = toIconSrc(data.appIcon);
//     popupIcon.src = src || placeholderIcon;
//     popupIcon.onerror = () => { popupIcon.src = placeholderIcon; };
//     popupApp.textContent = resolveAppName(data);
//     let msg = data.text || "";
//     if (Array.isArray(data.messages) && data.messages.length > 0) {
//       const last = data.messages[data.messages.length - 1];
//       msg = (last.sender ? last.sender + ": " : "") + (last.text || "");
//     }
//     popupMsg.textContent = msg;
//     popupTime.textContent = fmtTime(data.timestamp);
//     popup.style.display = "flex";
//     popupTimer = setTimeout(() => { popup.style.display = "none"; }, 5000);
//     popupClose.onclick = e => {
//       e.stopPropagation();
//       clearTimeout(popupTimer);
//       popup.style.display = "none";
//     };
//     if (!notificationPanel.classList.contains("notification-flex")) {
//       notifCount++;
//       updateBadge();
//     }
//   }

//   /* MODAL */
//   const modal      = document.getElementById("modalNotification");
//   const modalIcon  = document.getElementById("modalIcon");
//   const modalTitle = modal.querySelector(".modal-title");
//   const modalText  = modal.querySelector(".modal-text");
//   const modalTime  = modal.querySelector(".modal-time");
//   const modalClose = modal.querySelector(".modal-close");

//   function showModal(data) {
//     const src = toIconSrc(data.largeIcon) || toIconSrc(data.appIcon);
//     modalIcon.src = src || placeholderIcon;
//     modalIcon.onerror = () => { modalIcon.src = placeholderIcon; };
//     modalTitle.textContent = data.title || resolveAppName(data);
//     let fullText = "";
//     if (Array.isArray(data.messages) && data.messages.length > 0) {
//       fullText = data.messages
//         .map(m => (m.sender ? m.sender + ":\n" : "") + (m.text || ""))
//         .join("\n\n");
//     } else if (Array.isArray(data.textLines) && data.textLines.length > 0) {
//       fullText = data.textLines.join("\n");
//     } else {
//       fullText = data.bigText || data.text || "";
//     }
//     if (data.subText) fullText = "[" + data.subText + "]\n\n" + fullText;
//     modalText.textContent = fullText;
//     modalTime.textContent = new Date(data.timestamp).toLocaleString();
//     modal.style.display = "flex";
//   }

//   modalClose.onclick = () => { modal.style.display = "none"; };
//   modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });

//   /* BUILD BODY */
//   function buildBody(data) {
//     if (Array.isArray(data.messages) && data.messages.length > 0) {
//       const rows = data.messages
//         .slice(-12)
//         .map(m => `
//           <div class="nc-msg-item">
//             ${m.sender ? `<span class="nc-msg-sender">${escHtml(m.sender)}</span>` : ""}
//             <span class="nc-msg-text">${escHtml(m.text || "")}</span>
//           </div>`).join("");
//       return `<div class="nc-messages-wrap" data-msg-wrap="1">${rows}</div>`;
//     }
//     if (Array.isArray(data.textLines) && data.textLines.length > 0) {
//       const rows = data.textLines.slice(0,6)
//         .map(l => `<div class="nc-inbox-line">${escHtml(l)}</div>`).join("");
//       return `<div class="nc-inbox-lines">${rows}</div>`;
//     }
//     const bodyText = data.bigText || data.text || "";
//     return `
//       <div class="nc-text-wrap">
//         <div class="nc-text" data-full-text="${escHtml(bodyText)}">${escHtml(bodyText)}</div>
//         <button class="nc-read-more" type="button">Read more</button>
//       </div>`;
//   }

//   /* BUILD ACTIONS — text link style */
//   function buildActions(actions, notifKey) {
//     if (!actions || actions.length === 0) return "";
//     const btns = actions.map(action => {
//       const idx     = action.actionIndex ?? 0;
//       const label   = action.title || "";
//       const isReply = action.type === "reply" || action.hasRemoteInput;
//       return `<button
//         class="nc-action-btn${isReply ? " nc-reply-toggle" : ""}"
//         data-notif-key="${escHtml(notifKey)}"
//         data-action-index="${idx}"
//         data-action-type="${isReply ? "reply" : "action"}"
//         title="${escHtml(label)}">${escHtml(label)}</button>`;
//     }).join("");

//     const hasReply = actions.some(a => a.type === "reply" || a.hasRemoteInput);
//     const replyBox = hasReply ? `
//       <div class="nc-reply-box">
//         <input class="nc-reply-input" type="text" placeholder="Enter a message…" maxlength="500">
//         <button class="nc-reply-send" data-notif-key="${escHtml(notifKey)}" data-action-index="0" title="Send">
//           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
//             <line x1="22" y1="2" x2="11" y2="13"/>
//             <polygon points="22 2 15 22 11 13 2 9 22 2"/>
//           </svg>
//         </button>
//       </div>` : "";

//     return `<div class="nc-actions-row">${btns}</div>${replyBox}`;
//   }

//   /* CREATE CARD */
//   function createNotification(snapshot) {
//     const data       = snapshot.val();
//     const historyKey = snapshot.key;
//     const notifKey   = data.key || "";

//     const appIconSrc   = toIconSrc(data.smallIcon);
//     const largeIconSrc = toIconSrc(data.largeIcon);
//     const appLabel     = resolveAppName(data);
//     const time         = fmtTime(data.timestamp);
//     const actions      = data.actions || [];
//     const isMessaging  = Array.isArray(data.messages) && data.messages.length > 0;

//     const card = document.createElement("div");
//     card.className = "nc-card";
//     card.dataset.key      = historyKey;
//     card.dataset.notifKey = notifKey;

//     card.innerHTML = `
//       <div class="nc-header">
//         <img class="nc-app-icon"
//              src="${appIconSrc || placeholderIcon}"
//              onerror="this.src='${placeholderIcon}'" alt="">
//         <span class="nc-app-name">${escHtml(appLabel)}</span>
//         <span class="nc-time">${time}</span>
//         <button class="nc-dismiss" title="Dismiss">
//           <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
//             <line x1="18" y1="6" x2="6" y2="18"/>
//             <line x1="6"  y1="6" x2="18" y2="18"/>
//           </svg>
//         </button>
//       </div>

//       <div class="nc-body">
//         ${largeIconSrc && !isMessaging
//           ? `<img class="nc-large-icon" src="${largeIconSrc}" onerror="this.style.display='none'" alt="">` : ""}
//         <div class="nc-content">
//           ${data.title   ? `<div class="nc-title">${escHtml(data.title)}</div>` : ""}
//           ${data.subText ? `<div class="nc-subtext">${escHtml(data.subText)}</div>` : ""}
//           ${buildBody(data)}
//         </div>
//       </div>

//       ${actions.length > 0
//         ? `<div class="nc-actions-wrap">${buildActions(actions, notifKey)}</div>` : ""}
//     `;

//     /* Auto-open reply box for messaging */
//     if (isMessaging) {
//       const box = card.querySelector(".nc-reply-box");
//       if (box) box.style.display = "flex";
//       card.querySelectorAll(".nc-reply-toggle").forEach(b => b.style.display = "none");
//       requestAnimationFrame(() => {
//         const wrap = card.querySelector(".nc-messages-wrap");
//         if (wrap) wrap.scrollTop = wrap.scrollHeight;
//       });
//     }

//     /* Read more */
//     const ncText   = card.querySelector(".nc-text");
//     const readMore = card.querySelector(".nc-read-more");
//     if (ncText && readMore) {
//       requestAnimationFrame(() => {
//         if (ncText.scrollHeight > ncText.clientHeight + 4) {
//           readMore.classList.add("visible");
//         }
//       });
//       readMore.addEventListener("click", e => {
//         e.stopPropagation();
//         const expanded = ncText.classList.toggle("nc-expanded");
//         readMore.textContent = expanded ? "Show less" : "Read more";
//       });
//     }

//     /* Dismiss */
//     card.querySelector(".nc-dismiss").addEventListener("click", e => {
//       e.stopPropagation();
//       if (notifKey) sendCommand({ type:"DISMISS", notif_key:notifKey });
//       const user = auth.currentUser;
//       if (user && currentDeviceId) {
//         remove(ref(db, `users/${user.uid}/devices/${currentDeviceId}/notification/history/${historyKey}`));
//       }
//       card.classList.add("nc-slide-out");
//       card.addEventListener("animationend", () => {
//         card.remove();
//         if (!notificationsDiv.querySelector(".nc-card")) showEmptyState();
//       }, { once:true });
//     });

//     /* Body click → modal */
//     card.querySelector(".nc-body").addEventListener("click", () => showModal(data));

//     /* Reply toggle */
//     card.querySelectorAll(".nc-reply-toggle").forEach(btn => {
//       btn.addEventListener("click", e => {
//         e.stopPropagation();
//         const box = card.querySelector(".nc-reply-box");
//         if (!box) return;
//         const opening = box.style.display !== "flex";
//         box.style.display = opening ? "flex" : "none";
//         btn.classList.toggle("nc-btn-active", opening);
//         if (opening) {
//           const sendBtn = card.querySelector(".nc-reply-send");
//           if (sendBtn) sendBtn.dataset.actionIndex = parseInt(btn.dataset.actionIndex) || 0;
//           card.querySelector(".nc-reply-input")?.focus();
//         }
//       });
//     });

//     /* Reply send */
//     const replyInput = card.querySelector(".nc-reply-input");
//     const sendBtn    = card.querySelector(".nc-reply-send");

//     function doSend() {
//       const text = replyInput?.value?.trim();
//       if (!text || !notifKey) return;
//       const idx = parseInt(sendBtn?.dataset.actionIndex) || 0;
//       sendCommand({ type:"REPLY", notif_key:notifKey, action_index:idx, text });
//       replyInput.value = "";
//       card.classList.add("nc-sent-pulse");
//       card.addEventListener("animationend",
//         () => card.classList.remove("nc-sent-pulse"), { once:true });
//     }

//     sendBtn?.addEventListener("click",   e => { e.stopPropagation(); doSend(); });
//     replyInput?.addEventListener("keydown", e => { if (e.key==="Enter") doSend(); });

//     /* Action buttons */
//     card.querySelectorAll('.nc-action-btn[data-action-type="action"]').forEach(btn => {
//       btn.addEventListener("click", e => {
//         e.stopPropagation();
//         sendCommand({ type:"ACTION", notif_key:btn.dataset.notifKey, action_index:parseInt(btn.dataset.actionIndex)||0 });
//         btn.disabled = true;
//         btn.textContent = "✓ Done";
//         btn.classList.add("nc-btn-done");
//       });
//     });

//     return card;
//   }

//   /* INIT NOTIFICATIONS */
//   function initNotifications(userUid, deviceId) {
//     notificationsDiv.innerHTML = "";
//     showEmptyState();
//     notifCount = 0;
//     updateBadge();

//     const refHistory = ref(db, `users/${userUid}/devices/${deviceId}/notification/history`);
//     const refLive    = ref(db, `users/${userUid}/devices/${deviceId}/notification/live`);

//     onChildAdded(refHistory, snap => {
//       hideEmptyState();
//       notificationsDiv.prepend(createNotification(snap));
//     });

//     onChildRemoved(refHistory, snap => {
//       notificationsDiv.querySelector(`[data-key="${snap.key}"]`)?.remove();
//       if (!notificationsDiv.querySelector(".nc-card")) showEmptyState();
//     });

//     const seenLiveKeys = new Set();
//     get(refLive)
//       .then(snap => {
//         snap.forEach(child => seenLiveKeys.add(child.key));
//         attachLiveListener();
//       })
//       .catch(() => attachLiveListener());

//     function attachLiveListener() {
//       onChildAdded(refLive, snap => {
//         if (seenLiveKeys.has(snap.key)) return;
//         seenLiveKeys.add(snap.key);
//         showPopup(snap.val());
//       });
//     }
//   }

  

//   /* LOAD DEVICE */
// function loadActiveDevice(userUid) {
//     const storeRef = ref(db, `users/${userUid}/storeId`);
//     onValue(storeRef, async snapshot => {
//       let deviceId = snapshot.val();
//       if (!deviceId) {
//         try {
//           const devSnap = await get(query(ref(db, `users/${userUid}/devices`), limitToFirst(1)));
//           if (!devSnap.exists()) { loadPage("installApp"); hideLoadingSpinner(); return; }
//           devSnap.forEach(child => { deviceId = child.key; });
//           await set(ref(db, `users/${userUid}/storeId`), deviceId);
//           loadPage("home");
//         } catch(err) { console.error(err); hideLoadingSpinner(); return; }
//       }
//       if (currentDeviceId && currentDeviceId !== deviceId) {
//         currentDeviceId = deviceId;
//         loadPage(window.currentPage);
//         initNotifications(userUid, deviceId);
//         // ✅ ADD HERE
//         onValue(ref(db, `users/${userUid}/devices/${deviceId}/wallpaper/wallpaper/base64`), snap => {
//           const base64 = snap.val();
//           if (base64) document.documentElement.style.setProperty('--wallpaper-bg', `url('${base64}')`);
//         });
//         hideLoadingSpinner(); return;
//       }
//       currentDeviceId = deviceId;
//       initNotifications(userUid, deviceId);
//       // ✅ ADD HERE
//       onValue(ref(db, `users/${userUid}/devices/${deviceId}/wallpaper/wallpaper/base64`), snap => {
//         const base64 = snap.val();
//         if (base64) document.documentElement.style.setProperty('--wallpaper-bg', `url('${base64}')`);
//       });
//       hideLoadingSpinner();
//     });
// }

//   /* AUTH */
//   showLoadingSpinner();
//   onAuthStateChanged(auth, user => {
//     if (!user) return (location.href = "index.html");
//     loadActiveDevice(user.uid);
//   });

//   /* CLEAR ALL */
//   clearAllBtn.onclick = () => {
//     const user = auth.currentUser;
//     if (!user || !currentDeviceId) { alert("No device selected."); return; }
//     sendCommand({ type:"DISMISS_ALL" });
//     remove(ref(db, `users/${user.uid}/devices/${currentDeviceId}/notification`));
//     notificationsDiv.innerHTML = "";
//     showEmptyState();
//     notifCount = 0;
//     updateBadge();
//   };

//   window.setActiveSidebar = setActiveSidebar;
// });

// function showLoadingSpinner() {
//   document.getElementById("loadingSpinner").style.display = "flex";
// }
// function hideLoadingSpinner() {
//   document.getElementById("loadingSpinner").style.display = "none";
// }













