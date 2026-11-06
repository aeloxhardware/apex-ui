import React from 'react';
import styles from '../Viewport3D.module.scss';

interface ViewportOverlaysProps {
  selectionBox: { x: number; y: number; width: number; height: number; mode: 'window' | 'crossing' } | null;
  plateActionHint: { title: string; x: number; y: number } | null;
  sketchDimsShown: boolean;
  sketchDimInputs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  sketchDimsApi: React.MutableRefObject<{
    onKey: (index: number, event: React.KeyboardEvent<HTMLInputElement>) => void;
    onInput: (index: number) => void;
  }>;
  sketchCursor: { x: number; y: number; snapped: boolean } | null;
  sketchPlaneHint: { x: number; y: number } | null;
  scaleBar: { px: number; label: string } | null;
}

/** Calques purement visuels par-dessus le canevas : fenêtre de sélection, info-bulles, esquisse, échelle. */
export const ViewportOverlays: React.FC<ViewportOverlaysProps> = ({
  selectionBox, plateActionHint, sketchDimsShown, sketchDimInputs, sketchDimsApi, sketchCursor, sketchPlaneHint, scaleBar,
}) => (
  <>
      {/* Rectangle de la fenêtre de sélection (clic gauche + drag) : purement visuel, la
          logique de hit-test vit dans le pointer observer Babylon ci-dessus. « window » (drag
          vers la droite, ne retient que les objets entièrement englobés) reprend le style plein
          cyan d'origine ; « crossing » (drag vers la gauche, retient tout objet touché) a un
          contour pointillé animé et un surlignage interne blanc, comme dans les logiciels de CAO. */}
      {selectionBox && selectionBox.mode === 'window' && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x, top: selectionBox.y,
            width: selectionBox.width, height: selectionBox.height,
            border: '1px solid rgba(0,240,255,0.9)',
            background: 'rgba(0,240,255,0.12)',
            pointerEvents: 'none', zIndex: 30,
          }}
        />
      )}
      {selectionBox && selectionBox.mode === 'crossing' && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x, top: selectionBox.y,
            width: selectionBox.width, height: selectionBox.height,
            pointerEvents: 'none', zIndex: 30,
          }}
        >
          {/* Surlignage interne blanc. */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.18)' }} />
          {/* Contour en 4 bandes fines (une par bord) plutôt qu'un `border` CSS : chacune anime
              son propre dégradé tiled pour l'effet « rails de train » qui glisse en continu. */}
          <div className={`${styles.edgeX} ${styles.edgeTop}`} />
          <div className={`${styles.edgeX} ${styles.edgeBottom}`} />
          <div className={`${styles.edgeY} ${styles.edgeLeft}`} />
          <div className={`${styles.edgeY} ${styles.edgeRight}`} />
        </div>
      )}

      {plateActionHint && (
        <div
          style={{
            position: 'fixed', left: plateActionHint.x + 16, top: plateActionHint.y + 16, zIndex: 1000,
            pointerEvents: 'none', background: 'rgba(20,22,30,0.85)', color: 'rgba(255,255,255,0.92)',
            fontSize: 12, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          {plateActionHint.title}
        </div>
      )}

      {sketchDimsShown && [0, 1].map((i) => (
        <input
          key={i}
          ref={(el) => { sketchDimInputs.current[i] = el; }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={i === 0 ? 'Longueur' : 'Largeur'}
          onInput={() => sketchDimsApi.current.onInput(i)}
          onKeyDown={(e) => sketchDimsApi.current.onKey(i, e)}
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

      {sketchCursor && (
        <div
          style={{
            position: 'fixed', left: sketchCursor.x, top: sketchCursor.y, zIndex: 1000,
            width: 0, height: 0, pointerEvents: 'none',
          }}
        >
          {/* « + » tout simple : deux traits blancs de 2 px, sans arrondi ni contour ; carré cyan Apex autour. */}
          <div style={{ position: 'absolute', left: -12, top: -1, width: 25, height: 2, background: '#fff' }} />
          <div style={{ position: 'absolute', left: -1, top: -12, width: 2, height: 25, background: '#fff' }} />
          {sketchCursor.snapped && (
            <div
              style={{
                position: 'absolute', left: -9, top: -9, width: 19, height: 19,
                border: '2px solid #00f0ff', borderRadius: 2, boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      )}

      {sketchPlaneHint && (
        <div
          style={{
            position: 'fixed', left: sketchPlaneHint.x + 18, top: sketchPlaneHint.y + 18, zIndex: 1000,
            pointerEvents: 'none', background: 'rgba(20,22,30,0.85)', color: 'rgba(255,255,255,0.9)',
            fontSize: 12, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          Sélectionner un plan ou une face plane
        </div>
      )}

      {/* Échelle dynamique (mode modélisation) : la barre représente toujours une distance
          « ronde », c'est sa largeur en pixels qui s'ajuste au zoom courant. */}
      {scaleBar && (
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
            {scaleBar.label}
          </span>
          <div
            style={{
              width: scaleBar.px, height: 7, borderLeft: '2px solid rgba(255,255,255,0.75)',
              borderRight: '2px solid rgba(255,255,255,0.75)', borderBottom: '2px solid rgba(255,255,255,0.75)',
            }}
          />
        </div>
      )}
  </>
);
