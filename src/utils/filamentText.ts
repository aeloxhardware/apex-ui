import type { FilamentFinish, FilamentProfile } from './filamentCatalog';

/** Textes dérivés d'un profil de filament : marque, nom du matériau, « de » / « d' », aspect en français. */

// Un premier mot qui est déjà un matériau (« PLA Basic », « PETG HF ») n'est pas une marque : on retombe sur le fabricant du profil.
const MATERIAL_WORD = /^(PLA|PETG|PCTG|PET|PC|ABS|ASA|TPU|PA|PP|PE|PVA|HIPS|PPS|PPA|PEEK|PEBA|BVOH|SBS|EVA|PHA|PVB)/i;
const VOWEL_START = /^[aeiouyàâäéèêëîïôöùûü]/i;

/** Marque d'un profil : le premier mot de son nom (« Bambu PLA Silk » → « Bambu »), sinon le fabricant du profil. */
export function brandOf(p: Pick<FilamentProfile, 'name' | 'vendor'>): string {
  const first = p.name.trim().split(/\s+/)[0] ?? '';
  return first && !MATERIAL_WORD.test(first) ? first : p.vendor;
}

/** Nom du matériau sans la marque (« Bambu PLA Silk » → « PLA Silk »). */
export function materialNameOf(p: Pick<FilamentProfile, 'name' | 'vendor'>): string {
  const brand = brandOf(p);
  const rest = p.name.startsWith(brand) ? p.name.slice(brand.length).trim() : p.name;
  return rest || p.name;
}

/** « de Bambu » ou « d'Anycubic » (voyelle initiale). */
export const deOrD = (brand: string): string => (VOWEL_START.test(brand) ? `d'${brand}` : `de ${brand}`);

const FINISH_LABELS: Record<FilamentFinish, string> = {
  matte: 'Mat',
  satin: 'Satiné',
  glossy: 'Brillant',
  silk: 'Soyeux',
  metallic: 'Métallisé',
  sparkle: 'Pailleté',
};
export const finishLabel = (finish: FilamentFinish | null): string => (finish ? FINISH_LABELS[finish] : 'Non renseigné');

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
/** Nombre en français avec unité, ou « — » quand la valeur n'est pas renseignée. */
export const withUnit = (value: number | null | undefined, unit: string): string =>
  value == null ? '—' : `${nf.format(value)}${unit ? ` ${unit}` : ''}`;

/** Plage de températures « 190 – 230 °C », ou « — ». */
export function rangeText(range: [number | null, number | null]): string {
  const [low, high] = range;
  if (low == null && high == null) return '—';
  return `${low == null ? '…' : nf.format(low)} – ${high == null ? '…' : nf.format(high)} °C`;
}

/** Les faits principaux d'un profil, pour sa fiche détaillée (carte) : [libellé, valeur]. */
export function profileFacts(p: FilamentProfile): Array<[string, string]> {
  return [
    ['Type', p.type ?? '—'],
    ['Aspect', finishLabel(p.finish)],
    ['Buse', rangeText(p.nozzle_temp_range)],
    ['Plateau', withUnit(p.bed_temp, '°C')],
    ['Densité', withUnit(p.density, 'g/cm³')],
    ['Diamètre', withUnit(p.diameter, 'mm')],
  ];
}
