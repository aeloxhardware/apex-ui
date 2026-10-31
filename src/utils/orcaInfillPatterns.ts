// Motifs de remplissage creux d'OrcaSlicer (« Sparse infill pattern »), dans l'ordre de l'option `sparse_infill_pattern`
// de `src/libslic3r/PrintConfig.cpp` (https://github.com/OrcaSlicer/OrcaSlicer, AGPL-3.0). Seules la liste des clés et
// leur ordre viennent d'Orca ; les libellés sont traduits ici et les icônes sont dessinées pour Apex
// (`components/InfillPatternIcon.tsx`). Crédit : `utils/credits.ts`.
//
// Le moteur d'Apex ne réalise que quatre motifs (`toolpath2d.infill_pattern`, voir `engineSettings.ts`). Tous les autres
// restent proposés mais grisés, « Arrive bientôt », tant que le moteur ne les publie pas.

export interface OrcaInfillPattern {
  /** Clé de l'option Orca (`sparse_infill_pattern`). */
  key: string;
  label: string;
}

export const ORCA_INFILL_PATTERNS: OrcaInfillPattern[] = [
  { key: 'rectilinear', label: 'Rectilinéaire' },
  { key: 'alignedrectilinear', label: 'Rectilinéaire aligné' },
  { key: 'zigzag', label: 'Zigzag' },
  { key: 'crosszag', label: 'Cross Zag' },
  { key: 'lockedzag', label: 'Locked Zag' },
  { key: 'line', label: 'Ligne' },
  { key: 'grid', label: 'Grille' },
  { key: 'triangles', label: 'Triangles' },
  { key: 'tri-hexagon', label: 'Tri-hexagone' },
  { key: 'cubic', label: 'Cubique' },
  { key: 'adaptivecubic', label: 'Cubique adaptatif' },
  { key: 'quartercubic', label: 'Cubique quart' },
  { key: 'supportcubic', label: 'Cubique de support' },
  { key: 'lightning', label: 'Éclair' },
  { key: 'honeycomb', label: 'Nid d’abeille' },
  { key: '3dhoneycomb', label: 'Nid d’abeille 3D' },
  { key: 'lateral-honeycomb', label: 'Nid d’abeille latéral' },
  { key: 'lateral-lattice', label: 'Treillis latéral' },
  { key: 'crosshatch', label: 'Hachures croisées' },
  { key: 'tpmsd', label: 'TPMS-D' },
  { key: 'tpmsfk', label: 'TPMS-FK' },
  { key: 'gyroid', label: 'Gyroïde' },
  { key: 'concentric', label: 'Concentrique' },
  { key: 'hilbertcurve', label: 'Courbe de Hilbert' },
  { key: 'archimedeanchords', label: 'Cordes d’Archimède' },
  { key: 'octagramspiral', label: 'Spirale octogramme' },
];

/** Motif d'Orca dont le dessin sert d'icône à chaque motif du moteur. */
export const ENGINE_PATTERN_ICON: Record<string, string> = {
  lines: 'rectilinear',
  grid: 'grid',
  crossed_zigzag: 'zigzag',
  oscillating_spiral: 'archimedeanchords',
};

/** Motifs d'Orca sans équivalent dans le moteur : proposés, grisés. « Grille » existe côté moteur (même dessin). */
export const ORCA_ONLY_PATTERNS = ORCA_INFILL_PATTERNS.filter((p) => p.key !== 'grid');
