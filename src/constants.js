// Source path prefixes stripped from sourcemap source paths
export const SOURCE_PATH_PREFIXES = [
  "turbopack:///[project]/",
  "turbopack:///[turbopack]/",
  "webpack:///",
  "webpack:///_N_E/",
  "webpack:///.",
  "vite:///",
  "rollup:///",
];

// Common app routes probed when "include probes" is enabled
export const PROBE_PATHS = [
  "/login", "/signin", "/signup", "/register",
  "/forgot-password", "/reset-password", "/verify",
  "/dashboard", "/app", "/home", "/landing",
  "/profile", "/settings", "/account",
  "/search", "/explore", "/feed", "/notifications",
  "/admin", "/admin/dashboard",
  "/about", "/contact", "/docs", "/api-docs", "/swagger",
];

// Passive scan: minimum time between two scans of the same hostname
export const SCAN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export const MAX_CHUNKS     = 500;
export const PASSIVE_CHUNKS = 10;
export const SNIPPET_SIZE   = 4096;
