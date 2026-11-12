# Génération de G-code avec changement de couleur (AMS) — conception

Demande de l'utilisateur (2026-11-11) : « concevoir un système de génération de G-code avec changement de couleur ». **Document de
conception : rien n'est implémenté côté G-code.** Seul le modèle de données (l'AMS) existe déjà dans l'interface.

## 1. Qui fait quoi

Apex **n'écrit pas** le G-code dans l'interface : le tranchage et l'écriture sont dans le moteur (`apex-engine`), l'interface le pilote et
l'affiche (`gcodeParse.ts` ↔ `gcodeWriter.ts` pour l'édition). Le changement de couleur se partage donc ainsi :

| Couche | Rôle |
|---|---|
| **Interface** | Modèle de données (AMS, affectations, changements de couleur), saisie, aperçu, envoi au moteur, lecture des marqueurs dans le G-code produit, post-traitement d'un G-code existant (onglet d'édition). |
| **Moteur** | Génération : ordre des couleurs par couche, tour de purge, séquence de changement, volumes de purge, en-tête. **Demande à déposer** dans `apex/integration/REQUESTS.md` (§6). |
| **Profil d'imprimante** | Les commandes de changement (`M600`, `T<n>`, `M620/M621`…) sont des **données**, jamais des constantes dans un composant (règle 6 de CLAUDE.md). |

## 2. Modèle de données

- **Slot** = une bobine de l'AMS, numérotée par sa position (1, 2, 3…). Le numéro d'outil est `T(slot − 1)`. Déplacer une bobine dans
  l'AMS change son numéro, donc l'outil qui lui est associé : l'AMS fait foi, rien n'est mémorisé ailleurs.
- **Entrée d'AMS** (`AmsEntry`, `components/ams/amsSpoolsState.ts`) : identifiant stable, clé de profil de filament `vendor|name`
  (usine ou copie utilisateur), couleur. Mémorisée dans le navigateur (`apex.ams`, `amsStore.ts`).
- **Filament actif** : le **slot 1** de l'AMS (`amsStore.ts` écrit `apex.filament`). Tant que l'impression reste mono-matière, c'est lui
  que lit la découpe.
- **Profil de filament** : catalogue Orca + champ `finish` (aspect) + copies utilisateur (`utils/userFilaments.ts`, l'usine n'est jamais
  écrasée). Le moteur reçoit, par slot : type, températures de buse (plage et première couche), plateau, débit, densité.
- **Affectation** : quelle matière imprime quoi. Trois niveaux, du plus simple au plus riche (§3) : par plage de couches, par objet, par
  région peinte.

## 3. Trois modes de changement de couleur

| Mode | Principe | Commande émise | Prérequis profil |
|---|---|---|---|
| **A. Pause manuelle** (mono-extrudeur) | À la couche N, le moteur arrête l'impression, parque la tête, l'utilisateur change le filament. | `M600` (ou la macro du firmware), rétractions et parking du profil | `multi_material.manual_change_gcode` |
| **B. Changement d'outil AMS / MMU** | À la couche N (ou à chaque changement d'objet), la machine charge le slot voulu seule. | `T<n>`, ou la séquence de la machine (`M620 S<n>` … `M621 S<n>` sur Bambu) | `multi_material.tool_change_gcode`, nombre de slots |
| **C. Multi-couleur par objet / par région** | Plusieurs matières dans une même couche, avec purge entre deux. | comme B, plus tour de purge | idem B + `multi_material.flush_*` |

Ordre de réalisation conseillé : **A** (le plus utile, le plus simple, sans purge), puis **B**, puis **C**.

### Purge (modes B et C)

La purge dépend du couple (couleur de départ → couleur d'arrivée) : passer du noir au blanc demande plus de matière que l'inverse. Le
moteur calcule une **matrice de volumes de purge** à partir des couleurs des slots (luminosité et teinte, comme le fait Orca) et un
coefficient réglable (Paramètres › Algorithme). Les volumes sont **mesurés ou fournis**, jamais devinés par l'interface. Une tour de
purge est posée sur le plateau (position et largeur : paramètres du moteur ; l'arrangement doit la traiter comme un objet fixe).

## 4. Contrat interface → moteur (à valider avec la session du moteur)

Ajout à l'entrée de tranchage (JSON), absent = comportement actuel (mono-matière) :

```json
{
  "filaments": [
    { "slot": 1, "key": "BBL|Bambu PLA Silk", "type": "PLA", "color": "#e8e8ea",
      "nozzle_temp": 220, "nozzle_temp_initial_layer": 220, "bed_temp": 55, "flow_ratio": 0.98, "density": 1.24 }
  ],
  "color_changes": [ { "layer": 40, "slot": 2 } ],
  "assignments": { "object:cube-1": 1, "object:cube-2": 3 },
  "multi_material": { "mode": "none | manual_m600 | tool_change", "purge_multiplier": 1.0 }
}
```

- `layer` : index de couche d'Apex (même repère que `;LAYER:` du G-code, à fixer dans la demande).
- Les clés de profil servent à l'affichage et à l'en-tête ; **tout ce dont le moteur a besoin pour trancher est dans la ligne du slot**
  (le moteur ne lit pas le catalogue de l'interface).
- `mode` est choisi par l'interface d'après le profil de l'imprimante (`multi_material` du profil) ; `none` si le profil ne le décrit pas.

## 5. Contrat moteur → interface (G-code produit)

- **Marqueurs** (commentaires, lus par `gcodeParse.ts`) : `;COLOR_CHANGE layer=40 slot=2 gcode=M600`, `;TOOL_CHANGE from=1 to=2`,
  `;PURGE_START` / `;PURGE_END`, et le type de ligne `;TYPE:Prime tower` pour la tour de purge. Format à figer avec le moteur.
- **En-tête Apex** (`docs/APEX_HEADER_FORMAT.md`) : liste des slots avec clé de profil, type, couleur, aspect. Le bloc est chiffré comme
  le reste de l'en-tête ; un G-code sans cette liste reste lisible (mono-matière).
- **Aperçu** : la Prévisualisation colore par outil (`gcodeColormap.ts` : un mode « par outil / par couleur de filament »), les
  changements sont des repères sur le curseur de couches, la purge a sa couleur de type de ligne.
- **Temps et matière** : le moteur additionne le temps de changement et la matière purgée ; l'interface les affiche tels quels.

## 6. Ce que fait l'interface

1. **AMS** (fait, prototype dans l'onglet Dev) : slots, profils, copies utilisateur, ordre par glisser-déposer, « + » bibliothèque.
   **Lien** : slot 1 = filament actif (fait).
2. **Changements de couleur** : sous le curseur de couches de la Prévisualisation, un bouton « + » à la couche courante ajoute un
   changement (choix d'un slot de l'AMS) ; une pastille par changement, déplaçable et supprimable. Liste mémorisée avec le projet.
3. **Affectation par objet** (mode C) : sélecteur de slot dans le menu contextuel d'un modèle et dans l'arborescence des modèles.
4. **Post-traitement d'un G-code existant** (onglet d'édition) : `insertColorChange(text, layer, command)` dans le noyau d'édition,
   protégé par les tests d'aller-retour `gcodeParse.ts` ↔ `gcodeWriter.ts` (`;TYPE:` et étiquettes conservés). Utile dès le mode A, sans
   attendre le moteur ; le fichier d'origine n'est jamais modifié (copie à l'export, comme l'édition par poignées).
5. **Validation avant tranchage** : slots utilisés absents de l'AMS, températures incompatibles entre deux matières d'un même objet,
   imprimante sans description `multi_material` → avertissement, pas de G-code multicolore silencieusement faux.

## 7. Profil d'imprimante

Bloc `apex.multi_material` du profil (format : `docs/PRINTER_PROFILE_FORMAT.md`, à compléter) :

```json
"multi_material": {
  "slots": null,
  "manual_change_gcode": null,
  "tool_change_gcode": null,
  "flush_unit_mm3": null
}
```

`null` = non renseigné (**jamais deviné**, comme le matériel que Orca n'a pas). Sans ce bloc, l'interface ne propose que le mode
mono-matière. Les valeurs viennent du firmware de chaque machine, une imprimante à la fois.

## 8. Phases

| Phase | Contenu | Dépend de |
|---|---|---|
| P0 | Modèle de données AMS, copies utilisateur, filament actif lié (**fait**) | — |
| P1 | Post-traitement `M600` dans l'onglet d'édition + parseur (`M600`, `T<n>`, repères sur le curseur) | profil `manual_change_gcode` |
| P2 | Demande au moteur (contrat §4 et §5), jeu de G-code de référence | session du moteur |
| P3 | Mode B : changement d'outil, purge, tour de purge, aperçu par outil | P2 |
| P4 | Mode C : affectation par objet puis par région peinte | P3 |

## 9. Questions ouvertes

- Quelles imprimantes visées en premier (Aelox Hardware, ou aussi des machines à AMS du commerce) ? Cela décide de la séquence de P3.
- Un seul extrudeur avec M600 d'abord (P1) suffit-il comme premier jalon ?
- La tour de purge existe-t-elle déjà dans le moteur, ou est-elle à créer (Orca la place dans l'arrangement, `utils/orcaArrange.ts` ne la
  gère pas encore) ?
- Le repère de couche (`layer`) : index d'Apex ou hauteur en mm ? (proposé : index, avec la hauteur affichée à côté.)
