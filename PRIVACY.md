UnmapJS Privacy Policy
Effective date: 2026-03-26

UnmapJS ("the extension") is a browser extension designed to help users detect exposed JavaScript source maps on websites they are authorized to test.

1) What this extension does
UnmapJS analyzes JavaScript resources on user-selected pages, detects source map references, and can export recoverable source files to a ZIP archive on the user's device.

2) Data we collect
We do not collect personal data on our servers.
UnmapJS does not operate a backend that receives user browsing data, credentials, or uploaded content.

3) Data processed locally in the browser
To perform its single purpose, the extension may process the following data locally on the user's device:
- Current page URL/origin (for permission checks and scanning)
- Script/resource metadata from the active page
- Source map URLs and source-map-derived file content
- User preferences (for example: auto-scan and notification toggles)

All such processing occurs locally in the browser context.

4) Storage
UnmapJS stores only extension settings in chrome.storage.local.
Recovered source files are exported only when the user explicitly requests a ZIP download.

5) Permissions usage
The extension uses Chrome permissions strictly for its single purpose:
- activeTab: analyze the currently active tab after user action
- scripting: collect page script/resource references needed for detection
- downloads: save user-requested ZIP exports
- storage: persist extension preferences
- tabs: read active tab information and support optional passive scanning flow
- notifications: optional user alerts for findings
- optional host access: requested per-site at runtime

6) Data sharing and sale
We do not sell, rent, or transfer user data to third parties, except where required by law.
We do not use data for advertising, profiling, creditworthiness, or lending decisions.

7) Remote code
UnmapJS does not use remote code execution. JavaScript/Wasm used by the extension is packaged with the extension.

8) User control
Users can:
- Grant or deny site access prompts
- Enable or disable auto-scan and notifications
- Remove the extension at any time to stop all processing

9) Intended use
UnmapJS is intended for authorized security testing, debugging, and educational use only. Users are responsible for ensuring they have permission to test target websites.

10) Changes to this policy
We may update this policy to reflect product or legal changes. The updated version will be published with a new effective date.

11) Contact
For privacy questions, contact:
Email: info@happyhacking.org
GitHub: https://github.com/intelseclab/unmapjs-chrome-extension
