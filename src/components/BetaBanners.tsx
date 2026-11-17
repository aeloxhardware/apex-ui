import React from 'react';

/**
 * Bandeaux rouges de préversion, affichés quand le mode dev est désactivé : l'un tout en haut (français), l'autre tout
 * en bas (anglais) de la fenêtre, hors de l'interface (ils occupent leur propre ligne dans GpuWarningFrame, au-dessus de
 * la barre de titre et sous le bandeau orange éventuel). Transparents aux clics.
 */
const BANNER_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  position: 'relative',
  zIndex: 2147483647,
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

export const BetaBannerTop: React.FC = () => (
  <p aria-hidden style={BANNER_STYLE}>
    ATTENTION ! VERSION BÊTA. IL EST CONTRE-RECOMMANDÉ D'ESSAYER D'IMPRIMER LES MODÈLES GÉNÉRÉS UNIQUEMENT À DES FINS DE DÉMONSTRATION !
  </p>
);

export const BetaBannerBottom: React.FC = () => (
  <p aria-hidden style={BANNER_STYLE}>
    WARNING! BETA VERSION. IT IS STRONGLY DISCOURAGED TO TRY TO PRINT THE GENERATED MODELS, WHICH ARE FOR DEMONSTRATION PURPOSES ONLY!
  </p>
);
