// Main analysis engine: driven by messages from the popup via a Chrome port.

import { PROBE_PATHS, MAX_CHUNKS } from "./constants.js";
import { safeFetch, safeFetchJson, fetchBatch, setFetchContext, clearFetchContext } from "./fetcher.js";
import { discoverFromHtml, discoverFromBuildManifest, discoverFromJsContent, extractSourcemapUrl } from "./discovery.js";
import { extractSources, cleanSourcePath } from "./extractor.js";

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

/**
 * Resolves a source path from a sourcemap entry to a fetchable https?:// URL.
 * Returns null for virtual bundler paths (webpack:///, turbopack:///, etc.)
 * that cannot be fetched over HTTP.
 */
function resolveSourceUrl(sourcePath, smUrl) {
  if (!sourcePath) return null;
  if (/^(webpack|turbopack|ng|rollup|vite|rsc|debugger|chrome-extension):/.test(sourcePath)) return null;
  if (sourcePath.startsWith("(")) return null;   // e.g. "(webpack)/buildin/..."
  if (sourcePath.includes("\0")) return null;     // null-byte virtual modules
  try {
    const u = new URL(sourcePath, smUrl);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch (_) {
    return null;
  }
}

/**
 * When a sourcemap has no sourcesContent, attempt to fetch each referenced
 * source file individually using its resolved URL.
 */
async function fetchExternalSources(sources, smUrl, sourceRoot, includeNodeModules, send) {
  const files = [];

  // sourceRoot shifts the base for relative paths
  const base = sourceRoot
    ? new URL(sourceRoot.endsWith("/") ? sourceRoot : sourceRoot + "/", smUrl).href
    : smUrl;

  const candidates = sources
    .filter(s => includeNodeModules || !s.includes("node_modules"))
    .map(s => ({ raw: s, url: resolveSourceUrl(s, base) }))
    .filter(({ url }) => url !== null);

  if (candidates.length === 0) return files;

  send({ type: "status", message: `Fetching ${candidates.length} external source file(s)...` });

  await Promise.allSettled(
    candidates.map(async ({ raw, url }) => {
      const content = await safeFetch(url);
      if (!content) return;
      const path = cleanSourcePath(raw);
      if (!path) return;
      files.push({ path, content });
    })
  );

  return files;
}

async function step3_extractFiles(sourcemapUrls, includeNodeModules, send) {
  const smList   = [...sourcemapUrls];
  const allFiles = [];
  let   smDone   = 0;

  for (let i = 0; i < smList.length; i += 4) {
    await Promise.allSettled(
      smList.slice(i, i + 4).map(async (smUrl) => {
        const data = await safeFetchJson(smUrl);
        if (data) {
          // Primary path: inline sourcesContent
          const inline = extractSources(data, includeNodeModules);
          if (inline.length > 0) {
            allFiles.push(...inline);
          } else if (data.sources?.length > 0) {
            // Fallback: sourcemap exists but has no embedded content —
            // attempt to fetch each source file by its resolved URL.
            const external = await fetchExternalSources(
              data.sources,
              smUrl,
              data.sourceRoot || "",
              includeNodeModules,
              send
            );
            allFiles.push(...external);
          }
        }
        smDone++;
      })
    );
    send({ type: "progress", step: 3, done: smDone, total: smList.length });
  }

  return allFiles;
}

/**
 * Fallback: re-fetch raw JS chunks and return them as downloadable files.
 * Used when sourcemaps exist but yield zero source files.
 */
async function collectRawChunks(jsChunks, send) {
  const MAX = 200;
  const toFetch = jsChunks.slice(0, MAX);
  const files   = [];
  let   done    = 0;

  await Promise.allSettled(
    toFetch.map(async (chunkUrl) => {
      const content = await safeFetch(chunkUrl);
      if (content) {
        let path;
        try {
          const u = new URL(chunkUrl);
          path = (u.hostname + u.pathname).replace(/^\/+/, "").replace(/[?#].*$/, "");
        } catch (_) {
          path = "chunks/" + chunkUrl.split("/").pop().replace(/[?#].*$/, "");
        }
        if (!/\.[a-z0-9]+$/i.test(path)) path += ".js";
        files.push({ path, content });
      }
      send({ type: "progress", step: 3, done: ++done, total: toFetch.length });
    })
  );

  return files;
}

// ── Public entry point ────────────────────────────────────────

export async function runAnalysis(msg, port) {
  const _send = (m) => send(port, m);

  // Set up page-context fetching if tabId is available
  if (msg.tabId) setFetchContext(msg.tabId);

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

    // ── Fallback: no source files recovered → serve raw JS chunks ──
    if (allFiles.length === 0) {
      _send({ type: "status", message: "No source files found — collecting raw JS chunks as fallback..." });
      const chunkFiles = await collectRawChunks(jsChunks, _send);
      _send({
        type:    "complete",
        files:   chunkFiles,
        stats:   { chunks: jsChunks.length, sourcemaps: sourcemapUrls.size, files: chunkFiles.length },
        fallback: "chunks",
      });
      return;
    }

    _send({
      type:  "complete",
      files: allFiles,
      stats: { chunks: jsChunks.length, sourcemaps: sourcemapUrls.size, files: allFiles.length },
    });

  } catch (err) {
    _send({ type: "error", message: err.message || String(err) });
  } finally {
    // Clean up fetch context
    clearFetchContext();
  }
}
