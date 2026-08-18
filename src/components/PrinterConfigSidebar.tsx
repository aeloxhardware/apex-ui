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

export interface PrinterModel {
  id: string;
  name: string;
}

export interface SpecificManufacturer {
  id: string;
  name: string;
  models: PrinterModel[];
}

export interface PrinterCategory {
  id: string;
  name: string;
  isDirectList?: boolean;
  models?: PrinterModel[];
  manufacturers?: SpecificManufacturer[];
}

export const PRINTER_CATEGORIES: PrinterCategory[] = [
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
    manufacturers: [
      {
        id: '3d-systems',
        name: '3D Systems',
        models: [
          { id: 'prox-dp-200', name: 'ProX DMP 200' },
          { id: 'prox-dp-320', name: 'ProX DMP 320' },
          { id: 'figure-4-standalone', name: 'Figure 4 Standalone' },
          { id: 'sla-750', name: 'SLA 750' }
        ]
      },
      {
        id: '3dceram',
        name: '3DCeram',
        models: [
          { id: 'ceramo-bot', name: 'CeraBot' },
          { id: 'hot-lithography-1000', name: 'CeraFab System 1000' }
        ]
      },
      {
        id: 'addup',
        name: 'AddUp',
        models: [
          { id: 'formup-350', name: 'FormUp 350' },
          { id: 'beamo-addup', name: 'BeAM Modulo 400' }
        ]
      },
      {
        id: 'anycubic',
        name: 'Anycubic',
        models: [
          { id: 'kobra-2-pro', name: 'Kobra 2 Pro' },
          { id: 'kobra-3-combo', name: 'Kobra 3 Combo' },
          { id: 'photon-mono-m5s', name: 'Photon Mono M5s' },
          { id: 'photon-m3-max', name: 'Photon M3 Max' }
        ]
      },
      {
        id: 'artillery',
        name: 'Artillery 3D',
        models: [
          { id: 'sidewinder-x4-pro', name: 'Sidewinder X4 Pro' },
          { id: 'genius-pro', name: 'Genius Pro' },
          { id: 'hornet', name: 'Hornet' }
        ]
      },
      {
        id: 'asiga',
        name: 'Asiga',
        models: [
          { id: 'max-uv', name: 'ASIGA MAX UV' },
          { id: 'pro-4k', name: 'ASIGA PRO 4K' }
        ]
      },
      {
        id: 'bambu-lab',
        name: 'Bambu Lab',
        models: [
          { id: 'bambu-x1c', name: 'X1 Carbon' },
          { id: 'bambu-x1e', name: 'X1E Enterprise' },
          { id: 'bambu-p1s', name: 'P1S' },
          { id: 'bambu-p1p', name: 'P1P' },
          { id: 'bambu-a1', name: 'A1' },
          { id: 'bambu-a1-mini', name: 'A1 Mini' }
        ]
      },
      {
        id: 'carbon',
        name: 'Carbon',
        models: [
          { id: 'm1', name: 'Carbon M1' },
          { id: 'm2', name: 'Carbon M2' },
          { id: 'm3', name: 'Carbon M3' }
        ]
      },
      {
        id: 'creality',
        name: 'Creality',
        models: [
          { id: 'ender-3-v3-ke', name: 'Ender-3 V3 KE' },
          { id: 'ender-3-v3-se', name: 'Ender-3 V3 SE' },
          { id: 'k1-max', name: 'K1 Max' },
          { id: 'k1-c', name: 'K1 C' },
          { id: 'halot-mage-pro', name: 'Halot-Mage Pro' }
        ]
      },
      {
        id: 'dagoma',
        name: 'Dagoma',
        models: [
          { id: 'magis', name: 'Magis' },
          { id: 'sigma', name: 'Sigma' },
          { id: 'ultimate', name: 'Ultimate' }
        ]
      },
      {
        id: 'desktop-metal',
        name: 'Desktop Metal',
        models: [
          { id: 'shop-system', name: 'Shop System' },
          { id: 'production-system', name: 'Production System' },
          { id: 'studio-system-2', name: 'Studio System 2' }
        ]
      },
      {
        id: 'elegoo',
        name: 'Elegoo',
        models: [
          { id: 'neptune-4-max', name: 'Neptune 4 Max' },
          { id: 'neptune-4-pro', name: 'Neptune 4 Pro' },
          { id: 'saturn-3-ultra', name: 'Saturn 3 Ultra' },
          { id: 'mars-4-ultra', name: 'Mars 4 Ultra' }
        ]
      },
      {
        id: 'eos',
        name: 'EOS',
        models: [
          { id: 'eos m 290', name: 'EOS M 290' },
          { id: 'eos m 400', name: 'EOS M 400' },
          { id: 'eos formiga p 110', name: 'EOS Formiga P 110' }
        ]
      },
      {
        id: 'flashforge',
        name: 'Flashforge',
        models: [
          { id: 'creator-3-pro', name: 'Creator 3 Pro' },
          { id: 'adventurer-5m-pro', name: 'Adventurer 5M Pro' },
          { id: 'guider-3', name: 'Guider 3' }
        ]
      },
      {
        id: 'flsun',
        name: 'FLSUN',
        models: [
          { id: 'flsun-t1', name: 'FLSUN T1' },
          { id: 'flsun-v400', name: 'FLSUN V400' },
          { id: 'flsun-s1', name: 'FLSUN S1' }
        ]
      },
      {
        id: 'formlabs',
        name: 'Formlabs',
        models: [
          { id: 'form-4', name: 'Form 4' },
          { id: 'form-4l', name: 'Form 4L' },
          { id: 'form-3+', name: 'Form 3+' },
          { id: 'form-fuse-1', name: 'Fuse 1+' }
        ]
      },
      {
        id: 'hp',
        name: 'HP Inc.',
        models: [
          { id: 'jet-fusion-5200', name: 'Jet Fusion 5200' },
          { id: 'jet-fusion-4200', name: 'Jet Fusion 4200' },
          { id: 'jet-fusion-580', name: 'Jet Fusion 580' }
        ]
      },
      {
        id: 'lynxter',
        name: 'Lynxter',
        models: [
          { id: 's600d', name: 'S600D' },
          { id: 's300x', name: 'S300X' }
        ]
      },
      {
        id: 'markforged',
        name: 'Markforged',
        models: [
          { id: 'mark-two', name: 'Mark Two' },
          { id: 'x7', name: 'X7' },
          { id: 'fx20', name: 'FX20' },
          { id: 'metal-x', name: 'Metal X' }
        ]
      },
      {
        id: 'phrozen',
        name: 'Phrozen',
        models: [
          { id: 'sonic-mega-8k-s', name: 'Sonic Mega 8K S' },
          { id: 'sonic-mighty-8k', name: 'Sonic Mighty 8K' },
          { id: 'revo', name: 'Revo' }
        ]
      },
      {
        id: 'prodways',
        name: 'Prodways Group',
        models: [
          { id: 'proMaker-ld-series', name: 'ProMaker LD Series' },
          { id: 'promaker-p-series', name: 'ProMaker P Series' }
        ]
      },
      {
        id: 'prusa-research',
        name: 'Prusa Research',
        models: [
          { id: 'prusa-mk4', name: 'Original Prusa MK4' },
          { id: 'prusa-xl', name: 'Original Prusa XL' },
          { id: 'prusa-mini+', name: 'Original Prusa MINI+' }
        ]
      },
      {
        id: 'qidi-tech',
        name: 'QIDI Tech',
        models: [
          { id: 'qidi-q1-pro', name: 'QIDI Q1 Pro' },
          { id: 'qidi-max-3', name: 'QIDI Max 3' },
          { id: 'qidi-plus-3', name: 'QIDI Plus 3' }
        ]
      },
      {
        id: 'raise3d',
        name: 'Raise3D',
        models: [
          { id: 'pro3', name: 'Pro3' },
          { id: 'pro3-plus', name: 'Pro3 Plus' },
          { id: 'rtof-m3', name: 'RMF500' }
        ]
      },
      {
        id: 'snapmaker',
        name: 'Snapmaker',
        models: [
          { id: 'snapmaker-artisan', name: 'Artisan 3-in-1' },
          { id: 'snapmaker-2-0', name: 'Snapmaker 2.0 A350T' },
          { id: 'ray', name: 'Ray' }
        ]
      },
      {
        id: 'sovol',
        name: 'Sovol 3D',
        models: [
          { id: 'sv07-plus', name: 'SV07 Plus' },
          { id: 'sv06-plus', name: 'SV06 Plus' }
        ]
      },
      {
        id: 'stratasys',
        name: 'Stratasys',
        models: [
          { id: 'fortus-450mc', name: 'Fortus 450mc' },
          { id: 'f123-series', name: 'F123 Series' },
          { id: 'origin-one', name: 'Origin One' }
        ]
      },
      {
        id: 'ultimaker',
        name: 'UltiMaker',
        models: [
          { id: 'ultimaker-s7', name: 'UltiMaker S7' },
          { id: 'ultimaker-s5', name: 'UltiMaker S5' },
          { id: 'method-x', name: 'METHOD X' }
        ]
      },
      {
        id: 'volumic',
        name: 'Volumic 3D',
        models: [
          { id: 'stream-30-pro-mk3', name: 'Stream 30 Pro MK3' },
          { id: 'stream-multix', name: 'Stream MultiX' }
        ]
      },
      {
        id: 'zortrax',
        name: 'Zortrax',
        models: [
          { id: 'm300-dual', name: 'M300 Dual' },
          { id: 'inventure', name: 'Inventure' },
          { id: 'endure-300', name: 'Endure 300' }
        ]
      }
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
  const midContentRef = useRef<HTMLDivElement>(null);
  const modelsContentRef = useRef<HTMLDivElement>(null);

  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [midThumbHeight, setMidThumbHeight] = useState(40);
  const [midThumbTop, setMidThumbTop] = useState(8);
  const [hasMidScroll, setHasMidScroll] = useState(false);
  const [isMidDragging, setIsMidDragging] = useState(false);

  const [modelsThumbHeight, setModelsThumbHeight] = useState(40);
  const [modelsThumbTop, setModelsThumbTop] = useState(8);
  const [hasModelsScroll, setHasModelsScroll] = useState(false);
  const [isModelsDragging, setIsModelsDragging] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

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

  const handleMouseDown = (e: React.MouseEvent, type: 'cat' | 'mid' | 'models') => {
    if (type === 'cat') setIsDragging(true);
    if (type === 'mid') setIsMidDragging(true);
    if (type === 'models') setIsModelsDragging(true);

    startYRef.current = e.clientY;
    const currentRef = type === 'cat' ? contentRef : type === 'mid' ? midContentRef : modelsContentRef;
    if (currentRef.current) {
      startScrollTopRef.current = currentRef.current.scrollTop;
    }

    const onMouseMove = (ev: MouseEvent) => {
      const refObj = type === 'cat' ? contentRef : type === 'mid' ? midContentRef : modelsContentRef;
      const thumbH = type === 'cat' ? thumbHeight : type === 'mid' ? midThumbHeight : modelsThumbHeight;
      if (!refObj.current) return;
      const deltaY = ev.clientY - startYRef.current;
      const { scrollHeight, clientHeight } = refObj.current;
      const margin = 8;
      const trackHeight = clientHeight - (margin * 2);
      const maxThumbTop = trackHeight - thumbH;
      const maxScrollTop = scrollHeight - clientHeight;

      if (maxThumbTop > 0) {
        const scrollRatio = deltaY / maxThumbTop;
        const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
        refObj.current.scrollTop = newScrollTop;
      }
    };

    const onMouseUp = () => {
      if (type === 'cat') setIsDragging(false);
      if (type === 'mid') setIsMidDragging(false);
      if (type === 'models') setIsModelsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
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

  useEffect(() => {
    if (selectedManufacturer) {
      setTimeout(() => handleScroll(modelsContentRef, setModelsThumbHeight, setModelsThumbTop, setHasModelsScroll, isModelsDragging), 50);
    }
  }, [selectedManufacturer]);

  const activeCategoryObj = PRINTER_CATEGORIES.find(c => c.id === selectedCategory);
  const activeManufacturerObj = activeCategoryObj?.manufacturers?.find(m => m.id === selectedManufacturer);

  let titlePath = 'Profils imprimante';
  if (activeCategoryObj) {
    if (activeCategoryObj.isDirectList) {
      titlePath = `Profils imprimante\\[${activeCategoryObj.name}]`;
    } else if (activeManufacturerObj) {
      titlePath = `Profils imprimante\\[${activeCategoryObj.name}\\\u003E${activeManufacturerObj.name}]`;
    } else {
      titlePath = `Profils imprimante\\[${activeCategoryObj.name}]`;
    }
  }

  let containerWidthClass = 'w-[195px]';
  if (selectedCategory) {
    if (activeCategoryObj?.isDirectList || selectedManufacturer) {
      containerWidthClass = 'w-[402px]';
    } else {
      containerWidthClass = 'w-[402px]';
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className={clsx(styles.fusionTitleContainer, { 
              [styles.expandedWidthTwo]: selectedCategory && (activeCategoryObj?.isDirectList || selectedManufacturer),
              [styles.expandedWidthThree]: selectedCategory && !activeCategoryObj?.isDirectList && !selectedManufacturer
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
                if (selectedManufacturer) {
                  setSelectedManufacturer(null);
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
                            setSelectedManufacturer(null);
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

            {hasScroll && (
              <div 
                className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
                onMouseDown={(e) => handleMouseDown(e, 'cat')}
                style={{
                  height: `${thumbHeight}px`,
                  top: `${thumbTop}px`
                }}
              />
            )}
          </motion.div>

          {/* Second Window: Direct Models (if Aelox) or Manufacturers list (if Autres) */}
          <AnimatePresence>
            {selectedCategory && activeCategoryObj && (
              <motion.div 
                className={styles.patternPopup}
                initial={{ opacity: 0, scale: 0.95, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={midContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(midContentRef, setMidThumbHeight, setMidThumbTop, setHasMidScroll, isMidDragging)}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>
                      {activeCategoryObj.isDirectList ? 'Modèles' : 'Fabricants'}
                    </h4>
                    <ul className={styles.itemsList}>
                      {activeCategoryObj.isDirectList ? (
                        activeCategoryObj.models?.map((model) => {
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
                        })
                      ) : (
                        activeCategoryObj.manufacturers?.map((manuf) => {
                          const isSelected = selectedManufacturer === manuf.id;
                          return (
                            <CustomTooltip key={manuf.id} content={manuf.name} description="">
                              <li 
                                className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                onClick={() => {
                                  setSelectedManufacturer(manuf.id);
                                }}
                              >
                                <span className={styles.itemName}>{manuf.name}</span>
                                <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                              </li>
                            </CustomTooltip>
                          );
                        })
                      )}
                    </ul>
                  </div>
                </div>

                {hasMidScroll && (
                  <div 
                    className={clsx(styles.externalScrollThumb, { [styles.dragging]: isMidDragging })}
                    onMouseDown={(e) => handleMouseDown(e, 'mid')}
                    style={{
                      height: `${midThumbHeight}px`,
                      top: `${midThumbTop}px`
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Third Window: Models of specific manufacturer in "Autres fabricants" */}
          <AnimatePresence>
            {selectedManufacturer && activeManufacturerObj && (
              <motion.div 
                className={styles.thirdPopup}
                initial={{ opacity: 0, scale: 0.95, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={modelsContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(modelsContentRef, setModelsThumbHeight, setModelsThumbTop, setHasModelsScroll, isModelsDragging)}
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
                    onMouseDown={(e) => handleMouseDown(e, 'models')}
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