# Files workspace and Drive demo

**Current asset example:** [Reading](pdf-library.md) stores complete PDFs in Google Drive and caches their bytes in a separate local database. Small configuration/state contains preferences or file references, not PDF bytes or authentication secrets. MegaApp stays on GitHub Pages.

This local implementation adds **Files** at `#files`. It does not deploy a new
release, move existing data, or connect a Google account. The current sample
store, Marble scenes, drawing exports, and games keep their existing behavior.

## Try it

Run `npm run dev`, open the printed local URL with `#files`, and choose **Start
walkthrough**. Each walkthrough creates a new note; previous files remain.

1. Open a note and edit it. The draft saves on this device.
2. Save it to the simulated Drive. The two shelves show where each copy lives.
3. Go offline, edit, and save. The draft stays local with upload pending.
4. Reconnect and save again. The pending work uploads after a version check.
5. Change the simulated Drive copy, then refresh or save your different draft.
   Both copies appear in the conflict comparison.
6. Keep both to make a separate file from your draft, or use the Drive copy.
   Using Drive still preserves your draft in the downloadable history.
7. Try an interrupted upload, repeat Save, create the large sample, and export.

The simulation's Drive originals are browser data in a separate object store;
they do not reach Google. Both simulated places disappear if browser storage is
cleared or evicted. A session-only warning appears when IndexedDB is unavailable.
Export before relying on the browser as your only copy. Physical iPad storage
limits, background interruption, and Safari/Chrome/Home Screen separation still
need device checks.

## Storage boundary

`file-workspace.js` knows only the replaceable adapter interface:
`metadata`, `download`, `create`, `save`, and optional `recoverOperation`.
`mock-drive.js` implements it without network access. `drive-adapter.js` talks
only to the same-origin private broker. Choosing a different provider should not
require replacing draft, cache, conflict, or export logic.

Remote originals are authoritative after upload. Local files contain the cached
original or current draft, the version last read, preserved versions, and any
unresolved conflict. Open and manual Refresh check the current remote version.
Clean caches refresh; dirty drafts remain intact beside the remote copy. There
is no background polling or automatic replacement of an open editor.

Browser data lives in `megaapp-files-v1`, separately from `megaapp-sample`.
Binary content uses IndexedDB Blobs, not JSON/base64 values or localStorage.
If an engine rejects native Blob preparation, storage transparently stages
1 MiB ArrayBuffer chunks and commits their manifest with the file record. It
reconstructs the same original bytes when opening. Interrupted staging can leave
unreferenced chunks; this first version does not collect or delete them.
This first version accepts files up to 512 MiB. Text editing is bounded separately
in the interface; binary files can be imported, saved, reopened, and exported.
No cache eviction or history deletion is implemented.

## Save and recovery rules

- A local transaction must commit the draft and upload intent before a network
  mutation. Quota/transaction failure stops the upload.
- Upload intents retain their own Blob and operation ID. An interrupted or
  uncertain response retries the same operation; later typing does not discard
  those bytes. Recovery completes that intent before saving a newer draft.
- Local revision checks prevent stale editors from replacing another tab's
  content. A rejected stale edit receives a separate recovery draft when storage
  allows it. The interface also retains unsaved typing for direct download.
- Same-device Web Locks serialize saves, refresh, and conflict resolution across
  tabs where available. A same-realm queue covers other engines. The durable
  compare-and-swap checks and operation identities remain the preservation layer;
  a browser without Web Locks cannot guarantee one network request across tabs.
- Conflicts preserve the local draft and the downloaded remote copy. Keep both
  atomically creates the sibling draft before accepting the remote original.
  Use Drive copy archives the local draft before accepting it.
- Live Drive uses successor files rather than overwriting an original. See the
  [OAuth and broker setup](google-drive-setup.md) for the version-check boundary,
  idempotency, and access requirements.
- Live uploads require a private broker operation journal outside the source
  checkout. It reserves a Drive ID before upload and reuses that ID after a
  broker restart, including when a completed file is not yet searchable. File
  fingerprints reject reuse of one save ID for changed bytes. Completed versions
  detect an edited successor; uncertain completion verifies its actual content
  before acknowledging it. The journal contains operation metadata only, with
  no credentials, file bytes, or upload URLs. Missing or damaged journals block
  uploads and keep the local draft available.

## Portable export

Export is a standard uncompressed ZIP with original file bytes, current draft,
preserved versions, pending save bytes when distinct, the conflict copy when
downloaded, and a small `manifest.json`. Unzip with ordinary desktop tools; files
retain their formats and can be opened independently of MegaApp. Manifest fields
are explicitly selected; repository internals and credentials are excluded.
ZIP generation reads 64 KiB slices for checksums and reuses Blobs for output.
ZIP32 bounds are checked; split collections larger than 4 GiB. ZIP import into
MegaApp is not yet implemented; import extracted originals as files.

## Verification

`npm run check` and `npm test` cover syntax/assets, existing state recovery, local
revision checks, offline/pending/repeated flows, failed local commits, conflicts,
uncertain upload recovery, and ZIP bytes. `tests/files-browser.mjs` exercises real
IndexedDB, responsive controls, file downloads, and service-worker offline use
in WebKit and Chromium. `tests/file-repository-browser.mjs` additionally checks
real transaction rollback, competing connections, two-tab recovery, persisted
conflict/history bytes, and non-destructive upgrade of the new Files database.
The real Google endpoint and OAuth consent need approved
credentials before a live end-to-end test can run.
