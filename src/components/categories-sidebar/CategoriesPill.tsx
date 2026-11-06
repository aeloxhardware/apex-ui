import styles from '../CategoriesSidebar.module.scss';
import { PILL_TOP } from '@/utils/spaceMorphGeometry';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { CustomTooltip } from '../CustomTooltip';
import { pillIconsContainerVariants, CATEGORIES, pillIconVariants } from './constants';
import type { CategoryItem } from './constants';
import type React from 'react';

interface CategoriesPillProps {
  modelTreeOverflow: number;
  previewActive: boolean;
  previewPanelsBorn: boolean;
  previewMorphPhase: "forward" | "reverse";
  categoriesToolbarRef: React.RefObject<HTMLDivElement>;
  morphPhase: "dividing" | "merging";
  handleCategoriesWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  wasArrivingFromModeling: boolean;
  leavingToModeling: boolean;
  enteringPreview: boolean;
  activeCategory: string;
  iconRefs: React.RefObject<{ [key: string]: HTMLButtonElement; }>;
  handleCategoryClick: (cat: CategoryItem) => void;
}

/** Pilule des catégories de réglages (barre d'icônes défilante). */
export function CategoriesPill({ modelTreeOverflow, previewActive, previewPanelsBorn, previewMorphPhase, categoriesToolbarRef, morphPhase, handleCategoriesWheel, wasArrivingFromModeling, leavingToModeling, enteringPreview, activeCategory, iconRefs, handleCategoryClick }: CategoriesPillProps) {
  return (
    <div
      className={styles.leftSidebarContainer}
      data-apex-chrome-panel
      style={modelTreeOverflow > 0 ? { top: PILL_TOP + modelTreeOverflow } : undefined}
    >
      <AnimatePresence>
        {/* En Prévisualisation, la pilule reste démontée tant que les deux panneaux existent
            (elle EST devenue le panneau du haut) ; elle remonte (sans fond, cf. .morphing) dès
            que la fusion inverse démarre, jusqu'à avoir repris sa forme. */}
        {(!previewActive || !previewPanelsBorn || previewMorphPhase === 'reverse') && (
          <motion.div
            ref={categoriesToolbarRef}
            data-apex-tooltip="Catégories de réglages de découpe (qualité, solidité, vitesse…) : cliquez une icône pour ouvrir ses paramètres."
            className={clsx(styles.categoriesToolbar, {
              [styles.morphing]: morphPhase !== null || previewMorphPhase !== null,
            })}
            onWheel={handleCategoriesWheel}
            // La pilule elle-même (sa forme de verre) ne s'estompe JAMAIS autour d'un morph de
            // Modélisation : c'est elle que ModelingSidebar reprend à l'identique pour la
            // déformer (même commit, cf. Index.tsx). Au retour d'un morph de sortie
            // (wasArrivingFromModeling), elle est donc déjà opaque dès son montage : ModelingSidebar
            // vient de prendre exactement sa forme.
            initial={wasArrivingFromModeling ? false : { opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{
              opacity: { duration: 0.9, ease: 'linear' },
              x: { duration: 0.9, ease: 'easeInOut' },
            }}
          >
            {/* Seules les icônes suivent l'espace : cascade de disparition dès le clic vers
                Modélisation (leavingToModeling) ou vers Prévisualisation (enteringPreview),
                ~900ms avant que la pilule ne soit reprise par ModelingSidebar ou ne commence à
                s'étirer en panneaux (tous deux sous le rideau, à `onCovered`) ; cascade
                d'apparition au retour d'un morph de sortie (wasArrivingFromModeling), une fois la
                déformation terminée. Hors de ces cas, `animate="visible"` sans délai, comme un
                menu statique normal. */}
            <motion.div
              variants={pillIconsContainerVariants}
              // Pendant la déformation inverse (Prévisualisation → Préparation), les icônes
              // restent masquées et n'apparaissent en cascade qu'une fois la pilule reformée.
              initial={wasArrivingFromModeling || previewMorphPhase === 'reverse' ? 'hidden' : false}
              animate={leavingToModeling || enteringPreview || previewMorphPhase === 'reverse' ? 'hidden' : 'visible'}
              style={{ display: 'contents' }}
            >
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <CustomTooltip
                    key={cat.id}
                    content={cat.label}
                    description={cat.description}
                  >
                    <motion.button
                      ref={(el) => { iconRefs.current[cat.id] = el; }}
                      variants={pillIconVariants}
                      className={clsx(styles.categoryButton, {
                        [styles.active]: isActive,
                      })}
                      onClick={() => handleCategoryClick(cat)}
                    >
                      {cat.icon}
                      <span className={styles.categoryLabel}>{cat.label}</span>
                    </motion.button>
                  </CustomTooltip>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
