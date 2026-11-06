import React, { useEffect, useRef, useState } from 'react';
import { MAX_COLORS, clamp, type LightfallSettings } from './lightfallGl';
import { startLightfall } from './lightfallEngine';

/**
 * Fond « chute de lumière » de l'Accueil : traînées lumineuses en WebGL2, bien plus légères que le
 * relief topographique (un seul passage de traînées + bloom à résolution réduite, boucle arrêtée quand
 * rien ne bouge ou que l'onglet est caché). Adapté du composant Lightfall (React Bits) en TSX, sans CSS externe.
 * Le socle WebGL est dans lightfallGl.ts, la boucle de rendu dans lightfallEngine.ts.
 */

interface LightfallProps {
  colors?: string[];
  backgroundColor?: string;
  speed?: number;
  streakCount?: number;
  streakWidth?: number;
  streakLength?: number;
  glow?: number;
  density?: number;
  twinkle?: number;
  zoom?: number;
  backgroundGlow?: number;
  headGlow?: number;
  depth?: number;
  bloom?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  mouseDampening?: number;
  lens?: number;
  holdToWarp?: boolean;
  intro?: boolean;
  fade?: number;
  lightMode?: boolean;
  mixBlendMode?: React.CSSProperties['mixBlendMode'];
  paused?: boolean;
  dpr?: number;
  className?: string | undefined;
  style?: React.CSSProperties;
  /** Appelé une fois, après la première image (ou si WebGL2 est indisponible). */
  onReady?: () => void;
}

const Lightfall: React.FC<LightfallProps> = ({
  colors = ['#ffffff'],
  backgroundColor = '#94a3b8',
  speed = 0.3,
  streakCount = 2,
  streakWidth = 0.8,
  streakLength = 1,
  glow = 1,
  density = 0.6,
  twinkle = 0.3,
  zoom = 3,
  backgroundGlow = 0.1,
  headGlow = 0.6,
  depth = 0.5,
  bloom = 0.35,
  opacity = 1,
  mouseInteraction = true,
  mouseStrength = 0.4,
  mouseRadius = 0.45,
  mouseDampening = 0.15,
  lens = 0.5,
  holdToWarp = true,
  intro = true,
  fade = 0,
  lightMode = false,
  mixBlendMode,
  paused = false,
  dpr,
  className,
  style,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [generation, setGeneration] = useState(0);
  const settings: LightfallSettings = {
    colors: (Array.isArray(colors) && colors.length ? colors : ['#ffffff']).slice(0, MAX_COLORS).map(String),
    backgroundColor: String(backgroundColor),
    speed,
    streakCount: Math.round(clamp(streakCount, 1, 16)),
    streakWidth: Math.max(0.05, streakWidth),
    streakLength: Math.max(0.05, streakLength),
    glow: Math.max(0, glow),
    density,
    twinkle: clamp(twinkle, 0, 1),
    zoom: Math.max(0.1, zoom),
    backgroundGlow: Math.max(0, backgroundGlow),
    headGlow: clamp(headGlow, 0, 1),
    depth: Math.max(0, depth),
    bloom: Math.max(0, bloom),
    opacity: clamp(opacity, 0, 1),
    mouseInteraction,
    mouseStrength: Math.max(0, mouseStrength),
    mouseRadius: Math.max(0.01, mouseRadius),
    mouseDampening: Math.max(0, mouseDampening),
    lens: clamp(lens, 0, 1),
    holdToWarp,
    intro,
    fade: clamp(fade, 0, 1),
    lightMode,
    paused,
    dpr,
  };
  const settingsRef = useRef(settings); settingsRef.current = settings;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      // Le verre de l'Accueil (GlassPanelBackdrop) recopie ce canevas avec drawImage : sans cela le
      // tampon est vide dès que l'image est composée.
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      readyRef.current?.();
    };
    const engine = container && canvas && gl
      ? startLightfall({ gl, canvas, container, settingsRef, announce, onContextRestored: () => setGeneration((value) => value + 1) })
      : null;
    if (!engine) {
      announce();
      return undefined;
    }
    wakeRef.current = engine.wake;
    return () => {
      wakeRef.current = null;
      engine.dispose();
    };
  }, [generation]);

  useEffect(() => {
    wakeRef.current?.();
  });

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...(mixBlendMode ? { mixBlendMode } : null),
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        id="home-background"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

export default Lightfall;
