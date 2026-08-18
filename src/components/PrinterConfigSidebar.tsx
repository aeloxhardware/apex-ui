import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Printer, 
  Check,
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

export const PRINTER_PROFILES: PrinterProfile[] = [
  { id: 'prusa-mk4', name: 'Prusa MK4', buildVolume: '250 x 210 x 220 mm', nozzleDiameter: '0.4 mm', maxSpeed: '200 mm/s', description: 'Imprimante à lit cartésien haute précision avec mise à niveau automatique Nextruder.' },
  { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon', buildVolume: '256 x 256 x 256 mm', nozzleDiameter: '0.4 mm (Acier durci)', maxSpeed: '500 mm/s', description: 'Imprimante CoreXY ultra-rapide fermée avec lidar et IA intégrée.' },
  { id: 'voron-24', name: 'Voron 2.4 R2', buildVolume: '300 x 300 x 300 mm', nozzleDiameter: '0.4 mm', maxSpeed: '400 mm/s', description: 'Imprimante CoreXY open source à portique volant ultra-robuste.' },
  { id: 'creality-ender3v3', name: 'Creality Ender-3 V3 KE', buildVolume: '220 x 220 x 240 mm', nozzleDiameter: '0.4 mm', maxSpeed: '500 mm/s', description: 'Imprimante rapide sous Klipper abordable et performante.' }
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
  }, [isOpen]);

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
                <Printer size={14} className="mr-1.5 inline text-[#00f0ff]" /> Profils Imprimante
              </div>
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
                <h4 className={styles.sectionTitle}>Sélectionnez l'imprimante active</h4>
                <ul className={styles.itemsList}>
                  {PRINTER_PROFILES.map((printer) => {
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
                  })}
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