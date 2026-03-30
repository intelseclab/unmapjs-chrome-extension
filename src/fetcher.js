// Thin, safe wrappers around fetch. Never throws – returns null on failure.
// Supports page-context fetching to bypass CORS when tabId is provided.

let _tabId = null;

/** Set the tab ID for page-context fetching. Call once before analysis. */
export function setFetchContext(tabId) {
  _tabId = tabId;
}

/** Clear the fetch context after analysis completes. */
export function clearFetchContext() {
  _tabId = null;
}

/**
 * Fetch via injected script in the page context (bypasses CORS).
 * Falls back to service worker fetch if injection fails.
 */
async function pageContextFetch(url, asJson = false) {
  if (!_tabId) return null;
  
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: _tabId },
      func: async (fetchUrl, returnJson) => {
        try {
          const res = await fetch(fetchUrl, { credentials: "omit" });
          if (!res.ok) return { ok: false };
          const data = returnJson ? await res.json() : await res.text();
          return { ok: true, data };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      args: [url, asJson],
    });
    
    const result = results?.[0]?.result;
    if (result?.ok) return result.data;
    return null;
  } catch (_) {
    // executeScript failed (e.g., restricted page) - fall back to direct fetch
    return null;
  }
}

/**
 * Service worker fetch (subject to CORS).
 */
async function swFetch(url, asJson = false) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    return asJson ? await res.json() : await res.text();
  } catch (_) {
    return null;
  }
}

export async function safeFetch(url) {
  // Try page-context first (bypasses CORS), then fall back to SW fetch
  const result = await pageContextFetch(url, false);
  if (result != null) return result;
  return swFetch(url, false);
}

export async function safeFetchJson(url) {
  const result = await pageContextFetch(url, true);
  if (result != null) return result;
  return swFetch(url, true);
}

/**
 * Fetches multiple URLs in parallel batches.
 * @returns {Map<string, string>} url → response text (only successful responses)
 */
export async function fetchBatch(urls, fetchFn, batchSize = 8) {
  const results = new Map();

  for (let i = 0; i < urls.length; i += batchSize) {
    const settled = await Promise.allSettled(
      urls.slice(i, i + batchSize).map(async (url) => ({ url, data: await fetchFn(url) }))
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.data != null)
        results.set(s.value.url, s.value.data);
    }
  }

  return results;
}
