import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { 
  Box, 
  Settings, 
  MousePointer2, 
  Move, 
  RotateCw, 
  Layers, 
  Upload,
  Code,
  Maximize2,
  Eye
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
  const [activeTool, setActiveTool] = useState<'select' | 'move' | 'rotate' | 'layers'>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTopTabClick = (tabName: 'box' | 'settings' | 'developer') => {
    onTabChange(tabName);
  };

  useEffect(() => {
    if (topToolbarRef.current && buttonRefs.current.size > 0) {
      const activeButtonKey = activeTab === '3d-view' ? 'box' : activeTab;
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
  }, [activeTab]);

  return (
    <div className={styles.container}>
      {/* Top Toolbar (Navigation & Main Views) */}
      <div ref={topToolbarRef} className={clsx(styles.toolbar, styles.topToolbar)}>
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
              [styles.active]: activeTab === '3d-view',
            })}
            onClick={() => handleTopTabClick('box')}
          >
            <Box size={22} />
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
      <div className={clsx(styles.toolbar, styles.bottomToolbar)}>
        <CustomTooltip content="Outil de Sélection" description="Cliquez sur n'importe quel modèle 3D sur le plateau pour le sélectionner et afficher ses propriétés.">
          <button
            className={clsx(styles.button, styles.bottomButton, {
              [styles.active]: activeTool === 'select',
            })}
            onClick={() => {
              setActiveTool('select');
              window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
            }}
          >
            <MousePointer2 size={16} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Outil de Déplacement (Move)" description="Affichez les gizmos directionnels pour repositionner précisément l'objet sur le plateau d'impression.">
          <button
            className={clsx(styles.button, styles.bottomButton, {
              [styles.active]: activeTool === 'move',
            })}
            onClick={() => {
              setActiveTool('move');
              window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'move' } }));
            }}
          >
            <Move size={16} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Outil de Rotation" description="Faites pivoter le modèle selon les axes X, Y et Z pour optimiser son orientation de contact.">
          <button
            className={clsx(styles.button, styles.bottomButton, {
              [styles.active]: activeTool === 'rotate',
            })}
            onClick={() => {
              setActiveTool('rotate');
              window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'rotate' } }));
            }}
          >
            <RotateCw size={16} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Analyseur de Couches (Layer Viewer)" description="Visualisez la simulation couche par couche du parcours de la buse avant l'impression.">
          <button
            className={clsx(styles.button, styles.bottomButton, {
              [styles.active]: activeTool === 'layers',
            })}
            onClick={() => setActiveTool('layers')}
          >
            <Layers size={16} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Réinitialiser la Caméra" description="Remettez la caméra dans sa position isométrique par défaut face au plateau.">
          <button
            className={clsx(styles.button, styles.bottomButton)}
            onClick={() => window.dispatchEvent(new CustomEvent('apex-reset-camera'))}
          >
            <Eye size={16} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Ajuster à l'Écran (Fit)" description="Zoomez et recentrez la vue automatiquement sur le modèle sélectionné.">
          <button
            className={clsx(styles.button, styles.bottomButton)}
            onClick={() => window.dispatchEvent(new CustomEvent('apex-fit-screen'))}
          >
            <Maximize2 size={16} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Importer un Modèle 3D (.stl)" description="Ouvrez le sélecteur de fichiers pour charger un nouveau fichier STL 3D sur le plateau.">
          <button
            className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
            onClick={handleUploadClick}
          >
            <Upload size={16} />
          </button>
        </CustomTooltip>

        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".stl" 
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
      </div>
    </div>
  );
};