import React, { useState, useRef, useEffect } from 'react';
import { motion, Variants } from 'framer-motion';
import clsx from 'clsx';
import {
  FileSliders,
  Box,
  MousePointer2,
  Move3d,
  RotateCw,
  Maximize,
  Upload,
  Code,
  Maximize2,
  Eye,
  Palette,
  Layers
} from 'lucide-react';
import styles from './Sidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer';
  onTabChange: (tab: 'box' | 'settings' | 'developer') => void;
  onOpenModel?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onOpenModel
}) => {
  const [activeTool, setActiveTool] = useState<'select' | 'move' | 'rotate' | 'scale' | 'texture' | 'layers'>('select');
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const bottomToolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});

  /** L'onglet « Modélisation » porte la valeur 'settings'. */
  const isModeling = activeTab === 'settings';

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTopTabClick = (tabName: 'box' | 'settings' | 'developer') => {
    setActiveTool('select');
    onTabChange(tabName);
    setIsPreviewActive(false);
    window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: false } }));
  };

  const handleToolClick = (tool: 'select' | 'move' | 'rotate' | 'scale' | 'texture') => {
    const newTool = activeTool === tool ? 'select' : tool;
    setActiveTool(newTool);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
  };

  // Durée du fondu de l'Arborescence des modèles et de la barre Qualité/Solidité/Vitesse
  // (ModelStatusBox / CategoriesSidebar) — doit rester synchronisée avec leur `transition.duration`.
  const PANELS_FADE_DURATION = 900;

  const handleLayerClick = () => {
    const entering = activeTool !== 'layers';

    if (entering) {
      // Phase 1 : les panneaux latéraux s'effacent en premier — l'icône ne passe en bleu
      // et la barre d'outils du bas ne se transforme qu'une fois cette phase terminée.
      window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: true } }));
      setTimeout(() => {
        setActiveTool('layers');
        if (bottomToolbarRef.current) {
          setNaturalWidth(bottomToolbarRef.current.getBoundingClientRect().width);
        }
        setIsPreviewActive(true);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'layers' } }));
      }, PANELS_FADE_DURATION);
    } else {
      setActiveTool('select');
      setIsPreviewActive(false);
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: false } }));
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        const newTool = activeTool === 'move' ? 'select' : 'move';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
      } else if (key === 'r') {
        const newTool = activeTool === 'rotate' ? 'select' : 'rotate';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
      } else if (key === 's') {
        const newTool = activeTool === 'scale' ? 'select' : 'scale';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
      } else if (key === 't') {
        const newTool = activeTool === 'texture' ? 'select' : 'texture';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
      } else if (key === 'escape') {
        setActiveTool('select');
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTool]);

  useEffect(() => {
    if (topToolbarRef.current && buttonRefs.current.size > 0) {
      const activeButtonKey = activeTool === 'layers' ? 'layers' : (activeTab === '3d-view' ? 'box' : activeTab);
      const activeButton = buttonRefs.current.get(activeButtonKey);

      if (activeButton) {
        const toolbarRect = topToolbarRef.current.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();

        setIndicatorStyle({
          width: buttonRect.width,
          height: buttonRect.height,
          left: buttonRect.left - toolbarRect.left,
          top: buttonRect.top - toolbarRect.top,
          opacity: 1,
        });
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    }
  }, [activeTab, activeTool]);

  const iconVariants: Variants = {
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        delay: i * 0.04,
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1] as const
      }
    }),
    hidden: (i: number) => ({
      opacity: 0,
      y: 15,
      scale: 0.95,
      transition: {
        delay: i * 0.04,
        duration: 0.25,
        ease: [0.25, 1, 0.5, 1] as const
      }
    })
  };

  return (
    <div className={styles.container} data-apex-chrome-panel>
      {/* Top Toolbar (Navigation & Main Views) */}
      <div
        ref={topToolbarRef}
        className={clsx(styles.toolbar, styles.topToolbar)}
      >
        <div className={styles.activeIndicator} style={indicatorStyle}></div>

        <CustomTooltip content="Apex Slicer Studio" description="Logiciel de préparation et de découpe 3D haute performance pour l'impression additive professionnelle.">
          <div className={styles.logoContainer}>
            <img src="/logo.svg" alt="Logo" className={styles.logoImg} />
          </div>
        </CustomTooltip>

        <div className={styles.topSeparator} />

        <CustomTooltip content="Vue 3D Perspective" description="Basculez sur l'espace de travail principal pour inspecter et manipuler vos modèles sur le plateau d'impression.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('box', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === '3d-view' && !isPreviewActive,
            })}
            onClick={() => handleTopTabClick('box')}
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
            onClick={handleLayerClick}
          >
            <Layers size={22} />
            <span className={styles.topButtonLabel}>Prévisualisation</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Modélisation" description="Accédez aux outils de modélisation et de préparation de votre modèle.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('settings', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === 'settings',
            })}
            onClick={() => handleTopTabClick('settings')}
          >
            <Box size={22} />
            <span className={styles.topButtonLabel}>Modélisation</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Console Développeur" description="Inspectez les flux G-code générés en temps réel et les journaux de diagnostic système.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('developer', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === 'developer',
            })}
            onClick={() => handleTopTabClick('developer')}
          >
            <Code size={22} />
            <span className={styles.topButtonLabel}>Dev</span>
          </button>
        </CustomTooltip>
      </div>

      {/* Bottom Toolbar (Action, Manipulation 3D) */}
      <motion.div
        ref={bottomToolbarRef}
        className={clsx(styles.toolbar, styles.bottomToolbar)}
        initial={false}
        animate={isModeling ? {
          // Mode modélisation : la barre slicer se rétracte sur elle-même pour céder sa
          // place à la barre d'opérations CAD, qui vient occuper le même emplacement.
          // On ne peut pas compter sur un clip : `.bottomToolbar` force `overflow: visible`,
          // donc c'est l'opacité qui escamote réellement les icônes.
          x: 0,
          opacity: 0,
          width: 0,
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          marginTop: -10, // absorbe le `gap: 10px` de la pile pour ne pas laisser de trou
          borderRadius: 22
        } : isPreviewActive && naturalWidth !== null ? {
          x: [0, 0, 480],
          width: [naturalWidth, naturalWidth, 56],
          height: [44, 44, 340],
          borderRadius: [22, 22, 20],
          opacity: 1,
          marginTop: 0
        } : {
          x: 0,
          width: "auto",
          height: 44,
          borderRadius: 22,
          opacity: 1,
          marginTop: 0
        }}
        transition={isModeling ? {
          duration: 0.45,
          ease: [0.4, 0, 0.2, 1]
        } : {
          duration: 1.1,
          times: [0, 0.45, 1],
          ease: [0.25, 1, 0.5, 1]
        }}
        style={{ originX: 0.5, originY: 0.5, pointerEvents: isModeling ? 'none' : 'auto' }}
      >
        <motion.div custom={0} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Sélection" description="Cliquez sur n'importe quel modèle 3D sur le plateau pour le sélectionner et afficher ses propriétés.">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'select',
              })}
              onClick={() => handleToolClick('select')}
            >
              <MousePointer2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={1} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Déplacement (Move - M)" description="Affichez les gizmos directionnels pour repositionner précisément l'objet sur le plateau d'impression. (Raccourci : M)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'move',
              })}
              onClick={() => handleToolClick('move')}
            >
              <Move3d size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={2} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Rotation (Rotate - R)" description="Faites pivoter le modèle selon les axes X, Y et Z pour optimiser son orientation de contact. (Raccourci : R)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'rotate',
              })}
              onClick={() => handleToolClick('rotate')}
            >
              <RotateCw size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={3} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Mise à l'échelle (Scale - S)" description="Modifiez la taille et les proportions du modèle 3D sur le plateau d'impression. (Raccourci : S)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'scale',
              })}
              onClick={() => handleToolClick('scale')}
            >
              <Maximize size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={4} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil Texture & Matériau (Texture - T)" description="Sélectionnez et éditez les textures et propriétés de matériaux du modèle actif. (Raccourci : T)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'texture',
              })}
              onClick={() => handleToolClick('texture')}
            >
              <Palette size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={5} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={6} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Réinitialiser la Caméra" description="Remettez la caméra dans sa position isométrique par défaut face au plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => window.dispatchEvent(new CustomEvent('apex-reset-camera'))}
            >
              <Eye size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={7} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Ajuster à l'Écran (Fit)" description="Zoomez et recentrez la vue automatiquement sur le modèle sélectionné.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => window.dispatchEvent(new CustomEvent('apex-fit-screen'))}
            >
              <Maximize2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={8} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={9} variants={iconVariants} animate={isPreviewActive ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Importer un Modèle 3D (.stl, .glb, .gltf)" description="Ouvrez le sélecteur de fichiers pour charger un nouveau fichier 3D avec textures sur le plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
              onClick={handleUploadClick}
            >
              <Upload size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".stl,.glb,.gltf"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              window.dispatchEvent(
                new CustomEvent('apex-import-model', {
                  detail: e.target.files[0],
                })
              );
            }
            // Réinitialise la valeur pour pouvoir réimporter exactement le même fichier
            // à la suite (sinon le navigateur ne redéclenche pas onChange).
            e.target.value = '';
          }}
        />
      </motion.div>
    </div>
  );
};