// Profil d'imprimante → paramètres de la machine, une seule source : le fichier de profil
// (profiles/<fabricant>/<modèle>.json, bloc `apex`). Les limites de l'édition (machineLimits.ts,
// layerLimits.ts) et le `machine_profile` envoyé au moteur (requête de tranchage) en sont dérivés ;
// aucune valeur de machine n'est recopiée ailleurs. Une donnée « Inconnu » reste absente du résultat :
// on ne devine pas une donnée matérielle.
import aetheris4 from '../../profiles/Aelox Hardware/Aetheris-4.json';

/** Profil de l'imprimante utilisée tant que le menu Imprimantes ne permet pas d'en choisir une autre. */
export const DEFAULT_PRINTER_PROFILE: unknown = aetheris4;

export interface ProfileRotaryAxis {
  axis: string;
  role?: string;
  range_deg?: unknown;
  max_speed_deg_s?: unknown;
  max_acceleration_deg_s2?: unknown;
}

export interface ProfileApexBlock {
  rotary_axes?: ProfileRotaryAxis[];
  pivot_distance_mm?: Record<string, unknown>;
  plate_radius_mm?: unknown;
  layer_height_limits_mm?: { min?: unknown; max?: unknown };
}

export interface MachineFacts {
  bRangeDeg: [number, number] | null;
  bSpeedDegS: number | null;
  bAccelDegS2: number | null;
  cRangeDeg: [number, number] | null;
  plateRadiusMm: number | null;
  pivotMm: number | null;
  layerMinMm: number | null;
  layerMaxMm: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function range(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = [num(v[0]), num(v[1])];
  return lo !== null && hi !== null && hi >= lo ? [lo, hi] : null;
}

/** Données utiles de la machine lues dans un profil ; `null` quand le profil dit « Inconnu » ou se tait. */
export function machineFacts(profile: unknown): MachineFacts {
  const apex = ((profile as { apex?: ProfileApexBlock } | null)?.apex ?? {}) as ProfileApexBlock;
  const axes = Array.isArray(apex.rotary_axes) ? apex.rotary_axes : [];
  const b = axes.find((a) => a.axis === 'B');
  const c = axes.find((a) => a.axis === 'C');
  return {
    bRangeDeg: range(b?.range_deg),
    bSpeedDegS: num(b?.max_speed_deg_s),
    bAccelDegS2: num(b?.max_acceleration_deg_s2),
    cRangeDeg: range(c?.range_deg),
    plateRadiusMm: num(apex.plate_radius_mm),
    pivotMm: num(apex.pivot_distance_mm?.B),
    layerMinMm: num(apex.layer_height_limits_mm?.min),
    layerMaxMm: num(apex.layer_height_limits_mm?.max),
  };
}

const RAD = Math.PI / 180;

/**
 * `machine_profile` de la requête de tranchage (champs de `MachineProfile`, config/params.schema.json).
 * Ne contient que ce que le profil sait : le moteur garde ses valeurs pour le reste (tête, buse,
 * direction radiale). Axes : plateau C (Z) puis tête B (X), l'ordre que le moteur attend pour une
 * machine à C couplé à la position.
 */
export function engineMachineProfile(profile: unknown): Record<string, unknown> {
  const f = machineFacts(profile);
  const out: Record<string, unknown> = {};
  if (f.cRangeDeg && f.bRangeDeg) {
    out.rotation_axes = [
      { axis: [0, 0, 1], angle_range_deg: f.cRangeDeg },
      { axis: [1, 0, 0], angle_range_deg: f.bRangeDeg },
    ];
  }
  if (f.bSpeedDegS !== null) out.max_angular_velocity = f.bSpeedDegS * RAD;
  if (f.bAccelDegS2 !== null) out.max_angular_acceleration = f.bAccelDegS2 * RAD;
  if (f.plateRadiusMm !== null) out.platform_radius = f.plateRadiusMm;
  return out;
}

/** Longueur pivot-pointe de la tête B (`gcode_params.pivot_to_tip`), si le profil la donne. */
export function enginePivotToTip(profile: unknown): number | null {
  return machineFacts(profile).pivotMm;
}
