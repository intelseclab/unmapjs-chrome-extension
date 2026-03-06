// Background passive scanner  runs on every completed tab navigation.
// Two-phase approach:
//   Phase 1: Collect sourcemap URL references from chunk JS files (fast, parallel)
//   Phase 2: Download up to 3 sourcemaps and count actual source files (verify)
// Notification fires only when real source files are confirmed.

import { SCAN_COOLDOWN_MS, PASSIVE_CHUNKS } from "./constants.js";
import { safeFetch, safeFetchJson } from "./fetcher.js";
import { discoverFromHtml, extractSourcemapUrl } from "./discovery.js";
import { addToHistory } from "./storage.js";

// Hostname  last-scan timestamp (cleared on service-worker restart; that's fine)
const recentlyScanned = new Map();

/** Injects a tiny content script to collect <script src> + PerformanceEntry URLs and outerHTML. */
async function collectPageData(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func() {
      const scripts = Array.from(document.querySelectorAll("script[src]"))
        .map((s) => s.src)
        .filter((s) => !s.startsWith("chrome-extension://"));
      let fromPerf = [];
      try {
        fromPerf = performance.getEntriesByType("resource")
          .filter((e) => e.initiatorType === "script" && !e.name.startsWith("chrome-extension://"))
          .map((e) => e.name);
      } catch (_) {}
      return {
        scripts: [...new Set([...scripts, ...fromPerf])],
        html:    document.documentElement.outerHTML.slice(0, 80000),
      };
    },
  });
  return results?.[0]?.result ?? null;
}

/** Sets the extension badge on a specific tab. Pass "" to clear. */
async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (_) {}
}

/** Returns the stored settings object (never throws). */
async function getSettings() {
  const d = await chrome.storage.local.get("unmapjs_settings").catch(() => ({}));
  return d?.unmapjs_settings ?? {};
}

/** Main entry point  called for each completed navigation. */
export async function passiveScan(tabId, url) {
  if (!url?.startsWith("http")) return;

  let hostname, origin;
  try { ({ hostname, origin } = new URL(url)); }
  catch (_) { return; }

  // Cooldown: skip if this hostname was scanned recently
  const last = recentlyScanned.get(hostname);
  if (last && Date.now() - last < SCAN_COOLDOWN_MS) return;
  recentlyScanned.set(hostname, Date.now());

  let pageData;
  try { pageData = await collectPageData(tabId); }
  catch (_) { return; }
  if (!pageData) return;

  const { scripts: pageScripts, html: pageHtml } = pageData;

  // Build candidate JS chunk list
  const chunkSet = new Set();
  pageScripts.filter((s) => /\.js(\?|$)/.test(s)).forEach((s) => chunkSet.add(s));
  discoverFromHtml(pageHtml, origin).forEach((u) => { if (/\.js(\?|$)/.test(u)) chunkSet.add(u); });

  const toCheck = [...chunkSet].slice(0, PASSIVE_CHUNKS);
  if (toCheck.length === 0) return;

  //  Phase 1: collect sourcemap URL refs 
  const sourcemapUrls = [];

  await Promise.allSettled(
    toCheck.map(async (chunkUrl) => {
      const content = await safeFetch(chunkUrl);
      if (!content) return;
      const smUrl = extractSourcemapUrl(content, chunkUrl);
      if (smUrl) sourcemapUrls.push(smUrl);
    })
  );

  //  Phase 2: verify sourcemaps have real source files 
  let verifiedFileCount = 0;
  if (sourcemapUrls.length > 0) {
    await Promise.allSettled(
      sourcemapUrls.slice(0, 3).map(async (smUrl) => {
        const data = await safeFetchJson(smUrl);
        if (data?.sourcesContent) {
          verifiedFileCount += data.sourcesContent.filter((c) => c != null && c.length > 0).length;
        }
      })
    );
  }

  const settings = await getSettings();

  // Nothing of interest  clear badge and exit
  if (verifiedFileCount === 0) {
    await setBadge(tabId, "");
    return;
  }

  await setBadge(tabId, "MAP", "#059669");

  // Persist to history (one entry per hostname per day)
  await addToHistory({
    url, hostname,
    sourcemapCount: sourcemapUrls.length,
    verifiedFiles:  verifiedFileCount,
    chunksChecked:  toCheck.length,
    timestamp:      Date.now(),
  });

  //  Notification  only when real files confirmed 
  if (settings.notifications !== false) {
    chrome.notifications.create(`unmapjs_map_${Date.now()}`, {
      type: "basic", iconUrl: "icons/icon48.png",
      title: "UnmapJS – Source Code Found!",
      message: `${hostname}: ${verifiedFileCount} source file(s) found.`,
    });
  }
}
