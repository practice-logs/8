// 🔥 COMPLETE A-TO-Z FIXED SCRIPT - Shows REAL package names (com.whatsapp etc.)
import { db, auth } from "../api/firebase.js";
import { ref, set, onValue, remove, get } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

let currentUid = null;
let deviceId = null;
let allApps = [];
let blockedApps = new Set();
let selectedApps = new Set();

// 🔥 SAFE DOM Elements with null checks
const elements = {
  searchInput: document.getElementById('searchInput'),
  pageSize: document.getElementById('pageSize'),
  selectAllApps: document.getElementById('selectAllApps'),
  appsTable: document.getElementById('appsTable'),
  infoText: document.getElementById('infoText'),
  blockAppBtn: document.getElementById('blockAppBtn'),
  refreshAppsBtn: document.getElementById('refreshAppsBtn'),
  toastNotification: document.getElementById('toastNotification'),
  toastText: document.getElementById('toastText'),
  successMessage: document.getElementById('successMessage'),
  blockedAppsSection: document.getElementById('blockedAppsSection'),
  blockedAppsList: document.getElementById('blockedAppsList'),
  blockedCount: document.getElementById('blockedCount'),
  showBlockedBtn: document.getElementById('showBlockedBtn'),
  selectedCount: document.getElementById('selectedCount')
};

// 🔥 Package Sanitizer - Matches Android exactly
function sanitizePackageName(pkg) {
  return pkg ? pkg.replace(/\./g, '_').toLowerCase() : '';
}

function unsanitizePackageName(pkg) {
  return pkg ? pkg.replace(/_/g, '.') : '';
}

// 🔥 Notification System
function showToast(message, isError = false) {
  if (!elements.toastText || !elements.toastNotification) return;
  elements.toastText.textContent = message;
  elements.toastNotification.className = `toast-notification ${isError ? 'error' : ''} show`;
  setTimeout(() => elements.toastNotification.classList.remove('show'), 4000);
}

function showSuccess(message = 'Operation completed successfully!') {
  if (!elements.successMessage) return;
  elements.successMessage.querySelector('span').textContent = message;
  elements.successMessage.classList.add('show');
  setTimeout(() => elements.successMessage.classList.remove('show'), 3000);
}

// 🔥 Firebase Paths
function getBlockedAppsPath() {
  return currentUid && deviceId ? `users/${currentUid}/devices/${deviceId}/adBlockedApps` : null;
}

function getAppsPath() {
  return currentUid && deviceId ? `users/${currentUid}/devices/${deviceId}/apps/by_package` : null;
}

// 🔥 CRITICAL FIX: Render REAL package names from appData.packageName
function renderApps(filteredApps = allApps) {
  const tbody = elements.appsTable?.querySelector('tbody');
  if (!tbody) return;

  if (allApps.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          📱 Waiting for apps data from Android device...
        </td>
      </tr>
    `;
    return;
  }

  if (filteredApps.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          No apps match your search
        </td>
      </tr>
    `;
    if (elements.infoText) elements.infoText.textContent = '0 matches';
    return;
  }

  tbody.innerHTML = '';
  filteredApps.forEach(app => {
    const row = document.createElement('tr');
    const buttonText = app.blocked ? 'Unblock' : 'Block';
    const buttonClass = app.blocked ? 'unblock' : '';
    
    row.innerHTML = `
      <td class="checkbox-col">
        <input type="checkbox" value="${app.packageName}" data-package="${app.packageName}">
      </td>
      <td class="name-col" title="${app.appName || app.packageName}">${app.appName || app.packageName}</td>
      <td class="package-col" title="${app.packageName}">${app.packageName}</td>
      <td class="version-col">${app.versionName || 'Unknown'}</td>
      <td class="status-col">
        <span class="status-badge status-${app.blocked ? 'blocked' : 'installed'}">
          ${app.blocked ? '🔴 BLOCKED' : '🟢 ACTIVE'}
        </span>
      </td>
      <td class="action-col">
        <button class="btn-small ${buttonClass}" 
                onclick="${app.blocked ? `unblockApp('${app.packageName.replace(/'/g, "\\'")}')` : `blockApp('${app.packageName.replace(/'/g, "\\'")}')`}"
                style="width: 100%; padding: 8px 12px;">
          ${buttonText}
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });

  if (elements.infoText) {
    elements.infoText.textContent = `Showing ${filteredApps.length} of ${allApps.length} apps`;
  }
  updateSelectAllCheckbox();
}

// 🔥 Blocked Apps List
function renderBlockedAppsList() {
  const list = elements.blockedAppsList;
  if (!list) return;

  list.innerHTML = '';

  if (blockedApps.size === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No blocked apps found</div>';
    if (elements.blockedCount) elements.blockedCount.textContent = '0 apps blocked';
    return;
  }

  let html = '';
  blockedApps.forEach(pkg => {
    const originalPkg = unsanitizePackageName(pkg);
    html += `
      <div class="blocked-app-item" style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #eee;">
        <div class="app-icon" style="width: 40px; height: 40px; background: #ff4444; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; margin-right: 12px;">
          <i class="fa-solid fa-ban" style="font-size: 16px;"></i>
        </div>
        <div class="app-info" style="flex: 1;">
          <h4 style="margin: 0; font-size: 16px;">${originalPkg}</h4>
          <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">Package blocked</p>
        </div>
        <button class="btn-small unblock" onclick="unblockApp('${originalPkg.replace(/'/g, "\\'")}')" 
                style="padding: 8px 16px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer;">
          <i class="fa-solid fa-unlock"></i> Unblock
        </button>
      </div>
    `;
  });

  list.innerHTML = html;
  if (elements.blockedCount) elements.blockedCount.textContent = `${blockedApps.size} apps blocked`;
}

// 🔥 Block/Unblock Functions
async function blockSelectedApps() {
  if (selectedApps.size === 0) return showToast('No apps selected', true);
  if (!getBlockedAppsPath()) return showToast('Device not connected', true);

  try {
    showToast(`Blocking ${selectedApps.size} apps...`);
    
    for (let pkg of selectedApps) {
      const safePkg = sanitizePackageName(pkg);
      await set(ref(db, `${getBlockedAppsPath()}/${safePkg}`), true);
    }

    selectedApps.clear();
    updateSelectedCount();
    showSuccess(`${selectedApps.size} apps blocked!`);
    showToast(`✅ ${selectedApps.size} apps blocked successfully`);
  } catch (error) {
    showToast('Block failed: ' + error.message, true);
  }
}

async function blockApp(pkg) {
  if (!getBlockedAppsPath()) return showToast('Device not connected', true);
  try {
    const safePkg = sanitizePackageName(pkg);
    await set(ref(db, `${getBlockedAppsPath()}/${safePkg}`), true);
    showToast(`✅ ${pkg} blocked successfully`);
  } catch (error) {
    showToast('Block failed: ' + error.message, true);
  }
}

async function blockSingleApp(pkg, showToastMsg = true) {
  await blockApp(pkg);
}

window.unblockApp = async (pkg) => {
  if (!getBlockedAppsPath()) return showToast('Device not connected', true);
  try {
    const safePkg = sanitizePackageName(pkg);
    await remove(ref(db, `${getBlockedAppsPath()}/${safePkg}`));
    showToast(`✅ ${pkg} unblocked successfully`);
  } catch (error) {
    showToast('Unblock failed: ' + error.message, true);
  }
};

window.blockApp = blockApp;

// 🔥 MAIN INITIALIZATION - FIXED PACKAGE NAME EXTRACTION
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showToast('Please sign in to continue', true);
    return;
  }

  currentUid = user.uid;
  console.log('🔥 User authenticated:', currentUid);
  showToast('🔥 Connected to Firebase');

  try {
    // Get device ID
    const snap = await get(ref(db, `users/${currentUid}/storeId`));
    deviceId = snap.val();
    
    if (!deviceId) {
      showToast('❌ Device ID not found in storeId', true);
      return;
    }

    console.log('✅ Device connected:', deviceId);
    showToast(`✅ Connected to device: ${deviceId}`);

    // 🔥 Listen for blocked apps
    const blockedRef = ref(db, getBlockedAppsPath());
    onValue(blockedRef, (snapshot) => {
      blockedApps.clear();
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          blockedApps.add(child.key);
        });
      }
      
      // Update blocked status for all apps
      allApps.forEach(app => {
        app.blocked = blockedApps.has(sanitizePackageName(app.packageName));
      });
      
      renderApps();
      renderBlockedAppsList();
    });

    // 🔥 FIXED: Correct package name extraction (THIS WAS THE PROBLEM!)
    const appsRef = ref(db, getAppsPath());
    onValue(appsRef, (snapshot) => {
      console.log('🔍 Raw apps snapshot:', snapshot.val()); // DEBUG
      
      allApps = [];
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const appData = child.val();  // 🔥 Get the app object data
          
          // 🔥 CRITICAL FIX: packageName is INSIDE appData, NOT child.key!
          const packageName = appData?.packageName;  // com.whatsapp ✅
          const appName = appData?.appName || packageName || 'Unknown';
          const versionName = appData?.todayUsage || appData?.versionName || 'Unknown';
          
          console.log(`📱 Found app: ${packageName} → ${appName}`); // DEBUG
          
          // Filter out invalid/system apps
          if (packageName && 
              packageName.length > 5 &&
              !packageName.startsWith('android.') &&
              !packageName.includes('com.eagle.monitor') &&
              packageName !== 'unknown') {
            
            allApps.push({
              packageName: packageName,           // ✅ REAL PACKAGE NAME
              appName: appName,                   // ✅ WhatsApp, Instagram
              versionName: versionName,           // ✅ Usage time
              blocked: blockedApps.has(sanitizePackageName(packageName))
            });
          }
        });
      }
      
      console.log(`✅ Loaded ${allApps.length} valid apps`);
      renderApps();
    });

  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Failed to initialize: ' + error.message, true);
  }
});

function getFilteredApps() {
  const searchTerm = elements.searchInput?.value?.toLowerCase() || '';
  return allApps.filter(app => 
    !searchTerm || 
    app.appName?.toLowerCase().includes(searchTerm) ||
    app.packageName.toLowerCase().includes(searchTerm)
  );
}

function updateInfoText(count) {
  if (elements.infoText) {
    elements.infoText.textContent = `Showing 1 to ${count} of ${allApps.length} entries`;
  }
}

function updateSelectedCount() {
  if (elements.selectedCount) {
    elements.selectedCount.textContent = `${selectedApps.size} selected`;
  }
  if (elements.blockAppBtn) {
    elements.blockAppBtn.disabled = selectedApps.size === 0;
  }
}

function updateSelectAllCheckbox() {
  const totalCheckboxes = document.querySelectorAll('#appsTable input[type="checkbox"]').length;
  const checkedCheckboxes = document.querySelectorAll('#appsTable input[type="checkbox"]:checked').length;
  
  if (elements.selectAllApps) {
    elements.selectAllApps.checked = totalCheckboxes > 0 && checkedCheckboxes === totalCheckboxes;
    elements.selectAllApps.indeterminate = checkedCheckboxes > 0 && checkedCheckboxes < totalCheckboxes;
  }
}

// 🔥 Event Listeners
if (elements.blockAppBtn) elements.blockAppBtn.onclick = blockSelectedApps;
if (elements.refreshAppsBtn) elements.refreshAppsBtn.onclick = () => renderApps(getFilteredApps());
if (elements.showBlockedBtn) {
  elements.showBlockedBtn.onclick = () => {
    if (elements.blockedAppsSection) {
      elements.blockedAppsSection.style.display = 
        elements.blockedAppsSection.style.display === 'none' ? 'block' : 'none';
      if (elements.blockedAppsSection.style.display === 'block') {
        renderBlockedAppsList();
      }
    }
  };
}

if (elements.searchInput) {
  elements.searchInput.oninput = debounce(() => renderApps(getFilteredApps()), 300);
}

if (elements.pageSize) {
  elements.pageSize.onchange = () => renderApps(getFilteredApps());
}

document.addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) {
    const pkg = e.target.dataset.package;
    if (pkg) {
      if (e.target.checked) {
        selectedApps.add(pkg);
      } else {
        selectedApps.delete(pkg);
      }
      updateSelectedCount();
    }
  }
});

if (elements.selectAllApps) {
  elements.selectAllApps.onchange = (e) => {
    const checkboxes = document.querySelectorAll('#appsTable input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = e.target.checked;
      const pkg = cb.dataset.package;
      if (pkg) {
        if (e.target.checked) {
          selectedApps.add(pkg);
        } else {
          selectedApps.delete(pkg);
        }
      }
    });
    updateSelectedCount();
  };
}

// 🔥 Utility Functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

console.log('🚀 Professional App Blocker Dashboard - A-TO-Z COMPLETE ✅');
console.log('✅ Will show REAL package names: com.whatsapp, com.instagram, etc.');
