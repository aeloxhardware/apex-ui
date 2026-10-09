import React from 'react';

/**
 * Filigrane « ALPHA » en diagonale sur tout l'écran, affiché quand le mode dev est désactivé
 * (versions livrées). Transparent aux clics.
 */
const ROWS = 7;
const REPEATS = 8;

export const AlphaWatermark: React.FC = () => (
  <>
  <div
    aria-hidden
    style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 2001,
    }}
  >
    <p
      style={{
        maxWidth: '60ch',
        margin: 0,
        padding: '0 16px',
        textAlign: 'center',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#fff',
        textShadow: '0 0 4px rgba(0,0,0,0.7)',
        userSelect: 'none',
      }}
    >
      Préversion {__APEX_VERSION__} – Fournie en l'état pour test. Aelox Hardware ne saurait se tenir
      responsable de quelconque perte de données.
    </p>
  </div>
  <div
    aria-hidden
    style={{
      position: 'fixed',
      inset: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: 2000,
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '220vmax',
        transform: 'translate(-50%, -50%) rotate(-30deg)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14vmin',
        alignItems: 'center',
      }}
    >
      {Array.from({ length: ROWS }, (_, row) => (
        <div
          key={row}
          style={{
            display: 'flex',
            gap: '12vmin',
            whiteSpace: 'nowrap',
            marginLeft: row % 2 ? '12vmin' : 0,
          }}
        >
          {Array.from({ length: REPEATS }, (_, i) => (
            <span
              key={i}
              style={{
                fontSize: '9vmin',
                fontWeight: 800,
                letterSpacing: '0.3em',
                color: 'rgba(255,255,255,0.07)',
                textShadow: '0 0 1px rgba(0,0,0,0.25)',
                userSelect: 'none',
              }}
            >
              ALPHA
            </span>
          ))}
        </div>
      ))}
    </div>
  </div>
  </>
);
