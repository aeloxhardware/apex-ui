import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Check, ChevronRight } from 'lucide-react';
import { CustomTooltip } from '../CustomTooltip';
import styles from '../PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

interface CrealityConfigMenuProps {
  selectedPrinter: string;
  onSelectPrinter: (name: string) => void;
  onPathChange: (path: string) => void;
  onWindowCountChange: (count: number) => void;
}

export const CREALITY_DATA = [
  {
    id: 'creality-ender',
    name: 'Série Ender',
    subCategories: [
      {
        id: 'ender-3',
        name: 'Ender-3',
        models: [
          'Ender-3', 'Ender-3 Pro', 'Ender-3 V2', 'Ender-3 Max', 'Ender-3 S1', 
          'Ender-3 S1 Pro', 'Ender-3 S1 Plus', 'Ender-3 Neo', 'Ender-3 V2 Neo', 
          'Ender-3 Max Neo', 'Ender-3 V3 SE', 'Ender-3 V3 KE', 'Ender-3 V3', 'Ender-3 V3 Plus'
        ]
      },
      {
        id: 'ender-5',
        name: 'Ender-5',
        models: ['Ender-5', 'Ender-5 Pro', 'Ender-5 Plus', 'Ender-5 S1']
      },
      {
        id: 'ender-6-7',
        name: 'Ender-6 / Ender-7',
        models: ['Ender-6', 'Ender-7']
      },
      {
        id: 'autres-ender',
        name: 'Autres Ender',
        models: ['Ender-2', 'Ender-2 Pro', 'Ender-4']
      }
    ]
  },
  {
    id: 'creality-k',
    name: 'Série K (CoreXY Haute Vitesse)',
    subCategories: [
      {
        id: 'k-series',
        name: 'Modèles K',
        models: ['K1', 'K1 Max', 'K1C', 'K2 Plus']
      }
    ]
  },
  {
    id: 'creality-cr',
    name: 'Série CR (Core / Cartésiennes Grand Format)',
    subCategories: [
      {
        id: 'cr-10',
        name: 'CR-10',
        models: ['CR-10', 'CR-10S', 'CR-10 S4', 'CR-10 S5', 'CR-10 V2', 'CR-10 V3', 'CR-10 Max', 'CR-10 Mini', 'CR-10 Smart', 'CR-10 Smart Pro', 'CR-10 SE']
      },
      {
        id: 'cr-6',
        name: 'CR-6',
        models: ['CR-6 SE', 'CR-6 Max']
      },
      {
        id: 'cr-20',
        name: 'CR-20',
        models: ['CR-20', 'CR-20Pro']
      },
      {
        id: 'cr-m4',
        name: 'CR-M4',
        models: ['CR-M4']
      },
      {
        id: 'cr-x',
        name: 'CR-X',
        models: ['CR-X', 'CR-X Pro']
      },
      {
        id: 'autres-cr',
        name: 'Autres CR',
        models: ['CR-30 (PrintMill)', 'CR-100', 'CR-2020', 'CR-3040', 'CR-3040 Pro', 'CR-5 Pro', 'CR-5 Pro High-Temp']
      }
    ]
  },
  {
    id: 'creality-resin',
    name: 'Série Résine (SLA / LCD - Halot & LD)',
    subCategories: [
      {
        id: 'halot',
        name: 'Gamme Halot',
        models: ['Halot-One', 'Halot-One Plus', 'Halot-One Pro', 'Halot-Mage', 'Halot-Mage Pro', 'Halot-Mage S', 'Halot-Sky', 'Halot-Sky 2022', 'Halot-Lite', 'Halot-Ray', 'Halot-Max']
      },
      {
        id: 'ld',
        name: 'Gamme LD (Archivée)',
        models: ['LD-001', 'LD-002', 'LD-002R', 'LD-002H', 'LD-006']
      }
    ]
  },
  {
    id: 'creality-enclosed',
    name: 'Séries Caisson Fermé / Éducation',
    subCategories: [
      {
        id: 'sermoon',
        name: 'Série Sermoon',
        models: ['Sermoon D1', 'Sermoon D3', 'Sermoon D3 Pro', 'Sermoon V1', 'Sermoon V1 Pro']
      },
      {
        id: 'cr-200',
        name: 'Série CR-200',
        models: ['CR-200B', 'CR-200B Pro']
      }
    ]
  },
  {
    id: 'creality-multi',
    name: 'Série Beluga / Multi-couleurs',
    subCategories: [
      {
        id: 'cfs',
        name: 'Système Multi-filaments',
        models: ['CFS (system multi-filaments)']
      }
    ]
  },
  {
    id: 'creality-special',
    name: 'Imprimantes Spéciales / Archivées',
    subCategories: [
      {
        id: 'special',
        name: 'Modèles Spéciaux',
        models: ['CR-8', 'CR-7']
      }
    ]
  }
];

export const CrealityConfigMenu: React.FC<CrealityConfigMenuProps> = ({
  selectedPrinter,
  onSelectPrinter,
  onPathChange,
  onWindowCountChange
}) => {
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null);

  const seriesRef = useRef<HTMLDivElement>(null);
  const subCatRef = useRef<HTMLDivElement>(null);
  const modelsRef = useRef<HTMLDivElement>(null);

  const activeSeries = CREALITY_DATA.find(s => s.id === selectedSeries);
  const activeSubCat = activeSeries?.subCategories.find(sc => sc.id === selectedSubCat);

  useEffect(() => {
    let count = 2; // Base 2 windows (Manufacturers -> Creality series)
    let path = 'Profils imprimante\\[Autres fabricants\\> Creality';

    if (selectedSeries) {
      count = 3;
      path += `\\> ${activeSeries?.name}`;
      if (selectedSubCat) {
        count = 4;
        path += `\\> ${activeSubCat?.name}`;
      }
    }
    path += ']';

    onPathChange(path);
    onWindowCountChange(count);
  }, [selectedSeries, selectedSubCat]);

  return (
    <>
      {/* Series Window */}
      <div className={styles.fusionMenuContainer} style={{ left: 'calc(200px + 195px + 12px)' }}>
        <div ref={seriesRef} className={styles.fusionMenuContent}>
          <div className={styles.sectionGroup}>
            <h4 className={styles.sectionTitle}>Séries</h4>
            <ul className={styles.itemsList}>
              {CREALITY_DATA.map(series => {
                const isSelected = selectedSeries === series.id;
                return (
                  <CustomTooltip key={series.id} content={series.name} description="">
                    <li 
                      className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                      onClick={() => {
                        setSelectedSeries(series.id);
                        setSelectedSubCat(null);
                      }}
                    >
                      <span className={styles.itemName}>{series.name}</span>
                      <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                    </li>
                  </CustomTooltip>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Sub-categories Window */}
      {selectedSeries && activeSeries && (
        <div className={styles.thirdPopup} style={{ left: 'calc(200px + 195px + 12px + 195px + 12px)' }}>
          <div ref={subCatRef} className={styles.patternPopupContent}>
            <div className={styles.sectionGroup}>
              <h4 className={styles.sectionTitle}>Sous-familles</h4>
              <ul className={styles.itemsList}>
                {activeSeries.subCategories.map(sc => {
                  const isSelected = selectedSubCat === sc.id;
                  return (
                    <CustomTooltip key={sc.id} content={sc.name} description="">
                      <li 
                        className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                        onClick={() => setSelectedSubCat(sc.id)}
                      >
                        <span className={styles.itemName}>{sc.name}</span>
                        <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                      </li>
                    </CustomTooltip>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Models Window */}
      {selectedSubCat && activeSubCat && (
        <div className={styles.fourthPopup} style={{ left: 'calc(200px + 195px + 12px + 195px + 12px + 195px + 12px)' }}>
          <div ref={modelsRef} className={styles.patternPopupContent}>
            <div className={styles.sectionGroup}>
              <h4 className={styles.sectionTitle}>Modèles</h4>
              <ul className={styles.itemsList}>
                {activeSubCat.models.map(modelName => {
                  const isSelected = selectedPrinter === modelName;
                  return (
                    <CustomTooltip key={modelName} content={modelName} description="">
                      <li 
                        className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                        onClick={() => {
                          onSelectPrinter(modelName);
                          showSuccess(`Imprimante active : ${modelName}`);
                        }}
                      >
                        <span className={styles.itemName}>{modelName}</span>
                        {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                      </li>
                    </CustomTooltip>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
};