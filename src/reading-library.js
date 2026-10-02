import { validatePDF, pdfHash } from "./reading-assets.js";
export const READING_DATABASE = "megaapp-reading-assets-v1";
export const CACHE_LIMIT = 100 * 1024 * 1024;
export function createReadingLibrary({ repository, storage, getAccount }) {
  async function room(size, exclude = "") {
    const used = (await repository.list()).filter((r) => r.id !== exclude).reduce((sum, r) => sum + (r.blob?.size || 0), 0);
    if (used + size > CACHE_LIMIT) throw new Error("This sample's 100 MB local cache is full. Your PDFs are kept; use another browser or export copies.");
  }
  return {
    repository,
    async import(blob, name, { sample = false } = {}) {
      await validatePDF(blob); await room(blob.size);
      return repository.put({ id: crypto.randomUUID(), name: String(name || "Untitled.pdf").slice(0, 200),
        blob: new Blob([blob], { type: "application/pdf" }), hash: await pdfHash(blob), page: 1, sample,
        owner: "", remoteId: "", uploaded: false, created: new Date().toISOString() });
    },
    async upload(id, onProgress) {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub before uploading.");
      let record = await repository.get(id);
      if (!record) throw new Error("The local PDF is missing.");
      if (record.owner && record.owner !== owner) throw new Error("This PDF's pending upload belongs to another repository. Reconnect that repository.");
      // Bind and reserve before sending any file bytes. CAS stops stale tabs
      // from reserving and uploading different IDs for the same local PDF.
      if (!record.owner) record = await repository.put({ ...record, owner }, { expectedRevision: record.revision });
      if (!record.remoteId) {
        const remoteId = await storage.reserveId(record);
        record = await repository.put({ ...record, remoteId }, { expectedRevision: record.revision });
      }
      const file = await storage.upload(record, onProgress);
      if (getAccount()?.id !== owner) throw new Error("The account changed during upload. Reconnect the original account to verify the file.");
      return repository.update(id, (current) => ({ ...current, uploaded: true, cloudChecked: new Date().toISOString(), cloudAvailable: true, name: file.name }));
    },
    async refresh() {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub to refresh the library.");
      const files = await storage.list();
      if (getAccount()?.id !== owner) throw new Error("The account changed. Refresh again.");
      const ids = new Set(files.map((file) => `${file.id}:${file.hash}`));
      for (const record of await repository.list()) {
        if (record.owner === owner && record.uploaded)
          await repository.update(record.id, (r) => ({ ...r, cloudAvailable: ids.has(`${r.remoteId}:${r.hash}`), cloudChecked: new Date().toISOString() }));
      }
      return files;
    },
    async cache(file) {
      const owner = getAccount()?.id;
      if (!owner) throw new Error("Connect GitHub to download this PDF.");
      const id = `git:${owner}:${file.id}:${file.hash}`;
      const existing = (await repository.list()).find((r) => r.owner === owner && r.remoteId === file.id && r.hash === file.hash);
      if (existing) return existing;
      await room(file.size);
      const blob = await storage.download(file);
      if (getAccount()?.id !== owner) throw new Error("The account changed. Download again from the selected account.");
      await room(blob.size);
      return repository.put({ id, owner, remoteId: file.id, hash: file.hash, name: file.name, blob, page: 1,
        uploaded: true, cloudAvailable: true, cloudChecked: new Date().toISOString(), created: new Date().toISOString() });
    },
    async page(id, page) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Invalid page number.");
      return repository.update(id, (record) => ({ ...record, page }));
    },
  };
}
