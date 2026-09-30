---
name: project-desktop-exe
description: "Apex UI ships as a packaged Electron EXE — design for desktop capabilities (embedded Python, native dialogs), not browser limits"
metadata:
  node_type: memory
  type: project
  originSessionId: 140664a4-b513-46ef-9738-2f24690c8ca1
  modified: 2026-09-27T16:09:01.752Z
---

The Apex slicer UI will be packaged into a Windows EXE (Electron, `electron/main.cjs` + `electron-builder`). The user dismissed "works in the browser" as a concern (2026-09-27).

**Why:** end product is a desktop app; heavy processing (e.g. the G-code → polar conversion script) runs locally.

**How to apply:** prefer Electron main-process work via IPC/preload (`window.apexDesktop`) and bundled runtimes (embedded Python in `build/python-embed`, fetched by `scripts/fetch-python-embed.cjs`) over in-browser workarounds; keep a graceful fallback only for the Vite dev server.
