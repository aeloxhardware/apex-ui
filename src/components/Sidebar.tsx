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

interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer';
  onTabChange: (tab: '3d-view' | 'settings' | 'developer') => void;
  selectedTool: string;
  onSelectTool: (tool: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, selectedTool, onSelectTool }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTopTabClick = (tabName: '3d-view' | 'settings' | 'developer') => {
    onTabChange(tabName);
  };

  useEffect(() => {
    if (topToolbarRef.current && buttonRefs.current.size > 0) {
      const activeButtonKey = activeTab;
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
      <div ref={topToolbarRef} className={clsx(styles.toolbar, styles.topToolbar)}>
        <div className={styles.activeIndicator} style={indicatorStyle}></div>

        <div className={styles.logoContainer}>
          <img src="/logo.webp" alt="Logo" className={styles.logoImg} onError={(e)=>{(e.target as HTMLElement).style.display='none';}} />
        </div>

        <div className={styles.topSeparator} />

        <button
          ref={(el) => { if (el) buttonRefs.current.set('3d-view', el); }}
          className={clsx(styles.button, styles.topButton, {
            [styles.active]: activeTab === '3d-view',
          })}
          onClick={() => handleTopTabClick('3d-view')}
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

      <div className={clsx(styles.toolbar, styles.bottomToolbar)}>
        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: selectedTool === 'select',
          })}
          onClick={() => {
            onSelectTool('select');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
          }}
          title="Select Tool"
        >
          <MousePointer2 size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: selectedTool === 'move',
          })}
          onClick={() => {
            onSelectTool('move');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'move' } }));
          }}
          title="Move Tool"
        >
          <Move size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: selectedTool === 'rotate',
          })}
          onClick={() => {
            onSelectTool('rotate');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'rotate' } }));
          }}
          title="Rotate Tool"
        >
          <RotateCw size={16} />
        </button>

        <button
          className={clsx(styles.button, styles.bottomButton, {
            [styles.active]: selectedTool === 'layers',
          })}
          onClick={() => {
            onSelectTool('layers');
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'layers' } }));
          }}
          title="Slice Layers"
        >
          <Layers size={16} />
        </button>

        <div className={styles.separator} />

        <button
          className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
          onClick={handleUploadClick}
          title="Import 3D File"
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