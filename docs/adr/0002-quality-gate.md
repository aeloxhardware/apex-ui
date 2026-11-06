# ADR 0002 — Quality gate « cliquet »

**Statut** : accepté (2026-11-05), décision de l'utilisateur : contraintes définitives. **Contexte** : les limites de taille
(`check-limits`) n'empêchent pas le code « scotché » (fonctions courtes mais tortueuses, dépendances croisées, code mort,
événements non typés). **Décision** : `scripts/check-quality.cjs` (branché sur `pnpm lint` et la CI) mesure, par fichier,
complexité cyclomatique (> 10), complexité cognitive (> 15), imbrication (> 3), assertions non nulles `!`, `any` et `@ts-*`,
frontières d'architecture (`.dependency-cruiser.cjs`), code mort (`knip.json`), événements `apex-*` hors du bus,
dérogations ESLint sans raison, `TODO/FIXME/HACK`, contournements `WORKAROUND(ID, revue AAAA-MM-JJ)` échus, formatage
Prettier, et le nombre d'erreurs sous `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`. Chaque mesure est comparée à
`scripts/quality-baseline.json` : elle peut baisser, jamais monter. `pnpm quality:update` resserre la baseline.
**Conséquence** : la dette existante est gelée et visible ; tout fichier nouveau doit être propre ; toucher un fichier de la
baseline, c'est le laisser meilleur. Le formatage Prettier n'est PAS appliqué en bloc : il réécrit les lignes et ferait
dépasser les limites de taille ; on formate fichier par fichier, avec son découpage.
