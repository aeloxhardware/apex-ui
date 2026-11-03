import React, { useLayoutEffect, useRef } from 'react';
import styles from './LiquidGlassMorph.module.scss';

/**
 * Forme de verre animée : un unique élément en `backdrop-filter` (même verre que les panneaux,
 * cf. .fusionMenuContainer) dont la silhouette est redessinée à chaque image via `clip-path:
 * path(...)`. Le flou du fond reste ainsi un vrai flou CSS pendant tout le morphing — aucun
 * filtre SVG n'est appliqué au verre ni à un de ses ancêtres (un `filter`, une `opacity` < 1 ou un
 * `clip-path` sur un ancêtre isolerait le `backdrop-filter` du fond et le rendrait opaque).
 *
 * L'ombre portée est un calque séparé (frère, jamais ancêtre du verre) : la forme noircie, floutée
 * puis découpée à l'EXTÉRIEUR de la silhouette, exactement comme un `box-shadow` qui ne se dessine
 * jamais sous l'élément — sans quoi le verre, translucide, paraîtrait plus sombre que les vrais
 * panneaux au moment où ceux-ci prennent le relais.
 *
 * Les positions sont en px, en `position: fixed` ; `pathAt(t, dx, dy)` décrit la forme dans le
 * repère de la boîte (left, top), décalée de (dx, dy).
 */

export interface LiquidGlassMorphTimingProps {
  /** Durée totale en ms. */
  duration: number;
  pathAt: (t: number, dx: number, dy: number) => string;
  /** Joue la timeline de t = 1 vers t = 0 (fusion plutôt que division, par exemple). */
  reverse?: boolean;
  onDone?: () => void;
}

interface LiquidGlassMorphProps extends LiquidGlassMorphTimingProps {
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * Flou du verre (px) à t = 0 et à t = 1, interpolé linéairement pendant le morphing — quand la
   * forme de départ et celle d'arrivée n'ont pas le même verre (cf. PREVIEW_GLASS_BLUR_PX). Par
   * défaut, le flou de `.glass` (GLASS_BLUR_PX) tout du long.
   */
  blur?: [number, number];
}

/** Flou du verre standard (.glass, pilule, menus, panneau Modélisation). */
export const GLASS_BLUR_PX = 4;
/** Flou des deux panneaux de Prévisualisation (.previewPanelUpper/.previewPanelLower) : 2,5×. */
export const PREVIEW_GLASS_BLUR_PX = 10;

/** Pose un flou de verre interpolé entre `from` (t = 0) et `to` (t = 1) sur `el`. */
export function applyGlassBlur(el: HTMLElement, from: number, to: number, t: number) {
  const filter = `blur(${from + (to - from) * t}px)`;
  el.style.backdropFilter = filter;
  el.style.setProperty('-webkit-backdrop-filter', filter);
}

// Marge du calque d'ombre autour de la boîte, pour que le flou ne soit pas rogné.
const SHADOW_MARGIN = 64;

/**
 * Ombre portée animée seule (calque séparé, cf. le commentaire de tête) : réutilisée telle quelle
 * quand la silhouette de verre elle-même est portée par un élément réel plutôt que par `.glass`
 * (cf. `useLiquidGlassClip`) — un vrai panneau (`backdrop-filter` + `background`) n'a pas cette
 * ombre en evenodd qui épouse sa silhouette pendant qu'elle change de forme.
 *
 * Composant purement passif : pas de boucle RAF à elle (`ref` exposée via `shadowRef`, à piloter
 * depuis `applyLiquidGlassShadow` — cf. plus bas). Une boucle RAF indépendante de celle qui anime
 * l'élément réel (`useLiquidGlassClip`) dériverait de quelques millisecondes d'une frame à l'autre
 * (deux `performance.now()` capturés séparément) : à un instant donné, l'ombre dessinerait une
 * forme légèrement en avance ou en retard sur le panneau réel — les deux contours, décalés,
 * deviendraient tous les deux visibles un court instant, comme deux silhouettes superposées.
 */
export const LiquidGlassShadow: React.FC<
  Omit<LiquidGlassMorphProps, 'duration' | 'pathAt' | 'reverse' | 'onDone'> & { shadowRef: React.RefObject<LiquidGlassShadowHandle | null> }
> = ({ left, top, width, height, shadowRef }) => {
  const shadowShapeRef = useRef<HTMLDivElement>(null);
  const shadowClipRef = useRef<HTMLDivElement>(null);

  shadowRef.current = {
    apply(shape: string, outer: string) {
      if (shadowShapeRef.current) shadowShapeRef.current.style.clipPath = `path('${shape}')`;
      if (shadowClipRef.current) shadowClipRef.current.style.clipPath = `path(evenodd, '${outer}${shape}')`;
    },
  };

  return (
    <div
      ref={shadowClipRef}
      className={styles.shadowClip}
      style={{
        left: left - SHADOW_MARGIN,
        top: top - SHADOW_MARGIN,
        width: width + 2 * SHADOW_MARGIN,
        height: height + 2 * SHADOW_MARGIN,
      }}
    >
      <div className={styles.shadowBlur}>
        <div ref={shadowShapeRef} className={styles.shadowShape} />
      </div>
    </div>
  );
};

export interface LiquidGlassShadowHandle {
  apply: (shape: string, outer: string) => void;
}

/**
 * Calcule et pousse, DANS LA MÊME frame que l'appelant, la silhouette de l'ombre portée à un
 * `progress` donné — à appeler depuis la boucle RAF qui anime déjà l'élément réel (cf.
 * `useLiquidGlassClip`/ModelingSidebar.tsx), jamais depuis une boucle RAF séparée (cf. le
 * commentaire de LiquidGlassShadow).
 */
export function applyLiquidGlassShadow(
  shadowRef: React.RefObject<LiquidGlassShadowHandle | null>,
  pathAt: (t: number, dx: number, dy: number) => string,
  width: number,
  height: number,
  reverse: boolean,
  progress: number,
) {
  const M = SHADOW_MARGIN;
  const t = reverse ? 1 - progress : progress;
  const outer = `M0 0L${width + 2 * M} 0L${width + 2 * M} ${height + 2 * M}L0 ${height + 2 * M}Z`;
  shadowRef.current?.apply(pathAt(t, M, M), outer);
}

/**
 * Anime le `clip-path` d'un élément réel déjà monté (passé par `ref`) selon la même timeline que
 * `LiquidGlassShadow`, plutôt que de dessiner un calque de verre séparé à remplacer plus tard par
 * le panneau réel — c'est le panneau réel lui-même (déjà affiché avec son contenu) dont la
 * silhouette se déforme, donc plus aucun raccord entre deux éléments distincts, plus de risque de
 * clignotement au passage de l'un à l'autre. `left`/`top` ne sont utiles ici que pour calculer le
 * même repère que `pathAt` attend (dx = 0, dy = 0 : la forme est relative à l'élément lui-même).
 * `onFrame`, si fourni, est appelé à chaque frame avec le même `progress` — pour piloter une ombre
 * portée (cf. `applyLiquidGlassShadow`) ou tout autre calque compagnon DANS LA MÊME boucle RAF que
 * l'élément clippé, jamais depuis une boucle séparée (qui dériverait de quelques millisecondes
 * d'une frame à l'autre, rendant les deux silhouettes visibles décalées l'une de l'autre).
 */
export function useLiquidGlassClip(
  ref: React.RefObject<HTMLElement | null>,
  { duration, pathAt, reverse = false, onDone }: LiquidGlassMorphTimingProps,
  deps: React.DependencyList,
  onFrame?: (progress: number) => void,
) {
  const pathAtRef = useRef(pathAt);
  pathAtRef.current = pathAt;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useLayoutEffect(() => {
    const apply = (progress: number) => {
      const t = reverse ? 1 - progress : progress;
      const shape = pathAtRef.current(t, 0, 0);
      if (ref.current) ref.current.style.clipPath = `path('${shape}')`;
      onFrameRef.current?.(progress);
    };

    apply(0);
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      apply(progress);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else onDoneRef.current?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, reverse, ...deps]);
}

export const LiquidGlassMorph: React.FC<LiquidGlassMorphProps> = ({
  left,
  top,
  width,
  height,
  duration,
  pathAt,
  reverse = false,
  onDone,
  blur,
}) => {
  const glassRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<LiquidGlassShadowHandle>(null);

  useLiquidGlassClip(glassRef, { duration, pathAt, reverse, onDone }, [width, height], (progress) => {
    applyLiquidGlassShadow(shadowRef, pathAt, width, height, reverse, progress);
    if (blur && glassRef.current) applyGlassBlur(glassRef.current, blur[0], blur[1], reverse ? 1 - progress : progress);
  });

  return (
    <>
      <LiquidGlassShadow left={left} top={top} width={width} height={height} shadowRef={shadowRef} />
      <div ref={glassRef} className={styles.glass} style={{ left, top, width, height }} />
    </>
  );
};
