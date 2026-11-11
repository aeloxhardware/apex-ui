import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { CustomTooltip } from './CustomTooltip';
import { ApexNumberField } from './ApexNumberField';
import { ENGINE_ALGORITHM, SLICING_MODES, SLICING_MODE_LOGOS, isSlicingModeAvailable, useSlicingMode } from '@/utils/slicingMode';
import { AEOLIS_NOZZLE_BOUNDS, setAeolisNozzle, useAeolisNozzle } from '@/utils/aeolisNozzle';
import styles from './EngineSettingsPanel.module.scss';

/**
 * Espace Préparation, à droite : panneau « Réglages Apex ». Les réglages du moteur n'y figurent plus (demande de
 * l'utilisateur, 2026-10-29) : ils sont dans Paramètres › Algorithme (avancé), voir EngineSettingsEditor.
 */
export const EngineSettingsPanel: React.FC = () => {
  // Sélecteur vide pour l'instant : même fonctionnement que celui du motif de remplissage (CategoriesSidebar), en miroir
  // (flèche à gauche, liste qui sort à gauche du panneau).
  const [selectorOpen, setSelectorOpen] = useState(false);
  const { axisMode, mode, setMode } = useSlicingMode();
  const nozzle = useAeolisNozzle();
  const isAeolis = ENGINE_ALGORITHM[mode] === 'element-aeolis';
  const logo = (option: string) => (
    <span className={styles.modeLogo} aria-hidden style={{ maskImage: `url(${SLICING_MODE_LOGOS[option]})`, WebkitMaskImage: `url(${SLICING_MODE_LOGOS[option]})` }} />
  );
  const chooseMode = (next: string) => {
    if (!isSlicingModeAvailable(next, axisMode)) return;
    setMode(next);
    setSelectorOpen(false);
  };
  return (
  <div className={styles.container} data-apex-chrome-panel>
    <aside className={styles.panel} aria-label="Réglages Apex"
      data-apex-tooltip="Panneau de réglages propres à Apex.">
      <div className={styles.header}>
        <h2 className={styles.title}>Réglages Apex</h2>
      </div>
      <CustomTooltip content="Mode de tranchage" description="Choisissez parmi différents algorithmes de tranchage de couches afin d'assurer une génération adaptée à l'objet.">
        <div className={clsx(styles.selectorRow, { [styles.selectorOpen]: selectorOpen })} role="button" tabIndex={0}
          onClick={() => setSelectorOpen((open) => !open)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectorOpen((open) => !open); } }}>
          <ChevronDown size={14} className="shrink-0 text-white/40 rotate-90 mr-2" />
          <span className={styles.selectorLabel}>Mode de tranchage</span>
          <span className={styles.selectorValue}>{mode.split(' - ')[0]}{logo(mode)}</span>
        </div>
      </CustomTooltip>
      {isAeolis && (
        <>
          <CustomTooltip content="Angle max. buse-paroi" description="Pente maximale, depuis l'horizontale, de la surface déjà imprimée autour de la pointe de la buse (0° : épaule plate, 90° : aiguille). Détermine ce que la tête peut atteindre sans toucher la matière voisine : Element Aeolis ne garde le tranchage « surface en hauteur » que si les couches respectent cette limite. Par défaut 10° (très bas, pour ne pas casser une imprimante à conduits de ventilation serrés) ; à relever pour une tête dégagée.">
            <div className={styles.settingRow}>
              <span className={styles.selectorLabel}>Angle max. buse-paroi</span>
              <ApexNumberField className={styles.settingField} value={nozzle.angleDeg} onChange={(v) => setAeolisNozzle({ angleDeg: v ?? undefined })}
                min={AEOLIS_NOZZLE_BOUNDS.angleDeg.min} max={AEOLIS_NOZZLE_BOUNDS.angleDeg.max} step={AEOLIS_NOZZLE_BOUNDS.angleDeg.step} suffix="°" ariaLabel="Angle max. buse-paroi" />
            </div>
          </CustomTooltip>
          <CustomTooltip content="Longueur de la buse" description="Longueur maximale atteignable par la buse : longueur de buse sous le conduit de ventilation, c'est-à-dire le dénivelé maximal toléré entre la pointe et la matière voisine plus haute. Avec l'angle de la buse, elle borne les couches qu'Element Aeolis peut trancher en surface en hauteur ; au-delà, le moteur passe au tranchage général. Par défaut 2 mm.">
            <div className={styles.settingRow}>
              <span className={styles.selectorLabel}>Longueur de la buse</span>
              <ApexNumberField className={styles.settingField} value={nozzle.reachMm} onChange={(v) => setAeolisNozzle({ reachMm: v ?? undefined })}
                min={AEOLIS_NOZZLE_BOUNDS.reachMm.min} max={AEOLIS_NOZZLE_BOUNDS.reachMm.max} step={AEOLIS_NOZZLE_BOUNDS.reachMm.step} suffix="mm" ariaLabel="Longueur de la buse" />
            </div>
          </CustomTooltip>
        </>
      )}
    </aside>

    <AnimatePresence>
      {selectorOpen && (
        <motion.div
          className={styles.selectorPopup}
          initial={{ scale: 0.95, x: 10 }}
          animate={{ scale: 1, x: 0 }}
          exit={{ scale: 0.95, x: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Le verre fait son propre fondu : un parent translucide désactiverait son flou. */}
          <motion.div className={styles.selectorGlass} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div className={styles.selectorContent} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <h4 className={styles.selectorTitle}>Mode de tranchage</h4>
            <ul className={styles.selectorList}>
              {SLICING_MODES.map((option) => {
                const available = isSlicingModeAvailable(option, axisMode);
                return (
                  <CustomTooltip key={option} content={option} description={available
                    ? `Mode de tranchage « ${option} » : le moteur le lance (algorithme ${ENGINE_ALGORITHM[option]}).`
                    : ENGINE_ALGORITHM[option]
                      ? `Mode de tranchage « ${option} » : réservé au mode dev en 3 axes, donc inactif.`
                      : `Mode de tranchage « ${option} » : pas encore implémenté dans le moteur, donc inactif.`}>
                    <li className={clsx(styles.selectorItem, { [styles.selectorItemActive]: mode === option, [styles.selectorItemDisabled]: !available })}
                      aria-disabled={!available} onClick={() => chooseMode(option)}>
                      <span className={styles.modeLabel}>{logo(option)}{option}</span>
                      {mode === option && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                    </li>
                  </CustomTooltip>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
  );
};
