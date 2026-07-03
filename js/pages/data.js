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
let allSessions = {};
let allEvents = [];
let isRecordingActive = false;

const MOCK_DATA_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════════════════════

const sessionsList621 = document.getElementById("sessionsList621");
const headerSessionId392 = document.getElementById("headerSessionId392");
const headerPackage741 = document.getElementById("headerPackage741");
const headerDevice621 = document.getElementById("headerDevice621");
const headerDuration841 = document.getElementById("headerDuration841");
const headerEvents621 = document.getElementById("headerEvents621");
const overviewCards621 = document.getElementById("overviewCards621");
const timelineContainer621 = document.getElementById("timelineContainer621");
const accessibilityTableBody741 = document.getElementById("accessibilityTableBody741");
const touchTableBody621 = document.getElementById("touchTableBody621");
const screenshotContainer841 = document.getElementById("screenshotContainer841");
const jsonViewer741 = document.getElementById("jsonViewer741");
const sidebarStats621 = document.getElementById("sidebarStats621");
const drawerOverlay621 = document.getElementById("drawerOverlay621");
const eventDrawer841 = document.getElementById("eventDrawer841");
const drawerContent621 = document.getElementById("drawerContent621");
const closeDrawer621 = document.getElementById("closeDrawer621");
const globalSearch847 = document.getElementById("globalSearch847");
const exportBtn621 = document.getElementById("exportBtn621");
const copyJsonBtn621 = document.getElementById("copyJsonBtn621");
const downloadJsonBtn841 = document.getElementById("downloadJsonBtn841");
const filterCheckboxes841 = document.querySelectorAll(".filter-checkbox841");
const durationInput = document.getElementById("durationInput");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.log("Not authenticated");
        if (MOCK_DATA_ENABLED) {
            loadMockData();
        }
        return;
    }

    currentUser = user;
    try {
        const storeIdSnap = await get(ref(db, `users/${user.uid}/storeId`));
        currentDeviceId = storeIdSnap.val();

        if (currentDeviceId) {
            listenToRecordings();
            setupRecordingControls();
            listenToRecordingStatus();
        } else if (MOCK_DATA_ENABLED) {
            loadMockData();
        }
    } catch (error) {
        console.error("Auth error:", error);
        if (MOCK_DATA_ENABLED) loadMockData();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  RECORDING CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════════════════

function setupRecordingControls() {
    startBtn.addEventListener("click", sendStartCommand);
    stopBtn.addEventListener("click", sendStopCommand);
}

async function sendStartCommand() {
    if (!currentUser || !currentDeviceId) {
        alert("User or device not initialized");
        return;
    }

    const durationMinutes = parseInt(durationInput.value) || 5;
    if (durationMinutes < 1 || durationMinutes > 120) {
        alert("Duration must be between 1 and 120 minutes");
        return;
    }

    const durationSeconds = durationMinutes * 60;

    try {
        const commandRef = ref(
            db,
            `users/${currentUser.uid}/devices/${currentDeviceId}/recorder/command`
        );

        const commandPayload = {
            action: "START",
            duration_seconds: durationSeconds,
            timestamp: Date.now()
        };

        await set(commandRef, commandPayload);

        console.log("✓ Start command sent:", commandPayload);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        durationInput.disabled = true;
        isRecordingActive = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recording...';
    } catch (error) {
        console.error("Error sending start command:", error);
        alert("Failed to start recording: " + error.message);
    }
}

async function sendStopCommand() {
    if (!currentUser || !currentDeviceId) {
        alert("User or device not initialized");
        return;
    }

    try {
        const commandRef = ref(
            db,
            `users/${currentUser.uid}/devices/${currentDeviceId}/recorder/command`
        );

        await remove(commandRef);

        console.log("✓ Stop command sent");
        startBtn.disabled = false;
        stopBtn.disabled = true;
        durationInput.disabled = false;
        isRecordingActive = false;
        startBtn.innerHTML = '<i class="fas fa-play"></i> Start Recording';
        stopBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Recording';
    } catch (error) {
        console.error("Error sending stop command:", error);
        alert("Failed to stop recording: " + error.message);
    }
}

function listenToRecordingStatus() {
    if (!currentUser || !currentDeviceId) return;

    const statusRef = ref(
        db,
        `users/${currentUser.uid}/devices/${currentDeviceId}/recorder/status`
    );

    onValue(statusRef, (snapshot) => {
        if (!snapshot.exists()) return;

        const status = snapshot.val();
        console.log("Recording status:", status);

        if (status.recording === true) {
            isRecordingActive = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            durationInput.disabled = true;
            startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recording...';
            
            if (status.elapsed) {
                const seconds = Math.floor(status.elapsed / 1000);
                startBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recording... ${seconds}s`;
            }
        } else {
            isRecordingActive = false;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            durationInput.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-play"></i> Start Recording';
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  FIREBASE LISTENERS
// ═══════════════════════════════════════════════════════════════════════════════════════════

function listenToRecordings() {
    if (!currentUser || !currentDeviceId) return;

    onValue(
        ref(db, `users/${currentUser.uid}/devices/${currentDeviceId}/recordings`),
        (snapshot) => {
            allSessions = {};
            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    allSessions[child.key] = {
                        sessionId: child.key,
                        ...child.val(),
                    };
                });
            }
            renderSessions();
        },
        (error) => console.error("Recording listener error:", error)
    );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════════════════

function loadMockData() {
    const mockSession = generateMockSession();
    allSessions = {
        [mockSession.sessionId]: {
            sessionId: mockSession.sessionId,
            uid: "demo_user",
            deviceId: "demo_device",
            compressed: true,
            size: 65536,
            timestamp: Date.now(),
            data: compressGzipMock(JSON.stringify(mockSession))
        }
    };
    renderSessions();
}

function generateMockSession() {
    return {
        sessionId: "rec_" + Date.now(),
        uid: "demo_user",
        deviceId: "demo_device",
        startTime: Date.now() - 300000,
        endTime: Date.now(),
        eventCount: 15,
        events: [
            {
                ts: Date.now() - 250000,
                type: "VIEW_CLICKED",
                action: "CLICK",
                pkg: "com.example.app",
                node: {
                    className: "android.widget.Button",
                    text: "Login",
                    desc: "Login Button",
                    resourceId: "com.example.app:id/login_btn",
                    clickable: true,
                    focusable: true,
                    enabled: true,
                    password: false,
                    scrollable: false,
                    bounds: { left: 100, top: 200, right: 300, bottom: 280 }
                },
                clickPosition: { x: 200, y: 240, text: "Login" },
                screenSnapshot: {
                    package: "com.example.app",
                    fullText: "Login Username Password Sign Up Forgot Password",
                    screen: { width: 1440, height: 2560, density: 420, api: 31 },
                    elementCount: 8,
                    clickableCount: 3,
                    editableCount: 2,
                    scrollableCount: 1,
                    elements: [
                        {
                            t: "Login",
                            d: "Login Button",
                            cl: "Button",
                            vi: "com.example.app:id/login_btn",
                            dp: 2,
                            ck: true,
                            ed: false,
                            en: true,
                            fc: true,
                            sc: false,
                            pw: false,
                            b: { l: 100, t: 200, r: 300, b: 280, w: 200, h: 80, x: 200, y: 240 }
                        },
                        {
                            t: "Username",
                            cl: "EditText",
                            vi: "com.example.app:id/username",
                            dp: 2,
                            ck: true,
                            ed: true,
                            en: true,
                            fc: true,
                            sc: false,
                            pw: false,
                            b: { l: 50, t: 100, r: 350, b: 160, w: 300, h: 60, x: 200, y: 130 }
                        }
                    ],
                    clickablePositions: [
                        { 
                            label: "Login", 
                            x: 200, 
                            y: 240, 
                            left: 100,
                            top: 200,
                            width: 200, 
                            height: 80, 
                            class: "Button", 
                            viewId: "com.example.app:id/login_btn", 
                            editable: false,
                            enabled: true
                        },
                        {
                            label: "Username",
                            x: 200,
                            y: 130,
                            left: 50,
                            top: 100,
                            width: 300,
                            height: 60,
                            class: "EditText",
                            viewId: "com.example.app:id/username",
                            editable: true,
                            enabled: true
                        }
                    ]
                }
            },
            {
                ts: Date.now() - 200000,
                type: "VIEW_TEXT_CHANGED",
                action: "TEXT_CHANGE",
                pkg: "com.example.app",
                text: "John Doe",
                node: {
                    className: "android.widget.EditText",
                    text: "John Doe",
                    resourceId: "com.example.app:id/username",
                    clickable: true,
                    editable: true,
                    enabled: true,
                    focusable: true,
                    password: false,
                    scrollable: false,
                    bounds: { left: 50, top: 100, right: 350, bottom: 160 }
                }
            },
            {
                ts: Date.now() - 150000,
                type: "TOUCH",
                action: "DOWN",
                x: 200,
                y: 240,
                pressure: 0.5,
                size: 1.2,
                pointerCount: 1
            }
        ]
    };
}

function compressGzipMock(data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    return btoa(data);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DECOMPRESSION & PARSING
// ═══════════════════════════════════════════════════════════════════════════════════════════

function decompressGzip(base64Data) {
    try {
        if (typeof base64Data !== 'string') return null;

        base64Data = base64Data.trim();
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        if (typeof pako !== "undefined") {
            try {
                return pako.ungzip(bytes, { to: "string" });
            } catch (e) {
                console.warn("Pako failed:", e);
            }
        }

        return inflateRawDataSync(bytes);
    } catch (error) {
        console.error("Decompression error:", error);
        return null;
    }
}

function inflateRawDataSync(bytes) {
    try {
        const str = new TextDecoder().decode(bytes);
        JSON.parse(str);
        return str;
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  RENDER SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderSessions() {
    const sessions = Object.values(allSessions).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    sessionsList621.innerHTML = sessions
        .map(sess => `
            <div class="session-item634 ${sess.sessionId === currentSessionId ? 'active891' : ''}" 
                 data-session-id="${sess.sessionId}">
                <i class="fas fa-circle" style="font-size: 6px; margin-right: 6px;"></i>
                ${sess.sessionId.substring(0, 20)}...
            </div>
        `)
        .join("");

    sessionsList621.querySelectorAll(".session-item634").forEach(item => {
        item.addEventListener("click", () => loadSession(item.dataset.sessionId));
    });

    if (!currentSessionId && sessions.length > 0) {
        loadSession(sessions[0].sessionId);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  LOAD SESSION
// ═══════════════════════════════════════════════════════════════════════════════════════════

function loadSession(sessionId) {
    currentSessionId = sessionId;
    const session = allSessions[sessionId];
    
    if (!session) return;

    let jsonData = session.data;
    
    if (session.compressed || (typeof jsonData === 'string' && jsonData.length > 100)) {
        const decompressed = decompressGzip(jsonData);
        if (decompressed) jsonData = decompressed;
    }

    if (typeof jsonData === 'string') {
        try {
            currentSessionData = JSON.parse(jsonData);
        } catch (e) {
            console.error("Parse error:", e);
            currentSessionData = null;
        }
    } else {
        currentSessionData = jsonData;
    }

    if (!currentSessionData) {
        console.error("Failed to load session data");
        return;
    }

    allEvents = currentSessionData.events || [];

    updateHeader();
    renderOverview();
    renderTimeline();
    renderAccessibilityTable();
    renderTouchTable();
    renderScreenshot();
    renderJsonViewer();
    updateSidebarStats();

    sessionsList621.querySelectorAll(".session-item634").forEach(item => {
        item.classList.toggle("active891", item.dataset.sessionId === sessionId);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  UPDATE HEADER
// ═══════════════════════════════════════════════════════════════════════════════════════════

function updateHeader() {
    if (!currentSessionData) return;

    headerSessionId392.textContent = currentSessionData.sessionId?.substring(0, 16) + "..." || "—";
    const primaryPkg = allEvents.find(e => e.pkg)?.pkg || "Unknown";
    headerPackage741.textContent = primaryPkg;
    headerDevice621.textContent = currentSessionData.deviceId?.substring(0, 8) + "..." || "—";
    const duration = (currentSessionData.endTime || 0) - (currentSessionData.startTime || 0);
    headerDuration841.textContent = formatDuration(duration);
    headerEvents621.textContent = allEvents.length;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderOverview() {
    if (!currentSessionData) return;

    const stats = calculateStats();

    const cards = [
        { title: "Total Events", value: stats.totalEvents, icon: "fa-list" },
        { title: "Accessibility Events", value: stats.accessibilityEvents, icon: "fa-eye" },
        { title: "Touch Events", value: stats.touchEvents, icon: "fa-hand-paper" },
        { title: "Clicks", value: stats.clicks, icon: "fa-mouse" },
        { title: "Long Clicks", value: stats.longClicks, icon: "fa-clock" },
        { title: "Text Changes", value: stats.textChanges, icon: "fa-keyboard" },
        { title: "Window Changes", value: stats.windowChanges, icon: "fa-window-restore" },
        { title: "Announcements", value: stats.announcements, icon: "fa-speaker" },
        { title: "Packages Visited", value: stats.packageCount, icon: "fa-box" },
        { title: "Recording Duration", value: formatDuration((currentSessionData.endTime || 0) - (currentSessionData.startTime || 0)), icon: "fa-hourglass" }
    ];

    overviewCards621.innerHTML = cards
        .map(card => `
            <div class="stat-card742">
                <div style="color: var(--accent); font-size: 20px; margin-bottom: 8px;">
                    <i class="fas ${card.icon}"></i>
                </div>
                <div class="card-title821">${card.title}</div>
                <div class="card-value561">${card.value}</div>
            </div>
        `)
        .join("");
}

function calculateStats() {
    const stats = {
        totalEvents: allEvents.length,
        accessibilityEvents: 0,
        touchEvents: 0,
        clicks: 0,
        longClicks: 0,
        textChanges: 0,
        windowChanges: 0,
        announcements: 0,
        packageCount: 0,
        packages: new Set()
    };

    allEvents.forEach(evt => {
        if (evt.type === "TOUCH") {
            stats.touchEvents++;
        } else {
            stats.accessibilityEvents++;
            
            if (evt.action === "CLICK") stats.clicks++;
            else if (evt.action === "LONG_CLICK") stats.longClicks++;
            else if (evt.action === "TEXT_CHANGE") stats.textChanges++;
            else if (evt.action === "WINDOW_CHANGE") stats.windowChanges++;
            else if (evt.action === "ANNOUNCEMENT") stats.announcements++;
        }

        if (evt.pkg) stats.packages.add(evt.pkg);
    });

    stats.packageCount = stats.packages.size;
    return stats;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  TIMELINE TAB
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderTimeline() {
    if (!allEvents.length) {
        timelineContainer621.innerHTML = '<div class="empty-state741"><div class="empty-icon921"><i class="fas fa-inbox"></i></div><div class="empty-text621">No events recorded</div></div>';
        return;
    }

    timelineContainer621.innerHTML = allEvents
        .map((evt, idx) => {
            const time = new Date(evt.ts).toLocaleTimeString();
            const icon = getEventIcon(evt);
            const type = evt.type || "UNKNOWN";
            const action = evt.action || "";
            const pkg = evt.pkg?.split('.').pop() || "";

            return `
                <div class="timeline-item841" data-event-idx="${idx}">
                    <div class="timeline-content391">
                        <div class="timeline-time841">${time}</div>
                        <div class="timeline-type621">
                            <div class="timeline-icon941"><i class="${icon}"></i></div>
                            <div class="timeline-title821">${type} ${action}</div>
                        </div>
                        <div class="timeline-desc741">
                            ${pkg ? `Package: <strong>${pkg}</strong>` : ''}
                            ${evt.node?.text ? `<br>Text: <strong>${evt.node.text}</strong>` : ''}
                            ${evt.clickPosition?.text ? `<br>Clicked: <strong>${evt.clickPosition.text}</strong>` : ''}
                        </div>
                    </div>
                </div>
            `;
        })
        .join("");

    timelineContainer621.querySelectorAll(".timeline-item841").forEach(item => {
        item.addEventListener("click", () => {
            const idx = parseInt(item.dataset.eventIdx);
            showEventDetail(idx);
        });
    });
}

function getEventIcon(evt) {
    if (evt.type === "VIEW_CLICKED") return "fas fa-mouse";
    if (evt.type === "VIEW_LONG_CLICKED") return "fas fa-clock";
    if (evt.type === "VIEW_TEXT_CHANGED") return "fas fa-keyboard";
    if (evt.type === "VIEW_FOCUSED") return "fas fa-eye";
    if (evt.type === "WINDOW_STATE_CHANGED") return "fas fa-window-restore";
    if (evt.type === "TOUCH") return "fas fa-hand-paper";
    return "fas fa-circle";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  ACCESSIBILITY EVENTS TABLE
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderAccessibilityTable() {
    const a11yEvents = allEvents.filter(e => e.type !== "TOUCH");

    if (!a11yEvents.length) {
        accessibilityTableBody741.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-tertiary);">No accessibility events</td></tr>';
        return;
    }

    accessibilityTableBody741.innerHTML = a11yEvents
        .map((evt, idx) => {
            const time = new Date(evt.ts).toLocaleTimeString();
            const nodeText = evt.node?.text || evt.clickPosition?.text || "—";
            const nodeClass = evt.node?.className || "—";
            const clickable = evt.node?.clickable ? '<span class="badge-tag891 badge-success842">Yes</span>' : '—';

            return `
                <tr style="cursor: pointer;" onclick="window.showEventDetail(${idx})">
                    <td>${time}</td>
                    <td><span class="badge-tag891 badge-info904">${evt.type || "UNKNOWN"}</span></td>
                    <td>${evt.action || "—"}</td>
                    <td><code style="font-size: 11px; color: var(--text-secondary);">${evt.pkg?.split('.').pop() || "—"}</code></td>
                    <td style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${nodeText}</td>
                    <td style="font-size: 11px; color: var(--text-secondary);">${nodeClass}</td>
                    <td>${clickable}</td>
                </tr>
            `;
        })
        .join("");

    window.showEventDetail = showEventDetail;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  TOUCH EVENTS TABLE
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderTouchTable() {
    const touchEvents = allEvents.filter(e => e.type === "TOUCH");

    if (!touchEvents.length) {
        touchTableBody621.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-tertiary);">No touch events</td></tr>';
        return;
    }

    touchTableBody621.innerHTML = touchEvents
        .map(evt => {
            const time = new Date(evt.ts).toLocaleTimeString();
            return `
                <tr>
                    <td>${time}</td>
                    <td><span class="badge-tag891 badge-warning791">${evt.action || "—"}</span></td>
                    <td>${Math.round(evt.x || 0)}</td>
                    <td>${Math.round(evt.y || 0)}</td>
                    <td>${(evt.pressure || 0).toFixed(2)}</td>
                    <td>${(evt.size || 0).toFixed(2)}</td>
                    <td>${evt.pointerCount || 1}</td>
                </tr>
            `;
        })
        .join("");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  SCREENSHOT TAB
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderScreenshot() {
    const snapshotEvents = allEvents.filter(e => e.screenSnapshot);

    if (!snapshotEvents.length) {
        screenshotContainer841.innerHTML = '<div class="empty-state741"><div class="empty-icon921"><i class="fas fa-image"></i></div><div class="empty-text621">No screen snapshots available</div></div>';
        return;
    }

    const latest = snapshotEvents[snapshotEvents.length - 1];
    const snap = latest.screenSnapshot;

    let html = `
        <div style="margin-bottom: 20px;">
            <h3 style="margin-bottom: 12px; color: var(--accent);">Latest Screen Snapshot</h3>
            <div class="card-container562">
                <div class="stat-card742">
                    <div class="card-title821">Package</div>
                    <div class="info-value327" style="font-size: 13px; word-break: break-all;">${snap.package || "—"}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Elements</div>
                    <div class="card-value561">${snap.elementCount || 0}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Clickable</div>
                    <div class="card-value561">${snap.clickableCount || 0}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Editable</div>
                    <div class="card-value561">${snap.editableCount || 0}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Scrollable</div>
                    <div class="card-value561">${snap.scrollableCount || 0}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Screen</div>
                    <div class="info-value327" style="font-size: 11px;">${snap.screen?.width || 0}x${snap.screen?.height || 0}</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">Density</div>
                    <div class="info-value327" style="font-size: 13px;">${snap.screen?.density || 0} dpi</div>
                </div>
                <div class="stat-card742">
                    <div class="card-title821">API Level</div>
                    <div class="card-value561">${snap.screen?.api || 0}</div>
                </div>
            </div>
        </div>
    `;

    if (snap.fullText) {
        html += `
            <div style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 12px; color: var(--accent);">Full Visible Text</h3>
                <div class="table-wrapper821">
                    <div style="padding: 12px; background: var(--bg-tertiary); border-radius: var(--radius-md); font-size: 12px; line-height: 1.6;">
                        ${snap.fullText}
                    </div>
                </div>
            </div>
        `;
    }

    if (snap.clickablePositions && snap.clickablePositions.length) {
        html += `
            <div style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 12px; color: var(--accent);">Clickable Positions (${snap.clickablePositions.length})</h3>
                <div class="table-wrapper821">
                    <div class="table-scroll741">
                        <table>
                            <thead>
                                <tr>
                                    <th>Label</th>
                                    <th>X, Y</th>
                                    <th>Class</th>
                                    <th>View ID</th>
                                    <th>Size</th>
                                    <th>Props</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${snap.clickablePositions.slice(0, 50).map(pos => `
                                    <tr>
                                        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${pos.label || "—"}</td>
                                        <td><code style="font-size: 10px;">${pos.x || 0}, ${pos.y || 0}</code></td>
                                        <td>${pos.class || "—"}</td>
                                        <td style="font-size: 10px; max-width: 120px; overflow: hidden; text-overflow: ellipsis;">${pos.viewId || "—"}</td>
                                        <td>${pos.width || 0}×${pos.height || 0}</td>
                                        <td>${pos.editable ? '<span class="badge-tag891 badge-success842">Ed</span>' : ''} ${pos.longClickable ? '<span class="badge-tag891 badge-warning791">LC</span>' : ''}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    if (snap.elements && snap.elements.length) {
        html += `
            <div>
                <h3 style="margin-bottom: 12px; color: var(--accent);">Element Hierarchy (${snap.elements.length} elements)</h3>
                <div class="table-wrapper821">
                    <div class="table-scroll741">
                        <table>
                            <thead>
                                <tr>
                                    <th>Depth</th>
                                    <th>Text</th>
                                    <th>Class</th>
                                    <th>Properties</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${snap.elements.slice(0, 50).map(elem => {
                                    const props = [];
                                    if (elem.ck) props.push('Ck');
                                    if (elem.ed) props.push('Ed');
                                    if (elem.sc) props.push('Sc');
                                    if (elem.pw) props.push('Pw');
                                    return `
                                        <tr>
                                            <td><span class="badge-tag891 badge-info904">${elem.dp || 0}</span></td>
                                            <td style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${elem.t || elem.d || "—"}</td>
                                            <td style="font-size: 11px; color: var(--text-secondary);">${elem.cl || "—"}</td>
                                            <td style="font-size: 10px;">${props.join(', ') || "—"}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    screenshotContainer841.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  JSON VIEWER
// ═══════════════════════════════════════════════════════════════════════════════════════════

function renderJsonViewer() {
    if (!currentSessionData) return;

    const json = JSON.stringify(currentSessionData, null, 2);
    jsonViewer741.innerHTML = `<pre>${escapeHtml(json)}</pre>`;

    copyJsonBtn621.onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(currentSessionData, null, 2));
        copyJsonBtn621.textContent = "✓ Copied!";
        setTimeout(() => {
            copyJsonBtn621.innerHTML = '<i class="fas fa-copy"></i> Copy';
        }, 2000);
    };

    downloadJsonBtn841.onclick = () => {
        const blob = new Blob([JSON.stringify(currentSessionData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = currentSessionData.sessionId + ".json";
        a.click();
        URL.revokeObjectURL(url);
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  EVENT DETAIL DRAWER
// ═══════════════════════════════════════════════════════════════════════════════════════════

function showEventDetail(eventIdx) {
    const evt = allEvents[eventIdx];
    if (!evt) return;

    const time = new Date(evt.ts).toLocaleTimeString();
    const icon = getEventIcon(evt);

    let html = `
        <div class="drawer-section742">
            <div class="drawer-section-title891">Basic Info</div>
            <table style="width: 100%; font-size: 12px;">
                <tr><td style="color: var(--text-tertiary); padding: 6px 0;">Timestamp</td><td style="text-align: right; font-weight: 500;">${time}</td></tr>
                <tr><td style="color: var(--text-tertiary); padding: 6px 0;">Type</td><td style="text-align: right; font-weight: 500;">${evt.type || "—"}</td></tr>
                <tr><td style="color: var(--text-tertiary); padding: 6px 0;">Action</td><td style="text-align: right; font-weight: 500;">${evt.action || "—"}</td></tr>
                <tr><td style="color: var(--text-tertiary); padding: 6px 0;">Package</td><td style="text-align: right; font-weight: 500; word-break: break-all;">${evt.pkg || "—"}</td></tr>
            </table>
        </div>
    `;

    if (evt.node) {
        html += `
            <div class="drawer-section742">
                <div class="drawer-section-title891">Node Details</div>
                <table style="width: 100%; font-size: 12px;">
                    ${evt.node.text ? `<tr><td style="color: var(--text-tertiary);">Text</td><td>${evt.node.text}</td></tr>` : ''}
                    ${evt.node.desc ? `<tr><td style="color: var(--text-tertiary);">Description</td><td>${evt.node.desc}</td></tr>` : ''}
                    ${evt.node.className ? `<tr><td style="color: var(--text-tertiary);">Class</td><td style="font-size: 10px; word-break: break-all;">${evt.node.className}</td></tr>` : ''}
                    ${evt.node.resourceId ? `<tr><td style="color: var(--text-tertiary);">View ID</td><td style="font-size: 10px; word-break: break-all;">${evt.node.resourceId}</td></tr>` : ''}
                    <tr><td style="color: var(--text-tertiary);">Clickable</td><td>${evt.node.clickable ? '✓' : '✗'}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Editable</td><td>${evt.node.editable ? '✓' : '✗'}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Enabled</td><td>${evt.node.enabled ? '✓' : '✗'}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Focusable</td><td>${evt.node.focusable ? '✓' : '✗'}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Scrollable</td><td>${evt.node.scrollable ? '✓' : '✗'}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Password</td><td>${evt.node.password ? '✓' : '✗'}</td></tr>
                    ${evt.node.bounds ? `<tr><td style="color: var(--text-tertiary);">Bounds</td><td style="font-size: 10px;">(${evt.node.bounds.left}, ${evt.node.bounds.top}) → (${evt.node.bounds.right}, ${evt.node.bounds.bottom})</td></tr>` : ''}
                </table>
            </div>
        `;
    }

    if (evt.clickPosition) {
        html += `
            <div class="drawer-section742">
                <div class="drawer-section-title891">Click Position</div>
                <table style="width: 100%; font-size: 12px;">
                    <tr><td style="color: var(--text-tertiary);">X, Y</td><td>${evt.clickPosition.x || 0}, ${evt.clickPosition.y || 0}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Text</td><td>${evt.clickPosition.text || "—"}</td></tr>
                    ${evt.clickPosition.viewId ? `<tr><td style="color: var(--text-tertiary);">View ID</td><td style="font-size: 10px; word-break: break-all;">${evt.clickPosition.viewId}</td></tr>` : ''}
                    ${evt.clickPosition.bounds ? `<tr><td style="color: var(--text-tertiary);">Size</td><td>${evt.clickPosition.bounds.width || 0}×${evt.clickPosition.bounds.height || 0}</td></tr>` : ''}
                </table>
            </div>
        `;
    }

    if (evt.type === "TOUCH") {
        html += `
            <div class="drawer-section742">
                <div class="drawer-section-title891">Touch Data</div>
                <table style="width: 100%; font-size: 12px;">
                    <tr><td style="color: var(--text-tertiary);">X</td><td>${Math.round(evt.x || 0)}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Y</td><td>${Math.round(evt.y || 0)}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Pressure</td><td>${(evt.pressure || 0).toFixed(3)}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Size</td><td>${(evt.size || 0).toFixed(3)}</td></tr>
                    <tr><td style="color: var(--text-tertiary);">Pointers</td><td>${evt.pointerCount || 1}</td></tr>
                </table>
            </div>
        `;
    }

    html += `
        <div class="drawer-section742">
            <div class="drawer-section-title891">Raw JSON</div>
            <div class="json-viewer621"><pre>${escapeHtml(JSON.stringify(evt, null, 2))}</pre></div>
        </div>
    `;

    drawerContent621.innerHTML = html;
    eventDrawer841.classList.add("active891");
    drawerOverlay621.classList.add("active891");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  SIDEBAR STATS
// ═══════════════════════════════════════════════════════════════════════════════════════════

function updateSidebarStats() {
    const stats = calculateStats();

    sidebarStats621.innerHTML = `
        <div class="stat-row923">
            <span class="stat-label784">Events</span>
            <span class="stat-value641">${stats.totalEvents}</span>
        </div>
        <div class="stat-row923">
            <span class="stat-label784">Accessibility</span>
            <span class="stat-value641">${stats.accessibilityEvents}</span>
        </div>
        <div class="stat-row923">
            <span class="stat-label784">Touch</span>
            <span class="stat-value641">${stats.touchEvents}</span>
        </div>
        <div class="stat-row923">
            <span class="stat-label784">Clicks</span>
            <span class="stat-value641">${stats.clicks}</span>
        </div>
        <div class="stat-row923">
            <span class="stat-label784">Packages</span>
            <span class="stat-value641">${stats.packageCount}</span>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════════════════

document.querySelectorAll(".tab-btn621").forEach(btn => {
    btn.addEventListener("click", () => {
        const tabName = btn.dataset.tab;

        document.querySelectorAll(".tab-btn621").forEach(b => b.classList.remove("active891"));
        btn.classList.add("active891");

        document.querySelectorAll(".tab-content741").forEach(content => {
            content.classList.remove("active891");
        });
        document.querySelector(`.tab-content741[data-tab="${tabName}"]`).classList.add("active891");
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DRAWER CLOSE
// ═══════════════════════════════════════════════════════════════════════════════════════════

closeDrawer621.addEventListener("click", () => {
    eventDrawer841.classList.remove("active891");
    drawerOverlay621.classList.remove("active891");
});

drawerOverlay621.addEventListener("click", () => {
    eventDrawer841.classList.remove("active891");
    drawerOverlay621.classList.remove("active891");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════════════════

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs}s`;
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

const script = document.createElement("script");
script.src = "https://cdn.jsdelivr.net/npm/pako/dist/pako.min.js";
script.async = true;
document.head.appendChild(script);

console.log("Dashboard v5 initialized - Complete screen snapshots enabled");