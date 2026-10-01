# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Apex is a 3D printer slicer UI developed by Aelox Hardware: a Babylon.js viewport (build plate, printer boundary shader, model loading/manipulation) surrounded by shadcn/ui panels for file management, printer/filament config, texture editing, and slicing. This repo was originally scaffolded from the `vite_react_shadcn_ts` template — expect those scaffolding conventions (see AI_RULES.md) alongside hand-written slicer-specific code.

## Commands

```bash
pnpm install       # this repo uses pnpm (pnpm-lock.yaml / pnpm-workspace.yaml present)
pnpm dev           # vite dev server on port 8080
pnpm build         # production build
pnpm build:dev     # development-mode build
pnpm lint          # eslint .
pnpm preview       # preview the production build
```

There is no test runner configured in this repo (no test script, no test files).

## Architecture

### Global event bus, not shared state

There is no state management library and no shared React context between the sidebar/panel components and the 3D viewport. Instead, `Viewport3D.tsx` and every panel component communicate exclusively through `window.dispatchEvent(new CustomEvent(...))` / `window.addEventListener(...)`, using a fixed set of `apex-*` event names, e.g.:

- `apex-tool-changed` — Sidebar → Viewport3D (select/move/rotate/scale/delete tool switch)
- `apex-mesh-selected`, `apex-mesh-deleted` — Viewport3D → ModelStatusBox, SliceSidebar, SliceModal, TextureEditorModal
- `apex-model-hover` — Viewport3D → ModelHoverTooltip
- `apex-import-model` — Sidebar → Viewport3D; Viewport3D → ModelStatusBox/SliceSidebar
- `apex-camera-updated` — Viewport3D → ViewCube (camera orientation sync)
- `apex-set-camera-view`, `apex-set-camera-custom`, `apex-reset-camera`, `apex-fit-screen` — panels/ViewCube → Viewport3D
- `apex-axis-changed` — AxisSidebar → SliceModal
- `apex-request-textures`, `apex-textures-loaded` — TextureEditorModal ↔ Viewport3D
- `apex-set-tooltip`, `apex-reset-tooltip` — CustomTooltip → TopRightMenu

When adding a feature that needs to move data between the viewport and any panel, follow this pattern rather than introducing prop drilling, context, or a store. When adding a new event, grep for `apex-` across `src/components` first to check whether an existing event already carries the needed data.

### Viewport3D is a self-contained Babylon.js engine

`src/components/Viewport3D.tsx` owns the entire Babylon.js lifecycle in a single `useLayoutEffect`: engine/scene/camera creation, the printer build-volume boundary (custom GLSL shader material defined inline via `BABYLON.Effect.ShadersStore`, radius/height constants at the top of the file), mesh import (`babylonjs-loaders` for GLB/STL), gizmo-based move/rotate/scale tools, mesh picking/highlighting, and hover/selection broadcasting. It holds all Babylon state in refs (`engineRef`, `sceneRef`, `cameraRef`, `gizmoManagerRef`, `modelsRef`, `selectedMeshesRef`) rather than React state, since Babylon objects are mutable and not meant to trigger re-renders. React state is only used for the few bits that need to affect JSX (e.g. `selectedMeshName`).

### Component/style structure

- `src/pages/Index.tsx` is the single page and composes every top-level panel; routing lives in `src/App.tsx` (React Router, per AI_RULES.md keep routes there).
- Feature panels (`Sidebar`, `FileSidebar`, `CategoriesSidebar`, `PrinterConfigSidebar`, `SliceSidebar`, `SliceModal`, `TextureEditorModal`, `AxisSidebar`, `TopRightMenu`, `ViewCube`, `ModelStatusBox`, `ModelHoverTooltip`) each pair with a `*.module.scss` file for custom styling (glassmorphism panels, custom sliders/drag handles) — Tailwind is used for layout/spacing, SCSS modules for bespoke visual treatment that Tailwind utilities don't cover.
- `src/components/ui/*` is generated shadcn/ui code — per AI_RULES.md, don't edit these directly; wrap or compose new components instead.
- Path alias `@/*` maps to `src/*` (configured in both `vite.config.ts` and `tsconfig.json`); shadcn aliases (`@/components`, `@/lib`, `@/hooks`, `@/components/ui`) are defined in `components.json`.
- Toast notifications go through `src/utils/toast.ts` (`showSuccess`/`showError` wrapping `sonner`), not direct `sonner` calls.

## Conventions from AI_RULES.md

- New pages go in `src/pages/`, new components in `src/components/`; routes are declared in `src/App.tsx`.
- Prefer shadcn/ui (`src/components/ui`) + Radix primitives + Tailwind for any new UI; all shadcn dependencies are already installed.
- After adding a component to `Index.tsx`'s tree, it must actually be rendered there or it won't be visible — keep the main page in sync with new components.

## G-code editing: handle-based deformation (design decisions, 2026-10-01)

Decided with the user in discussion. **Status: J0 (transport), J1 (C++ kernel) and J2 (Electron bridge) done; J3 (rendering + Édition panel), J4 (integrated latency), J5 (packaging) to do** — plan in `C:\Users\test_\.claude\plans\peut-on-commencer-par-la-linked-elephant.md`. Lives in the `Édition` tab of the Preview space (`PreviewUpperTabs.tsx`, currently a `ComingSoon` placeholder). Items marked *(open)* are unresolved — ask before assuming.

### Mechanism
- The user places **handles** in the G-code preview, then translates or rotates them. The selected trajectory point and its neighbours follow, weighted by an **adjustable influence** (not "weak": adjustable).
- Neighbourhood is measured every possible way (3D radius, along the toolpath, per layer; mm, point count or layer count). **Every mode is individually toggleable and tunable.** Falloff profile selectable (linear / gaussian / cubic / plateau); anisotropic influence is a setting; an influence barrier at layer / line-type boundaries is an option.
- Multiple handles with merged influences; lockable points/zones; symmetry; copy/paste of a deformation between handles; handles bound to a spline.
- Rotating a handle must also rotate the **B orientation** of neighbouring points (rotation is not purely geometric on this machine). Extrusion **E** must be recomputed after deformation.
- Adjacent toolpaths either **stretch/compress** (when enabled) or are **trimmed** according to the deformation (stair-step first, then a re-pass over the twisted toolpath). Trimming creates new toolpath geometry — treat it as a **second phase** after plain deformation.

### Real-time requirement (the hard part)
- The deformed toolpath is **visible during the drag**, including a preview of the new layer height. Latency must be imperceptible (see the fluidity memory: no visible stutter).
- **Validation is computed in real time by C++, never TypeScript.** The engine's C++ is currently bound to Python (pybind11) and `FastCollisionChecker` (step9) is Python, so this needs a native module loadable from Electron (N-API addon) or WASM in a worker, plus porting the fast collision check to C++. **Decided: N-API addon in an Electron `utilityProcess`, talking to the renderer over a `MessagePort`** (the app ships as exe/dmg/msi/AppImage, so browser mode and WASM are not targets; Emscripten is not installed anyway). `python-runner.cjs` (one process per call) is not suitable.
  - Code lives in `native/` (self-contained, builds with `node native/build.cjs`: MSVC + the CMake/Ninja bundled with Visual Studio + the cached Electron headers; Windows x64 only so far, macOS/Linux need their own toolchains). The addon needs the `win_delay_load_hook.cpp` redirect of `node.exe` to the host executable.
  - **J0 measurements (2026-10-01, 300 000 moves, synthetic kernel, superseded by J2)**: per drag frame round-trip 500 points p50 0.2 ms, 5 000 p50 1.0 ms, 20 000 p50 3.1 / p95 5.2 ms. `MessagePortMain` copies typed arrays (only ports are transferable), so return only what the frame needs, never the whole toolpath.
  - **J2 — bridge done (2026-10-01)**: `electron/edit-process.cjs` (utility process hosting the addon, protocol `{id, op, args}` → `{id, result | error}`), `apex:edit-open` in `main.cjs` (forks it lazily, hands a `MessageChannelMain` port to the window), preload relays the port with `window.postMessage({type: 'apex-edit-port'})` (a port cannot cross `contextBridge`), client `src/utils/editKernelClient.ts` (`editKernel.open()`, `load`, `setHandle`, `drag` with one request in flight and latest-wins replacement, `commit(finalTransform)`, `undo`, `redo`, locks). Addon path: `native/build/apex_edit.node` in dev, `resources/native/apex_edit.node` once packaged (J5, not done).
  - **End-to-end measurements** (`node native/bench/launch.cjs <file.gcode>`, Benchy 949 477 points, handle mid-file): load 0.51 s round-trip. Per frame, renderer round-trip — 5 mm sphere (33 k points): handle values p50 1.3 / p95 2.3 ms, + heights p50 2.2 / p95 3.4 ms; 10 mm sphere (125 k points): p50 3.9 / p95 6.9 ms, + heights p50 6.6 / p95 8.0 ms; returning every deformed point too (rejected path) p50 14.8 ms before any JS mesh work, which confirms the GPU decision. Commit / undo of 33 k points ~80 ms round-trip.
- Live drag = geometry-only approximation (position, B, new height); exact validation runs in C++ as well and must not block the drag.
- **J1 — deformation kernel done (2026-10-01)**: `native/src/edit_kernel.{hpp,cpp}`, no N-API dependency; tests `native/tests/test_edit_kernel.cpp` (15 tests against O(n²) brute-force references and exact properties, mutation-checked; `node native/build.cjs --test`); real-file bench `native/build/apex_edit_bench.exe <file.gcode>`. Model, so nobody re-derives it:
  - each extruding point keeps its 4 nearest **supports**: earlier points within `support_radius_mm` (0.5) inside a 60° cone under its head axis. Reverse edges = points resting on it. This contact graph *is* the "adjacent toolpaths" notion;
  - **along-path** distance = Dijkstra where a step along a bead costs its length and a contact costs only its *lateral* offset (a free contact let columns drift sideways — caught by a mutation test); **adjacency hops** = 0-1 BFS (along a bead free, each contact 1); before/after = deposition order relative to the handle;
  - weights computed once per handle placement / setting change; a drag frame only applies `p' = h + R(wθ)(p−h) + wT`, then C from position (choosing between `(r', C)` and `(−r', C+180)` to stay continuous: the tip can sit across the centre from the pivot), B from the rotated head axis, tangential tilt returned as a residual. Travel points get the interpolated displacement of the two matter points around them, never their own rotation (a far traverse would swing on the lever arm);
  - **real files are ~1 M moves** (Benchy 949 477, dino 1 031 242, median bead step 0.06–0.12 mm). Load 0.32–0.39 s. Per frame (all cores): 5 mm sphere 18–33 k points 1.2–1.8 ms; 10 mm sphere 43–125 k points 2.6–4.6 ms (max 8.5). Handle placement 0.4–21 ms. Commit / undo of 19–33 k points 60–77 ms (full grid + reverse-graph rebuild; supports are recomputed only near moved matter).
- **Live display = GPU vertex shader, decided by the user (2026-10-01).** Returning up to 125 k deformed points per frame (~4 MB copied over the `MessagePort`) and rebuilding their tubes in JS cannot fit a 16 ms frame. So: the C++ computes the weights once per handle placement and sends them to the renderer (per-vertex attribute); during the drag the bead vertex shader applies the same formula `p' = h + R(wθ)(p−h) + wT` from uniforms (zero per-frame data, independent of selection size); the C++ runs in parallel, latest-request-wins, for the exact values (ΔR/ΔC/ΔZ/ΔB fields, heights, later validation) and stays the only authority over the G-code. On release, the exact geometry from the committed firmware values replaces the preview. GLSL on the GPU is not "computing in TypeScript".
- **There is no notion of "layer" in 5-axis** (user clarification). Wherever this section says "layer", read **adjacent toolpaths**: the passes deposited *before* a given pass (they support it) and *after* it (they rest on it). So no layer markers are needed; the native module builds a toolpath adjacency graph (spatial proximity + deposition order) instead. `layerIndex` stays 0 for polar files and is not used.

### Handles and controls
- Translation: arrows. Rotation: rotation circles like the Preparation space (reuse the existing Babylon gizmos).
- **Second style, user's choice: Bézier-editor node** (user's screenshot, 2026-10-01: a curve, a central node on it, two tangent handles on a straight line through the node). A **central node** is placed and moved on the object (on the toolpath), then its **position can be locked**; the node is then moved, and **each handle of the node controls the reach (its length) and the direction (its orientation)** of the influence on its side. Ideally **any number of handles per node**, not just two. Handles move in the plane facing the camera ("according to the viewing angle"). Not part of the first J3 pass (arrows + rings first); how handle length/direction map onto the kernel's influence (e.g. per-direction anisotropic radius) is to design and confirm with the user.
- **Nozzle pivot = 46 mm** (user, 2026-10-01): the preview's `NOZZLE_PIVOT_MM = 46` is right and the kernel receives it via `pivotMm`. The engine's G-code export still compensates **45 mm** (`slicer_engine/file_io/gcode_export.py`, limit #61): to align on the engine side, not changed from here.
- Numeric entry of an exact displacement (ΔR, ΔC, ΔZ, ΔB) with the fields **updating live during a manual drag**.
- No snapping, no local scale, no choice of rotation axis, no axis/plane-constrained move, no pass reordering, no "isolate nearby layers" mode, no per-point scale.

### Physical validity
- Highlight points exceeding the **selected printer's** limits (B range, B speed/acceleration) — requires a printer profile readable by the UI (none found in `src` at the time of writing; the engine's `_default_machine_profile` holds B 0–185°, 750 °/s, 300 °/s²).
- Collision indicator (head / bed / part). Overhang indicator: later.
- E compensation is optional, with an optional manual factor (off / automatic / automatic + manual factor). Automatic B smoothing after an edit is a **user option**.
- Optional head-vs-normal deviation display with a **normal-field graph** and a small "?" explaining normals. Where it is drawn (3D arrows vs side panel) is *(open)*.

### Visualisation
- Influence weight: single violet hue, opacity/saturation grows with weight, blended over the original colour. Do **not** reuse the blue→red colormap (`gcodeColormap.ts`), it already serves the "colour by" modes. Locked points: hatched grey. Out-of-limit / collision: bright red, reserved for alerts. Selected handle: white ring. Displacement amplitude (optional): stroke width or halo, not colour. **A legend is required.** Check light/dark backgrounds and colour-blind contrast.
- Before/after overlay with a transparency slider.

### Undo and file handling
- Full undo/redo. Edits are stored as transformations (handle, delta, influence), not data copies.
- The file is **modified in place, original not kept**, except for an imported (not locally sliced) G-code, which only offers an **EXPORT COPY** button.
- The edit **journal is written as G-code comments and encrypted** with an Apex-specific scheme. The user's reason is publicity (a closed-looking feature on an open system gets talked about). **It is not a security boundary**: the project is open source, so any key is public — never describe it as protection. Only the journal is encrypted, the rest of the G-code stays plain. This also lets undo history survive closing the file.

### Out of scope here (other G-code editing tab, no relation to handles)
Adding/removing points on a segment with resampling (23 is rejected, 24 redraw/reloop a segment), inserting pauses/commands, simplifying a zone by point reduction. These go in a **separate** editing tab, not in `Édition`.

### Roadmap
- Later, after more thought: live influence adjustment by shortcut/wheel; overhang indicator.
- Very long term: named history states.
- "Dumb idea, for a dev who wants to finish their night once Apex is finished and released in at least version 100-billion-point-0, and has not forgotten to feed the cats and do the user's dishes first": save a set of handles and reapply it to another file/version (re-slice with other parameters, several copies of a part, printer-specific compensation). Poor fit if the geometry changed.
