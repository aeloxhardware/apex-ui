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
