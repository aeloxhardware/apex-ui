/**
 * Géométrie partagée des morphings "verre liquide" entre la pilule/les panneaux de
 * Prévisualisation (CategoriesSidebar) et le panneau Modélisation (ModelingSidebar) — en px, dans
 * le repère de la pilule (fixed, left 24 / top 212). Doit rester alignée sur
 * CategoriesSidebar.module.scss (.leftSidebarContainer, .categoriesToolbar,
 * .previewPanelUpper/.previewPanelLower) et ModelingSidebar.module.scss (.container / .panel).
 */
import { stretchPath, type GlassRect } from './liquidGlass';

export const PANEL_LEFT = 24;
export const PILL_TOP = 212;
export const PILL: GlassRect = { x: 0, y: 0, w: 293, h: 56, r: 20 };

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
export const PREVIEW_R = 20;
export const PREVIEW_GAP = 16;
export const PREVIEW_LOWER_H = 250;
export const PREVIEW_BOTTOM_MARGIN = 236;
export const PREVIEW_UPPER_MIN_H = 120;

export const previewGeometry = (viewportH: number) => {
  const upperH = Math.max(
    PREVIEW_UPPER_MIN_H,
    viewportH - PREVIEW_BOTTOM_MARGIN - PREVIEW_LOWER_H - PREVIEW_GAP - PILL_TOP,
  );
  const upper: GlassRect = { x: 0, y: 0, w: PREVIEW_W, h: upperH, r: PREVIEW_R };
  const lower: GlassRect = { x: 0, y: upperH + PREVIEW_GAP, w: PREVIEW_W, h: PREVIEW_LOWER_H, r: PREVIEW_R };
  // + marge pour le col qui s'étire avant la rupture.
  return { upper, lower, stageH: lower.y + lower.h + 40 };
};

// Panneau de Modélisation (ModelingSidebar.module.scss : .container top 96 / left 24 / bottom 96,
// .panel width 268 / border-radius 18, mêmes background/backdrop-filter/box-shadow que le verre
// animé — la bascule finale doit donc être invisible). Repère relatif à PILL_TOP (212) : le
// panneau commence 116px plus haut que la pilule.
export const MODELING_W = 268;
export const MODELING_R = 18;
export const MODELING_TOP = 96;
export const MODELING_Y = MODELING_TOP - PILL_TOP;
export const MODELING_BOTTOM_MARGIN = 96;
// Hauteur fixe du panneau, plafonnée par la place disponible entre MODELING_TOP et
// MODELING_BOTTOM_MARGIN sur les petits écrans. Doit rester alignée sur `.container` dans
// ModelingSidebar.module.scss (height / max-height).
export const MODELING_H = 712;

// Durée des fondus-glissements des éléments qui n'ont pas leur place dans l'espace d'arrivée
// (ModelStatusBox, panneau du bas de Prévisualisation, icônes de la pilule, contenu du panneau
// Modélisation). Ils sont déclenchés DÈS LE CLIC (apex-entering-modeling / apex-leaving-modeling),
// ~900ms avant que le rideau ne soit refermé et que la déformation ne commence (`onCovered`) : ils
// ont donc largement fini quand la forme commence à bouger, sans temps mort dans le morph lui-même.
export const ELEMENTS_FADE_MS = 260;
export const FROM_PREVIEW_FADE_MS = ELEMENTS_FADE_MS;

// Durée de la déformation seule : depuis/vers la pilule (Préparation), ou depuis/vers le panneau du
// haut de Prévisualisation (fromPreview — le panneau du bas n'en fait jamais partie, il disparaît
// séparément, sans jamais fusionner avec celui du haut).
export const MODELING_MORPH_MS = 550;
export const MODELING_MORPH_FROM_PREVIEW_MS = 480;

export const modelingGeometry = (viewportH: number): GlassRect => ({
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
  const from = fromPreview ? previewGeometry(viewportH).upper : PILL;
  return stretchPath(from, modelingGeometry(viewportH), t, dx, dy);
};

/** Stage englobant la géométrie de départ ET celle d'arrivée du morph Modélisation. */
export const modelingMorphStage = (viewportH: number) => {
  const target = modelingGeometry(viewportH);
  const previewGeo = previewGeometry(viewportH);
  const top0 = Math.min(0, target.y) - 20;
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
