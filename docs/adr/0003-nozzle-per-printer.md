# ADR 0003 — La géométrie de buse est une donnée du profil d'imprimante

Date : 2026-11-06. Décision de l'utilisateur : longueur et angle de buse par imprimante.

**Contexte.** `nozzle_reach` et `nozzle_angle_deg` (Element Aeolis) étaient un jeu unique mémorisé dans le navigateur, avec un défaut
du moteur (2 mm, 10°). Règle 6 de CLAUDE.md : aucune constante de machine dans le code de l'interface, les profils sont des données.

**Décision.** `apex.default_nozzle_profile` du profil porte `length_mm`, `angle_deg` et `outer_width_mm` (`null` ou « Inconnu » si non
mesuré). `machineFacts` les lit ; `aeolisNozzle.ts` démarre sur le profil de l'imprimante active (choisie dans le menu Imprimantes) et
mémorise le réglage de l'utilisateur **par imprimante** (clé = nom), champ par champ : un champ non touché continue de suivre le profil.
L'ancienne clé unique est reprise une fois pour l'imprimante par défaut.

**Conséquences.** Ajouter une imprimante = renseigner son profil. Seuls la longueur et l'angle partent au moteur ; la largeur extérieure
reste informative tant que le moteur n'a pas de paramètre pour elle. Les profils générés depuis Orca laissent ces champs à `null` : le
moteur garde alors ses défauts. Les valeurs d'Aetheris-4 (10°, 2 mm) sont les défauts du moteur, pas des mesures.
