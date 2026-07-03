// ═══════════════════════════════════════════════════════════════════════════════════════════
//  ANDROID ACCESSIBILITY REPLAY PLAYER - Complete Version
//  Imports Firebase from separate config file (matches your project structure)
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { db, auth } from "../api/firebase.js";
import { ref, onValue, get, set, remove } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  STATE & GLOBALS
// ═══════════════════════════════════════════════════════════════════════════════════════════

let currentUser = null;
let currentDeviceId = null;
let currentSessionId = null;
let currentSessionData = null;
let allRecordings = {};
let currentEventIndex = 0;
let isPlaying = false;
let playbackSpeed = 1;
let totalDuration = 0;
let currentTime = 0;
let animationFrameId = null;
let lastFrameTime = 0;

const MOCK_DATA_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════════════════════

const DOM = {
    recordingsList: document.getElementById('recordingsList'),
    screenContent: document.getElementById('screenContent'),
    eventInfo: document.getElementById('eventInfo'),
    phoneStatus: document.getElementById('phoneStatus'),
    phoneTime: document.getElementById('phoneTime'),
    
    playBtn: document.getElementById('playBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    nextBtn: document.getElementById('nextBtn'),
    prevBtn: document.getElementById('prevBtn'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    currentTimeDisplay: document.getElementById('currentTime'),
    totalTimeDisplay: document.getElementById('totalTime'),
    speedSelector: document.getElementById('speedSelector'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalClose: document.getElementById('modalClose'),
    modalConfirm: document.getElementById('modalConfirm')
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  INITIALIZATION & AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Initialize on auth state change
 * Gets current user UID and device ID from Firebase
 */
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.log("❌ Not authenticated");
        if (MOCK_DATA_ENABLED) {
            console.log("🧪 Loading mock data for testing...");
            loadMockData();
        } else {
            showModal('Authentication Required', 'Please sign in to your account');
        }
        return;
    }

    currentUser = user;
    console.log('✓ Authenticated:', user.uid);
    console.log('  Email:', user.email);

    try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // HOW TO GET DEVICE ID:
        // 1. User signs in → Firebase Auth provides UID (currentUser.uid)
        // 2. Read from Firebase: users/{uid}/storeId
        // 3. storeId = deviceId (same value)
        // 4. Use to read recordings from: users/{uid}/devices/{deviceId}/recordings
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        const storeIdSnap = await get(ref(db, `users/${user.uid}/storeId`));
        currentDeviceId = storeIdSnap.val();

        console.log('Device ID:', currentDeviceId);
        console.log('User UID:', user.uid);

        if (currentDeviceId) {
            console.log('✓ Device found. Listening to recordings...');
            listenToRecordings();
            console.log(`✓ Listening to: users/${user.uid}/devices/${currentDeviceId}/recordings`);
        } else {
            if (MOCK_DATA_ENABLED) {
                console.log('⚠ No device ID found, using mock data');
                loadMockData();
            } else {
                showModal('No Device Found', 'No device associated with your account');
            }
        }
    } catch (error) {
        console.error('Auth initialization error:', error);
        if (MOCK_DATA_ENABLED) {
            loadMockData();
        } else {
            showModal('Error', error.message);
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  FIREBASE LISTENERS - LOAD RECORDINGS
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Listen to all recordings for current user's device
 * Path: users/{uid}/devices/{deviceId}/recordings
 */
function listenToRecordings() {
    if (!currentUser || !currentDeviceId) {
        console.error('Cannot listen: missing user or device');
        return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIREBASE PATH STRUCTURE:
    // users/
    //   {uid}/                          ← currentUser.uid
    //     devices/
    //       {deviceId}/                 ← currentDeviceId (same as storeId)
    //         recordings/
    //           rec_1234567890_1234/    ← sessionId (auto-generated)
    //             ├── data              ← Base64 compressed JSON
    //             ├── compressed        ← true/false
    //             ├── size              ← File size in bytes
    //             ├── timestamp         ← Unix timestamp
    //             └── sessionId         ← Recording ID
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const recordingsRef = ref(
        db,
        `users/${currentUser.uid}/devices/${currentDeviceId}/recordings`
    );

    onValue(
        recordingsRef,
        (snapshot) => {
            allRecordings = {};

            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    allRecordings[child.key] = {
                        sessionId: child.key,
                        ...child.val()
                    };
                });
                console.log(`✓ Loaded ${Object.keys(allRecordings).length} recordings`);
            } else {
                console.log('No recordings found');
            }

            renderRecordingsList();
        },
        (error) => {
            console.error('Firebase listener error:', error);
            showModal('Connection Error', error.message);
        }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  RENDER RECORDINGS LIST
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderRecordingsList() {
    const recordings = Object.values(allRecordings).sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );

    if (recordings.length === 0) {
        DOM.recordingsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <span>No recordings yet</span>
            </div>
        `;
        return;
    }

    DOM.recordingsList.innerHTML = recordings
        .map(recording => {
            const date = new Date(recording.timestamp || 0);
            const timeStr = date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: true 
            });
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            return `
                <div class="recording-item ${recording.sessionId === currentSessionId ? 'active' : ''}" 
                     data-session-id="${recording.sessionId}">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="recording-item-status"></span>
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${recording.sessionId.substring(0, 12)}...
                            </div>
                            <div class="recording-item-time">${dateStr} ${timeStr}</div>
                        </div>
                    </div>
                </div>
            `;
        })
        .join('');

    // Add click listeners to each recording
    document.querySelectorAll('.recording-item').forEach(item => {
        item.addEventListener('click', () => {
            const sessionId = item.dataset.sessionId;
            console.log('Loading session:', sessionId);
            loadSession(sessionId);
        });
    });

    // Auto-load first recording
    if (!currentSessionId && recordings.length > 0) {
        loadSession(recordings[0].sessionId);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  LOAD SESSION (CORE)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Load a recording session and prepare it for playback
 * Steps:
 * 1. Get recording from allRecordings
 * 2. Decompress GZIP data if needed
 * 3. Parse JSON
 * 4. Render initial frame
 */
async function loadSession(sessionId) {
    if (!allRecordings[sessionId]) {
        console.error('Recording not found:', sessionId);
        return;
    }

    currentSessionId = sessionId;
    currentEventIndex = 0;
    isPlaying = false;
    currentTime = 0;
    lastFrameTime = 0;

    DOM.loadingOverlay.style.display = 'flex';

    try {
        const recording = allRecordings[sessionId];
        console.log('📦 Recording details:');
        console.log('  - Compressed:', recording.compressed);
        console.log('  - Size:', (recording.size / 1024).toFixed(2), 'KB');
        console.log('  - Timestamp:', new Date(recording.timestamp).toLocaleString());

        let jsonData = recording.data;

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // DECOMPRESSION FLOW:
        // 1. Android RecorderModule compresses JSON with GZIP
        // 2. Encodes to Base64 for storage
        // 3. Firebase stores as string
        // 4. We decompress using pako.ungzip()
        // 5. Parse the result as JSON
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // Step 1: Decompress if needed
        if (recording.compressed) {
            console.log('🔧 Decompressing GZIP data...');
            const decompressed = decompressGzip(jsonData);
            if (decompressed) {
                jsonData = decompressed;
                console.log('✓ Decompressed successfully');
            } else {
                throw new Error('Failed to decompress data');
            }
        }

        // Step 2: Parse JSON
        if (typeof jsonData === 'string') {
            currentSessionData = JSON.parse(jsonData);
        } else {
            currentSessionData = jsonData;
        }

        if (!currentSessionData) {
            throw new Error('Invalid session data');
        }

        // Step 3: Calculate duration
        const events = currentSessionData.events || [];
        if (events.length > 0) {
            const startTime = events[0].ts || 0;
            const endTime = events[events.length - 1].ts || 0;
            totalDuration = Math.max(endTime - startTime, 1000);
        }

        console.log(`✓ Session loaded: ${events.length} events`);
        console.log('  Duration:', formatTime(totalDuration));

        // Step 4: Update UI
        updateRecordingsList();
        renderEventInfo();
        updateTimeline();
        renderFrame(0);

    } catch (error) {
        console.error('❌ Load session error:', error);
        showModal('Error Loading Session', error.message);
    } finally {
        DOM.loadingOverlay.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DECOMPRESSION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Decompress GZIP data
 * Flow: Base64 string → Binary bytes → GZIP decompress → JSON string
 */
function decompressGzip(base64Data) {
    try {
        if (typeof base64Data !== 'string') return null;

        base64Data = base64Data.trim();

        // Base64 → Binary string
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // GZIP decompress using Pako library
        if (typeof pako !== 'undefined') {
            try {
                const result = pako.ungzip(bytes, { to: 'string' });
                return result;
            } catch (e) {
                console.warn('Pako decompression failed:', e);
            }
        } else {
            console.error('Pako library not loaded!');
        }

        // Fallback: assume raw data
        return new TextDecoder().decode(bytes);
    } catch (error) {
        console.error('Decompression error:', error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  FRAME RENDERING (CORE REPLAY ENGINE)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Render a specific event frame
 * Reconstructs the screen from accessibility snapshot
 */
function renderFrame(eventIndex) {
    const events = currentSessionData.events || [];
    if (eventIndex < 0 || eventIndex >= events.length) return;

    const event = events[eventIndex];
    currentEventIndex = eventIndex;

    // Find closest screen snapshot (looking backwards)
    let snapshot = null;
    for (let i = eventIndex; i >= 0; i--) {
        if (events[i].screenSnapshot) {
            snapshot = events[i].screenSnapshot;
            break;
        }
    }

    if (!snapshot) {
        console.warn('No snapshot found for event', eventIndex);
        return;
    }

    // Render the screen
    renderScreen(snapshot, event);

    // Update info panels
    renderEventInfo();
    updateTimeline();
}

/**
 * Render screen content from accessibility snapshot
 * Shows:
 * - Clickable elements (blue boxes)
 * - Click animations (ripple)
 * - Touch indicators
 * - Text overlay
 */
function renderScreen(snapshot, currentEvent) {
    const screenContent = DOM.screenContent;
    const startTime = currentSessionData.events[0].ts || 0;

    // Remove previous snapshot with animation
    const prevSnapshot = screenContent.querySelector('.screen-snapshot.active');
    if (prevSnapshot) {
        prevSnapshot.classList.remove('active');
        prevSnapshot.classList.add('prev');
        setTimeout(() => prevSnapshot.remove(), 500);
    }

    // Create new snapshot container
    const snapshotDiv = document.createElement('div');
    snapshotDiv.className = 'screen-snapshot';

    // Get screen dimensions for scaling
    const screenW = snapshot.screen?.width || 1080;
    const screenH = snapshot.screen?.height || 2400;
    const scale = 304 / screenW; // 304px = phone frame inner width

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // COORDINATE TRANSFORMATION:
    // Android screenshot: 1080x2400 (original device size)
    // Phone frame: 304x608 (display size)
    // Scale factor: 304/1080 = 0.281
    // Transform: Android coords × scale = Display coords
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Render clickable elements as blue boxes
    if (snapshot.clickablePositions) {
        snapshot.clickablePositions.forEach(pos => {
            const elem = document.createElement('div');
            elem.className = 'snapshot-element clickable';
            elem.style.left = (pos.x * scale - 25) + 'px';
            elem.style.top = (pos.y * scale - 10) + 'px';
            elem.style.width = (pos.width * scale) + 'px';
            elem.style.height = (pos.height * scale) + 'px';
            elem.style.fontSize = '8px';
            elem.textContent = pos.label || 'Clickable';
            snapshotDiv.appendChild(elem);
        });
    }

    // Add click animation if this is a click event
    if (currentEvent && (currentEvent.action === 'CLICK' || currentEvent.action === 'LONG_CLICK')) {
        const clickPos = currentEvent.clickPosition;
        if (clickPos) {
            const x = clickPos.x * scale;
            const y = clickPos.y * scale;

            // Ripple effect
            const ripple = document.createElement('div');
            ripple.className = 'click-ripple';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            ripple.style.width = '20px';
            ripple.style.height = '20px';
            snapshotDiv.appendChild(ripple);

            // Touch indicator circle
            const touch = document.createElement('div');
            touch.className = 'touch-indicator';
            touch.style.left = (x - 20) + 'px';
            touch.style.top = (y - 20) + 'px';
            snapshotDiv.appendChild(touch);
        }
    }

    // Add touch animation for raw touch events
    if (currentEvent && currentEvent.type === 'TOUCH' && currentEvent.action === 'DOWN') {
        const x = currentEvent.x * scale;
        const y = currentEvent.y * scale;

        const touch = document.createElement('div');
        touch.className = 'touch-indicator';
        touch.style.left = (x - 20) + 'px';
        touch.style.top = (y - 20) + 'px';
        snapshotDiv.appendChild(touch);
    }

    // Add text content overlay
    const textDiv = document.createElement('div');
    textDiv.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        padding: 12px;
        font-size: 11px;
        color: rgba(228, 230, 235, 0.7);
        word-wrap: break-word;
        white-space: pre-wrap;
        pointer-events: none;
        max-height: 100%;
        overflow: hidden;
    `;
    textDiv.textContent = snapshot.fullText || '';
    snapshotDiv.appendChild(textDiv);

    screenContent.appendChild(snapshotDiv);

    // Fade in animation
    requestAnimationFrame(() => {
        snapshotDiv.classList.add('active');
    });

    // Update phone status bar time
    if (currentEvent && currentEvent.ts) {
        const date = new Date(currentEvent.ts);
        DOM.phoneTime.textContent = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  EVENT INFO DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderEventInfo() {
    if (!currentSessionData) {
        DOM.eventInfo.innerHTML = `
            <div class="empty-state" style="height: auto; padding: 20px;">
                <i class="fas fa-inbox"></i>
                <span>No session loaded</span>
            </div>
        `;
        return;
    }

    const event = currentSessionData.events[currentEventIndex];
    if (!event) return;

    let html = `
        <div class="info-item">
            <div class="info-label">Event Type</div>
            <div class="info-value">${event.type || 'UNKNOWN'}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Action</div>
            <div class="info-value">${event.action || '—'}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Package</div>
            <div class="info-value" style="font-size: 11px;">${event.pkg || '—'}</div>
        </div>
    `;

    if (event.node) {
        html += `
            <div class="info-item">
                <div class="info-label">Text</div>
                <div class="info-value">${event.node.text || '—'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Class</div>
                <div class="info-value" style="font-size: 10px;">${event.node.className || '—'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Clickable</div>
                <div class="info-value">${event.node.clickable ? '✓' : '✗'}</div>
            </div>
        `;
    }

    if (event.clickPosition) {
        html += `
            <div class="info-item">
                <div class="info-label">Click Position</div>
                <div class="info-value">X: ${event.clickPosition.x || 0}, Y: ${event.clickPosition.y || 0}</div>
            </div>
        `;
    }

    DOM.eventInfo.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  PLAYBACK CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Play button - start playback from current position
 */
DOM.playBtn.addEventListener('click', () => {
    if (!currentSessionData) return;
    isPlaying = true;
    updatePlaybackUI();
    console.log('▶ Playing...');
    playbackLoop();
});

/**
 * Pause button - pause playback
 */
DOM.pauseBtn.addEventListener('click', () => {
    isPlaying = false;
    updatePlaybackUI();
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    console.log('⏸ Paused');
});

/**
 * Next button - go to next event
 */
DOM.nextBtn.addEventListener('click', () => {
    const events = currentSessionData.events || [];
    if (currentEventIndex < events.length - 1) {
        renderFrame(currentEventIndex + 1);
        console.log('→ Next event:', currentEventIndex + 1);
    }
});

/**
 * Previous button - go to previous event
 */
DOM.prevBtn.addEventListener('click', () => {
    if (currentEventIndex > 0) {
        renderFrame(currentEventIndex - 1);
        console.log('← Previous event:', currentEventIndex - 1);
    }
});

/**
 * Speed selector buttons
 */
document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playbackSpeed = parseFloat(btn.dataset.speed);
        console.log(`⏩ Playback speed: ${playbackSpeed}x`);
    });
});

/**
 * Progress bar seeking
 */
DOM.progressBar.addEventListener('mousedown', (e) => {
    const rect = DOM.progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seekToPercent(percent);
});

function seekToPercent(percent) {
    const events = currentSessionData.events || [];
    if (events.length === 0) return;

    const startTime = events[0].ts || 0;
    const targetTime = startTime + (totalDuration * percent);

    // Find closest event to target time
    let closestIdx = 0;
    let closestDiff = Math.abs(events[0].ts - targetTime);

    for (let i = 1; i < events.length; i++) {
        const diff = Math.abs(events[i].ts - targetTime);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIdx = i;
        }
    }

    renderFrame(closestIdx);
    currentTime = events[closestIdx].ts - startTime;
    console.log('⏭ Seek to:', formatTime(currentTime));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  PLAYBACK LOOP (ANIMATION FRAME BASED)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Main playback loop
 * Advances to next event based on timestamp differences
 * Respects playback speed multiplier
 */
function playbackLoop() {
    if (!isPlaying || !currentSessionData) {
        return;
    }

    const events = currentSessionData.events || [];
    if (currentEventIndex >= events.length - 1) {
        isPlaying = false;
        updatePlaybackUI();
        console.log('✓ Playback finished');
        return;
    }

    const currentEvent = events[currentEventIndex];
    const nextEvent = events[currentEventIndex + 1];
    const startTime = events[0].ts || 0;

    // Time until next event (adjusted for playback speed)
    const timeDiff = (nextEvent.ts - currentEvent.ts) / playbackSpeed;
    const now = Date.now();

    if (!lastFrameTime) {
        lastFrameTime = now;
    }

    const elapsed = now - lastFrameTime;

    // Check if enough time has passed to advance to next event
    if (elapsed >= timeDiff) {
        renderFrame(currentEventIndex + 1);
        currentTime = nextEvent.ts - startTime;
        lastFrameTime = now;
    }

    updateTimeline();
    animationFrameId = requestAnimationFrame(playbackLoop);
}

function updatePlaybackUI() {
    DOM.playBtn.classList.toggle('active', isPlaying);
    DOM.pauseBtn.classList.toggle('active', !isPlaying);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  TIMELINE UPDATE
// ═══════════════════════════════════════════════════════════════════════════════════════════

function updateTimeline() {
    if (!currentSessionData) return;

    const percent = totalDuration > 0 ? 
        (currentTime / totalDuration) * 100 : 0;

    DOM.progressFill.style.width = percent + '%';
    DOM.currentTimeDisplay.textContent = formatTime(currentTime);
    DOM.totalTimeDisplay.textContent = formatTime(totalDuration);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  UI UPDATES
// ═══════════════════════════════════════════════════════════════════════════════════════════

function updateRecordingsList() {
    document.querySelectorAll('.recording-item').forEach(item => {
        item.classList.toggle('active', item.dataset.sessionId === currentSessionId);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  MODAL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════════

function showModal(title, message, hasConfirm = false) {
    DOM.modalTitle.textContent = title;
    DOM.modalMessage.textContent = message;
    DOM.modalConfirm.style.display = hasConfirm ? 'block' : 'none';
    DOM.modal.classList.add('active');
}

DOM.modalClose.addEventListener('click', () => {
    DOM.modal.classList.remove('active');
});

DOM.modal.addEventListener('click', (e) => {
    if (e.target === DOM.modal) {
        DOM.modal.classList.remove('active');
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════════════

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DEMO/MOCK DATA (FOR TESTING WITHOUT FIREBASE)
// ═══════════════════════════════════════════════════════════════════════════════════════════

function loadMockData() {
    console.log('🧪 Loading demo recording...');
    const mockSession = generateDemoSession();
    allRecordings = {
        [mockSession.sessionId]: {
            sessionId: mockSession.sessionId,
            uid: 'demo_user',
            deviceId: 'demo_device',
            compressed: false,
            size: JSON.stringify(mockSession).length,
            timestamp: Date.now(),
            data: JSON.stringify(mockSession)
        }
    };
    renderRecordingsList();
}

/**
 * Generate demo recording showing a login flow
 * Useful for testing without Firebase
 */
function generateDemoSession() {
    const startTime = Date.now() - 15000;
    return {
        sessionId: 'rec_demo_' + Date.now(),
        uid: 'demo',
        deviceId: 'demo_device',
        startTime: startTime,
        endTime: Date.now(),
        eventCount: 8,
        events: [
            {
                ts: startTime + 0,
                type: 'VIEW_CLICKED',
                action: 'CLICK',
                pkg: 'com.example.app',
                screenSnapshot: generateDemoSnapshot('Login Screen', [
                    { label: 'Username', x: 540, y: 200, width: 600, height: 100 },
                    { label: 'Password', x: 540, y: 350, width: 600, height: 100 },
                    { label: 'Login', x: 540, y: 550, width: 400, height: 100 }
                ]),
                clickPosition: { x: 540, y: 200, text: 'Username' }
            },
            {
                ts: startTime + 1500,
                type: 'VIEW_TEXT_CHANGED',
                action: 'TEXT_CHANGE',
                pkg: 'com.example.app',
                text: 'john.doe@gmail.com',
                screenSnapshot: generateDemoSnapshot('Login with Email', [
                    { label: 'john.doe@gmail.com', x: 540, y: 200, width: 600, height: 100 },
                    { label: 'Password', x: 540, y: 350, width: 600, height: 100 },
                    { label: 'Login', x: 540, y: 550, width: 400, height: 100 }
                ])
            },
            {
                ts: startTime + 3000,
                type: 'VIEW_CLICKED',
                action: 'CLICK',
                pkg: 'com.example.app',
                screenSnapshot: generateDemoSnapshot('Password Field', [
                    { label: 'john.doe@gmail.com', x: 540, y: 200, width: 600, height: 100 },
                    { label: 'Password', x: 540, y: 350, width: 600, height: 100 },
                    { label: 'Login', x: 540, y: 550, width: 400, height: 100 }
                ]),
                clickPosition: { x: 540, y: 350, text: 'Password' }
            },
            {
                ts: startTime + 4500,
                type: 'VIEW_TEXT_CHANGED',
                action: 'TEXT_CHANGE',
                pkg: 'com.example.app',
                text: '••••••••',
                screenSnapshot: generateDemoSnapshot('Password Entered', [
                    { label: 'john.doe@gmail.com', x: 540, y: 200, width: 600, height: 100 },
                    { label: '••••••••', x: 540, y: 350, width: 600, height: 100 },
                    { label: 'Login', x: 540, y: 550, width: 400, height: 100 }
                ])
            },
            {
                ts: startTime + 6000,
                type: 'VIEW_CLICKED',
                action: 'CLICK',
                pkg: 'com.example.app',
                screenSnapshot: generateDemoSnapshot('Login Button', [
                    { label: 'john.doe@gmail.com', x: 540, y: 200, width: 600, height: 100 },
                    { label: '••••••••', x: 540, y: 350, width: 600, height: 100 },
                    { label: 'Login', x: 540, y: 550, width: 400, height: 100 }
                ]),
                clickPosition: { x: 540, y: 550, text: 'Login' }
            },
            {
                ts: startTime + 7500,
                type: 'WINDOW_STATE_CHANGED',
                action: 'WINDOW_CHANGE',
                pkg: 'com.example.app',
                screenSnapshot: generateDemoSnapshot('Loading...', [
                    { label: 'Authenticating...', x: 540, y: 1200, width: 400, height: 80 }
                ])
            },
            {
                ts: startTime + 10000,
                type: 'WINDOW_STATE_CHANGED',
                action: 'WINDOW_CHANGE',
                pkg: 'com.example.app',
                screenSnapshot: generateDemoSnapshot('Home Screen', [
                    { label: 'Welcome, John!', x: 540, y: 200, width: 600, height: 100 },
                    { label: 'Profile', x: 270, y: 400, width: 300, height: 150 },
                    { label: 'Settings', x: 810, y: 400, width: 300, height: 150 },
                    { label: 'Logout', x: 540, y: 2200, width: 400, height: 100 }
                ])
            }
        ]
    };
}

function generateDemoSnapshot(text, clickables) {
    return {
        package: 'com.example.app',
        fullText: text,
        screen: { width: 1080, height: 2400, density: 420, api: 31 },
        elementCount: clickables.length + 2,
        clickableCount: clickables.length,
        editableCount: 0,
        scrollableCount: 0,
        clickablePositions: clickables.map(c => ({
            label: c.label,
            x: c.x,
            y: c.y,
            left: c.x - c.width / 2,
            top: c.y - c.height / 2,
            width: c.width,
            height: c.height,
            class: 'Button',
            editable: false,
            enabled: true
        })),
        elements: []
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  INIT LOG
// ═══════════════════════════════════════════════════════════════════════════════════════════

console.log('✓ Android Accessibility Replay Player v1.0');
console.log('  Firebase: Ready');
console.log('  Pako GZIP: Loading...');
console.log('  Type: loadDemoSession() to test without Firebase');

// Load Pako library for GZIP decompression
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
script.async = true;
script.onload = () => {
    console.log('✓ Pako library loaded');
};
document.head.appendChild(script);

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  GLOBAL FUNCTIONS (FOR DEBUGGING)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Test function: Load demo session
 * Usage in browser console: loadDemoSession()
 */
window.loadDemoSession = function() {
    console.log('🧪 Loading demo session...');
    loadMockData();
};

/**
 * Debug function: Log current state
 * Usage in browser console: debugState()
 */
window.debugState = function() {
    console.log('=== Current State ===');
    console.log('User UID:', currentUser?.uid);
    console.log('Device ID:', currentDeviceId);
    console.log('Session ID:', currentSessionId);
    console.log('Event Index:', currentEventIndex);
    console.log('Total Events:', currentSessionData?.events?.length || 0);
    console.log('Is Playing:', isPlaying);
    console.log('Playback Speed:', playbackSpeed + 'x');
    console.log('Current Time:', formatTime(currentTime));
    console.log('Total Duration:', formatTime(totalDuration));
};

/**
 * Debug function: List all recordings
 * Usage in browser console: listRecordings()
 */
window.listRecordings = function() {
    console.log('=== Recordings ===');
    Object.entries(allRecordings).forEach(([id, rec]) => {
        console.log(`- ${id.substring(0, 20)}... (${new Date(rec.timestamp).toLocaleString()})`);
    });
};