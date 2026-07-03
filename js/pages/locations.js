import { db, auth } from "../api/firebase.js";
import { ref, get,onValue } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const mapFrame = document.getElementById("mapFrame");
const historyList = document.getElementById("historyList");
const mapTitle = document.getElementById("mapTitle");
const liveBtn = document.getElementById("liveBtn");
const deviceId = await getDeviceIdSafe();


let liveLocation = null;
let viewingHistory = false;
function showMap(lat, lng) {
    mapFrame.src = `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
}

export async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return reject("Not logged in");

      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}

function switchToLive() {
    if (!liveLocation) return;
    viewingHistory = false;
    mapTitle.textContent = "📡 Live Location";
    liveBtn.style.display = "none";
    showMap(liveLocation.latitude, liveLocation.longitude);
}

onAuthStateChanged(auth, user => {
    if (!user) {
        historyList.innerHTML = `<div class="empty">User not logged in</div>`;
        return;
    }

    const uid = user.uid;

    // LIVE LOCATION
    onValue(ref(db, `users/${uid}/devices/${deviceId}/location/live`), snap => {
        if (!snap.exists()) return;
        liveLocation = snap.val();
        if (!viewingHistory) {
            showMap(liveLocation.lat, liveLocation.lng);
        }
    });

    // LOCATION HISTORY
    onValue(ref(db, `users/${uid}/devices/${deviceId}/location/history`), snap => {
        historyList.innerHTML = "";

        if (!snap.exists()) {
            historyList.innerHTML = `<div class="empty">No location history available</div>`;
            return;
        }

        Object.keys(snap.val()).reverse().forEach(key => {
            const loc = snap.val()[key];

            const item = document.createElement("div");
            item.className = "history-item";
            item.innerHTML = `
                <div class="coords">
                    Lat: ${loc.lat}<br>
                    Lng: ${loc.lng}
                </div>
                <div class="time">
                    ${loc.updatedAt ? new Date(loc.updatedAt).toLocaleString() : "—"}
                </div>
            `;

            item.onclick = () => {
                viewingHistory = true;
                mapTitle.textContent = "📍 Viewing History Location";
                liveBtn.style.display = "inline-block";
                showMap(loc.latitude, loc.longitude);
            };

            historyList.appendChild(item);
        });
    });
});

liveBtn.onclick = switchToLive;