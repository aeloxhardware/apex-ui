import React, { useState } from 'react';
import { Compass, Layers, RotateCcw, Route, Settings2, Shield, Waypoints, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ApexSlider } from './ApexSlider';
import styles from './EngineSettingsPanel.module.scss';
import {
  ENGINE_SETTINGS, ENGINE_SETTING_CATEGORIES, appDefaultOf, boundsOf, getEngineSettingValue,
  isEngineSettingModified, resetEngineSettings, setEngineSettingValue, setShowAdvancedSettings,
  useEngineSettings, type EngineSetting, type EngineSettingValue,
} from '@/utils/engineSettings';
import { useDevMode } from '@/utils/devModePrefs';

// Libellés des valeurs énumérées du moteur (jamais affichées brutes).
const ENUM_LABELS: Record<string, string> = {
  lines: 'Lignes', grid: 'Grille', crossed_zigzag: 'Zigzag croisé', oscillating_spiral: 'Spirale oscillante',
  tetgen: 'TetGen', tetranet: 'TetraNet',
};

// Icône de chaque catégorie dans la barre latérale.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Lissage des couches': Layers,
  'Orientation de la tête': Compass,
  'Trajectoires': Route,
  'Collisions': Shield,
  'Déplacements': Waypoints,
  'Avancé': Settings2,
};

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

function formatValue(setting: EngineSetting, value: EngineSettingValue): string {
  if (value === null) return 'aucune';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'string') return ENUM_LABELS[value] ?? value;
  if (setting.unit === 'fraction') return `${Math.round(value * 100)} %`;
  // Les unités longues (« facteur (× arête médiane²) ») vont dans l'infobulle, pas à côté de la valeur.
  return setting.unit && setting.unit.length <= 8 ? `${nf.format(value)} ${setting.unit}` : nf.format(value);
}

function tooltipOf(setting: EngineSetting) {
  const app = appDefaultOf(setting);
  const parts = [`Paramètre du moteur : ${setting.path}`];
  if (setting.unit) parts.push(`Unité : ${setting.unit}`);
  parts.push(`Défaut du moteur : ${formatValue(setting, setting.default)}`);
  if (app !== setting.default) parts.push(`Valeur de l'application : ${formatValue(setting, app)}`);
  return { title: setting.label, desc: `${parts.join(' · ')}.` };
}

const showTooltip = (setting: EngineSetting) => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: tooltipOf(setting) }));
const resetTooltip = () => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));

const NumberField: React.FC<{ setting: EngineSetting; value: EngineSettingValue }> = ({ setting, value }) => {
  const { min, max } = boundsOf(setting);
  return (
    <input
      type="number"
      className={styles.numberInput}
      min={min}
      max={max ?? undefined}
      step={setting.step ?? 1}
      value={value === null ? '' : String(value)}
      placeholder={setting.type === 'number|null' ? 'aucune' : undefined}
      onChange={(e) => {
        if (e.target.value === '') { if (setting.type === 'number|null') setEngineSettingValue(setting, null); return; }
        setEngineSettingValue(setting, Number(e.target.value));
      }}
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
 * Espace Préparation, à droite : réglages propres à ce slicer non-planaire. La liste (libellés, niveaux, bornes)
 * vient du moteur (utils/engineSettings.json) ; les valeurs sont envoyées à chaque tranchage. Une barre
 * latérale, à gauche du panneau, sélectionne la catégorie affichée.
 */
export const EngineSettingsPanel: React.FC = () => {
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
    <div className={styles.container} data-apex-chrome-panel>
      <nav className={styles.rail} aria-label="Catégories de réglages">
        {categories.map(({ name, settings }) => {
          const Icon = CATEGORY_ICONS[name] ?? Settings2;
          return (
            <button
              key={name}
              type="button"
              className={clsx(styles.railButton, { [styles.railActive]: current?.name === name })}
              aria-label={name}
              aria-pressed={current?.name === name}
              onClick={() => setSelected(name)}
              onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title: name, desc: `${settings.length} réglage${settings.length > 1 ? 's' : ''}.` } }))}
              onMouseLeave={resetTooltip}
            >
              <Icon size={18} />
              {settings.some(isEngineSettingModified) && <span className={styles.railDot} />}
            </button>
          );
        })}
      </nav>

      <aside className={styles.panel} aria-label="Réglages Apex">
        <div className={styles.header}>
          <h2 className={styles.title}>Réglages Apex</h2>
          <label className={styles.checkboxRow}>
            <input type="checkbox" className={styles.checkbox} checked={showAdvanced}
              onChange={(e) => setShowAdvancedSettings(e.target.checked)} />
            <span>Réglages avancés</span>
          </label>
        </div>
        {current && (
          <div className={styles.body}>
            <h3 className={styles.categoryTitle}>{current.name}</h3>
            <div className={styles.categoryBody}>
              {current.settings.map((setting) => (
                <div key={setting.path} onMouseEnter={() => showTooltip(setting)} onMouseLeave={resetTooltip}>
                  <SettingControl setting={setting} />
                </div>
              ))}
              {modified && (
                <button type="button" className={styles.resetButton} onClick={() => resetEngineSettings(current.name)}>
                  <RotateCcw size={12} /> Rétablir cette catégorie
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
