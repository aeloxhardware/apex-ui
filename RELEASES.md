# RELEASES

Historique de toutes les versions du logiciel Apex (numéro de version), et non des Releases GitHub. Seul lien avec la publication : le compteur Builds (voir `CLAUDE.md`). Format et règles de numérotation : section « Versioning » de `CLAUDE.md`.

**Version actuelle : `alpha-0.2.3.1.3.11.0.221`**

`<préversion>-<public>.<global>.<majeur>.<moyen>.<mineur>.<add-ins>.<correctif>.<builds>`

## alpha-0.2.3.1.3.11.0.221 — 2026-11-03

R-031 point 6 : un seul gestionnaire de paquets, **pnpm** (choisi : `CLAUDE.md`, `pnpm-workspace.yaml` et la CI l'utilisent déjà, installation figée `--frozen-lockfile`, stockage dédupliqué). `package-lock.json` supprimé ; `pnpm-lock.yaml` fait foi. Numéro aligné sur `apex/VERSION` (RULES §9.1 : le plus élevé s'applique). Add-ins incrémenté.

## alpha-0.2.3.1.3.10.0.221 — 2026-11-03

R-031 point 1 : `ModelingSidebar.tsx` 1 183 → 793 lignes (arborescence `ModelingTree.tsx`, paramètres `ModelingFeatureParams.tsx`, barre d'esquisse `ModelingSketchBar.tsx`, tables dans `modelingData.tsx`). Aucun changement de comportement ; Add-ins incrémenté. Vérifié : `tsc`, lint, 79 tests, et capture de l'espace Modélisation identique au pixel près avant/après (Chromium headless, sans modèle chargé : l'arborescence peuplée n'est pas exercée). Dette de fichiers restante : 3 (Viewport3D, gcodeLayer, gcodeEditController).

## alpha-0.2.3.1.3.9.0.221 — 2026-11-03

R-031 point 3 : test de l'aller-retour `gcodeParse` ↔ `gcodeWriter` (`src/utils/gcodeWriter.test.ts`) : texte inchangé sans édition, étiquettes `;TYPE:` et commentaires de fin de ligne conservés après édition, valeur éditée relue par l'analyseur. Vérifié par mutation (un writer qui perd les commentaires fait échouer le test). Reste à couvrir : logique du viewport, client du noyau d'édition. Add-ins incrémenté.

## alpha-0.2.3.1.3.8.0.221 — 2026-11-03

R-031 point 1 : `EditNode.tsx` 1 025 → 400 lignes (poignée, gouttelette, constantes d'animation et icônes dans `editNodeParts.tsx`, types dans `editNodeTypes.ts`). Aucun changement de comportement ; Add-ins incrémenté. Dette de fichiers restante : 4 (Viewport3D, gcodeLayer, gcodeEditController, ModelingSidebar). Le composant `Handle` (331 lignes) a changé de fichier sans changer de taille : sa dette est reportée telle quelle dans `limits-baseline.json`, à découper ensuite.

## alpha-0.2.3.1.3.7.0.221 — 2026-11-03

R-031 point 1 : `CategoriesSidebar.tsx` 1 042 → 800 lignes (catalogue des catégories dans `categoriesData.tsx`, géométrie et animations dans `categoriesMotion.ts`). Aucun changement de comportement ; Add-ins incrémenté. Dette de fichiers restante : 5 (Viewport3D, gcodeLayer, gcodeEditController, ModelingSidebar, EditNode).

## alpha-0.2.3.1.3.6.0.221 — 2026-11-03

R-031 point 1 : `EditionPanel.tsx` 911 → 717 lignes (listes de choix et textes dans `editionPanelData.ts`, `NumberField` et `NormalGraph` dans `EditionPanelWidgets.tsx`). Aucun changement de comportement ; Add-ins incrémenté. Dette de fichiers restante : 6.

## alpha-0.2.3.1.3.5.0.221 — 2026-11-03

R-031 point 1 : `Lightfall.tsx` 819 → 566 lignes (GLSL dans `lightfallShaders.ts`) et `Sidebar.tsx` 864 → 792 (tables statiques dans `sidebarData.ts`). Aucun changement de comportement ; Add-ins incrémenté. Dette de fichiers restante : 7 (Viewport3D, gcodeLayer, gcodeEditController, ModelingSidebar, CategoriesSidebar, EditNode, EditionPanel).

## alpha-0.2.3.1.3.4.0.221 — 2026-11-03

R-031 point 1 : `gcodeParse.ts` 1 093 → 793 lignes (sous la limite de 800). Aucun changement de comportement ; Add-ins incrémenté.

- Types sortis dans `gcodeTypes.ts`, constantes et utilitaires dans `gcodeParseConstants.ts`, planificateur de temps cartésien dans `gcodePlanTimes.ts` ; `gcodeParse.ts` les ré-exporte, les importeurs ne changent pas.
- Dette restante dans ce fichier : `parseGCode` (630 lignes, une seule fonction).

## alpha-0.2.3.1.3.3.0.221 — 2026-11-03

R-031 point 2 : TypeScript strict. Add-ins incrémenté.

- `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters` activés dans `tsconfig.app.json` et `tsconfig.json` (0 erreur de type ; ne plus jamais les relâcher).
- Code mort retiré par le compilateur : imports et variables inutilisés, `createBoundaryMaterial` (Viewport3D, −55 lignes), paramètre `onOpenModel` de `Sidebar`.
- Types précisés : `.catch((): void => undefined)`, `RefObject<… | null>`, union discriminée des lignes de grille, `getCustomCode` de `EditDeformPlugin`.

## alpha-0.2.3.1.3.2.0.221 — 2026-11-03

R-031 (qualité sans compromis), première passe : l'outillage. Add-ins incrémenté.

- `scripts/check-limits.cjs` + `scripts/limits-baseline.json` : fichier ≤ 800 lignes, fonction ≤ 80 (composant ≤ 150), ≤ 8 paramètres, avec cliquet (aucune dette ne grossit, aucune nouvelle). Branché sur `pnpm lint`. Dette de départ : **10 fichiers, 53 fonctions, 3 signatures** hors limite (dont `Viewport3D.tsx` 6 552 lignes et son effet unique de 5 806 lignes).
- CI (`.github/workflows/ci.yml`) : lint + limites, `tsc`, tests, `schema:check`, `vectors:check`.
- Types : `pnpm typecheck` ; 10 erreurs préexistantes corrigées (`as const` sur les courbes d'animation). Lint : 6 erreurs préexistantes corrigées ; `src/components/ui` (shadcn généré) et `icons-main` (icônes tierces) exclus d'ESLint.
- Code mort supprimé : `GCodePointInspector.tsx` (aucun import, types disparus).

## alpha-0.2.3.1.3.1.0.221 — 2026-10-31

Rattrapage de versionnage : ces changements figuraient dans le commit `1f6e905` sans entrée propre. Ils sont rangés par thème, du niveau le plus bas au plus haut. Aucun n'a été revu dans l'application pour cet historique (descriptions tirées du code et de ses commentaires). Le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

- Bandeau Apex (`TitleBar.tsx`, 32 px) : la barre de titre native est masquée (`titleBarStyle: 'hidden'`), seuls les boutons réduire / agrandir / fermer restent, aux couleurs d'Apex ; lancement agrandi, icône d'Apex pour les fenêtres et la barre des tâches (`electron/icon-256.png`), plus d'ouverture automatique des outils de développement.
- `AlphaWatermark.tsx` renommé `BetaWatermark.tsx` (filigrane de la préversion sans valeur « dev »).
- `GlassPanel` : composant unique pour tout panneau flottant en verre (verre en calque à part, animation d'ouverture / fermeture commune). `easing.ts` : la courbe d'accélération d'Apex (`cubic-bezier(0.16, 1, 0.3, 1)`) partagée avec le moteur 3D. `ApexCheckbox` étendu.
- Catalogue d'imprimantes : un dossier ou une imprimante dont le profil ne vient pas d'OrcaSlicer (`apex.orca_source` nul) est inactif ; le catalogue propre à Apex n'est jamais grisé (`electron/profiles.cjs`).
- Icônes des motifs de remplissage (`InfillPatternIcon.tsx`, dessinées pour Apex) et liste des motifs d'Orca (`orcaInfillPatterns.ts`, seuls ceux que le moteur réalise).
- Survol du viewport (`ModelHoverTooltip`) : en Préparation, le modèle sous le curseur et son nombre de triangles ; en Prévisualisation, les valeurs réellement connues du mouvement G-code survolé.
- Tests : `apexSignature.test.ts`, `plateClip.test.ts`, `slicingMode.test.ts`, `orcaRotateGizmo.test.ts`, etc., et script `pnpm test` (vitest). Add-ins incrémenté.

## alpha-0.2.3.1.3.0.0.221 — 2026-10-31

- Filaments : sélecteur de filament (`FilamentSelector`, carte « Filament » sous l'arborescence des modèles) avec panneau de filtres par marque et par type de matériau, inclusifs ou exclusifs (`FilamentFilterPanel`). Catalogue `public/filaments.json` généré par `scripts/profiles/filaments.cjs` depuis les profils d'OrcaSlicer (AGPL-3.0, crédité) ; choix mémorisé sur la machine (`filamentCatalog.ts`). Texte de la licence AGPL-3.0 ajouté dans `public/`. Mineur incrémenté.

## alpha-0.2.3.1.2.0.0.221 — 2026-10-31

- Préparation, gizmos à la OrcaSlicer : rotation (`orcaRotateGizmo.ts`, port de `GLGizmoRotate` : trois anneaux autour du centre du modèle, graduation de 72 crans, accroche à 45° au centre et 5° près de l'anneau, arc d'angle) et mise à l'échelle (`orcaScaleGizmo.ts`, port de `GLGizmoScale3D` : six poignées de face et quatre poignées d'angle du bas, pas de 0,05 avec Maj, échelle autour du centre de la base, ancrage opposé avec Ctrl). Les gizmos se placent sur l'origine du maillage au lieu de son pivot ; `meshScale.ts` garde fixe un point de la pièce pendant une mise à l'échelle.
- Disposition automatique à la OrcaSlicer (`orcaArrange.ts`, port partiel : empreinte convexe gonflée, tri par aire, rotations 0/45/90/135°, placement par polygones de non-recouvrement, fonction objectif, recentrage du tas). Écarts connus (plateau circulaire, empreintes convexes, un seul plateau) listés dans la feuille de route de `CLAUDE.md`.
- Unité de lecture d'un modèle (`modelUnit.ts`, `ScaleUnitPrompt`) : après l'import d'un modèle plausiblement trop petit ou trop grand, l'interface propose de le lire en pouces (×25,4) ou en millimètres ; l'unité courante est accessible au clic droit.
- Import de modèles par glisser-déposer sur le plateau en Préparation (`utils/importModels.ts`, `Sidebar.tsx`).
- Crédits : OrcaSlicer (rotation, mise à l'échelle, disposition, rendu, motifs de remplissage) ajouté à `utils/credits.ts`. Mineur incrémenté.

## alpha-0.2.3.1.1.0.0.221 — 2026-10-31

- Réglages du moteur : éditeur Paramètres › Algorithme (avancé) (`EngineSettingsEditor`) et lignes actives dans les menus de catégorie de Préparation (`EngineItemRow`), sur le même magasin (`utils/engineSettings.ts`), schéma généré (`src/generated/params.schema.*`, vérifié par `schema:verify`) et infobulle explicative par réglage (`engineSettingsHelp.json`). Champs numériques `ApexNumberField` (flèches toujours visibles). Le panneau de droite de Préparation (« Réglages Apex », `EngineSettingsPanel`) ne garde que le sélecteur « Mode de tranchage ».
- Mode de tranchage (`slicingMode.ts`) : Element Aeolis, Element Ardor, Element Arva, Element Aequor ; choix mémorisé par mode d'axes, modes non implémentés inactifs ; seuil de sécurité en triangles qui déclenche la confirmation « Lancer la découpe ». Tranchage Element Aeolis (R-024, R-026) avec réglages de buse (`aeolisNozzle.ts` : angle, longueur) et refus lisible si le maillage n'est pas une surface en hauteur (`sliceController.ts`, `engine-runner.cjs`). Mineur incrémenté.

## alpha-0.2.3.1.0.0.0.221 — 2026-10-31

- Mise à jour automatique à chaque lancement de l'application installée (Windows) : vérifie la dernière release GitHub de `aeloxhardware/apex`, installe sans demander, boîte de dialogue en verre liquide « APEX / MISE À JOUR » avec progression (`electron/update-flow.cjs`, `update.html`). Seuls les fichiers modifiés sont téléchargés (manifeste SHA-256, assets nommés par hash), manifeste signé Ed25519 (clé publique `electron/update-public-key.pem`), fichiers en cours d'exécution renommés en `.old` puis remplacés, retour arrière au moindre échec (`electron/updater.cjs`, testé par `updater.test.ts`). Scripts de publication dans `scripts/update/`, documentation dans `docs/UPDATES.md`, `apexUpdate` dans `package.json`. L'installateur (`installer/`) reçoit des retouches d'interface. Moyen incrémenté.

## alpha-0.2.3.0.5.5.4.221 — 2026-10-31

- Prévisualisation : les touches M, R, S (et T) ne sont plus prises en compte ; elles basculaient les outils de Préparation (déplacer / pivoter / échelle) en arrière-plan (`Sidebar.tsx`). Non vu dans l'application. Correctif incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.5.3.221 — 2026-10-31

- Menu « Colorer par » (légende du tracé) : « Temps écoulé » devient « Ordonnancement » et se place juste sous « Type de ligne » (hors du groupe Cinématique). Les rangées n'ont plus de contour ; elles ont des ombres portées plus marquées. Les petits dégradés de chaque rangée ont une lueur externe (même dégradé flouté, `::before`). Non vu dans l'application. Add-ins incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.4.3.221 — 2026-10-31

- Carte « G-code 3 axes (cartésien) … Convertissez-le » : n'apparaît plus pour un fichier généré par Aeolis (signature Apex), dont le mode 3 axes est un choix du tranchage. Exception limitée aux fichiers signés ; un G-code cartésien importé garde la carte. Ces fichiers restent exportables sans conversion (`canExport`, `use-gcode-preview.ts`). Non vu dans l'application (typage non lancé). Correctif incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.4.2.221 — 2026-10-31

- Sous-menu « Ajouter des modèles pratiques » : taille maximale 3 colonnes × 4 rangées ; au-delà de 12 modèles la grille défile avec le curseur externe d'Apex (`ExternalScrollArea`, à 4 px du bord droit du panneau, visible seulement si le contenu dépasse). Moins de 12 modèles : le panneau se réduit au nombre de rangées nécessaires. Non vu dans l'application (typage vérifié seulement). Correctif incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.4.1.221 — 2026-10-31

- Sous-menu « Ajouter des modèles pratiques » : cascade carte par carte (fondu + glissement), menu toujours instantané. Une carte est révélée dès que sa miniature est prête, jamais moins de 70 ms après la précédente ; quand des miniatures attendent déjà, l'écart se réduit (70 / (1 + en attente), plancher 18 ms) pour rattraper, et si le rendu est lent les cartes suivent son rythme (`useCascade` dans `PracticalModelsGrid.tsx`). Remplace le décalage fixe de 45 ms par rang. Non vu dans l'application (typage vérifié seulement). Correctif incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.4.0.221 — 2026-10-31

- Sous-menu « Ajouter des modèles pratiques » : le panneau s'ouvre tout de suite et les boutons apparaissent en cascade (45 ms d'écart, fondu + léger glissement de 260 ms), chacun dès que sa miniature est prête et que son tour est venu. Les miniatures se dessinent l'une après l'autre dans une file (pause entre deux), sont gardées en image (réouverture instantanée) et leur dessin démarre dès l'ouverture du menu contextuel (`prewarmPracticalModels`). Les rangs de la cascade suivent l'ordre par nom. Non vu dans l'application (typage vérifié seulement). Add-ins incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.3.0.221 — 2026-10-31

- Modèles importés (STL) : rendu par défaut d'OrcaSlicer à la place du matériau standard de Babylon. Port des shaders `gouraud.vs` / `gouraud.fs` d'Orca (lus dans l'installation locale, `resources/shaders/110/`) : ombrage de Gouraud par sommet, lumière du haut (diffuse 0,48, spéculaire 0,075, brillance 20), lumière de face (diffuse 0,18), ambiante 0,3, toutes deux fixées à la caméra (`components/orcaModelMaterial.ts`, composante Z des lumières inversée pour le repère main gauche de Babylon, matrice des normales par maillage). Non repris : détection de pente, hors-volume, plans de coupe. La couleur (gris-bleu, 0,6 / 0,65 / 0,7) reste celle d'Apex : la couleur par défaut d'Orca vient du filament et n'a pas pu être vérifiée dans l'installation. Citation ajoutée dans `utils/credits.ts` (« OrcaSlicer — rendu des modèles », AGPL-3.0) et notice dans le fichier source. Mode interface classique inchangé (matériau plat). Non vu dans l'application (typage vérifié seulement).
- Modèles pratiques : un modèle ajouté prend le nom `test_x`, x = plus petit numéro libre (modèles du plateau et imports en cours), au lieu du nom de son fichier.

## alpha-0.2.3.0.5.2.0.221 — 2026-10-31

- Menu contextuel de Préparation : « Ajouter des modèles pratiques » est actif. Au survol, un sous-menu (même mécanique que « Ajouter une primitive ») affiche une grille de boutons carrés, chacun avec un rendu gris du modèle (miniature dessinée en logiciel sur un canvas 2D, `utils/stlThumbnail.ts`, sans contexte WebGL de plus), triés par nom (ordre naturel). Un clic importe le modèle sur le plateau comme un fichier choisi à la main (`apex-import-model`). Les modèles sont les `.stl` de `src/assets/practical-models/` (liste par `import.meta.glob` : ajouter un fichier suffit). Copiés depuis `slicer_engine/res/test_models` : death, l-triple-axis-overhanged-shape, l_shape_overhang, real_overhang, turkish, plate_1_1, plate_5 (~2 Mo) ; laissés de côté pour le poids : death_hi-res (11 Mo), timetest (5 Mo), plate_2, plate_3, plate_6. Infobulles de bas d'écran de ma rédaction, à valider. Test : lecture des STL réels (2 tests) ; typage vérifié ; rendu non vu dans l'application. Add-ins incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.1.0.221 — 2026-10-31

- Tranchage : un modèle (ou une partie) sous la surface du plateau est coupé à cette surface avant l'envoi au moteur, la section étant rebouchée pour rester un solide fermé (`utils/plateClip.ts`, appelé par `buildPlateStl` avec `clipBelowZ`, déclenché dans `onExportPlateStl` de `Viewport3D.tsx`). Un modèle posé sur le plateau (à 0,01 mm près) n'est pas touché ; un modèle entièrement dessous disparaît (« Aucun modèle sur le plateau »). Une pastille informe quand une coupe a eu lieu. Section : chaînage des segments de coupe en boucles, trous reliés au contour, découpage en oreilles ; un maillage ouvert (boucle non fermée) n'est pas rebouché. Testé par 4 tests unitaires (cube, orientation inversée, anneau à trou, modèle sous le plan : volume et surface fermée) ; pas testé dans l'application ni avec le moteur. Add-ins incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.5.0.0.221 — 2026-10-31

- Préparation, outils Déplacer / Pivoter / Mettre à l'échelle : une boîte `TransformBox` sous la barre d'outils permet de saisir les valeurs exactes du modèle actif (champs `ApexNumberField`, lettres colorées comme les gizmos : X rouge, Y vert, Z bleu). Déplacer : X, Y, Z en mm (centre de la boîte englobante, Z = hauteur de la base au-dessus du plateau, ≥ 0). Pivoter : A, B, C en ° (autour de X, Y, Z ; la base reste sur le plateau et le centre en place). Mettre à l'échelle : taille en mm et échelle en %, par axe, avec la case « Garder les proportions » (cochée par défaut). Événements `apex-transform-request` / `apex-transform-state` / `apex-transform-set` (Viewport3D ↔ boîte), la boîte suit aussi les glissements de gizmo. Limites : seul le modèle actif (dernier sélectionné) est modifié ; taille et échelle suivent les axes locaux du maillage, relativement à son état à la première sélection ; les textes d'infobulle sont de ma rédaction, à valider. Non testé dans l'application (typage des fichiers modifiés vérifié seulement). Niveau Mineur incrémenté, Add-ins et Correctif remis à 0 ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.3.0.4.1.1.221 — 2026-10-31

- Barre d'outils de Préparation : les icônes Déplacer / Pivoter / Mettre à l'échelle (`ToolAxisIcons.tsx`) reprennent les tracés des icônes Lucide `Move3d`, `Rotate3d` et `Scale3d`, découpés par axe (X rouge, vertical bleu, profondeur vert, teinte des gizmos), au lieu des tracés maison. Colorées uniquement quand l'outil est actif, couleur du texte au repos. Non testé dans l'application (rendu non vérifié). Niveau Add-ins incrémenté ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour (dépôt absent de cette machine).

## alpha-0.2.3.0.4.0.1.221 — 2026-10-31

- Prévisualisation, carte de conversion polaire (`GCodeConversionCard`) : elle affichait « l'imprimante sélectionnée imprime en coordonnées polaires » pour tout G-code cartésien, sans consulter l'imprimante. Elle ne s'affiche plus que si l'imprimante choisie déclare au moins 4 axes (`apex.axes_count` de son profil, `profileAxes()` dans `machineProfile.ts`) : une imprimante 3 axes imprime un G-code 3 axes telle quelle, et une machine à axes rotatifs accepte les fichiers 3 ou 5 axes. Nombre d'axes inconnu (« Inconnu » ou absent) : carte masquée, pour ne rien affirmer sans donnée. Sans imprimante choisie dans le menu, c'est le profil par défaut (Aetheris-4, 4 axes) qui s'applique. `PrinterConfigSidebar` transmet désormais aussi le chemin du profil (`onSelectPrinter(name, path?)`) ; `Index.tsx` le lit par `readProfile`.
- Champs numériques (`ApexNumberField`) : le focus se marque par un surlignage cyan doux (teinte + halo) au lieu d'un contour net ; les flèches restent grises pour le contraste. Non testé dans l'application (typage des fichiers modifiés vérifié seulement). Niveau Correctif incrémenté. Le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour (dépôt absent de cette machine).

## alpha-0.2.3.0.4.0.0.221 — 2026-10-30

- Prévisualisation, G-code d'Apex (R-025, prompt `integration/PROMPT_UX_reconnaitre_apex.md`) : le panneau d'informations (`GCodeInfoPanel.tsx`) et l'écran classique (`ClassicApp.tsx`) affichent « Généré par : Apex Slicer V0.2.3.0.3.0.0.221 (alpha) » (numéro de `meta.apex_version`, non arrondi) à la place de « Généré le plus probablement par : … (déduit du format) ». Détection : ligne exacte `; 85Ejj-sV6dI-NXTGl-JiodA-0b8aZ` dans les 40 premières lignes (`utils/apexSignature.ts`, constante unique ; un repère, pas une preuve). Version lue dans le bloc chiffré déjà déchiffré au chargement (`readApexHeader`, un seul déchiffrement par fichier). Bloc absent, tronqué ou illisible : « Apex Slicer (version illisible) » ; version `unknown` ou absente : « Apex Slicer (version inconnue) ». Sans signature, affichage inchangé, jamais « Apex Slicer ». Modèle : `GCodeGenerator.apex?: { version, prerelease, unreadable? }`, une seule fonction `formatGeneratorLabel` pour les deux écrans, priorité signature Apex > signature d'un autre slicer > déduction par le format (`resolveGenerator`). **Pas fait** : classement du fichier (cartésien / polaire) d'après `meta.machine` avant `parseGCode`, autre volet de R-025, resté ouvert. Premiers tests unitaires du dépôt : `vitest` (nouvelle dépendance de développement, `npm test`), 25 tests dans `src/utils/apexSignature.test.ts`, avec les deux exemples du moteur (`python scripts/gen_header_samples.py`) dans `src/utils/__fixtures__/`. Niveau Mineur incrémenté, Add-ins et Correctif remis à 0 (comme le moteur dans `apex/VERSIONS.md` ; convention toujours à confirmer). Non testé dans l'application (tests unitaires et typage seulement).

## alpha-0.2.1.4.5.1.1.221 — 2026-10-28

- Interrupteur de perspective désactivé = **vue orthographique** (comme l'option « Orthographique » de Fusion 360, demande de l'utilisateur) : plus de fuite, un plan vu de côté (ex. clic sur l'axe X du ViewCube) n'est qu'un trait fin, les vues alignées sur les plans cliqués sont exactes. Molette : zoom multiplicatif vers le curseur (échelle de l'image), plan d'ancrage perpendiculaire à l'axe de vue ; le panoramique reste un décalage d'image. Fenêtre orthographique = `rayon · tan(fov/2)` : l'échelle au point visé ne change pas au basculement et les formules « monde par pixel » (grille, barre d'échelle, étiquettes, pointage G-code, gizmos à taille d'écran fixe) restent exactes ; plan proche négatif. Non testé dans l'application (typage vérifié uniquement). Niveau Mineur incrémenté, Add-ins et Correctif remis à 1 ; le `VERSION` du dépôt partagé `apex` n'a pas été mis à jour.

## alpha-0.2.1.4.4.1.1.221 — 2026-10-27

- Prévisualisation, PrusaSlicer à couches non planaires : les types `;TYPE:Nonplanar solid infill` (violet) et `;TYPE:Nonplanar top solid infill` (marron) sont reconnus au lieu de tomber dans « Personnalisé » ; le générateur affiché devient « PrusaSlicer … (Non-planar fork) ».
- **Contours en l'air** (défaut connu de ce fork, risque de collision) : détection géométrique dans l'ordre de dépôt (`gcodeAirContours.ts`, parois sans matière dessous, tronçons rattachés, montée verticale comprise), nouveau type de ligne rouge « Contour en l'air » (`#FF0000`), coutures de ces tronçons retirées. Infobulle ancrée dans la vue 3D (`airContourCallout.ts` : flou, ombre portée, filtre rouge pulsant à 1 Hz, traits vers les contours, bouton) et suppression (`utils/gcodeAirRemoval.ts` : extrudeur relatif seulement ; le premier dépôt qui suit devient un déplacement ; fichier d'origine intact, copie à l'export). Niveau Mineur incrémenté, Add-ins et Correctif remis à 1 (convention à confirmer : cf. « Not yet defined » de `CLAUDE.md`). Le `VERSION` du dépôt partagé `aeloxhardware/apex` n'a pas été mis à jour depuis cette session.

## alpha-0.2.1.4.3.11.1.221 — 2026-10-21

- Banc de l'Assistant : le cœur du rond n'est plus un shader mais la sphère de réflexion (état `reasoning`) de Thinking Orbs de yogesharc (`@yogesharc/thinking-orbs` 0.1.2, MIT, **nouvelle dépendance** : `package.json`, `pnpm-lock.yaml`), à 40 % du diamètre, dans la couleur du texte (`#334155`). Le rond est flou : flou du verre à 6 px (1 auparavant). Le shader maison (`PhosphorShader.tsx`, dérivé de Phosphor 30 de xordev) est supprimé. Les crédits (Thinking Orbs, Liquid Glass Studio) sont à compléter avant publication : Roadmap de `CLAUDE.md`. Niveau Add-ins incrémenté.

## alpha-0.2.1.4.3.10.1.221 — 2026-10-21

- Banc de l'Assistant, cœur du rond : mécanique entièrement remplacée (user : « un déplacement de la matière, plus une rotation »). Le lancer de rayons autour d'une sphère en rotation du shader Phosphor 30 est abandonné au profit d'un champ de matière (bruit 3D en fbm, déformation de domaine à deux niveaux, relief tiré des dérivées d'écran) qui coule et se replie sur lui-même, sur fond transparent (alpha prémultiplié, bord fondu dans le shader). Temps à vitesse variable, départ aléatoire à chaque ouverture. Seule la formule de palette de Phosphor est conservée (citation et vérification de licence toujours à la Roadmap). Le masque CSS du cœur est retiré. L'entrée 4.3.9.1 ci-dessous décrit l'étape précédente, qui rendait le cœur quasi invisible sur fond clair. Niveau Add-ins incrémenté.
## alpha-0.2.1.4.3.9.1.221 — 2026-10-21

- Banc de l'Assistant, shader du cœur : plus de fond noir (opacité selon la luminosité, teinte conservée, bords en fondu) et mouvement organique : temps à vitesse variable (sinus de périodes sans rapport), axes qui dérivent à leur propre rythme, rayon qui respire, état de départ aléatoire à chaque ouverture, au lieu de la rotation régulière « boule qui roule ». Niveau Add-ins incrémenté.

## alpha-0.2.1.4.3.8.1.221 — 2026-10-21

- Banc de l'Assistant : le shader « Phosphor 30 » (xordev, 21st.dev) occupe le centre du rond (60 % du diamètre, `PhosphorShader.tsx`), posé sur le verre et suivant le rond dans ses déplacements. Sa citation et la vérification de sa licence sont inscrites à la Roadmap de `CLAUDE.md`. Niveau Add-ins incrémenté.

## alpha-0.2.1.4.3.7.1.221 — 2026-10-20

- Banc de l'Assistant : le rond de verre suit le pointeur par un ressort et s'étire selon sa vitesse (idée de Liquid Glass Studio, `springSizeFactor`), via `GlassPull` ; le fond est de nouveau net. Réglages du verre = valeurs par défaut de Liquid Glass Studio (`src/Controls.tsx`) converties dans les unités d'Apex : épaisseur 20 px, flou 1, ombre 0,15 / 25 px / 10 px, ressort react-spring par défaut (170 / 26). Détail et parties non reprises (forme, teinte, fusion, distance de réfraction) en tête de `AssistantLab.tsx`. Niveau Add-ins incrémenté. **Remplace le flou à 6 px de la version précédente.**

## alpha-0.2.1.4.3.6.1.221 — 2026-10-20

- Banc de l'Assistant : le fond vu à travers le rond de verre est flouté (`GLASS_BLUR_PX` = 6 px CSS, contre 0,55 par défaut du verre ; le verre standard d'Apex est à 4). Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.4.3.5.2.221 — 2026-10-20

- Banc de l'Assistant : fond noir sur une vraie carte graphique. Les shaders du verre se compilent en parallèle, donc `LiquidGlassRenderer` n'est pas « prêt » à la création et `setBackground` ignorait silencieusement le damier. Le banc envoie maintenant le fond au verre dans sa boucle, dès qu'il est prêt et après chaque redimensionnement, et signale un échec de compilation à l'écran. Constaté : `NodeLab` appelle `setBackground` de la même façon (au moment du montage), il est probablement touché aussi ; `liquidGlass.ts` n'a pas été modifié. Vérifié par capture sur une GTX 1050 Ti (Direct3D 11). Niveau Correctif incrémenté.

## alpha-0.2.1.4.3.5.1.221 — 2026-10-20

- Banc de l'Assistant (`pnpm dev:lab-assistant`) : un grand rond de verre « Liquid Glass » au centre (diamètre : 55 % du plus petit côté de la page, entre 240 et 520 px), qui réfracte le damier blanc et gris. Même rendu WebGL que le nœud d'édition (`edit-node/liquidGlass.ts`) : le damier est désormais dessiné dans un canevas 2D (le damier CSS reste en repli sans WebGL). Niveau Add-ins incrémenté.

## alpha-0.2.1.4.3.4.1.221 — 2026-10-20

- Banc d'essai isolé de l'Assistant vocal : `pnpm dev:lab-assistant` (port 8091, `vite.lab-assistant.config.ts`, page `src/lab/assistant/`), comme celui des nœuds d'édition. Pour l'instant seulement le fond, un damier blanc et gris. Contrat avec le backend de l'Assistant : `research/assistant/COM.md`. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.4.3.3.4.221 — 2026-10-20

- Notifications (pile) : le bouton « Tout fermer » (croix de la barre qui apparaît au survol) fait disparaître toutes les cartes en cascade (fondu + glissement), de la carte de face vers le fond, avec 90 ms entre deux cartes (`CASCADE_STEP_S`). La pile reste montée 900 ms une fois vide (`LINGER_MS`) : sans cela, le démontage du conteneur coupait net la dernière carte et toute cascade. Niveau Correctif incrémenté.

## alpha-0.2.1.4.3.3.3.221 — 2026-10-20

- Notifications (pile) : inertie du défilement jugée trop vive. Vitesse de pointe réduite (plafond 80 → 30 crans/s, impulsion de cran de molette 1 → 0,3, vitesse du pavé tactile ×0,4) et glisse plus longue (1,2 s à 3,2 s selon la pointe du geste, au lieu de 1 à 3 s) : 8 crans rapprochés parcourent environ 29 cartes en ~2 s, contre 19 avant. Niveau Correctif incrémenté.

## alpha-0.2.1.4.3.3.2.221 — 2026-10-20

- Modélisation : les corps créés par extrusion (couvercle, parois, fond) ont désormais leurs faces et leurs arêtes sélectionnables et surlignées au survol, comme celles d'un modèle importé (`isSolid`). Leurs maillages portent maintenant des normales (nécessaires au choix d'une face). Niveau Correctif incrémenté.

## alpha-0.2.1.4.3.3.1.221 — 2026-10-20

- Modélisation : sélection d'arête. Au survol, l'arête visible la plus proche du pointeur (tolérance 7 px, `EDGE_PICK_PX`) est tracée ; le clic la choisit (second clic = désélection). Une arête = chaîne d'arêtes vives (> 25° entre faces voisines, bords libres) prolongée tant qu'elle tourne de moins de 35° : un côté droit ou un cercle tessellé est une seule arête ; profils d'esquisse : côtés des rectangles. L'arête proche l'emporte sur la face qu'elle borde ; plus loin, la face reste sélectionnable. Les arêtes masquées par une surface ne sont pas choisies.
- Touche E (espace Modélisation) : lance l'Extrusion comme un clic sur l'outil ; une face déjà choisie est reprise par l'outil. Sans effet en saisie de texte, avec modificateur, en esquisse, ou outil déjà actif. Niveau Mineur incrémenté.

## alpha-0.2.1.4.2.3.1.221 — 2026-10-20

- Modélisation : sélection de face hors outil Extrusion. Avec l'outil de sélection, le survol d'une face plane (corps, profil d'esquisse, tout objet de la scène) la surligne et le clic la choisit comme avec l'Extrusion (second clic = désélection), sans flèche et sans ouvrir le panneau Extrusion. Un clic sur une face ne sélectionne plus le corps en plus ; hors face, la sélection habituelle reste. Niveau Mineur incrémenté, Correctif remis à 1 (Add-ins conservé : valeur de remise à zéro non définie, cf. « Versioning »).

## alpha-0.2.1.4.1.3.2.221 — 2026-10-20

- Modélisation : le sélecteur « Sélection » (Corps / Face / Arête / Sommet) est entièrement grisé pour l'instant (`SELECTION_LOCKED` dans `ModelingSidebar.tsx`), sans surbrillance du mode actif. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.3.1.221 — 2026-10-20

- Bandeau orange d'avertissement GPU : il porte maintenant son texte dans le bandeau du bas (attribut `data-apex-tooltip`, sans bulle de souris), dans les deux interfaces. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.4.1.2.14.221 — 2026-10-20

- Notifications (pile) : molette à crans, deuxième passe. (1) Reconnaissance d'un cran faite en pixels physiques (`deltaY × devicePixelRatio`) : avec une mise à l'échelle Windows, un cran arrivait en deltaY non entier et était pris pour un défilement lisse. (2) Chaque cran rapproché ajoute une impulsion proportionnelle à sa cadence à l'élan acquis (au lieu de prendre le maximum) : la vélocité s'accumule et la pile est vraiment « lancée ». Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.13.221 — 2026-10-20

- Notifications (pile) : effet « lancer » du défilement. Les crans de molette de souris rapprochés (< 260 ms, même sens) n'étaient jamais pris en compte par l'inertie (une carte par cran, rien d'autre) : leur cadence donne désormais une vélocité qui s'emballe et glisse 1 à 3 s (`NOTCH_STREAM_GAP_MS`, `NOTCH_TO_VELOCITY`). Un cran isolé reste une carte exacte. Pour le pavé tactile / molette lisse : vélocité par px/s doublée (`SPEED_TO_VELOCITY` 0,009 → 0,02, `FIRST_EVENT_TO_VELOCITY` 0,03 → 0,06), plafond porté à 80 crans/s. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.12.221 — 2026-10-20

- Notifications (pile) : l'inertie était insuffisante. Le freinage est maintenant calibré sur une durée de glisse : de 1 s (geste lent) à 3 s (geste au plafond de vélocité) après le dernier évènement, selon la vitesse de pointe du geste (`GLIDE_MIN_S`, `GLIDE_MAX_S`). Remplace `INERTIA_GAIN` et le freinage exponentiel + linéaire fixe. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.11.221 — 2026-10-20

- Notifications (pile) : inertie du défilement renforcée. Tant que le geste continue dans le même sens, la vélocité s'emballe (`ACCEL_GAIN`), et le freinage est divisé selon la vitesse maximale atteinte pendant le geste (`INERTIA_GAIN`) : plus on défile vite, plus la pile prend de la vitesse et glisse longtemps. Plafond de vélocité porté de 34 à 48 crans/s. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.10.221 — 2026-10-19

- Notifications (pile) : toutes les cartes se déplacent vers leur nouveau cran (ressort de la pile). La carte de premier plan garde son fondu + glissement de sortie ; la carte d'arrière-plan qui apparaît fait un fondu + glissement de 20 px, sans trajectoire propre. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.9.221 — 2026-10-19

- Notifications (pile) : décalage des cartes de fond et glissement des fondus portés à 20 px, dans l'axe de la flèche de référence (haut-droite pour la pile, bas-gauche pour la sortie et l'entrée). Chaque carte est séparée en un conteneur de position (cran, changé sans animation) et la carte qui porte le fondu et le glissement de 20 px relatif à son cran. Découpe en L des cartes de fond recalculée pour ce décalage (`NotificationStack.module.scss`). Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.8.221 — 2026-10-19

- Notifications (pile) : animation remplacée. La carte de face sort par un fondu + glissement ; la carte qui entre dans la pile visible (arrière-plan) apparaît par un fondu + glissement. Les autres cartes changent de cran sans animation (plus de déplacement dans la pile). Fermer une notification utilise le même fondu + glissement. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.7.221 — 2026-10-19

- Notifications (pile) : les cartes de fond retrouvent leur teinte, mais seulement sur leurs deux bandes visibles (14 px en haut et à droite, découpe en L, `.peek` dans `NotificationStack.module.scss`) : elles ne s'additionnent plus entre elles ni à la carte de face, et le fond ne s'assombrit plus. Corrige la version précédente, qui avait retiré toute teinte aux cartes de fond. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.6.221 — 2026-10-19

- Notifications (pile) : tentative de correction (cartes de fond sans teinte, flou ni ombre), remplacée par `alpha-0.2.1.4.1.2.7.221`.

## alpha-0.2.1.4.1.2.5.221 — 2026-10-18

- Viewport 3D (Prévisualisation) : vue déformée après des zooms (carrés en losanges, plateau ovale, orbite qui ralentit, angle incohérent avec le ViewCube). Deux correctifs prudents, la cause exacte n'ayant pas été reproduite : (1) les vues du ViewCube remettent à zéro le décalage de lentille du panoramique, comme les autres vues prédéfinies ; (2) hors Modélisation, le zoom vers le curseur ne peut plus emmener la cible à plus de 8 × le rayon du plateau (horizontal) ni plus bas que −130 mm. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.4.221 — 2026-10-18

- Esquisse (outil Rectangle) : distance d'aimantation du curseur aux traits fins de la grille réduite de 14 à 7 px (`SKETCH_SNAP_RADIUS_PX`). Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.3.221 — 2026-10-18

- Rideau de fermeture : animation de chargement choisie par l'utilisateur (mélange des strates et de la grille : cinq strates de trois cellules, déposées de bas en haut avec une vague diagonale) ; les dix autres candidates et leurs numéros sont supprimés. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.2.221 — 2026-10-18

- Rideau de fermeture : onzième animation (mélange de la 7 et de la 10) ajoutée aux candidates ; durée de l'écran final remise à la normale (1 s) après la phase de choix, garde-fou de sortie forcée remis à 25 s. Niveau Correctif incrémenté.

## alpha-0.2.1.4.1.2.1.221 — 2026-10-18

- Rideau de fermeture : dix animations de chargement candidates alignées au-dessus du message (`ShutdownLoaders.tsx`, numérotées 1 à 10), en attendant le choix de l'utilisateur ; les neuf autres seront ensuite supprimées. Interface classique : sans animation, inchangée. Niveau Add-ins incrémenté.

## alpha-0.2.1.4.1.1.1.221 — 2026-10-18

- Fermeture de l'application en huit étapes derrière un rideau de transition plein écran, au-dessus de tout, qui remplace « APEX » + nom d'espace par des messages successifs (interface classique : écran noir à plat). Toute demande de fermeture (croix, Alt+F4, quitter) est interceptée par `electron/shutdown.cjs` ; chaque message correspond à une vraie opération : entrées bloquées et sons libérés ; viewport 3D fermé puis scène et moteur libérés (RAM / vRAM) ; file d'événements vidée ; caches de la page et de Chromium purgés, fichiers temporaires `apex-convert-*` supprimés ; analyses G-code annulées et conversions Python terminées ; processus Python, processus d'édition C++ et verre natif arrêtés ; verrou d'instance, raccourcis globaux, entrée de liste de raccourcis de la barre des tâches et exclusion de capture levés ; stockage écrit sur disque, puis sortie. Le nom de l'OS (Windows 10 / Windows 11 / macOS / Linux) est repris dans deux messages. « Fermeture de la session » ferme la session de l'application, jamais celle de l'OS. Les réglages de l'utilisateur sont conservés (ce n'est pas une trace). Garde-fou : sortie forcée après 25 s si la page ne répond plus.
- Niveau Moyen incrémenté ; Mineur, Add-ins et Correctif remis à 1. Builds inchangé (221 : non compté en détail).

## alpha-0.2.1.3.5.1.2.221 — 2026-10-18

- Réglages (échelle de l'interface, Apex Neutral, mode classique/LiquidGlass, etc.) : désormais enregistrés dans un fichier du dossier utilisateur (`apex-settings.json`, `electron/prefs-store.cjs`) et recopiés dans la page avant son chargement, au lieu du seul localStorage qui dépend de l'origine (port de Vite) et peut perdre des écritures. Les réglages déjà présents sont migrés. Niveau Correctif incrémenté.
- Correctif du bandeau GPU : les calques attachés à `document.body` (verre des panneaux, infobulle du bas, modales, barres de défilement) passaient au-dessus du contenu ; ils s'attachent maintenant à la zone de l'interface (`usePortalRoot`).

## alpha-0.2.1.3.5.1.1.221 — 2026-10-18

- Niveau de puissance GPU évalué à chaque démarrage (`electron/gpu-tier.cjs`) : variable `low_gpu_pwr` = 1 si aucun GPU n'atteint au moins une RTX 3080 (comparaison de noms de modèles, pas un banc d'essai chronométré ; forçable en la définissant avant le lancement). Si elle vaut 1 : effets Liquid Glass natifs du splash désactivés, animation de l'Accueil remplacée par une image fixe, et bandeau orange en bas de l'application, sur sa propre ligne (pas en superposition), dont le texte dépend de l'interface (LiquidGlass ou classique).
- Addons natifs (`apex_backdrop.node`, `apex_edit.node`) compilés sur cette machine avec `node native/build.cjs`. Niveau Mineur incrémenté ; Add-ins et Correctif remis à 1.

## alpha-0.2.1.3.4.2.1.221 — 2026-10-13

- Modélisation : outil Extrusion : le corps extrudé apparaît en temps réel pendant que la flèche est tirée ou que la distance est saisie (face déplacée, parois, contours noirs aux seuls bords et coins : pas d'arêtes de triangulation) ; OK le laisse dans la scène. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.4.1.2.221 — 2026-10-13

- Modélisation : outil Extrusion : les plans (profils d'esquisse et faces de modèles) sont surlignés au survol et se désélectionnent par un second clic ; les profils imbriqués ou croisés sont découpés en régions indépendantes selon leurs recouvrements (un rectangle dans un autre = l'anneau et l'intérieur, deux rectangles qui se croisent = trois régions). Niveau Correctif incrémenté.

## alpha-0.2.1.3.4.1.1.221 — 2026-10-13

- Modélisation : outil Extrusion piloté dans la vue 3D. Le sélecteur passe automatiquement sur « Face » (mode précédent rendu à la fin) ; cliquer un profil d'esquisse (rectangle tracé, désormais sélectionnable) ou une face plane d'un modèle (ensemble des triangles coplanaires) la surligne et fait apparaître une flèche parallèle à sa normale, de taille écran constante. La flèche se tire pour régler la distance (aperçu fantôme, valeur en direct dans le panneau, et inversement quand on tape la distance) ; un simple clic sur la flèche active le champ Distance. Une face de modèle s'extrude directement (sans esquisse). Niveau Mineur incrémenté, Add-ins et Correctif remis à 1.

## alpha-0.2.1.3.3.1.7.221 — 2026-10-13

- Modélisation : panneau Extrusion : le texte « Tire le profil d'un plan surfacique… » s'affiche dans le bandeau du bas sur tout le panneau, et l'icône (i) l'affiche seul dans la bulle de souris. Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.6.221 — 2026-10-13

- Modélisation : texte de l'outil Extrusion (bouton et info du panneau) : « Tire le profil d'un plan surfacique, parallèlement ou non à sa normale pour générer un volume » (l'outil pourra aussi tirer une face d'un maillage et sera réglable). Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.5.221 — 2026-10-13

- Modélisation : panneau Extrusion : alignement corrigé quand l'avertissement « Aucune esquisse » s'affiche (l'enveloppe du tooltip n'occupait qu'une colonne de la grille et décalait toutes les lignes). Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.4.221 — 2026-10-13

- Modélisation : panneau Extrusion : distance par défaut 0 mm (champ actif, texte sélectionné ; la valeur 0 reste invalide : contour rouge et OK grisé jusqu'à saisie). Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.3.221 — 2026-10-13

- Modélisation : panneau Extrusion : les champs Type, Contours et Type d'étendue sont retirés (solide et distance par défaut ; l'esquisse la plus récente est utilisée, un avertissement s'affiche s'il n'y en a pas). Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.2.221 — 2026-10-13

- Modélisation : l'outil Extrusion se sélectionne toujours au clic (il était refusé, avec un message, sans corps sélectionné) ; son panneau indique « Aucune esquisse » s'il n'y en a pas. Une esquisse tracée sans corps est conservée et l'extrusion crée alors le corps qui la porte. Niveau Correctif incrémenté.

## alpha-0.2.1.3.3.1.1.221 — 2026-10-13

- Modélisation : l'outil Extrusion ouvre un panneau latéral droit (Type, Contours, Démarrer, Direction, Étendue, Distance, Opération, OK / Annuler), aux couleurs d'Apex ; OK crée l'extrusion avec les réglages (la feature n'est plus créée au simple clic sur l'outil). Seule l'opération « Nouveau corps » est disponible pour l'instant. Niveau Mineur incrémenté, Add-ins et Correctif remis à 1.

## alpha-0.2.1.3.2.11.5.221 — 2026-10-13

- Modélisation : nouvelle icône du bouton Extrusion (flèche vers le haut au-dessus de deux barres, extrémités arrondies), aussi dans l'arborescence. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.11.4.221 — 2026-10-13

- Modélisation : au retour de l'outil Esquisse, les icônes de la barre réapparaissent en cascade après l'élargissement de la barre, plus lentement (0,42 s chacune) ; le halo du bouton actif n'est plus rogné en rectangle (le rognage des enveloppes ne sert plus qu'au repli). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.11.3.221 — 2026-10-13

- Modélisation : ombre portée sur le sélecteur Corps / Face / Arête / Sommet. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.11.2.221 — 2026-10-13

- Modélisation : animation de la barre d'outils avec l'outil Esquisse rendue fluide : la barre part de sa largeur réellement affichée (elle repartait d'une géométrie périmée, d'où le saut), les icônes se replient en largeur en s'effaçant (le bouton Esquisse glisse au lieu de sauter), puis la barre se raccourcit ; à la fin elle s'élargit tout de suite et les icônes reviennent. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.11.1.221 — 2026-10-13

- Modélisation : quand l'outil Esquisse est actif, les autres icônes de la barre d'outils et la barre de séparation disparaissent en cascade, et la barre se raccourcit (50 px) autour du seul bouton Esquisse, qui reste centré ; tout revient en cascade à la fin de l'esquisse. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.10.1.221 — 2026-10-13

- Modélisation : « Terminer l'esquisse » rend la vue exacte d'avant le bouton Esquisse (caméra, décalage d'image et repère de la grille, avec une animation) ; l'orbite verrouillée n'efface plus le panoramique en perspective. Le bouton Esquisse est séparé du reste de la barre d'outils par une petite barre (barre élargie à 274 px). Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.9.2.221 — 2026-10-13

- Modélisation : la barre d'outils Esquisse est recentrée ; le bouton « Terminer l'esquisse » est posé sur son côté droit, hors du flux. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.9.1.221 — 2026-10-13

- Modélisation : le bouton « Terminer l'esquisse » s'avance vers l'utilisateur au survol (il grossit et son ombre se creuse). Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.8.11.221 — 2026-10-13

- Modélisation : le cube de l'icône « Terminer l'esquisse » est simplifié en un cube simple (hexagone et trois arêtes intérieures, en contours). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.10.221 — 2026-10-13

- Modélisation : le cube de l'icône « Terminer l'esquisse » est dessiné en contours (non plein) ; le reste est inchangé. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.9.221 — 2026-10-13

- Modélisation : icône de « Terminer l'esquisse » : les deux morceaux sont rapprochés et la flèche naît sous le plan plein (filet vide autour des plans), mais moins que d'abord (cube décalé de 2 unités seulement). Largeur du bouton 84 px. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.8.221 — 2026-10-13

- Modélisation : flèche de l'icône « Terminer l'esquisse » descendue au plus bas de la face du cube, au niveau du plan plein (le cube retrouve sa position centrée). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.7.221 — 2026-10-13

- Modélisation : flèche de l'icône « Terminer l'esquisse » centrée verticalement sur la ligne du plan (le cube est remonté de 3 unités pour qu'elle vise sa face). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.6.221 — 2026-10-13

- Modélisation : flèche de l'icône « Terminer l'esquisse » agrandie (plus longue, plus large, tête plus haute) et partant du plan, pour qu'on lise que le plan va vers l'espace 3D. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.5.221 — 2026-10-13

- Modélisation : icône de « Terminer l'esquisse » : les deux morceaux sont alignés sur la même ligne, à hauteur apparente égale, et espacés d'un vide ; bouton élargi (96 px). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.4.221 — 2026-10-13

- Modélisation : icône de « Terminer l'esquisse » refaite en deux morceaux côte à côte, comme la référence fournie (plan en contour au-dessus d'un plan plein, puis cube dans lequel entre une flèche) ; bouton élargi (84 px). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.3.221 — 2026-10-13

- Modélisation : icône de « Terminer l'esquisse » redessinée d'après le pictogramme (plan en contour épais arrondi, filet vide, plan plein en dessous, flèche qui entre), vérifiée par rendu. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.2.221 — 2026-10-13

- Modélisation : le bouton « Terminer l'esquisse » n'a plus de texte (icône seule, carrée) ; son icône reprend le pictogramme fourni : un plan en contour au-dessus d'un plan plein, avec une flèche qui y entre. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.8.1.221 — 2026-10-13

- Modélisation : bouton « Terminer l'esquisse » (icône : flèche traversant un plan en pointillé) à côté de la barre d'outils Esquisse ; il quitte l'outil, désactive le tracé et rend l'orbite. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.7.1.221 — 2026-10-13

- Infobulles du bandeau du bas (sans bulle de souris) ajoutées sur : l'échelle de Modélisation, la pastille d'état du plateau (texte variable selon le modèle), le bandeau du bas lui-même (« Guide pratique indiquant l'opération réalisée par l'élément couramment survolé de l'interface »), les panneaux et barres latérales (catégories de découpe, panneaux de Prévisualisation, panneau Modélisation, liste des modèles, catalogue d'imprimantes, barre de fichiers, barre de découpe / d'export), la coque du sélecteur 3 / 5 axes et la barre d'onglets du haut. Le sélecteur affiche « 5 AXES » à la place de « 4 AXES » (bouton et notification). Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.6.3.221 — 2026-10-13

- Scène 3D : le texte du bandeau du bas au survol du plateau est retiré (le mécanisme `data-apex-tooltip` reste disponible). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.6.2.221 — 2026-10-13

- Infobulle de la scène 3D précisée : elle décrit aussi les commandes (sélection, fenêtre de sélection, orbite, déplacement de la vue, zoom). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.6.1.221 — 2026-10-13

- Infobulles : un élément non interactif peut porter son texte dans le bandeau du bas (attribut `data-apex-tooltip`, sans bulle de souris), géré par TopRightMenu ; le bandeau y revient après tout tooltip précis. Première utilisation : la scène 3D (« Portail d'accès à l'espace tridimensionnel virtuel d'Apex »). Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.5.1.221 — 2026-10-13

- Infobulles : la barre d'outils de Modélisation (« Outils de modélisation ») et la barre d'outils Esquisse (« Boîte à outils Esquisse ») ont leur propre texte, dans le bandeau du bas et dans la bulle de souris, sur leur fond ; leurs boutons gardent le leur. `CustomTooltip` gagne les props `container` et `wrapperStyle`. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.4.2.221 — 2026-10-13

- Modélisation : ombre portée sur les deux champs de texte de l'outil Rectangle. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.4.1.221 — 2026-10-13

- Modélisation, outil Rectangle : après le premier clic, deux champs (longueur, largeur) apparaissent à côté des côtés d'arrivée du tracé ; la longueur est sélectionnée par défaut, texte entièrement sélectionné ; saisie possible à tout moment et appliquée en direct à la forme. Tab passe au champ suivant et verrouille la valeur si elle a été modifiée et est valide ; valeur négative, non numérique, vide ou nulle : contour rouge et Tab remet l'ancienne valeur. Entrée valide le rectangle, Échap l'annule. Pilules arrondies sans contour, fond flouté. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.3.7.221 — 2026-10-13

- Modélisation : carré d'aimantation du « + » un peu plus petit (19 px) et à coins à peine arrondis (2 px). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.6.221 — 2026-10-13

- Modélisation : le rideau d'entrée reste affiché (barre qui se répète) jusqu'à ce que la scène soit réellement prête, puis se retire ; garde-fou à 8 s. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.6.221 — 2026-10-13

- Rideau de changement d'espace : plus de délai obligatoire de 6 s pour Modélisation ; comme les autres espaces, il ne dure que le temps de la barre horizontale qui s'étend (une fois), prolongé seulement par un chargement réellement en cours. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.4.221 — 2026-10-13

- Modélisation : curseur « + » de l'outil Rectangle plus petit (25 px) et carré d'aimantation resserré (21 px) pour que les branches du + dépassent un peu. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.3.221 — 2026-10-13

- Paramètres : le choix de la page de démarrage est un sélecteur segmenté à pastille coulissante, comme celui Corps / Face / Arête / Sommet de Modélisation (au lieu de cases à cocher). Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.2.221 — 2026-10-13

- Modélisation : le curseur « + » de l'outil Rectangle est plus épais (2 px) et plus grand (31 px) ; son carré d'aimantation est plus grand (38 px, englobe le +), à bords légèrement arrondis et du cyan du thème d'Apex. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.3.1.221 — 2026-10-13

- Paramètres : choix de la page de démarrage (Accueil, Préparation, Prévisualisation ou Modélisation ; cette dernière seulement avec la valeur « dev »). L'application s'ouvre sur l'Accueil puis rejoint l'espace choisi par le même geste que le clic sur son onglet ; l'interface classique démarre directement dessus. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.2.1.221 — 2026-10-13

- Modélisation : outil Rectangle de l'esquisse. À la création d'une esquisse aucun outil n'est actif ; tous sont inactifs et grisés sauf Rectangle (qui demande d'abord un plan). Une fois actif, le curseur devient un « + » blanc simple qui s'aimante aux traits fins de la grille, avec un carré bleu autour quand il est aimanté ; le rectangle se trace au clic-clic ou au glisser, sur le plan de la grille, et est rangé dans les entités de l'esquisse. Le clic ne sélectionne plus de modèle pendant le tracé. Niveau Add-ins incrémenté, Correctif remis à 1.

## alpha-0.2.1.3.2.1.2.221 — 2026-10-13

- Modélisation : grille régulière à deux familles de traits seulement (principaux et fins = principal / 5), comme Fusion ; pas principal « rond » (1 / 2,5 / 5 / 10 x 10^k) d'au moins 90 px à l'écran, donc ~25 mm par défaut au lieu de 10 mm ; la grille se subdivise moins vite au zoom. Niveau Correctif incrémenté.

## alpha-0.2.1.3.2.1.1.221 — 2026-10-13

- Modélisation : la grille s'aligne sur le plan choisi (clic sur un plan ou une face plane pendant la création d'une esquisse, ou sur une face du ViewCube hors esquisse) ; l'orbite ne la change jamais. La vue est orientée pour que les axes x et z de la grille correspondent à la droite et au haut de l'écran. Axes colorés du monde affichés seulement s'ils reposent dans le plan, axes locaux gris pour une face quelconque ; cible caméra et zoom vers le curseur suivent le plan. Niveau Mineur incrémenté, Add-ins et Correctif remis à 1.

## alpha-0.2.1.3.1.4.6.221 — 2026-10-13

- Modélisation : l'orbite est impossible pendant le dessin d'une esquisse (dès le clic sur un plan ou une face plane, jusqu'au changement d'outil, à l'annulation ou à la sortie de l'espace) ; panoramique et zoom restent libres. Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.4.5.221 — 2026-10-13

- Modélisation : la sélection d'un plan d'esquisse ne se fait plus qu'au clic gauche (le clic droit et le clic molette, utilisés pour se déplacer, ne la déclenchent plus). Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.4.4.221 — 2026-10-13

- Modélisation : calage de l'indicateur du sélecteur Corps / Face / Arête / Sommet corrigé (la correction précédente le décalait : les boutons sont enveloppés par l'infobulle, leur offsetParent n'est pas la barre). Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.4.3.221 — 2026-10-13

- Modélisation : les plans d'esquisse sont réellement opaques (rendus après la grille et les chiffres, qui ne transparaissent plus) et leur taille à l'écran est réduite de moitié. Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.4.2.221 — 2026-10-13

- Modélisation : les plans d'esquisse sélectionnables sont d'un gris clair uni (au lieu du verre dépoli bleuté) ; cyan clair uni au survol. Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.4.1.221 — 2026-10-13

- Modélisation : au clic sur Esquisse, les plans sélectionnables (plaques, repère, axes) gardent une taille constante à l'écran quel que soit le zoom. Niveau Add-ins incrémenté, Correctif remis à 1 (comme à la dernière montée d'Add-ins).

## alpha-0.2.1.3.1.3.5.221 — 2026-10-13

- Modélisation : l'indicateur du sélecteur Corps / Face / Arête / Sommet n'est plus déformé à l'ouverture de l'espace depuis un autre espace (mesure insensible à l'animation d'entrée, remesurée au redimensionnement). Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.3.4.221 — 2026-10-13

- Modélisation : la grille est un carré fini (comme Fusion) de ±100 pas, dont la taille change à chaque changement d'échelle ; plan lointain de la caméra proportionnel au rayon (le sol ne s'efface plus au-delà de 10 m). Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.3.3.221 — 2026-10-13

- Modélisation : l'intensité et l'épaisseur de chaque famille de traits de la grille sont calculées d'après son écart au niveau de la cible (et non au pixel local) : la grille de taille moyenne ne s'estompe plus au loin. Niveau Correctif incrémenté.

## alpha-0.2.1.3.1.3.2.221 — 2026-10-13

- Modélisation : la grille n'est plus estompée dans l'espace (ni avec la distance, ni vers le bord du plan) : les mêmes familles de traits sont affichées partout ; seul un fondu selon le zoom subsiste. Niveau Correctif incrémenté.

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
