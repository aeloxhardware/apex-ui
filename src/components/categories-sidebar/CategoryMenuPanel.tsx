import { motion } from 'framer-motion';
import clsx from 'clsx';
import styles from '../CategoriesSidebar.module.scss';
import { CustomTooltip } from '../CustomTooltip';
import { EngineItemRow } from '../EngineItemRow';
import { getEngineSetting } from '@/utils/engineSettings';
import type { CategoryItem } from './constants';
import type React from 'react';

interface CategoryMenuPanelProps {
  menuContainerRef: React.RefObject<HTMLDivElement>;
  morphPhase: "dividing" | "merging";
  modelTreeOverflow: number;
  contentRef: React.RefObject<HTMLDivElement>;
  handleScroll: () => void;
  activeCatData: CategoryItem;
  setIsPatternPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasScroll: boolean;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  thumbHeight: number;
  thumbTop: number;
}

/** Panneau détaillé de la catégorie ouverte. */
export function CategoryMenuPanel({ menuContainerRef, morphPhase, modelTreeOverflow, contentRef, handleScroll, activeCatData, setIsPatternPopupOpen, hasScroll, isDragging, handleMouseDown, thumbHeight, thumbTop }: CategoryMenuPanelProps) {
  return (
    <motion.div
      ref={menuContainerRef}
      className={clsx(styles.fusionMenuContainer, {
        [styles.morphing]: morphPhase !== null,
      })}
      // Le menu suit la pilule quand l'arborescence des modèles / la carte Filament la repoussent.
      style={modelTreeOverflow > 0 ? { top: 280 + modelTreeOverflow } : undefined}
      initial={false}
      exit={{ opacity: 0 }}
      transition={{ duration: 0 }}
    >
      <div
        ref={contentRef}
        className={styles.fusionMenuContent}
        onScroll={handleScroll}
      >
        {/* Portée des réglages, comme « Global / Objets » d'OrcaSlicer. Les réglages par objet n'existent
            pas encore côté moteur : « Par objet » est visible mais inactif. */}
        <div className={styles.scopeSwitch}>
          <CustomTooltip content="Global" description="Les réglages s'appliquent à tout le plateau.">
            <button type="button" className={clsx(styles.scopeButton, styles.scopeActive)}>Global</button>
          </CustomTooltip>
          <CustomTooltip content="Arrive bientôt" description="Réglages propres à chaque objet du plateau, qui remplacent les réglages globaux pour cet objet.">
            <button type="button" className={clsx(styles.scopeButton, styles.scopeInert)} aria-disabled="true" tabIndex={-1}>Par objet</button>
          </CustomTooltip>
        </div>
        {activeCatData.sections.map((section, idx) => (
          <div key={idx} className={styles.sectionGroup}>
            <h4 className={styles.sectionTitle}>{section.title}</h4>
            <ul className={styles.itemsList}>
              {section.items.map((item, iIdx) => item.engine ? (
                <EngineItemRow
                  key={item.engine}
                  path={item.engine}
                  onOpenChoices={getEngineSetting(item.engine)?.enum ? () => setIsPatternPopupOpen((open) => !open) : undefined}
                />
              ) : (
                <CustomTooltip key={iIdx} content="Arrive bientôt" description={item.description}>
                  <li className={clsx(styles.itemRow, styles.itemRowInert)}>
                    <span className={styles.itemName}>{item.label}</span>
                    <input
                      type="text"
                      defaultValue={item.defaultValue}
                      className={styles.itemInput}
                      readOnly
                      tabIndex={-1}
                    />
                  </li>
                </CustomTooltip>
              ))}
            </ul>
          </div>
        ))}
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
  );
}
