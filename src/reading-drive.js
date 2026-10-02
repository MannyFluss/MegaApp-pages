// Direct browser → Google Drive. Tokens and upload session URLs stay in memory.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const LIBRARY_TAG = "megaapp-reading-v1";
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const API = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,mimeType,size,modifiedTime,appProperties,trashed";
export function validClientId(value) {
  return typeof value === "string" && /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(value);
}
export async function validatePDF(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_PDF_BYTES)
    throw new Error("Choose a PDF smaller than 25 MB.");
  const head = new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer());
  if (!head.includes("%PDF-")) throw new Error("This file does not have a PDF header.");
  return blob;
}
export async function pdfHash(blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}
export function validateRemote(file) {
  if (!file || !/^[a-zA-Z0-9_-]{1,200}$/.test(file.id) || typeof file.name !== "string" || file.name.length > 1024 ||
      file.mimeType !== "application/pdf" || file.trashed || file.appProperties?.megaapp !== LIBRARY_TAG ||
      !Number.isSafeInteger(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > MAX_PDF_BYTES ||
      !/^[a-f0-9]{64}$/.test(file.appProperties?.sha256))
    throw new Error("A Drive file is outside this sample library's supported PDF format.");
  return { id: file.id, name: file.name, size: Number(file.size), hash: file.appProperties.sha256, modified: file.modifiedTime || "" };
}
export function uploadURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Drive did not return a valid upload address."); }
  if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/upload/drive/v3/files" ||
      url.username || url.password || !url.searchParams.get("upload_id"))
    throw new Error("Drive returned an unexpected upload address.");
  return url.href;
}
export function createReadingDrive({ getToken, fetcher = globalThis.fetch } = {}) {
  async function request(url, options = {}) {
    const token = getToken();
    if (!token) throw new Error("Connect Google Drive again to continue.");
    const response = await fetcher(url, { ...options, redirect: "error", credentials: "omit", cache: "no-store",
      signal: options.signal || AbortSignal.timeout(90000),
      headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw new Error("Your Drive session expired. Connect again; your PDFs are kept.");
    if (!response.ok && ![308, 404, 409].includes(response.status))
      throw new Error(`Drive request failed (${response.status}). Your local PDF is kept. Try again when connected.`);
    return response;
  }
  async function json(path) {
    const response = await request(API + path);
    if (!response.ok) throw new Error(`Drive request failed (${response.status}).`);
    return response.json();
  }
  return {
    async account() {
      const { user } = await json("about?fields=user(permissionId,emailAddress)");
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(user?.permissionId)) throw new Error("Drive did not identify the connected account.");
      return { id: user.permissionId, email: String(user.emailAddress || "Connected Google account") };
    },
    async list() {
      const files = []; let pageToken = ""; const seen = new Set();
      do {
        const query = new URLSearchParams({ q: `trashed = false and mimeType = 'application/pdf' and appProperties has { key='megaapp' and value='${LIBRARY_TAG}' }`,
          spaces: "drive", pageSize: "100", fields: `nextPageToken,files(${FIELDS})` });
        if (pageToken) query.set("pageToken", pageToken);
        const page = await json(`files?${query}`);
        for (const file of page.files || []) {
          // Leave unsupported or externally changed files in Drive, never mutate them.
          try { files.push(validateRemote(file)); } catch { /* not a supported library asset */ }
        }
        pageToken = page.nextPageToken || "";
        if (seen.has(pageToken) || seen.size > 100) throw new Error("Drive pagination did not finish. Refresh again.");
        seen.add(pageToken);
      } while (pageToken);
      return files;
    },
    async reserveId() {
      const { ids } = await json("files/generateIds?count=1&space=drive&type=files");
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(ids?.[0])) throw new Error("Drive did not reserve a file identifier.");
      return ids[0];
    },
    async download(file) {
      const response = await request(`${API}files/${encodeURIComponent(file.id)}?alt=media`);
      if (!response.ok) throw new Error("This PDF is unavailable in Drive. Its existing local copy is kept.");
      if (Number(response.headers.get("Content-Length")) > MAX_PDF_BYTES) throw new Error("This PDF exceeds the 25 MB sample limit.");
      // Bound streamed downloads even when Content-Length is absent.
      const reader = response.body.getReader(), parts = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_PDF_BYTES) throw new Error("This PDF exceeds the 25 MB sample limit.");
          parts.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const blob = await validatePDF(new Blob(parts, { type: "application/pdf" }));
      if (blob.size !== file.size || await pdfHash(blob) !== file.hash)
        throw new Error("The Drive PDF has changed outside this sample. The previous cached copy is kept.");
      return blob;
    },
    async upload(record, onProgress = () => {}) {
      await validatePDF(record.blob);
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(record.driveId) || !/^[a-f0-9]{64}$/.test(record.hash))
        throw new Error("Save a reserved Drive identifier before uploading.");
      const existing = await request(`${API}files/${encodeURIComponent(record.driveId)}?fields=${FIELDS}`);
      if (existing.ok) {
        const file = validateRemote(await existing.json());
        if (file.hash !== record.hash || file.size !== record.blob.size) throw new Error("This reserved Drive file contains different data. The local PDF is kept.");
        // An earlier acknowledgement may have been lost. Verify the actual bytes.
        await this.download(file); onProgress(1); return file;
      }
      if (existing.status !== 404) throw new Error("Drive could not check the reserved file. Try again.");
      const metadata = { id: record.driveId, name: record.name, mimeType: "application/pdf",
        appProperties: { megaapp: LIBRARY_TAG, sha256: record.hash } };
      const init = await request(`${UPLOAD}?uploadType=resumable&fields=${FIELDS}`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": String(record.blob.size) },
        body: JSON.stringify(metadata) });
      if (!init.ok) throw new Error("Drive could not start the upload. Retry with the same reserved file.");
      const session = uploadURL(init.headers.get("Location"));
      let offset = 0;
      while (offset < record.blob.size) {
        const end = Math.min(offset + 1024 * 1024, record.blob.size);
        const response = await request(session, { method: "PUT", headers: { "Content-Type": "application/pdf", "Content-Range": `bytes ${offset}-${end - 1}/${record.blob.size}` }, body: await record.blob.slice(offset, end).arrayBuffer() });
        if (response.ok) {
          const file = validateRemote(await response.json());
          if (file.id !== record.driveId || file.size !== record.blob.size || file.hash !== record.hash)
            throw new Error("Drive returned an unexpected file. Refresh before retrying.");
          onProgress(1); return file;
        }
        const match = /^bytes=0-(\d+)$/.exec(response.headers.get("Range") || "");
        const next = match ? Number(match[1]) + 1 : 0;
        if (response.status !== 308 || next <= offset || next > end) throw new Error("The upload stopped before completion. Retry; the same file identifier will be reused.");
        offset = next; onProgress(offset / record.blob.size);
      }
      throw new Error("Drive did not confirm the completed upload. Retry to verify it.");
    },
  };
}

export function createReadingAuth({ clientId, load = loadGoogleIdentity } = {}) {
  let token = "", expires = 0, client, generation = 0;
  return {
    getToken() { return Date.now() < expires ? token : ""; },
    async prepare() {
      if (!validClientId(clientId)) throw new Error("Add the public Google OAuth client ID in Connection setup first.");
      const oauth = await load();
      client = oauth.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE, include_granted_scopes: false, callback: () => {} });
    },
    connect() {
      if (!client) return Promise.reject(new Error("Prepare the Google connection first."));
      const attempt = ++generation;
      return new Promise((resolve, reject) => {
        client.callback = (result) => {
          if (attempt !== generation) return reject(new Error("Connection was canceled."));
          if (result.error || !result.access_token || !String(result.scope || "").split(" ").includes(DRIVE_SCOPE))
            return reject(new Error("Google Drive permission was not granted."));
          const seconds = Number(result.expires_in);
          if (!Number.isFinite(seconds) || seconds <= 30) return reject(new Error("Google returned an invalid session lifetime."));
          token = result.access_token; expires = Date.now() + (Math.min(seconds, 3600) - 30) * 1000; resolve();
        };
        client.error_callback = () => reject(new Error("Google sign-in was closed or blocked. Allow the sign-in popup and try again."));
        // Called directly by the second deliberate click, preserving iPad popup activation.
        client.requestAccessToken({ prompt: "select_account" });
      });
    },
    disconnect() { generation++; token = ""; expires = 0; },
  };
}
let googleLoading;
function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google.accounts.oauth2);
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => fail(), 20000);
    function fail() { clearTimeout(timer); script.remove(); googleLoading = null; reject(new Error("Google sign-in could not load. Check your connection and try again.")); }
    script.onload = () => { clearTimeout(timer); if (globalThis.google?.accounts?.oauth2) resolve(globalThis.google.accounts.oauth2); else fail(); };
    script.onerror = fail; document.head.append(script);
  });
  return googleLoading;
}
