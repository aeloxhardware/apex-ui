import React, { useState } from 'react';
import { Compass, Layers, RotateCcw, Route, Settings2, Shield, Waypoints, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ApexSlider } from './ApexSlider';
import { ApexNumberField } from './ApexNumberField';
import { CustomTooltip } from './CustomTooltip';
import styles from './EngineSettingsEditor.module.scss';
import {
  ENGINE_SETTINGS, ENGINE_SETTING_CATEGORIES, ENGINE_SETTING_CATEGORY_HELP, ENUM_LABELS, appDefaultOf, boundsOf, formatValue,
  getEngineSettingValue, tooltipOf,
  isEngineSettingModified, resetEngineSettings, setEngineSettingValue, setShowAdvancedSettings,
  useEngineSettings, type EngineSetting, type EngineSettingValue,
} from '@/utils/engineSettings';
import { useDevMode } from '@/utils/devModePrefs';

// Icône de chaque catégorie.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Lissage des couches': Layers,
  'Orientation de la tête': Compass,
  'Trajectoires': Route,
  'Collisions': Shield,
  'Déplacements': Waypoints,
  'Avancé': Settings2,
};

const NumberField: React.FC<{ setting: EngineSetting; value: EngineSettingValue }> = ({ setting, value }) => {
  const { min, max } = boundsOf(setting);
  return (
    <ApexNumberField
      value={typeof value === 'number' ? value : null}
      onChange={(v) => setEngineSettingValue(setting, v)}
      min={min}
      max={max ?? undefined}
      step={setting.step ?? 1}
      nullable={setting.type === 'number|null'}
      placeholder={setting.type === 'number|null' ? 'aucune' : undefined}
      ariaLabel={setting.label}
    />
  );
};

const SettingControl: React.FC<{ setting: EngineSetting }> = ({ setting }) => {
  const value = getEngineSettingValue(setting);
  if (setting.type === 'boolean') {
    return (
      <label className={styles.checkboxRow}>
        <input type="checkbox" className={styles.checkbox} checked={value === true}
          onChange={(e) => setEngineSettingValue(setting, e.target.checked)} />
        <span>{setting.label}</span>
      </label>
    );
  }
  const { min, max } = boundsOf(setting);
  let control: React.ReactNode;
  if (setting.type === 'string' && setting.enum) {
    control = (
      <div className={styles.segmented}>
        {setting.enum.map((option) => (
          <button key={option} type="button" className={clsx(styles.segment, { [styles.segmentActive]: value === option })}
            onClick={() => setEngineSettingValue(setting, option)}>
            {ENUM_LABELS[option] ?? option}
          </button>
        ))}
      </div>
    );
  } else if (setting.type === 'number' && max !== null) {
    control = (
      <ApexSlider
        value={typeof value === 'number' ? value : min}
        onChange={(v) => setEngineSettingValue(setting, v)}
        min={min}
        max={max}
        scale={setting.scale ?? 'linear'}
        step={setting.step ?? undefined}
        defaultValue={typeof appDefaultOf(setting) === 'number' ? (appDefaultOf(setting) as number) : undefined}
        format={(v) => formatValue(setting, v)}
        ariaLabel={setting.label}
      />
    );
  } else {
    control = <NumberField setting={setting} value={value} />;
  }
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <span className={styles.fieldLabel}>{setting.label}</span>
        {!(setting.type === 'number' && max !== null) && setting.type !== 'string' && setting.unit && setting.unit.length <= 8 && (
          <span className={styles.fieldUnit}>{setting.unit}</span>
        )}
      </div>
      {control}
    </div>
  );
};

/**
 * Réglages du moteur (liste, libellés, niveaux et bornes : utils/engineSettings.json, donnés par le moteur), regroupés
 * en catégories sélectionnées par une rangée de boutons. Les valeurs sont mémorisées et envoyées à chaque tranchage.
 * Affiché dans Paramètres › Algorithme (avancé) ; le panneau de droite de Préparation ne les porte plus.
 */
export const EngineSettingsEditor: React.FC = () => {
  const { showAdvanced } = useEngineSettings();
  const devMode = useDevMode();
  const [selected, setSelected] = useState<string>(ENGINE_SETTING_CATEGORIES[0]);

  const visible = (s: EngineSetting) =>
    s.level === 'user' || (s.level === 'advanced' && showAdvanced) || (s.level === 'developer' && devMode);
  const categories = ENGINE_SETTING_CATEGORIES
    .map((name) => ({ name, settings: ENGINE_SETTINGS.filter((s) => s.category === name && visible(s)) }))
    .filter((c) => c.settings.length > 0);
  // Une catégorie qui disparaît (réglages avancés décochés) cède la place à la première visible.
  const current = categories.find((c) => c.name === selected) ?? categories[0];
  const modified = current?.settings.some(isEngineSettingModified) ?? false;

  return (
    <div className={styles.editor}>
      <CustomTooltip inline content="Réglages avancés"
        description="Affiche les réglages de niveau avancé : ils modifient le comportement de l'algorithme et demandent de savoir ce qu'ils font ; chacun a son explication au survol.">
        <label className={styles.checkboxRow}>
          <input type="checkbox" className={styles.checkbox} checked={showAdvanced}
            onChange={(e) => setShowAdvancedSettings(e.target.checked)} />
          <span>Réglages avancés</span>
        </label>
      </CustomTooltip>

      <nav className={styles.tabs} aria-label="Catégories de réglages">
        {categories.map(({ name, settings }) => {
          const Icon = CATEGORY_ICONS[name] ?? Settings2;
          const active = current?.name === name;
          return (
            <CustomTooltip key={name} content={name} description={ENGINE_SETTING_CATEGORY_HELP[name] ?? name} inline>
              <button
                type="button"
                className={clsx(styles.tab, { [styles.tabActive]: active })}
                aria-pressed={active}
                onClick={() => setSelected(name)}
              >
                <Icon size={15} />
                <span>{name}</span>
                {settings.some(isEngineSettingModified) && <span className={styles.tabDot} />}
              </button>
            </CustomTooltip>
          );
        })}
      </nav>

      {current && (
        <div className={styles.categoryBody}>
          {current.settings.map((setting) => (
            <CustomTooltip key={setting.path} content={setting.label} description={tooltipOf(setting).desc}>
              <div className="w-full"><SettingControl setting={setting} /></div>
            </CustomTooltip>
          ))}
          {modified && (
            <CustomTooltip inline content="Rétablir cette catégorie"
              description="Remet les réglages de cette catégorie à la valeur de l'application (le défaut du moteur, sauf décision contraire de l'utilisateur).">
              <button type="button" className={styles.resetButton} onClick={() => resetEngineSettings(current.name)}>
                <RotateCcw size={12} /> Rétablir cette catégorie
              </button>
            </CustomTooltip>
          )}
        </div>
      )}
    </div>
  );
};
