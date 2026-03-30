# UnmapJS – Source Map Extractor

> A Chrome extension that recovers original source files from JavaScript source maps of any React, Next.js, Vite, or Webpack-based web application.

#### 1. **Discover** all JavaScript chunks loaded by a page.
![UnmapJS Screenshot](stage1.png)
#### 2. **Detect** sourcemap references inside those chunks.
#### 3. **Extract** the original source files from the sourcemap JSON.
![UnmapJS Demo](stage2.png)

---

## What It Does

Modern web applications bundle and minify their JavaScript before deployment. However, many production sites accidentally (or intentionally) expose **source map** (`.map`) files alongside their bundles. These files contain the original, human-readable source code.

**UnmapJS** automates the process of:

1. **Discovering** all JavaScript chunk files loaded by a page (via `<script>` tags, the Performance API, build manifests, and common route probing).
2. **Detecting** sourcemap references (`//# sourceMappingURL=...`) inside those chunks.
3. **Extracting** the original source files from the sourcemap JSON.
4. **Packaging** everything into a `.zip` archive for local export.

It can also run a **passive background scanner** (optional) on pages where you granted access, notifying you when source code is found.

---

## Features

- One-click analysis with live step-by-step progress
- Optional passive auto-scan on granted sites with badge indicator
- Discovers chunks via HTML parsing, Performance API, and Next.js build manifests
- Optional common-path probing (login, dashboard, etc.)
- Optional `node_modules` inclusion / exclusion
- Browser notification when sourcemaps are detected
- Downloads recovered source files as a structured ZIP archive

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.

To pack as a `.crx` file:
```
chrome://extensions/ → Pack Extension → select project folder
```

---

## Community

GitHub repository: https://github.com/intelseclab/unmapjs-chrome-extension

Feedback and feature requests are welcome via GitHub Issues. If UnmapJS is useful for your workflow, please consider starring the repository.

---

## Tech Stack

| Component | Details |
|---|---|
| Manifest | V3 |
| Background | Service Worker (`background.js`) |
| Source discovery | `src/discovery.js` |
| Analysis engine | `src/engine.js` |
| Passive scanner | `src/scanner.js` |
| ZIP packaging | [JSZip](https://stuk.github.io/jszip/) |

---

## Permissions & Privacy

- Uses `activeTab` and `scripting` to inspect the currently selected page when you click **Analyze**.
- Requests site access at runtime per-site when needed for analysis.
- Auto-scan is **off by default** and runs only on sites where you have granted access.
- Notification alerts are **off by default**.
- Data is stored locally in `chrome.storage.local` and not sent to external servers by this extension.

---

## Disclaimer

This tool is intended for **authorized security testing**, **bug bounty research**, and **educational purposes** only. Only use it on applications you have explicit permission to test. The author is not responsible for any misuse.

---

## License

MIT © 2026 UnmapJS Contributors — see [LICENSE](LICENSE) for details.
