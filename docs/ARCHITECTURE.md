# Architecture (ex-CLAUDE.md)

Texte déplacé tel quel de `CLAUDE.md` (2026-11-04, R-031 §6) ; les règles à retenir restent résumées dans `CLAUDE.md`.

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

`src/components/Viewport3D.tsx` owns the entire Babylon.js lifecycle. Its single `useLayoutEffect` only creates a shared state object `st` (`viewport/viewportState.ts`) and calls the initialisation sections in order (`viewport/viewport*.ts`: scene/camera, gizmos, plate, grid, plate actions, G-code, box and pyramid tools, selection, sketch, extrusion, pointer, models, lifecycle, cleanup). Each section is a list of chunk functions `setupXxx(st)` (≤ 80 lines) that read what earlier chunks left in `st`; a `let` shared between chunks lives in `st` (`st.modelingActive`…). `src/components/initOrder.test.ts` checks statically that no chunk reads a value that is not set yet — run it after moving code between chunks. Logic that does not need Babylon sits in pure, tested modules next to the sections (`freeSpot.ts`, `gridLabelLogic.ts`, `cameraAngles.ts`, `modelNaming.ts`, `meshFeatureEdges.ts`). `gcodeLayer.ts` (`gcodeLayerParts/`) and `gcodeEditController.ts` (`edit-node/controllerParts/`) use the same pattern. The sections create: engine/scene/camera, the printer build-volume boundary (custom GLSL shader material defined inline via `BABYLON.Effect.ShadersStore`, radius/height constants at the top of the file), mesh import (`babylonjs-loaders` for GLB/STL), gizmo-based move/rotate/scale tools, mesh picking/highlighting, and hover/selection broadcasting. It holds all Babylon state in refs (`engineRef`, `sceneRef`, `cameraRef`, `gizmoManagerRef`, `modelsRef`, `selectedMeshesRef`) rather than React state, since Babylon objects are mutable and not meant to trigger re-renders. React state is only used for the few bits that need to affect JSX (e.g. `selectedMeshName`).

Camera conventions (user's decisions, 2026-10-06): panning (middle button) is a **lens shift** added to the projection matrix (`camera.getProjectionMatrix` is wrapped), not a camera move, so objects are seen from the same angle whatever the translation; preset views and entering Modélisation reset it. **Perspective switch off (AxisSidebar) = orthographic camera (user, 2026-10-28, "comme Fusion360")**: window = `radius·tan(fov/2)`, negative near plane, wheel is multiplicative toward the cursor (`st.orthoActive`, `viewport/`). Wheel zoom is toward the cursor; its step is a fixed distance (≈30 mm per notch) outside Modélisation and a percentage inside it.

### Component/style structure

- `src/pages/Index.tsx` is the single page and composes every top-level panel; routing lives in `src/App.tsx` (React Router, per AI_RULES.md keep routes there).
- Feature panels (`Sidebar`, `FileSidebar`, `CategoriesSidebar`, `PrinterConfigSidebar`, `SliceSidebar`, `SliceModal`, `TextureEditorModal`, `AxisSidebar`, `TopRightMenu`, `ViewCube`, `ModelStatusBox`, `ModelHoverTooltip`) each pair with a `*.module.scss` file for custom styling (glassmorphism panels, custom sliders/drag handles) — Tailwind is used for layout/spacing, SCSS modules for bespoke visual treatment that Tailwind utilities don't cover.
- `src/components/ui/*` is generated shadcn/ui code — per AI_RULES.md, don't edit these directly; wrap or compose new components instead.
- Path alias `@/*` maps to `src/*` (configured in both `vite.config.ts` and `tsconfig.json`); shadcn aliases (`@/components`, `@/lib`, `@/hooks`, `@/components/ui`) are defined in `components.json`.
- Toast notifications go through `src/utils/toast.ts` (`showSuccess`/`showError` wrapping `sonner`), not direct `sonner` calls.

