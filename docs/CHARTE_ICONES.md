# Charte des icônes Apex / Aelox Hardware

Document de référence pour dessiner, choisir et ajouter une icône. Décision de l'utilisateur du 2026-11-15.

Cette charte vaut pour **toutes** les icônes du logiciel Apex et du site aeloxhardware.com. Les deux dépôts portent le même
document ; seule la dernière section (« Dans ce dépôt ») diffère. Une modification de la charte se reporte dans les deux.

## 1. D'où elle vient

Elle est tirée des trois identités de la maison :

- **Le logo Apex** : un triangle fait d'un ruban épais, d'épaisseur constante, aux angles adoucis, qui ne se referme pas — il
  reste ouvert en bas à gauche, ses deux bouts coupés net.
- **Les emblèmes Element** (Arva, Ardor, Aeolis, Aequor) : des facettes pleines, inclinées, aux angles à peine arrondis.
- **Aelox Hardware** : le vocabulaire de la machine — plateau, buse, couches, écrou, clé — plutôt que celui du bureau.

Aucune bibliothèque d'icônes tierce n'est utilisée, ni comme dépendance ni comme modèle.

## 2. Les règles

**0. Le sens avant tout.** Une icône se dessine d'après le mot et l'endroit qu'elle désigne, jamais d'après le pictogramme
habituel d'une bibliothèque. Avant de dessiner, répondre à : « que fait-on, ou que trouve-t-on, derrière ce mot, ici ? »

| Mot | Dessin | Et non |
|---|---|---|
| Préparation | une pièce posée sur le plateau | un fichier à curseurs |
| Prévisualisation, Slicers | la pièce tranchée en couches, le point de dépose | une pile de calques |
| Modélisation, CAO | un profil d'esquisse que son point vient fermer | un cube |
| Paramètres | un écrou | un engrenage générique |
| Dev, Firmwares | une invite de commande | `</>` |
| Édition du tracé | un nœud et ses deux poignées | un crayon |
| Orientation de la tête, Slicing multi-axes | la buse inclinée à côté de la verticale | une boussole |
| Déplacements | le saut à vide entre deux dépôts | des points reliés |
| Supports | le porte-à-faux et ses piliers | un cône de chantier |
| Métaux | des lingots | un marteau |
| Défauts structurels | une pièce fissurée | un panneau d'alerte |
| Accueil (vue d'origine) | une maison, porte pleine | une cible ou un cadre |

Une même icône ne sert pas à deux idées différentes. Les signes universels (croix, coche, chevrons, flèches, plus, moins)
restent ce qu'ils sont : leur sens est déjà le bon.

**1. Grille.** 24 × 24, dessin entre 2 et 22. Une icône doit rester lisible à 12 px.

**2. Ruban.** Un seul trait, d'épaisseur 2, constante. Les angles sont adoucis (`stroke-linejoin: round`).

**3. Coupes franches.** Les extrémités sont coupées net (`stroke-linecap: butt`), jamais arrondies. Un point isolé n'est donc
pas un trait de longueur nulle : c'est une pastille pleine.

**4. La coupe.** Un contour fermé reste **ouvert en bas à gauche**, comme le logo : cercle, cadre, triangle, cube, bouclier,
dossier, page, écrou, goutte. Les formes de base partagées la portent déjà (`CIRCLE`, `FRAME`, `TRIANGLE`, `CUBE`, `SHIELD`).
Exceptions : les contours trop petits pour qu'elle se lise (nœuds, boutons de curseur, loupe, rayon ≤ 6,5) et les objets dont la
fermeture fait le sens (une alvéole, un maillon, une gélule d'interrupteur).

**5. Facettes pleines.** Ce qui est matière ou état plein est une forme **remplie, sans trait**, aux angles adoucis dans le tracé
lui-même : plateau, matière déposée, lingots, grains, pastilles, lecture, pause. Les facettes penchent volontiers, comme les
emblèmes Element (le plateau est un parallélogramme).

**6. Angles avant courbes.** Préférer les pans droits et les angles à 45°/60° aux galbes : cube, pointeur, crayon, parcours en
créneaux. Une courbe se garde quand elle est le sujet (onde, spirale, goutte, cadran).

**7. Deux tracés au plus, qui ne se recouvrent pas.** Une icône est faite d'un trait (`d`) et, au besoin, d'une facette
(`solid`). Chacun est peint d'un seul bloc et ils ne se touchent pas : peinte en transparence, l'icône ne montre aucune
surépaisseur aux croisements. C'est pour cela qu'une facette n'a pas de trait.

**8. Une seule couleur.** `currentColor`. La couleur vient du texte qui porte l'icône, jamais du dessin. (Seule exception
existante : les icônes d'axes d'Apex, colorées par axe quand l'outil est actif.)

## 3. Construire une icône

Les tracés vivent dans `src/lib/icons/glyphs.ts`, un glyphe par ligne :

```ts
'space-prepare': { d: 'M8 13V5h8.5v8', solid: facet([[5.5, 16], [22, 16], [18.5, 21], [2, 21]]) },
```

Outils fournis par le fichier :

- `dot(cx, cy, r)` — pastille pleine ;
- `ring(cx, cy, r)` — petit cercle fermé ;
- `facet(points, r)` — polygone plein aux angles adoucis ;
- les formes de base ouvertes en bas à gauche, à réutiliser telles quelles pour que les icônes aient les mêmes proportions.

La charte elle-même (grille, épaisseur, coupes, angles) est appliquée une seule fois, dans `ApexIcon.tsx` : un glyphe n'apporte
que ses tracés. On n'écrit jamais un `<svg>` d'icône à la main dans un composant.

## 4. Ajouter une icône

1. Écrire en une phrase ce que le mot désigne ici ; c'est le commentaire du glyphe.
2. Chercher si un glyphe existant dit déjà exactement cela. Si oui, le réutiliser ; sinon, dessiner.
3. Dessiner dans `glyphs.ts` en partant des formes de base, le nommer en minuscules d'après son **sens** (`head-tilt`,
   `layer-smoothing`), pas d'après sa forme.
4. La regarder à 48, 22, 16 et 12 px sur fond sombre, à côté de ses voisines, à 100 % puis à 50 % d'opacité.
5. L'exporter (voir « Dans ce dépôt »).

Contrôle avant de valider :

- [ ] elle dit le mot, pas un pictogramme générique ;
- [ ] trait de 2, extrémités coupées net, aucune extrémité arrondie ;
- [ ] contour fermé ouvert en bas à gauche (ou exception justifiée) ;
- [ ] facette sans trait, qui ne touche pas le trait ;
- [ ] tout tient entre 2 et 22 ; lisible à 12 px ;
- [ ] une seule couleur, `currentColor`.

## 5. Ce qui reste hors du jeu

Les logos et marques (Aelox, Apex, emblèmes Element, logos de langages), les illustrations (bobine, moteur, cube de vue), les
schémas des articles et les pictogrammes dont le dessin est imposé par une référence fournie. Ils ne sont pas redessinés ; ils ne
servent pas non plus de modèle aux icônes.

## 6. Dans ce dépôt (Apex)

- Jeu : `src/lib/icons/` — `glyphs.ts` (tracés), `ApexIcon.tsx` (charte), `index.ts` (un composant par icône),
  `icons.test.ts` (grille, charte, correspondance tracés ↔ exports).
- Usage : `import { SpacePrepare } from '@/lib/icons'` puis `<SpacePrepare size={22} />`. Propriétés : `size`,
  `strokeWidth`, `className`, et celles d'un `<svg>`.
- Chaque glyphe a exactement un export (`knip` refuse un export inutilisé, le test refuse un glyphe sans export) : on
  n'ajoute une icône que lorsqu'on s'en sert.
- Chaque icône porte la classe `apex-icon-<nom>`, repère des tests de bout en bout.
- `ToolAxisIcons.tsx` (un tracé par axe, coloré) suit la charte sans passer par la fabrique. `ModelingIcons.tsx`,
  `InfillPatternIcon.tsx`, la bobine AMS et le cube de vue sont hors du jeu (§ 5).
- Décision d'origine : `docs/adr/0005-icones-maison.md`.
- Le site aeloxhardware.com part de ce jeu et y ajoute ses propres glyphes : un glyphe commun se corrige ici d'abord, puis
  se reporte là-bas.
