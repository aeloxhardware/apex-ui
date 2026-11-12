import type { FilamentFinish, FilamentProfile } from '@/utils/filamentCatalog';
import type { FilamentEdits } from '@/utils/userFilaments';

type NumKey =
  | 'density'
  | 'diameter'
  | 'cost'
  | 'nozzle_temp'
  | 'nozzle_temp_initial_layer'
  | 'bed_temp'
  | 'flow_ratio'
  | 'max_volumetric_speed';

/** Réglages numériques d'un profil, dans l'ordre de la fiche. */
export const NUM_FIELDS: ReadonlyArray<{ key: NumKey; label: string; unit: string; step: number; min: number }> = [
  { key: 'density', label: 'Densité', unit: 'g/cm³', step: 0.01, min: 0.1 },
  { key: 'diameter', label: 'Diamètre', unit: 'mm', step: 0.01, min: 0.1 },
  { key: 'cost', label: 'Coût (par kg)', unit: '', step: 0.5, min: 0 },
  { key: 'nozzle_temp', label: 'Température de buse', unit: '°C', step: 1, min: 0 },
  { key: 'nozzle_temp_initial_layer', label: 'Buse, première couche', unit: '°C', step: 1, min: 0 },
  { key: 'bed_temp', label: 'Température du plateau', unit: '°C', step: 1, min: 0 },
  { key: 'flow_ratio', label: 'Ratio de débit', unit: '', step: 0.01, min: 0.1 },
  { key: 'max_volumetric_speed', label: 'Débit volumique max.', unit: 'mm³/s', step: 0.5, min: 0 },
];

export const FINISH_CHOICES: ReadonlyArray<FilamentFinish | null> = [null, 'matte', 'satin', 'glossy', 'silk', 'metallic', 'sparkle'];

/** Ce que la fiche permet de modifier : le brouillon part du profil et ne devient une copie qu'à l'enregistrement. */
export const draftOf = (p: FilamentProfile): FilamentEdits => ({
  type: p.type,
  finish: p.finish,
  density: p.density,
  diameter: p.diameter,
  cost: p.cost,
  nozzle_temp: p.nozzle_temp,
  nozzle_temp_initial_layer: p.nozzle_temp_initial_layer,
  nozzle_temp_range: [p.nozzle_temp_range[0], p.nozzle_temp_range[1]],
  bed_temp: p.bed_temp,
  flow_ratio: p.flow_ratio,
  max_volumetric_speed: p.max_volumetric_speed,
});

export const isDirty = (draft: FilamentEdits, p: FilamentProfile): boolean => JSON.stringify(draft) !== JSON.stringify(draftOf(p));
