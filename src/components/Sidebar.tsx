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
import { CustomTooltip } from './CustomTooltip';

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
        <CustomTooltip content="Apex Slicer v1.0.0">
          <div className={styles.logoContainer}>
            <img src="/logo.webp" alt="Logo" className={styles.logoImg} />
          </div>
        </CustomTooltip>

        <div className={styles.topSeparator} />

        {/* Navigation Tabs */}
        <CustomTooltip content="Perspective 3D View">
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
        
        <CustomTooltip content="Configuration Settings">
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

        <CustomTooltip content="Developer Settings">
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

      {/* Bottom Toolbar (Action, Manipulation 3D & Slice) */}
      <div className={clsx(styles.toolbar, styles.bottomToolbar)}>
        <CustomTooltip content="Select Tool">
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

        <CustomTooltip content="Move Tool">
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

        <CustomTooltip content="Rotate Tool">
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

        <CustomTooltip content="Slice Layers">
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

        {/* View tools */}
        <CustomTooltip content="Reset Camera View">
          <button
            className={clsx(styles.button, styles.bottomButton)}
            onClick={() => window.dispatchEvent(new CustomEvent('apex-reset-camera'))}
          >
            <Eye size={16} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Fit to Screen">
          <button
            className={clsx(styles.button, styles.bottomButton)}
            onClick={() => window.dispatchEvent(new CustomEvent('apex-fit-screen'))}
          >
            <Maximize2 size={16} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        {/* Slice Action */}
        <CustomTooltip content="Slice Plate">
          <button
            className={clsx(styles.button, styles.bottomButton, styles.sliceButton)}
            onClick={onSlice}
          >
            <Play size={14} className="fill-current" />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Import 3D File (.stl)">
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