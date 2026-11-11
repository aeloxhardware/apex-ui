# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Non-negotiable quality limits (user decision, 2026-11-01)

**R-029, R-030 and R-031 are CLOSED (2026-11-07)** — user decision written in `apex/integration/RULES.md` §11.4 and pushed.
The absolute priority that forbade any other task is **lifted**: sessions may take on other work and must not use the
"No, I cannot do this" refusal. The hard limits below **stay in force** (ratchet, no hidden state, machine as data…),
enforced by CI. Declared gaps at closure, named and tracked: R-030 point 2 → milestone « 100 % C++ engine » tracked by R-014;
R-030 point 8 → known limit #86 of the engine.

**Apex must be the pinnacle of slicers: a flawless design, not merely working software.** An
external read-only audit (2026-11-01) found the gaps below. None is acceptable long term; all must
be fixed, engine and UI alike. These rules override session convenience. Details and requests:
`apex/integration/RULES.md` §11 and `apex/integration/REQUESTS.md` (R-029, R-030, R-031 — read them
from `origin/main`).

Hard limits (no exception without a written decision from the user):
1. **No source file over 800 lines, no function/component over 80 lines (components: 150), no
   function with more than 8 parameters.** A check script (`scripts/check-limits.cjs`, wired into
   `pnpm lint` and CI) fails on any new violation.
2. **Ratchet**: a file already over the limit may only shrink. Touching it means splitting it in
   the same pass. `scripts/limits-baseline.json` lists the remaining debt (never grows). No file is
   over 800 lines any more (`Viewport3D.tsx`, `gcodeLayer.ts` and `gcodeEditController.ts` were split
   into `viewport/`, `gcodeLayerParts/` and `edit-node/controllerParts/`, see `docs/ARCHITECTURE.md`);
   no function is over the limit any more (debt 0; `pnpm lint`
   → `node scripts/check-limits.cjs --report`). The split is not yet validated in Electron.
3. **TypeScript strict, no exceptions for new code**: `strict`, `noImplicitAny`, `noUnusedLocals`,
   `noUnusedParameters` are turned on progressively (`noImplicitAny` first, then per-directory),
   never turned back off. No new `any`, `@ts-ignore` or `eslint-disable` without a comment giving the reason.
4. **Every non-trivial module is tested.** The 3D viewport logic, the G-code parser/writer pair
   (`gcodeParse.ts` ↔ `gcodeWriter.ts`, label and `;TYPE:` round-trip included) and the edit kernel
   client need tests; logic is moved out of React components so that it can be tested without mocks.
5. **One way to do each thing**: one tooltip mechanism (`bottomTip`), one number field
   (`ApexNumberField`), one slider (`ApexSlider`); no duplicate helpers. Engine-derived contract files
   (`schema:sync`, `vectors:sync`) are generated, never edited by hand, and `schema:check` runs in CI.
6. **No machine, head or printer constant in the UI code**: profiles are data (`profiles/`). Adding a
   printer is adding a profile, not editing a component.
7. **Dependencies are pinned and audited** (lockfile committed, licences listed in the credits).
8. **A workaround carries an identifier, a test that characterises it and a review date.** No dead
   code, no `*_local_*` copy of the project beside the repository.
9. **One documentation source**: this file stays short (rules and architecture); history lives in
   `RELEASES.md`.

## Quality gate (permanent, user decision 2026-11-05)

Beyond the size limits above, these constraints are **definitive** (same status as the hard limits: only a written decision
by the user lifts them). They are enforced by `pnpm lint` (→ `scripts/check-quality.cjs`) and CI, against
`scripts/quality-baseline.json`, a ratchet that **may only go down** (`pnpm quality:update` tightens it, never loosens it;
`pnpm quality:report` prints the totals). A new file or a touched file must not add a violation; touching a file listed in
the baseline means leaving it better (split, simplify, format it).

1. **Complexity**: cyclomatic ≤ 10, cognitive ≤ 15, nesting ≤ 3 per function (`eslint.quality.config.js`).
2. **Types**: no `!` non-null assertion, no `any`, no `@ts-*` comment; `strict` everywhere (`tsconfig.json` too). Target: enable
   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (the number of errors under each is in the baseline).
3. **Architecture** (`.dependency-cruiser.cjs`): no import cycle; `src/utils` and `src/modeling` never import from
   `components`, `hooks` or `pages`; nothing in `components`/`hooks` imports `pages`; the generated `components/ui` kit does
   not import Apex code; production code never imports a test. Known debt: the G-code core (`gcode*.ts`) lives in
   `components/` although `utils` depends on it — move it to `src/gcode/`.
4. **Typed event bus**: every `apex-*` event is declared in `src/events/apexEvents.ts` (name → `detail` type) and used through
   `emitApex` / `onApex`. A raw `new CustomEvent('apex-…')` or `addEventListener('apex-…')` elsewhere is a violation
   (ADR 0001). Emitters are migrated; listeners are the remaining debt.
5. **No dead code**: `knip` (`knip.json`) must not report unused files, exports, types or duplicates beyond the baseline.
6. **Workarounds**: `// WORKAROUND(APEX-123, revue 2027-02-01): …` with an identifier and a review date; an overdue date, a
   malformed tag, an untracked `TODO/FIXME/HACK`, or an `eslint-disable` without a reason (`-- reason`) fails the gate.
7. **Tests**: line coverage floor on the testable logic (`vite.config.ts` → `test.coverage.thresholds`, raise it, never lower it);
   a bug fix comes with a test that fails before it; refactors of the parser/writer/edit kernel are protected by the golden
   tests (`gcodeParse.golden.test.ts`: update the digests only with an explanation).
8. **Formatting**: Prettier (`.prettierrc.json`). New files must be formatted; existing files are listed in the baseline and
   formatted when touched (never in bulk: re-wrapping lines breaks the size limits and `initOrder.test.ts`).
9. **Decisions are written**: any structural decision gets a one-page ADR in `docs/adr/`.

`pnpm verify` runs everything CI runs (lint + quality, type-check, tests with coverage, schema/vectors/licences checks).

Definition of done: lint, type-check, `pnpm test` and `schema:check` pass; `check-limits` reports no
regression; the area touched is left better than it was found (debt shrinks at every pass); version
(`apexVersion` + `RELEASES.md`) is updated in the same change.

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

Tests: `pnpm test` (vitest, `src/**/*.test.ts`; first ones in `src/utils/apexSignature.test.ts`).

## Architecture
Détail (liste des événements `apex-*`, cycle de vie Babylon, conventions caméra, structure des composants/styles) : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — **à lire avant de toucher au viewport ou d'ajouter un événement.**
- **Bus d'événements global, pas d'état partagé** : aucun store ni contexte entre les panneaux et `Viewport3D.tsx` ; ils communiquent par `window.dispatchEvent(new CustomEvent('apex-*'))`. Avant d'ajouter un événement, `grep apex-` dans `src/components`.
- **`Viewport3D.tsx` possède tout le cycle de vie Babylon.js** ; l'état Babylon vit dans des refs, pas dans l'état React.
- Chaque panneau a son `*.module.scss` (Tailwind pour la mise en page) ; `src/components/ui/*` est du shadcn généré, à ne pas éditer ; routes dans `src/App.tsx` ; alias `@/*` → `src/*` ; toasts via `src/utils/toast.ts`.

## Conventions from AI_RULES.md

- New pages go in `src/pages/`, new components in `src/components/`; routes are declared in `src/App.tsx`.
- Prefer shadcn/ui (`src/components/ui`) + Radix primitives + Tailwind for any new UI; all shadcn dependencies are already installed.
- **Every slider is `ApexSlider`** (`src/components/ApexSlider.tsx`, user's rule, 2026-10-19): all current and future sliders in Apex (Paramètres, Prévisualisation, context menu, Modélisation…) use this component, modelled on the Prévisualisation speed slider (split track, glass handle, cyan value). Never add an `<input type="range">` or a new track; extend `ApexSlider` through its props (log scale, step, snap points, default value on double-click, intro) if a case is missing.
- **Every element carries its text in the bottom-of-screen tooltip and the mouse tooltip** (user's rule, 2026-10-13): wrap it in `CustomTooltip` (title + description), containers included — a toolbar whose buttons have their own tooltip gets one for its background with `container` (e.g. « Outils de modélisation », « Boîte à outils Esquisse »). New elements need their texts; ask the user for wording rather than inventing it. Non-interactive elements (the 3D scene, panels) get the bottom-of-screen text only, with no mouse bubble, through the `data-apex-tooltip="..."` attribute (read by `TopRightMenu`); the Viewport3D canvas deliberately carries none (user removed it, 2026-10-13).
- **Every engine parameter exposed in the UI carries a real explanatory tooltip** (user's rule, 2026-10-28): what it is for, what changing it does, what the engine measured (and "not measured" when it did not). Texts live in `src/utils/engineSettingsHelp.json`, keyed by schema path (shown through `CustomTooltip` in `EngineSettingsEditor`, long ones wrap in the bottom bar); `pnpm schema:verify` fails the build for a parameter without text or a text without parameter. Facts and figures come from the engine's own comments/CLAUDE.md, never invented; for a new parameter, ask the engine for the explanation through `apex/integration/REQUESTS.md` (R-023). Numeric fields use `ApexNumberField` (arrows always visible), never a raw `<input type="number">`.
- **Engine settings live in Paramètres › Algorithme (avancé)** (`EngineSettingsEditor`); the right panel of Préparation (`EngineSettingsPanel`, no side bar) only holds the « Mode de tranchage » selector for now (user, 2026-10-29). Settings that match a left-panel item (Solidité / Vitesse / Autres) are linked: the item carries `engine: '<schema path>'` in `CATEGORIES` (`CategoriesSidebar.tsx`) and renders an active `EngineItemRow` on the same store (`utils/engineSettings.ts`); items without `engine` stay inert ("Arrive bientôt").
- After adding a component to `Index.tsx`'s tree, it must actually be rendered there or it won't be visible — keep the main page in sync with new components.

## G-code editing: handle-based deformation
Détail : [`docs/EDITION_GCODE.md`](docs/EDITION_GCODE.md) — Édition du G-code par poignées (conception, noyau C++, validation, journal chiffré, rognage, re-tranchage). **À lire avant de toucher à `src/components/edit-node/`, `gcodeLayer.ts`, `gcodeEditController.ts` ou `native/`.**

### Dev value (user's rule, 2026-10-08)
Détail : [`docs/DEV_MODE.md`](docs/DEV_MODE.md) (`src/utils/devModePrefs.ts` ; désactivée = préversion : onglet Dev, raccourcis navigateur, espaces Modélisation/Dev masqués, filigrane « BETA », avis de préversion).
- **ALWAYS enabled unless the user says otherwise** (development, tests, e2e). Default = `import.meta.env.DEV`.
- **ALWAYS disabled for app releases** (exe/dmg/msi/AppImage builds). Before any release build, check that it ships disabled (production build default; no forced `true`, no stale stored value).

### Versioning (user's decision, 2026-10-08)
Détail et définition de chaque niveau : [`docs/VERSIONING.md`](docs/VERSIONING.md).

**Single version number in the shared repository (user's decision, 2026-10-26).** The Apex application (engine + interface) has **one** version number, kept in the shared repository **`aeloxhardware/apex`**: `VERSION` (source of truth) and `VERSIONS.md` (log). It changes with every version of the engine **and** of the interface. **On every version change made here**, also update `VERSION` and `VERSIONS.md` in `apex` (pull its latest state first: the engine may have changed the number in the meantime), and keep `apexVersion` in `package.json` equal to `apex/VERSION`. `RELEASES.md` below keeps the detail of the interface's changes. Format, levels and conflict rule: `apex/integration/RULES.md`, §9 (same scheme as below, now applied to the whole application). Engine and interface are developed separately, one session per repository: `apex/integration/RULES.md` (rules and contract) and `apex/integration/REQUESTS.md` (open requests, read at session start).

Format `<préversion>-<public>.<global>.<majeur>.<moyen>.<mineur>.<add-ins>.<correctif>.<builds>`, e.g. `alpha-0.2.1.2.1.1.1.221`. Single source: `apexVersion` in `package.json` (injected as `__APEX_VERSION__` by Vite, shown on the splash and the preview notice). `version` (semver, required by npm/electron-builder) = `<public>.<global>.<majeur>`, here `0.2.1`: keep it in sync.
- Bumping a level: the levels to its right restart (Builds excepted: it only restarts at a new public compiled version). Not yet defined: reset values to the right (0 or 1) — ask if it comes up.
- **`RELEASES.md`** (repo root) tracks the history of every software version (by version number; NOT a mirror of GitHub Releases, which only matter for the Builds counter) and states the current one. Update it with every version change, in the same commit.
- **Version as finely as possible: at every change made**, not only at releases. Each change bumps the right level (Add-ins for a button/small thing, Correctif for a bug fix, Mineur/Moyen/Majeur/Global above), updates `apexVersion` (+ `version` in `package.json`) and `RELEASES.md`. Builds counts every build/launch since the last compiled version made public.
- **Every version must appear in the commits**: a commit that changes `apexVersion` starts its message with the full version (`alpha-0.2.1.2.1.1.1.221 : …`), and each release build comes from a commit tagged with it (`git tag <version>`).

### Interface at launch
Détail : [`docs/CLASSIC_INTERFACE.md`](docs/CLASSIC_INTERFACE.md) — Interface classique vs LiquidGlass (lancement, look, plafond de rendu).

### Polar converter, native
Détail : [`docs/POLAR_CONVERTER.md`](docs/POLAR_CONVERTER.md) — Convertisseur polaire natif (C++), évitement de collisions.

### Printer profiles (2026-10-07)
`profiles/` is the printer catalogue (folders = menu levels, `<name>.json` + `<name>.png` per printer), browsed by `PrinterConfigSidebar`. Format, generation from the installed Orca Slicer profiles and the strain-gauge/USA rule: `docs/PRINTER_PROFILE_FORMAT.md`. Hardware data Orca does not have (motherboard, motors/drivers, auto-level tool) is `null` until sourced — never guessed.

### Out of scope here (other G-code editing tab, no relation to handles)
Adding/removing points on a segment with resampling (23 is rejected, 24 redraw/reloop a segment), inserting pauses/commands, simplifying a zone by point reduction. These go in a **separate** editing tab, not in `Édition`.

### Roadmap
Détail : [`docs/ROADMAP_UI.md`](docs/ROADMAP_UI.md) — Feuille de route de l'interface (arrangement Orca, crédits à compléter…).

### Automatic update (user, 2026-10-31)
Au lancement de l'app installée (Windows, build de production), `electron/update-flow.cjs` installe sans demander une release plus récente de `aeloxhardware/apex` (manifeste SHA-256 signé Ed25519). Tout : `docs/UPDATES.md` ; règles partagées : `apex/integration/RULES.md` §4.4.
