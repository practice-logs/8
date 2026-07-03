import { db, auth } from "../api/firebase.js";
import { ref, get, onValue, push } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ---------- DOM ----------
const contactsWrap     = document.getElementById("contactsWrap");
const loadingState     = document.getElementById("loadingState");
const rangeLabel       = document.getElementById("rangeLabel");
const searchInput      = document.getElementById("searchInput");
const filterChips      = document.getElementById("filterChips");
const selectAll        = document.getElementById("selectAll");
const deleteBtn        = document.getElementById("deleteBtn");
const purgeCount       = document.getElementById("purgeCount");
const loadMoreBtn      = document.getElementById("loadMoreBtn");
const footCount        = document.getElementById("footCount");

const statTotal        = document.getElementById("statTotal");
const statRecent       = document.getElementById("statRecent");
const statFrequent     = document.getElementById("statFrequent");
const statGroups       = document.getElementById("statGroups");
const statSync         = document.getElementById("statSync");

const drawerOverlay    = document.getElementById("drawerOverlay");
const detailDrawer     = document.getElementById("detailDrawer");
const drawerBody       = document.getElementById("drawerBody");
const closeDrawer      = document.getElementById("closeDrawer");

const toast            = document.getElementById("toast");
const toastText        = document.getElementById("toastText");

// ---------- State ----------
let originalContacts = [];
let filteredContacts = [];
let activeFilter = "ALL";
let visibleCount = 50;
const LOAD_PAGE = 50;

let currentUid = null;
let deviceId = null;

// ---------- Firebase command ----------
async function sendDeleteCommand(targets) {
  if (!currentUid || !deviceId) return 0;
  const commandsRef = ref(db, `users/${currentUid}/devices/${deviceId}/data/commands`);
  const uniqueTargets = [...new Set(targets)].filter(Boolean);
  for (const target of uniqueTargets) {
    await push(commandsRef, { action: "delete_contact", target });
  }
  return uniqueTargets.length;
}

// ---------- Helpers ----------
function initials(name) {
  if (!name || name === "Unknown") return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join("").toUpperCase();
}

function formatLastSeen(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString();
}

function isRecent(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return d > thirtyDaysAgo;
}

// ---------- Stats ----------
function renderStats(contacts) {
  const recent = contacts.filter(c => isRecent(c.lastSeen)).length;
  const starred = contacts.filter(c => c.starred).length;
  const groups = new Set(contacts.map(c => c.group).filter(Boolean)).size;
  
  const lastSync = contacts.length > 0 
    ? new Date(Math.max(...contacts.map(c => c.syncTime || 0))).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  statTotal.textContent = contacts.length.toLocaleString();
  statRecent.textContent = recent.toLocaleString();
  statFrequent.textContent = starred.toLocaleString();
  statGroups.textContent = groups.toLocaleString();
  statSync.textContent = lastSync;
}

// ---------- Render ----------
function renderContacts() {
  const visible = filteredContacts.slice(0, visibleCount);

  contactsWrap.innerHTML = "";

  if (filteredContacts.length === 0) {
    contactsWrap.innerHTML = `
      <div class="no-results">
        <i class="fa-solid fa-address-card"></i>
        <p>No contacts match your search.</p>
      </div>`;
    loadMoreBtn.hidden = true;
    footCount.textContent = "";
    return;
  }

  visible.forEach(contact => {
    const row = document.createElement("div");
    row.className = "contact-row";
    row.dataset.id = contact.contactId;
    
    const starred = contact.starred ? "starred" : "";
    const recentClass = isRecent(contact.lastSeen) ? "recent" : "";
    const typeTag = recentClass ? `<span class="type-tag ${recentClass}">Recent</span>` : "";
    const groupTag = contact.group ? `<span class="type-tag groups">${contact.group}</span>` : "";

    row.innerHTML = `
      <label class="row-tick">
        <input type="checkbox" data-id="${contact.contactId}" data-name="${contact.name || ''}" data-number="${contact.number || ''}">
        <span class="tick-dot"></span>
      </label>
      <div class="contact-avatar ${starred}" data-contact='${JSON.stringify(contact).replace(/'/g, "&#39;")}'>
        ${initials(contact.name)}
      </div>
      <div class="contact-info" data-contact='${JSON.stringify(contact).replace(/'/g, "&#39;")}'>
        <span class="contact-name">${contact.name || "Unknown"}</span>
        <span class="contact-meta">
          <span>${contact.number || "—"}</span>
          ${typeTag}
          ${groupTag}
        </span>
      </div>
      <div class="row-actions">
        <span class="row-status">${formatLastSeen(contact.lastSeen)}</span>
        <button class="row-del" data-id="${contact.contactId}" data-name="${contact.name || ''}" title="Delete this contact">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    
    contactsWrap.appendChild(row);
  });

  loadMoreBtn.hidden = visible.length >= filteredContacts.length;
  footCount.textContent = `${filteredContacts.length.toLocaleString()} total contact${filteredContacts.length === 1 ? "" : "s"}`;

  bindRowEvents();
  updateDeleteButton();
}

function bindRowEvents() {
  document.querySelectorAll(".contact-info, .contact-avatar").forEach(el => {
    el.onclick = () => {
      const contact = JSON.parse(el.dataset.contact.replace(/&#39;/g, "'"));
      openDrawer(contact);
    };
  });

  document.querySelectorAll(".row-del").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { id, name } = btn.dataset;
      if (!id && !name) return;
      btn.disabled = true;
      try {
        await sendDeleteCommand([name || id]);
        showToast("Delete command sent");
      } catch (err) {
        console.error(err);
        showToast("Failed to send delete command");
      } finally {
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.onchange = () => {
      cb.closest(".contact-row").classList.toggle("checked", cb.checked);
      updateDeleteButton();
    };
  });
}

function updateDeleteButton() {
  const checked = document.querySelectorAll('input[type="checkbox"]:checked');
  deleteBtn.disabled = checked.length === 0;
  purgeCount.textContent = checked.length;
}

// ---------- Drawer ----------
function openDrawer(contact) {
  drawerBody.innerHTML = `
    <div class="drawer-avatar">${initials(contact.name)}</div>
    <div class="drawer-name">${contact.name || "Unknown"}</div>
    <div class="drawer-number">${contact.number || "No phone number"}</div>

    <div class="drawer-field">
      <span class="drawer-field-label">Phone</span>
      <span class="drawer-field-value">${contact.number || "—"}</span>
    </div>
    ${contact.email ? `
    <div class="drawer-field">
      <span class="drawer-field-label">Email</span>
      <span class="drawer-field-value" style="word-break: break-all;">${contact.email}</span>
    </div>
    ` : ""}
    ${contact.group ? `
    <div class="drawer-field">
      <span class="drawer-field-label">Group</span>
      <span class="drawer-field-value">${contact.group}</span>
    </div>
    ` : ""}
    <div class="drawer-field">
      <span class="drawer-field-label">Last Seen</span>
      <span class="drawer-field-value">${formatLastSeen(contact.lastSeen)}</span>
    </div>
    <div class="drawer-field">
      <span class="drawer-field-label">Contact ID</span>
      <span class="drawer-field-value">${contact.contactId || "—"}</span>
    </div>

    <button class="drawer-del-btn" id="drawerDeleteBtn">Delete this contact</button>
  `;

  document.getElementById("drawerDeleteBtn").onclick = async () => {
    const btn = document.getElementById("drawerDeleteBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await sendDeleteCommand([contact.name || contact.contactId]);
      showToast("Delete command sent");
      closeDrawerFn();
    } catch (err) {
      console.error(err);
      showToast("Failed to send delete command");
    } finally {
      btn.disabled = false;
      btn.textContent = "Delete this contact";
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
  filteredContacts = [...originalContacts].sort((a, b) => {
    // Sort by last seen (recent first)
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  }).filter(contact => {
    let matchesFilter = false;
    
    switch (activeFilter) {
      case "ALL":
        matchesFilter = true;
        break;
      case "STARRED":
        matchesFilter = contact.starred === true;
        break;
      case "RECENT":
        matchesFilter = isRecent(contact.lastSeen);
        break;
      case "GROUPS":
        matchesFilter = !!contact.group;
        break;
    }
    
    const matchesSearch = q === "" || 
      JSON.stringify(contact).toLowerCase().includes(q);
    
    return matchesFilter && matchesSearch;
  });
  
  visibleCount = LOAD_PAGE;
  renderContacts();
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
  visibleCount += LOAD_PAGE;
  renderContacts();
};

selectAll.onchange = (e) => {
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = e.target.checked;
    cb.closest(".contact-row").classList.toggle("checked", cb.checked);
  });
  updateDeleteButton();
};

deleteBtn.onclick = async () => {
  const checked = document.querySelectorAll('input[type="checkbox"]:checked');
  if (checked.length === 0) return;
  
  deleteBtn.disabled = true;
  const label = deleteBtn.querySelector("span");
  const originalLabel = label.textContent;
  label.textContent = "Sending…";

  try {
    const targets = [...checked]
      .map(cb => cb.dataset.name || cb.dataset.id)
      .filter(Boolean);
    
    const count = targets.length ? await sendDeleteCommand(targets) : 0;
    
    if (count > 0) {
      showToast(`Delete command sent for ${count} contact${count === 1 ? "" : "s"}`);
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      selectAll.checked = false;
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to send delete command");
  } finally {
    label.textContent = originalLabel;
    updateDeleteButton();
  }
};

// ---------- Auth + data load ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loadingState.innerHTML = `<p>Please sign in to view contacts.</p>`;
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

  onValue(ref(db, `users/${currentUid}/devices/${deviceId}/data/contacts`), (snapshot) => {
    originalContacts = [];
    snapshot.forEach(child => {
      originalContacts.push({
        ...child.val(),
        contactId: child.key,
        _path: `users/${currentUid}/devices/${deviceId}/data/contacts/${child.key}`
      });
    });

    renderStats(originalContacts);

    if (originalContacts.length) {
      rangeLabel.textContent = `${originalContacts.length.toLocaleString()} contacts synced`;
    } else {
      rangeLabel.textContent = "No contacts yet";
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