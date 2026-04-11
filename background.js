"use strict";

//  Entry point for the UnmapJS service worker 
// All logic lives in src/. This file only wires Chrome events.

import { runAnalysis } from "./src/engine.js";
import { passiveScan } from "./src/scanner.js";

function canAutoScanUrl(rawUrl) {
  try {
    return /^https?:$/.test(new URL(rawUrl).protocol);
  } catch (_) {
    return false;
  }
}

//  Port listener (popup <-> background) 

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "unmapjs") return;

  function send(msg) {
    try { port.postMessage(msg); } catch (_) {}
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === "analyze") runAnalysis(msg, port);
  });
});

//  Tab listener (passive auto-scan) 

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  chrome.storage.local.get("unmapjs_settings", async (data) => {
    const settings = data?.unmapjs_settings ?? {};
    if (settings.autoScan !== true) return;
    if (!canAutoScanUrl(tab.url)) return;
    passiveScan(tabId, tab.url);
  });
});


