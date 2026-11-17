# ADR 0005 — Un jeu d'icônes maison, à la charte Apex

Date : 2026-11-15. Décision de l'utilisateur : remplacer toutes les icônes de bibliothèques tierces par des icônes dessinées pour
Apex, à une charte commune tirée des identités Apex, Aelox Hardware et Element.

**Contexte.** L'interface mêlait trois bibliothèques (Lucide, Tabler Icons, Heroicons) et quelques icônes locales qui en recopiaient
les tracés. Trois dessins différents, aucun lien avec le logo ni avec les emblèmes Element.

**Décision.** `src/lib/icons/` est la seule source d'icônes de l'interface : `glyphs.ts` (les tracés), `ApexIcon.tsx` (la charte,
appliquée une fois), `index.ts` (un composant par icône). Les trois bibliothèques sont retirées des dépendances. Le dossier est sous
`src/lib` pour que le kit `components/ui` puisse l'importer sans enfreindre la frontière « le kit ne dépend pas du code d'Apex ».

La charte complète, tenue à jour, est dans `docs/CHARTE_ICONES.md` ; ce qui suit en est l'état à la date de la décision.

Charte :

0. **Le sens avant tout** (utilisateur, 2026-11-15) : une icône se dessine d'après le mot et l'espace qu'elle désigne dans Apex, jamais
   d'après le pictogramme d'une bibliothèque. Préparation = une pièce posée sur le plateau ; Prévisualisation = la pièce tranchée et le
   point de dépose ; Modélisation = un profil d'esquisse et son point ; Dev = une invite de commande ; Paramètres = un écrou ;
   Édition = un nœud et ses poignées ; Orientation de la tête = la buse inclinée ; Déplacements = le saut à vide entre deux dépôts.
1. **Grille 24 × 24**, dessin entre 2 et 22.
2. **Ruban** : trait de 2, d'épaisseur constante, comme le ruban du triangle Apex. Angles adoucis (`stroke-linejoin: round`).
3. **Coupes franches** : les extrémités sont coupées net (`stroke-linecap: butt`), jamais arrondies.
4. **La coupe** : un contour fermé reste ouvert en bas à gauche, comme le logo (cercle, cadre, triangle, cube, écrou, dossier…).
   Les petits cercles (nœuds, boutons de curseur, loupe) sont trop petits pour la porter et restent fermés.
5. **Facettes pleines** : ce qui est une matière ou un état plein est une facette remplie aux angles adoucis, sans trait, comme les
   emblèmes Element (lecture, pause, plateau, matière déposée, pastilles, moitié d'origine du miroir).
6. **Angles avant courbes** : formes à facettes (cube, pointeur, crayon, parcours en créneaux) plutôt que galbes.
7. **Deux tracés au plus par icône** (le trait, la facette), qui ne se recouvrent pas : aucune surépaisseur quand l'icône est peinte
   en transparence.

**Conséquences.** Ajouter une icône = ajouter un tracé dans `glyphs.ts` et son export dans `index.ts` ; `icons.test.ts` vérifie la
grille, la charte et la correspondance tracés ↔ exports. Les icônes universelles (croix, coche, chevrons…) gardent leurs noms et leurs propriétés d'usage (`size`,
`strokeWidth`, `className`) : seuls les imports ont changé. Chaque icône porte la classe `apex-icon-<nom>` (repère des tests de bout
en bout). Restent hors du jeu, parce que leur dessin est imposé : les pictogrammes de modélisation fournis par l'utilisateur
(`ModelingIcons.tsx`), les motifs de remplissage (`InfillPatternIcon.tsx`) et les illustrations (bobine AMS, cube de vue).
`ToolAxisIcons.tsx` (un tracé par axe, coloré) suit la charte sans passer par la fabrique.
