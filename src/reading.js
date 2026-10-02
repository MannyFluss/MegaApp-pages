import { createFileRepository } from "./file-repository.js";
import { createReadingLibrary, READING_DATABASE } from "./reading-library.js";
import { createReadingGit, parseRepository } from "./reading-git.js";
import { MEGAAPP_ASSET_REPOSITORY, READING_SAMPLE_HASH } from "./reading-config.js";
import { validatePDF, pdfHash } from "./reading-assets.js";
const $ = (name) => document.getElementById(`reading-${name}`);
const sizeLabel = (size) => size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
export function createReading({ notify, stateReady, onRepositorySaved }) {
  let visible = false, library, account = null, remote = [], current, pdf, activeLoading, pdfjs, rendering, visiblePage = 1, zoom = 1, epoch = 0, busy = false, storage, session, objectURL;
  const viewKey = "megaapp-reading-view-v1";
  let resumeId = "";
  try { const value = localStorage.getItem(viewKey); if (value && value.length < 600) resumeId = value; } catch { /* session view */ }
  let repositoryURL = MEGAAPP_ASSET_REPOSITORY;
  $("repository").value = repositoryURL;
  const savedRepository = stateReady.then(async (store) => {
    let setting = store.rows().find((row) => row.name === "MEGAAPP_ASSET_REPOSITORY");
    if (!setting) {
      await store.set("MEGAAPP_ASSET_REPOSITORY", "string", MEGAAPP_ASSET_REPOSITORY);
      onRepositorySaved(); setting = { type: "string", value: MEGAAPP_ASSET_REPOSITORY };
    }
    if (setting.type !== "string") throw new Error("MEGAAPP_ASSET_REPOSITORY must be a string repository link.");
    repositoryURL = parseRepository(setting.value).url; $("repository").value = repositoryURL;
  }).catch((error) => { status(error.message); $("setup").open = true; });
  function disconnect() {
    session = null; storage = null; account = null; remote = [];
    $("key").value = ""; $("connect").textContent = "Connect library";
  }
  const status = (message) => { $("status").textContent = message; };
  const ready = createFileRepository({ name: READING_DATABASE }).then(async (repository) => {
    const proxy = Object.fromEntries(["reserveId", "upload", "list", "download"].map((name) => [name, (...args) => {
      if (!storage) throw new Error("Connect your GitHub library first.");
      return storage[name](...args);
    }]));
    library = createReadingLibrary({ repository, storage: proxy, getAccount: () => account });
    if (repository.warning) { status(repository.warning); $("cache-warning").hidden = false; $("cache-warning").textContent = repository.warning; }
    let rows = await repository.list();
    for (const record of rows.filter((r) => r.owner && !r.owner.startsWith("github:"))) {
      // Keep every local original while retiring unfinished Google bindings.
      await repository.update(record.id, ({ driveId: _old, ...local }) => ({ ...local, owner: "", remoteId: "", uploaded: false, cloudAvailable: false }));
    }
    const oldSample = rows.find((r) => r.sample && !r.uploaded && r.hash !== READING_SAMPLE_HASH);
    if (!rows.length || oldSample) {
      try {
        const response = await fetch("./output/pdf/a-place-for-papers.pdf");
        if (!response.ok) throw new Error("Open Reading online once to load the sample PDF.");
        const blob = await validatePDF(await response.blob()), hash = await pdfHash(blob);
        if (hash !== READING_SAMPLE_HASH) throw new Error("The sample update needs the new offline shell. Existing cached papers are available.");
        if (oldSample) await repository.update(oldSample.id, (record) => record.uploaded ? record : { ...record, blob, hash, page: 1, remoteId: "" });
        else await library.import(blob, "A place for papers.pdf", { sample: true });
      } catch (error) { if (!rows.length) throw error; status(error.message); }
    }
    await renderLibrary();
    return library;
  });
  ready.catch((error) => status(error.message));
  function controls() {
    $("upload").disabled = busy || !current || !pdf || !account?.writable || (current.owner && current.owner !== account.id);
    $("upload").textContent = current?.uploaded ? "Verify GitHub copy" : "Upload to GitHub";
    $("refresh").disabled = busy || !account;
    $("import").disabled = busy;
    $("connect").disabled = busy || !!session;
    $("repository").disabled = busy; $("key").disabled = busy; $("save-repository").disabled = busy;
    $("disconnect").disabled = busy;
    $("account").textContent = account ? account.email : "GitHub disconnected";
    $("disconnect").hidden = !session; $("key-label").hidden = !!session; $("key").hidden = !!session;
    $("prev").disabled = busy || !pdf || visiblePage <= 1;
    $("next").disabled = busy || !pdf || visiblePage >= pdf.numPages;
    $("download").disabled = !current;
    $("zoom-out").disabled = !pdf || zoom <= 0.75;
    $("zoom-in").disabled = !pdf || zoom >= 2;
  }
  async function action(run) {
    if (busy) return;
    busy = true; controls();
    try { await ready; await run(); }
    catch (error) { status(error.message); notify(error.message); }
    finally { busy = false; controls(); }
  }
  function rowButton(record, cloud = false) {
    const button = document.createElement("button"); button.className = "reading-paper";
    button.setAttribute("aria-pressed", String(!cloud && current?.id === record.id));
    const title = document.createElement("strong"); title.textContent = record.name;
    const detail = document.createElement("span");
    detail.textContent = cloud ? `In GitHub · ${sizeLabel(record.size)} · Download to read` :
      `On this device · ${sizeLabel(record.blob.size)}${record.uploaded ? record.cloudAvailable === false ? " · GitHub copy unavailable" : " · Uploaded to GitHub" : record.remoteId ? " · Upload pending" : record.sample ? " · Sample" : " · Local only"}`;
    button.append(title, detail);
    button.onclick = () => action(async () => {
      if (cloud) { status("Downloading and checking the PDF…"); const saved = await library.cache(record); await open(saved); status(library.repository.mode === "memory" ? "PDF available for this session. Save PDF before closing." : "PDF saved on this device. You can read it offline."); }
      else await open(await library.repository.get(record.id));
      await renderLibrary();
    });
    return button;
  }
  async function renderLibrary() {
    if (!library) return;
    const records = (await library.repository.list()).filter((r) => !r.owner || !account || r.owner === account.id);
    $("local-list").replaceChildren(...records.map((r) => rowButton(r)));
    const uncached = remote.filter((file) => !records.some((r) => r.owner === account?.id && r.remoteId === file.id && r.hash === file.hash));
    $("cloud-list").replaceChildren(...uncached.map((file) => rowButton(file, true)));
    $("cloud-empty").hidden = uncached.length > 0;
    $("cloud-empty").textContent = account ? remote.length ? "All GitHub PDFs are cached on this device." : "No PDFs here yet. Upload a document from this device." : "Connect this private repository on each device to share your library.";
    $("count").textContent = `${records.length} ${records.length === 1 ? "paper" : "papers"} ${library.repository.mode === "memory" ? "in this session" : "on this device"}`;
    controls();
  }
  async function open(record) {
    if (!record?.blob) throw new Error("This cached PDF is missing.");
    const request = ++epoch;
    rendering?.cancel(); rendering = null;
    await activeLoading?.destroy(); activeLoading = null; pdf = null;
    current = record; $("canvas").width = 0; $("canvas").height = 0; $("title").textContent = record.name;
    $("page-label").textContent = "Opening PDF…"; $("text").textContent = ""; controls();
    pdfjs ||= await import("../vendor/pdfjs/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
    const loading = pdfjs.getDocument({ data: new Uint8Array(await record.blob.arrayBuffer()),
      standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("../vendor/pdfjs/wasm/", import.meta.url).href,
      isEvalSupported: false, enableXfa: false, maxImageSize: 16000000 });
    activeLoading = loading;
    let passwordRequired = false;
    loading.onPassword = () => { passwordRequired = true; loading.destroy(); };
    let document;
    try { document = await loading.promise; }
    catch {
      if (request === epoch) $("page-label").textContent = "PDF unavailable";
      throw new Error(passwordRequired ? "Password-protected PDFs need a decrypted copy in this sample." : "This PDF could not be opened. Choose another paper; your existing copies are kept.");
    }
    if (request !== epoch) { await loading.destroy(); return; }
    pdf = document;
    resumeId = record.id;
    try { localStorage.setItem(viewKey, resumeId); } catch { /* session view */ }
    visiblePage = Math.min(record.page || 1, pdf.numPages); zoom = 1;
    $("page-input").max = String(pdf.numPages);
    await draw(); controls();
  }
  async function draw() {
    if (!visible || document.hidden || !pdf) return;
    rendering?.cancel(); const request = epoch, pageNumber = visiblePage, doc = pdf;
    try {
      const page = await doc.getPage(pageNumber);
      if (request !== epoch || pageNumber !== visiblePage || !visible) return;
      const natural = page.getViewport({ scale: 1 });
      const width = Math.max(180, $("surface").clientWidth - 40);
      const scale = Math.min(2, width / natural.width) * zoom;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale });
      const pixelScale = Math.min(ratio, Math.sqrt(8000000 / (viewport.width * viewport.height)));
      const canvas = $("canvas"); canvas.width = Math.ceil(viewport.width * pixelScale); canvas.height = Math.ceil(viewport.height * pixelScale);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      rendering = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: [pixelScale, 0, 0, pixelScale, 0, 0], background: "white" });
      await rendering.promise; rendering = null;
      if (request !== epoch || pageNumber !== visiblePage) return;
      $("page-label").textContent = `Page ${visiblePage} of ${pdf.numPages}`;
      $("page-input").value = String(visiblePage);
      $("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
      const text = await page.getTextContent();
      if (request !== epoch || pageNumber !== visiblePage || doc !== pdf) return;
      $("text").textContent = text.items.map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`).join("");
      controls();
    } catch (error) { if (error.name !== "RenderingCancelledException" && request === epoch) status(`PDF could not render: ${error.message}`); }
  }
  async function move(page) {
    if (!pdf || !Number.isInteger(page) || page < 1 || page > pdf.numPages) return;
    visiblePage = page; await draw(); await library.page(current.id, page); controls();
  }
  $("prev").onclick = () => action(() => move(visiblePage - 1));
  $("next").onclick = () => action(() => move(visiblePage + 1));
  $("page-form").onsubmit = (event) => { event.preventDefault(); action(() => move(Number($("page-input").value))); };
  $("zoom-out").onclick = () => { zoom = Math.max(0.75, zoom - 0.25); draw(); controls(); };
  $("zoom-in").onclick = () => { zoom = Math.min(2, zoom + 0.25); draw(); controls(); };
  $("import").onclick = () => $("file").click();
  $("file").onchange = () => action(async () => {
    const file = $("file").files[0]; $("file").value = ""; if (!file) return;
    const saved = await library.import(file, file.name); await open(saved); await renderLibrary();
    status(library.repository.mode === "memory" ? "PDF kept for this session. Save PDF or upload to GitHub before closing." : "PDF saved on this device. Upload to GitHub when you want it on your other devices.");
  });
  $("upload").onclick = () => action(async () => {
    current = await library.upload(current.id, (progress) => status(`Uploading to GitHub… ${Math.round(progress * 100)}%`));
    remote = await library.refresh(); await renderLibrary();
    status("PDF stored in GitHub. On your other device, connect this repository and refresh.");
  });
  $("refresh").onclick = () => action(async () => {
    status("Refreshing GitHub…"); remote = await library.refresh(); await renderLibrary();
    status(`Library refreshed at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Choose a cloud PDF to cache it here.`);
  });
  $("save-repository").onclick = () => action(async () => {
    const value = parseRepository($("repository").value).url;
    const store = await stateReady;
    await store.set("MEGAAPP_ASSET_REPOSITORY", "string", value); onRepositorySaved();
    repositoryURL = value; $("repository").value = value;
    disconnect(); await renderLibrary();
    status("Repository location saved in State. Paste its key to connect on this device.");
  });
  $("connect").onclick = () => {
    if (busy) return;
    const key = $("key").value.trim(); $("key").value = "";
    return action(async () => {
      await savedRepository;
      const value = parseRepository($("repository").value).url;
      if (!/^github_pat_[a-zA-Z0-9_]{20,250}$/.test(key))
        throw new Error("Paste a fine-grained GitHub key for this repository. The repository link alone does not grant access.");
      disconnect();
      const connected = { key, expires: Date.now() + 60 * 60 * 1000 };
      session = connected;
      storage = createReadingGit({ repository: value, getToken: () => session === connected && Date.now() < connected.expires ? connected.key : "" });
      try {
        status("Checking the private library…"); account = await storage.account();
        const store = await stateReady;
        await store.set("MEGAAPP_ASSET_REPOSITORY", "string", value); onRepositorySaved(); repositoryURL = value;
        remote = await library.refresh();
      } catch (error) { disconnect(); await renderLibrary(); throw error; }
      await renderLibrary();
      if (current?.owner && current.owner !== account.id) {
        current = null; epoch++; rendering?.cancel(); await activeLoading?.destroy(); activeLoading = null; pdf = null;
        $("canvas").width = 0; $("text").textContent = ""; $("title").textContent = "Choose a paper"; controls();
      }
      $("connect").textContent = "Connected"; $("connect").disabled = true;
      status(account.writable ? "Connected. Upload a PDF, or choose a repository paper to read here." : "Connected for reading. Uploads need Contents read/write access.");
    });
  };
  $("repository").oninput = () => { disconnect(); renderLibrary(); };
  $("disconnect").onclick = () => {
    disconnect(); renderLibrary(); status("Disconnected. The key was forgotten; cached PDFs remain here. Revoke the key on GitHub to end access everywhere.");
  };
  setInterval(() => {
    if (session && Date.now() >= session.expires) { disconnect(); renderLibrary(); status("Connection expired after one hour. Paste your key to reconnect; cached PDFs remain available."); }
  }, 30000);
  $("download").onclick = () => {
    if (!current) return;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(current.blob);
    const link = document.createElement("a"); link.href = objectURL; link.download = current.name; link.click();
  };
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => draw(), 120); }).observe($("surface"));
  document.addEventListener("visibilitychange", () => { if (document.hidden) rendering?.cancel(); else draw(); });
  window.addEventListener("offline", () => status("Offline. Cached PDFs are available; uploads and refresh need a connection."));
  controls();
  return {
    setVisible(value) {
      visible = value;
      if (!value) { rendering?.cancel(); return; }
      ready.then(async () => {
        await savedRepository;
        if (!busy) {
          try {
            const setting = (await stateReady).rows().find((row) => row.name === "MEGAAPP_ASSET_REPOSITORY");
            if (setting && setting.type !== "string") throw new Error("MEGAAPP_ASSET_REPOSITORY must be a string repository link.");
            const value = parseRepository(setting?.value ?? MEGAAPP_ASSET_REPOSITORY).url;
            if (value !== repositoryURL) { disconnect(); repositoryURL = value; $("repository").value = value; await renderLibrary(); }
          } catch (error) { disconnect(); await renderLibrary(); status(error.message); $("setup").open = true; }
        }
        if (!visible) return;
        if (!current) {
          const rows = await library.repository.list();
          await open(rows.find((r) => r.id === resumeId) || rows.find((r) => r.sample) || rows[0]);
        } else await draw();
      }).catch((error) => status(error.message));
    },
  };
}
