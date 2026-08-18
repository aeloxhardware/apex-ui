import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Printer, 
  Layers, 
  Flame, 
  Zap, 
  Check,
  ChevronDown
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

export interface PrinterProfile {
  id: string;
  name: string;
  buildVolume: string;
  nozzleDiameter: string;
  maxSpeed: string;
  description: string;
}

export interface FilamentProfile {
  id: string;
  name: string;
  type: string;
  tempNozzle: string;
  tempBed: string;
  density: string;
  description: string;
}

export const PRINTER_PROFILES: PrinterProfile[] = [
  { id: 'prusa-mk4', name: 'Prusa MK4', buildVolume: '250 x 210 x 220 mm', nozzleDiameter: '0.4 mm', maxSpeed: '200 mm/s', description: 'Imprimante à lit cartésien haute précision avec mise à niveau automatique Nextruder.' },
  { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon', buildVolume: '256 x 256 x 256 mm', nozzleDiameter: '0.4 mm (Acier durci)', description: 'Imprimante CoreXY ultra-rapide fermée avec lidar et IA intégrée.' },
  { id: 'voron-24', name: 'Voron 2.4 R2', buildVolume: '300 x 300 x 300 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante CoreXY open source à portique volant ultra-robuste.' },
  { id: 'creality-ender3v3', name: 'Creality Ender-3 V3 KE', buildVolume: '220 x 220 x 240 mm', nozzleDiameter: '0.4 mm', description: 'Imprimante rapide sous Klipper abordable et performante.' }
];

export const FILAMENT_PROFILES: FilamentProfile[] = [
  { id: 'pla-premium', name: 'PLA Premium (eSUN / Prusament)', type: 'PLA', tempNozzle: '210°C', tempBed: '60°C', density: '1.24 g/cm³', description: 'Facile à imprimer, faible retrait, excellent rendu visuel.' },
  { id: 'petg-pro', name: 'PETG Pro Transparent', type: 'PETG', tempNozzle: '240°C', tempBed: '80°C', density: '1.27 g/cm³', description: 'Résistant aux UV et aux chocs, bonne robustesse mécanique.' },
  { id: 'abs-plus', name: 'ABS+ Haute Résistance', type: 'ABS', tempNozzle: '250°C', tempBed: '100°C', density: '1.04 g/cm³', description: 'Idéal pour les pièces techniques nécessitant de la tenue thermique.' },
  { id: 'tpuflex', name: 'TPU 95A Flex', type: 'TPU', tempNozzle: '220°C', tempBed: '50°C', density: '1.22 g/cm³', description: 'Filament souple et élastique pour joints, coques et amortisseurs.' },
  { id: 'carbon-pa', name: 'Nylon Carbone (PA-CF)', type: 'PA-CF', tempNozzle: '280°C', tempBed: '100°C', density: '1.31 g/cm³', description: 'Composite haut de gamme renforcé en fibres de carbone pour pièces mécaniques extrêmes.' }
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
  selectedFilament,
  onSelectFilament,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const [activeTab, setActiveTab] = useState<'printer' | 'filament'>('printer');

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
  }, [isOpen, activeTab]);

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
              <button
                className={clsx(styles.tabBtn, { [styles.activeTab]: activeTab === 'printer' })}
                onClick={() => setActiveTab('printer')}
              >
                <Printer size={14} className="mr-1" /> Imprimante
              </button>
              <button
                className={clsx(styles.tabBtn, { [styles.activeTab]: activeTab === 'filament' })}
                onClick={() => setActiveTab('filament')}
              >
                <Flame size={14} className="mr-1" /> Filament
              </button>
            </div>
            <button 
              className={styles.fusionCloseBtn}
              onClick={onClose}
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
                <h4 className={styles.sectionTitle}>
                  {activeTab === 'printer' ? 'Sélection de l\'imprimante active' : 'Sélection du filament actif'}
                </h4>
                <ul className={styles.itemsList}>
                  {activeTab === 'printer' ? (
                    PRINTER_PROFILES.map((printer) => {
                      const isSelected = selectedPrinter === printer.name;
                      return (
                        <CustomTooltip key={printer.id} content={printer.name} description={printer.description}>
                          <li 
                            className={clsx(styles.itemRow, { [styles.activeRow]: isSelected })}
                            onClick={() => {
                              onSelectPrinter(printer.name);
                              showSuccess(`Imprimante active : ${printer.name}`);
                            }}
                          >
                            <div className="flex flex-col flex-1 pr-2">
                              <span className={styles.itemName}>{printer.name}</span>
                              <span className="text-[10px] text-zinc-400 mt-0.5">Plateau : {printer.buildVolume} | Buse : {printer.nozzleDiameter}</span>
                            </div>
                            {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                          </li>
                        </CustomTooltip>
                      );
                    })
                  ) : (
                    FILAMENT_PROFILES.map((filament) => {
                      const isSelected = selectedFilament === filament.name;
                      return (
                        <CustomTooltip key={filament.id} content={filament.name} description={filament.description}>
                          <li 
                            className={clsx(styles.itemRow, { [styles.activeRow]: isSelected })}
                            onClick={() => {
                              onSelectFilament(filament.name);
                              showSuccess(`Filament actif : ${filament.name}`);
                            }}
                          >
                            <div className="flex flex-col flex-1 pr-2">
                              <span className={styles.itemName}>{filament.name}</span>
                              <span className="text-[10px] text-zinc-400 mt-0.5">Buse : {filament.tempNozzle} | Plateau : {filament.tempBed} | Densité : {filament.density}</span>
                            </div>
                            {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                          </li>
                        </CustomTooltip>
                      );
                    })
                  )}
                </ul>
              </div>
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
