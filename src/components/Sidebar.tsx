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
  Play,
  Maximize2,
  Eye
} from 'lucide-react';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer';
  onTabChange: (tab: 'box' | 'settings' | 'developer') => void;
  onSlice?: () => void;
  onOpenModel?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  onTabChange, 
  onSlice, 
  onOpenModel
}) => {
  const [activeTool, setActiveTool] = useState<'select' | 'move' | 'rotate' | 'layers'>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

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

        {/* Logo and App Title */}
        <div className={styles.logoContainer} title="Apex Slicer v1.0.0">
          <img src="/logo.webp" alt="Logo" className={styles.logoImg} />
        </div>

        <div className={styles.topSeparator} />

        {/* Navigation Tabs */}
        <button
          ref={(el) => { if (el) buttonRefs.current.set('box', el); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === '3d-view',
          })}
          onClick={() => handleTopTabClick('box')}
          title="Perspective 3D View"
        >
          <Box size={22} />
        </button>
        
        <button
          ref={(el) => { if (el) buttonRefs.current.set('settings', el); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === 'settings',
          })}
          onClick={() => handleTopTabClick('settings')}
          title="Configuration Settings"
        >
          <Settings size={22} />
        </button>

        <button
          ref={(el) => { if (el) buttonRefs.current.set('developer', el); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === 'developer',
          })}
          onClick={() => handleTopTabClick('developer')}
          title="Developer Settings"
        >
          <Code size={22} />
        </button>
      </div>

      {/* Bottom Toolbar (Action, Manipulation 3D & Slice) */}
      <div className={clsx(styles.toolbar, styles.bottomToolbar)}>
        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'select',
          })}
          onClick={() => {
            setActiveTool('select');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
          }}
          title="Select Tool"
        >
          <MousePointer2 size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'move',
          })}
          onClick={() => {
            setActiveTool('move');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'move' } }));
          }}
          title="Move Tool"
        >
          <Move size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: activeTool === 'rotate',
          })}
          onClick={() => {
            setActiveTool('rotate');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'rotate' } }));
          }}
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

        {/* View tools */}
        <button
          className={clsx(styles.button, styles.bottomButton)}
          onClick={() => window.dispatchEvent(new CustomEvent('apex-reset-camera'))}
          title="Reset Camera View"
        >
          <Eye size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton)}
          onClick={() => window.dispatchEvent(new CustomEvent('apex-fit-screen'))}
          title="Fit to Screen"
        >
          <Maximize2 size={16} />
        </button>

        <div className={styles.separator} />

        {/* Slice Action */}
        <button
          className={clsx(styles.button, styles.bottomButton, styles.sliceButton)}
          onClick={onSlice}
          title="Slice Plate"
        >
          <Play size={14} className="fill-current" />
        </button>

        <div className={styles.separator} />

        <button
          className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
          onClick={handleUploadClick}
          title="Import 3D File (.stl)"
        >
          <Upload size={16} />
        </button>

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