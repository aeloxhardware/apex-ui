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
        by: 'Charles Yin',
        license: 'MIT',
        use: 'Shaders de réfraction, de dispersion et de reflet du nœud d’édition et des panneaux de verre.',
      },
      {
        name: 'GLSL-Color-Functions',
        by: 'Rachmanin0xFF',
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
      { name: 'Vite', by: 'Evan You et les contributeurs de Vite', license: 'MIT', use: 'Compilation et serveur de développement.' },
      { name: 'Framer Motion', flag: '🇳🇱', by: 'Framer', license: 'MIT', use: 'Animations des panneaux.' },
    ],
  },
  {
    title: 'Composants d’interface',
    entries: [
      { name: 'shadcn/ui', by: 'shadcn', license: 'MIT', use: 'Base des composants.' },
      { name: 'Radix UI', flag: '🇺🇸', by: 'WorkOS', license: 'MIT', use: 'Primitives accessibles.' },
      { name: 'Tailwind CSS', flag: '🇺🇸', by: 'Tailwind Labs', license: 'MIT', use: 'Mise en page.' },
      { name: 'Lucide', flag: '🌍', by: 'Les contributeurs de Lucide', license: 'ISC', use: 'Icônes.' },
      { name: 'Tabler Icons', flag: '🇵🇱', by: 'Paweł Kuna', license: 'MIT', use: 'Icônes.' },
      { name: 'Recharts', flag: '🌍', by: 'Les contributeurs de Recharts', license: 'MIT', use: 'Graphiques.' },
      { name: 'Sonner', by: 'Emil Kowalski', license: 'MIT', use: 'Notifications.' },
    ],
  },
  {
    title: 'Polices',
    entries: [
      { name: 'Orbitron', flag: '🇺🇸', by: 'Matt McInerney', license: 'SIL Open Font License 1.1', use: 'Police principale.' },
      { name: 'Oxanium', by: 'Severin Meyer', license: 'SIL Open Font License 1.1', use: 'Police d’interface.' },
      { name: 'Russo One', flag: '🇷🇺', by: 'Jovanny Lemonad', license: 'SIL Open Font License 1.1', use: 'Police d’affichage.' },
      { name: 'Ethnocentric', flag: '🇨🇦', by: 'Typodermic Fonts', license: 'Licence Typodermic', use: 'Police des titres.' },
    ],
  },
  {
    title: 'Moteur · Tranchage non planaire',
    entries: [
      {
        name: 'S4 Slicer (méthode « Bird »)',
        by: 'Joshua Bird',
        license: 'GPL-3.0',
        use: 'Méthode de tranchage non planaire par déformation (tranchage à plat dans l’espace déformé, puis retour dans la pièce). Elle sert à la voie de recherche qui a produit les pièces du salon, et doit être intégrée au cœur C++.',
        url: 'https://github.com/jyjblrd/S4_Slicer',
        citation: 'Bird, J. S4 Slicer — Generic Non-Planar Slicer [logiciel]. https://github.com/jyjblrd/S4_Slicer. Licence GPL-3.0.',
        obligation: 'Tout code dérivé de S4 Slicer garde la notice GPL-3.0 et l’attribution à l’auteur.',
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
      { name: 'Clipper2', by: 'Angus Johnson', license: 'Boost Software License 1.0', use: 'Décalages de polygones (parois et remplissage) dans le noyau natif.' },
      { name: 'pybind11', by: 'Wenzel Jakob et les contributeurs', license: 'BSD-3-Clause', use: 'Liaison entre le noyau C++ et Python.' },
    ],
  },
  {
    title: 'Moteur · Recherche, visualisation et développement',
    subtitle: 'Hors de l’application livrée.',
    entries: [
      { name: 'libigl', by: 'Alec Jacobson, Daniele Panozzo et les contributeurs', license: 'MPL-2.0', use: 'Chemins sur surface dans la recherche (lissage non planaire).' },
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
