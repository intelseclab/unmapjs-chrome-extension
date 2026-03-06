// Reads sourcemap JSON and emits clean { path, content } pairs.

import { SOURCE_PATH_PREFIXES } from "./constants.js";

/**
 * Strips bundler-specific prefixes and normalises a source path.
 * Returns null for paths that are unsafe or unresolvable.
 */
function cleanSourcePath(rawPath) {
  let p = rawPath;

  for (const prefix of SOURCE_PATH_PREFIXES) {
    if (p.startsWith(prefix)) { p = p.slice(prefix.length); break; }
  }

  if (p.includes("://")) {
    const m = p.match(/\[project\]\/(.*)/);
    if (m) p = m[1];
    else return null;
  }

  p = p.replace(/^\.\//, "").replace(/^\//, "");
  return (!p || p.includes("..")) ? null : p;
}

/**
 * Extracts source files from a parsed sourcemap object.
 * @returns {{ path: string, content: string }[]}
 */
export function extractSources(sourcemap, includeNodeModules = false) {
  const sources  = sourcemap.sources        || [];
  const contents = sourcemap.sourcesContent || [];
  const files    = [];

  for (let i = 0; i < sources.length; i++) {
    if (i >= contents.length || contents[i] == null) continue;
    const path = cleanSourcePath(sources[i]);
    if (!path) continue;
    if (!includeNodeModules && path.includes("node_modules")) continue;
    files.push({ path, content: contents[i] });
  }

  return files;
}
