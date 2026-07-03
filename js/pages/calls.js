import { db, auth } from "../api/firebase.js";
import { ref, get, onValue, push } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ---------- DOM ----------
const timelineWrap   = document.getElementById("timelineWrap");
const loadingState    = document.getElementById("loadingState");
const rangeLabel      = document.getElementById("rangeLabel");
const searchInput     = document.getElementById("searchInput");
const filterChips     = document.getElementById("filterChips");
const selectAll       = document.getElementById("selectAll");
const deleteBtn       = document.getElementById("deleteBtn");
const purgeCount      = document.getElementById("purgeCount");
const loadMoreBtn     = document.getElementById("loadMoreBtn");
const footCount       = document.getElementById("footCount");

const statTotal    = document.getElementById("statTotal");
const statIncoming = document.getElementById("statIncoming");
const statOutgoing = document.getElementById("statOutgoing");
const statMissed   = document.getElementById("statMissed");
const statDuration = document.getElementById("statDuration");

const drawerOverlay = document.getElementById("drawerOverlay");
const detailDrawer  = document.getElementById("detailDrawer");
const drawerBody    = document.getElementById("drawerBody");
const closeDrawer   = document.getElementById("closeDrawer");

const toast     = document.getElementById("toast");
const toastText = document.getElementById("toastText");

// ---------- State ----------
let originalCalls = [];   // raw, oldest -> newest (firebase push order)
let filteredCalls = [];   // newest -> oldest, after search/filter
let activeFilter = "ALL";
let visibleDayCount = 5;  // how many day-groups are rendered at a time
const DAY_PAGE = 5;

let currentUid = null;
let deviceId = null;

// ---------- Firebase command ----------
async function sendDeleteCommand(numbers) {
  if (!currentUid || !deviceId) return 0;
  const commandsRef = ref(db, `users/${currentUid}/devices/${deviceId}/data/commands`);
  const targets = [...new Set(numbers)].filter(Boolean);
  for (const target of targets) {
    await push(commandsRef, { action: "delete_call", target });
  }
  return targets.length;
}

// ---------- Helpers ----------
function typeClass(type) {
  if (type === "INCOMING") return "incoming";
  if (type === "MISSED") return "missed";
  return "outgoing";
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(sec) {
  sec = sec || 0;
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function dayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.toDateString();
}

function dayLabel(ts) {
  const d = new Date(ts || Date.now());
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function initials(name) {
  if (!name || name === "Unknown") return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join("").toUpperCase();
}

function groupByDay(calls) {
  const groups = [];
  const map = new Map();
  calls.forEach(call => {
    const key = dayKey(call.timestamp);
    if (!map.has(key)) {
      const group = { key, label: dayLabel(call.timestamp), calls: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).calls.push(call);
  });
  return groups;
}

// ---------- Stats ----------
function renderStats(calls) {
  const incoming = calls.filter(c => c.type === "INCOMING").length;
  const outgoing = calls.filter(c => c.type === "OUTGOING").length;
  const missed   = calls.filter(c => c.type === "MISSED").length;
  const totalSec = calls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);

  statTotal.textContent = calls.length.toLocaleString();
  statIncoming.textContent = incoming.toLocaleString();
  statOutgoing.textContent = outgoing.toLocaleString();
  statMissed.textContent = missed.toLocaleString();
  statDuration.textContent = totalSec >= 3600
    ? `${Math.round(totalSec / 3600)}h`
    : `${Math.round(totalSec / 60)}m`;
}

// ---------- Render ----------
function renderTimeline() {
  const groups = groupByDay(filteredCalls);
  const visibleGroups = groups.slice(0, visibleDayCount);

  timelineWrap.innerHTML = "";

  if (filteredCalls.length === 0) {
    timelineWrap.innerHTML = `
      <div class="no-results">
        <i class="fa-solid fa-satellite-dish"></i>
        <p>No calls match your search.</p>
      </div>`;
    loadMoreBtn.hidden = true;
    footCount.textContent = "";
    return;
  }

  visibleGroups.forEach(group => {
    const totalSecForDay = group.calls.reduce((s, c) => s + (c.durationSeconds || 0), 0);
    const maxDur = Math.max(...group.calls.map(c => c.durationSeconds || 0), 1);

    const dayEl = document.createElement("div");
    dayEl.className = "day-group";
    dayEl.innerHTML = `
      <div class="day-heading">
        <span class="day-name">${group.label}</span>
        <span class="day-rule"></span>
        <span class="day-sub">${group.calls.length} call${group.calls.length === 1 ? "" : "s"} · ${fmtDuration(totalSecForDay)}</span>
      </div>
      <div class="day-rail"></div>
    `;
    const rail = dayEl.querySelector(".day-rail");

    group.calls.forEach(call => {
      const cls = typeClass(call.type);
      const dur = call.durationSeconds || 0;
      const pct = Math.max(6, Math.round((dur / maxDur) * 100));
      const row = document.createElement("div");
      row.className = "call-row";
      row.dataset.path = call._path;
      row.innerHTML = `
        <label class="row-tick">
          <input type="checkbox" data-id="${call._path}" data-number="${call.number || ''}" data-name="${call.contactName || ''}">
          <span class="tick-dot ${cls}"></span>
        </label>
        <div class="row-main" data-call='${JSON.stringify(call).replace(/'/g, "&#39;")}'>
          <span class="row-name">${call.contactName || "Unknown"}</span>
          <span class="row-meta">
            <span class="num">${call.number || "—"}</span>
            <span class="type-tag ${cls}">${call.type || "—"}</span>
          </span>
        </div>
        <div class="row-right">
          <div class="duration-bar-wrap">
            <span class="duration-num">${fmtDuration(dur)}</span>
            <span class="duration-bar-track"><span class="duration-bar-fill ${cls}" style="width:${pct}%"></span></span>
          </div>
          <span class="row-time">${fmtTime(call.timestamp)}</span>
          <button class="row-del" data-number="${call.number || ''}" data-name="${call.contactName || ''}" title="Delete this call">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
      rail.appendChild(row);
    });

    timelineWrap.appendChild(dayEl);
  });

  loadMoreBtn.hidden = groups.length <= visibleDayCount;
  footCount.textContent = `${filteredCalls.length.toLocaleString()} total call${filteredCalls.length === 1 ? "" : "s"}`;

  bindRowEvents();
  updatePurgeButton();
}

function bindRowEvents() {
  document.querySelectorAll(".row-main").forEach(el => {
    el.onclick = () => {
      const call = JSON.parse(el.dataset.call.replace(/&#39;/g, "'"));
      openDrawer(call);
    };
  });

  document.querySelectorAll(".row-del").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { number, name } = btn.dataset;
      if (!number && !name) return;
      btn.disabled = true;
      try {
        await sendDeleteCommand([number || name]);
        showToast("Delete command sent");
      } catch (err) {
        console.error(err);
        showToast("Failed to send delete command");
      } finally {
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
    cb.onchange = () => {
      cb.closest(".call-row").classList.toggle("checked", cb.checked);
      updatePurgeButton();
    };
  });
}

function updatePurgeButton() {
  const checked = document.querySelectorAll('input[type="checkbox"][data-id]:checked');
  deleteBtn.disabled = checked.length === 0;
  purgeCount.textContent = checked.length;
}

// ---------- Drawer ----------
function openDrawer(call) {
  const cls = typeClass(call.type);
  drawerBody.innerHTML = `
    <div class="drawer-avatar">${initials(call.contactName)}</div>
    <div class="drawer-name">${call.contactName || "Unknown"}</div>
    <div class="drawer-number">${call.number || "N/A"}</div>

    <div class="drawer-field">
      <span class="drawer-field-label">Type</span>
      <span class="drawer-field-value type-tag ${cls}" style="padding:3px 9px;border-radius:5px;">${call.type || "—"}</span>
    </div>
    <div class="drawer-field">
      <span class="drawer-field-label">Duration</span>
      <span class="drawer-field-value">${fmtDuration(call.durationSeconds || 0)}</span>
    </div>
    <div class="drawer-field">
      <span class="drawer-field-label">Date &amp; time</span>
      <span class="drawer-field-value">${new Date(call.timestamp || Date.now()).toLocaleString()}</span>
    </div>

    <button class="drawer-del-btn" id="drawerDeleteBtn">Delete this call</button>
  `;

  document.getElementById("drawerDeleteBtn").onclick = async () => {
    const btn = document.getElementById("drawerDeleteBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await sendDeleteCommand([call.number || call.contactName]);
      showToast("Delete command sent");
      closeDrawerFn();
    } catch (err) {
      console.error(err);
      showToast("Failed to send delete command");
    } finally {
      btn.disabled = false;
      btn.textContent = "Delete this call";
    }
  };

  drawerOverlay.classList.add("active");
  detailDrawer.classList.add("active");
}

function closeDrawerFn() {
  drawerOverlay.classList.remove("active");
  detailDrawer.classList.remove("active");
}
drawerOverlay.onclick = closeDrawerFn;
closeDrawer.onclick = closeDrawerFn;

// ---------- Toast ----------
function showToast(msg) {
  toastText.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

// ---------- Search & filter ----------
function applyFilters() {
  const q = searchInput.value.toLowerCase().trim();
  filteredCalls = [...originalCalls].reverse().filter(call => {
    const matchesFilter = activeFilter === "ALL" || call.type === activeFilter;
    const matchesSearch = q === "" || JSON.stringify(call).toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });
  visibleDayCount = DAY_PAGE;
  renderTimeline();
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
searchInput.oninput = debounce(applyFilters, 200);

filterChips.querySelectorAll(".chip").forEach(chip => {
  chip.onclick = () => {
    filterChips.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    applyFilters();
  };
});

loadMoreBtn.onclick = () => {
  visibleDayCount += DAY_PAGE;
  renderTimeline();
};

selectAll.onchange = (e) => {
  document.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
    cb.checked = e.target.checked;
    cb.closest(".call-row").classList.toggle("checked", cb.checked);
  });
  updatePurgeButton();
};

deleteBtn.onclick = async () => {
  const checked = document.querySelectorAll('input[type="checkbox"][data-id]:checked');
  if (checked.length === 0) return;
  deleteBtn.disabled = true;
  const label = deleteBtn.querySelector("span");
  const originalLabel = label.textContent;
  label.textContent = "Sending…";

  try {
    const targets = [...checked].map(cb => cb.dataset.number || cb.dataset.name).filter(Boolean);
    const count = targets.length ? await sendDeleteCommand(targets) : 0;
    if (count > 0) {
      showToast(`Purge command sent for ${count} call${count === 1 ? "" : "s"}`);
      document.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => cb.checked = false);
      selectAll.checked = false;
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to send purge command");
  } finally {
    label.textContent = originalLabel;
    updatePurgeButton();
  }
};

// ---------- Auth + data load ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loadingState.innerHTML = `<p>Please sign in to view call history.</p>`;
    rangeLabel.textContent = "Not signed in";
    return;
  }

  currentUid = user.uid;
  const snap = await get(ref(db, `users/${currentUid}/storeId`));
  deviceId = snap.val();

  if (!deviceId) {
    loadingState.innerHTML = `<p>No device selected. Go to Settings.</p>`;
    rangeLabel.textContent = "No device linked";
    return;
  }

  onValue(ref(db, `users/${currentUid}/devices/${deviceId}/data/calls`), (snapshot) => {
    originalCalls = [];
    snapshot.forEach(child => {
      originalCalls.push({
        ...child.val(),
        _path: `users/${currentUid}/devices/${deviceId}/data/calls/${child.key}`
      });
    });

    renderStats(originalCalls);

    if (originalCalls.length) {
      const newest = originalCalls[originalCalls.length - 1].timestamp;
      const oldest = originalCalls[0].timestamp;
      rangeLabel.textContent = `${new Date(oldest).toLocaleDateString()} — ${new Date(newest).toLocaleDateString()}`;
    } else {
      rangeLabel.textContent = "No calls recorded";
    }

    applyFilters();
  });

  onValue(ref(db, `users/${currentUid}/devices/${deviceId}/data/commands/result`), (snapshot) => {
    const result = snapshot.val();
    if (result && result.status === "success") {
      showToast(result.message || "Device executed command");
    }
  });
});