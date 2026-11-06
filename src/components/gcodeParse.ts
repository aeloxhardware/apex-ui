/**
 * Parseur G-code + calque Babylon de prévisualisation. Deux familles de fichiers :
 *
 * 1. G-code polaire 4 axes de l'Apex (reconnu à la présence d'un mot B dans les déplacements) :
 *    `G00 Y<C> X<R> Z<Z> B<B> [E<e>] F<f>`.
 *    - X = R : rayon depuis le centre du plateau (mm, ≥ 0).
 *    - Y = C : angle du plateau (degrés, absolu, JAMAIS replié modulo 360 — le générateur garde
 *      la continuité angulaire, un C > 360 ou négatif est normal).
 *    - Z : hauteur (mm). B : inclinaison de la tête vers +R (à l'opposé de l'axe de rotation), en
 *      degrés.
 *    - R/Z sont les positions machine du PIVOT de l'axe B, pas de la buse : la pointe de buse est
 *      à NOZZLE_PIVOT_MM sous le pivot, le long de l'axe de la tête (cf. `nozzleTip`).
 *    - La matière est stockée en repère plateau sous un noeud dont la rotation suit le C courant :
 *      plateau et matière tournent ensemble, la tête reste dans le demi-plan machine (R, 0, Z).
 *    - Tout est interpolé dans l'espace (R, C, Z, B) du firmware, jamais en cartésien : les
 *      segments sont subdivisés en angle pour suivre l'arc réellement parcouru.
 *
 * 2. G-code cartésien de slicer (Orca, Bambu, Anycubic Slicer Next, Creality Print, PrusaSlicer,
 *    Cura, Simplify3D…) : G0/G1, arcs G2/G3 (I/J ou R), G90/G91, M82/M83, G92, G10/G11, G20/G21,
 *    G28. La pièce est recentrée sur le centre du plateau d'origine (`printable_area`/`bed_shape`
 *    de l'en-tête, sinon centre de la pièce) ; plateau fixe, la tête se déplace en X/Y/Z.
 *
 *    Variante multi-axes (Unlayered Slicer : mots B/C + `; TOOL_AXIS:x,y,z`) : X/Y/Z restent
 *    cartésiens, B/C ne sont que l'orientation de l'outil et ne rendent pas le fichier polaire.
 *
 * Dans les deux cas, les types de ligne (`;TYPE:`, `; FEATURE:`…), essuyages (`;WIPE_START`),
 * rétractions et coutures sont reconnus pour la légende et la coloration (cf. gcodeLineTypes.ts).
 */

import { hasApexSignature } from '@/utils/apexSignature';
import {
  LEGACY_KINEMATICS, isPreviewSupported, parseKinematicsHeader, setActiveKinematics,
} from '@/utils/kinematics';
import { parseLine } from './gcode-parse/commands';
import { createParserState, type ApexMachine } from './gcode-parse/state';
import {
  computeLayerMaxSpeed, computeTiming, computeWidths, placeOnPlate, requalifyAirContours,
} from './gcode-parse/finalize';
import { computeBounds, computeLineStats, computeRanges, detectGenerator } from './gcode-parse/summary';
import type { GCodeKind, ParsedGCode } from './gcode-parse/types';

export * from './gcode-parse/types';
export * from './gcode-parse/geometry';

/**
 * Machine déclarée par un G-code Apex (R-025) : signature en tête ET ligne `; apex_kinematics_json {...}`
 * (`machine` : « cartesian » ou « apex-polar-4axis »). Null pour un fichier sans signature, ou sans description :
 * l'aperçu garde alors ses heuristiques (présence d'un mot B ou C). Les six mots XYZABC sont écrits sur chaque
 * mouvement des fichiers Apex, donc la seule présence d'un mot C ne dit rien de la machine.
 */
function declaredApexMachine(text: string): ApexMachine {
  if (!hasApexSignature(text)) return null;
  const m = /^; apex_kinematics_json \{[^\r\n]*?"machine":"([^"]+)"/m.exec(text.slice(0, 20000));
  if (!m) return null;
  if (m[1] === 'cartesian') return 'cartesian';
  if (m[1] === 'apex-polar-4axis') return 'polar';
  return null;
}

export function parseGCode(text: string): ParsedGCode {
  const apexMachine = declaredApexMachine(text);
  // Cinématique AVANT toute durée de mouvement (moveLength lit la pointe). Absente : valeur des anciens fichiers.
  const declaredKinematics = parseKinematicsHeader(text);
  if (declaredKinematics && !isPreviewSupported(declaredKinematics)) {
    throw new Error(`Cinématique du G-code non prise en charge par l'aperçu (b_sign=${declaredKinematics.bSign}, tilt_sign=${declaredKinematics.tiltSign}, z_reference=${declaredKinematics.zReference}) : la pointe serait mal relue.`);
  }
  const kinematics = declaredKinematics ?? LEGACY_KINEMATICS;
  setActiveKinematics(kinematics);

  const s = createParserState(apexMachine);
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; lineNo++) parseLine(s, lines[lineNo], lineNo);

  const kind: GCodeKind = s.polar ? 'polar' : 'cartesian';
  const placement = placeOnPlate(s, kind);
  const { times, speedMmS, segLengthMm } = computeTiming(s, kind);
  const widthMm = computeWidths(s, segLengthMm);
  const layerMaxSpeedMmS = computeLayerMaxSpeed(s, kind, speedMmS);
  const airRanges = requalifyAirContours(s, kind);
  const lineStats = computeLineStats(s, times);

  const layerHeightMm = Float32Array.from(s.layerHeights);
  const accelMmS2 = Float32Array.from(s.accels);
  const nozzleTempC = Float32Array.from(s.temps);
  const fanPct = Float32Array.from(s.fans);
  const ranges = computeRanges({
    moves: s.moves, times, deposits: s.deposits, filamentDiameter: s.filamentDiameter,
    speedMmS, accelMmS2, segLengthMm, widthMm, layerHeightMm, nozzleTempC, fanPct, layerMaxSpeedMmS,
  });

  return {
    kind,
    kinematics,
    kinematicsDeclared: declaredKinematics !== null,
    moves: s.moves,
    times,
    ...computeBounds(s.moves, kind),
    extrudingCount: s.extrudingCount,
    lineStats,
    generator: detectGenerator(s, kind),
    printer: s.printer,
    nonPlanar: placement.nonPlanar,
    toolOriented: s.toolOriented,
    bedCenter: placement.bedCenter,
    conversion: s.conversion,
    offPlate: { moves: Uint32Array.from(placement.offPlateMoves), traits: placement.offPlateTraits },
    airContours: Uint32Array.from(airRanges),
    markers: {
      retraction: Uint32Array.from(s.retractionAt),
      unretraction: Uint32Array.from(s.unretractionAt),
      seam: Uint32Array.from(s.seamAt),
    },
    speedMmS,
    accelMmS2,
    nozzleTempC,
    bedTempC: Float32Array.from(s.bedTemps),
    fanPct,
    layerHeightMm,
    widthMm,
    segLengthMm,
    depositMm: Float32Array.from(s.deposits),
    filamentDiameterMm: s.filamentDiameter,
    layerIndex: Uint32Array.from(s.layerIndices),
    layerMaxSpeedMmS,
    ranges,
    lineIndex: Uint32Array.from(s.lineIndices),
    eDelta: Float64Array.from(s.eDeltas),
    eAbsBefore: Float64Array.from(s.eAbsBefores),
    hasEWord: Uint8Array.from(s.eWordFlags),
    eRelative: Uint8Array.from(s.eRelFlags),
    usesInches: s.usesInches,
  };
}
