import React from 'react';
import { motion } from 'framer-motion';
import { menuItemEnterVariants } from './categoryMenuMotion';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { ApexNumberField } from './ApexNumberField';
import { CustomTooltip } from './CustomTooltip';
import styles from './CategoriesSidebar.module.scss';
import {
  ENUM_LABELS, boundsOf, getEngineSetting, getEngineSettingValue, setEngineSettingValue, tooltipOf, useEngineSettings,
} from '@/utils/engineSettings';

/**
 * Ligne ACTIVE des menus de catégorie de gauche (Préparation) : le même réglage du moteur que dans
 * Paramètres › Algorithme (avancé), lu et écrit dans le même magasin (utils/engineSettings.ts), donc toujours
 * synchronisé. Libellé, bornes et infobulle viennent du moteur. Un réglage énuméré (motif de remplissage) ouvre
 * sa liste de choix par `onOpenChoices`.
 */
export const EngineItemRow: React.FC<{ path: string; onOpenChoices?: (() => void) | undefined }> = ({ path, onOpenChoices }) => {
  useEngineSettings(); // re-rendu à chaque changement d'un réglage
  const setting = getEngineSetting(path);
  if (!setting) return null;
  const value = getEngineSettingValue(setting);
  const { min, max } = boundsOf(setting);
  const tooltip = tooltipOf(setting);

  let control: React.ReactNode;
  if (setting.type === 'string' && setting.enum) {
    control = (
      <span className={styles.choiceValue}>
        {ENUM_LABELS[String(value)] ?? String(value)}
        <ChevronDown size={14} className="shrink-0 text-white/40 -rotate-90 ml-1" />
      </span>
    );
  } else {
    // Densité : fraction du moteur (0,05 à 1) affichée en pourcentage.
    const percent = setting.unit === 'fraction';
    const k = percent ? 100 : 1;
    control = (
      <ApexNumberField
        className={styles.compactField}
        value={typeof value === 'number' ? Math.round(value * k * 1e6) / 1e6 : null}
        onChange={(v) => setEngineSettingValue(setting, v === null ? null : v / k)}
        min={min * k}
        max={max === null ? undefined : max * k}
        step={(setting.step ?? 1) * k}
        nullable={setting.type === 'number|null'}
        placeholder={setting.type === 'number|null' ? 'aucune' : undefined}
        suffix={percent ? '%' : setting.unit && setting.unit.length <= 8 ? setting.unit : undefined}
        ariaLabel={setting.label}
      />
    );
  }

  return (
    <CustomTooltip content={setting.label} description={tooltip.desc}>
      <motion.li
        variants={menuItemEnterVariants}
        className={clsx(styles.itemRow, styles.engineRow, { [styles.clickableRow]: !!onOpenChoices })}
        onClick={onOpenChoices}
      >
        <span className={clsx(styles.itemName, styles.itemNameWrap)}>{setting.label}</span>
        {control}
      </motion.li>
    </CustomTooltip>
  );
};
