import { db, auth } from "../api/firebase.js";
import {
  ref, get, onValue, push, set, remove
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// ─── Device ID — same pattern as call.js ─────────────────────────
export async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return reject("Not logged in");
      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}
const deviceId = await getDeviceIdSafe();

// ─── Canvas Setup — EXACT phone aspect 9:16 ──────────────────────
const CANVAS_W = 540;
const CANVAS_H = 960;

const canvas = document.getElementById("drawingCanvas");
const ctx    = canvas.getContext("2d");
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

// ─── DOM Elements ─────────────────────────────────────────────────
const wallpaperPreview  = document.getElementById("wallpaperPreview");
const lockSyncImg       = document.getElementById("lockSyncImg");
const systemSyncImg     = document.getElementById("systemSyncImg");
const syncStatus        = document.getElementById("syncStatus");
const btnSendDrawing    = document.getElementById("btnSendDrawing");
const btnSendImage      = document.getElementById("btnSendImage");
const btnClear          = document.getElementById("btnClear");
const btnUndo           = document.getElementById("btnUndo");
const btnRedo           = document.getElementById("btnRedo");
const btnEraser         = document.getElementById("btnEraser");
const btnFill           = document.getElementById("btnFill");
const colorPicker       = document.getElementById("colorPicker");
const strokeWidth       = document.getElementById("strokeWidth");
const strokePreview     = document.getElementById("strokePreview");
const opacitySlider     = document.getElementById("opacitySlider");
const bgColorPicker     = document.getElementById("bgColorPicker");
const imageUpload       = document.getElementById("imageUpload");
const successToast      = document.getElementById("successToast");
const toastText         = document.getElementById("toastText");
const lockSyncBox       = document.getElementById("lockSyncBox");
const systemSyncBox     = document.getElementById("systemSyncBox");
const lockSyncSource    = document.getElementById("lockSyncSource");
const lockSyncTime      = document.getElementById("lockSyncTime");
const systemSyncSource  = document.getElementById("systemSyncSource");
const systemSyncTime    = document.getElementById("systemSyncTime");
const lockPulse         = document.getElementById("lockPulse");
const systemPulse       = document.getElementById("systemPulse");
const canvasContainer   = document.getElementById("canvasContainer");
const colorPalette      = document.querySelectorAll(".palette-swatch");
const wallpaperTypeSelect = document.getElementById("wallpaperTypeSelect");

// ─── Drawing State ────────────────────────────────────────────────
let isDrawing    = false;
let eraserMode   = false;
let fillMode     = false;
let currentStroke = null;
let strokes      = [];
let undoStack    = [];
let redoStack    = [];
let brushOpacity = 1.0;
let currentWallpaperType = "lock"; // "lock" or "system"
let canvasDragging = false;
let canvasDragStart = {x: 0, y: 0};
let canvasOffset = {x: 0, y: 0};

// ─── Persistent Storage ───────────────────────────────────────────
function saveLockWallpaperLocal(base64) {
  try {
    localStorage.setItem('wallpaper_lock_current', base64);
    localStorage.setItem('wallpaper_lock_timestamp', Date.now().toString());
  } catch (e) { console.error("localStorage save failed", e); }
}

function saveSystemWallpaperLocal(base64) {
  try {
    localStorage.setItem('wallpaper_system_current', base64);
    localStorage.setItem('wallpaper_system_timestamp', Date.now().toString());
  } catch (e) { console.error("localStorage save failed", e); }
}

function loadLockWallpaperLocal() {
  try { return localStorage.getItem('wallpaper_lock_current'); } catch (e) { return null; }
}

function loadSystemWallpaperLocal() {
  try { return localStorage.getItem('wallpaper_system_current'); } catch (e) { return null; }
}

// ─── Canvas Init ──────────────────────────────────────────────────
function clearCanvas(bg = bgColorPicker.value) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}
clearCanvas();
updateStrokePreview();

// ─── Redraw All ───────────────────────────────────────────────────
function redrawAll() {
  clearCanvas(bgColorPicker.value);
  for (const s of strokes) {
    if (!s.points || s.points.length < 1) continue;
    ctx.save();
    ctx.globalAlpha    = s.opacity ?? 1;
    ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
    ctx.strokeStyle    = s.color;
    ctx.lineWidth      = s.strokeWidth;
    ctx.lineCap        = "round";
    ctx.lineJoin       = "round";
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Position ─────────────────────────────────────────────────────
function getPos(e) {
  const rect  = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
}

// ─── Fill (flood-fill bucket) ─────────────────────────────────────
function floodFill(x, y, fillColor) {
  const img  = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const data = img.data;
  const px   = (Math.round(x) + Math.round(y) * CANVAS_W) * 4;

  const r0 = data[px], g0 = data[px+1], b0 = data[px+2], a0 = data[px+3];
  const fc  = hexToRgba(fillColor);
  if (r0 === fc.r && g0 === fc.g && b0 === fc.b) return;

  const stack = [Math.round(x) + Math.round(y) * CANVAS_W];
  const visited = new Uint8Array(CANVAS_W * CANVAS_H);

  while (stack.length) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i = idx * 4;
    if (Math.abs(data[i]-r0) > 30 || Math.abs(data[i+1]-g0) > 30 ||
        Math.abs(data[i+2]-b0) > 30 || Math.abs(data[i+3]-a0) > 30) continue;
    data[i]   = fc.r; data[i+1] = fc.g; data[i+2] = fc.b; data[i+3] = 255;
    const x2 = idx % CANVAS_W, y2 = Math.floor(idx / CANVAS_W);
    if (x2 > 0)           stack.push(idx - 1);
    if (x2 < CANVAS_W-1)  stack.push(idx + 1);
    if (y2 > 0)           stack.push(idx - CANVAS_W);
    if (y2 < CANVAS_H-1)  stack.push(idx + CANVAS_W);
  }
  ctx.putImageData(img, 0, 0);
}

function hexToRgba(hex) {
  const c = hex.replace('#','');
  return { r: parseInt(c.substring(0,2),16), g: parseInt(c.substring(2,4),16), b: parseInt(c.substring(4,6),16) };
}

// ─── Mouse Events ─────────────────────────────────────────────────
canvas.addEventListener("mousedown", startStroke);
canvas.addEventListener("mousemove", continueStroke);
canvas.addEventListener("mouseup",   endStroke);
canvas.addEventListener("mouseleave", endStroke);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startStroke(e); }, { passive: false });
canvas.addEventListener("touchmove",  (e) => { e.preventDefault(); continueStroke(e); }, { passive: false });
canvas.addEventListener("touchend",   (e) => { e.preventDefault(); endStroke(); }, { passive: false });

function startStroke(e) {
  const pos = getPos(e);

  if (fillMode) {
    saveUndoSnapshot();
    floodFill(pos.x, pos.y, colorPicker.value);
    strokes.push({ type: "fill", x: pos.x, y: pos.y, color: colorPicker.value });
    return;
  }

  isDrawing    = true;
  currentStroke = {
    color:       eraserMode ? "#000000" : colorPicker.value,
    strokeWidth: parseInt(strokeWidth.value),
    opacity:     eraserMode ? 1 : brushOpacity,
    eraser:      eraserMode,
    points:      [pos]
  };
  ctx.save();
  ctx.globalAlpha = currentStroke.opacity;
  ctx.globalCompositeOperation = eraserMode ? "destination-out" : "source-over";
  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth   = currentStroke.strokeWidth;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function continueStroke(e) {
  if (!isDrawing) return;
  const pos = getPos(e);
  currentStroke.points.push(pos);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function endStroke() {
  if (!isDrawing) return;
  ctx.restore();
  isDrawing = false;
  if (currentStroke && currentStroke.points.length > 0) {
    saveUndoSnapshot();
    strokes.push(currentStroke);
    redoStack = [];
  }
  currentStroke = null;
}

function saveUndoSnapshot() {
  undoStack.push(JSON.parse(JSON.stringify(strokes)));
  if (undoStack.length > 40) undoStack.shift();
}

// ─── Draggable Canvas ──────────────────────────────────────────────
canvasContainer.addEventListener("mousedown", (e) => {
  if (e.button !== 2 && !isDrawing) { // Right-click or when not drawing
    canvasDragging = true;
    canvasDragStart = { x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y };
  }
});

document.addEventListener("mousemove", (e) => {
  if (canvasDragging) {
    canvasOffset.x = e.clientX - canvasDragStart.x;
    canvasOffset.y = e.clientY - canvasDragStart.y;
    canvasContainer.style.transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`;
    canvasContainer.style.cursor = "grabbing";
  }
});

document.addEventListener("mouseup", () => {
  canvasDragging = false;
  canvasContainer.style.cursor = "grab";
});

canvasContainer.style.cursor = "grab";
canvasContainer.style.transition = "none";
canvasContainer.style.position = "relative";

// ─── Toolbar Controls ─────────────────────────────────────────────
btnClear.onclick = () => {
  saveUndoSnapshot();
  strokes = [];
  clearCanvas(bgColorPicker.value);
};

btnUndo.onclick = () => {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(strokes)));
  strokes = undoStack.pop();
  redrawAll();
};

btnRedo.onclick = () => {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(strokes)));
  strokes = redoStack.pop();
  redrawAll();
};

btnEraser.onclick = () => {
  eraserMode = !eraserMode;
  fillMode   = false;
  btnEraser.classList.toggle("tool-active", eraserMode);
  btnFill.classList.remove("tool-active");
  canvas.style.cursor = eraserMode ? "cell" : "crosshair";
};

btnFill.onclick = () => {
  fillMode   = !fillMode;
  eraserMode = false;
  btnFill.classList.toggle("tool-active", fillMode);
  btnEraser.classList.remove("tool-active");
  canvas.style.cursor = fillMode ? "copy" : "crosshair";
};

bgColorPicker.oninput = () => redrawAll();

colorPicker.oninput = () => {
  eraserMode = false;
  btnEraser.classList.remove("tool-active");
  updateStrokePreview();
};

strokeWidth.oninput = updateStrokePreview;

opacitySlider.oninput = () => {
  brushOpacity = parseFloat(opacitySlider.value);
  updateStrokePreview();
};

wallpaperTypeSelect.onchange = () => {
  currentWallpaperType = wallpaperTypeSelect.value;
};

function updateStrokePreview() {
  if (!strokePreview) return;
  const size = parseInt(strokeWidth.value);
  strokePreview.style.width  = size + "px";
  strokePreview.style.height = size + "px";
  strokePreview.style.background = colorPicker.value;
  strokePreview.style.opacity = brushOpacity;
}

// Palette swatches
colorPalette.forEach(sw => {
  sw.onclick = () => {
    colorPicker.value = sw.dataset.color;
    eraserMode = false;
    btnEraser.classList.remove("tool-active");
    updateStrokePreview();
  };
});

// ─── Send Drawing to Device ───────────────────────────────────────
btnSendDrawing.onclick = async () => {
  if (strokes.length === 0) { showToast("Draw something first!", true); return; }
  btnSendDrawing.disabled = true;
  btnSendDrawing.textContent = "Sending...";
  setSyncStatus("sending");

  const sendStrokes = strokes.filter(s => s.type !== "fill");

  try {
    const uid = auth.currentUser.uid;
    await push(ref(db, `users/${uid}/devices/${deviceId}/data/wallpaper/commands`), {
      action: "set_drawing_wallpaper",
      wallpaperType: currentWallpaperType,
      drawingData: { backgroundColor: bgColorPicker.value, strokes: sendStrokes }
    });
    showToast("Drawing sent to " + currentWallpaperType + " screen!");
    setSyncStatus("synced");
  } catch (err) {
    showToast("Error sending drawing", true);
    setSyncStatus("error");
  } finally {
    btnSendDrawing.disabled = false;
    btnSendDrawing.textContent = "📲 Set as Wallpaper";
  }
};

// ─── Send Image Upload ─────────────────────────────────────────────
btnSendImage.onclick = () => imageUpload.click();

imageUpload.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  btnSendImage.disabled = true;
  btnSendImage.textContent = "Uploading...";
  setSyncStatus("sending");

  try {
    const base64 = await resizeImageCover(file, 1080, 1920);
    const uid = auth.currentUser.uid;

    await push(ref(db, `users/${uid}/devices/${deviceId}/data/wallpaper/commands`), {
      action: "set_wallpaper",
      wallpaperType: currentWallpaperType,
      imageBase64: base64
    });

    // Local preview
    wallpaperPreview.src = base64;
    wallpaperPreview.style.display = "block";
    document.getElementById("previewPlaceholder").style.display = "none";

    showToast("Image sent to " + currentWallpaperType + " screen!");
    setSyncStatus("synced");
  } catch (err) {
    showToast("Error sending image", true);
    setSyncStatus("error");
  } finally {
    btnSendImage.disabled = false;
    btnSendImage.textContent = "🖼 Upload Image";
    imageUpload.value = "";
  }
};

function resizeImageCover(file, targetW, targetH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const srcR = img.width / img.height;
      const dstR = targetW / targetH;
      let sx, sy, sw, sh;
      if (srcR > dstR) {
        sh = img.height; sw = sh * dstR;
        sx = (img.width - sw) / 2; sy = 0;
      } else {
        sw = img.width; sh = sw / dstR;
        sx = 0; sy = (img.height - sh) / 2;
      }
      const c  = document.createElement("canvas");
      c.width  = targetW; c.height = targetH;
      const cx = c.getContext("2d");
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Firebase: Live Wallpaper Sync ───────────────────────────────
function updateWallpaperPreview(wallpaperType, data) {
  if (!data || !data.base64) return;

  if (wallpaperType === "lock") {
    lockSyncImg.src = data.base64;
    lockSyncBox.classList.add("has-image");
    saveLockWallpaperLocal(data.base64);
    
    const sourceMap = { web: "Web upload", drawing: "Web drawing", device: "Device change", auto: "Auto-sync" };
    lockSyncSource.textContent = sourceMap[data.source] || data.source || "Device";
    lockSyncTime.textContent   = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "–";
    
    lockPulse.classList.remove("pulse-anim");
    void lockPulse.offsetWidth;
    lockPulse.classList.add("pulse-anim");
  } else if (wallpaperType === "system") {
    systemSyncImg.src = data.base64;
    systemSyncBox.classList.add("has-image");
    saveSystemWallpaperLocal(data.base64);
    
    const sourceMap = { web: "Web upload", drawing: "Web drawing", device: "Device change", auto: "Auto-sync" };
    systemSyncSource.textContent = sourceMap[data.source] || data.source || "Device";
    systemSyncTime.textContent   = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "–";
    
    systemPulse.classList.remove("pulse-anim");
    void systemPulse.offsetWidth;
    systemPulse.classList.add("pulse-anim");
  }

  setSyncStatus("synced");
}

onAuthStateChanged(auth, (user) => {
  if (!user) { setSyncStatus("error"); return; }
  const uid = user.uid;

  // Load from localStorage first if available
  const lockLocal = loadLockWallpaperLocal();
  if (lockLocal) {
    lockSyncImg.src = lockLocal;
    lockSyncBox.classList.add("has-image");
  }

  const systemLocal = loadSystemWallpaperLocal();
  if (systemLocal) {
    systemSyncImg.src = systemLocal;
    systemSyncBox.classList.add("has-image");
  }

  // Live lock screen wallpaper from device
  onValue(ref(db, `users/${uid}/devices/${deviceId}/data/wallpaper/lock/current`), (snapshot) => {
    const data = snapshot.val();
    updateWallpaperPreview("lock", data);
  });

  // Live home screen wallpaper from device
  onValue(ref(db, `users/${uid}/devices/${deviceId}/data/wallpaper/system/current`), (snapshot) => {
    const data = snapshot.val();
    updateWallpaperPreview("system", data);
  });
});

// ─── Status Helpers ───────────────────────────────────────────────
function setSyncStatus(state) {
  const map = {
    sending: { text: "Syncing...", cls: "status-sending" },
    synced:  { text: "Synced ✓",  cls: "status-synced"  },
    error:   { text: "Error",     cls: "status-error"   },
    idle:    { text: "Idle",      cls: "status-idle"    }
  };
  const s = map[state] || map.idle;
  syncStatus.textContent = s.text;
  syncStatus.className   = "sync-status " + s.cls;
}

function showToast(msg, isError = false) {
  toastText.textContent = msg;
  successToast.className = "toast show" + (isError ? " toast-error" : "");
  setTimeout(() => { successToast.className = "toast"; }, 3000);
}