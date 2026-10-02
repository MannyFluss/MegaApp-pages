# Storage implementation review

Verified locally on 2026-10-01. The starting repository was clean at `a3b0a60`.
The new work has not been published and has not connected a Google account.
Existing sample State data and creative projects were not migrated or removed.

## Results

The cloud extension adds ten tests, bringing the current total to **138 passing tests**. Files, Picker and portable HTML were rerun successfully in Chromium and WebKit after adding the hosted default mode. See [the current cloud deployment record](google-cloud-deployment.md) for project status and the remaining live acceptance checks.

- Syntax, relative imports, manifest assets, and offline shell assets pass
  `npm run check`.
- 128 unit/security tests pass: 36 existing tests, 27 file-preservation tests,
  14 adapter/API tests, 11 durable API/fingerprint tests, 13 independent
  journal/restart tests, 11 chooser-controller tests, and 16 broker security
  tests. Google endpoints are mocked; broker routes use ephemeral loopback servers.
- Files UI checks pass in Chromium and WebKit: ordinary State values retained,
  offline reload/reconnect, save-time conflict, both resolution choices,
  preserved draft/history export, repeated walkthrough/save/retry, stale editor
  recovery across two tabs, and separate unconfigured live storage.
- A 12 MiB binary file survives import, IndexedDB, upload simulation, reload,
  and ZIP export byte-for-byte. `/usr/bin/unzip -t` independently validates ZIP
  structure and CRC checks.
- Real IndexedDB checks pass in both engines: transaction abort rolls back
  all accepted writes; competing connections cannot both commit the same local
  revision; drafts, pending save bytes, conflict originals, and history survive
  reopening. An interrupted chunk stage produces no partial visible file.
- The new Files schema upgrade retains preexisting v1 record revisions and
  native Blob fields on Chromium. WebKit uses the binary-chunk fallback after
  its native Blob preparation failure; no sample-store schema is changed.
- Files fits 320, 390, and 1194 pixel widths with no horizontal overflow and
  reachable keyboard controls. Safari's native Option-Tab button navigation is
  used in the WebKit keyboard check.
- Existing WebKit playground, Marble Music, Pocket Jump, and design/intro
  browser regressions pass, including their offline checks. Design/intro was
  rerun after adding the chooser dialog.
- Chromium and WebKit chooser checks pass using an isolated actual HTTP mock:
  no-opener window, selected-file open/edit/successor save, unchanged Drive
  source and portable original history, cancellation with retained typing,
  repeated/stale/malformed/native selections, polling cleanup, keyboard focus,
  and cancel during a delayed Google loader with zero token-bootstrap requests.
- Broker restart tests recover the reserved ID without a second successor even
  when operation-property search is delayed. Concurrent processes reserve one
  ID, changed same-size bytes reject reused save IDs, corruption fails closed,
  and edits during uncertain completion verification produce a preserved conflict.
- Missing Drive copies permit explicit recovery as a new file. Current typing,
  distinct older pending bytes, original-opened bytes, and sibling histories
  remain exportable after either conflict choice; no existing record is deleted.
- The final standalone `demo.html` passes Chromium and WebKit file-browser checks
  with zero HTTP/WebSocket attempts and zero page errors. Its Drive actions are
  forced simulations, even when its URL contains `storage=drive`.

## Reproduce

```sh
npm run setup:cloud
npm run check
npm test
npm run dev
# In a separate terminal, with an installed matching Playwright runtime:
BASE_URL=http://127.0.0.1:4173/ node tests/files-browser.mjs
BASE_URL=http://127.0.0.1:4173/ node tests/file-repository-browser.mjs
BROWSER_ENGINE=chromium BASE_URL=http://127.0.0.1:4173/ node tests/files-browser.mjs
BROWSER_ENGINE=chromium BASE_URL=http://127.0.0.1:4173/ node tests/file-repository-browser.mjs
# Picker and Drive mocked by a private test HTTP fixture:
BASE_URL=http://127.0.0.1:4173/ node tests/picker-browser.mjs
node scripts/package-demo.mjs
node tests/portable-demo-browser.mjs
```

Set `PLAYWRIGHT_MODULE_PATH` to an existing installation when needed. The Files
WebKit test stops its own isolated origin for offline navigation, working around
Playwright's WebKit offline-emulation/service-worker issue; the main preview is
left running. Test logs and screenshots live in ignored `.test-artifacts/`.
The portable review ZIP includes representative screenshots and logs separately
from the complete source tree.

## Remaining limits

Real OAuth/Drive/Picker end-to-end validation requires an approved Google Cloud
project, Drive and Picker API enablement, a Web application OAuth client,
matching redirect/origin, restricted browser key, private server credentials,
durable journal path, and the user's consent. See [exact setup](google-drive-setup.md).
Google's real loader/CSP compatibility, key restrictions and browser cookie
behavior are still unverified. Access is session-only with `drive.file` scope.
Persistent access needs separate approval and a secure credential store.

The default loopback broker cannot serve a remote iPad. An explicit HTTPS proxy
origin is implemented and mocked; no gateway/host has been provisioned. Choose
the [one bundled hosting/setup decision](ipad-drive-decision.md) before live work.

Live edits create successor files instead of overwriting originals. Durable
recovery requires keeping its private journal; losing it removes the reserved-ID
guarantee for historical saves, and corruption stops uploads. Legacy malformed
lock files fail closed and need inspection
with the broker stopped; new atomic lock publication avoids that crash window.
Native Google documents need a separate export path. Browser quota still applies;
files are capped at 512 MiB and text editing at 2 MiB. Chunk staging and retained
history consume space because cleanup is deliberately absent. Listing many large
files in the chunk fallback currently reconstructs their Blobs; a metadata-only
shelf would improve that scaling case. Physical iPad Safari/Chrome/Home Screen
behavior has not been tested. No iOS Quick Look interactivity is promised for the
standalone HTML; open it in a browser that permits local HTML scripts.
