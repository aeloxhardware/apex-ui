import type { EditFalloff } from '@/utils/editKernelClient';
import {
  DEFAULT_EDIT_INFLUENCE, DEFAULT_EDIT_SYMMETRY, DEFAULT_LOCK_RADIUS_MM, DEFAULT_MACHINE_LIMITS,
  type EditReachMode, type EditStateDetail, type EditSymmetryMode,
} from './editProtocol';
import { DEFAULT_LAYER_LIMITS } from '@/utils/layerLimits';
import type { GlassSelectOption } from './GlassSelect';

export const FALLOFFS: GlassSelectOption<EditFalloff>[] = [
  {
    value: 'cubic',
    label: 'Cubique',
    tip: 'Les points proches du nœud le suivent presque entièrement, puis l’effet baisse au milieu et s’éteint en douceur au bord de la portée. Donne une bosse arrondie, sans cassure. Le bon choix par défaut.',
  },
  {
    value: 'gaussian',
    label: 'Gaussienne',
    tip: 'L’effet baisse dès qu’on s’éloigne du nœud, en forme de cloche. La déformation se concentre autour du nœud : bosse plus pointue.',
  },
  {
    value: 'linear',
    label: 'Linéaire',
    tip: 'L’effet baisse régulièrement, en ligne droite, du nœud jusqu’au bord de la portée. Simple à prévoir, mais laisse un angle visible au nœud et au bord.',
  },
  {
    value: 'plateau',
    label: 'Plateau',
    tip: 'Tout ce qui est à moins de la moitié de la portée bouge d’un bloc avec le nœud, puis l’effet s’éteint en douceur. Pour déplacer une zone entière sans la déformer.',
  },
];

export const EXTRUSION_CHOICES: GlassSelectOption<'off' | 'auto' | 'manual'>[] = [
  {
    value: 'off',
    label: 'Désactivée (E d’origine)',
    tip: 'La quantité de filament déposée reste celle du fichier, même si la déformation allonge les trajectoires ou épaissit les couches. Risque de manque ou d’excès de matière.',
  },
  {
    value: 'auto',
    label: 'Automatique',
    tip: 'La quantité de filament est recalculée pour chaque segment déformé, selon sa nouvelle longueur et la nouvelle épaisseur de sa couche : la matière déposée reste juste.',
  },
  {
    value: 'manual',
    label: 'Automatique + facteur',
    tip: 'Comme Automatique, mais la correction est multipliée par un facteur que vous réglez : 1 = automatique, 0 = filament d’origine, plus de 1 = correction renforcée.',
  },
];

export const REACH_MODE_CHOICES: GlassSelectOption<EditReachMode>[] = [
  {
    value: 'reach',
    label: 'Portée',
    tip: 'L’influence reste dans la portée fixée par les poignées. Quand les couches de cette zone ne peuvent plus absorber le déplacement (épaisseur minimale ou maximale atteinte), le nœud freine et s’arrête.',
  },
  {
    value: 'auto',
    label: 'Auto',
    tip: 'La portée des poignées n’est qu’un point de départ : quand elle ne suffit pas, l’influence s’élargit autant qu’il faut, jusqu’à tout l’objet, pour que le nœud atteigne la trajectoire voulue. Le nœud ne freine que si tout l’objet ne peut plus absorber le déplacement.',
  },
];

export const COMBINE_CHOICES: GlassSelectOption<'product' | 'max'>[] = [
  {
    value: 'product',
    label: 'Produit (intersection)',
    tip: 'Un point n’est déformé que s’il est atteint par TOUS les critères cochés (distance, le long du cordon, trajectoires adjacentes). Chaque critère restreint la zone.',
  },
  {
    value: 'max',
    label: 'Maximum (union)',
    tip: 'Un point est déformé dès qu’UN des critères cochés l’atteint, avec l’effet le plus fort des critères. Chaque critère agrandit la zone.',
  },
];

export const SYMMETRY_CHOICES: GlassSelectOption<EditSymmetryMode>[] = [
  {
    value: 'none',
    label: 'Aucune',
    tip: 'La déformation ne s’applique qu’au nœud.',
  },
  {
    value: 'cyclic',
    label: 'Cyclique',
    tip: 'La déformation validée est répétée autour de l’axe du plateau, tous les 360° / N : à chaque copie, le nœud, ses poignées et le déplacement tournent d’autant. Une copie sans trajectoire à moins de 1,5 mm est ignorée.',
  },
  {
    value: 'mirror',
    label: 'Miroir',
    tip: 'La déformation validée est répétée de l’autre côté d’un plan vertical qui contient l’axe du plateau (angle C choisi) : positions et déplacements sont réfléchis.',
  },
];

export const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const initialState: EditStateDetail = {
  status: 'inactive', message: null, placing: false, hasNode: false, busy: false,
  undoDepth: 0, redoDepth: 0, affected: 0, delta: null, influence: DEFAULT_EDIT_INFLUENCE,
  nodeTrimming: null, trimmed: 0, thickness: null, validation: null,
  locks: 0, lockMode: null, lockRadiusMm: DEFAULT_LOCK_RADIUS_MM, canPaste: false,
  symmetry: DEFAULT_EDIT_SYMMETRY, limits: DEFAULT_MACHINE_LIMITS, headModel: false,
  layerLimits: DEFAULT_LAYER_LIMITS, capacityMm: null, requestedAxialMm: null,
  reslicePoints: 0, resliceMaxCount: 0,
};

export const DELTA_TIPS: Record<string, string> = {
  'ΔR': 'Écart du rayon du point du nœud (mm). Saisir une valeur puis Entrée : le point est déplacé exactement de ce déplacement et validé ; Tab : aperçu seulement.',
  'ΔC': 'Écart de l’angle du plateau du point du nœud (°). Saisir puis Entrée pour valider.',
  'ΔZ': 'Écart de hauteur du point du nœud (mm). Saisir puis Entrée pour valider.',
  'ΔB': 'Écart d’inclinaison de la tête au point du nœud (°). Saisi seul : la tête s’incline autour de la pointe (la pointe reste en place, R et Z s’ajustent) et les points voisins tournent avec elle. Saisi avec ΔR ou ΔZ : valeurs firmware littérales (B décrit un arc autour du pivot de 46 mm). Entrée pour valider.',
};

export const STATUS_TEXT: Record<EditStateDetail['status'], string> = {
  inactive: 'Aucun G-code affiché.',
  unavailable: "Disponible dans l'application de bureau.",
  unsupported: "Réservé aux G-code polaires de l'Apex.",
  loading: 'Préparation du noyau d’édition…',
  ready: '',
  error: 'Noyau d’édition indisponible.',
};
