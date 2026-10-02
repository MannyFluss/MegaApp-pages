import { createFileRepository } from "./file-repository.js";
import { createReadingLibrary, READING_DATABASE } from "./reading-library.js";
import { createReadingDrive, createReadingAuth, validClientId } from "./reading-drive.js";
import { READING_CLIENT_ID } from "./reading-config.js";
const $ = (name) => document.getElementById(`reading-${name}`);
const sizeLabel = (size) => size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
export function createReading({ notify }) {
  let visible = false, library, account = null, remote = [], current, pdf, activeLoading, pdfjs, rendering, visiblePage = 1, zoom = 1, epoch = 0, busy = false, auth, prepared = false, objectURL;
  const viewKey = "megaapp-reading-view-v1";
  let resumeId = "";
  try { const value = localStorage.getItem(viewKey); if (value && value.length < 600) resumeId = value; } catch { /* session view */ }
  const configKey = "megaapp-reading-public-client-v1";
  let clientId = READING_CLIENT_ID;
  try { clientId ||= localStorage.getItem(configKey) || ""; } catch { /* public configuration is optional */ }
  $("client").value = clientId;
  const status = (message) => { $("status").textContent = message; };
  const ready = createFileRepository({ name: READING_DATABASE }).then(async (repository) => {
    const drive = createReadingDrive({ getToken: () => auth?.getToken() || "" });
    library = createReadingLibrary({ repository, drive, getAccount: () => account });
    if (repository.warning) { status(repository.warning); $("cache-warning").hidden = false; $("cache-warning").textContent = repository.warning; }
    let rows = await repository.list();
    if (!rows.length) {
      const response = await fetch("./output/pdf/a-place-for-papers.pdf");
      if (!response.ok) throw new Error("Open Reading online once to load the sample PDF.");
      await library.import(await response.blob(), "A place for papers.pdf", { sample: true });
      rows = await repository.list();
    }
    await renderLibrary();
    return library;
  });
  ready.catch((error) => status(error.message));
  function controls() {
    $("upload").disabled = busy || !current || !pdf || !account || (current.owner && current.owner !== account.id);
    $("upload").textContent = current?.uploaded ? "Verify Drive copy" : "Upload to Drive";
    $("refresh").disabled = busy || !account;
    $("import").disabled = busy;
    $("connect").disabled = busy;
    $("client").disabled = busy;
    $("disconnect").disabled = busy;
    $("account").textContent = account ? account.email : "Drive disconnected";
    $("disconnect").hidden = !account;
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
    detail.textContent = cloud ? `In Google Drive · ${sizeLabel(record.size)} · Download to read` :
      `On this device · ${sizeLabel(record.blob.size)}${record.uploaded ? record.cloudAvailable === false ? " · Drive copy unavailable" : " · Uploaded to Drive" : record.driveId ? " · Upload pending" : record.sample ? " · Sample" : " · Local only"}`;
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
    const uncached = remote.filter((file) => !records.some((r) => r.owner === account?.id && r.driveId === file.id && r.hash === file.hash));
    $("cloud-list").replaceChildren(...uncached.map((file) => rowButton(file, true)));
    $("cloud-empty").hidden = uncached.length > 0;
    $("cloud-empty").textContent = account ? remote.length ? "All Drive PDFs are cached on this device." : "No PDFs here yet. Upload a document from this device." : "Connect the same Google account on each device to share your library.";
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
    status(library.repository.mode === "memory" ? "PDF kept for this session. Save PDF or upload to Drive before closing." : "PDF saved on this device. Upload to Drive when you want it on your other devices.");
  });
  $("upload").onclick = () => action(async () => {
    current = await library.upload(current.id, (progress) => status(`Uploading to Drive… ${Math.round(progress * 100)}%`));
    remote = await library.refresh(); await renderLibrary();
    status("PDF stored in Google Drive. On your other device, connect the same account and refresh.");
  });
  $("refresh").onclick = () => action(async () => {
    status("Refreshing Google Drive…"); remote = await library.refresh(); await renderLibrary();
    status(`Library refreshed at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Choose a cloud PDF to cache it here.`);
  });
  $("connect").onclick = () => {
    if (busy) return;
    if (!prepared) return action(async () => {
      clientId = $("client").value.trim();
      if (!validClientId(clientId)) { $("setup").open = true; $("client").focus(); throw new Error("Connection setup needs a public Google OAuth client ID. See the setup guide below."); }
      auth?.disconnect(); account = null; remote = [];
      auth = createReadingAuth({ clientId }); await auth.prepare(); prepared = true;
      try { localStorage.setItem(configKey, clientId); } catch { /* session configuration */ }
      $("connect").textContent = "Sign in to Google";
      status("Google sign-in is ready. Tap Sign in to Google to choose your account."); await renderLibrary();
    });
    // Start the popup before any awaited work, directly within the click.
    const connecting = auth.connect();
    return action(async () => {
      await connecting;
      const drive = createReadingDrive({ getToken: () => auth.getToken() });
      account = await drive.account(); remote = await library.refresh();
      $("connect").textContent = "Reconnect Google"; await renderLibrary();
      if (current?.owner && current.owner !== account.id) {
        current = null; epoch++; rendering?.cancel(); await activeLoading?.destroy(); activeLoading = null; pdf = null;
        $("canvas").width = 0; $("text").textContent = ""; $("title").textContent = "Choose a paper"; controls();
      }
      status("Connected. Upload a local PDF, or download a paper already in your Drive library.");
    });
  };
  $("client").oninput = () => { prepared = false; auth?.disconnect(); account = null; remote = []; $("connect").textContent = "Connect Google Drive"; renderLibrary(); };
  $("disconnect").onclick = () => {
    auth?.disconnect(); account = null; remote = []; prepared = false; $("connect").textContent = "Connect Google Drive";
    renderLibrary(); status("Disconnected on this device. Cached PDFs remain here. Revoke app permission in your Google account to remove the grant.");
  };
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
        if (!visible) return;
        if (!current) {
          const rows = await library.repository.list();
          await open(rows.find((r) => r.id === resumeId) || rows.find((r) => r.sample) || rows[0]);
        } else await draw();
      }).catch((error) => status(error.message));
    },
  };
}
