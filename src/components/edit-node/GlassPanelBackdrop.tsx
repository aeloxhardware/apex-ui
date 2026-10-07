import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_GLASS, LiquidGlassRenderer } from './liquidGlass';

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
  const tiles = document.querySelectorAll<HTMLElement>('[data-veil-tile]');
  if (tiles.length === 0) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // Dégradé de `.tile` : ellipse 140 % × 160 % centrée en haut à droite du viewport.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(150,152,156,0.9)');
  g.addColorStop(0.55, 'rgba(58,60,66,0.97)');
  g.addColorStop(1, 'rgba(20,21,24,1)');
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, -s.left * dpr, -s.top * dpr);
  ctx.translate(W, 0);
  ctx.scale(1.4 * W, 1.6 * H);
  tiles.forEach((t) => {
    const o = parseFloat(t.style.opacity);
    if (!(o > 0.001)) return;
    const pct = (v: string) => parseFloat(v) / 100;
    // Coordonnées de la tuile (en % du viewport) ramenées dans le repère du dégradé unitaire.
    const x = pct(t.style.left) * W;
    const y = pct(t.style.top) * H;
    const w = pct(t.style.width) * W;
    const h = pct(t.style.height) * H;
    ctx.globalAlpha = Math.min(1, o);
    ctx.fillStyle = g;
    ctx.fillRect((x - W) / (1.4 * W) - 0.0005, y / (1.6 * H) - 0.0005, w / (1.4 * W) + 0.001, h / (1.6 * H) + 0.001);
  });
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
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
      const el = targetRef.current;
      const scene = document.getElementById('babylon-canvas') as HTMLCanvasElement | null;
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
        ? { ...DEFAULT_GLASS, blurPx }
        : { ...DEFAULT_GLASS, blurPx, fresnelFactor: 0, glareFactor: 0, edgeShade: 1 });
      shown = true;
    };
    window.addEventListener(SCENE_RENDERED_EVENT, frame);
    return () => window.removeEventListener(SCENE_RENDERED_EVENT, frame);
  }, [targetRef, corner, enabled, warp, blurPx, whiteRim]);

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', pointerEvents: 'none', zIndex: 999 }}
    />,
    document.body,
  );
}
