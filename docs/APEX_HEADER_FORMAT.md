# Format Apex v1 — en-tête chiffré du G-code

Spécification commune au moteur (`slicer_engine`, Python) et à l'interface (`slicer_ux`,
TypeScript). L'implémentation de référence est `src/utils/apexCipher.ts` (chiffrement) et
`src/utils/apexHeader.ts` (bloc d'en-tête). Les vecteurs de test sont dans
`docs/apex_cipher_vectors.json`. Décisions : `CDC_INTEGRATION_NOEUDS.md`, D4, D5 et D7.

> **Ce n'est pas une protection.** Le projet est open source : toutes les clés, tables et
> réglages sont publics et figurent dans le code. Ce chiffrement est un choix de présentation
> (un format fermé en apparence sur un système ouvert fait parler de lui). Ne jamais le
> présenter comme une sécurité.

## 1. Bloc dans le G-code

Le bloc est formé de commentaires placés en tête du fichier. Les commandes restent en clair, car
le firmware doit les lire.

```
; apex_block_begin v1
; apex_data:<base64, 100 caractères par ligne au plus>
; apex_data:...
; apex_block_end
```

- **Un seul bloc par fichier.** L'interface le remplace à chaque enregistrement et le retire s'il
  n'a plus rien à porter.
- **Fins de ligne :** celles du fichier (`\n` ou `\r\n`).
- **Marqueur en clair, provisoire :** `; apex_sliced = 1`, écrit par le moteur depuis le
  2026-10-06 (`file_io/gcode_export.py`). L'interface reconnaît aussi `"sliced": true` dans le
  bloc. Quand le moteur écrira le bloc, le marqueur y rejoindra les métadonnées.

## 2. Contenu (JSON, avant chiffrement)

```json
{
  "format": 1,
  "sliced": true,
  "meta": { "...": "métadonnées de tranchage, libres (moteur) : le plus possible" },
  "journal": { "undo": [Entrée, ...], "redo": [Entrée, ...] }
}
```

| Champ | Écrit par | Rôle |
|---|---|---|
| `sliced` | moteur | Le fichier a été tranché par Apex : il peut être modifié en place. |
| `meta` | moteur | Métadonnées de tranchage, champs libres, le plus possible. |
| `journal` | interface | Historique des modifications de l'onglet Édition. Absent si l'utilisateur l'a désactivé dans les Paramètres. |

L'interface conserve `sliced` et `meta` à l'enregistrement : le moteur n'a pas à connaître le
journal.

### Entrée du journal

```json
{
  "at": "2026-10-06T12:00:00.000Z",
  "node": 12000,
  "transform": { "translation": [x, y, z], "axis": [x, y, z], "angleRad": 0 },
  "influence": { "spatial": {...}, "along": {...}, "adjacency": {...}, "combine": "product",
                 "directionSharpness": 2, "extrusion": { "mode": "auto", "factor": 1 },
                 "directions": [dx, dy, dz, portee, ...], "anchors": [x, y, z, rayon, ...] },
  "indices": [k, ...],
  "before": [R, C, Z, B, E, ...],
  "after":  [R, C, Z, B, E, ...],
  "fingerprint": "sha256 hex"
}
```

- **Repère :** celui du noyau C++ (plateau, droit, z vers le haut).
- **Points :** les indices sont des indices de mouvement, croissants.
- **Valeurs :** 5 par point (R, C, Z, B, E), E étant le delta d'extrudeur du segment en mm, arrondi
  à 10⁻⁷. `before` permet d'annuler exactement après réouverture, puisque l'original n'est pas gardé.
- **Empreinte :** SHA-256 de `Float64Array[indice, R, C, Z, B, ...]` en petit-boutiste, avec R, C,
  Z, B arrondis à 4 décimales comme dans le fichier et −0 normalisé en 0. E n'y entre pas.
- **Rejeu :** à la réouverture, l'historique n'est rendu au noyau que si l'empreinte de la dernière
  entrée `undo` correspond au fichier relu ; sinon il est ignoré et l'utilisateur prévenu.

## 3. Chiffrement multiniveau

Les étages suivent l'ordre décidé ; la compression deflate est un codage, ajouté pour la taille.

| # | Étage | Entrée → sortie |
|---|---|---|
| 1 | Grand chiffre (nomenclateur Apex) | octets UTF-8 → chiffres ASCII, 3 par code |
| — | deflate brut (RFC 1951) | chiffres → octets compressés |
| 2 | AES-256-GCM, clé 1 | octets → nonce (12) ‖ chiffré ‖ tag (16) |
| 3 | Vigenère | octets → lettres A–P (2 par octet, quartet fort puis faible), puis décalage par la clé, modulo 26 |
| 4 | Grille de Fleissner 8 × 8 | lettres, bourrées de `X` à un multiple de 64, transposées par bloc ; préfixe de 8 lettres = longueur avant bourrage en base 26 (A = 0, poids fort d'abord) |
| 5 | Enigma I | lettres → lettres (réciproque) |
| 6 | AES-256-GCM, clé 2 | lettres ASCII → nonce (12) ‖ chiffré ‖ tag |

**Sortie :** base64 standard de `APX1` (4 octets ASCII) ‖ sortie de l'étage 6.

**Déchiffrement :** les étages en sens inverse. Enigma déchiffre avec les mêmes réglages. Le préfixe
de longueur se lit après Enigma ; la grille inverse est appliquée, puis le texte est tronqué à cette
longueur.

### Constantes (publiques)

- **Clé AES 1 :** `4170657820537563726520466f726d617420312d204c6f756973205849562121`.
- **Clé AES 2 :** `4165656c6f782048617264776172652d417065782d466f726d61742d32303236`.
- **Nonces :** 12 octets aléatoires par chiffrement.
- **Clé de Vigenère :** `ROSSIGNOLGRANDCHIFFRE`.
- **Nomenclateur :**
  - entrées : les 256 octets seuls, puis la liste `DIGRAMS` d'`apexCipher.ts` dans son ordre ;
  - codes : permutation de 0..999 par mélange de Fisher-Yates (de la fin vers le début) tiré par
    mulberry32 de graine 1666 ;
  - codage glouton : digramme s'il existe, sinon octet seul.
- **Grille de Fleissner :**
  - pour chaque case (ligne, colonne) du quart 4 × 4 haut-gauche, en ordre de lecture, un nombre de
    quarts de tour horaires `floor(rand × 4)`, tiré par mulberry32 de graine 1626 ;
  - les quatre positions de la grille sont lues trou par trou, dans l'ordre de lecture.
- **Enigma I :**
  - rotors I-II-III, de gauche à droite (III est le rapide) ;
  - encoches Q, E, V, avec le double pas du rotor du milieu ;
  - anneaux à A, positions de départ `APX` ;
  - réflecteur B (`AY BR CU DH EQ FS GL IP JX KN MO TZ VW`) ;
  - tableau de connexions `AE BF CM DQ HU JN LX PR SZ VW`.

### Vérifier une réimplémentation

Pour chaque vecteur de `apex_cipher_vectors.json` :
1. déchiffrer `output` doit redonner `plain` ;
2. à partir de `afterAes1Hex` (étage 2, nonce compris), les étages 3 à 5 doivent redonner
   `vigenere`, `fleissner` et `enigma` caractère pour caractère.

La sortie deflate n'est pas normative octet pour octet : deux compresseurs peuvent produire des
octets différents, et seul le déchiffrement fait foi.
