// Réglages de buse d'Element Aeolis (`nozzle_angle_deg`, `nozzle_reach` de `AeolisSliceParams`, contrat 2 du 2026-10-31).
// Ils sont propres à l'imprimante (R-027) : le moteur les prend pour limites de la surface en hauteur et pour l'enveloppe de la
// tête (apex-engine, element-aeolis/README.md). Valeur de départ = celle du profil de l'imprimante
// (`apex.default_nozzle_profile`, machineProfile.ts), sinon les défauts très bas du moteur (10°, 2 mm) pour ne pas casser une
// imprimante à conduits de ventilation serrés. Le réglage fait dans l'interface est mémorisé par imprimante (localStorage,
// clé = nom de l'imprimante) et ne touche jamais le fichier de profil. Même patron que devModePrefs.ts (singleton + écouteurs).
import { useEffect, useState } from 'react';
import { DEFAULT_PRINTER_NAME, DEFAULT_PRINTER_PROFILE, machineFacts } from '@/utils/machineProfile';

export interface AeolisNozzle {
  /** Angle maximum buse-paroi : pente maximale, depuis l'horizontale, de la surface déjà imprimée autour de la pointe (°). */
  angleDeg: number;
  /** Longueur maximale atteignable par la buse : dénivelé maximal toléré entre la pointe et la matière voisine plus haute (mm). */
  reachMm: number;
}

export const DEFAULT_AEOLIS_NOZZLE: AeolisNozzle = { angleDeg: 10, reachMm: 2 };
export const AEOLIS_NOZZLE_BOUNDS = { angleDeg: { min: 0, max: 89, step: 1 }, reachMm: { min: 0, max: 100, step: 0.5 } } as const;

const STORAGE_KEY = 'apex-aeolis-nozzle-by-printer';
/** Ancienne clé (un seul jeu pour toute l'application) : reprise une fois pour l'imprimante par défaut. */
const LEGACY_KEY = 'apex-aeolis-nozzle';

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const bounded = (n: { [K in keyof AeolisNozzle]?: AeolisNozzle[K] | undefined } | null | undefined, base: AeolisNozzle): AeolisNozzle => ({
  angleDeg: clamp(n?.angleDeg, AEOLIS_NOZZLE_BOUNDS.angleDeg.min, AEOLIS_NOZZLE_BOUNDS.angleDeg.max, base.angleDeg),
  reachMm: clamp(n?.reachMm, AEOLIS_NOZZLE_BOUNDS.reachMm.min, AEOLIS_NOZZLE_BOUNDS.reachMm.max, base.reachMm),
});

/** Géométrie de buse décrite par un profil d'imprimante ; ce que le profil ne dit pas retombe sur les défauts du moteur. */
export function nozzleOfProfile(profile: unknown): AeolisNozzle & { outerWidthMm: number | null } {
  const f = machineFacts(profile);
  const base = bounded({ angleDeg: f.nozzleAngleDeg ?? undefined, reachMm: f.nozzleLengthMm ?? undefined }, DEFAULT_AEOLIS_NOZZLE);
  return { ...base, outerWidthMm: f.nozzleOuterWidthMm };
}

type Overrides = Record<string, Partial<AeolisNozzle>>;

function readOverrides(): Overrides {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Overrides | null;
    if (raw && typeof raw === 'object') return raw;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as Partial<AeolisNozzle> | null;
    return legacy ? { [DEFAULT_PRINTER_NAME]: legacy } : {};
  } catch {
    return {};
  }
}

let printerName = DEFAULT_PRINTER_NAME;
let profileNozzle: AeolisNozzle = nozzleOfProfile(DEFAULT_PRINTER_PROFILE);
let overrides = readOverrides();
const compute = (): AeolisNozzle => bounded(overrides[printerName], profileNozzle);
let current = compute();
const listeners = new Set<() => void>();
const notify = () => { current = compute(); listeners.forEach((l) => l()); };

export function getAeolisNozzle(): AeolisNozzle {
  return current;
}

/** Imprimante choisie dans le menu Imprimantes : sa buse (profil + réglage mémorisé) devient la buse active. */
export function setActivePrinterNozzle(name: string, profile: unknown) {
  printerName = name;
  profileNozzle = nozzleOfProfile(profile);
  notify();
}

export function setAeolisNozzle(patch: { [K in keyof AeolisNozzle]?: AeolisNozzle[K] | undefined }) {
  // Seuls les champs touchés sont mémorisés : l'autre continue de suivre le profil de l'imprimante.
  const clamped = bounded(patch, current);
  const touched: Partial<AeolisNozzle> = {};
  if (patch.angleDeg !== undefined) touched.angleDeg = clamped.angleDeg;
  if (patch.reachMm !== undefined) touched.reachMm = clamped.reachMm;
  overrides = { ...overrides, [printerName]: { ...overrides[printerName], ...touched } };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* localStorage indisponible */ }
  notify();
}

/** Revient aux valeurs du profil de l'imprimante active. */
export function resetAeolisNozzle() {
  const { [printerName]: _dropped, ...rest } = overrides;
  overrides = rest;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* localStorage indisponible */ }
  notify();
}

export function useAeolisNozzle() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return current;
}

/** Racine de paramètres d'Element Aeolis : seulement ce qui diffère du défaut du moteur. */
export function aeolisNozzleParams(nozzle: AeolisNozzle = current): { nozzle_angle_deg?: number; nozzle_reach?: number } {
  return {
    ...(nozzle.angleDeg !== DEFAULT_AEOLIS_NOZZLE.angleDeg ? { nozzle_angle_deg: nozzle.angleDeg } : {}),
    ...(nozzle.reachMm !== DEFAULT_AEOLIS_NOZZLE.reachMm ? { nozzle_reach: nozzle.reachMm } : {}),
  };
}
