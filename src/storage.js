// chrome.storage history management.

const HISTORY_KEY = "unmapjs_history";
const MAX_ENTRIES = 500;

/**
 * Appends an entry to history (one entry per hostname per calendar day).
 * Silently drops duplicates and trims the list to MAX_ENTRIES.
 */
export async function addToHistory(entry) {
  try {
    const data    = await chrome.storage.local.get(HISTORY_KEY);
    const history = data?.[HISTORY_KEY] ?? [];
    const today   = new Date().toDateString();
    const isDupe  = history.some(
      (h) => h.hostname === entry.hostname && new Date(h.timestamp).toDateString() === today
    );
    if (isDupe) return;
    history.unshift(entry);
    if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES;
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch (_) {}
}

/** Reads the full history array. Returns [] on any error. */
export async function getHistory() {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    return data?.[HISTORY_KEY] ?? [];
  } catch (_) {
    return [];
  }
}
