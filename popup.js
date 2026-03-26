'use strict';

// ============================================================
// STATE
// ============================================================
let port = null;
let currentTab = null;
let collectedFiles = [];

// Step progress tracking
const stepProgress = { 1: { done: 0, total: 0 }, 2: { done: 0, total: 0 }, 3: { done: 0, total: 0 } };

function toOriginPattern(rawUrl) {
  const u = new URL(rawUrl);
  return `${u.origin}/*`;
}

async function ensureSitePermission(rawUrl) {
  const originPattern = toOriginPattern(rawUrl);
  const has = await chrome.permissions.contains({ origins: [originPattern] });
  if (has) return true;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  return granted === true;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Get the active tab
  try {
    [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {}

  const urlEl = document.getElementById('currentUrl');
  if (currentTab?.url) {
    urlEl.textContent = currentTab.url;
  } else {
    urlEl.textContent = 'Could not retrieve tab URL';
  }

  // Load settings
  loadSettings();

  // Wire buttons
  document.getElementById('analyzeBtn').addEventListener('click', startAnalysis);
  document.getElementById('downloadBtn').addEventListener('click', downloadZip);
  document.getElementById('reAnalyzeBtn').addEventListener('click', () => { resetUI(); startAnalysis(); });
  document.getElementById('retryBtn').addEventListener('click', () => { resetUI(); startAnalysis(); });

  // Settings toggles
  document.getElementById('autoScan').addEventListener('change', saveSettings);
  document.getElementById('notifEnabled').addEventListener('change', saveSettings);
});

// ============================================================
// UI HELPERS
// ============================================================
function show(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)  { document.getElementById(id)?.classList.add('hidden'); }

async function loadSettings() {
  const data = await chrome.storage.local.get('unmapjs_settings').catch(() => ({}));
  const s = data.unmapjs_settings || {};
  document.getElementById('autoScan').checked = s.autoScan === true;
  document.getElementById('notifEnabled').checked = s.notifications === true;
}

async function saveSettings() {
  await chrome.storage.local.set({
    unmapjs_settings: {
      autoScan:      document.getElementById('autoScan').checked,
      notifications: document.getElementById('notifEnabled').checked,
    },
  }).catch(() => {});
}

function setProgress(pct, label) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  if (label) document.getElementById('statusMsg').textContent = label;
}

function setStepState(step, state, count) {
  const el = document.getElementById(`step-${step}`);
  if (el) el.setAttribute('data-state', state);
  if (count != null) {
    const sc = document.getElementById(`sc-${step}`);
    if (sc) sc.textContent = count > 0 ? `(${count})` : '';
  }
}

function resetUI() {
  collectedFiles = [];
  Object.assign(stepProgress, { 1: { done: 0, total: 0 }, 2: { done: 0, total: 0 }, 3: { done: 0, total: 0 } });
  hide('progressSection');
  hide('resultsSection');
  hide('errorSection');
  setProgress(0, 'Starting…');
  [1, 2, 3].forEach(s => setStepState(s, 'idle', null));
  document.getElementById('statusMsg').textContent = '';
}

// ============================================================
// ANALYSIS START
// ============================================================
async function startAnalysis() {
  if (!currentTab?.id) {
    showError('Could not retrieve active tab info. Please reload the page.');
    return;
  }

  const url = currentTab.url || '';
  if (!url.startsWith('http')) {
    showError('This page cannot be analyzed.\n(chrome://, extension:// etc. URLs are not supported)');
    return;
  }

  const hasPermission = await ensureSitePermission(url).catch(() => false);
  if (!hasPermission) {
    showError('Site permission is required to analyze this page. Please grant access and try again.');
    return;
  }

  resetUI();

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.textContent = '⏳  Analiz ediliyor…';

  show('progressSection');
  setProgress(0, '🔍 Reading page data…');
  setStepState(1, 'active');

  // ── Inject content script to get already-loaded scripts ──
  let pageScripts = [];
  let pageHtml = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => {
        // Collect all <script src> URLs
        const fromScriptTags = Array.from(document.querySelectorAll('script[src]'))
          .map(s => s.src)
          .filter(s => s && !s.startsWith('chrome-extension://'));

        // Collect from performance API (catches dynamically inserted scripts)
        const fromPerf = performance.getEntriesByType('resource')
          .filter(e => e.initiatorType === 'script' && e.name && !e.name.startsWith('chrome-extension://'))
          .map(e => e.name);

        return {
          scripts: [...new Set([...fromScriptTags, ...fromPerf])],
          html: document.documentElement.outerHTML.slice(0, 102400),
        };
      },
    });
    if (results?.[0]?.result) {
      pageScripts = results[0].result.scripts || [];
      pageHtml = results[0].result.html || '';
    }
  } catch (e) {
    // executeScript might fail on restricted pages
    pageScripts = [];
    pageHtml = '';
  }

  // ── Connect to background service worker via Port ─────────
  connectPort();

  port.postMessage({
    type: 'analyze',
    url,
    pageScripts,
    pageHtml,
    options: {
      includeNodeModules: document.getElementById('includeNodeModules').checked,
      includeProbes: document.getElementById('includeProbes').checked,
    },
  });
}

// ============================================================
// PORT CONNECTION
// ============================================================
function connectPort() {
  if (port) { try { port.disconnect(); } catch (_) {} }
  port = chrome.runtime.connect({ name: 'unmapjs' });
  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => { port = null; });
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
function handleMessage(msg) {
  switch (msg.type) {

    case 'status':
      document.getElementById('statusMsg').textContent = msg.message;
      break;

    case 'step_done': {
      setStepState(msg.step, 'done', msg.count);
      // Advance next step to active
      if (msg.step < 3) setStepState(msg.step + 1, 'active');
      // Update overall progress
      const pctMap = { 1: 30, 2: 60, 3: 90 };
      setProgress(pctMap[msg.step] || 0);
      break;
    }

    case 'progress': {
      const sp = stepProgress[msg.step];
      sp.done = msg.done;
      sp.total = msg.total;

      // Compute overall %:  step1→0-30,  step2→30-60,  step3→60-95
      const ranges = { 1: [0, 30], 2: [30, 60], 3: [60, 95] };
      const [lo, hi] = ranges[msg.step] || [0, 100];
      const ratio = msg.total > 0 ? msg.done / msg.total : 0;
      const pct = Math.round(lo + ratio * (hi - lo));
      setProgress(pct);
      break;
    }

    case 'complete':
      handleComplete(msg);
      break;

    case 'r2s_probe_result':
      handleR2SProbeResult(msg.result);
      break;

    case 'error':
      showError(msg.message);
      break;
  }
}

// ============================================================
// COMPLETE
// ============================================================
function handleComplete(msg) {
  collectedFiles = msg.files || [];

  setProgress(100, '✅ Analysis complete!');
  setStepState(3, 'done', collectedFiles.length);

  // Show results after short delay for animation
  setTimeout(() => {
    hide('progressSection');
    show('resultsSection');

    document.getElementById('statChunks').textContent    = msg.stats?.chunks    ?? 0;
    document.getElementById('statSourcemaps').textContent = msg.stats?.sourcemaps ?? 0;
    document.getElementById('statFiles').textContent     = msg.stats?.files     ?? 0;

    const btn = document.getElementById('analyzeBtn');
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg> Analyze`;
  }, 600);
}

// ============================================================
// ERROR
// ============================================================
function showError(message) {
  hide('progressSection');
  show('errorSection');
  document.getElementById('errorMsg').textContent = message;

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg> Analyze`;
}

// ============================================================
// ZIP DOWNLOAD
// ============================================================
async function downloadZip() {
  if (!collectedFiles.length) {
    showError('No files to download.');
    return;
  }

  const btn = document.getElementById('downloadBtn');
  btn.disabled = true;
  btn.textContent = '⏳  Creating ZIP…';

  try {
    const zip = new JSZip(); // eslint-disable-line no-undef

    for (const file of collectedFiles) {
      if (file.path && file.content != null) {
        zip.file(file.path, file.content);
      }
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Determine filename from tab URL
    let hostname = 'recovered-source';
    try { hostname = new URL(currentTab?.url || '').hostname.replace(/^www\./, ''); } catch (_) {}

    // Trigger download
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${hostname}-sources.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);

  } catch (err) {
    showError('Error creating ZIP: ' + (err.message || err));
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M12 4v12M7 11l5 5 5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 20h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  </svg> Download as ZIP`;
}
