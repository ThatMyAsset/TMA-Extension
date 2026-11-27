# ThatMyAssets Browser DLP

Manifest V3 extension for managed Chromium-family browsers and Firefox. It holds supported AI prompt submissions and UTF-8 text-file events, sends content only to the local endpoint agent over Native Messaging, and releases an action only after policy and enforcement acknowledgement succeed.

## Requirements

- Node.js 22 or newer
- Chrome/Edge 119+ or Firefox 128+
- TMA-AgentWork endpoint service and native messaging host `com.thatmyassets.dlp`

## Install and build

```powershell
npm ci
npx tsc --noEmit
npm test
npm run package
```

Build outputs are written separately to `dist/chromium/` and `dist/firefox/`. Load the Chromium folder through `chrome://extensions` or `edge://extensions`; load the Firefox folder at `about:debugging#/runtime/this-firefox` with **Load Temporary Add-on**. `npm run package` writes a ZIP and SHA-256 file for each browser in `release/`.

Register the Chromium extension ID and Firefox Add-on ID in TMA-AgentWork. The native host uses `allowed_origins` for Chromium and `allowed_extensions` for Firefox. The Firefox Add-on ID is `thatmyassets-dlp@thatmyassets.com`. Native host registration is incomplete until the popup reports an agent version and a recent health check.

## Verification

```powershell
npm ci
npx tsc --noEmit
npm test
npm run package
```

Unit tests cover provider host/path matching, supported JSON prompt extraction, malformed request payloads, complete/incomplete decision behavior, fail-closed enforcement, acknowledgement semantics, native response consistency, and popup protection-state derivation. Final verification should also exercise a live endpoint on every managed provider UI; DOM selectors and network API formats can change independently of this extension.

## Enforcement behavior

- Exactly one prompt or file is sent per inspection request. Multi-part submissions are inspected sequentially and released only if every item passes and every enforcement result is acknowledged.
- `allow` and `audit` release the held browser event after acknowledgement. `block`, incomplete inspection, unsupported input, timeout, disconnect, malformed response, and missing acknowledgement do not release it.
- File chooser `change`, prompt-region `drop`, and prompt-region `paste` are intercepted. Accepted events are replayed once to the provider. Providers that reject synthetic replay are reported as failed rather than marked as released.
- Main-world `fetch` and `XMLHttpRequest` hooks cover the explicitly configured ChatGPT, Claude, Perplexity, and Grok JSON prompt endpoints. Unrecognized payloads on those endpoints fail closed.
- Native responses are schema-checked, including agreement between `inspection_status` and `inspection_complete`. Health older than 60 seconds is shown as unavailable.
- The popup has Status and Coverage tabs with native agent status/version/policy, supported provider routes, detected prompt controls, and a local-only inspection explanation. Protection states distinguish protected, limited, degraded, enrollment pending, unavailable, and refresh-in-progress; no coverage is inferred on unsupported pages.

## Current limits

This is browser enforcement only, not desktop or operating-system DLP. It does not provide OCR, image inspection, archive parsing, PDF/document parsing, or protection inside iframes. Initial files are UTF-8 `txt`, `csv`, `json`, `xml`, `yaml`, `yml`, `log`, `env`, `sql`, `py`, `js`, `ts`, `go`, and `rs`, at most 512 KiB each and 20 items per submission. Other files are blocked on supported interception paths.

Provider UI selectors are best-effort and version-sensitive. Gemini and Copilot currently have editor/file interception but no configured network API interception. Streaming request bodies, WebSockets, arbitrary multipart network uploads, provider controls in unrecognized shadow-DOM layouts, and programmatic `form.submit()` are not covered unless they pass another configured interception path. Unsupported pages are explicitly outside coverage. Do not claim that these paths are protected. A changed provider UI requires adapter updates and live verification.

The extension sends raw prompt/file content only through extension messaging to the local native agent. It never sends content to the Control Plane and does not log content. The page provider can already access its own editor contents; the main-world channel is not a security boundary against a compromised provider page.
