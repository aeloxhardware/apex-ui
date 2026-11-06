import { AnimatePresence, motion } from 'framer-motion';
import styles from '../CategoriesSidebar.module.scss';
import { getEngineSettingValue, ENUM_LABELS, ENUM_DESCRIPTIONS, setEngineSettingValue } from '@/utils/engineSettings';
import { CustomTooltip } from '../CustomTooltip';
import clsx from 'clsx';
import { InfillPatternIcon } from '../InfillPatternIcon';
import { ENGINE_PATTERN_ICON, ORCA_ONLY_PATTERNS } from '@/utils/orcaInfillPatterns';
import { Check } from 'lucide-react';
import type { EngineSetting } from '@/utils/engineSettings';
import type React from 'react';

interface PatternPopupProps {
  isPatternPopupOpen: boolean;
  patternContentRef: React.RefObject<HTMLDivElement>;
  handlePatternScroll: () => void;
  patternSetting: EngineSetting;
  setIsPatternPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasPatternScroll: boolean;
  isPatternDragging: boolean;
  handlePatternMouseDown: (e: React.MouseEvent) => void;
  patternThumbHeight: number;
  patternThumbTop: number;
}

/** Fenêtre de choix du motif de remplissage. */
export function PatternPopup({ isPatternPopupOpen, patternContentRef, handlePatternScroll, patternSetting, setIsPatternPopupOpen, hasPatternScroll, isPatternDragging, handlePatternMouseDown, patternThumbHeight, patternThumbTop }: PatternPopupProps) {
  return (
    <AnimatePresence>
      {isPatternPopupOpen && (
        <motion.div
          className={styles.patternPopup}
          // Le verre (.patternGlass) fait son propre fondu : un parent translucide désactiverait son flou.
          initial={{ scale: 0.95, x: -10 }}
          animate={{ scale: 1, x: 0 }}
          exit={{ scale: 0.95, x: -10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className={styles.patternGlass}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            ref={patternContentRef}
            className={styles.patternPopupContent}
            onScroll={handlePatternScroll}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.sectionGroup}>
              <h4 className={styles.sectionTitle}>Motifs de remplissage</h4>
              <ul className={styles.itemsList}>
                {patternSetting?.enum?.map((option) => {
                  const isSelected = getEngineSettingValue(patternSetting) === option;
                  return (
                    <CustomTooltip key={option} content={ENUM_LABELS[option] ?? option} description={ENUM_DESCRIPTIONS[option] ?? ''}>
                      <li
                        className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                        onClick={() => {
                          setEngineSettingValue(patternSetting, option);
                          setIsPatternPopupOpen(false);
                        }}
                      >
                        <span className={styles.patternName}>
                          <InfillPatternIcon pattern={ENGINE_PATTERN_ICON[option] ?? option} />
                          <span className={styles.itemName}>{ENUM_LABELS[option] ?? option}</span>
                        </span>
                        {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                      </li>
                    </CustomTooltip>
                  );
                })}
                {/* Motifs d'OrcaSlicer que le moteur ne réalise pas encore : proposés, grisés. */}
                {ORCA_ONLY_PATTERNS.map((pattern) => (
                  <CustomTooltip key={pattern.key} content="Arrive bientôt" description={`${pattern.label} : motif d’OrcaSlicer pas encore pris en charge par le moteur d’Apex.`}>
                    <li className={clsx(styles.patternItem, styles.patternItemDisabled)} aria-disabled>
                      <span className={styles.patternName}>
                        <InfillPatternIcon pattern={pattern.key} />
                        <span className={styles.itemName}>{pattern.label}</span>
                      </span>
                    </li>
                  </CustomTooltip>
                ))}
              </ul>
            </div>
          </motion.div>

          {hasPatternScroll && (
            <div 
              className={clsx(styles.externalScrollThumb, { [styles.dragging]: isPatternDragging })}
              onMouseDown={handlePatternMouseDown}
              style={{
                height: `${patternThumbHeight}px`,
                top: `${patternThumbTop}px`
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
