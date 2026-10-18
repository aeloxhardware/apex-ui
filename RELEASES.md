# RELEASES

Historique de toutes les versions du logiciel Apex (numéro de version), et non des Releases GitHub. Seul lien avec la publication : le compteur Builds (voir `CLAUDE.md`). Format et règles de numérotation : section « Versioning » de `CLAUDE.md`.

**Version actuelle : `alpha-0.2.1.4.1.2.3.221`**

`<préversion>-<public>.<global>.<majeur>.<moyen>.<mineur>.<add-ins>.<correctif>.<builds>`

## alpha-0.2.1.4.1.2.3.221 — 2026-10-18

- Rideau de fermeture : animation de chargement choisie par l'utilisateur (mélange des strates et de la grille : cinq strates de trois cellules, déposées de bas en haut avec une vague diagonale) ; les dix autres candidates et leurs numéros sont supprimés. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.2.221 — 2026-10-18

- Rideau de fermeture : onzième animation (mélange de la 7 et de la 10) ajoutée aux candidates ; durée de l'écran final remise à la normale (1 s) après la phase de choix, garde-fou de sortie forcée remis à 25 s. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.1.221 — 2026-10-18

- Rideau de fermeture : dix animations de chargement candidates alignées au-dessus du message (`ShutdownLoaders.tsx`, numérotées 1 à 10), en attendant le choix de l'utilisateur ; les neuf autres seront ensuite supprimées. Interface classique : sans animation, inchangée. Niveau Add-ins incrémenté.

## alpha-0.2.1.4.1.1.1.221 — 2026-10-18

- Fermeture de l'application en huit étapes derrière un rideau de transition plein écran, au-dessus de tout, qui remplace « APEX » + nom d'espace par des messages successifs (interface classique : écran noir à plat). Toute demande de fermeture (croix, Alt+F4, quitter) est interceptée par `electron/shutdown.cjs` ; chaque message correspond à une vraie opération : entrées bloquées et sons libérés ; viewport 3D fermé puis scène et moteur libérés (RAM / vRAM) ; file d'événements vidée ; caches de la page et de Chromium purgés, fichiers temporaires `apex-convert-*` supprimés ; analyses G-code annulées et conversions Python terminées ; processus Python, processus d'édition C++ et verre natif arrêtés ; verrou d'instance, raccourcis globaux, entrée de liste de raccourcis de la barre des tâches et exclusion de capture levés ; stockage écrit sur disque, puis sortie. Le nom de l'OS (Windows 10 / Windows 11 / macOS / Linux) est repris dans deux messages. « Fermeture de la session » ferme la session de l'application, jamais celle de l'OS. Les réglages de l'utilisateur sont conservés (ce n'est pas une trace). Garde-fou : sortie forcée après 25 s si la page ne répond plus.
- Niveau Moyen incrémenté ; Mineur, Add-ins et Correctif remis à 1. Builds inchangé (221 : non compté en détail).

## alpha-0.2.1.3.2.1.2.221 — 2026-10-18

- Réglages (échelle de l'interface, Apex Neutral, mode classique/LiquidGlass, etc.) : désormais enregistrés dans un fichier du dossier utilisateur (`apex-settings.json`, `electron/prefs-store.cjs`) et recopiés dans la page avant son chargement, au lieu du seul localStorage qui dépend de l'origine (port de Vite) et peut perdre des écritures. Les réglages déjà présents sont migrés. Niveau Correctif incrémenté.
- Correctif du bandeau GPU : les calques attachés à `document.body` (verre des panneaux, infobulle du bas, modales, barres de défilement) passaient au-dessus du contenu ; ils s'attachent maintenant à la zone de l'interface (`usePortalRoot`).

## alpha-0.2.1.3.2.1.1.221 — 2026-10-18

- Niveau de puissance GPU évalué à chaque démarrage (`electron/gpu-tier.cjs`) : variable `low_gpu_pwr` = 1 si aucun GPU n'atteint au moins une RTX 3080 (comparaison de noms de modèles, pas un banc d'essai chronométré ; forçable en la définissant avant le lancement). Si elle vaut 1 : effets Liquid Glass natifs du splash désactivés, animation de l'Accueil remplacée par une image fixe, et bandeau orange en bas de l'application, sur sa propre ligne (pas en superposition), dont le texte dépend de l'interface (LiquidGlass ou classique).
- Addons natifs (`apex_backdrop.node`, `apex_edit.node`) compilés sur cette machine avec `node native/build.cjs`. Niveau Mineur incrémenté ; Add-ins et Correctif remis à 1.

## alpha-0.2.1.3.1.3.1.221 — 2026-10-09

- Interface moderne : le Viewport3D est toujours préchargé au lancement (monté invisible sous l'Accueil, puis démonté) ; le splash attend l'Accueil et le viewport, avec le message « Ouverture du portail d'accès à l'espace virtuel 3D... ». Interface classique inchangée. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.1.2.2.221 — 2026-10-09

- Démarrage : plus d'écran noir entre le splash et l'application. La fenêtre principale est montrée invisible (opacité 0), le splash reste jusqu'à ce que des images aient été présentées, puis la fenêtre est opacifiée et le splash fermé. Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.2.1.221 — 2026-10-08

- Paramètres : bouton « Désinstaller Apex Slicer… » (section Application), proposé seulement dans l'application installée par l'installateur (désinstalleur à côté de l'exe) ; même script que le raccourci du menu Démarrer et que la liste de raccourcis de la barre des tâches (confirmation, UAC, suppression). Niveau Add-ins incrémenté.

## alpha-0.2.1.3.1.1.1.221 — 2026-10-08

- Interface choisie au lancement : LiquidGlass (par défaut) ou **interface classique**, une interface SÉPARÉE (l'interface principale n'est jamais chargée) : mêmes espaces et même logique, vrai noir et blanc, coins droits, police système, aucune animation ni transparence. Viewport allégé : ni grille, ni pipeline MSAA/FXAA, axes blancs avec lettres X Y Z, sélection par contour ; case « Rendre le plateau avec ombres » (décochée : plateau noir et modèles d'une seule teinte sans éclairage ; cochée : verre du plateau et matériaux éclairés). Valeur lue une seule fois au démarrage : `--ui=classic` / `APEX_UI=classic` (Electron), `?ui=classic` (navigateur), sinon le réglage de Paramètres, sinon LiquidGlass. Deux premiers essais refusés par l'utilisateur (interface en tableaux seuls ; copie aplatie de l'interface principale).
- Niveau Moyen incrémenté ; Mineur, Add-ins et Correctif remis à 1 (valeurs de remise à zéro non définies par l'utilisateur : à confirmer). Builds inchangé (221).

## alpha-0.2.1.2.1.1.1.221 — 2026-10-08

- Valeur « dev » (Paramètres) : désactivée, l'application passe en préversion : raccourcis du navigateur bloqués (Ctrl+R, Ctrl+Maj+R, F5, F12…), espaces Dev / Préparation / Modélisation cachés, onglet « Fonction » grisé (« Arrive bientôt »), filigrane « ALPHA » en diagonale, notice de préversion au centre de l'écran, texte d'accueil de préversion.
- Système de versionnage à huit niveaux, version affichée sur l'écran de démarrage et dans la notice.
- Compteurs Add-ins (1), Correctif (1) et Builds (221) : valeurs par défaut choisies par l'utilisateur, non vérifiables dans l'historique git.

## Versions antérieures (rétro-reconstruites depuis l'historique git, non numérotées à l'époque)

- **Global 2, Majeur 1** — Édition du G-code par poignées dans l'espace Prévisualisation (noyau C++, nœud d'édition, 2026-10-01 → 2026-10-07).
- **Global 2, avant Majeur 1** — espace Prévisualisation G-code (2026-09-28), installeur et Modélisation (2026-09-13 → 2026-09-20), interface de base et viewport (2026-08-17 →).
- **Global 1** — LiquidGlass v1 sans espaces de travail (hors dépôt).
- **Global 0** — version initiale (hors dépôt).
