import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, ChevronRight } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { CrealityConfigMenu } from './printer-configs/CrealityConfigMenu';
import { GenericManufacturerConfigMenu } from './printer-configs/GenericManufacturerConfigMenu';

export const OTHER_MANUFACTURERS_LIST: { id: string; name: string; models: string[] }[] = [
  { id: '3d-systems', name: '3D Systems', models: ['ProX DMP 200', 'ProX DMP 320', 'Figure 4 Standalone', 'SLA 750'] },
  { id: '3dceram', name: '3DCeram', models: ['CeraBot', 'CeraFab System 1000'] },
  { id: 'addup', name: 'AddUp', models: ['FormUp 350', 'BeAM Modulo 400'] },
  { id: 'anycubic', name: 'Anycubic', models: ['Kobra 2 Pro', 'Kobra 3 Combo', 'Photon Mono M5s', 'Photon M3 Max'] },
  { id: 'artillery', name: 'Artillery 3D', models: ['Sidewinder X4 Pro', 'Genius Pro', 'Hornet'] },
  { id: 'asiga', name: 'Asiga', models: ['ASIGA MAX UV', 'ASIGA PRO 4K'] },
  { id: 'bambu-lab', name: 'Bambu Lab', models: ['X1 Carbon', 'X1E Enterprise', 'P1S', 'P1P', 'A1', 'A1 Mini'] },
  { id: 'carbon', name: 'Carbon', models: ['Carbon M1', 'Carbon M2', 'Carbon M3'] },
  { id: 'creality', name: 'Creality', models: [] },
  { id: 'dagoma', name: 'Dagoma', models: ['Magis', 'Sigma', 'Ultimate'] },
  { id: 'desktop-metal', name: 'Desktop Metal', models: ['Shop System', 'Production System', 'Studio System 2'] },
  { id: 'elegoo', name: 'Elegoo', models: ['Neptune 4 Max', 'Neptune 4 Pro', 'Saturn 3 Ultra', 'Mars 4 Ultra'] },
  { id: 'eos', name: 'EOS', models: ['EOS M 290', 'EOS M 400', 'EOS Formiga P 110'] },
  { id: 'flashforge', name: 'Flashforge', models: ['Creator 3 Pro', 'Adventurer 5M Pro', 'Guider 3'] },
  { id: 'flsun', name: 'FLSUN', models: ['FLSUN T1', 'FLSUN V400', 'FLSUN S1'] },
  { id: 'formlabs', name: 'Formlabs', models: ['Form 4', 'Form 4L', 'Form 3+', 'Fuse 1+'] },
  { id: 'hp', name: 'HP Inc.', models: ['Jet Fusion 5200', 'Jet Fusion 4200', 'Jet Fusion 580'] },
  { id: 'lynxter', name: 'Lynxter', models: ['S600D', 'S300X'] },
  { id: 'markforged', name: 'Markforged', models: ['Mark Two', 'X7', 'FX20', 'Metal X'] },
  { id: 'phrozen', name: 'Phrozen', models: ['Sonic Mega 8K S', 'Sonic Mighty 8K', 'Revo'] },
  { id: 'prodways', name: 'Prodways Group', models: ['ProMaker LD Series', 'ProMaker P Series'] },
  { id: 'prusa-research', name: 'Prusa Research', models: ['Original Prusa MK4', 'Original Prusa XL', 'Original Prusa MINI+'] },
  { id: 'qidi-tech', name: 'QIDI Tech', models: ['QIDI Q1 Pro', 'QIDI Max 3', 'QIDI Plus 3'] },
  { id: 'raise3d', name: 'Raise3D', models: ['Pro3', 'Pro3 Plus', 'RMF500'] },
  { id: 'snapmaker', name: 'Snapmaker', models: ['Artisan 3-in-1', 'Snapmaker 2.0 A350T', 'Ray'] },
  { id: 'sovol', name: 'Sovol 3D', models: ['SV07 Plus', 'SV06 Plus'] },
  { id: 'stratasys', name: 'Stratasys', models: ['Fortus 450mc', 'F123 Series', 'Origin One'] },
  { id: 'ultimaker', name: 'UltiMaker', models: ['UltiMaker S7', 'UltiMaker S5', 'METHOD X'] },
  { id: 'volumic', name: 'Volumic 3D', models: ['Stream 30 Pro MK3', 'Stream MultiX'] },
  { id: 'zortrax', name: 'Zortrax', models: ['M300 Dual', 'Inventure', 'Endure 300'] }
];

export const PRINTER_CATEGORIES = [
  {
    id: 'aelox',
    name: 'Aelox Hardware',
    isDirectList: true,
    models: [
      { id: 'aelox-fusion-pro', name: 'Aelox Fusion Pro' },
      { id: 'aelox-compact', name: 'Aelox Compact X' }
    ]
  },
  {
    id: 'autres',
    name: 'Autres fabricants',
    isManufacturerList: true
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
  const midContentRef = useRef<HTMLDivElement>(null);

  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [midThumbHeight, setMidThumbHeight] = useState(40);
  const [midThumbTop, setMidThumbTop] = useState(8);
  const [hasMidScroll, setHasMidScroll] = useState(false);
  const [isMidDragging, setIsMidDragging] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string | null>(null);
  const [dynamicPath, setDynamicPath] = useState('Profils imprimante');
  const [dynamicWindowCount, setDynamicWindowCount] = useState(1);

  const handleScroll = (ref: React.RefObject<HTMLDivElement | null>, setThumbH: (n: number) => void, setThumbT: (n: number) => void, setHasS: (b: boolean) => void, isDrag: boolean) => {
    if (!ref.current || isDrag) return;
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    if (scrollHeight <= clientHeight) {
      setHasS(false);
      return;
    }
    setHasS(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setThumbH(calculatedHeight);
    setThumbT(calculatedTop);
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => handleScroll(contentRef, setThumbHeight, setThumbTop, setHasScroll, isDragging), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedCategory) {
      setTimeout(() => handleScroll(midContentRef, setMidThumbHeight, setMidThumbTop, setHasMidScroll, isMidDragging), 50);
    }
  }, [selectedCategory]);

  let titlePath = 'Profils imprimante';
  if (selectedCategory === 'aelox') {
    titlePath = 'Profils imprimante\\[Aelox Hardware]';
  } else if (selectedCategory === 'autres') {
    if (selectedManufacturerId) {
      if (selectedManufacturerId === 'creality') {
        titlePath = dynamicPath;
      } else {
        const manuf = OTHER_MANUFACTURERS_LIST.find(m => m.id === selectedManufacturerId);
        titlePath = `Profils imprimante\\[Autres fabricants\\> ${manuf?.name}]`;
      }
    } else {
      titlePath = 'Profils imprimante\\[Autres fabricants]';
    }
  }

  let windowCount = 1;
  if (selectedCategory) {
    if (selectedCategory === 'aelox') {
      windowCount = 2;
    } else if (selectedCategory === 'autres') {
      if (!selectedManufacturerId) {
        windowCount = 2;
      } else if (selectedManufacturerId === 'creality') {
        windowCount = dynamicWindowCount;
      } else {
        windowCount = 2;
      }
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className={clsx(styles.fusionTitleContainer, { 
              [styles.expandedWidthTwo]: windowCount === 2,
              [styles.expandedWidthThree]: windowCount === 3,
              [styles.expandedWidthFour]: windowCount === 4
            })}
            initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.tabButtonsContainer}>
              <div className={styles.activeTabTitle}>
                <Printer size={14} className="mr-1.5 inline text-[#00f0ff] shrink-0" /> 
                <span className="truncate">{titlePath}</span>
              </div>
            </div>
            <button 
              className={styles.fusionCloseBtn}
              onClick={() => {
                if (selectedManufacturerId) {
                  setSelectedManufacturerId(null);
                } else if (selectedCategory) {
                  setSelectedCategory(null);
                } else {
                  onClose();
                }
              }}
            >
              ✕
            </button>
          </motion.div>

          {/* First Window: Categories (Aelox / Autres) */}
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
              onScroll={() => handleScroll(contentRef, setThumbHeight, setThumbTop, setHasScroll, isDragging)}
            >
              <div className={styles.sectionGroup}>
                <h4 className={styles.sectionTitle}>Fabricants</h4>
                <ul className={styles.itemsList}>
                  {PRINTER_CATEGORIES.map((cat) => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <CustomTooltip key={cat.id} content={cat.name} description="">
                        <li 
                          className={clsx(styles.itemRow, { [styles.activeRow]: isSelected })}
                          onClick={() => {
                            setSelectedCategory(cat.id);
                            setSelectedManufacturerId(null);
                          }}
                        >
                          <span className={styles.itemName}>{cat.name}</span>
                          <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                        </li>
                      </CustomTooltip>
                    );
                  })}
                </ul>
              </div>
            </div>
          </motion.div>

          {/* Second Window: Aelox models OR other manufacturers list */}
          <AnimatePresence>
            {selectedCategory === 'aelox' && (
              <motion.div 
                className={styles.patternPopup}
                initial={{ opacity: 0, scale: 0.95, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -10 }}
              >
                <div className={styles.patternPopupContent}>
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>Modèles</h4>
                    <ul className={styles.itemsList}>
                      {activeCategoryObj?.models?.map((model) => (
                        <li 
                          key={model.id}
                          className={styles.patternItem}
                          onClick={() => {
                            onSelectPrinter(model.name);
                            showSuccess(`Imprimante active : ${model.name}`);
                          }}
                        >
                          <span className={styles.itemName}>{model.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}

            {selectedCategory === 'autres' && (
              <motion.div 
                className={styles.patternPopup}
                initial={{ opacity: 0, scale: 0.95, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -10 }}
              >
                <div 
                  ref={midContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(midContentRef, setMidThumbHeight, setMidThumbTop, setHasMidScroll, isMidDragging)}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>Constructeurs</h4>
                    <ul className={styles.itemsList}>
                      {OTHER_MANUFACTURERS_LIST.map((manuf) => {
                        const isSelected = selectedManufacturerId === manuf.id;
                        return (
                          <li 
                            key={manuf.id}
                            className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                            onClick={() => setSelectedManufacturerId(manuf.id)}
                          >
                            <span className={styles.itemName}>{manuf.name}</span>
                            <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Third/Fourth cascading windows for specific manufacturers */}
          <AnimatePresence>
            {selectedManufacturerId === 'creality' && (
              <CrealityConfigMenu
                selectedPrinter={selectedPrinter}
                onSelectPrinter={onSelectPrinter}
                onPathChange={setDynamicPath}
                onWindowCountChange={setDynamicWindowCount}
              />
            )}

            {selectedManufacturerId && selectedManufacturerId !== 'creality' && (
              <GenericManufacturerConfigMenu
                manufacturerName={OTHER_MANUFACTURERS_LIST.find(m => m.id === selectedManufacturerId)?.name || ''}
                models={OTHER_MANUFACTURERS_LIST.find(m => m.id === selectedManufacturerId)?.models || []}
                selectedPrinter={selectedPrinter}
                onSelectPrinter={onSelectPrinter}
                onPathChange={setDynamicPath}
                onWindowCountChange={setDynamicWindowCount}
              />
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
};