import { MAX_PDF_BYTES, validatePDF, pdfHash } from "./reading-assets.js";
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const API = "https://api.github.com/repos/";
export function parseRepository(value) {
  if (typeof value !== "string" || value.length > 240) throw new Error("Enter a GitHub repository link or owner/repository.");
  const match = /^(?:https:\/\/github\.com\/)?([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(value.trim());
  if (!match || [".", ".."].includes(match[2]) || match[2].endsWith(".git"))
    throw new Error("Enter a GitHub repository link or owner/repository, without a key or query string.");
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}`, url: `https://github.com/${match[1]}/${match[2]}` };
}
export function validateGitPaper(value) {
  if (!value || value.version !== 1 || !HASH.test(value.hash) || value.path !== `papers/${value.hash}.pdf` ||
      typeof value.name !== "string" || !value.name.length || value.name.length > 200 ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_PDF_BYTES)
    throw new Error("This repository contains an unsupported paper record. Existing local PDFs are kept.");
  return { version: 1, id: value.path, path: value.path, hash: value.hash, size: value.size, name: value.name };
}
function sha(value) {
  if (!SHA.test(value)) throw new Error("GitHub returned an invalid Git object identifier.");
  return value;
}
function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
export function createReadingGit({ repository, getToken, fetcher = fetch }) {
  const location = parseRepository(repository);
  const root = `${API}${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;
  let branch, identity;
  async function request(path, { method = "GET", body, raw = false, allowMissing = false, limit = 8 * 1024 * 1024 } = {}) {
    const token = getToken();
    if (!token) throw new Error("Connection ended. Paste your repository key and reconnect.");
    const response = await fetcher(`${root}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(90000),
    });
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(response.status === 401 ? "The GitHub key expired or is invalid. Create a new repository key and reconnect." :
        response.status === 404 ? "Repository unavailable. Check the link and give the key access to this private repository." :
        response.status === 403 || response.status === 429 ? "GitHub denied this request. Check Contents read/write access, branch rules, or wait for the API rate limit to reset." :
        `GitHub request failed (${response.status}). Your local PDF is kept; retry to verify an uncertain upload.`);
      error.status = response.status; throw error;
    }
    const reader = response.body.getReader(), parts = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("The GitHub response exceeds this prototype's limit. Your cached papers are kept.");
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const blob = new Blob(parts, { type: raw ? "application/pdf" : "application/json" });
    return raw ? blob : JSON.parse(await blob.text());
  }
  async function head() {
    if (!branch) await adapter.account();
    const ref = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const commitId = sha(ref?.object?.sha);
    const commit = await request(`/git/commits/${commitId}`);
    return { commitId, treeId: sha(commit?.tree?.sha) };
  }
  async function treeAt(treeId) {
    const result = await request(`/git/trees/${sha(treeId)}?recursive=1`);
    if (result.truncated || !Array.isArray(result.tree) || result.tree.length > 10000)
      throw new Error("This library is too large for the prototype to list safely. Your cached papers are kept.");
    return result.tree;
  }
  async function paperFromEntry(entry, tree) {
    if (entry.type !== "blob" || entry.mode !== "100644" || entry.size > 4096) throw new Error("Unsupported library metadata.");
    const metadata = await request(`/git/blobs/${sha(entry.sha)}`, { raw: true, limit: 4096 });
    const paper = validateGitPaper(JSON.parse(await metadata.text()));
    if (entry.path !== `library/${paper.hash}.json`) throw new Error("Paper metadata does not match its filename.");
    const asset = tree.find((item) => item.path === paper.path);
    if (!asset || asset.type !== "blob" || asset.mode !== "100644" || asset.size !== paper.size)
      throw new Error("Paper metadata does not match its PDF. Existing local PDFs are kept.");
    return { ...paper, blobSha: sha(asset.sha) };
  }
  async function existing(record, tree) {
    const entry = tree.find((item) => item.path === `library/${record.hash}.json`);
    if (!entry) {
      if (tree.some((item) => item.path === `papers/${record.hash}.pdf`))
        throw new Error("An unindexed PDF already occupies this path. Resolve it in the repository; your local copy is kept.");
      return null;
    }
    const file = await paperFromEntry(entry, tree);
    if (file.hash !== record.hash || file.size !== record.blob.size) throw new Error("The existing repository paper contains different data.");
    await adapter.download(file); return file;
  }
  const adapter = {
    async account() {
      const repo = await request("");
      if (repo.private !== true) throw new Error("Reading requires a private asset repository. Personal PDFs must not go into the public app repository.");
      if (!Number.isSafeInteger(repo.id) || repo.id < 1 || repo.full_name?.toLowerCase() !== location.fullName.toLowerCase() ||
          typeof repo.default_branch !== "string" || !repo.default_branch.length || repo.default_branch.length > 200)
        throw new Error("GitHub did not identify this initialized repository.");
      const id = `github:${repo.id}`;
      if (identity && identity !== id) throw new Error("The repository identity changed. Reconnect before uploading.");
      identity = id; branch = repo.default_branch;
      return { id, email: repo.full_name, url: location.url, writable: repo.permissions?.push === true };
    },
    async reserveId(record) {
      if (!HASH.test(record?.hash)) throw new Error("Save the PDF fingerprint before uploading.");
      return `papers/${record.hash}.pdf`;
    },
    async list() {
      const snapshot = await head(), tree = await treeAt(snapshot.treeId), files = [];
      const entries = tree.filter((item) => /^library\/[a-f0-9]{64}\.json$/.test(item.path));
      if (entries.length > 1000) throw new Error("This prototype supports up to 1,000 papers.");
      // Metadata is bounded and fetched in small batches rather than firing a
      // request for every asset at once. Corrupt records fail visibly.
      for (let offset = 0; offset < entries.length; offset += 4)
        files.push(...await Promise.all(entries.slice(offset, offset + 4).map((entry) => paperFromEntry(entry, tree))));
      return files.sort((a, b) => a.name.localeCompare(b.name));
    },
    async download(file) {
      validateGitPaper(file);
      const blob = await validatePDF(await request(`/git/blobs/${sha(file.blobSha)}`, { raw: true, limit: MAX_PDF_BYTES }));
      if (blob.size !== file.size || await pdfHash(blob) !== file.hash)
        throw new Error("The repository PDF has changed or is corrupt. The previous cached copy is kept.");
      return blob;
    },
    async upload(record, onProgress = () => {}) {
      await validatePDF(record.blob);
      if (!HASH.test(record.hash) || record.remoteId !== `papers/${record.hash}.pdf` || await pdfHash(record.blob) !== record.hash)
        throw new Error("The PDF fingerprint or reserved path does not match. Your local PDF is kept.");
      const account = await this.account();
      if (!account.writable) throw new Error("This key cannot upload. Give Contents read/write access to this library repository only.");
      if (record.owner !== account.id) throw new Error("This pending PDF belongs to another repository. Reconnect its original repository.");
      const initial = await head(), initialTree = await treeAt(initial.treeId);
      const found = await existing(record, initialTree);
      if (found) { onProgress(1); return found; }
      const file = validateGitPaper({ version: 1, hash: record.hash, path: record.remoteId, name: record.name, size: record.blob.size });
      const pdfBlob = await request("/git/blobs", { method: "POST", body: { content: base64(new Uint8Array(await record.blob.arrayBuffer())), encoding: "base64" } });
      const blobSha = sha(pdfBlob.sha); onProgress(0.6);
      // Add PDF and metadata together, preserving all unrelated paths. Each
      // new commit has exactly the head we read as its parent. Non-forced ref
      // updates reject a racing writer; retry on their new tree without loss.
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = attempt === 0 ? initial : await head();
        if (attempt) {
          const found = await existing(record, await treeAt(snapshot.treeId));
          if (found) { onProgress(1); return found; }
        }
        const tree = await request("/git/trees", { method: "POST", body: { base_tree: snapshot.treeId, tree: [
          { path: file.path, mode: "100644", type: "blob", sha: blobSha },
          { path: `library/${file.hash}.json`, mode: "100644", type: "blob", content: `${JSON.stringify({ version: file.version, hash: file.hash, path: file.path, name: file.name, size: file.size }, null, 2)}\n` },
        ] } });
        const commit = await request("/git/commits", { method: "POST", body: { message: "Add paper to MegaApp Reading", tree: sha(tree.sha), parents: [snapshot.commitId] } });
        try {
          await request(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: { sha: sha(commit.sha), force: false } });
          // Also verifies a completed upload before declaring it synchronized.
          const confirmed = await existing(record, await treeAt((await head()).treeId));
          if (!confirmed) throw new Error("GitHub did not confirm the paper. Retry to verify the same PDF.");
          onProgress(1); return confirmed;
        } catch (error) {
          if (![409, 422].includes(error.status) || attempt === 3) throw error;
        }
      }
    },
  };
  return adapter;
}
