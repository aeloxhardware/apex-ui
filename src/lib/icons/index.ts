/**
 * Jeu d'icônes d'Apex, dessiné pour le logiciel (charte : `docs/CHARTE_ICONES.md`). Seule source d'icônes de
 * l'interface : aucune bibliothèque d'icônes tierce. Une icône manquante s'ajoute dans `glyphs.ts`, puis ici.
 */
import { createApexIcon } from './ApexIcon';

export type { ApexIconComponent } from './ApexIcon';

// Navigation et commandes élémentaires
export const X = createApexIcon('x');
export const Check = createApexIcon('check');
export const ChevronRight = createApexIcon('chevron-right');
export const ChevronLeft = createApexIcon('chevron-left');
export const ChevronDown = createApexIcon('chevron-down');
export const ChevronUp = createApexIcon('chevron-up');
export const ArrowLeft = createApexIcon('arrow-left');
export const ArrowRight = createApexIcon('arrow-right');
export const Plus = createApexIcon('plus');
export const Minus = createApexIcon('minus');
export const MoreHorizontal = createApexIcon('more-horizontal');
export const GripVertical = createApexIcon('grip-vertical');
export const Dot = createApexIcon('dot');
export const CircleSolid = createApexIcon('circle-solid');
export const PanelLeft = createApexIcon('panel-left');
export const Search = createApexIcon('search');
export const ScanSearch = createApexIcon('scan-search');
export const Maximize2 = createApexIcon('maximize');

// États et lecture
export const CircleCheck = createApexIcon('circle-check');
export const CircleX = createApexIcon('circle-x');
export const TriangleAlert = createApexIcon('triangle-alert');
export const Info = createApexIcon('info');
export const Loader2 = createApexIcon('loader');
export const Play = createApexIcon('play');
export const Pause = createApexIcon('pause');
export const Volume2 = createApexIcon('volume-on');
export const VolumeX = createApexIcon('volume-off');
export const Eye = createApexIcon('eye');
export const EyeOff = createApexIcon('eye-off');
export const Lock = createApexIcon('lock');
export const LockOpen = createApexIcon('lock-open');
export const User = createApexIcon('user');

// Fichiers et édition
export const Save = createApexIcon('save');
export const Download = createApexIcon('download');
export const Upload = createApexIcon('upload');
export const FolderOpen = createApexIcon('folder');
export const Trash2 = createApexIcon('trash');
export const Copy = createApexIcon('copy');
export const ClipboardPaste = createApexIcon('clipboard-paste');
export const Undo2 = createApexIcon('undo');
export const Redo2 = createApexIcon('redo');
export const RotateCcw = createApexIcon('rotate-ccw');
export const RotateCw = createApexIcon('rotate-cw');
export const Pencil = createApexIcon('pencil');
export const PenLine = createApexIcon('pen-line');
export const Palette = createApexIcon('palette');

// Espaces de travail
export const SpacePrepare = createApexIcon('space-prepare');
export const SpacePreview = createApexIcon('space-preview');
export const SpaceModel = createApexIcon('space-model');
export const SpaceDev = createApexIcon('space-dev');
export const SpaceSettings = createApexIcon('space-settings');

// Tracé : onglets de Prévisualisation et catégories du moteur
export const NodeEdit = createApexIcon('node-edit');
export const FunctionF = createApexIcon('function');
export const LayerSmoothing = createApexIcon('layer-smoothing');
export const HeadTilt = createApexIcon('head-tilt');
export const Collision = createApexIcon('collision');
export const Travel = createApexIcon('travel');

// Réglages et moteur
export const Settings2 = createApexIcon('sliders');
export const Route = createApexIcon('route');
export const Crosshair = createApexIcon('crosshair');
export const Printer = createApexIcon('printer');

// Modèles, plateau et sélection
export const Box = createApexIcon('box');
export const CubePlus = createApexIcon('cube-plus');
export const BoxSelect = createApexIcon('select-all');
export const LayoutGrid = createApexIcon('layout-grid');
export const Arrange = createApexIcon('arrange');
export const Cut = createApexIcon('cut');
export const MousePointer2 = createApexIcon('pointer');
export const MousePointerSquareDashed = createApexIcon('pointer-select');
export const AxesAbsolute = createApexIcon('axes-absolute');
export const AxesRelative = createApexIcon('axes-relative');
export const FilterPlus = createApexIcon('filter-plus');
export const FilterCheck = createApexIcon('filter-check');
export const FilterX = createApexIcon('filter-x');
export const Bricks = createApexIcon('bricks');

// Esquisse et modélisation
export const Circle = createApexIcon('circle');
export const Square = createApexIcon('square');
export const Triangle = createApexIcon('triangle');
export const Waves = createApexIcon('waves');
export const FlipHorizontal2 = createApexIcon('mirror');
export const OrbitView = createApexIcon('orbit-view');
export const Home = createApexIcon('home');
