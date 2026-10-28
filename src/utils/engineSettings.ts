// Réglages du moteur exposés à l'utilisateur (panneau de droite de Préparation). La liste vient du moteur
// (`engineSettings.json` : chemin dans le schéma, libellé, niveau, unité, bornes, échelle) ; chaque chemin est
// vérifié contre `src/generated/params.schema.json` à la construction (scripts/sync-engine-schema.cjs --verify) :
// aucun réglage sans effet. Les valeurs choisies sont mémorisées sur la machine et envoyées dans la requête de
// tranchage (`params` / `gcode_params`), en ne gardant que ce qui diffère du défaut du moteur.
import { useEffect, useState } from 'react';
import registry from './engineSettings.json';
import { DEFAULT_LAYER_LIMITS } from '@/utils/layerLimits';

export type EngineSettingLevel = 'user' | 'advanced' | 'developer';
export type EngineSettingValue = number | boolean | string | null;

export interface EngineSetting {
  path: string;
  label: string;
  category: string;
  level: EngineSettingLevel;
  type: 'number' | 'integer' | 'boolean' | 'string' | 'number|null';
  unit: string | null;
  /** Défaut du moteur (lu dans le schéma, jamais décidé ici). */
  default: EngineSettingValue;
  min: number | null;
  max: number | null;
  step: number | null;
  scale: 'linear' | 'log' | null;
  enum: string[] | null;
}

export const ENGINE_SETTINGS = registry as EngineSetting[];

/** Ordre d'affichage des catégories. */
export const ENGINE_SETTING_CATEGORIES = [
  'Lissage des couches', 'Orientation de la tête', 'Trajectoires', 'Collisions', 'Déplacements', 'Avancé',
];

/**
 * Valeurs choisies par l'utilisateur pour l'application, différentes du défaut du moteur (décisions du 2026-10-27/28) :
 * le panneau les montre comme valeur courante, à côté du défaut du moteur.
 */
export const ENGINE_SETTING_APP_DEFAULTS: Record<string, EngineSettingValue> = {
  'field_solver.heat_method_time_factor': 300000,
  // TetraNet par défaut (2026-10-28) : seul mailleur dont le refus « surface incohérente » (R-016) est exploitable.
  'mesher': 'tetranet',
};

/** Toujours envoyés, même égaux au défaut du moteur : l'interface en dépend (R-013, plateau en un seul maillage). */
const ALWAYS_SENT = new Set(['allow_multi_mesh']);

export function appDefaultOf(setting: EngineSetting): EngineSettingValue {
  return setting.path in ENGINE_SETTING_APP_DEFAULTS ? ENGINE_SETTING_APP_DEFAULTS[setting.path] : setting.default;
}

/** Bornes d'un réglage numérique : celles du moteur, la hauteur de couche suit le profil d'imprimante ; sinon 0 en bas. */
export function boundsOf(setting: EngineSetting): { min: number; max: number | null } {
  if (setting.path === 'layers.layer_height_base') return { min: DEFAULT_LAYER_LIMITS.minMm, max: DEFAULT_LAYER_LIMITS.maxMm };
  return { min: setting.min ?? 0, max: setting.max };
}

/** Mise en conformité d'une valeur saisie : bornes, entier, fenêtre impaire ; `undefined` si inutilisable. */
export function normalizeValue(setting: EngineSetting, raw: unknown): EngineSettingValue | undefined {
  if (setting.type === 'boolean') return typeof raw === 'boolean' ? raw : undefined;
  if (setting.type === 'string') return typeof raw === 'string' && (!setting.enum || setting.enum.includes(raw)) ? raw : undefined;
  if (raw === null) return setting.type === 'number|null' ? null : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const { min, max } = boundsOf(setting);
  let v = Math.min(max ?? Infinity, Math.max(min, raw));
  if (setting.type === 'integer') {
    v = Math.round(v);
    // Fenêtre médiane : un nombre impair de points (0 = désactivée).
    if (setting.unit?.includes('impair') && v > 0 && v % 2 === 0) v = Math.min(max ?? v + 1, v + 1);
  }
  return v;
}

const STORAGE_KEY = 'apex-engine-settings';
const ADVANCED_KEY = 'apex-engine-settings-show-advanced';

function readStored(): Record<string, EngineSettingValue> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, EngineSettingValue> = {};
    for (const setting of ENGINE_SETTINGS) {
      if (!(setting.path in parsed)) continue;
      const value = normalizeValue(setting, parsed[setting.path]);
      if (value !== undefined) out[setting.path] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function readShowAdvanced(): boolean {
  try { return localStorage.getItem(ADVANCED_KEY) === 'true'; } catch { return false; }
}

let overrides = readStored();
let showAdvanced = readShowAdvanced();
let version = 0;
const listeners = new Set<() => void>();

function persist() {
  version += 1;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* localStorage indisponible */ }
  listeners.forEach((l) => l());
}

export function getEngineSettingValue(setting: EngineSetting): EngineSettingValue {
  return setting.path in overrides ? overrides[setting.path] : appDefaultOf(setting);
}

export function setEngineSettingValue(setting: EngineSetting, raw: unknown) {
  const value = normalizeValue(setting, raw);
  if (value === undefined) return;
  if (value === appDefaultOf(setting)) delete overrides[setting.path]; else overrides[setting.path] = value;
  persist();
}

/** Rétablit un réglage, ou toute une catégorie, à la valeur de l'application. */
export function resetEngineSettings(category?: string) {
  const next = { ...overrides };
  for (const setting of ENGINE_SETTINGS) if (!category || setting.category === category) delete next[setting.path];
  overrides = next;
  persist();
}

export function isEngineSettingModified(setting: EngineSetting): boolean {
  return setting.path in overrides;
}

export function getShowAdvancedSettings() { return showAdvanced; }
export function setShowAdvancedSettings(next: boolean) {
  showAdvanced = next;
  try { localStorage.setItem(ADVANCED_KEY, String(next)); } catch { /* localStorage indisponible */ }
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeEngineSettings(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-rendu du composant à chaque changement d'un réglage (valeurs lues par `getEngineSettingValue`). */
export function useEngineSettings() {
  const [, setTick] = useState(version);
  useEffect(() => subscribeEngineSettings(() => setTick(version)), []);
  return { showAdvanced };
}

function setDeep(target: Record<string, unknown>, path: string[], value: unknown) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/** `params` et `gcode_params` partiels de la requête : seulement ce qui diffère du défaut du moteur (ou qu'on impose). */
export function buildEngineOverrides(): { params: Record<string, unknown>; gcodeParams: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  const gcodeParams: Record<string, unknown> = {};
  for (const setting of ENGINE_SETTINGS) {
    const value = getEngineSettingValue(setting);
    if (value === setting.default && !ALWAYS_SENT.has(setting.path)) continue;
    const [root, ...rest] = setting.path.split('.');
    if (root === 'gcode_params') setDeep(gcodeParams, rest, value); else setDeep(params, [root, ...rest], value);
  }
  return { params, gcodeParams };
}
