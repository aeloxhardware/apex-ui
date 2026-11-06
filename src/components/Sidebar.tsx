import React, { useState, useRef, useEffect } from 'react';
import { importModelsOneByOne } from '@/utils/importModels';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import TransformBox from './TransformBox';
import styles from './Sidebar.module.scss';
import { getPreviewTab, setPreviewTab, usePreviewTab } from './PreviewUpperTabs';
import { showSuccess } from '@/utils/toast';
import { isDevModeEnabled, subscribeDevMode } from '@/utils/devModePrefs';
import { TOOL_LABELS, iconVariants } from './sidebarData';
import { useToolbarGeometry, useTabIndicator, useToolShortcuts, useSpaceEntryEvents, type SidebarTool } from './sidebarHooks';
import { TopTabs, SlicerIcons, PreviewTabsSlot } from './SidebarParts';
import { makePlaySpaceTransition, makeTopTabClick, makeEnterPreview, toolbarMotion } from './sidebarTransitions';

import { emitApex } from '@/events/apexEvents';
interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer' | 'params' | 'home';
  /**
   * `toPreview` n'est vrai que pour l'unique cas où `tab === 'box'` signifie « vers
   * Prévisualisation » plutôt que « vers Préparation » (cf. handleLayerClick, branche `entering`) —
   * Index.tsx en a besoin pour savoir, en sortant de Modélisation, vers quelle forme (pilule ou
   * panneaux de Prévisualisation) jouer le morph.
   */
  onTabChange: (tab: 'box' | 'settings' | 'developer' | 'params' | 'home', toPreview?: boolean) => void;
  onOpenModel?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
}) => {
  const [activeTool, setActiveTool] = useState<SidebarTool>('select');
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const previewTab = usePreviewTab();
  const [devMode, setDevModeState] = useState(isDevModeEnabled);
  useEffect(() => subscribeDevMode(setDevModeState), []);
  // Désactiver le mode dev depuis un espace devenu caché (Dev, Modélisation) ramène à l'Accueil ;
  // l'onglet « Fonction » grisé ne doit pas rester affiché.
  useEffect(() => {
    if (devMode) return;
    if (activeTab === 'developer' || activeTab === 'settings') onTabChange('home');
    if (getPreviewTab() === 'fonction') setPreviewTab('coloration');
  }, [devMode, activeTab, onTabChange]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelingSlotRef = useRef<HTMLDivElement>(null);
  /** L'onglet « Modélisation » porte la valeur 'settings'. */
  const isModeling = activeTab === 'settings';
  /** Accueil et Paramètres : le viewport et ses outils n'ont plus de sens, la barre d'outils fondu-glisse en dehors. */
  const isParams = activeTab === 'params' || activeTab === 'home';
  const geo = useToolbarGeometry(isModeling, isPreviewActive);
  const { fromGeometry, setFromGeometry, boxWidth, bottomToolbarRef, targetGeometry, sketchReshape, setSketchReshape } = geo;
  const indicator = useTabIndicator(activeTab, activeTool);

  const transitionCtx = {
    bottomToolbarRef, targetGeometry, setFromGeometry, setSketchReshape, isModeling, onTabChange, setActiveTool, setIsPreviewActive,
  };
  const playSpaceTransition = makePlaySpaceTransition(transitionCtx);
  const handleTopTabClick = makeTopTabClick(transitionCtx, playSpaceTransition);
  const enterPreview = makeEnterPreview(transitionCtx, playSpaceTransition);

  const announceTool = (tool: keyof typeof TOOL_LABELS) => {
    showSuccess(`Outil ${TOOL_LABELS[tool]} activé.`);
  };

  const handleToolClick = (tool: 'select' | 'move' | 'rotate' | 'scale' | 'texture') => {
    const newTool = activeTool === tool ? 'select' : tool;
    setActiveTool(newTool);
    emitApex('apex-tool-changed', { tool: newTool });
    announceTool(newTool);
  };


  const handleLayerClick = () => {
    const entering = activeTool !== 'layers';

    if (entering) {
      enterPreview();
    } else {
      playSpaceTransition('box', () => {
        setActiveTool('select');
        setIsPreviewActive(false);
        emitApex('apex-tool-changed', { tool: 'select' });
        emitApex('apex-preview-toggled', { active: false });
      });
    }
  };

  useSpaceEntryEvents({ activeTab, isPreviewActive, isModeling, handleTopTabClick, enterPreview });
  useToolShortcuts(activeTool, isPreviewActive, (tool, announce) => {
    setActiveTool(tool);
    emitApex('apex-tool-changed', { tool });
    if (announce) announceTool(tool as keyof typeof TOOL_LABELS);
  }, () => announceTool('select'));

  return (
    <div className={styles.container} data-apex-chrome-panel>
      <TopTabs
        topToolbarRef={indicator.topToolbarRef} buttonRefs={indicator.buttonRefs} indicatorStyle={indicator.indicatorStyle}
        indicatorOnLogo={indicator.indicatorOnLogo} devMode={devMode} activeTab={activeTab} isPreviewActive={isPreviewActive}
        onTabClick={handleTopTabClick} onLayerClick={handleLayerClick}
      />

      {/* Bottom Toolbar (Action, Manipulation 3D) — UN SEUL conteneur physique pour les 3
          modes (slicer / prévisualisation / modélisation) : il ne se démonte jamais, il se
          vide de ses icônes, se déplace et se déforme, puis affiche les icônes du mode
          suivant. En mode modélisation les boutons CAD ne sont pas rendus ici : ils vivent
          dans ModelingSidebar (toute la logique de features y reste), qui les injecte dans
          `modelingSlotRef` via un portail — même noeud DOM, contenu apporté par le
          propriétaire de sa logique. */}
      <motion.div
        // Enveloppe indépendante du morph de forme ci-dessous (fromGeometry/targetGeometry) :
        // en Paramètres, le pilule d'outils du viewport n'a plus lieu d'être affichée — elle
        // fondu-glisse en dehors plutôt que de se déformer vers un gabarit qui n'existe pas
        // pour cet espace.
        animate={{ opacity: isParams ? 0 : 1, y: isParams ? 24 : 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: isParams ? 'none' : 'auto' }}
      >
      <motion.div
        ref={bottomToolbarRef}
        className={clsx(styles.toolbar, styles.bottomToolbar)}
        initial={false}
        {...toolbarMotion(fromGeometry, targetGeometry, sketchReshape, isModeling || boxWidth !== null ? targetGeometry.width : "auto")}
        style={{ originX: 0.5, originY: 0.5, pointerEvents: 'auto' }}
      >
          <SlicerIcons hidden={isPreviewActive || isModeling} activeTool={activeTool} onToolClick={handleToolClick} onUploadClick={() => fileInputRef.current?.click()} />

        <PreviewTabsSlot visible={isPreviewActive && !isModeling} devMode={devMode} previewTab={previewTab} />

        {/* Mode modélisation : mêmes noeud et animation de conteneur que le mode slicer —
            seul le contenu diffère. Les boutons CAD eux-mêmes (logique de features) sont
            possédés par ModelingSidebar, qui les injecte ici via un portail (voir
            modelingSlotRef) plutôt que d'être dupliqués ou recréés dans ce composant. */}
        <motion.div
          custom={0}
          variants={iconVariants}
          animate={isModeling ? "visible" : "hidden"}
          initial="hidden"
          ref={modelingSlotRef}
          id="apex-modeling-toolbar-slot"
          className={styles.modelingSlot}
        />

        {!isPreviewActive && !isModeling && (activeTool === 'move' || activeTool === 'rotate' || activeTool === 'scale') && (
          <TransformBox tool={activeTool} />
        )}

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".stl,.glb,.gltf"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) {
              void importModelsOneByOne(Array.from(e.target.files));
            }
            // Réinitialise la valeur pour pouvoir réimporter exactement le même fichier
            // à la suite (sinon le navigateur ne redéclenche pas onChange).
            e.target.value = '';
          }}
        />
      </motion.div>
      </motion.div>
    </div>
  );
};