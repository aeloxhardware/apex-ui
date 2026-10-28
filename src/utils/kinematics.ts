// Cinématique pivot/pointe d'un G-code polaire (C4, apex/integration/RULES.md §6). Le moteur la déclare dans
// l'en-tête : `; apex_kinematics pivot_to_tip=46 b_sign=1 tilt_sign=1 z_reference=tip` (R-007). L'aperçu et le
// noyau d'édition relisent la pointe avec ces valeurs au lieu de les supposer. Les vecteurs de test du moteur
// (`src/generated/kinematics_vectors.json`, R-008) sont rejoués par `scripts/check-kinematics-vectors.cjs`.

export interface Kinematics {
  /** Distance pointe de buse → pivot de l'axe B (mm). */
  pivotToTip: number;
  /** B écrit dans le fichier = bSign × B d'Apex. */
  bSign: number;
  /** Signe du décalage radial du pivot (R_pivot = R_pointe + tiltSign · L · sin B). */
  tiltSign: number;
  /** Z écrit : hauteur de la pointe (« tip ») ou du pivot (« pivot »). */
  zReference: 'tip' | 'pivot';
}

/**
 * Fichiers sans ligne `apex_kinematics` (G-code d'une ancienne version du moteur, ou issu de la conversion
 * polaire de l'interface) : la longueur qu'ils supposaient tous.
 */
export const LEGACY_KINEMATICS: Kinematics = { pivotToTip: 46, bSign: 1, tiltSign: 1, zReference: 'tip' };

/** Ce que l'aperçu et le noyau d'édition savent représenter : B non inversé, pivot décalé vers +R, Z de la pointe. */
export function isPreviewSupported(k: Kinematics): boolean {
  return k.bSign === 1 && k.tiltSign === 1 && k.zReference === 'tip';
}

const KEY = 'apex_kinematics'; // nom de la ligne d'en-tête (messages)
const HEADER_SCAN_CHARS = 16384;

/**
 * Lit la ligne `; apex_kinematics …` de l'en-tête (qui finit au premier mouvement). `null` : le fichier n'en porte
 * pas. Une ligne présente mais illisible lève une erreur : on ne devine jamais une donnée matérielle.
 */
export function parseKinematicsHeader(text: string): Kinematics | null {
  const lines = text.slice(0, HEADER_SCAN_CHARS).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (/^G0?[01](\s|$)/i.test(line)) return null;
    const m = /^;\s*apex_kinematics\s+(.*)$/.exec(line);
    if (!m) continue;
    const kv = new Map<string, string>();
    for (const item of m[1].trim().split(/\s+/)) {
      const eq = item.indexOf('=');
      if (eq > 0) kv.set(item.slice(0, eq), item.slice(eq + 1));
    }
    const pivotToTip = Number(kv.get('pivot_to_tip'));
    const bSign = Number(kv.get('b_sign'));
    const tiltSign = Number(kv.get('tilt_sign'));
    const zReference = kv.get('z_reference');
    if (!(pivotToTip > 0) || !Number.isFinite(bSign) || !Number.isFinite(tiltSign) || (zReference !== 'tip' && zReference !== 'pivot')) {
      throw new Error(`Ligne « ${KEY} » illisible dans l'en-tête du G-code : ${line}`);
    }
    return { pivotToTip, bSign, tiltSign, zReference };
  }
  return null;
}

/** Pointe de buse (R, Z) depuis les valeurs firmware (X = R du pivot, Z, B en radians du fichier). */
export function tipFromFirmware(k: Kinematics, r: number, z: number, bFileRad: number, out: { r: number; z: number }) {
  const b = k.bSign * bFileRad;
  out.r = r - k.tiltSign * k.pivotToTip * Math.sin(b);
  out.z = z - k.pivotToTip * (Math.cos(b) - (k.zReference === 'tip' ? 1 : 0));
  return out;
}

// Cinématique du fichier affiché. Le parseur tourne dans un worker : sa valeur voyage dans `ParsedGCode.kinematics`
// et est installée ici, côté fenêtre, à la réception (cf. gcodeParseAsync.ts).
let active: Kinematics = LEGACY_KINEMATICS;
export const getActiveKinematics = (): Kinematics => active;
export const setActiveKinematics = (k: Kinematics): void => { active = k; };

/** Pointe de buse du fichier affiché. */
export function nozzleTipActive(r: number, z: number, bRad: number, out: { r: number; z: number }) {
  return tipFromFirmware(active, r, z, bRad, out);
}
