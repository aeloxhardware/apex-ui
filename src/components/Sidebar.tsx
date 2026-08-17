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
  Code 
} from 'lucide-react';
import styles from './Sidebar.module.scss';

// Add props for activeTab and onTabChange
interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer';
  onTabChange: (tab: 'box' | 'settings' | 'developer') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  // `activeTab` is now controlled by props from App.tsx
  
  // Bottom toolbar active tool: 'select' | 'move' | 'rotate' | 'layers'
  const [activeTool, setActiveTool] = useState<'select' | 'move' | 'rotate' | 'layers'>('select');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs for measuring button positions and the toolbar
  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTopTabClick = (tabName: 'box' | 'settings' | 'developer') => {
    onTabChange(tabName);
    // The visual active state will be driven by the `activeTab` prop
  };

  // Effect to update the indicator's position and size
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
          opacity: 1, // Make sure it's visible
        });
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 })); // Hide if no active button or initially
      }
    }
  }, [activeTab]);

  return (
    <div className={styles.container}>
      {/* Top Toolbar (Navigation) */}
      <div ref={topToolbarRef} className={clsx(styles.toolbar, styles.topToolbar)}>
        {/* Active indicator */}
        <div className={styles.activeIndicator} style={indicatorStyle}></div>

        {/* Custom Logo from design context */}
        <div className={styles.logoContainer}>
          <img src="/logo.webp" alt="Logo" className={styles.logoImg} />
        </div>

        {/* Separator bar */}
        <div className={styles.topSeparator} />

        <button
          ref={(el) => { buttonRefs.current.set('box', el!); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === '3d-view',
          })}
          onClick={() => handleTopTabClick('box')}
          title="Perspective 3D View"
        >
          <Box size={25} />
        </button>
        
        <button
          ref={(el) => { buttonRefs.current.set('settings', el!); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === 'settings',
          })}
          onClick={() => handleTopTabClick('settings')}
          title="Configuration Settings"
        >
          <Settings size={25} />
        </button>

        {/* New Developer button */}
        <button
          ref={(el) => { buttonRefs.current.set('developer', el!); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === 'developer',
          })}
          onClick={() => handleTopTabClick('developer')}
          title="Developer Settings"
        >
          <Code size={25} />
        </button>
      </div>

      {/* Bottom Toolbar (Action & Manipulation 3D) */}
      <div className={clsx(styles.toolbar, styles.bottomToolbar)}>
        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'select',
          })}
          onClick={() => setActiveTool('select')}
          title="Select Tool"
        >
          <MousePointer2 size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'move',
          })}
          onClick={() => setActiveTool('move')}
          title="Move Tool"
        >
          <Move size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'rotate',
          })}
          onClick={() => setActiveTool('rotate')}
          title="Rotate Tool"
        >
          <RotateCw size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'layers',
          })}
          onClick={() => setActiveTool('layers')}
          title="Slice Layers"
        >
          <Layers size={16} />
        </button>

        <div className={styles.separator} />

        {/* Bouton d'importation indépendant et bleu cyan */}
        <button
          className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
          onClick={handleUploadClick}
          title="Import 3D File"
        >
          <Upload size={16} />
        </button>

        {/* Input fichier caché pour l'action d'importation */}
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          // Accept STL files specifically
          accept=".stl" 
          onChange={(e) => {
            if (e.target.files?.[0]) {
              console.log("Fichier sélectionné :", e.target.files[0].name);
              // Dispatch the actual File object
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