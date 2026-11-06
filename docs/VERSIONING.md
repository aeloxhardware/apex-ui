# Versionnement (ex-CLAUDE.md)

Texte déplacé tel quel de `CLAUDE.md` (2026-11-04, R-031 §6) ; les règles opératives restent dans `CLAUDE.md`.

### Versioning (user's decision, 2026-10-08)
**Single version number in the shared repository (user's decision, 2026-10-26).** The Apex application (engine + interface) has **one** version number, kept in the shared repository **`aeloxhardware/apex`**: `VERSION` (source of truth) and `VERSIONS.md` (log). It changes with every version of the engine **and** of the interface. **On every version change made here**, also update `VERSION` and `VERSIONS.md` in `apex` (pull its latest state first: the engine may have changed the number in the meantime), and keep `apexVersion` in `package.json` equal to `apex/VERSION`. `RELEASES.md` below keeps the detail of the interface's changes. Format, levels and conflict rule: `apex/integration/RULES.md`, §9 (same scheme as below, now applied to the whole application). Engine and interface are developed separately, one session per repository: `apex/integration/RULES.md` (rules and contract) and `apex/integration/REQUESTS.md` (open requests, read at session start).

Format `<préversion>-<public>.<global>.<majeur>.<moyen>.<mineur>.<add-ins>.<correctif>.<builds>`, e.g. `alpha-0.2.1.2.1.1.1.221`. Single source: `apexVersion` in `package.json` (injected as `__APEX_VERSION__` by Vite, shown on the splash and the preview notice). `version` (semver, required by npm/electron-builder) = `<public>.<global>.<majeur>`, here `0.2.1`: keep it in sync.
- **Préversion letter** (`alpha`, then beta…): maturity.
- **Public**: public release number of the software, 0 while in pre-release.
- **Global**: refactor of the whole software. 0 = initial version (never seen by Claude), 1 = LiquidGlass v1 without workspaces, 2 = the current one.
- **Majeur**: new workspace, new engine, important new feature. 1 = the new Édition mode of the Prévisualisation space.
- **Moyen**: fairly important new features. Currently 2: LiquidGlass splash screen and LiquidGlass bottom-of-screen tooltip.
- **Mineur**: noteworthy new feature, e.g. choosing whether handles influence nodes.
- **Add-ins**: a button, a small thing. Counting rule not settled (1 by default): count as it goes.
- **Correctif**: fix of a bug in an existing feature (1 by default).
- **Builds**: total builds since the last *compiled version made public* (e.g. the last working GitHub Release, not the last commit), up to the current one; every app launch counts, even for a trivial fix (221 by default).
- Bumping a level: the levels to its right restart (Builds excepted: it only restarts at a new public compiled version). Not yet defined: reset values to the right (0 or 1) — ask if it comes up.
- **`RELEASES.md`** (repo root) tracks the history of every software version (by version number; NOT a mirror of GitHub Releases, which only matter for the Builds counter) and states the current one. Update it with every version change, in the same commit.
- **Version as finely as possible: at every change made**, not only at releases. Each change bumps the right level (Add-ins for a button/small thing, Correctif for a bug fix, Mineur/Moyen/Majeur/Global above), updates `apexVersion` (+ `version` in `package.json`) and `RELEASES.md`. Builds counts every build/launch since the last compiled version made public.
- **Every version must appear in the commits**: a commit that changes `apexVersion` starts its message with the full version (`alpha-0.2.1.2.1.1.1.221 : …`), and each release build comes from a commit tagged with it (`git tag <version>`).
