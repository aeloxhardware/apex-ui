import React from 'react';

/**
 * Filigrane « BETA » en diagonale sur tout l'écran, affiché quand le mode dev est désactivé
 * (versions livrées). Transparent aux clics.
 */
const ROWS = 7;
const REPEATS = 8;

export const BetaWatermark: React.FC = () => (
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
              BETA
            </span>
          ))}
        </div>
      ))}
    </div>
  </div>
  </>
);

/** Bandeaux rouges haut (français) et bas (anglais), affichés quand le mode dev est désactivé. Transparents aux clics. */
const BANNER_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  zIndex: 2002,
  margin: 0,
  padding: '3px 16px',
  background: '#c40000',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  lineHeight: 1.4,
  textAlign: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
};

export const BetaBanners: React.FC = () => (
  <>
    <p aria-hidden style={{ ...BANNER_STYLE, top: 0 }}>
      ATTENTION ! VERSION BÊTA. IL EST CONTRE-RECOMMANDÉ D'ESSAYER D'IMPRIMER LES MODÈLES GÉNÉRÉS UNIQUEMENT À DES FINS DE DÉMONSTRATION !
    </p>
    <p aria-hidden style={{ ...BANNER_STYLE, bottom: 0 }}>
      WARNING! BETA VERSION. IT IS STRONGLY DISCOURAGED TO TRY TO PRINT THE GENERATED MODELS, WHICH ARE FOR DEMONSTRATION PURPOSES ONLY!
    </p>
  </>
);
