# Profils d'imprimantes (`profiles/`)

Chaque imprimante = `<nom>.json` + `<nom>.png` (photo) dans le dossier de son niveau de menu.
Le menu Imprimantes est un navigateur de ce dossier (`electron/profiles.cjs`, `src/utils/printerProfiles.ts`).

## Format

Clés **Orca Slicer** à plat (héritage résolu, mêmes noms et valeurs en chaînes/tableaux de chaînes), plus un
bloc `apex` pour ce qu'Orca ne connaît pas. `null` = inconnu : on ne devine pas une donnée matérielle.

Bloc `apex` (toutes imprimantes) : `manufacturer`, `model`, `catalog_path`, `orca_source` (null si aucun
profil Orca), `axes_count`, `kinematics` (ex. `["X","Z","B","C"]`), `kinematics_preview` (`type` : structure
de la cinématique pour l'aperçu, `image`), `motherboard`, `motors` et `drivers` (un par axe),
`default_nozzle_profile` (`diameter_mm`, `profile_id` : voir la roadmap, profils de buse),
`auto_leveling.tool`.

`toolhead_model` : identifiant du modèle 3D de la tête (`src/assets/models/<identifiant>.glb`), lié au profil et non
choisi dans le code d'affichage ; ce fichier est le modèle commun avec le moteur (C6).

- **3 axes** : `nonplanar.max_angle_deg`, `nonplanar.max_distance_mm`.
- **4/5 axes** : `kinematics`, `pivot_distance_mm` (par axe rotatif de tête, ex. `{"B": 46}`) et `rotary_axes[]`
  (`axis`, `role`, `range_deg`, `max_speed_deg_s`, `max_acceleration_deg_s2`, `mass_kg`, `size_mm`) pour
  calculer l'inertie angulaire.

**Jauge de contrainte** (`auto_leveling.tool`) : inutilisable si l'ordinateur est localisé aux États-Unis,
sauf sur les imprimantes Stratasys (décision de l'utilisateur). Règle à appliquer côté application, pas dans le profil.

## Génération

`node scripts/profiles/generate.cjs` remplit les `.json` **vides** depuis les profils Orca installés
(`ORCA_PROFILES`, défaut `G:/Programmes/OrcaSlicer/resources/profiles`) ; `--force` écrase tout.
`node scripts/profiles/match.cjs` liste les imprimantes sans profil Orca (résine, poudre, métal, certains
modèles absents d'Orca). Les équivalences de noms vérifiées sont dans `ALIASES` de `match.cjs`.

## Valeurs matérielles : « Inconnu » et « Propriétaire »

Carte mère, moteurs, drivers, outil d'auto-niveau : le texte de la donnée si elle est publique, **« Propriétaire »**
si l'électronique est connue pour être fermée et non documentée (Bambu Lab, résine, industrie…), sinon **« Inconnu »**.
Rien n'est deviné. Champs associés : `hardware_sources` (URL des sources), `hardware_note` (réserve, ex. configuration
d'exemple Marlin communautaire), `auto_leveling.strain_gauge` (`true` si jauge de contrainte / cellule de charge,
pour la règle USA ci-dessus ; absent = non vérifié).

## Scripts (`scripts/profiles/`)

1. `expand.cjs` : ajoute tous les fabricants/modèles d'Orca absents du catalogue (`--dry` pour un essai).
2. `generate.cjs` : remplit les `.json` vides depuis Orca.
3. `enrich.cjs` : carte, drivers, sonde depuis Marlin (`MARLIN_CONFIGS=…/config/examples`) et Klipper
   (`KLIPPER_CONFIGS=…/config`, configs « stock » seulement) + faits relevés sur le web (`OVERRIDES`, avec URL),
   puis passe finale « Inconnu ». Rejouable : il réécrit ces champs à chaque exécution.
