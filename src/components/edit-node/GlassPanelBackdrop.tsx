import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { DEFAULT_GLASS, LiquidGlassRenderer } from './liquidGlass';
import { isFlatUi } from '@/utils/interfaceMode';
import { drawVeilTiles, veilNow, veilState } from '@/utils/veilTimeline';

/** Couleur de fond réelle derrière le canevas 3D : premier ancêtre au fond non transparent. */
function pageBackground(from: HTMLElement): string {
  for (let el: HTMLElement | null = from.parentElement; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#2a2d34';
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
export const SCENE_RENDERED_EVENT = 'apex-scene-rendered';

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
}: {
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
      const scene = (document.getElementById('babylon-canvas') ?? document.getElementById('topo-background')) as HTMLCanvasElement | null;
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
      // Le calque épouse le canevas 3D : même repère que la texture réfractée.
      canvas.style.left = `${s.left}px`;
      canvas.style.top = `${s.top}px`;
      canvas.style.width = `${s.width}px`;
      canvas.style.height = `${s.height}px`;
      renderer.resize(scene.width, scene.height);
      // La scène est transparente (fond de page en CSS derrière) : on la pose sur ce fond, sinon le
      // verre réfracterait du noir.
      const flat = (flatRef.current ??= document.createElement('canvas'));
      if (flat.width !== scene.width || flat.height !== scene.height) {
        flat.width = scene.width;
        flat.height = scene.height;
      }
      const ctx = flat.getContext('2d')!;
      const dpr = scene.width / Math.max(1, s.width);
      ctx.fillStyle = pageBackground(scene);
      ctx.fillRect(0, 0, flat.width, flat.height);
      // Rideau de changement d'espace : flou de la scène puis tuiles par-dessus (cf. paintSpaceVeilTiles).
      const blur = veilBlurPx();
      if (blur > 0.1) ctx.filter = `blur(${blur * dpr}px)`;
      ctx.drawImage(scene, 0, 0);
      ctx.filter = 'none';
      paintSpaceVeilTiles(ctx, s, dpr);
      renderer.setBackground(flat);
      renderer.render([{
        x: r.left - s.left + r.width / 2,
        y: r.top - s.top + r.height / 2,
        radius: 30 * warp,
        strength,
        box: { halfW: r.width / 2, halfH: r.height / 2, corner: Math.min(corner, r.height / 2) },
      }], dpr, whiteRim
        ? { ...DEFAULT_GLASS, blurPx, distance: DEFAULT_GLASS.distance * distortion, dispersion }
        : { ...DEFAULT_GLASS, blurPx, distance: DEFAULT_GLASS.distance * distortion, dispersion, fresnelFactor: 0, glareFactor: 0, edgeShade: 1 });
      shown = true;
    };
    window.addEventListener(SCENE_RENDERED_EVENT, frame);
    // Sans scène 3D (espace Accueil, fond statique) aucun rendu ne nous réveille : on suit le panneau
    // (animation d'entrée, redimensionnement) et on ne redessine que s'il a changé.
    let raf = 0;
    let sig = '';
    let settle = 0;
    const watch = () => {
      raf = requestAnimationFrame(watch);
      if (document.getElementById('babylon-canvas')) return;
      const el = targetRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const next = `${r.left}|${r.top}|${r.width}|${r.height}|${getComputedStyle(el).opacity}`;
      if (next !== sig) { sig = next; settle = 30; }
      // Fond animé (relief topographique de l'Accueil) : le verre en réfracte une copie, à rafraîchir
      // à chaque image sinon il montre un fond périmé dès que le panneau cesse de bouger.
      if (settle > 0 || document.getElementById('topo-background')) { settle = Math.max(0, settle - 1); frame(); }
    };
    raf = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(SCENE_RENDERED_EVENT, frame);
    };
  }, [targetRef, corner, enabled, warp, blurPx, whiteRim, distortion, dispersion]);

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', pointerEvents: 'none', zIndex: 999 }}
    />,
    portalRoot,
  );
}
