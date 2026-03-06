// Discovers JS chunk URLs from various sources.

/**
 * Rejects dangerous protocols; resolves relative paths against baseUrl.
 */
export function resolveUrl(path, baseUrl) {
  if (/^(javascript|data|vbscript):/i.test(path.trim())) return null;
  if (path.startsWith("http")) return path;
  return baseUrl.replace(/\/$/, "") + (path.startsWith("/") ? "" : "/") + path;
}

/** Extracts JS/CSS asset URLs from raw HTML text. */
export function discoverFromHtml(html, baseUrl) {
  const urls = new Set();

  // Attribute href/src pointing to common asset directories
  const attrPatterns = [
    /(?:src|href)\s*=\s*["'](\/(?:_next\/static|assets|static\/js|static\/css)\/[^"']+)["']/g,
    /"(\/_next\/static\/(?:chunks|css)\/[^"]+\.(?:js|css))"/g,
  ];
  for (const re of attrPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const resolved = resolveUrl(m[1], baseUrl);
      if (resolved) urls.add(resolved);
    }
  }

  // <script src="…">
  const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    const src = sm[1];
    if (src.startsWith("chrome-extension://")) continue;
    const resolved = src.startsWith("http") ? src : resolveUrl(src, baseUrl);
    if (resolved) urls.add(resolved);
  }

  // Next.js build manifest reference
  const buildM = html.match(/\/_next\/static\/([^/'"]+)\/_buildManifest\.js/);
  if (buildM) {
    const bid = buildM[1];
    urls.add(`${baseUrl}/_next/static/${bid}/_buildManifest.js`);
    urls.add(`${baseUrl}/_next/static/${bid}/_ssgManifest.js`);
  }

  return urls;
}

/** Parses Next.js _buildManifest.js to find all page chunk URLs. */
export function discoverFromBuildManifest(content, baseUrl) {
  const urls = new Set();
  const re = /"((?:static\/|\/\_next\/static\/)[^"]+\.js)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let p = m[1];
    if (!p.startsWith("/"))          p = "/_next/" + p;
    else if (!p.startsWith("/_next/")) p = "/_next/static/" + p.replace(/^\//, "");
    urls.add(baseUrl + p);
  }
  return urls;
}

/** Finds additional chunk references embedded inside a compiled JS file. */
export function discoverFromJsContent(content, baseUrl) {
  const urls = new Set();
  let m;

  const r1 = /["'](_next\/static\/chunks\/[a-f0-9.-]+\.js)["']/g;
  while ((m = r1.exec(content)) !== null) urls.add(`${baseUrl}/${m[1]}`);

  const r2 = /["'](?:\/_next)?(\/static\/chunks\/[^"']+\.(?:js|css))["']/g;
  while ((m = r2.exec(content)) !== null) {
    let p = m[1];
    if (!p.startsWith("/_next")) p = "/_next" + p;
    urls.add(baseUrl + p);
  }

  const r3 = /["'](\/assets\/[^"']+\.js)["']/g;
  while ((m = r3.exec(content)) !== null) urls.add(baseUrl + m[1]);

  return urls;
}

/** Extracts the sourceMappingURL comment from a JS file. */
export function extractSourcemapUrl(content, chunkUrl) {
  const m =
    content.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/) ||
    content.match(/\/\*[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*\*\//);
  if (!m) return null;
  const ref = m[1].trim();
  if (ref.startsWith("data:")) return null;
  try {
    return new URL(ref, chunkUrl).href;
  } catch (_) {
    return null;
  }
}
