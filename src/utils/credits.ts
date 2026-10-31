/**
 * Crédits de l'application, affichés en grand dans Paramètres (components/CreditsPanel.tsx).
 * Source unique : tout projet, police ou ressource à mentionner s'ajoute ici.
 * Les avis de licence exigés (MIT de Liquid Glass Studio) restent aussi dans le code source concerné.
 * Le moteur de tranchage (groupes « Moteur · … ») vient de CITATION_ENGINE.md, dans le dossier parent
 * de ce dépôt : licences relevées le 2026-10-07 dans les métadonnées des paquets du moteur.
 */
export interface CreditEntry {
  name: string;
  /** Auteur ou projet. */
  by: string;
  /** Drapeau (émoji) de la nationalité de l'auteur, affiché à côté de son nom. */
  flag?: string;
  /** Nationalité déduite, non confirmée : le drapeau est suivi d'un « (?) ». */
  flagGuess?: boolean;
  /** Licence, telle que publiée par l'auteur. */
  license: string;
  /** Précision sur la licence (double licence, composant inclus…). */
  licenseNote?: string;
  /** Ce que l'application en fait. */
  use: string;
  /** Lien sous l'entrée : ouvre une fenêtre de l'application. */
  link?: { label: string; opens: 'sound-library' };
  /** Adresse du projet (ouverte dans le navigateur du système). */
  url?: string;
  /** Citation demandée par l'auteur. */
  citation?: string;
  /** Obligation de licence à respecter. */
  obligation?: string;
}

export interface CreditGroup {
  title: string;
  /** Précision sous le titre du groupe. */
  subtitle?: string;
  entries: CreditEntry[];
}

export const CREDITS: CreditGroup[] = [
  {
    title: 'Sons',
    entries: [
      {
        name: 'Pixabay',
        flag: '🌍', by: 'Les artistes de Pixabay',
        license: 'Pixabay Content License',
        use: 'Sons de l’application.',
        link: { label: 'Accéder à la bibliothèque de sons gratuits', opens: 'sound-library' },
      },
    ],
  },
  {
    title: 'Verre « Liquid Glass »',
    entries: [
      {
        name: 'Liquid Glass Studio',
        flag: '🌍', by: 'Charles Yin',
        license: 'MIT',
        use: 'Shaders de réfraction, de dispersion et de reflet du nœud d’édition et des panneaux de verre.',
      },
      {
        name: 'GLSL-Color-Functions',
        flag: '🌍', by: 'Rachmanin0xFF',
        license: 'MIT',
        use: 'Conversions de couleur utilisées par les shaders du verre.',
      },
    ],
  },
  {
    title: 'Moteur 3D et application',
    entries: [
      { name: 'Babylon.js', flag: '🇺🇸', by: 'Microsoft et la communauté Babylon.js', license: 'Apache 2.0', use: 'Vue 3D, chargement des modèles, rendu du tracé.' },
      { name: 'Electron', flag: '🇺🇸', by: 'OpenJS Foundation', license: 'MIT', use: 'Application de bureau et processus du noyau d’édition.' },
      { name: 'React', flag: '🇺🇸', by: 'Meta', license: 'MIT', use: 'Interface.' },
      { name: 'Vite', flag: '🌍', by: 'Evan You et les contributeurs de Vite', license: 'MIT', use: 'Compilation et serveur de développement.' },
      { name: 'Framer Motion', flag: '🇳🇱', by: 'Framer', license: 'MIT', use: 'Animations des panneaux.' },
    ],
  },
  {
    title: 'Composants d’interface',
    entries: [
      { name: 'shadcn/ui', flag: '🌍', by: 'shadcn', license: 'MIT', use: 'Base des composants.' },
      { name: 'Radix UI', flag: '🇺🇸', by: 'WorkOS', license: 'MIT', use: 'Primitives accessibles.' },
      { name: 'Tailwind CSS', flag: '🇺🇸', by: 'Tailwind Labs', license: 'MIT', use: 'Mise en page.' },
      { name: 'Lucide', flag: '🌍', by: 'Les contributeurs de Lucide', license: 'ISC', use: 'Icônes.' },
      { name: 'Tabler Icons', flag: '🇵🇱', by: 'Paweł Kuna', license: 'MIT', use: 'Icônes.' },
      { name: 'Recharts', flag: '🌍', by: 'Les contributeurs de Recharts', license: 'MIT', use: 'Graphiques.' },
      { name: 'Sonner', flag: '🌍', by: 'Emil Kowalski', license: 'MIT', use: 'Notifications.' },
    ],
  },
  {
    title: 'Interface · Gizmo de rotation et disposition automatique',
    entries: [
      {
        name: 'OrcaSlicer',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, d’après PrusaSlicer (Prusa Research) et Slic3r (Alessandro Ranellucci)',
        license: 'AGPL-3.0',
        use: 'Gizmo de rotation : trois anneaux autour du centre du modèle, graduation de 72 crans, rayons d’accroche (45° au centre, 5° près de l’anneau), poignée et arc d’angle. Portage vers Babylon.js du comportement de GLGizmoRotate (components/orcaRotateGizmo.ts).',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, src/slic3r/GUI/Gizmos/GLGizmoRotate.cpp [logiciel]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0.',
        obligation: 'Le code dérivé garde la notice AGPL-3.0 et l’attribution aux auteurs d’OrcaSlicer, PrusaSlicer et Slic3r.',
      },
      {
        name: 'OrcaSlicer — mise à l’échelle',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, d’après PrusaSlicer (Prusa Research) et Slic3r (Alessandro Ranellucci)',
        license: 'AGPL-3.0',
        use: 'Gizmo de redimensionnement : six poignées de face (X, vertical, profondeur) et quatre poignées d’angle du bas, calcul du rapport par projection sur le plan de glissement, pas de 0,05 avec Maj, ancrage de la face ou de l’angle opposé avec Ctrl, mise à l’échelle autour du centre de la base. Portage vers Babylon.js du comportement de GLGizmoScale3D (components/orcaScaleGizmo.ts).',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, src/slic3r/GUI/Gizmos/GLGizmoScale.cpp [logiciel]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0.',
        obligation: 'Le code dérivé garde la notice AGPL-3.0 et l’attribution aux auteurs d’OrcaSlicer, PrusaSlicer et Slic3r.',
      },
      {
        name: 'OrcaSlicer — disposition automatique',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, d’après PrusaSlicer (Prusa Research) et libnest2d (Tamás Mészáros)',
        license: 'AGPL-3.0',
        use: 'Disposition automatique des modèles : empreinte convexe gonflée de l’écart, tri du plus grand au plus petit, rotations de 0°, 45°, 90° et 135° à partir de l’angle de la boîte d’aire minimale, placement par polygones de non-recouvrement, fonction objectif distance au tas / distance au centre / densité, recentrage final. Réimplémentation en TypeScript (utils/orcaArrange.ts) ; le terme d’alignement et les contraintes de température, d’extrudeur et d’impression séquentielle ne sont pas repris.',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, src/slic3r/GUI/Jobs/ArrangeJob.cpp et src/libslic3r/Arrange.cpp [logiciel]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0. Placeur NFP : libnest2d, T. Mészáros, https://github.com/tamasmeszaros/libnest2d.',
        obligation: 'Le code dérivé garde la notice AGPL-3.0 et l’attribution aux auteurs d’OrcaSlicer, PrusaSlicer et libnest2d.',
      },
      {
        name: 'OrcaSlicer — rendu des modèles',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, d’après PrusaSlicer (Prusa Research) et Slic3r (Alessandro Ranellucci)',
        license: 'AGPL-3.0',
        use: 'Rendu par défaut des modèles importés : ombrage de Gouraud à deux lumières directionnelles fixées à la caméra (haut : diffuse + spéculaire ; face : diffuse), lumière ambiante, mêmes constantes que les shaders gouraud.vs et gouraud.fs. Portage vers Babylon.js (components/orcaModelMaterial.ts) ; la détection de pente, le hors-volume et les plans de coupe ne sont pas repris. La couleur par défaut est celle d’Apex, pas celle d’Orca.',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, resources/shaders/110/gouraud.vs et gouraud.fs [logiciel]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0.',
        obligation: 'Le code dérivé garde la notice AGPL-3.0 et l’attribution aux auteurs d’OrcaSlicer et de PrusaSlicer.',
      },
      {
        name: 'OrcaSlicer — motifs de remplissage',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, d’après PrusaSlicer (Prusa Research) et Slic3r (Alessandro Ranellucci)',
        license: 'AGPL-3.0',
        use: 'Liste et ordre des motifs de remplissage creux proposés dans le menu de motif (utils/orcaInfillPatterns.ts). Les icônes sont dessinées pour Apex. Seuls les motifs que le moteur réalise sont actifs ; les autres sont grisés, « Arrive bientôt ».',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, src/libslic3r/PrintConfig.cpp, option sparse_infill_pattern [logiciel]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0.',
        obligation: 'Attribution aux auteurs d’OrcaSlicer, PrusaSlicer et Slic3r.',
      },
      {
        name: 'OrcaSlicer — profils de filaments',
        flag: '🌍', by: 'SoftFever et les contributeurs d’OrcaSlicer, avec les profils fournis par les fabricants de filaments et d’imprimantes',
        license: 'AGPL-3.0',
        use: 'Catalogue des filaments proposés dans Préparation : nom, matière, températures, densité, coût, débit, extraits des profils filament d’OrcaSlicer (héritage résolu, variantes par buse regroupées) par scripts/profiles/filaments.cjs vers public/filaments.json.',
        url: 'https://github.com/OrcaSlicer/OrcaSlicer',
        citation: 'OrcaSlicer, resources/profiles/*/filament [données]. https://github.com/OrcaSlicer/OrcaSlicer. Licence AGPL-3.0.',
        obligation: 'Les données dérivées gardent la notice AGPL-3.0 et l’attribution aux auteurs d’OrcaSlicer et aux fabricants cités dans les profils.',
      },
    ],
  },
  {
    title: 'Polices',
    entries: [
      { name: 'Orbitron', flag: '🇺🇸', by: 'Matt McInerney', license: 'SIL Open Font License 1.1', use: 'Police principale.' },
      { name: 'Oxanium', flag: '🌍', by: 'Severin Meyer', license: 'SIL Open Font License 1.1', use: 'Police d’interface.' },
      { name: 'Russo One', flag: '🇷🇺', by: 'Jovanny Lemonad', license: 'SIL Open Font License 1.1', use: 'Police d’affichage.' },
      { name: 'Ethnocentric', flag: '🇨🇦', by: 'Typodermic Fonts', license: 'Licence Typodermic', use: 'Police des titres.' },
    ],
  },
  {
    title: 'Moteur · Tranchage non planaire',
    entries: [
      {
        name: 'S4 Slicer',
        flag: '🇦🇺', flagGuess: true, by: 'Joshua Bird',
        license: 'GPL-3.0',
        use: 'A inspiré ce projet : tranchage non planaire par déformation (tranchage à plat dans l’espace déformé, puis retour dans la pièce). La voie « Bird » a été retirée du moteur, qui tranche désormais par la méthode de la chaleur ; elle reste sauvegardée, avec ses notices, dans la branche bird_old. Le lissage non planaire en reprend le principe.',
        url: 'https://github.com/jyjblrd/S4_Slicer',
        citation: 'Bird, J. S4 Slicer — Generic Non-Planar Slicer [logiciel]. https://github.com/jyjblrd/S4_Slicer. Licence GPL-3.0.',
        obligation: 'Tout code dérivé de S4 Slicer (la voie sauvegardée dans bird_old, et les parties du lissage qui en sont portées) garde la notice GPL-3.0 et l’attribution à l’auteur.',
      },
    ],
  },
  {
    title: 'Moteur · Maillage et géométrie 3D',
    entries: [
      { name: 'TetGen', flag: '🇩🇪', by: 'Hang Si, Weierstrass Institute (WIAS Berlin)', license: 'AGPL-3.0', licenseNote: 'une licence commerciale existe auprès du WIAS', use: 'Tétraédrisation du volume de la pièce, base du champ de couches. Exécuté dans un processus séparé.' },
      { name: 'tetgen (module Python)', flag: '🌍', by: 'Les développeurs de PyVista', license: 'MIT', use: 'Appel de TetGen depuis Python.' },
      { name: 'trimesh', flag: '🇺🇸', by: 'Michael Dawson-Haggerty et les contributeurs', license: 'MIT', use: 'Chargement des STL/3MF et du modèle de tête, réparation, coupes, distances à la surface.' },
      { name: 'Manifold (manifold3d)', flag: '🇺🇸', by: 'Emmett Lalish et les contributeurs', license: 'Apache 2.0', use: 'Opérations booléennes sur les maillages.' },
      { name: 'PyMeshFix', flag: '🌍', by: 'Les développeurs de PyVista, d’après MeshFix de Marco Attene', license: 'AGPL-3.0', use: 'Réparation des maillages auto-intersectants refusés par TetGen. Chargé uniquement dans ce cas.' },
      { name: 'Rtree', flag: '🇺🇸', by: 'Sean Gillies et les contributeurs (sur libspatialindex)', license: 'MIT', use: 'Index spatial utilisé par trimesh.' },
    ],
  },
  {
    title: 'Moteur · Calcul scientifique',
    entries: [
      { name: 'NumPy', flag: '🇺🇸', by: 'Travis E. Oliphant et les contributeurs de NumPy', license: 'BSD-3-Clause', licenseNote: 'et licences permissives des composants inclus', use: 'Tous les calculs sur tableaux.' },
      { name: 'SciPy', flag: '🌍', by: 'Les développeurs de SciPy', license: 'BSD-3-Clause', use: 'Matrices creuses et résolution du champ scalaire, arbres k-d.' },
      { name: 'NetworkX', flag: '🇺🇸', by: 'Aric Hagberg et les contributeurs de NetworkX', license: 'BSD-3-Clause', use: 'Graphes de régions et de dépendances entre couches.' },
      { name: 'Shapely', flag: '🇺🇸', by: 'Sean Gillies et les contributeurs (sur GEOS)', license: 'BSD-3-Clause', licenseNote: 'GEOS : LGPL-2.1', use: 'Géométrie 2D des couches (parois, remplissage).' },
    ],
  },
  {
    title: 'Moteur · Noyau natif C++',
    entries: [
      { name: 'Eigen', flag: '🇫🇷', by: 'Benoît Jacob, Gaël Guennebaud et les contributeurs d’Eigen', license: 'MPL-2.0', use: 'Algèbre linéaire du noyau natif.' },
      { name: 'Clipper2', flag: '🇦🇺', flagGuess: true, by: 'Angus Johnson', license: 'Boost Software License 1.0', use: 'Décalages de polygones (parois et remplissage) dans le noyau natif.' },
      { name: 'pybind11', flag: '🇩🇪', flagGuess: true, by: 'Wenzel Jakob et les contributeurs', license: 'BSD-3-Clause', use: 'Liaison entre le noyau C++ et Python.' },
    ],
  },
  {
    title: 'Moteur · Recherche, visualisation et développement',
    subtitle: 'Hors de l’application livrée.',
    entries: [
      { name: 'libigl', flag: '🌍', by: 'Alec Jacobson, Daniele Panozzo et les contributeurs', license: 'MPL-2.0', use: 'Chemins sur surface dans la recherche (lissage non planaire).' },
      { name: 'potpourri3d', flag: '🇺🇸', by: 'Nicholas Sharp', license: 'MIT', use: 'Géodésiques sur surface dans la recherche (lissage non planaire).' },
      { name: 'Matplotlib', flag: '🇺🇸', by: 'John D. Hunter, Michael Droettboom et l’équipe de développement de Matplotlib', license: 'Licence Matplotlib', licenseNote: 'type PSF', use: 'Animations d’ordre des couches et graphiques de contrôle.' },
      { name: 'Pillow', flag: '🇺🇸', by: 'Jeffrey A. Clark et les contributeurs', license: 'MIT-CMU', use: 'Écriture des GIF de contrôle.' },
      { name: 'pytest', flag: '🇩🇪', by: 'Holger Krekel et l’équipe pytest', license: 'MIT', use: 'Suite de tests du moteur.' },
      { name: 'CMake et Ninja', flag: '🇺🇸', by: 'Kitware et les contributeurs ; Evan Martin et les contributeurs', license: 'BSD-3-Clause / Apache 2.0', licenseNote: 'CMake : BSD-3-Clause (paquet PyPI sous Apache 2.0) ; Ninja : Apache 2.0', use: 'Construction du noyau natif.' },
    ],
  },
];

/** Note de licence d'ensemble, affichée en fin de panneau. */
export const CREDITS_NOTE =
  'TetGen et PyMeshFix sont sous AGPL-3.0, et S4 Slicer sous GPL-3.0. C’est compatible avec la décision prise pour le projet : logiciel gratuit et open source, seule l’imprimante est vendue. La clause réseau de l’AGPL est sans effet pour une application de bureau.';
