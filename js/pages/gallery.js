

import { auth, db } from "../api/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { ref, onValue,get, remove } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

/* ELEMENTS */
const gallery = document.getElementById("gallery");
const modal = document.getElementById("imageModal");
const modalImg = document.getElementById("modalImg");
const statusText = document.getElementById("status");
const filterSelect = document.getElementById("filterSelect");
const countText = document.getElementById("countText");
const imageIndex = document.getElementById("imageIndex");

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

let images = [];
let keys = [];
let currentIndex = 0;
let scale = 1;

let allEntries = [];

/* UPDATE INDEX DISPLAY */
function updateIndexDisplay() {
  const spans = imageIndex.querySelectorAll("span");
  spans[0].textContent = currentIndex + 1;
  spans[1].textContent = images.length;
}

/* AUTH & LOAD PHOTOS */
onAuthStateChanged(auth, user => {
  if (!user) {
    statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>Please log in to view your photos</p></div>';
    return;
  }

  const photosRef = ref(db, `users/${user.uid}/devices/${deviceId}/photos/all`);
  onValue(photosRef, snap => {
    gallery.innerHTML = "";
    images = [];
    keys = [];
    allEntries = [];
    if (!snap.exists()) {
      statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-image"></i><p>No photos available</p></div>';
      countText.textContent = "0 items";
      return;
    }
    statusText.textContent = "";
    allEntries = Object.entries(snap.val());
    renderGallery();
  });
});

/* FILTER */
filterSelect.onchange = () => renderGallery();

/* RENDER GALLERY BASED ON FILTER */
function renderGallery() {
  gallery.innerHTML = "";
  images = [];
  keys = [];
  const filter = filterSelect.value;

  const filtered = allEntries.filter(([key, val]) => {
    if (!val.type) return filter === "all";
    return filter === "all" || val.type === filter;
  });

  countText.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter-circle-xmark"></i><p>No photos match this filter</p></div>';
    return;
  }
  statusText.textContent = "";

  function renderBatch(start = 0, batchSize = 10) {
    const end = Math.min(start + batchSize, filtered.length);
    for (let i = start; i < end; i++) {
      const [key, val] = filtered[i];
      const url = typeof val === "string" ? val : val.url;
      if (!url) continue;
      keys.push(key);
      images.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.loading = "lazy";
      img.style.animationDelay = `${(i - start) * 0.05}s`;
      img.onclick = () => openModal(images.length - 1 - (end - 1 - i));
      gallery.prepend(img);
    }
    if (end < filtered.length) {
      requestAnimationFrame(() => renderBatch(end, batchSize));
    }
  }

  renderBatch();
}

/* MODAL */
function openModal(i) {
  currentIndex = i;
  scale = 1;
  modalImg.style.transform = "scale(1)";
  modalImg.src = images[i];
  modal.style.display = "flex";
  updateIndexDisplay();
  history.pushState(null, null, "#image");
}

const closeBtn = document.getElementById("closeBtn");
closeBtn.onclick = closeModal;
function closeModal() {
  modal.style.display = "none";
  modalImg.src = "";
  history.back();
}

/* NAVIGATION */
document.getElementById("prev").onclick = () => {
  openModal((currentIndex - 1 + images.length) % images.length);
};
document.getElementById("next").onclick = () => {
  openModal((currentIndex + 1) % images.length);
};

/* DELETE IMAGE */
document.getElementById("deleteBtn").onclick = () => {
  if (confirm("Delete this image permanently?")) {
    remove(ref(db, `users/${auth.currentUser.uid}/devices/${deviceId}/photos/all/${keys[currentIndex]}`));
    closeModal();
  }
};

/* DOWNLOAD IMAGE */
document.getElementById("downloadBtn").onclick = () => {
  const a = document.createElement("a");
  a.href = modalImg.src;
  a.download = `image_${Date.now()}`;
  a.click();
};

/* ZOOM */
modalImg.onwheel = e => {
  e.preventDefault();
  scale += e.deltaY * -0.001;
  scale = Math.min(Math.max(1, scale), 4);
  modalImg.style.transform = `scale(${scale})`;
  modalImg.style.cursor = scale > 1 ? "zoom-out" : "zoom-in";
};

/* BACK / ESC */
window.onpopstate = closeModal;
document.onkeydown = e => {
  if (e.key === "Escape") closeModal();
  if (modal.style.display === "flex") {
    if (e.key === "ArrowLeft") document.getElementById("prev").click();
    if (e.key === "ArrowRight") document.getElementById("next").click();
  }
};

// import { auth, db } from "../js/firebase.js";
// import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
// import { ref, onValue, remove } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

// /* ELEMENTS */
// const gallery = document.getElementById("gallery");
// const modal = document.getElementById("imageModal");
// const modalImg = document.getElementById("modalImg");
// const statusText = document.getElementById("status");
// const filterSelect = document.getElementById("filterSelect");
// const countText = document.getElementById("countText");
// const imageIndex = document.getElementById("imageIndex");

// let images = [];
// let keys = [];
// let currentIndex = 0;
// let scale = 1;

// let allEntries = [];

// /* UPDATE INDEX DISPLAY */
// function updateIndexDisplay() {
//   const spans = imageIndex.querySelectorAll("span");
//   spans[0].textContent = currentIndex + 1;
//   spans[1].textContent = images.length;
// }

// /* AUTH & LOAD PHOTOS */
// onAuthStateChanged(auth, user => {
//   if (!user) {
//     statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>Please log in to view your photos</p></div>';
//     return;
//   }

//   const photosRef = ref(db, `users/${user.uid}/photos/all`);
//   onValue(photosRef, snap => {
//     gallery.innerHTML = "";
//     images = [];
//     keys = [];
//     allEntries = [];
//     if (!snap.exists()) {
//       statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-image"></i><p>No photos available</p></div>';
//       countText.textContent = "0 items";
//       return;
//     }
//     statusText.textContent = "";
//     allEntries = Object.entries(snap.val());
//     renderGallery();
//   });
// });

// /* FILTER */
// filterSelect.onchange = () => renderGallery();

// /* RENDER GALLERY BASED ON FILTER */
// function renderGallery() {
//   gallery.innerHTML = "";
//   images = [];
//   keys = [];
//   const filter = filterSelect.value;

//   const filtered = allEntries.filter(([key, val]) => {
//     if (!val.type) return filter === "all";
//     return filter === "all" || val.type === filter;
//   });

//   countText.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

//   if (filtered.length === 0) {
//     statusText.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter-circle-xmark"></i><p>No photos match this filter</p></div>';
//     return;
//   }
//   statusText.textContent = "";

//   function renderBatch(start = 0, batchSize = 10) {
//     const end = Math.min(start + batchSize, filtered.length);
//     for (let i = start; i < end; i++) {
//       const [key, val] = filtered[i];
//       const url = typeof val === "string" ? val : val.url;
//       if (!url) continue;
//       keys.push(key);
//       images.push(url);
//       const img = document.createElement("img");
//       img.src = url;
//       img.loading = "lazy";
//       img.style.animationDelay = `${(i - start) * 0.05}s`;
//       img.onclick = () => openModal(images.length - 1 - (end - 1 - i));
//       gallery.prepend(img);
//     }
//     if (end < filtered.length) {
//       requestAnimationFrame(() => renderBatch(end, batchSize));
//     }
//   }

//   renderBatch();
// }

// /* MODAL */
// function openModal(i) {
//   currentIndex = i;
//   scale = 1;
//   modalImg.style.transform = "scale(1)";
//   modalImg.src = images[i];
//   modal.style.display = "flex";
//   updateIndexDisplay();
//   history.pushState(null, null, "#image");
// }

// const closeBtn = document.getElementById("closeBtn");
// closeBtn.onclick = closeModal;
// function closeModal() {
//   modal.style.display = "none";
//   modalImg.src = "";
//   history.back();
// }

// /* NAVIGATION */
// document.getElementById("prev").onclick = () => {
//   openModal((currentIndex - 1 + images.length) % images.length);
// };
// document.getElementById("next").onclick = () => {
//   openModal((currentIndex + 1) % images.length);
// };

// /* DELETE IMAGE */
// document.getElementById("deleteBtn").onclick = () => {
//   if (confirm("Delete this image permanently?")) {
//     remove(ref(db, `users/${auth.currentUser.uid}/photos/all/${keys[currentIndex]}`));
//     closeModal();
//   }
// };

// /* DOWNLOAD IMAGE */
// document.getElementById("downloadBtn").onclick = () => {
//   const a = document.createElement("a");
//   a.href = modalImg.src;
//   a.download = `image_${Date.now()}`;
//   a.click();
// };

// /* ZOOM */
// modalImg.onwheel = e => {
//   e.preventDefault();
//   scale += e.deltaY * -0.001;
//   scale = Math.min(Math.max(1, scale), 4);
//   modalImg.style.transform = `scale(${scale})`;
//   modalImg.style.cursor = scale > 1 ? "zoom-out" : "zoom-in";
// };

// /* BACK / ESC */
// window.onpopstate = closeModal;
// document.onkeydown = e => {
//   if (e.key === "Escape") closeModal();
//   if (modal.style.display === "flex") {
//     if (e.key === "ArrowLeft") document.getElementById("prev").click();
//     if (e.key === "ArrowRight") document.getElementById("next").click();
//   }
// };