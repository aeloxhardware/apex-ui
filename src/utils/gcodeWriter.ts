import type { InsertedRange, ParsedGCode } from '@/components/gcodeParse';
import { INSERTED_LINE } from '@/utils/gcodeSplice';

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
 * Re-tranchage : les plages de mouvements insérées par l'édition (`parsed.insertedBlocks`, couches
 * interpolées, sans ligne dans le texte d'origine) sont écrites AVANT la ligne du mouvement d'origine qui
 * les suit. En extrusion absolue, la plage est suivie d'un `G92 E` qui rend l'extrudeur à la valeur
 * qu'attend la suite du fichier.
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
 * Lignes d'une plage de mouvements insérés (couches interpolées), écrites avant la ligne `host` (celle du
 * mouvement devant lequel elles entrent) : elle donne la commande, l'avance des dépôts et le commentaire de
 * type. `lastFeed` : avance en vigueur avant la plage, rendue par son dernier point. `startAbs` : position
 * absolue de l'extrudeur au début de la plage (NaN en extrusion relative).
 */
function insertedLines(parsed: ParsedGCode, range: InsertedRange, host: string, lastFeed: string | null, startAbs: number, eol: string): string[] {
  const clean = host.replace(/\r$/, '');
  const semi = clean.indexOf(';');
  const code = semi >= 0 ? clean.slice(0, semi) : clean;
  const comment = semi >= 0 ? clean.slice(semi) : '';
  const cmd = /^\s*([Gg]0?[01])\b/.exec(code)?.[1] ?? 'G00';
  const hostFeed = feedOf(clean) ?? lastFeed;
  const out: string[] = [`; apex: re-tranchage, ${range.count} points de couches interpolees${eol}`];
  const absolute = Number.isFinite(startAbs);
  let abs = startAbs;
  for (let i = 0; i < range.count; i++) {
    const k = range.at + i;
    const m = parsed.moves[k];
    let line = `${cmd} Y${format(m.y, POSITION_DIGITS)} X${format(m.x, POSITION_DIGITS)} Z${format(m.z, POSITION_DIGITS)} B${format(m.b, POSITION_DIGITS)}`;
    if (m.extruding) {
      if (absolute) {
        abs += parsed.eDelta[k];
        line += ` E${format(abs, E_DIGITS)}`;
      } else {
        line += ` E${format(parsed.eDelta[k], E_DIGITS)}`;
      }
      if (hostFeed) line += ` F${hostFeed}`;
      if (comment) line += ` ${comment}`;
    } else {
      // Dernier point : rend l'avance en vigueur avant la plage ; les autres : déplacement rapide.
      line += ` F${i === range.count - 1 && lastFeed ? lastFeed : TRAVEL_FEED}`;
    }
    out.push(line + eol);
  }
  if (absolute) out.push(`G92 E${format(startAbs, E_DIGITS)} ; apex: recalage de l'extrudeur apres re-tranchage${eol}`);
  return out;
}

export function writeEditedGCode(text: string, parsed: ParsedGCode): GCodeWriteResult {
  const edited = parsed.editedMoves;
  const blocks = parsed.insertedBlocks ?? [];
  if ((!edited || edited.size === 0) && blocks.length === 0) return { ok: true, text, changedLines: 0 };
  if (parsed.kind !== 'polar') return { ok: false, error: "Seuls les G-code polaires de l'Apex peuvent être réécrits." };
  if (parsed.usesInches) return { ok: false, error: 'Fichier en pouces (G20) : réécriture non prise en charge.' };

  const { moves, lineIndex, eDelta, eAbsBefore, hasEWord, eRelative } = parsed;
  const isInserted = (k: number) => lineIndex[k] === INSERTED_LINE;
  // Mouvements d'origine seulement : les mouvements insérés n'ont pas de ligne à réécrire.
  const order = [...(edited ?? [])].filter((k) => !isInserted(k)).sort((a, b) => a - b);
  // Une ligne réécrite ne doit porter qu'un seul mouvement (pas d'arc découpé).
  const sharesLine = (k: number) => {
    const line = lineIndex[k];
    return (k > 0 && lineIndex[k - 1] === line) || (k + 1 < moves.length && lineIndex[k + 1] === line);
  };
  for (const k of order) {
    if (sharesLine(k)) return { ok: false, error: `Ligne ${lineIndex[k] + 1} : plusieurs mouvements, réécriture impossible.` };
  }
  // Plages insérées : chacune entre devant un mouvement d'origine (son « hôte »), seul sur sa ligne.
  const blockByLine = new Map<number, InsertedRange>();
  for (const range of blocks) {
    const host = range.at + range.count;
    if (host >= moves.length || isInserted(host)) return { ok: false, error: `Insertion invalide avant le mouvement ${host}.` };
    if (sharesLine(host)) return { ok: false, error: `Ligne ${lineIndex[host] + 1} : plusieurs mouvements, insertion impossible.` };
    if (!eRelative[host] && !Number.isFinite(eAbsBefore[host])) return { ok: false, error: `Extrudeur inconnu avant le mouvement ${host}.` };
    blockByLine.set(lineIndex[host], range);
  }
  // Premier mouvement d'origine après k (les plages insérées sont sautées) : c'est lui qu'attend la suite du fichier.
  const nextOriginal = (k: number) => {
    let j = k + 1;
    while (j < moves.length && isInserted(j)) j++;
    return j;
  };

  const lines = text.split('\n');
  const after = new Map<number, string>(); // ligne → G92 à insérer après elle
  // Position absolue (nouvelle) de l'extrudeur dans la suite de mouvements modifiés consécutifs en
  // cours ; NaN tant qu'aucun E n'y a été réécrit (les mouvements sans E ne la changent pas).
  let runAbs = NaN;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (i === 0 || order[i - 1] !== k - 1) runAbs = NaN;
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
    const next = nextOriginal(k);
    const expected = next < moves.length ? eAbsBefore[next] : NaN;
    if (runEnds && Number.isFinite(runAbs) && Number.isFinite(expected) && Math.abs(expected - runAbs) > 10 ** -E_DIGITS) {
      after.set(ln, `G92 E${format(expected, E_DIGITS)} ; apex: recalage de l'extrudeur apres modification`);
    }
  }

  const out: string[] = [];
  const eol = text.includes('\r\n') ? '\r' : '';
  let lastFeed: string | null = null;
  for (let ln = 0; ln < lines.length; ln++) {
    const range = blockByLine.get(ln);
    if (range) {
      const host = range.at + range.count;
      // L'extrudeur est, devant l'hôte, à la valeur d'origine (les suites modifiées qui précèdent l'ont recalé).
      const startAbs = eRelative[host] ? NaN : eAbsBefore[host];
      for (const line of insertedLines(parsed, range, lines[ln], lastFeed, startAbs, eol)) out.push(line);
    }
    out.push(lines[ln]);
    const f = feedOf(lines[ln]);
    if (f) lastFeed = f;
    const g92 = after.get(ln);
    if (g92) out.push(g92 + eol);
  }
  return { ok: true, text: out.join('\n'), changedLines: order.length + blocks.length };
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
