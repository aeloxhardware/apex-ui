import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { CustomTooltip } from '../CustomTooltip';
import styles from '../PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

interface GenericManufacturerConfigMenuProps {
  manufacturerName: string;
  models: string[];
  selectedPrinter: string;
  onSelectPrinter: (name: string) => void;
  onPathChange: (path: string) => void;
  onWindowCountChange: (count: number) => void;
}

export const GenericManufacturerConfigMenu: React.FC<GenericManufacturerConfigMenuProps> = ({
  manufacturerName,
  models,
  selectedPrinter,
  onSelectPrinter,
  onPathChange,
  onWindowCountChange
}) => {
  const modelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onPathChange(`Profils imprimante\\[Autres fabricants\\> ${manufacturerName}]`);
    onWindowCountChange(2);
  }, [manufacturerName]);

  return (
    <div className={styles.patternPopup} style={{ left: 'calc(200px + 195px + 12px)' }}>
      <div ref={modelsRef} className={styles.patternPopupContent}>
        <div className={styles.sectionGroup}>
          <h4 className={styles.sectionTitle}>Modèles</h4>
          <ul className={styles.itemsList}>
            {models.map(modelName => {
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
  );
};