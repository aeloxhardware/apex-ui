// Catalogue des filaments (public/filaments.json, généré par scripts/profiles/filaments.cjs depuis les
// profils d'OrcaSlicer, AGPL-3.0 : cf. utils/credits.ts) et filament choisi (mémorisé dans le navigateur).
/**
 * Aspect (brillance) d'un filament : mat, satiné, brillant, soyeux, métallisé ou pailleté. `null` = non renseigné
 * (les profils Orca n'en ont pas ; indexé par scripts/profiles/filamentFinish.cjs, jamais deviné pour un nom neutre).
 */
export type FilamentFinish = 'matte' | 'satin' | 'glossy' | 'silk' | 'metallic' | 'sparkle';

export interface FilamentProfile {
  name: string;
  vendor: string;
  type: string | null;
  density: number | null;
  diameter: number | null;
  cost: number | null;
  nozzle_temp: number | null;
  nozzle_temp_initial_layer: number | null;
  nozzle_temp_range: [number | null, number | null];
  bed_temp: number | null;
  flow_ratio: number | null;
  max_volumetric_speed: number | null;
  color: string | null;
  finish: FilamentFinish | null;
  orca_source: string;
  /** Profil créé par l'utilisateur (copie modifiée, cf. userFilaments.ts) ; absent pour un profil d'usine. */
  user?: true | undefined;
  /** Profil d'USINE dont la copie dérive (`vendor|name`) : sert à « revenir au profil d'usine ». */
  baseKey?: string | undefined;
}

export const FILAMENT_CHANGED_EVENT = 'apex-filament-changed';
const STORAGE_KEY = 'apex.filament';
const DEFAULT_FILAMENT_KEY = 'OrcaFilamentLibrary|Generic PLA';

export const filamentKey = (f: Pick<FilamentProfile, 'vendor' | 'name'>) => `${f.vendor}|${f.name}`;

let cache: Promise<FilamentProfile[]> | null = null;
export function loadFilaments(): Promise<FilamentProfile[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}filaments.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Filaments indisponibles (${r.status})`);
      return r.json();
    })
    .then((j) => j.filaments as FilamentProfile[])
    .catch((err) => { cache = null; throw err; });
  return cache;
}

// Familles de matériaux pour le filtre du sélecteur : le type Orca (« PC-CF », « PETG-GF », « PAHT-CF »…) est rangé
// sous sa famille de base (« PC », « PETG », « PA »). L'ordre compte : les préfixes les plus longs d'abord.
const FAMILY_RULES: Array<[RegExp, string]> = [
  [/^PETG/i, 'PETG'], [/^PCTG/i, 'PCTG'], [/^PET/i, 'PET'], [/^PC/i, 'PC'],
  [/^PLA/i, 'PLA'], [/^ABS/i, 'ABS'], [/^ASA/i, 'ASA'], [/^TPU/i, 'TPU'],
  [/^PPA/i, 'PPA'], [/^PPS/i, 'PPS'], [/^PP/i, 'PP'],
  [/PAHT|^PA|^UltraPA/i, 'PA'],
  [/^PEEK/i, 'PEEK'], [/^PEBA/i, 'PEBA'], [/^PE/i, 'PE'],
  [/^PVA/i, 'PVA'], [/^PVB/i, 'PVB'], [/^BVOH/i, 'BVOH'], [/^HIPS/i, 'HIPS'], [/^SBS/i, 'SBS'], [/^EVA/i, 'EVA'], [/^PHA/i, 'PHA'],
];
export const OTHER_FAMILY = 'Autres';
export const filamentFamily = (type: string | null): string => {
  if (!type) return OTHER_FAMILY;
  return FAMILY_RULES.find(([re]) => re.test(type.trim()))?.[1] ?? OTHER_FAMILY;
};

export function getSelectedFilamentKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_FILAMENT_KEY;
  } catch {
    return DEFAULT_FILAMENT_KEY;
  }
}

export function setSelectedFilamentKey(key: string) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* stockage indisponible : choix de session seulement */ }
  window.dispatchEvent(new CustomEvent(FILAMENT_CHANGED_EVENT, { detail: { key } }));
}
