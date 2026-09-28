/**
 * Types de ligne de la prévisualisation G-code (légende, couleurs du tracé, statistiques). Ordre et
 * couleurs repris de la légende « Type de ligne » des slicers de la famille Orca (Bambu, Anycubic
 * Slicer Next, Creality Print), dont viennent la plupart des fichiers à prévisualiser.
 */

export type LineTypeId =
  | 'innerWall'
  | 'outerWall'
  | 'overhangWall'
  | 'sparseInfill'
  | 'internalSolidInfill'
  | 'topSurface'
  | 'bottomSurface'
  | 'bridge'
  | 'internalBridge'
  | 'gapFill'
  | 'custom'
  | 'travel'
  | 'retraction'
  | 'unretraction'
  | 'wipe'
  | 'seam';

/**
 * - `extrusion` : matière déposée (cordon), avec durée, longueur et poids de filament ;
 * - `move` : déplacement sans dépôt (ligne), avec durée seulement ;
 * - `marker` : événement ponctuel (sphère), sans longueur ni poids.
 */
export type LineTypeKind = 'extrusion' | 'move' | 'marker';

export interface LineTypeInfo {
  id: LineTypeId;
  label: string;
  description: string;
  color: string;
  kind: LineTypeKind;
  visibleByDefault: boolean;
}

export const LINE_TYPES: LineTypeInfo[] = [
  { id: 'innerWall', label: 'Paroi intérieure', color: '#FFE64D', kind: 'extrusion', visibleByDefault: true,
    description: 'Périmètres internes, entre la paroi extérieure et le remplissage.' },
  { id: 'outerWall', label: 'Paroi extérieure', color: '#FF7D38', kind: 'extrusion', visibleByDefault: true,
    description: 'Périmètre visible de la pièce, imprimé plus lentement pour la qualité de surface.' },
  { id: 'overhangWall', label: 'Paroi en surplomb', color: '#1F1FFF', kind: 'extrusion', visibleByDefault: true,
    description: 'Portions de paroi imprimées au-dessus du vide, avec une vitesse et un refroidissement adaptés.' },
  { id: 'sparseInfill', label: 'Remplissage', color: '#B03029', kind: 'extrusion', visibleByDefault: true,
    description: "Remplissage partiel de l'intérieur de la pièce, selon le motif et la densité choisis." },
  { id: 'internalSolidInfill', label: 'Remplissage plein interne', color: '#9654CC', kind: 'extrusion', visibleByDefault: true,
    description: 'Couches pleines internes, qui soutiennent les surfaces supérieures.' },
  { id: 'topSurface', label: 'Surface supérieure', color: '#F04040', kind: 'extrusion', visibleByDefault: true,
    description: 'Dernières couches pleines visibles sur le dessus de la pièce.' },
  { id: 'bottomSurface', label: 'Surface inférieure', color: '#6659C7', kind: 'extrusion', visibleByDefault: true,
    description: 'Premières couches pleines, en contact avec le plateau.' },
  { id: 'bridge', label: 'Pont', color: '#4D66A1', kind: 'extrusion', visibleByDefault: true,
    description: 'Lignes tendues dans le vide entre deux appuis, sur une face visible.' },
  { id: 'internalBridge', label: 'Pont interne', color: '#4D80BA', kind: 'extrusion', visibleByDefault: true,
    description: "Ponts tendus au-dessus du remplissage, à l'intérieur de la pièce." },
  { id: 'gapFill', label: 'Espace de remplissage', color: '#FFFFFF', kind: 'extrusion', visibleByDefault: true,
    description: 'Fines lignes qui comblent les interstices trop étroits pour une paroi complète.' },
  { id: 'custom', label: 'Personnalisé', color: '#5ED194', kind: 'extrusion', visibleByDefault: true,
    description: 'G-code personnalisé (purge, début et fin) et extrusions sans type reconnu (jupe, bordure, supports…).' },
  { id: 'travel', label: 'Déplacement', color: '#3A4A9C', kind: 'move', visibleByDefault: false,
    description: 'Trajets à vide de la buse, sans dépôt de matière.' },
  { id: 'retraction', label: 'Rétraction', color: '#CC33CC', kind: 'marker', visibleByDefault: false,
    description: 'Points où le filament est retiré de la buse pour éviter le suintement pendant un déplacement.' },
  { id: 'unretraction', label: 'Annulation de rétraction', color: '#4DB3CC', kind: 'marker', visibleByDefault: false,
    description: "Points où le filament rétracté est réinjecté avant de reprendre l'impression." },
  { id: 'wipe', label: 'Essuyage', color: '#FFFF00', kind: 'move', visibleByDefault: false,
    description: 'Mouvements de la buse sur la pièce pendant la rétraction, pour essuyer la matière en excès.' },
  { id: 'seam', label: 'Coutures', color: '#E6E6E6', kind: 'marker', visibleByDefault: true,
    description: 'Points de départ de chaque boucle de paroi extérieure, où la jointure reste visible.' },
];

export const LINE_TYPE_BY_ID = Object.fromEntries(LINE_TYPES.map((t) => [t.id, t])) as Record<LineTypeId, LineTypeInfo>;

export type LineTypeVisibility = Record<LineTypeId, boolean>;

export const DEFAULT_LINE_VISIBILITY = Object.fromEntries(
  LINE_TYPES.map((t) => [t.id, t.visibleByDefault]),
) as LineTypeVisibility;

/** Minuscules, sans accents ni séparateurs : « Internal Bridge », « WALL-INNER » → « internalbridge », « wallinner ». */
const normalize = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Noms de type émis par les slicers courants : `;TYPE:` d'Orca/Bambu/Anycubic/Creality
// (« Inner wall »), de PrusaSlicer/SuperSlicer (« External perimeter ») et de Cura/ideaMaker
// (« WALL-OUTER ») ; `; feature` de Simplify3D (« outer perimeter »).
const ALIASES: Record<string, LineTypeId> = {
  innerwall: 'innerWall', perimeter: 'innerWall', wallinner: 'innerWall', innerperimeter: 'innerWall', inneredge: 'innerWall',
  outerwall: 'outerWall', externalperimeter: 'outerWall', wallouter: 'outerWall', outerperimeter: 'outerWall', outeredge: 'outerWall',
  overhangwall: 'overhangWall', overhangperimeter: 'overhangWall',
  sparseinfill: 'sparseInfill', internalinfill: 'sparseInfill', fill: 'sparseInfill', infill: 'sparseInfill',
  internalsolidinfill: 'internalSolidInfill', solidinfill: 'internalSolidInfill', solidlayer: 'internalSolidInfill',
  topsurface: 'topSurface', topsolidinfill: 'topSurface', skin: 'topSurface', ironing: 'topSurface',
  bottomsurface: 'bottomSurface', bottomsolidinfill: 'bottomSurface',
  bridge: 'bridge', bridgeinfill: 'bridge', externalbridge: 'bridge',
  internalbridge: 'internalBridge', internalbridgeinfill: 'internalBridge',
  gapinfill: 'gapFill', gapfill: 'gapFill',
  custom: 'custom',
  ...Object.fromEntries(LINE_TYPES.map((t) => [normalize(t.label), t.id])),
};

/** Type de ligne d'un marqueur de slicer ; tout type non reconnu (jupe, bordure, supports, tour de
 * purge…) est rangé dans « Personnalisé ». */
export function resolveLineType(name: string): LineTypeId {
  const id = ALIASES[normalize(name)];
  return id && LINE_TYPE_BY_ID[id].kind === 'extrusion' ? id : 'custom';
}
