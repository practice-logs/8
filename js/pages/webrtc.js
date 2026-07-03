/**
 * webrtc.js — WebRTC Transport Layer
 *
 * Responsibilities:
 * - Firebase signaling (Offer/Answer/ICE)
 * - PeerConnection lifecycle
 * - DataChannel creation & callbacks
 * - Message send/receive (JSON & binary)
 * - Connection state management
 * - Reconnection logic
 *
 * No UI logic. No file manager logic.
 * Pure transport abstraction.
 */

import { db, auth } from '../api/firebase.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, ref, get, set, onValue, off } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';

// ═══════════════════════════════════════════════════════════════════════
//  WebRTC Configuration
// ═══════════════════════════════════════════════════════════════════════

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
];

const RTC_CONFIG = {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
};

// ═══════════════════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════════════════

let peerConnection = null;
let dataChannel = null;
let isConnected = false;
let isConnecting = false;
let isDestroyed = false;

let currentUid = null;
let deviceId = null;

// Firebase references for signaling
let signalingRef = null;
let signalingUnsubscribe = null;
let iceCandidatesRef = null;
let iceUnsubscribe = null;

// Message callbacks
let onMessageCallback = null;
let onOpenCallback = null;
let onCloseCallback = null;
let onErrorCallback = null;

// Connection timeout
let connectionTimeout = null;

// ═══════════════════════════════════════════════════════════════════════
//  Callbacks
// ═══════════════════════════════════════════════════════════════════════

export function onMessage(callback) {
    onMessageCallback = callback;
}

export function onOpen(callback) {
    onOpenCallback = callback;
}

export function onClose(callback) {
    onCloseCallback = callback;
}

export function onError(callback) {
    onErrorCallback = callback;
}

// ═══════════════════════════════════════════════════════════════════════
//  Initialization
// ═══════════════════════════════════════════════════════════════════════

/**
 * Initialize WebRTC with Firebase authentication.
 * Call once on app start.
 */
export function initialize() {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUid = user.uid;
                try {
                    // Fetch device ID
                    const snap = await get(ref(db, `users/${user.uid}/storeId`));
                    deviceId = snap.val();

                    if (!deviceId) {
                        throw new Error('Device ID not found');
                    }

                    console.log('✅ WebRTC initialized for device:', deviceId);
                    resolve();
                } catch (error) {
                    console.error('❌ WebRTC initialization failed:', error);
                    if (onErrorCallback) onErrorCallback(error.message);
                    reject(error);
                }
            } else {
                reject(new Error('Not authenticated'));
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  Connection
// ═══════════════════════════════════════════════════════════════════════

/**
 * Establish WebRTC connection with Android device.
 * Flow: Create Offer → Store in Firebase → Wait for Answer
 */
export async function connect() {
    if (isConnected || isConnecting) {
        console.warn('⚠️ Already connected or connecting');
        return;
    }

    if (isDestroyed) {
        console.warn('⚠️ WebRTC destroyed, cannot reconnect');
        return;
    }

    if (!currentUid || !deviceId) {
        throw new Error('Not initialized');
    }

    isConnecting = true;

    try {
        // Create PeerConnection
        peerConnection = new RTCPeerConnection(RTC_CONFIG);
        setupPeerConnectionCallbacks();

        // Create DataChannel
        dataChannel = peerConnection.createDataChannel('fileManager', {
            ordered: true,
            maxRetransmits: 3,
        });
        setupDataChannelCallbacks();

        // Create Offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Store Offer in Firebase
        signalingRef = ref(db, `users/${currentUid}/devices/${deviceId}/webrtc/signaling`);
        await set(signalingRef, {
            type: 'offer',
            sdp: offer.sdp,
            timestamp: Date.now(),
        });

        console.log('📤 Offer sent to Firebase');

        // Wait for Answer
        setupSignalingListener();
        listenForIceCandidates();

        // Set connection timeout
        clearTimeout(connectionTimeout);
        connectionTimeout = setTimeout(() => {
            if (!isConnected) {
                console.error('❌ Connection timeout');
                disconnect();
                if (onErrorCallback) onErrorCallback('Connection timeout');
            }
        }, 30000);

    } catch (error) {
        console.error('❌ Connection failed:', error);
        isConnecting = false;
        if (onErrorCallback) onErrorCallback(error.message);
        throw error;
    }
}

/**
 * Disconnect WebRTC connection.
 */
export function disconnect() {
    if (dataChannel) {
        try { dataChannel.close(); } catch (e) {}
        dataChannel = null;
    }

    if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
    }

    isConnected = false;
    isConnecting = false;

    // Cleanup Firebase listeners
    if (signalingUnsubscribe) signalingUnsubscribe();
    if (iceUnsubscribe) iceUnsubscribe();

    clearTimeout(connectionTimeout);

    console.log('✅ Disconnected');
}

/**
 * Destroy WebRTC completely.
 */
export function destroy() {
    isDestroyed = true;
    disconnect();
    console.log('✅ WebRTC destroyed');
}

// ═══════════════════════════════════════════════════════════════════════
//  PeerConnection Callbacks
// ═══════════════════════════════════════════════════════════════════════

function setupPeerConnectionCallbacks() {
    if (!peerConnection) return;

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            storeIceCandidate(event.candidate);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log('🔌 Connection state:', state);

        if (state === 'connected' || state === 'completed') {
            isConnected = true;
            isConnecting = false;
            clearTimeout(connectionTimeout);
            console.log('✅ WebRTC Connected');
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            isConnected = false;
            if (onCloseCallback) onCloseCallback();
        }
    };

    peerConnection.ondatachannel = (event) => {
        console.log('📡 DataChannel received');
        dataChannel = event.channel;
        setupDataChannelCallbacks();
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  DataChannel Callbacks
// ═══════════════════════════════════════════════════════════════════════

function setupDataChannelCallbacks() {
    if (!dataChannel) return;

    dataChannel.onopen = () => {
        console.log('📤 DataChannel OPEN');
        isConnected = true;
        isConnecting = false;
        clearTimeout(connectionTimeout);
        if (onOpenCallback) onOpenCallback();
    };

    dataChannel.onclose = () => {
        console.log('📥 DataChannel CLOSED');
        isConnected = false;
        if (onCloseCallback) onCloseCallback();
    };

    dataChannel.onerror = (error) => {
        console.error('❌ DataChannel error:', error);
        if (onErrorCallback) onErrorCallback(error.message);
    };

    dataChannel.onmessage = (event) => {
        handleDataChannelMessage(event.data);
    };

    dataChannel.onbufferedamountlow = () => {
        console.log('📊 DataChannel buffer cleared');
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Handling
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle incoming messages from DataChannel.
 * Can be JSON (strings) or binary (Blob/ArrayBuffer).
 */
function handleDataChannelMessage(data) {
    try {
        if (typeof data === 'string') {
            // JSON message
            const json = JSON.parse(data);
            if (onMessageCallback) {
                onMessageCallback({ type: 'json', data: json });
            }
        } else if (data instanceof ArrayBuffer) {
            // Binary message
            if (onMessageCallback) {
                onMessageCallback({ type: 'binary', data: data });
            }
        } else if (data instanceof Blob) {
            // Blob message
            data.arrayBuffer().then(buffer => {
                if (onMessageCallback) {
                    onMessageCallback({ type: 'binary', data: buffer });
                }
            });
        }
    } catch (error) {
        console.error('❌ Message handling error:', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Sending Messages
// ═══════════════════════════════════════════════════════════════════════

/**
 * Send JSON message over DataChannel.
 */
export function sendJson(json) {
    if (!isConnected || !dataChannel) {
        console.warn('⚠️ DataChannel not connected');
        return false;
    }

    try {
        const jsonStr = JSON.stringify(json);
        dataChannel.send(jsonStr);
        return true;
    } catch (error) {
        console.error('❌ Send JSON error:', error);
        return false;
    }
}

/**
 * Send binary data over DataChannel.
 */
export function sendBinary(buffer) {
    if (!isConnected || !dataChannel) {
        console.warn('⚠️ DataChannel not connected');
        return false;
    }

    try {
        if (!(buffer instanceof ArrayBuffer)) {
            console.error('❌ sendBinary requires ArrayBuffer');
            return false;
        }

        dataChannel.send(buffer);
        return true;
    } catch (error) {
        console.error('❌ Send binary error:', error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Firebase Signaling
// ═══════════════════════════════════════════════════════════════════════

/**
 * Setup listener for signaling (Answer from Android).
 */
function setupSignalingListener() {
    if (!signalingRef) return;

    signalingUnsubscribe = onValue(signalingRef, async (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        if (data.type === 'answer' && peerConnection && peerConnection.signalingState === 'have-local-offer') {
            try {
                console.log('📥 Answer received from Firebase');
                const answer = new RTCSessionDescription({
                    type: 'answer',
                    sdp: data.sdp,
                });
                await peerConnection.setRemoteDescription(answer);
            } catch (error) {
                console.error('❌ Failed to set remote description:', error);
            }
        }
    });
}

/**
 * Store ICE candidate in Firebase.
 */
function storeIceCandidate(candidate) {
    if (!currentUid || !deviceId) return;

    const candidateRef = ref(db, `users/${currentUid}/devices/${deviceId}/webrtc/candidates/${Date.now()}`);
    set(candidateRef, {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
        timestamp: Date.now(),
    }).catch(error => {
        console.error('❌ Failed to store ICE candidate:', error);
    });
}

/**
 * Listen for ICE candidates from Android.
 */
function listenForIceCandidates() {
    if (!currentUid || !deviceId) return;

    iceCandidatesRef = ref(db, `users/${currentUid}/devices/${deviceId}/webrtc/candidates`);
    iceUnsubscribe = onValue(iceCandidatesRef, (snapshot) => {
        const data = snapshot.val();
        if (!data || !peerConnection) return;

        Object.values(data).forEach(candidateData => {
            try {
                const candidate = new RTCIceCandidate({
                    candidate: candidateData.candidate,
                    sdpMLineIndex: candidateData.sdpMLineIndex,
                    sdpMid: candidateData.sdpMid,
                });
                peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.error('❌ Failed to add ICE candidate:', error);
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  Connection State
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if WebRTC is connected.
 */
export function isReady() {
    return isConnected && dataChannel && dataChannel.readyState === 'open';
}

/**
 * Get connection state.
 */
export function getState() {
    return {
        isConnected,
        isConnecting,
        isDestroyed,
        dataChannelReady: dataChannel ? dataChannel.readyState : 'closed',
        peerConnectionState: peerConnection ? peerConnection.connectionState : 'new',
    };
}

/**
 * Get buffered data amount.
 */
export function getBufferedAmount() {
    return dataChannel ? dataChannel.bufferedAmount : 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  Auto-reconnection (Optional)
// ═══════════════════════════════════════════════════════════════════════

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

/**
 * Auto-reconnect on disconnection.
 */
export function enableAutoReconnect() {
    onClose(() => {
        if (isDestroyed) return;

        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            console.log(`🔄 Reconnecting... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => {
                connect().catch(error => {
                    console.error('❌ Reconnection failed:', error);
                });
            }, RECONNECT_DELAY);
        } else {
            console.error('❌ Max reconnection attempts reached');
            reconnectAttempts = 0;
        }
    });
}

/**
 * Reset reconnection counter.
 */
function resetReconnectCounter() {
    reconnectAttempts = 0;
}

// When connection succeeds, reset counter
onOpen(() => {
    resetReconnectCounter();
});