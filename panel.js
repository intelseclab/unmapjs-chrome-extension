'use strict';

// ── State ──────────────────────────────────────────────────────
const capturedXHR = {};  // url → { content, encoding, mimeType }
let xhrEnabled = false;
let isSaving   = false;
let batchUrls  = [];

// ── XHR listener (fires for every finished network request) ───
chrome.devtools.network.onRequestFinished.addListener(function(req) {
  if (!xhrEnabled) return;
  const url = req.request?.url;
  if (!url || !url.startsWith('http') || /^(chrome-extension:|ws:)/.test(url)) return;

  req.getContent(function(content, encoding) {
    if (content) {
      capturedXHR[url] = {
        content,
        encoding,
        mimeType: req.response?.content?.mimeType || 'text/plain',
      };
    }
    refreshCounts();
  });
});

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Show current tab URL
  chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, function(tab) {
    document.getElementById('currentUrl').textContent = tab?.url || 'Unknown';
  });

  refreshCounts();

  document.getElementById('xhrToggle').addEventListener('change', onXHRToggle);
  document.getElementById('saveBtn').addEventListener('click', function() {
    if (!isSaving) saveCurrentPage();
  });
  document.getElementById('resetBtn').addEventListener('click', resetCollector);
  document.getElementById('batchEditBtn').addEventListener('click', openBatchModal);
  document.getElementById('batchModalOk').addEventListener('click', closeBatchModal);
  document.getElementById('batchModalCancel').addEventListener('click', closeBatchModal);
  document.getElementById('batchModalCancel2').addEventListener('click', closeBatchModal);
  document.getElementById('saveBatchBtn').addEventListener('click', function() {
    if (!isSaving) saveBatch();
  });
});

// ── XHR toggle ────────────────────────────────────────────────
function onXHRToggle(e) {
  xhrEnabled = e.target.checked;

  if (!xhrEnabled) {
    clearCapturedXHR();
    refreshCounts();
    setStatus('XHR capture disabled.');
    return;
  }

  // Reload the inspected page so all requests are captured from scratch.
  const toggle = e.target;
  toggle.disabled = true;
  setStatus('Reloading page for XHR capture…');

  const handler = function(tabId, changeInfo) {
    if (tabId !== chrome.devtools.inspectedWindow.tabId) return;
    if (changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(handler);
      toggle.disabled = false;
      refreshCounts();
      setStatus('XHR capture active – capturing network requests…');
    }
  };
  chrome.tabs.onUpdated.addListener(handler);
  chrome.tabs.reload(chrome.devtools.inspectedWindow.tabId);
}

function clearCapturedXHR() {
  for (const k of Object.keys(capturedXHR)) delete capturedXHR[k];
}

function resetCollector() {
  clearCapturedXHR();
  refreshCounts();
  setStatus('Collector reset.');
}

// ── Counts ────────────────────────────────────────────────────
function refreshCounts() {
  chrome.devtools.inspectedWindow.getResources(function(resources) {
    const staticCount = resources.filter(r => r.url?.startsWith('http')).length;
    const xhrCount    = Object.keys(capturedXHR).length;
    document.getElementById('staticCount').textContent = staticCount;
    document.getElementById('xhrCount').textContent    = xhrCount;
    document.getElementById('totalCount').textContent  = staticCount + xhrCount;
  });
}

// ── Status / progress ─────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

function setProgress(pct) {
  document.getElementById('progressBar').style.width = pct + '%';
}

// ── URL → file path ───────────────────────────────────────────
function resolveUrlToPath(url, mimeType) {
  if (!url) return null;

  // data: URIs get their own folder
  if (url.startsWith('data:')) {
    const tag = url.slice(0, 40).split(';')[0].replace(/[^A-Za-z0-9]/g, '.');
    return `_DataURI/${tag}.${Math.random().toString(16).slice(2)}.bin`;
  }

  let filepath;
  try {
    const after = url.split('://')[1] || url;
    filepath = after.split('?')[0].split('#')[0];
  } catch (_) {
    filepath = url.split('?')[0];
  }

  // Trailing slash → index.html
  if (filepath.endsWith('/')) filepath += 'index.html';

  // Strip leading slash
  if (filepath.startsWith('/')) filepath = filepath.slice(1);

  // Infer extension when missing
  const basename = filepath.split('/').pop() || '';
  const hasExt   = /\.[a-zA-Z0-9]{1,6}$/.test(basename.split(';')[0]);
  if (!hasExt && mimeType) {
    const mt = mimeType.toLowerCase();
    if      (mt.includes('javascript'))                   filepath += '.js';
    else if (mt.includes('css'))                          filepath += '.css';
    else if (mt.includes('html'))                         filepath += '.html';
    else if (mt.includes('json'))                         filepath += '.json';
    else if (mt.includes('svg'))                          filepath += '.svg';
    else if (mt.includes('png'))                          filepath += '.png';
    else if (mt.includes('jpeg') || mt.includes('jpg'))   filepath += '.jpg';
    else if (mt.includes('gif'))                          filepath += '.gif';
    else if (mt.includes('webp'))                         filepath += '.webp';
    else if (mt.includes('woff2'))                        filepath += '.woff2';
    else if (mt.includes('woff'))                         filepath += '.woff';
    else if (mt.includes('ttf'))                          filepath += '.ttf';
    else if (mt.includes('xml'))                          filepath += '.xml';
    else                                                   filepath += '.bin';
  }

  // Sanitize
  filepath = filepath
    .replace(/[:\\=*"'?~|<>]/g, '')
    .replace(/;[^/]*/g, '')        // strip ;charset= etc.
    .replace(/\/\//g, '/');

  // Decode percent-encoding
  try { filepath = decodeURIComponent(filepath); } catch (_) {}

  // Collapse any remaining double slashes after decode
  while (filepath.includes('//')) filepath = filepath.replace('//', '/');

  return filepath || 'unknown.bin';
}

// ── Deduplicate by resolved path ──────────────────────────────
function deduplicatePaths(files) {
  const seen   = {};
  const result = [];
  for (const f of files) {
    if (!f.path) continue;
    if (!(f.path in seen)) {
      seen[f.path] = 0;
      result.push(f);
    } else {
      seen[f.path]++;
      const ext     = f.path.match(/(\.[^./]+)$/)?.[1] || '';
      const base    = ext ? f.path.slice(0, -ext.length) : f.path;
      result.push({ ...f, path: `${base} (${seen[f.path]})${ext}` });
    }
  }
  return result;
}

// ── Collect all resources ─────────────────────────────────────
async function collectResources() {
  const ignoreEmpty = document.getElementById('ignoreEmpty').checked;
  const files       = [];
  const seenUrls    = new Set();

  // 1. Static resources (already loaded by the browser)
  const staticResources = await new Promise(resolve =>
    chrome.devtools.inspectedWindow.getResources(resolve)
  );

  await Promise.allSettled(
    staticResources
      .filter(r => r.url?.startsWith('http') && !/^(chrome-extension:|ws:|debugger:)/.test(r.url))
      .map(r => new Promise(resolve => {
        r.getContent(function(content, encoding) {
          if (!content && ignoreEmpty) return resolve();
          seenUrls.add(r.url);
          files.push({
            url:      r.url,
            content:  content ?? '',
            encoding,
            mimeType: r.type,
            path:     resolveUrlToPath(r.url, r.type),
          });
          resolve();
        });
      }))
  );

  // 2. XHR / Network resources (captured via HAR + onRequestFinished)
  if (xhrEnabled) {
    const logInfo = await new Promise(resolve =>
      chrome.devtools.network.getHAR(resolve)
    );

    const entries = (logInfo.entries || []).filter(
      e => e.request?.url?.startsWith('http') &&
           !/^(chrome-extension:|ws:|debugger:)/.test(e.request.url) &&
           !seenUrls.has(e.request.url)
    );

    await Promise.allSettled(
      entries.map(e => new Promise(resolve => {
        const url      = e.request.url;
        const mimeType = e.response?.content?.mimeType || 'text/plain';
        const cached   = capturedXHR[url];

        const push = (content, encoding) => {
          if (!content && ignoreEmpty) return resolve();
          files.push({ url, content: content ?? '', encoding, mimeType, path: resolveUrlToPath(url, mimeType) });
          resolve();
        };

        if (cached) {
          push(cached.content, cached.encoding);
        } else {
          e.getContent((content, encoding) => push(content, encoding));
        }
      }))
    );
  }

  return deduplicatePaths(files);
}

// ── Build ZIP blob ────────────────────────────────────────────
async function buildZip(files) {
  const zip = new JSZip(); // eslint-disable-line no-undef
  let added = 0;

  for (const f of files) {
    if (!f.path || f.content == null) continue;
    try {
      if (f.encoding === 'base64') {
        zip.file(f.path, f.content, { base64: true });
      } else {
        zip.file(f.path, String(f.content));
      }
      added++;
    } catch (_) {}
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, added };
}

// ── Trigger browser download ──────────────────────────────────
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ── Get hostname of inspected tab ─────────────────────────────
function getHostname() {
  return new Promise(resolve => {
    chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, function(tab) {
      let hostname = 'resources';
      try { hostname = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) {}
      resolve(hostname);
    });
  });
}

// ── Save current page ─────────────────────────────────────────
async function saveCurrentPage() {
  isSaving = true;
  setSavingState(true);
  setProgress(10);
  setStatus('Collecting resources…');

  try {
    const files = await collectResources();
    setProgress(60);
    setStatus(`Building ZIP (${files.length} file${files.length !== 1 ? 's' : ''})…`);

    const { blob, added } = await buildZip(files);
    setProgress(95);

    const hostname = await getHostname();
    triggerDownload(blob, `${hostname}-resources.zip`);

    setProgress(100);
    setStatus(`Done! Saved ${added} file${added !== 1 ? 's' : ''}.`);
  } catch (err) {
    setStatus('Error: ' + (err?.message || String(err)));
  }

  setTimeout(() => setProgress(0), 1500);
  isSaving = false;
  setSavingState(false);
}

// ── Batch mode ────────────────────────────────────────────────
function openBatchModal() {
  document.getElementById('batchUrlList').value = batchUrls.join('\n');
  document.getElementById('batchModal').classList.remove('hidden');
}

function closeBatchModal() {
  batchUrls = (document.getElementById('batchUrlList').value || '')
    .split('\n')
    .map(u => u.trim())
    .filter(u => u.startsWith('http'));

  const n = batchUrls.length;
  document.getElementById('batchUrlCount').textContent = n > 0 ? `(${n} URL${n > 1 ? 's' : ''})` : '';
  document.getElementById('batchModal').classList.add('hidden');
}

async function saveBatch() {
  const urls = batchUrls.slice();
  if (urls.length === 0) {
    setStatus('No valid URLs in list. Click "Edit URL List" to add some.');
    return;
  }

  isSaving = true;
  setSavingState(true);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    setProgress(Math.round((i / urls.length) * 85));
    setStatus(`Batch ${i + 1}/${urls.length}: Navigating to ${url}…`);

    // Navigate the inspected tab and wait for it to finish loading.
    await new Promise(resolve => {
      // Fallback: resolve after 15 s if the tab update event never fires.
      let timer = setTimeout(resolve, 15000);

      const handler = function(tabId, changeInfo) {
        if (tabId !== chrome.devtools.inspectedWindow.tabId) return;
        if (changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(handler);
          clearTimeout(timer);
          // Brief pause for dynamic resources to settle.
          setTimeout(resolve, 1500);
        }
      };
      chrome.tabs.onUpdated.addListener(handler);
      chrome.tabs.update(chrome.devtools.inspectedWindow.tabId, { url });
    });

    setStatus(`Batch ${i + 1}/${urls.length}: Collecting resources…`);
    const files = await collectResources();

    setStatus(`Batch ${i + 1}/${urls.length}: Building ZIP (${files.length} files)…`);
    const { blob, added } = await buildZip(files);

    let hostname = 'batch';
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    triggerDownload(blob, `${hostname}-resources.zip`);

    setStatus(`Batch ${i + 1}/${urls.length}: Saved ${added} files from ${hostname}.`);

    // Reset XHR cache before next URL.
    clearCapturedXHR();
  }

  setProgress(100);
  setStatus(`Batch complete! Processed ${urls.length} URL${urls.length > 1 ? 's' : ''}.`);
  setTimeout(() => setProgress(0), 2000);

  isSaving = false;
  setSavingState(false);
}

// ── UI helpers ────────────────────────────────────────────────
function setSavingState(saving) {
  const ids = ['saveBtn', 'saveBatchBtn', 'resetBtn', 'xhrToggle'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = saving;
  }
}
