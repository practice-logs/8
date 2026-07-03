import { db, auth } from "../api/firebase.js";
    import { ref, get,onValue } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

    const list = document.getElementById("webList");
    const loader = document.getElementById("loader");
    const emptyBox = document.getElementById("emptyBox");
    const searchInput = document.getElementById("searchInput");
    const summaryText = document.getElementById("summaryText");
    const countText = document.getElementById("countText");
    const deviceId = await getDeviceIdSafe();


    let allData = [];

    function updateSummary(count) {
      if (!count) {
        summaryText.textContent = "No website activity available for this device yet";
        countText.innerHTML = '<span class="footer-dot"></span>0 sites in activity';
      } else {
        summaryText.textContent = `Showing ${count} website${count === 1 ? "" : "s"} from recent activity`;
        countText.innerHTML = '<span class="footer-dot"></span>' + count + ' site' + (count === 1 ? '' : 's') + ' in activity';
      }
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

    /* Auth Check */
    onAuthStateChanged(auth, user => {
      if (!user) {
        location.href = "../login.html";
        return;
      }

      const uid = user.uid;
      const webRef = ref(db, `users/${uid}/devices/${deviceId}/webView`);

      onValue(webRef, snapshot => {
        loader.style.display = "none";
        list.innerHTML = "";
        allData = [];

        if (!snapshot.exists()) {
          emptyBox.style.display = "flex";
          updateSummary(0);
          return;
        }

        emptyBox.style.display = "none";

        snapshot.forEach(child => {
          allData.push({
            name: child.val().link || "Unknown",
            time: child.val().timestamp || "N/A"
          });
        });

        allData.reverse();
        render(allData);
      });
    });

    /* Render Function */
    function render(data) {
      list.innerHTML = "";

      if (!data.length) {
        emptyBox.style.display = "flex";
        updateSummary(0);
        return;
      }

      emptyBox.style.display = "none";
      updateSummary(data.length);

      data.forEach((item, index) => {
        let url = item.name;
        if (!url.startsWith("http")) {
          url = "https://" + url;
        }

        const row = document.createElement("div");
        row.className = "site-row";
        row.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;
        row.onclick = () => window.open(url, "_blank");

        const domainLabel = item.name.length > 40 ? item.name.slice(0, 37) + "..." : item.name;

        row.innerHTML = `
          <div class="site-info">
            <div class="site-name" title="${item.name}">${item.name}</div>
            <div class="site-meta">
              <i class="fa-regular fa-clock"></i>
              <span>${item.time}</span>
              <span class="site-domain-pill" title="${item.name}">
                ${domainLabel}
              </span>
            </div>
          </div>
          <div class="site-open">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </div>
        `;

        list.appendChild(row);
      });
    }

    /* Search */
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase();
      const filtered = allData.filter(i =>
        (i.name || "").toLowerCase().includes(q)
      );
      render(filtered);
    });