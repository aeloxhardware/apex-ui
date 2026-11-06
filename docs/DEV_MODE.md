# Valeur « dev » (ex-CLAUDE.md)

Texte déplacé tel quel de `CLAUDE.md` (2026-11-04, R-031 §6) ; les deux règles « ALWAYS » restent dans `CLAUDE.md`.

### Dev value (user's rule, 2026-10-08)
The app has a **"dev" value** (`src/utils/devModePrefs.ts`, toggle in Paramètres, relayed to Electron via `apex:set-dev-mode`). Disabled: the Dev tab is hidden from the toolbar and browser shortcuts (Ctrl+R, Ctrl+Shift+R, F5, F12, …) do nothing (blocked in `electron/main.cjs`, `isBrowserShortcut`).
- Disabled also means a **preview build**: Accueil/logo tooltip text replaced (`APP_TAGLINE_PREVIEW`), Modélisation / Dev spaces hidden (Préparation stays available, user 2026-10-31), Prévisualisation's "Fonction" icon greyed and inactive with the tooltip "Arrive bientôt", and a diagonal transparent "BETA" watermark over the whole screen (`BetaWatermark.tsx`).
- It also shows a small white centred notice: "Préversion <version> – Fournie en l'état pour test. Aelox Hardware ne saurait se tenir responsable de quelconque perte de données."
- **ALWAYS enabled unless the user says otherwise** (development, tests, e2e). Default = `import.meta.env.DEV`.
- **ALWAYS disabled for app releases** (exe/dmg/msi/AppImage builds). Before any release build, check that it ships disabled (production build default; no forced `true`, no stale stored value).
