import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Printer, 
  Check,
  ChevronRight,
  Cpu,
  Layers
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

export interface PrinterManufacturer {
  id: string;
  name: string;
  description: string;
  models: {
    id: string;
    name: string;
    buildVolume: string;
    nozzleDiameter: string;
    description: string;
  }[];
}

export const PRINTER_MANUFACTURERS: PrinterManufacturer[] = [
  {
    id: 'aelox',
    name: 'Aelox Hardware',
    description: 'Imprimantes haute performance conçues sur mesure par Aelox.',
    models: [
      { id: 'aelox-fusion-pro', name: 'Aelox Fusion Pro', buildVolume: '300 x 300 x 350 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante industrielle CoreXY haute vitesse.' },
      { id: 'aelox-compact', name: 'Aelox Compact X', buildVolume: '200 x 200 x 200 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante de bureau compacte et silencieuse.' }
    ]
  },
  {
    id: 'others',
    name: 'Autres fabricants',
    description: 'Profils pour imprimantes tiers populaires (Prusa, Bambu Lab, Voron, etc.).',
    models: [
      { id: 'prusa-mk4', name: 'Prusa MK4', buildVolume: '250 x 210 x 220 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante à lit cartésien haute précision.' },
      { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon', buildVolume: '256 x 256 x 256 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante CoreXY ultra-rapide fermée.' },
      { id: 'voron-24', name: 'Voron 2.4 R2', buildVolume: '300 x 300 x 300 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante CoreXY open source.' },
      { id: 'creality-ender3v3', name: 'Creality Ender-3 V3 KE', buildVolume: '220 x 220 x 240 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante rapide sous Klipper.' }
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
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    if (contentRef.current) {
      startScrollTopRef.current = contentRef.current.scrollTop;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
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

  useEffect(() => {
    if (isOpen) {
      setTimeout(handleScroll, 50);
    }
  }, [isOpen, selectedManufacturer]);

  const activeManufacturerObj = PRINTER_MANUFACTURERS.find(m => m.id === selectedManufacturer);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className={styles.fusionTitleContainer}
            initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.tabButtonsContainer}>
              <div className={styles.activeTabTitle}>
                <Printer size={14} className="mr-1.5 inline text-[#00f0ff]" /> 
                {selectedManufacturer ? `Fabricant > ${activeManufacturerObj?.name}` : 'Profils Imprimante'}
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
              {selectedManufacturer ? '←' : '✕'}
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
              {!selectedManufacturer ? (
                <div className={styles.sectionGroup}>
                  <h4 className={styles.sectionTitle}>Sélectionnez un fabricant</h4>
                  <ul className={styles.itemsList}>
                    {PRINTER_MANUFACTURERS.map((manufacturer) => {
                      return (
                        <CustomTooltip key={manufacturer.id} content={manufacturer.name} description={manufacturer.description}>
                          <li 
                            className={styles.itemRow}
                            onClick={() => {
                              setSelectedManufacturer(manufacturer.id);
                            }}
                          >
                            <div className="flex items-center space-x-2.5 flex-1 pr-2">
                              {manufacturer.id === 'aelox' ? (
                                <Cpu size={16} className="text-[#00f0ff] shrink-0" />
                              ) : (
                                <Layers size={16} className="text-zinc-400 shrink-0" />
                              )}
                              <div className="flex flex-col flex-1">
                                <span className={styles.itemName}>{manufacturer.name}</span>
                                <span className="text-[10px] text-zinc-400 mt-0.5">{manufacturer.description}</span>
                              </div>
                            </div>
                            <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                          </li>
                        </CustomTooltip>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className={styles.sectionGroup}>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className={styles.sectionTitle}>Modèles ({activeManufacturerObj?.name})</h4>
                    <button 
                      onClick={() => setSelectedManufacturer(null)}
                      className="text-[11px] text-[#00f0ff] hover:underline bg-transparent border-none cursor-pointer"
                    >
                      Retour
                    </button>
                  </div>
                  <ul className={styles.itemsList}>
                    {activeManufacturerObj?.models.map((model) => {
                      const isSelected = selectedPrinter === model.name;
                      return (
                        <CustomTooltip key={model.id} content={model.name} description={model.description}>
                          <li 
                            className={clsx(styles.itemRow, { [styles.activeRow]: isSelected })}
                            onClick={() => {
                              onSelectPrinter(model.name);
                              showSuccess(`Imprimante active : ${model.name}`);
                            }}
                          >
                            <div className="flex flex-col flex-1 pr-2">
                              <span className={styles.itemName}>{model.name}</span>
                              <span className="text-[10px] text-zinc-400 mt-0.5">Plateau : {model.buildVolume} | Buse : {model.nozzleDiameter}</span>
                            </div>
                            {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                          </li>
                        </CustomTooltip>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {hasScroll && (
              <div 
                className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
                onMouseDown={handleMouseDown}
                style={{
                  height: `${thumbHeight}px`,
                  top: `${thumbTop}px`
                }}
              />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};