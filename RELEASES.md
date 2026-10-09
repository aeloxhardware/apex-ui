# RELEASES

Historique de toutes les versions du logiciel Apex (numéro de version), et non des Releases GitHub. Seul lien avec la publication : le compteur Builds (voir `CLAUDE.md`). Format et règles de numérotation : section « Versioning » de `CLAUDE.md`.

**Version actuelle : `alpha-0.2.1.3.1.3.1.221`**

`<préversion>-<public>.<global>.<majeur>.<moyen>.<mineur>.<add-ins>.<correctif>.<builds>`

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
