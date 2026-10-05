import React, { useEffect, useState } from 'react';
import { Palette, Pencil, Sparkles } from 'lucide-react';
import styles from './PreviewUpperTabs.module.scss';
import { EditionPanel } from './edit-node/EditionPanel';

export type PreviewTabId = 'coloration' | 'edition' | 'fonction';

export const PREVIEW_TABS: { id: PreviewTabId; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'coloration', label: 'Coloration', description: 'Critère de coloration du tracé et visibilité des types de ligne.', icon: <Palette size={16} /> },
  { id: 'edition', label: 'Édition', description: 'Outils de retouche du G-code affiché.', icon: <Pencil size={16} /> },
  { id: 'fonction', label: 'Fonction', description: 'Fonctions avancées appliquées au tracé.', icon: <Sparkles size={16} /> },
];


// Onglet courant partagé entre la colonne d'icônes (Sidebar) et le panneau (ce composant), par
// l'événement `apex-preview-tab-changed` ; la variable de module survit au démontage du panneau.
let currentTab: PreviewTabId = 'coloration';
export const getPreviewTab = () => currentTab;
export const setPreviewTab = (tab: PreviewTabId) => {
  currentTab = tab;
  window.dispatchEvent(new CustomEvent('apex-preview-tab-changed', { detail: { tab } }));
};

/** Onglet courant de Prévisualisation, tenu à jour par l'événement. */
export const usePreviewTab = () => {
  const [tab, setTab] = useState<PreviewTabId>(currentTab);
  useEffect(() => {
    const onChanged = (e: Event) => setTab((e as CustomEvent<{ tab: PreviewTabId }>).detail.tab);
    window.addEventListener('apex-preview-tab-changed', onChanged);
    return () => window.removeEventListener('apex-preview-tab-changed', onChanged);
  }, []);
  return tab;
};

const ComingSoon: React.FC = () => <div className={styles.comingSoon}>Coming soon</div>;

/**
 * Contenu du panneau du haut de Prévisualisation, selon l'icône choisie dans la colonne de droite
 * (Sidebar). « Coloration » est la légende actuelle ; les deux autres sont provisoires.
 */
export const PreviewUpperTabs: React.FC<{ coloration: React.ReactNode }> = ({ coloration }) => {
  const tab = usePreviewTab();
  if (tab === 'edition') return <EditionPanel />;
  if (tab === 'fonction') return <ComingSoon />;
  return <>{coloration}</>;
};
