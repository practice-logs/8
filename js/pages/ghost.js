import { db, auth } from '../api/firebase.js';
import { getDatabase, ref, set, update, onValue, get } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';

        // State
        let currentDeviceId = null;
        let statusUnsub = null;

        // 🔥 VOLUME ELEMENTS
        const volumeSlider = document.getElementById('volumeSlider');
        const volumeValue = document.getElementById('volumeValue');
        const volumePercent = document.getElementById('volumePercent');

        // DOM Elements
        const statusCard = document.getElementById('statusCard');
        const statusText = document.getElementById('statusText');
        const statusIndicator = document.getElementById('statusIndicator');
        const deviceInfo = document.getElementById('deviceInfo');
        const overlayOn = document.getElementById('overlayOn');
        const overlayOff = document.getElementById('overlayOff');
        const mediaType = document.getElementById('mediaType');
        const mediaUrl = document.getElementById('mediaUrl');
        const overlayTitle = document.getElementById('overlayTitle');
        const overlaySubtitle = document.getElementById('overlaySubtitle');
        const unlockEnabled = document.getElementById('unlockEnabled');
        const overlayPassword = document.getElementById('overlayPassword');
        const sendPasswordBtn = document.getElementById('sendPasswordBtn');
        const deployAll = document.getElementById('deployAll');  // 🔥 GLOBAL BUTTON
        const testVideo = document.getElementById('testVideo');
        const clearAll = document.getElementById('clearAll');
        const liveStatus = document.getElementById('liveStatus');

        // Get Device ID
        async function getDeviceIdSafe() {
            return new Promise((resolve) => {
                onAuthStateChanged(auth, async (user) => {
                    if (!user) {
                        resolve(null);
                        return;
                    }
                    try {
                        const snap = await get(ref(db, `users/${user.uid}/storeId`));
                        resolve(snap.val());
                    } catch (error) {
                        console.error('Error getting device ID:', error);
                        resolve(null);
                    }
                });
            });
        }

        // 🔥 PASSWORD BUTTON - SAME AS BEFORE
        async function sendPasswordCommand() {
            if (!currentDeviceId || !auth.currentUser) {
                showError('Device not connected!');
                return;
            }

            const password = overlayPassword.value.trim();
            if (!password) {
                showError('Please enter password!');
                return;
            }

            try {
                const overlayRef = ref(db, `users/${auth.currentUser.uid}/devices/${currentDeviceId}/overlay`);
                await update(overlayRef, {
                    unlock_enable: unlockEnabled.checked,
                    password: password
                });
                showSuccess('🔑 Password sent!');
                overlayPassword.value = '';
            } catch (error) {
                showError('Password send failed: ' + error.message);
            }
        }

        // 🔥 GLOBAL DEPLOY - ALL FIELDS AT ONCE
        async function deployAllCommand() {
            if (!currentDeviceId || !auth.currentUser) {
                showError('Device not connected!');
                return;
            }

            try {
                const overlayRef = ref(db, `users/${auth.currentUser.uid}/devices/${currentDeviceId}/overlay`);
                const allData = {
                    overlay: overlayOn.classList.contains('active'),
                    media_type: mediaType.value || '',
                    media_url: mediaUrl.value || '',
                    title: overlayTitle.value || 'System Maintenance',
                    subtitle: overlaySubtitle.value || 'Contact administrator',
                    unlock_enable: unlockEnabled.checked,
                    volume: parseInt(volumeSlider.value)
                };

                await set(overlayRef, allData);
                showSuccess('🌍 ALL FIELDS DEPLOYED!');
            } catch (error) {
                showError('Global deploy failed: ' + error.message);
            }
        }

        // 🔥 VOLUME SLIDER HANDLER
        volumeSlider.addEventListener('input', function() {
            const volume = parseInt(this.value);
            volumeValue.textContent = volume + '%';
            volumePercent.textContent = volume + '%';
            
            if (currentDeviceId && auth.currentUser) {
                update(ref(db, `users/${auth.currentUser.uid}/devices/${currentDeviceId}/overlay`), { volume: volume })
                    .then(() => console.log('🔊 Volume synced:', volume + '%'))
                    .catch(err => console.error('Volume sync failed:', err));
            }
        });

        // Auth Check & Init
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                statusText.textContent = 'Please log in';
                statusCard.classList.add('error');
                return;
            }

            statusText.textContent = 'Authenticated ✓ Loading devices...';
            currentDeviceId = await getDeviceIdSafe();
            
            if (currentDeviceId) {
                deviceInfo.textContent = `Device ID: ${currentDeviceId}`;
                loadLiveStatus(currentDeviceId);
                statusText.textContent = 'Connected ✓ Ready to control';
            } else {
                statusText.textContent = 'No device found';
                statusCard.classList.add('error');
            }
        });

        function loadLiveStatus(deviceId) {
            if (statusUnsub) statusUnsub();
            
            const statusRef = ref(db, `users/${auth.currentUser?.uid}/devices/${deviceId}/overlay`);
            statusUnsub = onValue(statusRef, (snapshot) => {
                const config = snapshot.val();
                if (config) {
                    updateUIFromConfig(config);
                    liveStatus.innerHTML = `
                        <div class="device-item">
                            <span>📱 Overlay: <strong>${config.overlay ? '🟢 ACTIVE' : '🔴 OFF'}</strong></span>
                            <span>🔊 Volume: <strong>${config.volume || 100}%</strong></span>
                            <span>🔐 Unlock: <strong>${config.unlock_enable ? '🟢 ON' : '❌ OFF'}</strong></span>
                            <span>Media: ${config.media_type || 'None'}</span>
                        </div>
                    `;
                    statusIndicator.style.background = config.overlay ? '#10b981' : '#6b7280';
                    overlayOn.classList.toggle('active', config.overlay);
                    overlayOff.classList.toggle('active', !config.overlay);
                }
            });
        }

        // Update UI from Firebase
        function updateUIFromConfig(config) {
            overlayTitle.value = config.title || '';
            overlaySubtitle.value = config.subtitle || '';
            mediaType.value = config.media_type || '';
            mediaUrl.value = config.media_url || '';
            unlockEnabled.checked = config.unlock_enable || false;
            overlayPassword.value = '';
            
            if (config.volume !== undefined) {
                const vol = Math.max(0, Math.min(100, config.volume));
                volumeSlider.value = vol;
                volumeValue.textContent = vol + '%';
                volumePercent.textContent = vol + '%';
            }
        }

        // Event Listeners
        sendPasswordBtn.addEventListener('click', sendPasswordCommand);  // 🔥 PASSWORD SEPARATE
        deployAll.addEventListener('click', deployAllCommand);           // 🔥 GLOBAL DEPLOY

        overlayOn.addEventListener('click', () => {
            overlayOn.classList.add('active');
            overlayOff.classList.remove('active');
            deployAllCommand();  // Use global deploy
        });

        overlayOff.addEventListener('click', () => {
            overlayOff.classList.add('active');
            overlayOn.classList.remove('active');
            deployAllCommand();  // Use global deploy
        });

        testVideo.addEventListener('click', () => {
            mediaType.value = 'video';
            mediaUrl.value = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
            deployAllCommand();  // Use global deploy
        });

        clearAll.addEventListener('click', async () => {
            if (!currentDeviceId) return;
            try {
                await set(ref(db, `users/${auth.currentUser.uid}/devices/${currentDeviceId}/overlay`), {
                    overlay: false,
                    media_type: '',
                    media_url: '',
                    title: '',
                    subtitle: '',
                    unlock_enable: false,
                    volume: 100
                });
                showSuccess('🗑️ All commands cleared!');
            } catch (error) {
                showError('Clear failed: ' + error.message);
            }
        });

        // NO real-time updates - only manual buttons now

        // Utils
        function showSuccess(message) {
            statusText.textContent = message;
            statusCard.classList.remove('error');
        }

        function showError(message) {
            statusText.textContent = message;
            statusCard.classList.add('error');
        }
