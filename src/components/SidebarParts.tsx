import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import ToolAxisIcon from './ToolAxisIcons';
import { IconCubePlus } from '@tabler/icons-react';
import { FileSliders, Box, MousePointer2, Code, Maximize2, Eye, Layers, Settings } from 'lucide-react';
import { PILL_CLIP, TRIANGLE_CLIP } from '@/utils/indicatorShapes';
import styles from './Sidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { BricksIcon } from './ModelingIcons';
import { ArrangeMenu } from './ArrangeMenu';
import { PREVIEW_TABS, setPreviewTab } from './PreviewUpperTabs';
import { APP_TAGLINE_DEV, APP_TAGLINE_PREVIEW } from '@/utils/devModePrefs';
import { iconVariants } from './sidebarData';
import type { SidebarTool, TabName } from './sidebarHooks';

import { emitApex } from '@/events/apexEvents';
interface TopTabsProps {
  topToolbarRef: React.RefObject<HTMLDivElement | null>;
  buttonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  indicatorStyle: React.CSSProperties;
  indicatorOnLogo: boolean;
  devMode: boolean;
  activeTab: TabName | '3d-view';
  isPreviewActive: boolean;
  onTabClick: (tab: TabName) => void;
  onLayerClick: () => void;
}

/** Barre d'onglets des espaces de travail (Accueil, Préparation, Prévisualisation, Modélisation, Dev, Paramètres). */
export const TopTabs: React.FC<TopTabsProps> = ({
  topToolbarRef, buttonRefs, indicatorStyle, indicatorOnLogo, devMode, activeTab, isPreviewActive, onTabClick, onLayerClick,
}) => (
      <div
        ref={topToolbarRef}
        data-apex-tooltip="Barre d'onglets des espaces de travail d'Apex : cliquez un onglet pour changer d'espace."
        className={clsx(styles.toolbar, styles.topToolbar)}
      >
        <div className={styles.activeIndicator} style={indicatorStyle}>
          <div className={styles.activeIndicatorShape} style={{ clipPath: indicatorOnLogo ? TRIANGLE_CLIP : PILL_CLIP }} />
        </div>

        <CustomTooltip content="Apex Studio" description={devMode ? APP_TAGLINE_DEV : APP_TAGLINE_PREVIEW}>
          <button
            ref={(el) => { if (el) buttonRefs.current.set('home', el); }}
            className={styles.logoContainer}
            onClick={() => onTabClick('home')}
            aria-label="Accueil"
          >
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Logo" className={styles.logoImg} />
          </button>
        </CustomTooltip>

        <div className={styles.topSeparator} />

        <CustomTooltip content="Vue 3D Perspective" description="Basculez sur l'espace de travail principal pour inspecter et manipuler vos modèles sur le plateau d'impression.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('box', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === '3d-view' && !isPreviewActive,
            })}
            onClick={() => onTabClick('box')}
          >
            <FileSliders size={22} />
            <span className={styles.topButtonLabel}>Préparation</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Prévisualisation" description="Visualisez le parcours de la buse et ajustez différents paramètres si cela ne vous convient pas.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('layers', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: isPreviewActive,
            })}
            onClick={onLayerClick}
          >
            <Layers size={22} />
            <span className={styles.topButtonLabel}>Prévisualisation</span>
          </button>
        </CustomTooltip>

        {devMode && (
          <CustomTooltip content="Modélisation" description="Accédez aux outils de modélisation et de préparation de votre modèle.">
            <button
              ref={(el) => { if (el) buttonRefs.current.set('settings', el); }}
              className={clsx(styles.button, styles.topButton, {
                [styles.active]: activeTab === 'settings',
              })}
              onClick={() => onTabClick('settings')}
            >
              <Box size={22} />
              <span className={styles.topButtonLabel}>Modélisation</span>
            </button>
          </CustomTooltip>
        )}

        {devMode && (
          <CustomTooltip content="Console Développeur" description="Inspectez les flux G-code générés en temps réel et les journaux de diagnostic système.">
            <button
              ref={(el) => { if (el) buttonRefs.current.set('developer', el); }}
              className={clsx(styles.button, styles.topButton, {
                [styles.active]: activeTab === 'developer',
              })}
              onClick={() => onTabClick('developer')}
            >
              <Code size={22} />
              <span className={styles.topButtonLabel}>Dev</span>
            </button>
          </CustomTooltip>
        )}

        <CustomTooltip content="Paramètres" description="Réglages généraux de l'application, sans le viewport 3D.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('params', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === 'params',
            })}
            onClick={() => onTabClick('params')}
          >
            <Settings size={22} />
            <span className={styles.topButtonLabel}>Paramètres</span>
          </button>
        </CustomTooltip>
      </div>
);

/** Icônes de la barre slicer (import, outils de manipulation, caméra) ; elles se replient hors de ce mode. */
export const SlicerIcons: React.FC<{
  hidden: boolean;
  /** Outil actif ; null quand le menu d'auto-disposition (outil exclusif lui aussi) est ouvert. */
  activeTool: SidebarTool | null;
  onToolClick: (tool: 'select' | 'move' | 'rotate' | 'scale' | 'texture') => void;
  onUploadClick: () => void;
  arrangeOpen: boolean;
  onArrangeOpenChange: (open: boolean) => void;
}> = ({ hidden, activeTool, onToolClick, onUploadClick, arrangeOpen, onArrangeOpenChange }) => (
  <>
        <motion.div custom={0} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Importer un Modèle 3D (.stl, .glb, .gltf)" description="Ouvrez le sélecteur de fichiers pour charger un nouveau fichier 3D avec textures sur le plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
              onClick={onUploadClick}
            >
              <IconCubePlus size={16} stroke={2} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={1} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={2} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Sélection" description="Cliquez sur n'importe quel modèle 3D sur le plateau pour le sélectionner et afficher ses propriétés.">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'select',
              })}
              onClick={() => onToolClick('select')}
            >
              <MousePointer2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={3} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Déplacement (Move - M)" description="Affichez les gizmos directionnels pour repositionner précisément l'objet sur le plateau d'impression. (Raccourci : M)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'move',
              })}
              onClick={() => onToolClick('move')}
            >
              <ToolAxisIcon tool="move" active={activeTool === 'move'} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={4} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Rotation (Rotate - R)" description="Faites pivoter le modèle selon les axes X, Y et Z pour optimiser son orientation de contact. (Raccourci : R)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'rotate',
              })}
              onClick={() => onToolClick('rotate')}
            >
              <ToolAxisIcon tool="rotate" active={activeTool === 'rotate'} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={5} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Mise à l'échelle (Scale - S)" description="Modifiez la taille et les proportions du modèle 3D sur le plateau d'impression. (Raccourci : S)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'scale',
              })}
              onClick={() => onToolClick('scale')}
            >
              <ToolAxisIcon tool="scale" active={activeTool === 'scale'} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={6} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil Texture & Matériau (Texture - T)" description="Sélectionnez et éditez les textures et propriétés de matériaux du modèle actif. (Raccourci : T)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'texture',
              })}
              onClick={() => onToolClick('texture')}
            >
              <BricksIcon width={16} height={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={7} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <ArrangeMenu
            open={arrangeOpen}
            onOpenChange={onArrangeOpenChange}
            tabIndex={hidden ? -1 : 0}
            buttonClassName={clsx(styles.button, styles.bottomButton, { [styles.active]: arrangeOpen })}
            iconSize={16}
          />
        </motion.div>

        <motion.div custom={8} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={9} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Réinitialiser la Caméra" description="Remettez la caméra dans sa position isométrique par défaut face au plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => emitApex('apex-reset-camera')}
            >
              <Eye size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={10} variants={iconVariants} animate={hidden ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Ajuster à l'Écran (Fit)" description="Zoomez et recentrez la vue automatiquement sur le modèle sélectionné.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => emitApex('apex-fit-screen')}
            >
              <Maximize2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>
  </>
);

/** Mode Prévisualisation : icônes qui basculent le contenu du panneau du haut (cf. PreviewUpperTabs). */
export const PreviewTabsSlot: React.FC<{ visible: boolean; devMode: boolean; previewTab: string }> = ({ visible, devMode, previewTab }) => (
        <div
          className={styles.previewSlot}
          style={{ pointerEvents: visible ? 'auto' : 'none' }}
        >
          {PREVIEW_TABS.map((t, i) => (
            <motion.div
              key={t.id}
              custom={i}
              variants={iconVariants}
              animate={visible ? "visible" : "hidden"}
              initial="hidden"
              className="flex items-center"
            >
              <CustomTooltip
                content={t.label}
                description={!devMode && t.id === 'fonction' ? 'Arrive bientôt' : t.description}
              >
                <button
                  className={clsx(styles.button, styles.bottomButton, { [styles.active]: previewTab === t.id })}
                  style={!devMode && t.id === 'fonction' ? { opacity: 0.35, filter: 'grayscale(1)', cursor: 'not-allowed' } : undefined}
                  aria-label={t.label}
                  aria-pressed={previewTab === t.id}
                  aria-disabled={!devMode && t.id === 'fonction'}
                  onClick={() => { if (devMode || t.id !== 'fonction') setPreviewTab(t.id); }}
                >
                  {t.icon}
                </button>
              </CustomTooltip>
            </motion.div>
          ))}
        </div>
);
