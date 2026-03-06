// Main analysis engine: driven by messages from the popup via a Chrome port.

import { PROBE_PATHS, MAX_CHUNKS } from "./constants.js";
import { safeFetch, safeFetchJson, fetchBatch } from "./fetcher.js";
import { discoverFromHtml, discoverFromBuildManifest, discoverFromJsContent, extractSourcemapUrl } from "./discovery.js";
import { extractSources } from "./extractor.js";

/** Sends a message to the popup port; silently ignores if the popup was closed. */
function send(port, msg) {
  try { port.postMessage(msg); } catch (_) {}
}

// ── Step helpers ──────────────────────────────────────────────

async function step1_discoverChunks(msg, baseUrl, send) {
  send({ type: "status", message: "Discovering JS chunks..." });

  const chunkUrls = new Set();

  // 1a. Scripts already loaded in the page (injected by popup.js)
  for (const s of (msg.pageScripts ?? [])) {
    if (s && !s.startsWith("chrome-extension://")) chunkUrls.add(s);
  }

  // 1b. Parse the captured HTML
  if (msg.pageHtml) {
    discoverFromHtml(msg.pageHtml, baseUrl).forEach((u) => chunkUrls.add(u));
  }

  // 1c. Probe common routes (optional)
  if (msg.options?.includeProbes !== false) {
    send({ type: "status", message: "Scanning common URL paths..." });
    const probeResults = await fetchBatch(
      PROBE_PATHS.map((p) => baseUrl + p),
      safeFetch,
      5
    );
    for (const html of probeResults.values()) {
      discoverFromHtml(html, baseUrl).forEach((u) => chunkUrls.add(u));
    }
  }

  // 1d. Expand Next.js build manifest
  for (const mu of [...chunkUrls].filter((u) => u.includes("_buildManifest"))) {
    const content = await safeFetch(mu);
    if (content) discoverFromBuildManifest(content, baseUrl).forEach((u) => chunkUrls.add(u));
  }

  return [...chunkUrls].filter((u) => /\.js(\?|$)/.test(u));
}

async function step2_findSourcemaps(jsChunks, baseUrl, send) {
  const sourcemapUrls = new Set();
  const processed     = new Set();
  let   toProcess     = [...jsChunks];
  let   processedCount = 0;

  while (toProcess.length > 0 && processed.size < MAX_CHUNKS) {
    const batch = toProcess.splice(0, 10);

    await Promise.allSettled(
      batch.map(async (chunkUrl) => {
        if (processed.has(chunkUrl) || processed.size >= MAX_CHUNKS) return;
        processed.add(chunkUrl);

        const content = await safeFetch(chunkUrl);
        if (!content) return;

        const smUrl = extractSourcemapUrl(content, chunkUrl);
        if (smUrl) sourcemapUrls.add(smUrl);

        discoverFromJsContent(content, baseUrl)
          .forEach((u) => { if (!processed.has(u)) toProcess.push(u); });

        processedCount++;
      })
    );

    send({ type: "progress", step: 2, done: processedCount, total: processed.size + toProcess.length });
  }

  return { sourcemapUrls };
}

async function step3_extractFiles(sourcemapUrls, includeNodeModules, send) {
  const smList   = [...sourcemapUrls];
  const allFiles = [];
  let   smDone   = 0;

  for (let i = 0; i < smList.length; i += 4) {
    await Promise.allSettled(
      smList.slice(i, i + 4).map(async (smUrl) => {
        const data = await safeFetchJson(smUrl);
        if (data) allFiles.push(...extractSources(data, includeNodeModules));
        smDone++;
      })
    );
    send({ type: "progress", step: 3, done: smDone, total: smList.length });
  }

  return allFiles;
}

// ── Public entry point ────────────────────────────────────────

export async function runAnalysis(msg, port) {
  const _send = (m) => send(port, m);

  // Normalise the target URL to its origin
  let baseUrl = msg.url?.startsWith("http") ? msg.url : `https://${msg.url}`;
  baseUrl = baseUrl.replace(/\/$/, "");
  try { baseUrl = new URL(baseUrl).origin; } catch (_) {}

  try {
    // ── Step 1 ──────────────────────────────────────────────
    const jsChunks = await step1_discoverChunks(msg, baseUrl, _send);
    _send({ type: "step_done", step: 1, count: jsChunks.length });

    if (jsChunks.length === 0) {
      _send({ type: "error", message: "No JS chunks found. The page may be static." });
      return;
    }

    // ── Step 2 ──────────────────────────────────────────────
    _send({ type: "status", message: "Downloading JS files..." });
    const { sourcemapUrls } = await step2_findSourcemaps(jsChunks, baseUrl, _send);
    _send({ type: "step_done", step: 2, count: sourcemapUrls.size });

    if (sourcemapUrls.size === 0) {
      _send({ type: "error", message: "No sourcemaps found. The site may not expose source maps." });
      return;
    }

    // ── Step 3 ──────────────────────────────────────────────
    _send({ type: "status", message: "Downloading sourcemaps..." });
    const allFiles = await step3_extractFiles(sourcemapUrls, msg.options?.includeNodeModules ?? false, _send);
    _send({ type: "step_done", step: 3, count: allFiles.length });

    _send({
      type:  "complete",
      files: allFiles,
      stats: { chunks: jsChunks.length, sourcemaps: sourcemapUrls.size, files: allFiles.length },
    });

  } catch (err) {
    _send({ type: "error", message: err.message || String(err) });
  }
}
