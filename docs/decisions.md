# Initial decisions

These are prototype choices, not a permanent architecture. The general product direction comes from the project interview recorded in README.md.

## Chosen for this feature

| Choice                                                            | Why                                                                                       | Revisit when                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Static HTML, CSS, and JavaScript modules                          | Directly deployable, portable, offline-capable, and no framework dependency               | The editor/app model creates a concrete need for a framework or bundler |
| Support Safari and Chrome on iPad, plus portable desktop use      | Chrome is the user's usual browser; core creative workflows should work in either         | Physical browser tests reveal a specific difference needing a fallback  |
| Canvas2D drawing with document coordinates                        | A small reliable surface for learning precise input; GPU/worker APIs have separate probes | A real creative workload needs a different renderer                     |
| Runtime feature detection and explicit probes                     | Browser version, iPad hardware, permission, and successful operations are different facts | Always retain fallbacks                                                 |
| Local IndexedDB sample values with validated JSON snapshots       | Demonstrates persistence and typed namespaces without committing to production state      | Real projects/assets need a storage and backup model                    |
| No secrets in sample state                                        | The demo and exports are ordinary application data                                        | Design an isolated credential path before adding privileged services    |
| No cloud service yet                                              | The first requested feature is the deployed app and a sample persistence experiment       | AI/service access or actual synchronization is selected                 |
| Touch drawing plus two-finger navigation, with Pencil-only option | Reversible interaction experiment                                                         | Physical iPad testing suggests a better default                         |

## Larger decisions to surface when they become relevant

- **Native-only Pencil or hardware features:** squeeze, double tap, Pencil haptics, MIDI, USB, and Bluetooth are not a dependable Safari-web foundation. If one becomes essential, choose a native wrapper or a gateway then. [Canvas audit](canvas-apis.md), [Safari audit](safari-apis.md).
- **Multithreaded compiled engines:** SharedArrayBuffer/Wasm threads need cross-origin isolation headers. Plain GitHub Pages does not give this app custom response-header control. Choose hosting with header control if a real workload needs threads; ordinary workers and messaging already work. [Cross-origin isolation documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).
- **Generated app isolation:** same-origin app code can access shared storage and imported credentials. Define sandbox/capability boundaries before loading arbitrary generated apps with privileged access. [OWASP browser storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#storage-apis).
- **Cloud synchronization:** define what is synchronized, authentication, assets, conflicts, and reconnect behavior. Safari background execution cannot be assumed. Changing a URL alone does not implement synchronization.
- **Permanent data:** choose a backup/recovery policy before treating browser storage as valuable project storage. Safari tabs and installed apps do not share a live local store.
- **Configuration versus large files (deferred September 30, 2026):** Manny wants to revisit small portable config/state separately from large files such as PDFs and media. Consider references from config to files, which files should be cached in the browser, and whether their saved copies belong in iCloud or another file store. The storage design and provider remain open for a later session.
- **Repository visibility:** On September 30, 2026, the user approved a separate public `MegaApp-pages` repository containing only website files. The development repository, notes, tests, and history stay private. GitHub Pages publishes `main` / root from that public repository with HTTPS. Local user configuration and credentials are not published.

None of the future decisions blocks the current local capability playground.

## First creative toy: Marble Music

Draw colored rails, then let small marbles turn collisions into a pentatonic melody. A ready-made scene makes the mechanic discoverable before drawing. Fixed document coordinates preserve a scene across rotation and window sizes; Pointer Events accept finger, Pencil, and mouse without relying on pressure.

The prototype uses bounded circle/segment physics and synthesized Web Audio notes. Playback starts through a deliberate action and pauses on hiding or switching apps. A small validated scene lives at `apps.marble.scene` in the existing sample store; importing or editing that value also updates the open instrument. JSON export/import supplies manual backup. Moving marbles, voices, and animation are temporary.

This experiment does not choose the production environment schema, cloud architecture, or generated-app isolation model. Those remain open until real creative work establishes requirements.

## 2026-10-01: Drive stores assets; Pages hosts the app

Manny corrected the cloud scope: Drive itself is the independent asset service, not a custom cloud host for MegaApp. Reading connects directly from the browser with `drive.file`, uploads actual PDFs, and caches them separately from small configuration/state. No backend or production environment schema is selected. Synchronization is explicit and foreground; page position remains local. See [PDF library](pdf-library.md).

The earlier Cloud Run deployment was a scope mistake. Stop this deployment path. Unused resources are recorded privately in `docs/cloud-scope-correction.md`; their removal is a separate cleanup decision. They are not used by Reading.
