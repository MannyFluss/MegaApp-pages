# Reading: PDFs in Drive, MegaApp on GitHub Pages

## The boundary

MegaApp is a static browser app hosted on GitHub Pages. Google Drive is a separate
asset service. Drive holds the complete PDF bytes; it does not host or execute
MegaApp. No MacBook, Cloud Run service, Firestore database, Secret Manager secret,
or custom backend is needed by Reading.

Configuration is small structured data: preferences and references to assets.
Assets are files: PDFs, images, audio, and eventually other creative materials.
Do not put large file bytes, authentication tokens, or private keys in the
ordinary State lab or in an environment/configuration export. Reading uses its
own `megaapp-reading-assets-v1` IndexedDB database for cached PDF bytes and small
local metadata. This is a prototype namespace, not the production state schema.

## Try it on two devices

1. Open `https://mannyfluss.github.io/MegaApp-pages/#reading`.
2. Add a PDF with **Add PDF**. It is saved on this device first. The ready-made
   two-page sample also works.
3. **Connect Google Drive** prepares Google's library. Then **Sign in to Google**
   opens Google's account chooser directly from your tap. Approve `drive.file`
   for the same app and account on each device.
4. **Upload to Drive** sends the complete PDF as a new ordinary Drive file.
5. On another device, connect that same Google account and **Refresh library**.
   Choose the PDF under **In Google Drive** to download and cache it.
6. After the offline shell is prepared, cached PDFs survive reload and can be
   read without a connection. **Save PDF** exports the original bytes.

Refresh is an explicit foreground operation. Uploading and downloading require an
online, open page and an unexpired session. There is no background sync guarantee
when iPadOS suspends/closes the browser. Page position is local to this browser;
annotations, PDF editing, deletions and synchronized reading progress are future
features. The sample never overwrites or deletes a Drive PDF. Files appear in
My Drive; the sample does not yet organize them into folders or import existing
Drive files with Picker.

## Google registration

Use the dedicated MegaApp Google Cloud project. The Drive API is already
enabled. Configure Google Auth Platform with a personal/external testing audience,
add the intended Google account as a test user, and create a **Web application**
OAuth client. Register the exact JavaScript origin:

```
https://mannyfluss.github.io
```

For local development, also register the exact origin used by the preview, for
example `http://localhost:5195` (Google requires localhost for HTTP development).
An origin has no repository path or `#reading`. This browser token flow needs no
redirect callback, client secret, server, API key, refresh token, or paid developer
program enrollment. The requirements are a Google Cloud project, an OAuth client,
and a Google account with Drive. School-managed accounts may require their
administrator to allow the app; do not assume a school account grants developer
permissions. Use the same OAuth project/client on all devices.

Set the public client ID in `src/reading-config.js` for a ready-to-connect deployed
app, or enter it under **Connection setup** on each browser. A client ID is public
app identity, not authorization. Never enter an OAuth client secret, access token,
password, service-account key, or API secret in that field.

Google Drive storage and current API quotas still apply. Google's October 2026
documentation describes daily billing thresholds for newly created projects;
small personal use is below those thresholds, but this is not an unlimited-free
storage promise. Nothing in Reading provisions paid compute.

## Access and isolation

Reading requests only `https://www.googleapis.com/auth/drive.file`: app-created
files and files explicitly selected for the app. It does not request all-Drive
access. The library lists supported PDFs tagged `megaapp-reading-v1` in private
`appProperties`. That tag is a namespace, not an access-control boundary.

Google also offers `appDataFolder`, a hidden app-only space suited to application
configuration. We use ordinary visible files for papers you can manage in Drive.
This sample does not use `appDataFolder` or decide the future configuration schema.

Short-lived access tokens and resumable upload addresses stay in memory. They are
excluded from local storage, IndexedDB, exports, the service-worker asset cache,
logs and ordinary State. Reload requires another deliberate sign-in. Disconnect
forgets the local token; revoke the app's grant in your Google account for account-
wide revocation. Cached PDFs remain on the device.

Browser storage is isolated by origin/browser profile, not by MegaApp tab. Other
trusted code running on the same origin could access the PDF cache or a live
session. Do not run arbitrary generated scripts in MegaApp's origin. Strong
isolation for untrusted apps requires a separate origin or properly sandboxed
iframe and a deliberate capability bridge; that larger architecture remains open.
A shared device can read cached PDFs even while Drive is disconnected.

## Prototype bounds and recovery

- PDF limit: 25 MiB per file; local library budget: 100 MiB. Actual browser quota
  can be lower and browser/site-data eviction can remove cached copies. Drive is
  authoritative only after Google confirms the upload.
- SHA-256 verifies downloaded bytes before committing a cache entry. Malformed,
  oversized or changed files do not replace preserved cached PDFs.
- A pending upload is bound to the selected Drive user and a pre-generated Drive
  ID saved locally before sending bytes. Retry reuses that ID; a lost success
  response is recovered by checking the actual uploaded bytes. A network failure
  preserves the local PDF and requires an explicit retry. Losing site data while
  an upload is uncertain also loses its local retry record; refresh Drive before
  adding another copy.
- Resumable chunks are 1 MiB. Session URLs are not persisted. Retry after reload
  starts a new session against the same reserved ID if no completed file exists.
- PDF.js 6.3.289 is vendored, including worker/fonts/image codecs and licenses.
  PDF scripting/eval and XFA are disabled. PDF links/scripts are not executed by
  the reader. Canvas rendering, selectable page text, page navigation, zoom and
  original download are supported. Encrypted PDFs need a decrypted copy.
- Reading position is preserved per cached asset. Remote edits are not a
  bidirectional editing feature: a changed tagged asset becomes a separate cached
  version if it retains valid metadata; an out-of-band byte change that disagrees
  with its stored hash is rejected and the older cached copy remains readable.

## Verification

`npm run check`, `npm test`, and `node tests/reading-browser.mjs` exercise the code.
The browser suite uses two isolated browser contexts and a shared Drive HTTP
fixture, including real PDF rendering and byte-for-byte export, pending upload
recovery, account separation, reload and offline shell recovery. HTTP fixtures
verify protocol behavior; they do not establish a live Google grant or actual
cross-device/iPad success. Record live acceptance separately after OAuth setup.

## Primary references

- [Browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Browser Drive setup](https://developers.google.com/workspace/drive/api/quickstart/js)
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Hidden app data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Resumable uploads and pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive quotas](https://developers.google.com/workspace/drive/api/guides/limits)
- [PDF.js](https://mozilla.github.io/pdf.js/)
