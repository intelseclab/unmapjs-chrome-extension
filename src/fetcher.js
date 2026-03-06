// Thin, safe wrappers around fetch. Never throws – returns null on failure.

export async function safeFetch(url) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    return res.ok ? await res.text() : null;
  } catch (_) {
    return null;
  }
}

export async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    return res.ok ? await res.json() : null;
  } catch (_) {
    return null;
  }
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
