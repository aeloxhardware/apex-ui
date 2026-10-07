import type { ParsedGCode } from '@/components/gcodeParse';
import { EDIT_VALUES_PER_POINT, type EditResliceInsert } from '@/utils/editKernelClient';

/**
 * Réécriture du texte d'un G-code polaire modifié par l'onglet Édition (CDC, D6) : seules les
 * lignes des mouvements modifiés (`parsed.editedMoves`) changent, leurs mots X (R), Y (C), Z, B et E
 * reprenant les valeurs validées par le noyau ; tout le reste du fichier est conservé tel quel.
 *
 * Toujours appliquée au texte D'ORIGINE du fichier chargé : `parsed.lineIndex` décrit ce texte, et
 * les mouvements portent les valeurs courantes. Réécrire plusieurs fois donne le même résultat.
 *
 * Extrusion absolue (M82) : changer le E d'un segment décale la position absolue de tous les
 * suivants. Plutôt que de réécrire tout le fichier, chaque suite de lignes modifiées est suivie
 * d'un `G92 E<valeur d'origine>` qui recale l'extrudeur : le reste du fichier reste identique.
 *
 * Re-tranchage : des séries de lignes (couches interpolées, `EditResliceInsert`) s'insèrent AVANT la ligne
 * du mouvement `before`. Comme elles décalent toute numérotation, le fichier doit ensuite être relu
 * (« cuit », cf. use-gcode-preview). En extrusion absolue, la série est suivie d'un `G92 E` qui rend
 * l'extrudeur à la valeur qu'attend la suite du fichier.
 */

export type GCodeWriteResult = { ok: true; text: string; changedLines: number } | { ok: false; error: string };

const POSITION_DIGITS = 4;
const E_DIGITS = 5;

function format(value: number, digits: number) {
  const s = value.toFixed(digits);
  return /^-0\.0+$/.test(s) ? s.slice(1) : s;
}

/** Remplace (ou ajoute) le mot `letter` dans la partie commande d'une ligne, commentaire préservé. */
function setWord(line: string, letter: string, value: string) {
  const semi = line.indexOf(';');
  let code = semi >= 0 ? line.slice(0, semi) : line;
  const comment = semi >= 0 ? line.slice(semi) : '';
  const cr = code.endsWith('\r') ? '\r' : '';
  if (cr) code = code.slice(0, -1);
  const re = new RegExp(`([${letter}${letter.toLowerCase()}])\\s*[-+]?(?:\\d+\\.?\\d*|\\.\\d+)`);
  if (re.test(code)) {
    code = code.replace(re, `$1${value}`);
  } else {
    const trimmed = code.replace(/\s+$/, '');
    code = `${trimmed} ${letter}${value}${code.slice(trimmed.length)}`;
  }
  return code + comment + cr;
}

const TRAVEL_FEED = 3600;
const FEED_RE = /[Ff]\s*([-+]?(?:\d+\.?\d*|\.\d+))/;

/** Avance (mot F) de la partie commande d'une ligne, null si absente. */
function feedOf(line: string) {
  const semi = line.indexOf(';');
  return FEED_RE.exec(semi >= 0 ? line.slice(0, semi) : line)?.[1] ?? null;
}

/**
 * Lignes d'une série insérée avant la ligne `host` (celle du mouvement `before`) : elle donne la
 * commande, l'avance des dépôts et le commentaire de type. `lastFeed` : avance en vigueur avant la série,
 * rendue par son dernier point. `startAbs` : position absolue de l'extrudeur au début de la série (NaN en
 * extrusion relative).
 */
function insertionLines(ins: EditResliceInsert, host: string, lastFeed: string | null, startAbs: number, eol: string): string[] {
  const clean = host.replace(/\r$/, '');
  const semi = clean.indexOf(';');
  const code = semi >= 0 ? clean.slice(0, semi) : clean;
  const comment = semi >= 0 ? clean.slice(semi) : '';
  const cmd = /^\s*([Gg]0?[01])\b/.exec(code)?.[1] ?? 'G00';
  const hostFeed = feedOf(clean) ?? lastFeed;
  const count = ins.extruding.length;
  const out: string[] = [`; apex: re-tranchage, ${count} points de couches interpolees${eol}`];
  const absolute = Number.isFinite(startAbs);
  let abs = startAbs;
  for (let i = 0; i < count; i++) {
    const v = ins.values.subarray(EDIT_VALUES_PER_POINT * i, EDIT_VALUES_PER_POINT * (i + 1));
    let line = `${cmd} Y${format(v[1], POSITION_DIGITS)} X${format(v[0], POSITION_DIGITS)} Z${format(v[2], POSITION_DIGITS)} B${format(v[3], POSITION_DIGITS)}`;
    if (ins.extruding[i] === 1) {
      if (absolute) {
        abs += v[4];
        line += ` E${format(abs, E_DIGITS)}`;
      } else {
        line += ` E${format(v[4], E_DIGITS)}`;
      }
      if (hostFeed) line += ` F${hostFeed}`;
      if (comment) line += ` ${comment}`;
    } else {
      // Dernier point : rend l'avance en vigueur avant la série ; les autres : déplacement rapide.
      line += ` F${i === count - 1 && lastFeed ? lastFeed : TRAVEL_FEED}`;
    }
    out.push(line + eol);
  }
  if (absolute) out.push(`G92 E${format(startAbs, E_DIGITS)} ; apex: recalage de l'extrudeur apres re-tranchage${eol}`);
  return out;
}

export function writeEditedGCode(text: string, parsed: ParsedGCode, inserts: EditResliceInsert[] = []): GCodeWriteResult {
  const edited = parsed.editedMoves;
  if ((!edited || edited.size === 0) && inserts.length === 0) return { ok: true, text, changedLines: 0 };
  if (parsed.kind !== 'polar') return { ok: false, error: "Seuls les G-code polaires de l'Apex peuvent être réécrits." };
  if (parsed.usesInches) return { ok: false, error: 'Fichier en pouces (G20) : réécriture non prise en charge.' };

  const { moves, lineIndex, eDelta, eAbsBefore, hasEWord, eRelative } = parsed;
  const order = [...(edited ?? [])].sort((a, b) => a - b);
  // Une ligne réécrite ne doit porter qu'un seul mouvement (pas d'arc découpé).
  for (const k of order) {
    const line = lineIndex[k];
    if ((k > 0 && lineIndex[k - 1] === line) || (k + 1 < moves.length && lineIndex[k + 1] === line)) {
      return { ok: false, error: `Ligne ${line + 1} : plusieurs mouvements, réécriture impossible.` };
    }
  }
  // Insertions : au plus une par mouvement, sur une ligne qui ne porte que ce mouvement.
  const insertByLine = new Map<number, EditResliceInsert>();
  for (const ins of inserts) {
    const k = ins.before;
    if (!(k >= 1 && k < moves.length) || insertByLine.has(lineIndex[k])) return { ok: false, error: `Insertion invalide avant le mouvement ${k}.` };
    const line = lineIndex[k];
    if (lineIndex[k - 1] === line || (k + 1 < moves.length && lineIndex[k + 1] === line)) {
      return { ok: false, error: `Ligne ${line + 1} : plusieurs mouvements, insertion impossible.` };
    }
    if (!eRelative[k] && !Number.isFinite(eAbsBefore[k])) return { ok: false, error: `Extrudeur inconnu avant le mouvement ${k}.` };
    insertByLine.set(line, ins);
  }

  const lines = text.split('\n');
  const after = new Map<number, string>(); // ligne → G92 à insérer après elle
  // Position absolue de l'extrudeur juste avant un mouvement modifié qui prolonge la suite précédente.
  const runAbsBefore = new Map<number, number>();
  // Position absolue (nouvelle) de l'extrudeur dans la suite de mouvements modifiés consécutifs en
  // cours ; NaN tant qu'aucun E n'y a été réécrit (les mouvements sans E ne la changent pas).
  let runAbs = NaN;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (i === 0 || order[i - 1] !== k - 1) runAbs = NaN;
    else if (Number.isFinite(runAbs)) runAbsBefore.set(k, runAbs);
    const m = moves[k];
    const ln = lineIndex[k];
    let line = lines[ln];
    line = setWord(line, 'X', format(m.x, POSITION_DIGITS));
    line = setWord(line, 'Y', format(m.y, POSITION_DIGITS));
    line = setWord(line, 'Z', format(m.z, POSITION_DIGITS));
    line = setWord(line, 'B', format(m.b, POSITION_DIGITS));
    if (hasEWord[k] && eRelative[k]) {
      line = setWord(line, 'E', format(eDelta[k], E_DIGITS));
    } else if (hasEWord[k] && Number.isFinite(eAbsBefore[k])) {
      runAbs = (Number.isFinite(runAbs) ? runAbs : eAbsBefore[k]) + eDelta[k];
      line = setWord(line, 'E', format(runAbs, E_DIGITS));
    }
    lines[ln] = line;
    // Fin de suite : recaler l'extrudeur sur la valeur que la suite du fichier attend.
    const runEnds = i + 1 >= order.length || order[i + 1] !== k + 1;
    const expected = k + 1 < moves.length ? eAbsBefore[k + 1] : NaN;
    if (runEnds && Number.isFinite(runAbs) && Number.isFinite(expected) && Math.abs(expected - runAbs) > 10 ** -E_DIGITS) {
      after.set(ln, `G92 E${format(expected, E_DIGITS)} ; apex: recalage de l'extrudeur apres modification`);
    }
  }

  const out: string[] = [];
  const eol = text.includes('\r\n') ? '\r' : '';
  let lastFeed: string | null = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const ins = insertByLine.get(ln);
    if (ins) {
      const k = ins.before;
      const startAbs = eRelative[k] ? NaN : (runAbsBefore.get(k) ?? eAbsBefore[k]);
      for (const line of insertionLines(ins, lines[ln], lastFeed, startAbs, eol)) out.push(line);
    }
    out.push(lines[ln]);
    const f = feedOf(lines[ln]);
    if (f) lastFeed = f;
    const g92 = after.get(ln);
    if (g92) out.push(g92 + eol);
  }
  return { ok: true, text: out.join('\n'), changedLines: order.length + inserts.length };
}

/**
 * G-code tranché par Apex (modifiable en place) ou importé (EXPORT COPY seulement), d'après le
 * marqueur que le moteur écrira dans l'en-tête (CDC, D4). Tant que le moteur ne l'écrit pas, tout
 * fichier est « importé ».
 */
export function isLocallySliced(text: string): boolean {
  const head = text.slice(0, 20000);
  return /^\s*;\s*apex_sliced\s*[:=]\s*(1|true)\b/im.test(head);
}
