import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { DEFAULT_GLASS, LiquidGlassRenderer, type GlassLens } from './liquidGlass';
import { newGlassLive, reactiveGlassParams, type GlassLive } from './glassReaction';

/** Portée de fusion entre le verre et son renflement sous le pointeur, px CSS : large, donc diffus. */
const BULGE_MERGE_PX = 30;
import { isFlatUi } from '@/utils/interfaceMode';
import { drawVeilTiles, veilNow, veilState } from '@/utils/veilTimeline';

/** Couleur de fond réelle derrière le canevas 3D : premier ancêtre au fond non transparent. */
function pageBackground(from: HTMLElement): string {
  for (let el: HTMLElement | null = from.parentElement; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#33373f';
}

/**
 * Rideau de changement d'espace (SpaceTransitionOverlay) : il est en DOM, que le verre WebGL ne peut
 * pas réfracter, alors que les panneaux (z-index ≥ 999) restent au-dessus de lui. Sans cela, le verre
 * montrerait la scène 3D cachée derrière le voile gris. Redessine donc dans `ctx` (repère du canevas
 * 3D, `s` = son rectangle écran) le flou puis chaque tuile, à son opacité du moment, avec le même
 * dégradé que `.tile` (SpaceTransitionOverlay.module.scss). `blurPx` : flou à appliquer à la scène
 * AVANT d'appeler `drawScene`.
 */
function veilBlurPx(): number {
  const el = document.querySelector<HTMLElement>('[data-veil-blur]');
  if (!el) return 0;
  const m = /blur\(([\d.]+)px\)/.exec(getComputedStyle(el).backdropFilter || '');
  return m ? parseFloat(m[1]) : 0;
}

function paintSpaceVeilTiles(ctx: CanvasRenderingContext2D, s: DOMRect, dpr: number) {
  const clock = veilState.clock;
  if (!clock) return;
  // Même dessin que le Worker du voile (veilTimeline.ts), à l'instant courant.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, -s.left * dpr, -s.top * dpr);
  drawVeilTiles(ctx, window.innerWidth, window.innerHeight, dpr, clock, veilNow());
  ctx.restore();
}

/** Événement posé par Viewport3D juste après chaque rendu de la scène : le verre se dessine alors
 * dans la MÊME image, sans retard d'une image sur la scène qu'il réfracte. */
const SCENE_RENDERED_EVENT = 'apex-scene-rendered';
/**
 * Le calque épouse le canevas 3D : même repère que la texture réfractée. `position: fixed` se repère
 * sur la zone de l'interface (bandeau ancré au-dessus, cf. GpuWarningFrame), pas sur la fenêtre.
 */
function placeOverlay(canvas: HTMLCanvasElement, s: DOMRect, portalRoot: HTMLElement) {
  const origin = portalRoot === document.body ? null : portalRoot.getBoundingClientRect();
  canvas.style.left = `${s.left - (origin?.left ?? 0)}px`;
  canvas.style.top = `${s.top - (origin?.top ?? 0)}px`;
  canvas.style.width = `${s.width}px`;
  canvas.style.height = `${s.height}px`;
}

/**
 * La scène est transparente (fond de page en CSS derrière) : on la pose sur ce fond, sinon le verre
 * réfracterait du noir ; rideau de changement d'espace : flou de la scène puis tuiles par-dessus.
 */
function paintFlatBackground(flat: HTMLCanvasElement, scene: HTMLCanvasElement, s: DOMRect, dpr: number) {
  if (flat.width !== scene.width || flat.height !== scene.height) {
    flat.width = scene.width;
    flat.height = scene.height;
  }
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = pageBackground(scene);
  ctx.fillRect(0, 0, flat.width, flat.height);
  const blur = veilBlurPx();
  if (blur > 0.1) ctx.filter = `blur(${blur * dpr}px)`;
  ctx.drawImage(scene, 0, 0);
  ctx.filter = 'none';
  paintSpaceVeilTiles(ctx, s, dpr);
}

/**
 * Sans scène 3D (espace Accueil, fond statique) aucun rendu ne nous réveille : on suit le panneau
 * (animation d'entrée, redimensionnement) et on ne redessine que s'il a changé. Renvoie l'arrêt.
 */
function watchPanelWithoutScene(
  targetRef: React.RefObject<HTMLElement | null>,
  frame: () => void,
  liveRef?: React.RefObject<GlassLive>,
): () => void {
  let sig = '';
  let settle = 0;
  const watch = () => {
    raf = requestAnimationFrame(watch);
    if (document.getElementById('babylon-canvas')) return;
    const el = targetRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = `${r.left}|${r.top}|${r.width}|${r.height}|${getComputedStyle(el).opacity}|${liveRef?.current.tick ?? 0}`;
    if (next !== sig) { sig = next; settle = 30; }
    // Fond animé (relief topographique de l'Accueil) : le verre en réfracte une copie, à rafraîchir
    // à chaque image sinon il montre un fond périmé dès que le panneau cesse de bouger.
    if (settle > 0 || document.getElementById('home-background') || document.getElementById('topo-background')) { settle = Math.max(0, settle - 1); frame(); }
  };
  let raf = requestAnimationFrame(watch);
  return () => cancelAnimationFrame(raf);
}

/**
 * Verre « Liquid Glass » (celui du nœud d'édition) sous un panneau rectangulaire : le panneau lui-même
 * reste en DOM transparent (contenu), ce calque WebGL dessine dessous la réfraction de la scène 3D
 * (`#babylon-canvas`), l'ombre et les reflets de bord, à la position et à la taille réelles du
 * panneau (lues à chaque image : le panneau s'anime, se déplie, apparaît en fondu).
 */
export function GlassPanelBackdrop({
  targetRef,
  corner = 22,
  enabled = true,
  warp = 1,
  blurPx = 1.5,
  whiteRim = false,
  distortion = 1,
  dispersion = DEFAULT_GLASS.dispersion,
  liveRef,
}: {
  /** État vivant du verre (réaction au pointeur, cf. useGlassReaction), lu à chaque image ; absent : verre statique. */
  liveRef?: React.RefObject<GlassLive>;
  targetRef: React.RefObject<HTMLElement | null>;
  corner?: number;
  enabled?: boolean;
  /** Intensité du warping de bord : 1 = réglage par défaut (largeur de la bande réfractée 30 px, déplacement ~16 px). */
  warp?: number;
  /** Flou du fond vu à travers le verre, px CSS (écart type). */
  blurPx?: number;
  /** Liseré blanc de bord (Fresnel + reflet) ; sinon un relief par ombrage du bord, sans blanc. */
  whiteRim?: boolean;
  /** Multiplie le déplacement du fond au bord (réfraction) : 1 = réglage par défaut. */
  distortion?: number;
  /** Séparation des couleurs au bord (franges colorées) ; 0 = distorsion de forme seule. */
  dispersion?: number;
}) {
  const portalRoot = usePortalRoot();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Interface à plat : aucun verre WebGL (les panneaux sont opaques, cf. FlatUi.tsx).
    if (!canvas || !enabled || isFlatUi()) return;
    let renderer: LiquidGlassRenderer;
    try {
      renderer = new LiquidGlassRenderer(canvas, true);
    } catch (error) {
      console.warn('Verre du panneau indisponible :', error);
      // Repli CSS (cf. [data-glass-fallback] dans le scss du panneau).
      targetRef.current?.setAttribute('data-glass-fallback', '1');
      return;
    }
    let shown = false;
    const frame = () => {
      // Shaders encore en compilation : on n'a rien à dessiner (ni fond aplati ni flou, coûteux).
      if (!renderer.ready()) {
        if (renderer.failed) targetRef.current?.setAttribute('data-glass-fallback', '1');
        return;
      }
      const el = targetRef.current;
      const scene = (document.getElementById('babylon-canvas') ?? document.getElementById('home-background') ?? document.getElementById('topo-background')) as HTMLCanvasElement | null;
      if (!el || !scene || scene.width === 0) {
        if (shown) { renderer.clear(); shown = false; }
        return;
      }
      const r = el.getBoundingClientRect();
      const s = scene.getBoundingClientRect();
      const strength = Number(getComputedStyle(el).opacity);
      if (r.width < 2 || r.height < 2 || !(strength > 0.001)) {
        if (shown) { renderer.clear(); shown = false; }
        return;
      }
      placeOverlay(canvas, s, portalRoot);
      renderer.resize(scene.width, scene.height);
      const flat = (flatRef.current ??= document.createElement('canvas'));
      const dpr = scene.width / Math.max(1, s.width);
      paintFlatBackground(flat, scene, s, dpr);
      renderer.setBackground(flat);
      // Réaction au pointeur (useGlassReaction) : le verre déborde et réfracte davantage ; au repos, rien ne change.
      const lv = liveRef?.current ?? newGlassLive();
      // Glissement d'ensemble vers le pointeur (dx, dy) : le centre avance de (dx, dy), les demi-côtés grandissent de
      // la moitié, donc le bord côté pointeur avance de 1,5 × et l'autre de 0,5 × seulement.
      const halfW = r.width / 2 + lv.grow + Math.abs(lv.dx) / 2;
      const halfH = r.height / 2 + lv.grow + Math.abs(lv.dy) / 2;
      const cx = r.left - s.left + r.width / 2;
      const cy = r.top - s.top + r.height / 2;
      const lenses: GlassLens[] = [{
        x: cx + lv.dx,
        y: cy + lv.dy,
        radius: 30 * warp * lv.warp,
        strength,
        mergePx: BULGE_MERGE_PX,
        box: { halfW, halfH, corner: Math.min(corner + lv.grow, halfH) },
      }];
      // Renflement diffus sous le pointeur : petite lentille séparée, faible et largement fondue dans le verre.
      // Même rayon que le verre (le shader prend épaisseur et réfraction de la lentille dominante : deux rayons
      // différents font une couture là où la dominante change) et centre borné pour ne jamais dépasser du contour.
      if (lv.es > 0.005) {
        const R = 30 * warp * lv.warp;
        const bx = Math.max(0, halfW - R);
        const by = Math.max(0, halfH - R);
        lenses.push({
          x: cx + Math.max(-bx, Math.min(bx, lv.ex)),
          y: cy + Math.max(-by, Math.min(by, lv.ey)),
          radius: R,
          strength: lv.es * strength,
          mergePx: BULGE_MERGE_PX,
        });
      }
      renderer.render(lenses, dpr, reactiveGlassParams(
        whiteRim
          ? { ...DEFAULT_GLASS, blurPx, dispersion }
          : { ...DEFAULT_GLASS, blurPx, dispersion, fresnelFactor: 0, glareFactor: 0, edgeShade: 1 },
        lv, distortion, whiteRim,
      ));
      shown = true;
    };
    window.addEventListener(SCENE_RENDERED_EVENT, frame);
    const stopWatching = watchPanelWithoutScene(targetRef, frame, liveRef);
    return () => {
      stopWatching();
      window.removeEventListener(SCENE_RENDERED_EVENT, frame);
    };
  }, [targetRef, corner, enabled, warp, blurPx, whiteRim, distortion, dispersion, portalRoot, liveRef]);

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', pointerEvents: 'none', zIndex: 999 }}
    />,
    portalRoot,
  );
}
