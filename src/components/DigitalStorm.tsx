import React, { useEffect, useRef, useState } from 'react';
import { startDigitalStorm } from './digitalStormEngine';

/**
 * Fond « orage numérique » de l'Accueil : un orage qui occupe toute la page (nuée de filaments, éclairs du ciel)
 * autour de la sphère d'énergie de l'écran de démarrage, devenue un globe en pointillés entouré d'orbites, avec
 * des pistes de circuit sur les côtés. Un seul passage WebGL plein écran, plafonné en pixels, arrêté quand la page
 * est cachée. Shader : digitalStorm.frag ; boucle : digitalStormEngine.ts.
 *
 * Photosensibilité : conforme au seuil de flash des WCAG 2.3.1 (aucun clignotement, moins de 3 flashs par seconde).
 * Toute retouche du shader se vérifie avec `pnpm check:photosensitivity`.
 */
interface DigitalStormProps {
  /** Appelé une fois, après la première image (ou si WebGL est indisponible). */
  onReady?: () => void;
}

const DigitalStorm: React.FC<DigitalStormProps> = ({ onReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const gl =
      canvas?.getContext('webgl', {
        alpha: false,
        // Le verre de l'Accueil (GlassPanelBackdrop) recopie ce canevas avec drawImage : sans cela le
        // tampon est vide dès que l'image est composée.
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      }) ?? null;
    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      readyRef.current?.();
    };
    const onContextRestored = () => setGeneration((value) => value + 1);
    const engine = container && canvas && gl ? startDigitalStorm({ gl, canvas, container, announce, onContextRestored }) : null;
    if (!engine) {
      announce();
      return undefined;
    }
    return engine.dispose;
  }, [generation]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        id="home-background"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

export default DigitalStorm;
