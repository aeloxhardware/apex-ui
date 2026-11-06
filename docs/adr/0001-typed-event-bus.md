# ADR 0001 — Bus d'événements typé (`src/events/apexEvents.ts`)

**Statut** : accepté (2026-11-05). **Contexte** : le viewport et les panneaux ne partagent ni store ni contexte React ; ils
se parlent par des `CustomEvent('apex-…')` (voir `docs/ARCHITECTURE.md`). Les noms et les `detail` étaient des chaînes et
des objets libres : une faute de frappe ou un champ oublié ne se voyait qu'à l'exécution (≈ 80 événements, ≈ 380 sites).

**Décision** : `ApexEventMap` est l'unique registre des noms et des types de `detail`. On émet avec `emitApex(nom, detail)` et
on écoute avec `onApex(nom, (detail) => …)`. `check-quality` compte tout `new CustomEvent('apex-…')` et tout
`add/removeEventListener('apex-…')` hors de ce fichier ; le nombre ne peut que baisser. Les 158 émissions ont été migrées ;
il reste à migrer les écouteurs (dette dans `scripts/quality-baseline.json`, clé `events:raw-apex-event`).

**Conséquences** : un nouvel événement s'ajoute au registre, avec son type. Les événements dont le nom est une constante
(`EDIT_*_EVENT`, `FILAMENT_CHANGED_EVENT`…) sont à rapatrier dans le registre. Les `unknown` / `Record<string, unknown>` du
registre sont de la dette de typage à resserrer.
