import React from 'react';

/**
 * Bandeau Apex en haut de la fenêtre (application de bureau). La barre de titre native est masquée
 * (`titleBarStyle: 'hidden'`, cf. electron/main.cjs) : Windows garde ses animations d'agrandissement / de restauration,
 * l'ancrage aux bords et les dispositions ; seuls ses boutons réduire / agrandir / fermer restent (`titleBarOverlay`,
 * aux couleurs d'Apex), à droite. Le bandeau est la zone de glissement de la fenêtre (double-clic : agrandir /
 * restaurer, géré par Windows). Il occupe sa propre ligne : l'interface (GpuWarningFrame) est en dessous.
 */
const TITLE_BAR_HEIGHT = 32;

export const TitleBar: React.FC = () => (
  <div
    style={{
      flex: '0 0 auto',
      height: TITLE_BAR_HEIGHT,
      display: 'flex',
      alignItems: 'center',
      // Largeur laissée aux boutons natifs (fournie par Electron via env(titlebar-area-*)).
      paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))',
      background: '#0a0f1a',
      color: '#e6f6fa',
      fontFamily: "'Oxanium', sans-serif",
      userSelect: 'none',
      WebkitAppRegion: 'drag',
    } as React.CSSProperties}
  >
    <img src="mini-logo.png" alt="" width={16} height={16} draggable={false} style={{ marginLeft: 12, marginRight: 8 }} />
    <span style={{ fontSize: 13, letterSpacing: 0.4, fontWeight: 600 }}>Apex Slicer</span>
  </div>
);
