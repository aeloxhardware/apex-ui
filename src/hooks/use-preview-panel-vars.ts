import { useLayoutEffect } from 'react';
import { previewPanelHeights } from '@/utils/spaceMorphGeometry';

/** Publie la hauteur des deux panneaux de Prévisualisation en variables CSS sur :root
 *  (--preview-upper-h / --preview-lower-h / --preview-lift, remontée des panneaux), tenues à jour au redimensionnement : le panneau du bas,
 *  le panneau du haut et la carte de conversion (positionnée sous eux) les partagent. */
export const usePreviewPanelVars = () => {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const { upperH, lowerH, lift } = previewPanelHeights(window.innerHeight);
      root.style.setProperty('--preview-upper-h', `${upperH}px`);
      root.style.setProperty('--preview-lower-h', `${lowerH}px`);
      root.style.setProperty('--preview-lift', `${lift}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--preview-upper-h');
      root.style.removeProperty('--preview-lower-h');
      root.style.removeProperty('--preview-lift');
    };
  }, []);
};
