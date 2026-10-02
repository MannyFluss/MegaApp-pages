# Reading: private Git assets, MegaApp on GitHub Pages

Manny chose Git as the actual storage medium on October 1, 2026, replacing the
unfinished direct-Drive setup. Static MegaApp remains on GitHub Pages. The separate
private `MannyFluss/MegaApp-library` repository holds complete original PDF bytes
and small metadata files. No new backend, Google API, cloud runtime, Git LFS, or
OAuth app registration is required for this prototype. Existing Google resources
remain unused; cleanup is a separate decision in `cloud-scope-correction.md`.

## Connect and try two devices

1. Open https://mannyfluss.github.io/MegaApp-pages/#reading.
2. Follow the in-app [key and storage guide](../reading/git-guide.html). Create a
   fine-grained GitHub key restricted to **Only select repositories →
   MegaApp-library**, with **Contents read/write** and a sensible expiry. Metadata
   read is automatic; do not add workflow or account permissions.
3. Paste the key in **Repository key**, then **Connect library**. The app clears
   the input and keeps access only in memory for at most one hour.
4. Add a PDF, then **Upload to GitHub**. Upload confirmation verifies the actual
   remote bytes before marking the local copy uploaded.
5. On another device, connect the same repository, **Refresh library**, and select
   its paper to download and cache it. Save PDF exports the original bytes.

The repository link alone grants no access. Generate keys yourself and keep them
in a password manager for reconnecting. Reload/disconnect forgets the session
key. Revoking a key in GitHub ends its access everywhere. The reader accepts only
fine-grained `github_pat_` keys, not broad classic tokens. Read-only keys may read
papers but cannot upload; GitHub enforces token permissions and branch rules.

## Environment location vs assets vs secrets

`src/reading-config.js` provides this public default:

```
MEGAAPP_ASSET_REPOSITORY=https://github.com/MannyFluss/MegaApp-library
```

Reading seeds the same **string variable** in the existing State lab. Its public
location travels with State JSON export/import. Change it in State, then open
Reading, or save it in Reading's repository setup. Changing the location ends the
connection. This is a browser configuration variable, not a server process env
var or a new production environment schema. No key is stored by Reading in State,
localStorage, IndexedDB, service-worker caches, source, commits, or exports.

Cached PDF bytes and per-paper page positions live in the existing isolated
`megaapp-reading-assets-v1` IndexedDB database, separately from ordinary State.
The previous local sample/imports are preserved across the provider switch.
Last-opened ID is a small localStorage reference. GitHub identity binds uploads
and cached remote versions to a stable repository ID. Cached papers remain
readable when disconnected; browser-profile users can access these local copies.

## Repository format and synchronization

```
papers/<SHA-256>.pdf
library/<SHA-256>.json
```

Each metadata record contains exactly the portable fields `version: 1`, `hash`,
`path`, original `name`, and byte `size`. Git's own SHA-1 blob identifiers identify
immutable versions returned by the API; SHA-256 separately checks PDF bytes.
PDFs are ordinary Git blobs, not pointers to another storage service.

`src/reading-git.js` uses GitHub's REST Git database API. Upload creates the PDF
blob, adds PDF and metadata in one tree based on the current head, makes a commit
with that head as its sole parent, and updates the branch with `force: false`.
Concurrent writers retry up to four times using the new head/tree, preserving all
unrelated paths. No global index has to be overwritten. Identical bytes share a
path; the first original name is retained. Repeated uploads and lost confirmations
verify the existing file rather than adding another copy/commit. Failed attempts
may leave unreferenced Git objects; cached originals remain intact.

Listing uses a consistent commit/tree snapshot and bounded metadata downloads.
Malformed metadata, symlinks, inconsistent sizes/paths, truncated trees, or
changed PDF hashes fail visibly instead of silently claiming a complete library.
Downloads fetch raw Git blobs by immutable SHA, check size, PDF header, and hash
before entering the cache. External removal preserves cached originals. The app
adds/verifies papers and never replaces, force-pushes, or deletes remote files.

Sync is explicit and foreground. iPadOS suspension or a closed app does not
continue uploads. Page positions stay local; annotations, edits, deletion, and
synchronized progress are future features. Self-hosting can preserve the Git
repository and portable metadata; it still needs an adapter for the new server's
API/authentication. Changing a URL alone cannot switch protocols.

## Security and bounds

- Connect rejects public repositories. Upload rechecks privacy and repository ID
  before sending PDF bytes. Keep the library private; never use MegaApp-pages as
  the asset repository. Repository privacy can also be changed outside the app.
- Contents write permits changing/deleting any file inside the selected repo,
  although this reader only adds/verifies papers. A scoped key is still a secret.
- Token headers go only to the fixed `https://api.github.com/repos/<owner>/<repo>`
  API prefix. References reject credentials, alternate hosts, query strings, and
  arbitrary paths. Redirects fail; requests omit cookies and bypass HTTP caches.
- Masking a field does not isolate its value from trusted browser code. Same-origin
  MegaApp code shares the trust boundary; generated/untrusted apps need a separate
  origin/sandbox before receiving capabilities. This prototype does not claim to
  hide a connected credential from privileged code, an extension, or an agent
  authorized to inspect its browser. Keys are never deliberately sent to agents.
- Session access expires at one hour even if the GitHub key has a longer lifetime.
  A backgrounded page checks expiry on its next request; reload/disconnect forgets
  it. GitHub's own expiration/revocation may end access sooner.
- 25 MiB per PDF, 100 MiB total local cache, at most 1,000 indexed papers and 10,000
  tree entries. Streamed PDF and metadata responses are bounded. JSON/base64
  upload uses extra memory and is not resumable; retry checks the same fingerprint.
- Browser quota/eviction may remove cached copies. Keep uploaded originals or
  exported backups. In-memory fallback clearly reports session-only storage.
- Git retains binary history after normal deletion; this is a modest paper library,
  not a promise of unlimited media storage. GitHub blocks regular files over
  100 MiB and recommends small repositories. Large frequently edited media may
  need object storage or Git LFS later.
- PDF.js is pinned and bundled. Scripting/eval and XFA are disabled; page text is
  plain text and PDF actions are not executed. Rendering is pixel-bounded.

## Verification

Run `npm run check`, `npm test`, and `node tests/reading-browser.mjs` (set
`PLAYWRIGHT_MODULE_PATH` to the bundled installation if needed). Tests cover
atomic commits, preservation of unrelated paths, racing writers, deduplication,
lost acknowledgements, malformed/corrupt assets, private-repo checks, credential
scope/expiry boundaries, and repository-bound local cache operations.

The browser suite uses two isolated contexts sharing a GitHub protocol fixture,
plus a rejected-access profile, real PDF import/render/export, reload, responsive
layout, and an independent actual service-worker/offline-origin shutdown test.
Fixtures establish client behavior, not physical iPad or live fine-grained-token
acceptance. Live GitHub API evidence and release status are in reading-progress.md.

## Sources

- [GitHub cross-origin API access](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [Fine-grained keys](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Git blobs](https://docs.github.com/en/rest/git/blobs), [trees](https://docs.github.com/en/rest/git/trees), [commits](https://docs.github.com/en/rest/git/commits), [refs](https://docs.github.com/en/rest/git/refs)
- [GitHub file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
