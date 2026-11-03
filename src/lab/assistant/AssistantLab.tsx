import { useEffect, useRef, useState } from 'react';
import { DEFAULT_GLASS, GLASS_LENS_ATTR, GLASS_PULL_ATTR, LiquidGlassRenderer, collectLenses, type GlassParams } from '@/components/edit-node/liquidGlass';
import { Orb } from '@yogesharc/thinking-orbs';
import styles from './AssistantLab.module.scss';

/**
 * Banc de l'élément d'interface de l'Assistant : un damier blanc et gris et un grand rond de verre
 * au centre. Même rendu « Liquid Glass » que le nœud d'édition (WebGL, liquidGlass.ts) : le damier
 * est dessiné dans un canevas 2D puis réfracté par le verre.
 */

const TILE_PX = 24;
const TILE_LIGHT = '#ffffff';
const TILE_DARK = '#d4d4d8';
// Diamètre du rond : 55 % du plus petit côté de la page, entre 240 et 520 px.
const DIAMETER_RATIO = 0.55;
const DIAMETER_MIN_PX = 240;
const DIAMETER_MAX_PX = 520;
/**
 * Réglages par défaut de Liquid Glass Studio (https://github.com/iyinchao/liquid-glass-studio,
 * src/Controls.tsx), convertis dans les unités d'Apex (GlassParams) :
 *  - identiques et déjà les valeurs d'Apex : indice 1,4 (refFactor), dispersion 7, Fresnel 30 / 0,2 /
 *    0,2 (Studio 30 / 20 / 20, en %), reflets 30 / 0,2 / 0,9 / 0,5 / 0,8 à −45° (Studio 30 / 20 / 90 /
 *    50 / 80, en %) ;
 *  - épaisseur : Studio 20 px, Apex en fraction du rayon → posée à chaque image (cf. `loop`) ;
 *  - flou : Studio blurRadius 1 → blurPx 1 (même nombre, équivalence d'unité non vérifiée) ;
 *  - ombre : Studio shadowFactor 15, shadowExpand 25, décalage (0, −10) → opacité 0,15, flou 25 px,
 *    décalage 10 px vers le bas (correspondance approchée : le modèle d'ombre d'Apex est différent) ;
 *  - distance de réfraction : Studio 0,05 en espace UV, Apex en fraction du rayon : valeur d'Apex gardée ;
 *  - non repris : teinte (alpha 0 par défaut, sans effet), fusion (une seule forme) et la forme
 *    (200 × 200 px, rayon 80 %, rondeur 5) : le rond reste un grand cercle.
 */
const REF_THICKNESS_PX = 20;
// Rond flou (user, 2026-10-21 : « un rond flou ») : le fond vu à travers le verre est flouté à 6 px
// (le verre standard d'Apex est à 4, Studio à 1).
const GLASS_BLUR_PX = 6;
// Sphère de réflexion : 40 % du diamètre du rond.
const ORB_RATIO = 0.4;
const GLASS: GlassParams = {
  ...DEFAULT_GLASS,
  blurPx: GLASS_BLUR_PX,
  shadowOpacity: 0.15,
  shadowBlurPx: 25,
  shadowOffsetPx: 10,
};
// Ressort : le rond est attiré vers le pointeur (PULL_RATIO du déplacement, au plus PULL_MAX_PX) ;
// sa vitesse (px/s) allonge son bord de STRETCH_PER_PX_S par px/s, au plus STRETCH_MAX (rayon relatif).
// Raideur et amortissement : réglage par défaut de react-spring (tension 170, friction 26), la
// bibliothèque qu'utilise Studio, qui ne fixe pas les siens (`springSizeFactor` 10 non converti).
const PULL_RATIO = 0.08;
const PULL_MAX_PX = 36;
const SPRING_STIFFNESS = 170;
const SPRING_DAMPING = 26;
const STRETCH_PER_PX_S = 0.0006;
const STRETCH_MAX = 0.25;

function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = TILE_LIGHT;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = TILE_DARK;
  for (let j = 0; j * TILE_PX < h; j++) {
    for (let i = 0; i * TILE_PX < w; i++) {
      if ((i + j) % 2 === 1) ctx.fillRect(i * TILE_PX, j * TILE_PX, TILE_PX, TILE_PX);
    }
  }
}

export default function AssistantLab() {
  const labRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const [diameter, setDiameter] = useState(360);
  const [glassError, setGlassError] = useState<string | null>(null);

  useEffect(() => {
    const lab = labRef.current!;
    const canvas = canvasRef.current!;
    let renderer: LiquidGlassRenderer;
    try {
      renderer = new LiquidGlassRenderer(canvas);
    } catch (e) {
      setGlassError(e instanceof Error ? e.message : String(e));
      return;
    }
    const bg = document.createElement('canvas');
    let frame = 0;
    // Sur une vraie carte graphique, les shaders se compilent en parallèle : le verre n'est pas
    // « prêt » à la création, et `setBackground` ignore alors silencieusement l'image (fond noir).
    // On la lui envoie donc dans la boucle, dès qu'il est prêt, et à chaque redimensionnement.
    let bgPending = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = lab.clientWidth, h = lab.clientHeight;
      setDiameter(Math.round(Math.min(DIAMETER_MAX_PX, Math.max(DIAMETER_MIN_PX, Math.min(w, h) * DIAMETER_RATIO))));
      renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
      bg.width = Math.round(w * dpr);
      bg.height = Math.round(h * dpr);
      const ctx = bg.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawChecker(ctx, w, h);
      bgPending = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(lab);
    resize();

    // Ressort du rond (idée de Liquid Glass Studio : le verre suit le pointeur par un ressort et
    // s'étire selon sa vitesse). Le rond est attiré vers le pointeur sans le suivre vraiment ; sa
    // vitesse allonge le bord dans le sens du mouvement (GlassPull), puis il se resserre.
    const orb = orbRef.current!;
    const pull = pullRef.current!;
    const pointer = { x: 0, y: 0, inside: false };
    const spring = { x: 0, y: 0, vx: 0, vy: 0 };
    const onMove = (e: PointerEvent) => {
      const r = lab.getBoundingClientRect();
      pointer.x = e.clientX - (r.left + r.width / 2);
      pointer.y = e.clientY - (r.top + r.height / 2);
      pointer.inside = true;
    };
    const onLeave = () => { pointer.inside = false; };
    lab.addEventListener('pointermove', onMove);
    lab.addEventListener('pointerleave', onLeave);
    let last = performance.now();

    const stepSpring = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tx = pointer.inside ? Math.max(-PULL_MAX_PX, Math.min(PULL_MAX_PX, pointer.x * PULL_RATIO)) : 0;
      const ty = pointer.inside ? Math.max(-PULL_MAX_PX, Math.min(PULL_MAX_PX, pointer.y * PULL_RATIO)) : 0;
      spring.vx += ((tx - spring.x) * SPRING_STIFFNESS - spring.vx * SPRING_DAMPING) * dt;
      spring.vy += ((ty - spring.y) * SPRING_STIFFNESS - spring.vy * SPRING_DAMPING) * dt;
      spring.x += spring.vx * dt;
      spring.y += spring.vy * dt;
      orb.style.transform = `translate(calc(-50% + ${spring.x.toFixed(2)}px), calc(-50% + ${spring.y.toFixed(2)}px))`;
      const speed = Math.hypot(spring.vx, spring.vy);
      const stretch = Math.min(STRETCH_MAX, speed * STRETCH_PER_PX_S);
      pull.setAttribute(GLASS_PULL_ATTR, speed > 1e-3 ? `${spring.vx / speed},${spring.vy / speed},${stretch.toFixed(4)}` : '0,0,0');
    };

    const loop = (now: number) => {
      if (renderer.failed) {
        setGlassError('compilation des shaders impossible (voir la console)');
        return;
      }
      stepSpring(now);
      GLASS.thickness = REF_THICKNESS_PX / Math.max(orb.offsetWidth / 2, 1);
      if (renderer.ready()) {
        if (bgPending) {
          renderer.setBackground(bg);
          bgPending = false;
        }
        renderer.render(collectLenses(lab, lab.getBoundingClientRect()), window.devicePixelRatio || 1, GLASS);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      lab.removeEventListener('pointermove', onMove);
      lab.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={labRef} className={styles.lab}>
      <canvas ref={canvasRef} className={styles.glass} />
      {/* Porte la lentille : le verre est dessiné à la position et à la taille de cet élément. */}
      <div
        ref={orbRef}
        className={styles.orb}
        style={{ width: diameter, height: diameter }}
        {...{ [GLASS_LENS_ATTR]: '0,1' }}
      >
        {/* Cœur du rond : sphère de réflexion (état « reasoning »), posée sur le verre (non
            réfractée) ; elle suit le rond dans ses déplacements. Dessinée dans la couleur du texte. */}
        <div className={styles.core}>
          <Orb state="reasoning" size={Math.round(diameter * ORB_RATIO)} label="Réflexion" />
        </div>
      </div>
      {/* Frère de la lentille : sa traction (direction, allongement) est lue par collectLenses. */}
      <div ref={pullRef} className={styles.pull} {...{ [GLASS_PULL_ATTR]: '0,0,0' }} />
      {glassError && <div className={styles.status}>verre indisponible : {glassError}</div>}
    </div>
  );
}
