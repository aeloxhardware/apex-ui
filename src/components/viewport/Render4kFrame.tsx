import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as BABYLON from 'babylonjs';
import {
  frameToRect,
  moveRect,
  readFrame,
  rectToFrame,
  resizeRect,
  saveFrame,
  type FrameHandle,
  type FrameRect,
} from '@/utils/renderFrame4k';
import { renderRegion4k, saveRender } from './render4kCapture';
import { ApexButton } from '@/components/apex-ui';
import styles from './Render4kFrame.module.scss';

interface Props {
  engineRef: React.MutableRefObject<BABYLON.Engine | null>;
  cameraRef: React.MutableRefObject<BABYLON.ArcRotateCamera | null>;
}

type Drag = { kind: 'move' } | { kind: 'resize'; handle: FrameHandle };
type Size = { width: number; height: number };

const HANDLES: { handle: FrameHandle; style: React.CSSProperties }[] = [
  { handle: 'nw', style: { left: -7, top: -7, cursor: 'nwse-resize' } },
  { handle: 'ne', style: { right: -7, top: -7, cursor: 'nesw-resize' } },
  { handle: 'sw', style: { left: -7, bottom: -7, cursor: 'nesw-resize' } },
  { handle: 'se', style: { right: -7, bottom: -7, cursor: 'nwse-resize' } },
];

/** Suit la taille du conteneur (le parent du calque). */
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const update = () => setSize({ width: parent.clientWidth, height: parent.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Cadre 16:9 déplaçable et redimensionnable ; sa taille est mémorisée à chaque modification. */
function useFrame(container: Size) {
  const [fraction, setFraction] = useState(readFrame);
  const rect = frameToRect(fraction, container);
  const rectRef = useRef<FrameRect>(rect);
  rectRef.current = rect;
  const startDrag = useCallback(
    (drag: Drag, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const origin = { x: event.clientX, y: event.clientY, rect: rectRef.current };
      const host = (event.currentTarget as HTMLElement).closest('[data-render-4k-layer]')?.getBoundingClientRect();
      const onMove = (e: PointerEvent) => {
        const next =
          drag.kind === 'move'
            ? moveRect(origin.rect, e.clientX - origin.x, e.clientY - origin.y, container)
            : resizeRect(origin.rect, drag.handle, { x: e.clientX - (host?.left ?? 0), y: e.clientY - (host?.top ?? 0) }, container);
        setFraction(rectToFrame(next, container));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        saveFrame(rectToFrame(rectRef.current, container));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [container],
  );
  return { rect, startDrag };
}

export const Render4kFrame: React.FC<Props> = ({ engineRef, cameraRef }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const container = useContainerSize(layerRef);
  const { rect, startDrag } = useFrame(container);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ctrl + Maj + 4 : affiche / masque le cadre. `code` (touche physique) et non `key`, qui change selon la disposition
  // du clavier (sur AZERTY, Maj + 4 donne « 4 » mais la touche porte « ' »).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.code === 'Digit4')) return;
      e.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const render = async () => {
    const engine = engineRef.current;
    const camera = cameraRef.current;
    const canvas = engine?.getRenderingCanvas();
    if (!engine || !camera || !canvas) return;
    // La zone est exprimée dans le conteneur ; le canevas le remplit (100 % × 100 %).
    const region = {
      left: rect.x / container.width,
      top: rect.y / container.height,
      width: rect.width / container.width,
      height: rect.height / container.height,
    };
    setBusy(true);
    setError(null);
    try {
      saveRender(await renderRegion4k(engine, camera, region));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Le rendu 4K a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={layerRef} data-render-4k-layer className={styles.layer}>
      {open && container.width > 0 && (
        <div className={styles.frame} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <div className={styles.move} onPointerDown={(e) => startDrag({ kind: 'move' }, e)} />
          {HANDLES.map(({ handle, style }) => (
            <div key={handle} className={styles.handle} onPointerDown={(e) => startDrag({ kind: 'resize', handle }, e)} style={style} />
          ))}
          <div className={styles.actions}>
            <ApexButton variant="accent" size="lg" disabled={busy} onClick={() => void render()}>
              {busy ? 'RENDU EN COURS…' : 'RENDRE ET EXPORTER (3840 × 2160)'}
            </ApexButton>
            <ApexButton variant="glass" size="lg" disabled={busy} onClick={() => setOpen(false)}>
              FERMER
            </ApexButton>
          </div>
          {error && <div className={styles.error}>{error}</div>}
        </div>
      )}
    </div>
  );
};
