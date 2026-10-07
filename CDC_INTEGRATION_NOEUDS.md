# Cahier des charges — Intégration des nœuds d'édition du G-code

Onglet **Édition** de l'espace Prévisualisation. État au 2026-10-06, après la fin du développement du
composant nœud (banc `pnpm dev:lab-node`) et l'intégration J3 (commit `93abb07`, branche
`agent/edit-node`). La spécification détaillée et les décisions techniques sont dans `CLAUDE.md`
(section « G-code editing: handle-based deformation ») ; ce document en fait le suivi.

**Légende**

- 🟢 Résolu : fait et testé dans l'application, ou décision prise (alors marqué *à implémenter*).
- ⬛ Non traité, mais rien n'en dépend : peut être fait plus tard, dans n'importe quel ordre.
- ♦️ À résoudre avant de continuer : décision à prendre ou point bloquant pour l'étape suivante
  (écriture du fichier G-code et journal chiffré).

---

## 1. Composant nœud (interface)

- 🟢 Point coloré au repos (cyan ; orange si le rognage est actif), qui gonfle en lentille Liquid Glass au clic.
- 🟢 Verre en WebGL2 (réfraction, dispersion, Fresnel, reflets), sans pixellisation ; ombre portée qui suit la forme.
- 🟢 Icônes d'état au centre : trajectoires empilées, rognage, suppression.
- 🟢 Clic simple : développer / réduire. Double-clic : bascule du rognage (icône seulement, voir § 5).
- 🟢 Poignées Bézier déplaçables ; le verre réagit à la prise, au glissement et à la tension.
- 🟢 Double-clic sur une poignée : remise en place.
- 🟢 Bouton « + » (division par mitose) pour ajouter une poignée, jusqu'à 7.
- 🟢 Poignée glissée dans le nœud : rouge, croix, supprimée au relâchement.
- 🟢 Clic simple sur une poignée : verrouillage (bouton orange, lien blanc).
- 🟢 Nœud déplaçable ; le verre traîne derrière le mouvement.
- 🟢 Ouverture et fermeture séquencées ; reflets tournants pendant les calculs longs du noyau.
- 🟢 Bouton cadenas (décision D1, fait et testé le 2026-10-06) : gouttelette comme le « + », cadenas ouvert ou
  fermé ; nœud verrouillé cerclé de rouge, développé ou réduit.
- 🟢 Poignée sélectionnée signalée par un anneau blanc (2026-10-06, soir).
- 🟢 Infobulles de bas d'écran (2026-10-06) sur le nœud (réduit, développé libre, développé
  verrouillé), le « + », le cadenas, les poignées et les contrôles du panneau Édition. Textes du
  nœud, du « + », du cadenas et des poignées fixés par l'utilisateur (`bottomTooltip.ts`).
- 🟢 Poignées sans longueur maximale à l'écran (2026-10-06).
- ⬛ Crédits : liste des projets à mentionner (Liquid Glass Studio, Charles Yin, MIT). L'avis MIT est déjà dans `liquidGlass.ts`.

## 2. Pose et vie du nœud dans la vue 3D

- 🟢 Mode « Placer un nœud » ; clic sur la trajectoire, accroché au point de dépôt le plus proche.
- 🟢 Nœud ancré en 3D, dessiné en 2D, reprojeté à chaque image (caméra, rotation du plateau).
- 🟢 Verre réfractant l'image de la scène de la même image (calque transparent).
- 🟢 Retrait du nœud actif (corbeille) ; Échap le réduit ; tous retirés en changeant de fichier.
- 🟢 **« Position verrouillable » du nœud** (décision D1, fait et testé le 2026-10-06) : bouton cadenas, voir D1.
- 🟢 **Plusieurs nœuds** (2026-10-06) : poser un nœud réduit le précédent (poignées, cadenas
  conservés) ; un clic sur un nœud réduit le reprend. Un seul actif à la fois dans le noyau ; les
  nœuds réduits suivent la géométrie validée et restent posés en changeant d'onglet.
- ⬛ Influences de plusieurs nœuds fusionnées en une seule déformation (le noyau ne tient qu'une
  poignée à la fois).
- 🟢 Nœud estompé quand son point est masqué par la pièce (2026-10-06, soir ; reste utilisable).

## 3. Influence

- 🟢 **Poignées → influence** (décision de l'utilisateur) : la longueur donne la portée, l'orientation
  le sens préféré. Portée orientée dans le noyau C++, avec tests.
- 🟢 Poignée verrouillée (orange) = ancrage fixe : la matière y reste immobile. Testé.
- 🟢 Poignées tenues en 3D : un zoom ne change pas leur portée en millimètres.
- 🟢 Métriques activables séparément : distance 3D (portée minimale), le long du cordon,
  trajectoires adjacentes (avant / après) ; décroissance au choix ; combinaison produit / maximum.
- 🟢 Teinte violette proportionnelle au poids, avec légende dans le panneau. Onglet Édition :
  trajectoires en gris neutre éclairé par défaut, pour que les zones contraintes ressortent.
- 🟢 **Portée recommandée** (2026-10-06) : la longueur des poignées est une recommandation. Quand
  la translation demandée dépasse ce que les couches de la portée absorbent entre les épaisseurs
  limites, la portée s'élargit pendant le glissement (× 1,25 à 2 par pas), jusqu'à ne plus gagner
  de points ; revenue à la recommandation après validation.
- 🟢 Option de barrière d'influence aux changements de type de ligne (2026-10-06, soir).
- 🟢 Symétrie (cyclique, miroir) ; copier / coller une déformation entre nœuds (2026-10-06, soir). ⬛ Poignées liées à une spline.
- 🟢 Verrouillage de zones de matière (rayon réglable, gris hachuré ; 2026-10-06, soir).
- ⬛ Réglage de l'influence à la molette ou au raccourci (roadmap).

## 4. Déformation

- 🟢 Translation en direct par le vertex shader des cordons, sans géométrie recalculée par image.
- 🟢 Valeurs firmware exactes calculées en parallèle par le noyau : ΔR, ΔC, ΔZ, ΔB affichés en direct.
- 🟢 Au relâchement : validation par le noyau, réécriture des seuls segments touchés, sans saut visible.
- 🟢 Annuler / rétablir (boutons, Ctrl+Z, Ctrl+Y) pendant la session.
- 🟢 **Rotation par le nœud** (décision D2, fait et testé le 2026-10-06) : ce sont les poignées qui décident de
  la rotation ; glisser une poignée tourne la déformation et l'influence ensemble, Ctrl et Alt
  séparent les deux. Voir D2.
- 🟢 **Recalcul de E** (décision D3, fait et testé le 2026-10-06) : par le noyau C++, de manière dynamique, en
  tenant compte du changement d'épaisseur des dépôts dû à la déformation.
- 🟢 **L'objet garde sa forme, seule celle des couches change** (décision de l'utilisateur,
  2026-10-06 ; noyau `keep_shape`, 7 tests mutation-vérifiés) :
  - première couche (sur le plateau) et surface libre (rien ne repose dessus) fixes, refusées
    comme point de nœud (message) ;
  - coques (trajectoires sans matière d'un côté dans leur couche, détectées par le noyau) :
    glissent sur leur paroi ;
  - épaisseur entre 0,06 et 0,3 mm (profil d'imprimante à venir) ; le nœud freine en approchant la
    limite, vitesse relative 1 − x / x_lim, arrêt à la limite ;
  - le long de l'empilement, le poids croît selon la **marge d'épaisseur** des couches (une couche
    déjà à sa limite ne bouge plus, toutes atteignent leur limite ensemble) et chaque point avance
    le long de son propre axe de tête (couches inclinées d'un coude cohérentes) ; latéralement, seul
    l'intérieur se déplace ;
  - shader et noyau appliquent la même formule (attributs poids, normale de paroi, axe).
  - Testé sur `elbow_tube_x1.gcode` : première couche intacte, nœud ralenti puis arrêté (+2,03 mm
    le long de son axe), validation sans saut.
- 🟢 Freinage de la rotation (2026-10-06, soir).
- ⬛ Nœud maintenu à l'intérieur de l'objet lors d'un déplacement latéral (l'intérieur peut
  aujourd'hui traverser une coque).
- 🟢 Aperçu de la nouvelle hauteur de dépôt pendant le glissement (panneau + teintes ; 2026-10-06, soir).
- 🟢 Déformation des trajets à vide pendant le glissement (2026-10-06, soir).
- 🟢 Saisie numérique d'un déplacement exact dans les champs ΔR, ΔC, ΔZ, ΔB (2026-10-06, soir).
- 🟢 Lissage automatique de B après une modification (option utilisateur ; 2026-10-06, soir).
- 🟢 **Rognage** (précisé par l'utilisateur le 2026-10-06 ; fait le soir même) : seules les trajectoires de la couche
  sélectionnée sont déformées ; un sélecteur règle N couches au-dessus et au-dessous qui peuvent
  être déformées (elles absorbent, jusqu'à l'épaisseur maximale, avec le même freinage) ; au-delà de
  ces N couches, des deux côtés, les trajectoires sont strictement rognées. Aujourd'hui, la bascule
  ne change que l'icône.

## 5. Validité physique

- 🟢 Points hors limites de la machine (plage de B, vitesse et accélération de B), limites réglables dans le panneau (2026-10-06, soir).
  Prérequis : un profil d'imprimante lisible par l'interface (aucun aujourd'hui ; le moteur a
  B 0–185°, 750 °/s, 300 °/s²).
- 🟢 Indicateur de collision tête / plateau / pièce, en C++ (tête échantillonnée du GLB ; 2026-10-06, soir).
- 🟢 Écart tête / normale avec graphe et petite aide « ? », dans le panneau (2026-10-06, soir).
- ⬛ Indicateur de porte-à-faux (plus tard).

## 6. Fichier, historique et journal (étape suivante)

- 🟢 **Accès au fichier sur disque** (D6, fait et testé le 2026-10-06) : chemin réel par le preload, écriture
  atomique par le processus principal, EXPORT COPY proposé si l'écriture échoue.
- 🟢 **G-code « tranché localement » ou « importé »** (D4, fait le 2026-10-06) :
  - le moteur écrit `; apex_sliced = 1` dans son en-tête (`file_io/gcode_export.py`, après les
    commandes d'initialisation ; 98 tests du moteur passent) ;
  - l'interface reconnaît aussi `"sliced": true` dans le bloc chiffré.
  - ⬛ Reste au moteur : écrire lui-même le bloc chiffré avec ses métadonnées (le marqueur y
    passera). Format et vecteurs : `docs/APEX_HEADER_FORMAT.md`. Rien côté interface n'en dépend.
- 🟢 **Journal des modifications du G-code** (D5, fait le 2026-10-06) :
  - transformations, influence, valeurs avant / après et empreinte, dans le bloc d'en-tête chiffré ;
  - réglage « Enregistrer l'historique des modifications dans le G-code » des Paramètres, activé
    par défaut ;
  - à la réouverture, l'historique est rendu au noyau (`restoreHistory`, testé en C++) si
    l'empreinte de la dernière modification correspond, sinon ignoré avec un message.
  - L'historique du reste du projet va dans le 3MF (⬛, fonctionnalité nouvelle).
- 🟢 **Chiffrement** (D7, fait le 2026-10-06) :
  - `src/utils/apexCipher.ts` : grand chiffre → deflate → AES → Vigenère → Fleissner → Enigma → AES ;
  - aller-retour exact, contenu altéré refusé ;
  - vecteurs dans `docs/apex_cipher_vectors.json`.

  Rappel : ce n'est pas une protection (clés publiques), ne jamais le présenter comme tel.
- 🟢 **Pivot 46 mm** (D8) : le moteur exporte avec 46 mm depuis le 2026-10-01 (`pivot_to_tip`).
- 🟢 **Signe de B** (relevé puis réglé le 2026-10-06) : le moteur est revenu à **B firmware = B
  d'Apex** (`b_sign = 1`, l'essai à −1 reposait sur un contresens) ; sa conversion
  X = R_pointe + 46 sin B, Z = Z_pointe + 46 (cos B − 1) est exactement celle de l'aperçu et du
  noyau. Convention confirmée par l'utilisateur (« correspond à la machine ») : rien à aligner.
  Sur la machine, B négatif envoie la pointe vers l'extérieur : défaut à corriger sur
  l'imprimante (roadmap).
---

## Demandes détaillées

Chaque demande : la décision, les vérifications faites (cohérence avec la spécification et le
code) et ce qui reste ouvert (♦️).

### D1 — Verrouillage de position du nœud 🟢 fait

- **Décision** : un bouton cadenas, sur le modèle du « + » (gouttelette de verre qui sort du nœud
  développé), avec un cadenas ouvert ou fermé. Un nœud verrouillé est **cerclé de rouge**, qu'il
  soit développé ou réduit.
- **Comportement retenu** (lecture de la spécification « placer, verrouiller, puis déplacer ») :
  - **déverrouillé** : glisser le nœud le fait **glisser le long de la trajectoire** pour choisir
    son point d'attache, sans rien déformer ;
  - **verrouillé** : son point d'attache est fixé ; glisser le nœud **déforme** (comportement actuel).
- **À implémenter** : bouton et icônes, contour rouge, glissement le long de la trajectoire
  (point de dépôt le plus proche du curseur, par la recherche de sélection existante), état du
  nœud à la pose : déverrouillé.
- **Point d'attention** : la spécification réserve le rouge vif aux alertes (hors limites,
  collision). Le contour du nœud verrouillé est un choix explicite ; prendre un rouge distinct de
  celui des alertes si les deux peuvent se voir ensemble.

### D2 — Rotation du nœud 🟢 fait

- **Décision** : ce sont **les poignées qui décident de la rotation** du nœud, comme dans un
  éditeur de Bézier : tourner une poignée autour du nœud fait tourner la déformation (et B, par le
  noyau). L'angle dont tourne la poignée saisie, dans le plan face à la caméra, devient l'angle de
  rotation ; les autres poignées non verrouillées tournent avec elle, les verrouillées (orange)
  restent fixes.
- **Gestes** :
  - **glisser** une poignée : rotation de la déformation **et** réglage de l'influence (portée par
    la longueur, sens par l'orientation), ensemble ;
  - **Ctrl + glisser** : **rotation seule**, la portée et le sens de l'influence ne bougent pas
    (⌘ sur Mac) ;
  - **Alt + glisser** : **influence seule**, la déformation ne tourne pas.
- **Obligatoire** : ces trois gestes sont expliqués dans l'**infobulle de bas d'écran** affichée au
  survol d'une poignée. L'infobulle existe déjà (`apex-set-tooltip`, affichée par `TopRightMenu`).
  Texte proposé : « Glisser : tourner et régler l'influence · Ctrl : tourner seulement · Alt :
  régler l'influence seulement · Clic : ancrer · Double-clic : remettre en place ».
- **Vérifications** :
  - **Alt dans Electron** : la fenêtre a `autoHideMenuBar` ; relâcher Alt fait apparaître la barre
    de menu. Il faut neutraliser ce comportement (supprimer le menu de la fenêtre, ou intercepter
    Alt dans le processus principal), sinon chaque Alt + glisser fera surgir la barre.
  - **macOS** : Ctrl + clic y vaut clic droit ; prévoir ⌘ à la place de Ctrl sur Mac.
  - **Poignée verrouillée** : la glisser déplace son ancrage (comportement actuel) ; elle ne fait
    pas tourner le nœud, puisqu'elle est fixe. Cohérent avec la décision, à garder.
- **Dépend** : le geste des poignées ; la rotation est déjà dans le noyau et dans la formule du shader.

### D3 — Recalcul de l’extrusion E 🟢 fait

- **Décision** : le **noyau C++** recalcule E, **de manière dynamique**, en tenant compte du
  changement d'**épaisseur** des dépôts causé par la déformation.
- **Règle à implémenter** : pour chaque segment touché, volume déposé = longueur après ×
  largeur × épaisseur après, et E au prorata du volume d'origine :
  E après = E avant × (longueur après × épaisseur après) / (longueur avant × épaisseur avant),
  largeur supposée inchangée. Les épaisseurs viennent du graphe de contacts du noyau (il les
  calcule déjà). Les trois modes de la spécification restent (désactivé, automatique,
  automatique + facteur manuel) ; défaut : automatique.
- **« Dynamique »** : E recalculé pendant le glissement (valeurs du noyau, affichées dans le
  panneau) et à la validation ; aperçu de l'épaisseur pendant le glissement (§ 4, ⬛) à faire en même temps.
- **Prérequis technique** : le noyau ne reçoit aujourd'hui que R, C, Z, B ; il faut lui transmettre
  E (ou le dépôt par segment) au chargement.

### D4 — G-code tranché localement ou importé 🟢 fait (marqueur en clair ; bloc chiffré du moteur ⬛)

- **Décision** : un **marqueur écrit par le moteur Apex** dans l'en-tête. Plus largement, les
  **en-têtes du G-code sont chiffrés** et contiennent **le plus de métadonnées possible** sur le
  tranchage. Fichier avec le marqueur : modifié en place ; sans : EXPORT COPY. Un fichier converti
  en polaire par l'application (`apex_conversion_mode`) reste « importé ».
- **Vérifications** :
  - **Changement de spécification** : `CLAUDE.md` disait « seul le journal est chiffré, le reste du
    G-code reste en clair ». Désormais, en-têtes **et** journal sont chiffrés ; les **commandes**
    restent en clair (le firmware doit les lire). `CLAUDE.md` est mis à jour.
  - **Lecture par l'application** : le parseur lit aujourd'hui des clés d'en-tête en clair
    (imprimante, diamètre de filament, `apex_conversion_mode`, `printable_area`…). Il devra
    déchiffrer l'en-tête Apex avant de les lire.
  - **Outils tiers** : un en-tête entièrement chiffré prive firmware, écrans d'imprimante et
    gestionnaires d'impression de ce qu'ils y lisent d'habitude (durée estimée, filament, aperçu).
    Recommandation : garder en clair le strict nécessaire à ces outils et chiffrer un **bloc de
    métadonnées Apex** à côté.
  - **Deux implémentations** : le moteur (Python, autre session) écrit l'en-tête, l'interface le
    lit, et le chiffrement est le même que celui du journal (D7). Il faut une seule spécification
    du format et des **jeux de vecteurs de test communs** aux deux côtés.
- ♦️ **Dépend du moteur** : écriture du marqueur et de l'en-tête chiffré (demande à transmettre à
  la session du moteur, avec D8).
- **Roadmap (tout en dernier, à explorer)** : inclure la **géométrie initiale de l'objet** dans le
  G-code, voire en faire une véritable application.

### D5 — Format et lieu du journal 🟢 décidé

- **Décision** : **transformations + empreinte** (option 3), avec **le maximum de données** : point
  du nœud, poignées (directions, portées, ancrages), réglages d'influence, translation, rotation,
  mode et facteur d'extrusion, date, version d'Apex et du noyau, et empreinte du résultat pour
  détecter un rejeu divergent.
- **À implémenter** : rejeu déterministe par le noyau, garanti par un test (rejouer un journal
  redonne les mêmes valeurs, bit pour bit) ; empreinte = somme de contrôle des R, C, Z, B, E
  touchés.
- **Où** (décision révisée) :
  - l'**historique des modifications du G-code** va **uniquement dans l'en-tête chiffré du fichier
    G-code**, à côté des métadonnées de tranchage (D4). Il ne va ni dans le 3MF ni dans un STL ;
  - il est **désactivable au choix de l'utilisateur**. Désactivé, aucun historique n'est écrit dans
    le fichier, et l'annulation ne vaut que pour la session ;
  - le **3MF** garde l'historique du **reste du projet** (tous les autres événements : import,
    transformations de modèle, réglages, tranchage, conversion). Confirmé.
- **Conséquences** :
  - l'historique suit le G-code : un fichier rouvert, même sur un autre poste, retrouve ses
    modifications ;
  - le chiffrement multiniveau (D7) s'applique à l'en-tête du G-code, journal compris ;
  - à chaque enregistrement, l'interface **réécrit l'en-tête** (déchiffrer, ajouter les entrées,
    rechiffrer) alors que c'est le moteur qui l'a écrit au départ : même format des deux côtés
    (D4, D7).
- **Vérifications** :
  - **Taille de l'en-tête** : avec « le maximum de données », le journal peut peser lourd. Placé
    en tête du fichier, il se lit avant la première commande ; certaines imprimantes lisent l'en-tête
    au démarrage (durée, aperçu) et peuvent ralentir sur un bloc de commentaires de plusieurs Mo.
    Compression avant chiffrement (D7) et mesure sur un gros fichier à prévoir.
  - **Réglage** : désactivable dans les Paramètres, activé par défaut. Le choix est global, pas par
    fichier. Confirmé.
  - **Le 3MF n'existe pas dans l'application** (aucune lecture ni écriture) : sauvegarde et
    ouverture de projet restent une fonctionnalité nouvelle. Elles ne bloquent plus rien côté
    G-code.
  - **« Tous les événements »** du projet (3MF) : journaliser les **opérations qui changent l'état
    du projet**, pas le bruit d'interface (survol, caméra, lecture) qui circule aussi sur le bus `apex-*`.
- **État de départ pour défaire après réouverture** (décidé) : le G-code est modifié en place et
  l'original n'est pas gardé, donc chaque entrée du journal garde, en plus de la transformation,
  les **valeurs d'avant des points touchés** (R, C, Z, B, E), compressées. Défaire est exact, et
  l'empreinte vérifie le résultat.

### D6 — Chemin réel du fichier 🟢 fait

- Chemin obtenu dans le preload (`webUtils.getPathForFile`), écriture par le processus principal
  (canal IPC dédié, écriture atomique : fichier temporaire puis renommage). **En cas d'échec
  d'écriture, EXPORT COPY est proposé à la place.**

### D7 — Chiffrement de l'en-tête du G-code (métadonnées et journal) 🟢 décidé

- **Décision** : chiffrement **multiniveau**, dans cet ordre :
  1. grand chiffre de Louis XIV ;
  2. AES ;
  3. chiffre de Vigenère ;
  4. grille de Fleissner ;
  5. Enigma ;
  6. AES de nouveau.
- **Rappel** : ce n'est **pas** une protection. Toutes les clés, tables et réglages sont dans le
  code source ouvert ; on le présente comme le « format Apex », jamais comme une sécurité.
- **Vérifications et précisions d'implémentation** :
  - **Chaque étape travaille sur un alphabet différent**, il faut définir les conversions entre
    elles :
    - le Grand Chiffre est un nomenclateur (syllabes françaises → nombres) dont la table d'origine
      n'est que partiellement connue : on définit une **table Apex** inspirée de lui, appliquée au
      texte du journal ;
    - l'AES produit des octets ;
    - Vigenère et Enigma ne connaissent que les lettres A–Z : il faut un **codage octets → lettres**
      entre les deux (et à la sortie de chaque AES) ;
    - la grille de Fleissner transpose des **blocs carrés** (bourrage à définir).
  - **Taille** : chaque conversion d'alphabet grossit les données, en tout environ 5 à 10 fois le
    journal brut. Avec « le maximum de données », le G-code grossit d'autant. Recommandation :
    **compresser** (deflate) le texte du journal juste avant le premier AES. C'est un codage, pas un
    étage de chiffrement : l'ordre des six étages est respecté.
  - **Format versionné** : une marque de version (`apex v1`) avec les paramètres non secrets (nonces
    des AES) en tête du bloc chiffré du G-code, pour pouvoir faire évoluer le schéma sans rendre
    illisibles les anciens fichiers.
  - **Partagé avec les en-têtes (D4)** : même schéma côté moteur (Python) et côté interface ;
    vecteurs de test communs obligatoires.
  - **Où le coder** : ce n'est pas de la validation, le TypeScript est permis par la
    spécification ; mais pour un seul code partagé avec le moteur, une implémentation **C++**
    (exposée à Python et à l'addon) éviterait deux versions à garder identiques. À choisir à
    l'implémentation.

### D8 — Pivot 46 mm contre 45 mm (à faire côté moteur)

- L'aperçu et le noyau utilisent 46 mm (ta décision), l'export du moteur compense encore 45 mm
  (`slicer_engine/file_io/gcode_export.py`, limite n° 61). Écrire dans un fichier les valeurs du
  noyau mélangerait les deux conventions.
- **Demande** : faire passer l'export du moteur à 46 mm (session du moteur) avant d'activer
  l'écriture. Rien à changer ici.

---

## Ordre proposé

1. 🟢 Convention de signe de B (§ 6) : réglée le 2026-10-06, rien à aligner.
2. Côté moteur :
   - 🟢 D8 : pivot 46 mm, déjà fait par le moteur ;
   - 🟢 D4 : marqueur `; apex_sliced = 1` ajouté à l'export ;
   - ⬛ bloc chiffré du moteur avec ses métadonnées, selon `docs/APEX_HEADER_FORMAT.md` (rien côté
     interface n'en dépend).
3. Implémenter ici :
   - 🟢 D1 : cadenas, glissement le long de la trajectoire ;
   - 🟢 D2 : rotation par les poignées, gestes, infobulle, neutralisation d'Alt dans Electron ;
   - 🟢 D3 : E dans le noyau ;
   - 🟢 D6 : écriture du G-code modifié ;
   - 🟢 D5 et D7 : journal dans l'en-tête chiffré, réglage pour le désactiver, rejeu vérifié par
     empreinte.

   Essai de bout en bout du journal (2026-10-06) :
   - **Enregistrement :** 1 entrée de 1 921 points ; le fichier passe de 1 114 à 1 365 Ko.
   - **Réouverture :** l'historique est restauré.
   - **Annulation :** retour exact à l'original (positions identiques, E à 6·10⁻¹⁴ près).
   - **Point modifié altéré hors d'Apex :** historique ignoré, avec un message.

   Résultats des essais (2026-10-06, application Electron, noyau C++, `elbow_tube_x1.gcode`) :
   - **D1** : déverrouillé, le nœud change de point sans déformer ; verrouillé (anneau rouge),
     glisser déforme et se valide.
   - **D2** : un arc de 50° sur une poignée tourne la déformation (ΔB +34,1°), sans saut à la
     validation.
   - **D3** :
     - 3 tests C++ de plus, chacun vérifié en cassant volontairement le calcul ;
     - en direct, E à 100,4–101,7 % sur le segment du nœud ;
     - points dont seul E change inclus dans la validation.
   - **D6** :
     - texte réécrit puis réanalysé : 20 080 mouvements retrouvés, positions à 5·10⁻⁵ mm, E à
       10⁻⁵ près ;
     - E des lignes non modifiées identique (71 recalages `G92`) ;
     - écriture atomique vérifiée sur disque ;
     - fichier importé : seul EXPORT COPY est proposé.
4. Projet 3MF (fonctionnalité nouvelle, indépendante du G-code) : sauvegarde, ouverture,
   journalisation des événements du projet.
5. Enchaîner sur les ⬛ selon les priorités de l'utilisateur.

## Roadmap ajoutée

- ⬛ **Corriger sur l'imprimante le sens de B** (demande de l'utilisateur, 2026-10-06) : aujourd'hui B
  négatif envoie la pointe vers l'extérieur. Une fois le firmware corrigé, changer ensemble le
  `b_sign` du moteur, l'aperçu et le noyau, et écrire la convention dans l'en-tête du fichier pour
  relire correctement les G-code produits avant.

- ⬛ (Tout en dernier, à explorer) Inclure la géométrie initiale de l'objet dans le G-code, voire en
  faire une véritable application (D4).
