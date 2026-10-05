import React, { useEffect, useRef, useState } from 'react';
import EditNode from '@/components/edit-node/EditNode';
import { LiquidGlassRenderer, collectLenses } from '@/components/edit-node/liquidGlass';
import styles from './NodeLab.module.scss';

/**
 * Banc d'essai du nœud d'édition : un fond irrégulier et un nœud au centre, rien d'autre. Sert à
 * concevoir l'élément d'interface pas à pas avant de le brancher sur le viewport et le noyau C++.
 * Clic : sélection. Double-clic : rognage. Clic sur le fond : désélection.
 *
 * Le fond est dessiné dans un canevas 2D puis réfracté par le rendu WebGL du verre
 * (liquidGlass.ts) ; dans l'application, ce fond sera l'image de la scène Babylon.
 */

interface Line {
  period: number;
  width: number;
  color: string;
}

// Grille irrégulière : trames de périodes premières entre elles, plus quelques lignes vives
// isolées près du centre pour bien voir la réfraction.
const VERTICAL: Line[] = [
  { period: 23, width: 2, color: 'rgba(0, 240, 255, 0.35)' },
  { period: 37, width: 1, color: 'rgba(255, 255, 255, 0.2)' },
  { period: 59, width: 3, color: 'rgba(60, 220, 140, 0.35)' },
];
const HORIZONTAL: Line[] = [
  { period: 19, width: 2, color: 'rgba(0, 240, 255, 0.3)' },
  { period: 31, width: 1, color: 'rgba(255, 255, 255, 0.2)' },
  { period: 53, width: 3, color: 'rgba(255, 110, 60, 0.3)' },
];

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, w, h);
  for (const l of VERTICAL) {
    ctx.fillStyle = l.color;
    for (let x = 0; x < w; x += l.period) ctx.fillRect(x, 0, l.width, h);
  }
  for (const l of HORIZONTAL) {
    ctx.fillStyle = l.color;
    for (let y = 0; y < h; y += l.period) ctx.fillRect(0, y, w, l.width);
  }
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = 'rgba(255, 110, 60, 0.95)';
  ctx.fillRect(cx - 22, 0, 4, h);
  ctx.fillStyle = 'rgba(255, 210, 63, 0.9)';
  ctx.fillRect(cx + 13, 0, 2, h);
  ctx.fillStyle = 'rgba(0, 170, 255, 0.95)';
  ctx.fillRect(0, cy - 9, w, 5);
  ctx.fillStyle = 'rgba(170, 90, 255, 0.9)';
  ctx.fillRect(0, cy + 24, w, 3);
}

const NodeLab: React.FC = () => {
  const [active, setActive] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const labRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = lab.clientWidth, h = lab.clientHeight;
      renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
      bg.width = Math.round(w * dpr);
      bg.height = Math.round(h * dpr);
      const ctx = bg.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground(ctx, w, h);
      renderer.setBackground(bg);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(lab);
    resize();

    const loop = () => {
      renderer.render(collectLenses(lab, lab.getBoundingClientRect()), window.devicePixelRatio || 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={labRef} className={styles.lab} onClick={() => setActive(false)}>
      <canvas ref={canvasRef} className={styles.glass} />
      <div className={styles.stage}>
        <EditNode
          x={pos.x}
          y={pos.y}
          onMove={(x, y) => setPos({ x, y })}
          loading={loading}
          active={active}
          trimming={trimming}
          onActivate={() => setActive(true)}
          onDeactivate={() => setActive(false)}
          onToggleTrimming={() => setTrimming((t) => !t)}
        />
      </div>
      <div className={styles.status} onClick={(e) => e.stopPropagation()}>
        <span>{active ? 'actif' : 'inactif'}</span>
        <span>rognage {trimming ? 'activé' : 'désactivé'}</span>
        {glassError && <span>verre indisponible : {glassError}</span>}
      </div>
      <label className={styles.controls} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={loading}
          onChange={(e) => setLoading(e.target.checked)}
        />
        État de chargement
      </label>
    </div>
  );
};

export default NodeLab;
