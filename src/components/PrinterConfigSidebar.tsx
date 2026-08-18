import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Printer, 
  Check,
  ChevronRight
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

export interface PrinterManufacturer {
  id: string;
  name: string;
  models: {
    id: string;
    name: string;
  }[];
}

export const PRINTER_MANUFACTURERS: PrinterManufacturer[] = [
  {
    id: 'aelox',
    name: 'Aelox Hardware',
    models: [
      { id: 'aelox-fusion-pro', name: 'Aelox Fusion Pro' },
      { id: 'aelox-compact', name: 'Aelox Compact X' }
    ]
  },
  {
    id: 'others',
    name: 'Autres fabricants',
    models: [
      { id: 'prusa-mk4', name: 'Prusa MK4' },
      { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon' },
      { id: 'voron-24', name: 'Voron 2.4 R2' },
      { id: 'creality-ender3v3', name: 'Creality Ender-3 V3 KE' }
    ]
  }
];

interface PrinterConfigSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPrinter: string;
  onSelectPrinter: (printerName: string) => void;
  selectedFilament: string;
  onSelectFilament: (filamentName: string) => void;
}

export const PrinterConfigSidebar: React.FC<PrinterConfigSidebarProps> = ({
  isOpen,
  onClose,
  selectedPrinter,
  onSelectPrinter,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const modelsContentRef = useRef<HTMLDivElement>(null);

  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [modelsThumbHeight, setModelsThumbHeight] = useState(40);
  const [modelsThumbTop, setModelsThumbTop] = useState(8);
  const [hasModelsScroll, setHasModelsScroll] = useState(false);
  const [isModelsDragging, setIsModelsDragging] = useState(false);

  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const handleScroll = () => {
    if (!contentRef.current || isDragging) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasScroll(false);
      return;
    }
    setHasScroll(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setThumbHeight(calculatedHeight);
    setThumbTop(calculatedTop);
  };

  const handleModelsScroll = () => {
    if (!modelsContentRef.current || isModelsDragging) return;
    const { scrollTop, scrollHeight, clientHeight } = modelsContentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasModelsScroll(false);
      return;
    }
    setHasModelsScroll(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setModelsThumbHeight(calculatedHeight);
    setModelsThumbTop(calculatedTop);
  };

  const handleMouseDown = (e: React.MouseEvent, isModelsWindow = false) => {
    if (isModelsWindow) {
      setIsModelsDragging(true);
    } else {
      setIsDragging(true);
    }
    startYRef.current = e.clientY;
    if (isModelsWindow && modelsContentRef.current) {
      startScrollTopRef.current = modelsContentRef.current.scrollTop;
    } else if (!isModelsWindow && contentRef.current) {
      startScrollTopRef.current = contentRef.current.scrollTop;
    }
    document.addEventListener('mousemove', isModelsWindow ? handleModelsMouseMove : handleMouseMove);
    document.addEventListener('mouseup', isModelsWindow ? handleModelsMouseUp : handleMouseUp);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!contentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = contentRef.current;
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      contentRef.current.scrollTop = newScrollTop;
      
      const calculatedTop = margin + (newScrollTop / maxScrollTop) * maxThumbTop;
      setThumbTop(calculatedTop);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleModelsMouseMove = (e: MouseEvent) => {
    if (!modelsContentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = modelsContentRef.current;
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const maxThumbTop = trackHeight - modelsThumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      modelsContentRef.current.scrollTop = newScrollTop;
      
      const calculatedTop = margin + (newScrollTop / maxScrollTop) * maxThumbTop;
      setModelsThumbTop(calculatedTop);
    }
  };

  const handleModelsMouseUp = () => {
    setIsModelsDragging(false);
    document.removeEventListener('mousemove', handleModelsMouseMove);
    document.removeEventListener('mouseup', handleModelsMouseUp);
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(handleScroll, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedManufacturer) {
      setTimeout(handleModelsScroll, 50);
    }
  }, [selectedManufacturer]);

  const activeManufacturerObj = PRINTER_MANUFACTURERS.find(m => m.id === selectedManufacturer);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className={clsx(styles.fusionTitleContainer, { [styles.expandedWidth]: selectedManufacturer })}
            initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.tabButtonsContainer}>
              <div className={styles.activeTabTitle}>
                <Printer size={14} className="mr-1.5 inline text-[#00f0ff] shrink-0" /> 
                <span className="truncate">
                  {selectedManufacturer ? `Profils imprimante\\[${activeManufacturerObj?.name}]` : 'Profils imprimante'}
                </span>
              </div>
            </div>
            <button 
              className={styles.fusionCloseBtn}
              onClick={() => {
                if (selectedManufacturer) {
                  setSelectedManufacturer(null);
                } else {
                  onClose();
                }
              }}
            >
              ✕
            </button>
          </motion.div>

          <motion.div 
            className={styles.fusionMenuContainer}
            initial={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div 
              ref={contentRef}
              className={styles.fusionMenuContent}
              onScroll={handleScroll}
            >
              <div className={styles.sectionGroup}>
                <h4 className={styles.sectionTitle}>Fabricants</h4>
                <ul className={styles.itemsList}>
                  {PRINTER_MANUFACTURERS.map((manufacturer) => {
                    const isSelected = selectedManufacturer === manufacturer.id;
                    return (
                      <CustomTooltip key={manufacturer.id} content={manufacturer.name} description="">
                        <li 
                          className={clsx(styles.itemRow, { [styles.activeRow]: isSelected })}
                          onClick={() => {
                            setSelectedManufacturer(manufacturer.id);
                          }}
                        >
                          <span className={styles.itemName}>{manufacturer.name}</span>
                          <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                        </li>
                      </CustomTooltip>
                    );
                  })}
                </ul>
              </div>
            </div>

            {hasScroll && (
              <div 
                className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
                onMouseDown={(e) => handleMouseDown(e, false)}
                style={{
                  height: `${thumbHeight}px`,
                  top: `${thumbTop}px`
                }}
              />
            )}
          </motion.div>

          {/* Second cascading window for printer models */}
          <AnimatePresence>
            {selectedManufacturer && activeManufacturerObj && (
              <motion.div 
                className={styles.patternPopup}
                initial={{ opacity: 0, scale: 0.95, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={modelsContentRef}
                  className={styles.patternPopupContent}
                  onScroll={handleModelsScroll}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>Modèles</h4>
                    <ul className={styles.itemsList}>
                      {activeManufacturerObj.models.map((model) => {
                        const isSelected = selectedPrinter === model.name;
                        return (
                          <CustomTooltip key={model.id} content={model.name} description="">
                            <li 
                              className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                              onClick={() => {
                                onSelectPrinter(model.name);
                                showSuccess(`Imprimante active : ${model.name}`);
                              }}
                            >
                              <span className={styles.itemName}>{model.name}</span>
                              {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                            </li>
                          </CustomTooltip>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                {hasModelsScroll && (
                  <div 
                    className={clsx(styles.externalScrollThumb, { [styles.dragging]: isModelsDragging })}
                    onMouseDown={(e) => handleMouseDown(e, true)}
                    style={{
                      height: `${modelsThumbHeight}px`,
                      top: `${modelsThumbTop}px`
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
};