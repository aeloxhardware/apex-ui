/**
 * Géométrie partagée des morphings "verre liquide" entre la pilule/les panneaux de
 * Prévisualisation (CategoriesSidebar) et le panneau Modélisation (ModelingSidebar) — en px, dans
 * le repère de la pilule (fixed, left 12 / top 212). Doit rester alignée sur
 * CategoriesSidebar.module.scss (.leftSidebarContainer, .categoriesToolbar,
 * .previewPanelUpper/.previewPanelLower) et ModelingSidebar.module.scss (.container / .panel).
 */
import { mitosisPath, rectPath, stretchPath, type GlassRect } from './liquidGlass';

export const PANEL_LEFT = 12;
export const PILL_TOP = 212;
export const PILL: GlassRect = { x: 0, y: 0, w: 293, h: 42, r: 18 };

// Haut fixe de l'arborescence des modèles (ModelStatusBox.module.scss, .container) et marge
// minimale à toujours conserver entre son bord bas réel et la pilule ci-dessous — jamais recouverte
// ni collée, y compris quand l'arborescence grandit (dépliage d'un modèle). PILL_TOP (212) est déjà
// exactement `MODEL_TREE_TOP + hauteur mini du panneau (120) + MODEL_TREE_PILL_GAP (12)` : la pilule
// ne bouge donc que lorsque l'arborescence dépasse effectivement sa hauteur mini (cf.
// apex-model-tree-resized dans ModelStatusBox.tsx).
export const MODEL_TREE_TOP = 80;
export const MODEL_TREE_PILL_GAP = 12;

// Prévisualisation : panneau du haut sur toute la hauteur disponible, panneau du bas de hauteur
// fixe, le tout s'arrêtant à 236px du bas de l'écran (au-dessus de la barre d'aide).
export const PREVIEW_W = 440;
const PREVIEW_R = 20;
const PREVIEW_GAP = 16;
const PREVIEW_LOWER_H = 250;
const PREVIEW_BOTTOM_MARGIN = 236;
const PREVIEW_UPPER_MIN_H = 120;

// Le plus petit des deux panneaux est agrandi de ce facteur (l'autre garde sa hauteur de base).
const PREVIEW_SMALLER_SCALE = 1.3 * 0.85;

export const previewPanelHeights = (viewportH: number) => {
  const baseUpper = Math.max(
    PREVIEW_UPPER_MIN_H,
    viewportH - PREVIEW_BOTTOM_MARGIN - PREVIEW_LOWER_H - PREVIEW_GAP - PILL_TOP,
  );
  const upperIsSmaller = baseUpper <= PREVIEW_LOWER_H;
  const upperH = upperIsSmaller ? baseUpper * PREVIEW_SMALLER_SCALE : baseUpper;
  const lowerH = upperIsSmaller ? PREVIEW_LOWER_H : PREVIEW_LOWER_H * PREVIEW_SMALLER_SCALE;
  // Les panneaux sont remontés de ce que le facteur ajoute : leur bas reste où il était.
  const lift = upperH + lowerH - baseUpper - PREVIEW_LOWER_H;
  return { upperH, lowerH, lift };
};

export const previewGeometry = (viewportH: number) => {
  const { upperH, lowerH, lift } = previewPanelHeights(viewportH);
  const upper: GlassRect = { x: 0, y: -lift, w: PREVIEW_W, h: upperH, r: PREVIEW_R };
  const lower: GlassRect = { x: 0, y: upper.y + upperH + PREVIEW_GAP, w: PREVIEW_W, h: lowerH, r: PREVIEW_R };
  // + marge pour le col qui s'étire avant la rupture.
  return { upper, lower, stageH: lower.y + lower.h + 40 };
};

// --- Onglet Édition : le panneau du bas se fond dans celui du haut, qui s'agrandit -------------------
// Disposition des panneaux selon l'onglet, tenue à jour par CategoriesSidebar : « edition » = le panneau
// du bas a fusionné dans celui du haut (agrandi à leur surface commune). Lue par les morphs de
// Modélisation, qui partent de la forme réelle du panneau du haut.
export const previewTabLayout = { edition: false };

/** Panneau du haut agrandi à la surface des deux panneaux et de l'espace qui les sépare. */
const previewExpandedUpper = (viewportH: number): GlassRect => {
  const { upper, lower } = previewGeometry(viewportH);
  return { ...upper, h: lower.y + lower.h - upper.y };
};

/** Forme réelle du panneau du haut (agrandie en mode Édition). */
const previewUpperRect = (viewportH: number): GlassRect =>
  previewTabLayout.edition ? previewExpandedUpper(viewportH) : previewGeometry(viewportH).upper;

// Cascade de disparition des éléments du panneau du bas (un par un, du haut vers le bas), puis fusion
// (mitosis jouée à l'envers : le panneau du bas remonte se refondre dans celui du haut), puis
// agrandissement du panneau du haut — la même gestuelle que lors des changements d'espace.
export const TAB_CASCADE_STAGGER_MS = 45;
export const TAB_CASCADE_FADE_MS = 220;
const TAB_MERGE_MS = 700;
const TAB_HOLD_MS = 90;
const TAB_EXPAND_MS = 520;
export const TAB_MORPH_MS = TAB_MERGE_MS + TAB_HOLD_MS + TAB_EXPAND_MS;

/**
 * Contour du verre pendant le changement d'onglet, t ∈ [0, 1] : t = 0 les deux panneaux (Coloration),
 * t = 1 le panneau du haut agrandi (Édition). Joué à l'envers (reverse), le panneau du haut se
 * réduit puis enfante celui du bas. Repère : celui du morph de Prévisualisation (départ à upper.y).
 */
export const tabMorphPathAt = (viewportH: number, t: number, dx: number, dy: number) => {
  const { upper, lower } = previewGeometry(viewportH);
  dy -= upper.y;
  const expanded = previewExpandedUpper(viewportH);
  const ms = t * TAB_MORPH_MS;
  if (ms < TAB_MERGE_MS) return mitosisPath(upper, lower, 1 - ms / TAB_MERGE_MS, dx, dy);
  if (ms < TAB_MERGE_MS + TAB_HOLD_MS) return rectPath(upper, dx, dy);
  return stretchPath(upper, expanded, (ms - TAB_MERGE_MS - TAB_HOLD_MS) / TAB_EXPAND_MS, dx, dy);
};

// Panneau de Modélisation (ModelingSidebar.module.scss : .container top 96 / left 12 / bottom 96,
// .panel width 268 / border-radius 18, mêmes background/backdrop-filter/box-shadow que le verre
// animé — la bascule finale doit donc être invisible). Repère relatif à PILL_TOP (212) : le
// panneau commence 116px plus haut que la pilule.
const MODELING_W = 268;
const MODELING_R = 18;
const MODELING_TOP = 96;
const MODELING_Y = MODELING_TOP - PILL_TOP;
const MODELING_BOTTOM_MARGIN = 96;
// Hauteur fixe du panneau, plafonnée par la place disponible entre MODELING_TOP et
// MODELING_BOTTOM_MARGIN sur les petits écrans. Doit rester alignée sur `.container` dans
// ModelingSidebar.module.scss (height / max-height).
const MODELING_H = 712;

// Durée des fondus-glissements des éléments qui n'ont pas leur place dans l'espace d'arrivée
// (ModelStatusBox, panneau du bas de Prévisualisation, icônes de la pilule, contenu du panneau
// Modélisation). Ils sont déclenchés DÈS LE CLIC (apex-entering-modeling / apex-leaving-modeling),
// ~900ms avant que le rideau ne soit refermé et que la déformation ne commence (`onCovered`) : ils
// ont donc largement fini quand la forme commence à bouger, sans temps mort dans le morph lui-même.
export const ELEMENTS_FADE_MS = 260;

// Durée de la déformation seule : depuis/vers la pilule (Préparation), ou depuis/vers le panneau du
// haut de Prévisualisation (fromPreview — le panneau du bas n'en fait jamais partie, il disparaît
// séparément, sans jamais fusionner avec celui du haut).
const MODELING_MORPH_MS = 550;
const MODELING_MORPH_FROM_PREVIEW_MS = 480;

const modelingGeometry = (viewportH: number): GlassRect => ({
  x: 0,
  y: MODELING_Y,
  w: MODELING_W,
  h: Math.min(MODELING_H, viewportH - MODELING_TOP - MODELING_BOTTOM_MARGIN),
  r: MODELING_R,
});

/** Durée totale du morph Modélisation selon l'état de départ/arrivée. */
export const modelingMorphDuration = (fromPreview: boolean) =>
  fromPreview ? MODELING_MORPH_FROM_PREVIEW_MS : MODELING_MORPH_MS;

/**
 * Contour du panneau Modélisation à l'instant t ∈ [0, 1] (fraction de modelingMorphDuration) :
 * t = 0 la pilule (ou le panneau du haut de Prévisualisation si `fromPreview`), t = 1 le panneau
 * Modélisation. `reverse` sur le composant qui consomme ce chemin joue la même timeline en sens
 * inverse (sortie de Modélisation).
 */
export const modelingPathAt = (
  fromPreview: boolean,
  viewportH: number,
  t: number,
  dx: number,
  dy: number,
) => {
  const from = fromPreview ? previewUpperRect(viewportH) : PILL;
  return stretchPath(from, modelingGeometry(viewportH), t, dx, dy);
};

/** Stage englobant la géométrie de départ ET celle d'arrivée du morph Modélisation. */
export const modelingMorphStage = (viewportH: number) => {
  const target = modelingGeometry(viewportH);
  const previewGeo = previewGeometry(viewportH);
  const top0 = Math.min(0, target.y, previewGeo.upper.y) - 20;
  const bottom0 = Math.max(previewGeo.stageH, target.y + target.h) + 20;
  return {
    left: PANEL_LEFT,
    top: PILL_TOP + top0,
    width: Math.max(PREVIEW_W, target.w) + 20,
    height: bottom0 - top0,
    /** Décalage à soustraire à dy pour rester dans le repère de PILL_TOP. */
    dyOffset: top0,
  };
};
