import React from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence, type MotionStyle } from 'framer-motion';
import { Check } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { EngineItemRow } from './EngineItemRow';
import { FadeScroller } from './FadeScroller';
import { menuEnterVariants, menuItemEnterVariants } from './categoryMenuMotion';
import { InfillPatternIcon } from './InfillPatternIcon';
import { ENGINE_PATTERN_ICON, ORCA_ONLY_PATTERNS } from '@/utils/orcaInfillPatterns';
import { ENUM_DESCRIPTIONS, ENUM_LABELS, getEngineSetting, getEngineSettingValue, setEngineSettingValue } from '@/utils/engineSettings';
import styles from './CategoriesSidebar.module.scss';
import { PILL_TOP, ELEMENTS_FADE_MS } from '@/utils/spaceMorphGeometry';
import { CATEGORIES, type CategoryItem } from './categoriesData';
import { pillIconsContainerVariants, pillIconVariants } from './categoriesMotion';
import type { useExternalScrollThumb } from '@/hooks/use-external-scroll-thumb';
import type { MorphPhase, PreviewSpace } from './categoriesPreviewState';

type ScrollThumb = ReturnType<typeof useExternalScrollThumb>;

/** Fenêtre des motifs de remplissage, à côté du menu. */
const PatternPopup: React.FC<{ contentRef: React.RefObject<HTMLDivElement | null>; thumb: ScrollThumb; onClose: () => void }> = ({ contentRef, thumb, onClose }) => {
  const patternSetting = getEngineSetting('toolpath2d.infill_pattern');
  return (
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
                    ref={contentRef}
                    className={styles.patternPopupContent}
                    onScroll={thumb.handleScroll}
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
                                  onClose();
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

                  {thumb.hasScroll && (
                    <div 
                      className={clsx(styles.externalScrollThumb, { [styles.dragging]: thumb.isDragging })}
                      onMouseDown={thumb.handleMouseDown}
                      style={{
                        height: `${thumb.thumbHeight}px`,
                        top: `${thumb.thumbTop}px`
                      }}
                    />
                  )}
                </motion.div>
  );
};

interface CategoryPillProps {
  modelTreeOverflow: number;
  space: PreviewSpace;
  morphPhase: MorphPhase;
  wasArrivingFromModeling: boolean;
  leavingToModeling: boolean;
  activeCategory: string | null;
  onCategoryClick: (cat: CategoryItem) => void;
  iconRefs: React.MutableRefObject<{ [key: string]: HTMLButtonElement | null }>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
}

/** Pilule des catégories de réglages (icônes) ; sa forme est reprise par les morphs de Prévisualisation et de Modélisation. */
export const CategoryPill: React.FC<CategoryPillProps> = ({
  modelTreeOverflow, space, morphPhase, wasArrivingFromModeling, leavingToModeling, activeCategory, onCategoryClick,
  iconRefs, toolbarRef, onWheel,
}) => {
  const { previewActive, previewPanelsBorn, previewMorphPhase, enteringPreview } = space;
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
              data-apex-tooltip="Catégories de réglages de découpe (qualité, solidité, vitesse…) : cliquez une icône pour ouvrir ses paramètres."
              className={clsx(styles.categoriesToolbar, {
                [styles.morphing]: morphPhase !== null || previewMorphPhase !== null,
              })}
              onWheel={onWheel}
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
              <FadeScroller ref={toolbarRef} className={styles.categoriesScroll}>
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
                        onClick={() => onCategoryClick(cat)}
                      >
                        <span className={styles.categoryLabel}>{cat.label}</span>
                      </motion.button>
                    </CustomTooltip>
                  );
                })}
              </motion.div>
              </FadeScroller>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
  );
};

interface PreviewPanelsProps {
  space: PreviewSpace;
  leavingToModeling: boolean;
  wasInitialPreviewActive: boolean;
  previewUpperContent?: React.ReactNode;
  previewLowerHeader?: React.ReactNode;
  previewLowerContent?: React.ReactNode;
  previewBelowContent?: React.ReactNode;
}

/** Panneaux de Prévisualisation, nés de la mitose : haut (légende / édition), bas (infos G-code) et carte sous les panneaux. */
export const PreviewPanels: React.FC<PreviewPanelsProps> = ({
  space, leavingToModeling, wasInitialPreviewActive, previewUpperContent, previewLowerHeader, previewLowerContent, previewBelowContent,
}) => {
  const { previewActive, previewPanelsBorn, previewMorphPhase, tab, editionLayout, tabMorph, lowerKey, lowerRef } = space;
  return (
    <>
      {previewActive && previewPanelsBorn && (
        <React.Fragment key="preview-panels">
          <div
            data-scroll-edge
            data-apex-tooltip="Panneau de l'espace Prévisualisation : onglets Coloration, Édition et Fonction pour analyser et modifier le G-code affiché."
            className={clsx(styles.previewPanelUpper, {
              [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb' || tabMorph === 'release',
              [styles.previewPanelUpperExpanded]: editionLayout,
            })}
          >
            {/* Le contenu s'efface dès le clic vers Modélisation : seule la forme du panneau est
                reprise par ModelingSidebar. */}
            {previewUpperContent && (
              <motion.div
                className={clsx(styles.previewPanelBody, {
                  // Le contenu de l'onglet n'apparaît qu'une fois le panneau à sa forme finale.
                  [styles.previewPanelBodyWaiting]: tabMorph !== null || (tab === 'edition') !== editionLayout,
                })}
                animate={{ opacity: leavingToModeling ? 0 : 1 }}
                transition={{ duration: ELEMENTS_FADE_MS / 1000, ease: 'easeInOut' }}
              >
                {previewUpperContent}
              </motion.div>
            )}
          </div>
          {/* Fusionné dans le panneau du haut en mode Édition : démonté, puis remonté (ses éléments
              réapparaissent en cascade) au retour à Coloration. */}
          {(!editionLayout || tabMorph === 'cascade' || tabMorph === 'absorb') && (
            <motion.div
              key={`lower-${lowerKey}`}
              ref={lowerRef}
              data-apex-tooltip="Panneau d'informations du G-code affiché : légende et réglages d'affichage du tracé."
              className={clsx(styles.previewPanelLower, {
                [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb',
              })}
              initial={wasInitialPreviewActive && lowerKey === 0 ? { opacity: 0, x: -20 } : false}
              animate={{
                opacity: leavingToModeling ? 0 : 1,
                x: leavingToModeling ? -20 : 0,
                transition: { duration: ELEMENTS_FADE_MS / 1000, ease: 'easeInOut' },
              }}
            >
              {previewLowerHeader && <div className={styles.previewPanelHeader} data-cascade="header">{previewLowerHeader}</div>}
              {previewLowerContent && <div className={styles.previewPanelFooter} data-cascade="footer">{previewLowerContent}</div>}
            </motion.div>
          )}
          {/* Opacité seule (jamais de transform) : le contenu est en `position: fixed`. */}
          {previewBelowContent && (
            <motion.div
              className={clsx(styles.previewBelow, { [styles.morphing]: previewMorphPhase === 'reverse' })}
              animate={{ opacity: leavingToModeling ? 0 : 1 }}
              transition={{ duration: ELEMENTS_FADE_MS / 1000, ease: 'easeInOut' }}
            >
              {previewBelowContent}
            </motion.div>
          )}
        </React.Fragment>
      )}
    </>
  );
};

interface CategoryMenuProps {
  /** Joue l'entrée séquentielle ci-dessus ; faux au retour d'un morphing (le verre animé tient lieu d'entrée). */
  animateIn: boolean;
  activeCatData: CategoryItem | undefined;
  previewActive: boolean;
  menuContainerRef: React.RefObject<HTMLDivElement | null>;
  morphPhase: MorphPhase;
  modelTreeOverflow: number;
  contentRef: React.RefObject<HTMLDivElement | null>;
  thumb: ScrollThumb;
  patternContentRef: React.RefObject<HTMLDivElement | null>;
  patternThumb: ScrollThumb;
  isPatternPopupOpen: boolean;
  setIsPatternPopupOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Menu détaillé d'une catégorie (réglages du moteur) et sa fenêtre de motifs. */
export const CategoryMenu: React.FC<CategoryMenuProps> = ({
  animateIn, activeCatData, previewActive, menuContainerRef, morphPhase, modelTreeOverflow, contentRef, thumb,
  patternContentRef, patternThumb, isPatternPopupOpen, setIsPatternPopupOpen,
}) => (
      <AnimatePresence>
        {activeCatData && !activeCatData.disabled && !previewActive && (
          <>
            {/* Toujours ouvert/fermé par un morphing : pas d'animation d'entrée ni de sortie
                propre, le verre animé en tient lieu (.morphing masque le fond de ce panneau et
                estompe son contenu pendant ce temps). */}
            <motion.div
              ref={menuContainerRef}
              className={clsx(styles.fusionMenuContainer, {
                [styles.morphing]: morphPhase !== null,
              })}
              // Le menu suit la pilule quand l'arborescence des modèles / la carte Filament la repoussent.
              style={{
                '--menu-top': `${266 + modelTreeOverflow}px`,
                ...(modelTreeOverflow > 0 ? { top: 266 + modelTreeOverflow } : {}),
              } as MotionStyle}
              variants={menuEnterVariants}
              initial={animateIn && morphPhase === null ? 'hidden' : false}
              animate="shown"
              exit={{ opacity: 0, transition: { duration: 0 } }}
            >
              <div
                ref={contentRef}
                className={styles.fusionMenuContent}
                onScroll={thumb.handleScroll}
              >
                {/* Portée des réglages, comme « Global / Objets » d'OrcaSlicer. Les réglages par objet n'existent
                    pas encore côté moteur : « Par objet » est visible mais inactif. */}
                <motion.div variants={menuItemEnterVariants} className={styles.scopeSwitch}>
                  <CustomTooltip content="Global" description="Les réglages s'appliquent à tout le plateau.">
                    <button type="button" className={clsx(styles.scopeButton, styles.scopeActive)}>Global</button>
                  </CustomTooltip>
                  <CustomTooltip content="Arrive bientôt" description="Réglages propres à chaque objet du plateau, qui remplacent les réglages globaux pour cet objet.">
                    <button type="button" className={clsx(styles.scopeButton, styles.scopeInert)} aria-disabled="true" tabIndex={-1}>Par objet</button>
                  </CustomTooltip>
                </motion.div>
                {activeCatData.sections.map((section, idx) => (
                  <div key={idx} className={styles.sectionGroup}>
                    <motion.h4 variants={menuItemEnterVariants} className={styles.sectionTitle}>{section.title}</motion.h4>
                    <ul className={styles.itemsList}>
                      {section.items.map((item, iIdx) => item.engine ? (
                        <EngineItemRow
                          key={item.engine}
                          path={item.engine}
                          onOpenChoices={getEngineSetting(item.engine)?.enum ? () => setIsPatternPopupOpen((open) => !open) : undefined}
                        />
                      ) : (
                        <CustomTooltip key={iIdx} content="Arrive bientôt" description={item.description}>
                          <motion.li variants={menuItemEnterVariants} className={clsx(styles.itemRow, styles.itemRowInert)}>
                            <span className={styles.itemName}>{item.label}</span>
                            <input
                              type="text"
                              defaultValue={item.defaultValue}
                              className={styles.itemInput}
                              readOnly
                              tabIndex={-1}
                            />
                          </motion.li>
                        </CustomTooltip>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {thumb.hasScroll && (
                <div 
                  className={clsx(styles.externalScrollThumb, { [styles.dragging]: thumb.isDragging })}
                  onMouseDown={thumb.handleMouseDown}
                  style={{
                    height: `${thumb.thumbHeight}px`,
                    top: `${thumb.thumbTop}px`
                  }}
                />
              )}
            </motion.div>

            {/* Pattern popup window next to the menu */}
            <AnimatePresence>
              {isPatternPopupOpen && (
                <PatternPopup contentRef={patternContentRef} thumb={patternThumb} onClose={() => setIsPatternPopupOpen(false)} />
              )}
            </AnimatePresence>
          </>
        )}
      </AnimatePresence>
);
