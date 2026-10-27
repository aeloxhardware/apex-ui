import type { ParsedGCode } from '@/components/gcodeParse';

/**
 * Suppression des contours imprimés dans l'air (`ParsedGCode.airContours`, cf. gcodeAirContours.ts) : le
 * texte G-code est réécrit sans les lignes qui déposent ou déplacent la tête le long de ces contours.
 *
 * Pour chaque contour [premier, dernier] :
 *  - disparaissent les dépôts, et les déplacements avec mouvement qui les relient — y compris celui
 *    qui amène la tête au point de départ (sinon elle irait quand même se placer dans l'air) ;
 *  - restent les lignes sans mouvement (rétraction, réinjection, avance F, commentaires, G92) : le
 *    filament garde son bilan et les états modaux sont inchangés ;
 *  - le premier dépôt qui suit le contour relierait désormais l'ancien point au nouveau (quelques mm)
 *    avec l'extrusion d'un segment minuscule : sa ligne devient un simple déplacement (mot E retiré) ;
 *  - une ligne de mouvement supprimée qui portait un mot F est remplacée par `G1 F<valeur>`, pour que
 *    les lignes suivantes gardent la vitesse que le fichier leur supposait.
 *
 * Pris en charge pour l'instant : extrudeur relatif (M83, cas de PrusaSlicer) et lignes à un seul
 * mouvement. Hors de ce cadre, rien n'est écrit et la raison est renvoyée.
 */

export interface AirRemovalResult {
  text: string;
  contours: number;
  /** Lignes de mouvement supprimées. */
  removedLines: number;
  /** Longueur de matière retirée (mm). */
  removedMm: number;
  /** Dépôts transformés en déplacement : le premier qui suit un contour retiré. */
  convertedJoins: number;
}

const MOTION_EPS = 1e-9;
const EXTRUSION_WORD_RE = /\s+E-?\d*\.?\d+/i;
const FEED_RE =/\bF(-?\d*\.?\d+)/i;

export function removeAirContours(text: string, parsed: ParsedGCode): AirRemovalResult | { error: string } {
  const ranges = parsed.airContours;
  if (!ranges || ranges.length === 0) return { error: 'Aucun contour en l\'air à supprimer.' };
  if (parsed.usesInches) return { error: 'Fichier en pouces (G20) non pris en charge.' };
  if (parsed.insertedBlocks?.length) return { error: 'Des mouvements ont été insérés par l\'édition : enregistrez d\'abord.' };

  const { moves, lineIndex } = parsed;
  const lines = text.split('\n');
  const removed = new Set<number>();
  let removedMm = 0;
  const toTravel = new Set<number>();

  const moves3 = (k: number) => {
    const a = moves[k - 1], b = moves[k];
    return Math.abs(b.x - a.x) > MOTION_EPS || Math.abs(b.y - a.y) > MOTION_EPS || Math.abs(b.z - a.z) > MOTION_EPS;
  };

  for (let r = 0; r < ranges.length; r += 2) {
    const first = ranges[r], last = ranges[r + 1];
    // Déplacement qui amène la tête au point de départ du contour.
    const from = first > 1 && !moves[first - 1].extruding && moves3(first - 1) ? first - 1 : first;
    for (let k = from; k <= last; k++) {
      const removable = moves[k].extruding || (k > 0 && moves3(k));
      if (!removable) continue;
      if (parsed.eRelative[k] !== 1) return { error: 'Extrusion absolue (M82) : suppression non prise en charge pour l\'instant.' };
      // Un arc découpé partage sa ligne entre plusieurs mouvements : on ne la touche pas à moitié.
      if ((k > 0 && lineIndex[k - 1] === lineIndex[k]) || (k + 1 < moves.length && lineIndex[k + 1] === lineIndex[k])) {
        return { error: `Ligne ${lineIndex[k] + 1} : arc G2/G3 dans un contour, non pris en charge.` };
      }
      removed.add(lineIndex[k]);
      if (moves[k].extruding) {
        removedMm += Math.hypot(moves[k].x - moves[k - 1].x, moves[k].y - moves[k - 1].y, moves[k].z - moves[k - 1].z);
      }
    }
    // Premier mouvement avec déplacement après le contour : un dépôt ici partirait de l'ancien point.
    for (let k = last + 1; k < moves.length; k++) {
      if (!moves3(k) && !moves[k].extruding) continue;
      if (moves[k].extruding && parsed.eRelative[k] === 1) toTravel.add(lineIndex[k]);
      break;
    }
  }

  let removedLines = 0;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (toTravel.has(i) && !removed.has(i)) {
      const semi = lines[i].indexOf(';');
      const code = semi >= 0 ? lines[i].slice(0, semi) : lines[i];
      out.push(code.replace(EXTRUSION_WORD_RE, '') + (semi >= 0 ? lines[i].slice(semi) : ''));
      continue;
    }
    if (!removed.has(i)) { out.push(lines[i]); continue; }
    removedLines++;
    const semi = lines[i].indexOf(';');
    const code = semi >= 0 ? lines[i].slice(0, semi) : lines[i];
    const feed = FEED_RE.exec(code);
    if (feed) out.push(`G1 F${feed[1]}${lines[i].endsWith('\r') ? '\r' : ''}`);
  }
  return { text: out.join('\n'), contours: ranges.length / 2, removedLines, removedMm, convertedJoins: toTravel.size };
}
