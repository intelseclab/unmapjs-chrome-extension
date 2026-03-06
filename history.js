"use strict";

let allHistory = [];

// ── Load & Render ──────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get("unmapjs_history").catch(() => ({}));
  allHistory = (data && data.unmapjs_history) || [];
  render(allHistory);
}

function render(entries) {
  const container = document.getElementById("listContainer");
  const emptyState = document.getElementById("emptyState");
  const totalBadge = document.getElementById("totalBadge");
  const filterInfo = document.getElementById("filterInfo");

  totalBadge.textContent = allHistory.length + " sites";
  filterInfo.textContent = entries.length + " / " + allHistory.length;

  // Remove old cards (keep emptyState)
  Array.from(container.querySelectorAll(".entry-card, .date-header")).forEach(el => el.remove());

  if (entries.length === 0) {
    emptyState.style.display = "";
    return;
  }
  emptyState.style.display = "none";

  // Group by date
  const groups = {};
  for (const entry of entries) {
    const dateStr = new Date(entry.timestamp).toDateString();
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(entry);
  }

  for (const [dateStr, group] of Object.entries(groups)) {
    // Date header
    const header = document.createElement("div");
    header.className = "date-header";
    header.textContent = formatDateHeader(dateStr);
    container.appendChild(header);

    for (const entry of group) {
      container.appendChild(buildCard(entry));
    }
  }
}

// ── Card Builder ───────────────────────────────────────────────
function buildCard(entry) {
  const card = document.createElement("div");
  card.className = "entry-card";

  // Favicon: text avatar (hostname'in ilk harfi), dış istek yok
  const iconDiv = document.createElement("div");
  iconDiv.className = "entry-icon";
  iconDiv.textContent = entry.hostname.charAt(0).toUpperCase();
  iconDiv.style.cssText = "font-size:15px;font-weight:700;color:#a78bfa;background:#1a1232;display:flex;align-items:center;justify-content:center;";
  card.appendChild(iconDiv);

  // Body
  const body = document.createElement("div");
  body.className = "entry-body";

  const hostnameEl = document.createElement("div");
  hostnameEl.className = "entry-hostname";
  hostnameEl.textContent = entry.hostname;
  body.appendChild(hostnameEl);

  const urlEl = document.createElement("div");
  urlEl.className = "entry-url";
  urlEl.textContent = entry.url;
  body.appendChild(urlEl);

  const meta = document.createElement("div");
  meta.className = "entry-meta";

  const smChip = document.createElement("span");
  smChip.className = "meta-chip chip-green";
  smChip.textContent = entry.sourcemapCount + " sourcemap";
  meta.appendChild(smChip);

  const chunkChip = document.createElement("span");
  chunkChip.className = "meta-chip chip-gray";
  chunkChip.textContent = (entry.chunksChecked || "?") + " chunks scanned";
  meta.appendChild(chunkChip);

  const timeEl = document.createElement("span");
  timeEl.className = "entry-time";
  timeEl.textContent = formatTime(entry.timestamp);
  meta.appendChild(timeEl);

  body.appendChild(meta);
  card.appendChild(body);

  // Actions
  const actions = document.createElement("div");
  actions.className = "entry-actions";

  const analyzeBtn = document.createElement("button");
  analyzeBtn.className = "btn-analyze";
  analyzeBtn.textContent = "Analyze";
  analyzeBtn.addEventListener("click", function() {
    chrome.tabs.create({ url: entry.url });
  });
  actions.appendChild(analyzeBtn);

  const openBtn = document.createElement("button");
  openBtn.className = "btn-open";
  openBtn.title = "Open site";
  openBtn.textContent = "\u2197";
  openBtn.addEventListener("click", function() {
    chrome.tabs.create({ url: entry.url });
  });
  actions.appendChild(openBtn);

  card.appendChild(actions);
  return card;
}

// ── Search / Filter ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function() {
  loadHistory();

  document.getElementById("searchInput").addEventListener("input", function() {
    const q = this.value.trim().toLowerCase();
    const filtered = q
      ? allHistory.filter(function(e) {
          return e.hostname.toLowerCase().includes(q) || e.url.toLowerCase().includes(q);
        })
      : allHistory;
    render(filtered);
  });

  document.getElementById("clearBtn").addEventListener("click", async function() {
    if (!confirm("Delete all history records?")) return;
    await chrome.storage.local.remove("unmapjs_history").catch(() => {});
    allHistory = [];
    render([]);
    document.getElementById("totalBadge").textContent = "0 sites";
  });

  // Listen for new entries added by background (storage change)
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === "local" && changes.unmapjs_history) {
      allHistory = changes.unmapjs_history.newValue || [];
      const q = document.getElementById("searchInput").value.trim().toLowerCase();
      const filtered = q
        ? allHistory.filter(function(e) {
            return e.hostname.toLowerCase().includes(q) || e.url.toLowerCase().includes(q);
          })
        : allHistory;
      render(filtered);
    }
  });
});

// ── Helpers ────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

function formatDateHeader(dateStr) {
  const d = new Date(dateStr);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
