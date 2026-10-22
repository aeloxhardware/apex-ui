import React, { useEffect, useState } from 'react';
import { Palette, Pencil, Sparkles } from 'lucide-react';
import styles from './PreviewUpperTabs.module.scss';
import { ApexSlider } from './ApexSlider';
import { EditionPanel } from './edit-node/EditionPanel';
import { HeadAxisValues } from './edit-node/HeadAxisValues';
import {
  PREVIEW_ZOOM_SPEED_MAX,
  PREVIEW_ZOOM_SPEED_MIN,
  getPreviewZoomPrefs,
  setPreviewZoomPrefs,
  subscribePreviewZoomPrefs,
} from '@/utils/previewZoomPrefs';

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

const ZOOM_TOOLTIP = {
  title: 'Zoom de la molette',
  desc: "Automatique : le pas de zoom s'ajuste à la distance du point visé sous le curseur, en douceur (il diminue en approchant, mais moins vite que la distance, sans jamais ralentir d'un coup). Le curseur règle la vitesse dans tous les cas ; sans l'automatisme, le pas est fixe.",
};

const ZoomPanel: React.FC = () => {
  const [prefs, setPrefs] = useState(getPreviewZoomPrefs);
  useEffect(() => subscribePreviewZoomPrefs(setPrefs), []);
  return (
    <div
      className={styles.zoomPanel}
      onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: ZOOM_TOOLTIP }))}
      onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
    >
      <div className={styles.zoomTitle}>Zoom de la molette</div>
      <label className={styles.zoomRow}>
        <input type="checkbox" checked={prefs.auto} onChange={(e) => setPreviewZoomPrefs({ auto: e.target.checked })} />
        <span>Ajustement automatique au curseur</span>
      </label>
      <ApexSlider
        label="Vitesse"
        value={prefs.speed}
        onChange={(speed) => setPreviewZoomPrefs({ speed })}
        min={PREVIEW_ZOOM_SPEED_MIN}
        max={PREVIEW_ZOOM_SPEED_MAX}
        scale="log"
        defaultValue={1}
        format={(v) => `×${v.toFixed(2)}`}
      />
    </div>
  );
};

/**
 * Contenu du panneau du haut de Prévisualisation, selon l'icône choisie dans la colonne de droite
 * (Sidebar). « Coloration » est la légende actuelle ; les deux autres sont provisoires.
 */
export const PreviewUpperTabs: React.FC<{ coloration: React.ReactNode }> = ({ coloration }) => {
  const tab = usePreviewTab();
  if (tab === 'edition') return <EditionPanel />;
  if (tab === 'fonction') return <ZoomPanel />;
  return (
    <div className={styles.colorationRoot}>
      <div className={styles.headBand}><HeadAxisValues /></div>
      <div className={styles.legendSlot}>{coloration}</div>
    </div>
  );
};
