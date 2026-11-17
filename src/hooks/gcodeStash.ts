/**
 * G-code et changement d'espace : l'Accueil et les Paramètres démontent le viewport (donc le tracé 3D),
 * mais le G-code ouvert ne s'efface pas. En quittant la 3D, son texte (modifications de l'onglet Édition
 * comprises) est déposé dans un fichier temporaire (spaceStash.ts) et l'analyse est libérée de la RAM ;
 * au retour, il est relu, ré-analysé et le tracé reconstruit, à la même position de lecture.
 */
import type { ParsedGCode } from '@/components/gcodeLayer';
import { emitApex } from '@/events/apexEvents';
import { parseGCodeAsync } from '@/utils/gcodeParseAsync';
import { stashPeekText, stashPutText, stashTakeText } from '@/utils/spaceStash';
import { currentGCodeText, loadGCodeText, publishEditFileInfo, type GCodeSession } from './gcodePreviewSession';

const CURRENT_KEY = 'gcode-current';
const SOURCE_KEY = 'gcode-source';

/** Ce qu'il faut pour remettre le G-code en place ; le texte lui-même est dans la réserve. */
export interface GCodeStashMeta {
  name: string;
  path: string | null;
  /** Position de lecture à retrouver. */
  t: number;
  /** Source 3 axes de la conversion : dans son propre fichier (`separate`) ou identique au G-code affiché. */
  source: { name: string; separate: boolean } | null;
}

/** Dépose le G-code affiché dans la réserve et libère la RAM ; null (rien n'est libéré) s'il n'y a rien à
 * garder, si une conversion tourne, ou si le texte ne peut pas être relu à l'identique. */
export async function suspendGCode(s: GCodeSession): Promise<GCodeStashMeta | null> {
  const current = s.currentRef.current;
  if (!current || !s.parsedRef.current || s.getConversionStatus() === 'running') return null;
  const text = await currentGCodeText(s);
  if (text === null) return null;
  const source = s.sourceRef.current;
  const separate = !!source && source.text !== current.text;
  await stashPutText(CURRENT_KEY, text);
  if (source && separate) await stashPutText(SOURCE_KEY, source.text);
  const meta: GCodeStashMeta = {
    name: current.name,
    path: current.path,
    t: s.tRef.current,
    source: source ? { name: source.name, separate } : null,
  };
  s.parsedRef.current = null;
  s.currentRef.current = null;
  s.sourceRef.current = null;
  return meta;
}

/** Source 3 axes retrouvée dans la réserve (ou identique au G-code), ré-analysée. */
async function restoreSource(s: GCodeSession, meta: GCodeStashMeta, text: string, parsed: ParsedGCode) {
  if (!meta.source) return;
  if (!meta.source.separate) {
    s.sourceRef.current = { text, name: meta.source.name, parsed };
    return;
  }
  const sourceText = await stashTakeText(SOURCE_KEY);
  if (sourceText === null) return;
  s.sourceRef.current = { text: sourceText, name: meta.source.name, parsed: await parseGCodeAsync(sourceText) };
}

/** Relit le G-code de la réserve, le ré-analyse et le rend au viewport. Faux si le fichier a disparu ou est illisible. */
export async function restoreGCode(s: GCodeSession, meta: GCodeStashMeta): Promise<boolean> {
  const text = await stashTakeText(CURRENT_KEY);
  if (text === null) return false;
  const parsed = await loadGCodeText(s, text, meta.name);
  if (!parsed) return false;
  if (s.currentRef.current) s.currentRef.current.path = meta.path;
  s.tRef.current = meta.t;
  s.setT(meta.t);
  emitApex('apex-gcode-time', { t: meta.t });
  publishEditFileInfo(s);
  await restoreSource(s, meta, text, parsed);
  return true;
}

/** Viewport remonté alors que l'analyse était restée en mémoire (rien n'avait pu être déposé) : on lui rend le tracé. */
export async function reshowGCode(s: GCodeSession) {
  const parsed = s.parsedRef.current;
  if (!parsed) return;
  await new Promise<void>((resolve) => {
    const detail = { parsed, handled: false, onBuilt: resolve };
    emitApex('apex-gcode-loaded', detail);
    if (!detail.handled) resolve();
  });
  emitApex('apex-gcode-time', { t: s.tRef.current });
}

/** G-code du projet : celui affiché, ou celui mis en réserve si l'espace quitté l'a déposé sur disque. */
export async function gcodeForProject(s: GCodeSession, meta: GCodeStashMeta | null): Promise<{ name: string; text: string } | null> {
  if (meta) {
    const text = await stashPeekText(CURRENT_KEY);
    return text === null ? null : { name: meta.name, text };
  }
  const current = s.currentRef.current;
  const text = current ? await currentGCodeText(s) : null;
  return current && text !== null ? { name: current.name, text } : null;
}
