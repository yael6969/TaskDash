// app.js — TaskDash
// Firebase init, render, modals, events

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { firebaseConfig, DB_PREFIX } from "./firebase-config.js";

// ─── Palette for category colors ──────────────────────────────────────────
const COLORS = [
  { id: "blue",    hex: "#1565FF" },
  { id: "red",     hex: "#E8293A" },
  { id: "green",   hex: "#2DC974" },
  { id: "orange",  hex: "#FF9F1C" },
  { id: "purple",  hex: "#7C3AED" },
  { id: "pink",    hex: "#EC4899" },
  { id: "teal",    hex: "#0891B2" },
  { id: "amber",   hex: "#D97706" },
];

// ─── State ─────────────────────────────────────────────────────────────────
let db;
let categories = {};   // { id: { name, color } }
let tasks = {};        // { id: { title, catId, status, createdAt } }
let activeCat = "all"; // currently selected category filter
let pendingStatusId = null;
let selectedColor = COLORS[0].hex;
let selectedCatForTask = null;

// ─── Init ───────────────────────────────────────────────────────────────────
function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);

    // Listen categories
    onValue(ref(db, `${DB_PREFIX}/categories`), (snap) => {
      categories = snap.val() || {};
      renderCatBar();
      renderTasks();
    }, (err) => {
      console.error("Firebase categories error:", err);
      setLoading(false);
      showError(err);
    });

    // Listen tasks
    onValue(ref(db, `${DB_PREFIX}/tasks`), (snap) => {
      tasks = snap.val() || {};
      renderTasks();
      updateHeaderStats();
      setLoading(false);
    }, (err) => {
      console.error("Firebase tasks error:", err);
      setLoading(false);
      showError(err);
    });

  } catch (e) {
    console.error("Firebase init error:", e);
    setLoading(false);
    showError(e);
  }
}

// ─── Render: Category Bar ───────────────────────────────────────────────────
function renderCatBar() {
  const bar = document.getElementById("cat-bar");

  // Keep the "All" chip, replace the rest
  const allChip = bar.querySelector('[data-cat-id="all"]');
  bar.innerHTML = "";
  bar.appendChild(allChip);

  allChip.className = "cat-chip" + (activeCat === "all" ? " active" : "");
  allChip.onclick = () => selectCat("all");

  Object.entries(categories).forEach(([id, cat]) => {
    const chip = document.createElement("div");
    chip.className = "cat-chip" + (activeCat === id ? " active" : "");
    chip.dataset.catId = id;
    chip.style.setProperty("--chip-color", cat.color);
    chip.innerHTML = `
      <span class="cat-chip-dot"></span>
      <span class="cat-chip-label">${esc(cat.name)}</span>
      <button class="cat-chip-del" data-cat-id="${id}" aria-label="Hapus kategori ${esc(cat.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;

    chip.querySelector(".cat-chip-label").addEventListener("click", () => selectCat(id));
    chip.querySelector(".cat-chip-dot").addEventListener("click", () => selectCat(id));
    chip.querySelector(".cat-chip-del").addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteCatModal(id);
    });

    bar.appendChild(chip);
  });
}

function selectCat(id) {
  activeCat = id;
  renderCatBar();
  renderTasks();
}

// ─── Render: Tasks ───────────────────────────────────────────────────────────
function renderTasks() {
  const container  = document.getElementById("tasks-container");
  const emptyState = document.getElementById("empty-state");

  let filtered = Object.entries(tasks);
  if (activeCat !== "all") {
    filtered = filtered.filter(([, t]) => t.catId === activeCat);
  }

  if (filtered.length === 0) {
    emptyState.hidden = false;
    container.innerHTML = "";
    return;
  }

  emptyState.hidden = true;

  // Sort by createdAt desc
  filtered.sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = filtered.map(([id, task]) => taskCardHTML(id, task)).join("");

  container.querySelectorAll(".btn-update-status").forEach(btn => {
    btn.addEventListener("click", () => openStatusModal(btn.dataset.id));
  });

  container.querySelectorAll(".card-delete").forEach(btn => {
    btn.addEventListener("click", () => openDeleteTaskModal(btn.dataset.id));
  });
}

function taskCardHTML(id, task) {
  const cat      = categories[task.catId];
  const color    = cat ? cat.color : "#1565FF";
  const catName  = cat ? cat.name : null;
  const status   = task.status || "draft";
  const time     = task.createdAt ? formatTime(task.createdAt) : "";

  return `
  <div class="task-card" style="--card-color:${color}">
    <div class="card-body">
      <div class="card-top">
        <div class="card-title">${esc(task.title)}</div>
        <button class="card-delete" data-id="${id}" title="Hapus task" aria-label="Hapus task">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <div class="card-meta">
        <div class="card-time">${time}</div>
        ${catName ? `<div class="card-cat-badge" style="--badge-color:${color}">${esc(catName)}</div>` : ""}
      </div>
    </div>
    <div class="card-footer">
      <div class="status-badge ${status}">${statusLabel(status)}</div>
      <button class="btn-update-status" data-id="${id}">Update Status</button>
    </div>
  </div>`;
}

// ─── Header stats ────────────────────────────────────────────────────────────
function updateHeaderStats() {
  const all   = Object.values(tasks);
  const done  = all.filter(t => t.status === "done").length;
  document.getElementById("stat-total").textContent = `${all.length} task${all.length !== 1 ? "s" : ""}`;
  document.getElementById("stat-done").textContent  = `${done} done`;
}

// ─── Modal: Add Category ─────────────────────────────────────────────────────
function openCatModal() {
  document.getElementById("cat-form").reset();
  selectedColor = COLORS[0].hex;
  buildColorGrid();
  document.getElementById("cat-modal").hidden = false;
  document.getElementById("cat-name-input").focus();
}

function closeCatModal() {
  document.getElementById("cat-modal").hidden = true;
}

function buildColorGrid() {
  const grid = document.getElementById("color-grid");
  grid.innerHTML = COLORS.map(c => `
    <button type="button" class="color-swatch${c.hex === selectedColor ? " selected" : ""}"
      style="background:${c.hex}" data-hex="${c.hex}" aria-label="Pilih warna ${c.id}">
    </button>`).join("");

  grid.querySelectorAll(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      selectedColor = sw.dataset.hex;
      grid.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
  });
}

function handleAddCategory(e) {
  e.preventDefault();
  const name = document.getElementById("cat-name-input").value.trim();
  if (!name) { toast("Nama kategori wajib diisi", "error"); return; }

  push(ref(db, `${DB_PREFIX}/categories`), { name, color: selectedColor, createdAt: Date.now() })
    .then(() => { toast("Kategori ditambahkan!", "success"); closeCatModal(); })
    .catch(err => toast("Gagal menyimpan: " + err.message, "error"));
}

// ─── Modal: Add Task ──────────────────────────────────────────────────────────
function openTaskModal() {
  document.getElementById("task-form").reset();
  document.getElementById("task-title-input").value = "";
  selectedCatForTask = null;

  // Build category selector
  const catSel = document.getElementById("task-cat-select");
  catSel.innerHTML = "";

  if (Object.keys(categories).length === 0) {
    catSel.innerHTML = `<span style="font-size:.82rem;color:var(--fg-muted)">Belum ada kategori — tambah dulu lewat tombol +</span>`;
  } else {
    Object.entries(categories).forEach(([id, cat]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cat-sel-chip";
      chip.dataset.catId = id;
      chip.style.setProperty("--chip-color", cat.color);
      chip.textContent = cat.name;
      chip.addEventListener("click", () => {
        selectedCatForTask = id;
        catSel.querySelectorAll(".cat-sel-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
      });
      catSel.appendChild(chip);
    });
  }

  // Reset status select to draft
  document.querySelectorAll("#task-status-select .status-opt").forEach(opt => {
    opt.classList.toggle("active", opt.dataset.status === "draft");
  });

  document.getElementById("task-modal").hidden = false;
  document.getElementById("task-title-input").focus();
}

function closeTaskModal() {
  document.getElementById("task-modal").hidden = true;
}

function handleAddTask(e) {
  e.preventDefault();
  const title = document.getElementById("task-title-input").value.trim();
  if (!title) { toast("Judul task wajib diisi", "error"); return; }

  const statusEl = document.querySelector("#task-status-select .status-opt.active");
  const status   = statusEl ? statusEl.dataset.status : "draft";

  push(ref(db, `${DB_PREFIX}/tasks`), {
    title,
    catId: selectedCatForTask || null,
    status,
    createdAt: Date.now()
  })
    .then(() => { toast("Task ditambahkan!", "success"); closeTaskModal(); })
    .catch(err => toast("Gagal menyimpan: " + err.message, "error"));
}

// ─── Modal: Update Status ─────────────────────────────────────────────────────
function openStatusModal(id) {
  const task = tasks[id];
  if (!task) return;

  pendingStatusId = id;
  document.getElementById("status-task-name").textContent = task.title;

  // Highlight current status
  document.querySelectorAll("#status-modal-select .status-opt").forEach(opt => {
    opt.classList.toggle("active", opt.dataset.status === task.status);
    opt.addEventListener("click", () => {
      document.querySelectorAll("#status-modal-select .status-opt").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
    }, { once: false });
  });

  document.getElementById("status-modal").hidden = false;
}

function closeStatusModal() {
  document.getElementById("status-modal").hidden = true;
  pendingStatusId = null;
}

function confirmStatusUpdate() {
  if (!pendingStatusId) return;
  const activeOpt = document.querySelector("#status-modal-select .status-opt.active");
  if (!activeOpt) { toast("Pilih status dulu", "error"); return; }

  const newStatus = activeOpt.dataset.status;
  update(ref(db, `${DB_PREFIX}/tasks/${pendingStatusId}`), { status: newStatus })
    .then(() => { toast("Status diperbarui!", "success"); closeStatusModal(); })
    .catch(err => toast("Gagal update: " + err.message, "error"));
}

// ─── Modal: Delete Category ───────────────────────────────────────────────────
function openDeleteCatModal(id) {
  const cat = categories[id];
  if (!cat) return;
  document.getElementById("del-cat-name").textContent = cat.name;
  document.getElementById("del-cat-confirm").onclick = () => confirmDeleteCat(id);
  document.getElementById("del-cat-modal").hidden = false;
}

function confirmDeleteCat(id) {
  // Kumpulkan semua task yang ada di kategori ini
  const taskIdsToDelete = Object.entries(tasks)
    .filter(([, t]) => t.catId === id)
    .map(([taskId]) => taskId);

  // Buat batch update: hapus kategori + semua task-nya sekaligus
  const updates = {};
  updates[`${DB_PREFIX}/categories/${id}`] = null;
  taskIdsToDelete.forEach(taskId => {
    updates[`${DB_PREFIX}/tasks/${taskId}`] = null;
  });

  update(ref(db, "/"), updates)
    .then(() => {
      toast(`Kategori & ${taskIdsToDelete.length} task dihapus`, "success");
      document.getElementById("del-cat-modal").hidden = true;
      if (activeCat === id) selectCat("all");
    })
    .catch(err => toast("Gagal menghapus: " + err.message, "error"));
}

// ─── Modal: Delete Task ───────────────────────────────────────────────────────
function openDeleteTaskModal(id) {
  const task = tasks[id];
  if (!task) return;
  document.getElementById("del-task-name").textContent = task.title;
  document.getElementById("del-task-confirm").onclick = () => confirmDeleteTask(id);
  document.getElementById("del-task-modal").hidden = false;
}

function confirmDeleteTask(id) {
  remove(ref(db, `${DB_PREFIX}/tasks/${id}`))
    .then(() => { toast("Task dihapus", "success"); document.getElementById("del-task-modal").hidden = true; })
    .catch(err => toast("Gagal menghapus: " + err.message, "error"));
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusLabel(s) {
  return { draft: "Draft", "in-progress": "In Progress", done: "Done", cancel: "Cancel" }[s] || s;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function toast(msg, type = "success") {
  const c  = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function setLoading(show) {
  document.getElementById("loading").hidden     = !show;
  document.getElementById("app-content").hidden = show;
}

function showError(err) {
  const el  = document.getElementById("firebase-error");
  el.hidden = false;
  const msg = err?.message || String(err);
  el.querySelector(".err-msg").textContent =
    (msg.includes("YOUR_") || msg.includes("firebaseConfig"))
      ? "Firebase belum dikonfigurasi. Buka firebase-config.js dan isi dengan data dari Firebase Console."
      : msg;
}

function closeAllModals() {
  document.querySelectorAll(".modal-backdrop").forEach(m => m.hidden = true);
  pendingStatusId = null;
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initFirebase();

  // Category modal
  document.getElementById("btn-add-cat").addEventListener("click", openCatModal);
  document.getElementById("cat-modal-close").addEventListener("click", closeCatModal);
  document.getElementById("cat-cancel").addEventListener("click", closeCatModal);
  document.getElementById("cat-form").addEventListener("submit", handleAddCategory);

  // Task modal (FAB)
  document.getElementById("fab-add-task").addEventListener("click", openTaskModal);
  document.getElementById("task-modal-close").addEventListener("click", closeTaskModal);
  document.getElementById("task-cancel").addEventListener("click", closeTaskModal);
  document.getElementById("task-form").addEventListener("submit", handleAddTask);

  // Task status select
  document.querySelectorAll("#task-status-select .status-opt").forEach(opt => {
    opt.addEventListener("click", () => {
      document.querySelectorAll("#task-status-select .status-opt").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
    });
  });

  // Status modal
  document.getElementById("status-modal-close").addEventListener("click", closeStatusModal);
  document.getElementById("status-cancel").addEventListener("click", closeStatusModal);
  document.getElementById("status-confirm").addEventListener("click", confirmStatusUpdate);

  // Delete task modal
  document.getElementById("del-task-close").addEventListener("click", () => {
    document.getElementById("del-task-modal").hidden = true;
  });
  document.getElementById("del-task-cancel").addEventListener("click", () => {
    document.getElementById("del-task-modal").hidden = true;
  });

  // Delete category modal
  document.getElementById("del-cat-close").addEventListener("click", () => {
    document.getElementById("del-cat-modal").hidden = true;
  });
  document.getElementById("del-cat-cancel").addEventListener("click", () => {
    document.getElementById("del-cat-modal").hidden = true;
  });

  // Backdrop click / Escape to close
  document.querySelectorAll(".modal-backdrop").forEach(bd => {
    bd.addEventListener("click", (e) => {
      if (e.target === bd) closeAllModals();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });
});
