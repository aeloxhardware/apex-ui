import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { 
  Box, 
  Settings, 
  MousePointer2, 
  Move, 
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
import { motion } from 'framer-motion';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});

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

  const handleLayerClick = () => {
    const newTool = activeTool === 'layers' ? 'select' : 'layers';
    setActiveTool(newTool);
    const nextPreviewState = newTool === 'layers';
    setIsPreviewActive(nextPreviewState);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
    window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: nextPreviewState } }));
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
        setIsPreviewActive(false);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
        window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: false } }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTool]);

  useEffect(() => {
    if (topToolbarRef.current && buttonRefs.current.size > 0) {
      let activeButtonKey = activeTab === '3d-view' ? 'box' : activeTab;
      if (activeTool === 'layers') {
        activeButtonKey = 'layers';
      }
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

  const iconVariants = {
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        delay: i * 0.04,
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1]
      }
    }),
    hidden: (i: number) => ({
      opacity: 0,
      y: 15,
      scale: 0.95,
      transition: {
        delay: i * 0.04,
        duration: 0.25,
        ease: [0.25, 1, 0.5, 1]
      }
    })
  };

  return (
    <div className={styles.container}>
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
              [styles.active]: activeTab === '3d-view' && activeTool !== 'layers',
            })}
            onClick={() => handleTopTabClick('box')}
          >
            <Box size={22} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Prévisualisation" description="Visualisez le parcours de la buse et ajustez différents paramètres si cela ne vous convient pas.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('layers', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTool === 'layers',
            })}
            onClick={handleLayerClick}
          >
            <Layers size={22} />
          </button>
        </CustomTooltip>
        
        <CustomTooltip content="Paramètres de Configuration" description="Accédez aux réglages globaux de la machine, du extrudeur et des profils de matériaux.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('settings', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === 'settings',
            })}
            onClick={() => handleTopTabClick('settings')}
          >
            <Settings size={22} />
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
          </button>
        </CustomTooltip>
      </div>

      {/* Bottom Toolbar (Action, Manipulation 3D) */}
      <motion.div 
        className={clsx(styles.toolbar, styles.bottomToolbar)}
        initial={false}
        animate={isPreviewActive ? {
          x: [0, 0, 480, 480],
          width: ["auto", "auto", "auto", "auto"],
          height: ["44px", "44px", "44px", "380px"],
          borderRadius: ["22px", "22px", "22px", "24px"]
        } : {
          x: 0,
          width: "auto",
          height: "44px",
          borderRadius: "22px"
        }}
        transition={{
          duration: 1.6,
          times: [0, 0.45, 0.75, 1],
          ease: [0.25, 1, 0.5, 1]
        }}
        style={{ originX: 0.5, originY: 0.5 }}
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
              <Move size={16} />
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
          }}
        />
      </motion.div>
    </div>
  );
};