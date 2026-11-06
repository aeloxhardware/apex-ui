import React from 'react';
import styles from '../Viewport3D.module.scss';

/** Rectangle de la fenêtre de sélection, en coordonnées écran relatives au conteneur. */
export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dépend du sens du drag, comme dans la plupart des logiciels de CAO : vers la droite = « window » (ne
   * retient que les objets entièrement englobés, contour plein) ; vers la gauche = « crossing » (retient
   * tout objet touché, contour pointillé animé + surlignage blanc). */
  mode: 'window' | 'crossing';
}

/**
 * Fenêtre de sélection (clic gauche + drag) : purement visuelle, la logique de hit-test vit dans le
 * pointer observer Babylon (`setupSelectionInput`). « window » reprend le style plein cyan d'origine ;
 * « crossing » a un contour pointillé animé et un surlignage interne blanc.
 */
export function SelectionBoxOverlay({ box }: { box: SelectionBox }) {
  const frame: React.CSSProperties = {
    position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height,
    pointerEvents: 'none', zIndex: 30,
  };
  if (box.mode === 'window') {
    return <div style={{ ...frame, border: '1px solid rgba(0,240,255,0.9)', background: 'rgba(0,240,255,0.12)' }} />;
  }
  return (
    <div style={frame}>
      {/* Surlignage interne blanc. */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.18)' }} />
      {/* Contour en 4 bandes fines (une par bord) plutôt qu'un `border` CSS : chacune anime son propre
          dégradé tiled pour l'effet « rails de train » qui glisse en continu. */}
      <div className={`${styles.edgeX} ${styles.edgeTop}`} />
      <div className={`${styles.edgeX} ${styles.edgeBottom}`} />
      <div className={`${styles.edgeY} ${styles.edgeLeft}`} />
      <div className={`${styles.edgeY} ${styles.edgeRight}`} />
    </div>
  );
}

/** Info-bulle qui suit le curseur (survol d'un bouton du plateau, choix du plan d'esquisse). */
export function CursorHint(props: { x: number; y: number; offset: number; textAlpha: number; children: React.ReactNode }) {
  const { x, y, offset, textAlpha, children } = props;
  return (
    <div
      style={{
        position: 'fixed', left: x + offset, top: y + offset, zIndex: 1000,
        pointerEvents: 'none', background: 'rgba(20,22,30,0.85)', color: `rgba(255,255,255,${textAlpha})`,
        fontSize: 12, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
      }}
    >
      {children}
    </div>
  );
}

export interface SketchDimsApi {
  onKey: (index: number, event: React.KeyboardEvent<HTMLInputElement>) => void;
  onInput: (index: number) => void;
}

/** Champs « longueur » / « largeur » de l'outil Rectangle, positionnés à la volée par `setupSketchRect`. */
export function SketchDimInputs(props: {
  inputs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  api: React.MutableRefObject<SketchDimsApi>;
}) {
  const { inputs, api } = props;
  return (
    <>
      {[0, 1].map((i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el; }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={i === 0 ? 'Longueur' : 'Largeur'}
          onInput={() => api.current.onInput(i)}
          onKeyDown={(e) => api.current.onKey(i, e)}
          style={{
            position: 'fixed', left: -9999, top: -9999, zIndex: 1001, transform: 'translate(-50%, -50%)',
            width: 78, height: 26, padding: '0 10px', boxSizing: 'border-box', textAlign: 'center',
            fontSize: 12, color: '#fff', background: 'rgba(24,27,36,0.55)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: 'none', outline: 'none', borderRadius: 13,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.35)',
          }}
        />
      ))}
    </>
  );
}

/** Curseur « + » de l'outil Rectangle (position écran, aimanté ou non à la grille). */
export function SketchCursorMark({ cursor }: { cursor: { x: number; y: number; snapped: boolean } }) {
  return (
    <div
      style={{
        position: 'fixed', left: cursor.x, top: cursor.y, zIndex: 1000,
        width: 0, height: 0, pointerEvents: 'none',
      }}
    >
      {/* « + » tout simple : deux traits blancs de 2 px, sans arrondi ni contour ; carré cyan Apex autour. */}
      <div style={{ position: 'absolute', left: -12, top: -1, width: 25, height: 2, background: '#fff' }} />
      <div style={{ position: 'absolute', left: -1, top: -12, width: 2, height: 25, background: '#fff' }} />
      {cursor.snapped && (
        <div
          style={{
            position: 'absolute', left: -9, top: -9, width: 19, height: 19,
            border: '2px solid #00f0ff', borderRadius: 2, boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}

/**
 * Échelle dynamique (mode modélisation) : la barre représente toujours une distance « ronde », c'est
 * sa largeur en pixels qui s'ajuste au zoom courant.
 */
export function ScaleBarOverlay({ bar }: { bar: { px: number; label: string } }) {
  return (
    <div
      data-apex-tooltip="Échelle de la vue : la barre représente la longueur indiquée à la distance de la cible de la caméra, et s'ajuste au zoom."
      style={{
        position: 'absolute', right: 24, bottom: 24, zIndex: 20,
        pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 11, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.75)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}
      >
        {bar.label}
      </span>
      <div
        style={{
          width: bar.px, height: 7, borderLeft: '2px solid rgba(255,255,255,0.75)',
          borderRight: '2px solid rgba(255,255,255,0.75)', borderBottom: '2px solid rgba(255,255,255,0.75)',
        }}
      />
    </div>
  );
}
