import { showError, showSuccess, showWarning } from '@/utils/toast';
import { SUSPICIOUS_C_RANGE_DEG, PLATE_RADIUS_MM, type ParsedGCode, type ConversionMode } from '@/components/gcodeLayer';
import { resolveGenerator } from '@/components/gcodeGenerator';
import { runConversion } from '@/utils/gcodeConversion';
import { parseGCodeAsync } from '@/utils/gcodeParseAsync';
import { isLocallySliced, writeEditedGCode } from '@/utils/gcodeWriter';
import { removeAirContours } from '@/utils/gcodeAirRemoval';
import { readApexHeader, writeApexHeader, type ApexHeaderPayload } from '@/utils/apexHeader';
import { isEditJournalEnabled } from '@/utils/editJournalPrefs';
import { EDIT_FILE_INFO_EVENT, type EditFileInfo, type EditSaveMode } from '@/components/edit-node/editProtocol';
import type { ConversionState, GCodeFileInfo } from './use-gcode-preview';

import { emitApex } from '@/events/apexEvents';
/** Opérations de chargement, conversion et enregistrement du G-code affiché (sans React : l'état passe par `GCodeSession`). */

export const GCODE_FILE_EXT = /\.(gcode|gco|g|ngc)$/i;
export const GCODE_ACCEPT = '.gcode,.gco,.g,.ngc';
export const IDLE_CONVERSION: ConversionState = { status: 'idle', progress: 0, mode: null, error: null };

/** Au-delà (caractères du texte), le chargement affiche le rideau le temps de l'analyse (worker) et
 * de la construction du maillage (par tranches) — l'interface, elle, ne gèle jamais. */
const HEAVY_GCODE_CHARS = 8_000_000;

type Ref<T> = { current: T };

/** Ce que partagent les opérations : références vers le fichier courant et rappels d'état React. */
export interface GCodeSession {
  parsedRef: Ref<ParsedGCode | null>;
  tRef: Ref<number>;
  loadSeqRef: Ref<number>;
  /** Fichier 3 axes chargé par l'utilisateur (source de la conversion polaire, gardée pour reconvertir). */
  sourceRef: Ref<{ text: string; name: string; parsed: ParsedGCode } | null>;
  /** `text` est le texte D'ORIGINE du fichier chargé (base de toute réécriture après édition) ;
   * `path` son chemin sur disque quand il est connu (modification en place). */
  currentRef: Ref<{ text: string; name: string; path: string | null } | null>;
  getConversionStatus: () => ConversionState['status'];
  setIsPlaying: (playing: boolean) => void;
  setT: (t: number) => void;
  resetColor: () => void;
  setFileInfo: (info: GCodeFileInfo) => void;
  setIsLoading: (loading: boolean) => void;
  setConversion: (next: ConversionState | ((prev: ConversionState) => ConversionState)) => void;
}

/** Surlignage rouge, dans le viewport, des traits hors plateau de la source 3 axes affichée —
 * clignotant (`blinking`) pendant que la conversion qui va les retirer est en cours, pour rester
 * visible sans jamais s'éteindre. */
export const setOffPlateHighlight = (show: boolean, blinking = false) =>
  emitApex('apex-gcode-highlight-offplate', { show, blinking });

/** Rideau de chargement (SpaceTransitionOverlay) : l'afficher s'il n'est pas déjà là, le garder
 * jusqu'à `active: false`. */
const setLoadingCurtain = (active: boolean) =>
  emitApex('apex-gcode-loading', { active, label: 'Chargement' });

/** Tranché par Apex : marqueur en clair écrit par le moteur, ou marqueur du bloc chiffré (D4). */
const canSaveInPlace = (s: GCodeSession) => {
  const current = s.currentRef.current;
  const sliced = !!current && (isLocallySliced(current.text) || !!s.parsedRef.current?.apexHeader?.sliced);
  return !!current?.path && !!window.apexDesktop && sliced;
};

export const publishEditFileInfo = (s: GCodeSession) => {
  const detail: EditFileInfo = { name: s.currentRef.current?.name ?? null, canSaveInPlace: canSaveInPlace(s) };
  window.dispatchEvent(new CustomEvent(EDIT_FILE_INFO_EVENT, { detail }));
};

const fileInfoOf = (parsed: ParsedGCode, name: string): GCodeFileInfo => ({
  name,
  kind: parsed.kind,
  lineStats: parsed.lineStats,
  totalTime: parsed.times[parsed.times.length - 1],
  generator: parsed.generator,
  printer: parsed.printer,
  nonPlanar: parsed.nonPlanar,
  toolOriented: parsed.toolOriented,
  conversion: parsed.conversion,
  moves: parsed.moves.length,
  extruding: parsed.extrudingCount,
  minZ: parsed.minZ,
  maxZ: parsed.maxZ,
  minC: parsed.minC,
  maxC: parsed.maxC,
  colorByRanges: parsed.ranges,
});

/** Affiche un G-code analysé : en-tête Apex, événement au viewport, informations du fichier. */
async function applyParsed(s: GCodeSession, parsed: ParsedGCode, text: string, name: string, seq: number): Promise<ParsedGCode | null> {
  // En-tête chiffré Apex (métadonnées, marqueur, journal) : lu AVANT l'affichage, pour que
  // l'onglet Édition retrouve l'historique dès le chargement du noyau.
  try {
    parsed.apexHeader = await readApexHeader(text);
  } catch {
    parsed.apexHeader = null;
    showWarning("En-tête Apex illisible : l'historique des modifications de ce fichier est ignoré.");
  }
  // Un seul déchiffrement par fichier : le même bloc donne le journal et la version du générateur.
  parsed.generator = resolveGenerator(text, parsed.generator, parsed.apexHeader);
  if (seq !== s.loadSeqRef.current) return null;
  s.parsedRef.current = parsed;
  s.currentRef.current = { text, name, path: null };
  if (import.meta.env.DEV) (window as unknown as { __apexGCodeText?: () => string | null }).__apexGCodeText = () => s.currentRef.current?.text ?? null;
  const last = parsed.moves.length - 1;
  s.tRef.current = last;
  s.setIsPlaying(false);
  s.setT(last);
  s.resetColor();
  // Le viewport construit le maillage par tranches et résout `onBuilt` à la fin ; sans viewport à
  // l'écoute (`handled` resté faux), rien à attendre.
  await new Promise<void>((resolve) => {
    const detail = { parsed, handled: false, onBuilt: resolve };
    emitApex('apex-gcode-loaded', detail);
    if (!detail.handled) resolve();
  });
  if (seq !== s.loadSeqRef.current) return null;
  s.setFileInfo(fileInfoOf(parsed, name));
  return parsed;
}

/** Parse (worker) et affiche un G-code ; renvoie le résultat, ou null (erreur déjà signalée, ou
 * chargement supplanté par un plus récent). */
async function loadGCodeText(s: GCodeSession, text: string, name: string): Promise<ParsedGCode | null> {
  const seq = ++s.loadSeqRef.current;
  const heavy = text.length > HEAVY_GCODE_CHARS;
  if (heavy) setLoadingCurtain(true);
  try {
    let parsed: ParsedGCode;
    try {
      parsed = await parseGCodeAsync(text);
    } catch {
      showError('Impossible de lire ce fichier G-code.');
      return null;
    }
    if (seq !== s.loadSeqRef.current) return null;
    if (parsed.moves.length < 2) {
      showError('Aucune trajectoire exploitable dans ce fichier.');
      return null;
    }
    return await applyParsed(s, parsed, text, name, seq);
  } finally {
    if (heavy && seq === s.loadSeqRef.current) setLoadingCurtain(false);
  }
}

/** Message affiché une fois le fichier chargé (dérive de C, ancien moteur, ou succès). */
function announceLoaded(parsed: ParsedGCode, text: string) {
  // Un C qui accumule les tours est normal dans un fichier converti (le plateau suit la pièce) et dans
  // un fichier du moteur (Y déroulé, contrat C4 : marqueur `; apex_sliced = 1`).
  if (parsed.kind === 'polar' && !parsed.conversion && !isLocallySliced(text)
    && parsed.maxC - parsed.minC > SUSPICIOUS_C_RANGE_DEG) {
    showWarning(`L'angle C dérive sur ${(parsed.maxC - parsed.minC).toFixed(0)}° : ce fichier vient probablement d'une version boguée du générateur.`);
  } else if (parsed.kind === 'polar' && !parsed.kinematicsDeclared && isLocallySliced(text)) {
    // Fichier du moteur d'avant la ligne `; apex_kinematics` (R-007) : on ne peut que supposer la longueur d'alors.
    showWarning(`G-code d'une ancienne version du moteur (sans cinématique déclarée) : longueur pivot-pointe supposée à ${parsed.kinematics.pivotToTip} mm.`);
  } else {
    showSuccess(`G-code chargé : ${parsed.moves.length} mouvements.`);
  }
}

/** Charge un fichier G-code (dépôt ou sélecteur). */
export async function loadGCodeFile(s: GCodeSession, file: File) {
  if (!GCODE_FILE_EXT.test(file.name)) {
    showError('Format non supporté. Utilisez un fichier .gcode, .gco, .g ou .ngc.');
    return;
  }
  s.setIsLoading(true);
  const text = await file.text().catch((): string | null => null);
  const parsed = text === null ? null : await loadGCodeText(s, text, file.name);
  s.setIsLoading(false);
  if (!parsed) return;
  if (s.currentRef.current) s.currentRef.current.path = window.apexDesktop?.pathForFile?.(file) ?? null;
  publishEditFileInfo(s);

  // Nouveau fichier : il devient la source d'une éventuelle conversion polaire (s'il est 3 axes).
  s.sourceRef.current = parsed.kind === 'cartesian'
    ? { text: text!, name: file.name, parsed }
    : null;
  s.setConversion(IDLE_CONVERSION);
  setOffPlateHighlight(false);
  announceLoaded(parsed, text!);
}

type ConversionSummary = NonNullable<Awaited<ReturnType<typeof runConversion>>['summary']>;

/** Texte du message de succès d'une conversion (écart, avertissements du convertisseur natif). */
function conversionMessage(mode: ConversionMode, summary: ConversionSummary | null | undefined): string {
  const detail = summary
    ? ` (écart max ${summary.maxErrorMm.toFixed(3).replace('.', ',')} mm${mode === 'dynamic' ? `, B de ${summary.bMin.toFixed(0)}° à ${summary.bMax.toFixed(0)}°` : ''}${summary.droppedMoves ? `, ${summary.droppedMoves} mouvements hors plateau supprimés` : ''})`
    : '';
  // Convertisseur natif : avertissements que le script Python ne produisait pas.
  const notes: string[] = [];
  if (summary?.collisionChecked) {
    notes.push(summary.collisionsAfter
      ? `${summary.collisionsAfter} pose(s) de tête encore en collision sur ${summary.posesTested} testées`
      : `aucune collision de la tête sur ${summary.posesTested} poses testées${summary.collisionsBefore ? ` (${summary.collisionsBefore} évitées)` : ''}`);
  }
  if (summary?.beyondPlateMoves) {
    notes.push(`${summary.beyondPlateMoves} mouvements au-delà du plateau (rayon max ${summary.maxTipRadiusMm?.toFixed(1)} mm)`);
  }
  return `G-code converti en polaire${mode === 'dynamic' ? ' à angle dynamique' : ''}${detail}.${notes.length ? ` ${notes.join(' ; ')}.` : ''}`;
}

/** Convertit la source 3 axes en G-code polaire Apex (script Python de l'application de bureau)
 * et affiche le résultat ; la source est conservée pour reconvertir dans l'autre mode. */
export async function convertSource(s: GCodeSession, mode: ConversionMode, dropOffPlate: boolean) {
  const source = s.sourceRef.current;
  if (!source || s.getConversionStatus() === 'running') return;
  // Traits hors plateau déjà surlignés en rouge (confirmation dans GCodeConversionCard) : ils restent
  // affichés, mais clignotent pendant que la conversion qui va les retirer tourne, pour signaler qu'un
  // changement est en cours sans les faire disparaître. Sans traits hors plateau, rien à surligner.
  const hasOffPlate = source.parsed.offPlate.traits > 0;
  if (hasOffPlate) setOffPlateHighlight(true, true);
  s.setConversion({ status: 'running', progress: 0, mode, error: null });
  try {
    const { text, summary } = await runConversion(
      {
        text: source.text,
        mode,
        centerX: source.parsed.bedCenter.x,
        centerY: source.parsed.bedCenter.y,
        source: source.parsed.generator?.name ?? source.name,
        dropOutsideRadius: dropOffPlate ? PLATE_RADIUS_MM : 0,
      },
      (progress) => s.setConversion((prev) => (prev.status === 'running' ? { ...prev, progress } : prev)),
    );
    const name = `${source.name.replace(/\.[^.]+$/, '')}_apex${mode === 'dynamic' ? '_dynamique' : ''}.gcode`;
    // loadGCodeText() charge le G-code CONVERTI (polaire) : les anciens traits hors-plateau du fichier
    // source n'existent plus dans ce nouveau tracé ; on éteint explicitement le surlignage.
    if (!(await loadGCodeText(s, text, name))) throw new Error('Le G-code converti est illisible.');
    publishEditFileInfo(s);
    setOffPlateHighlight(false);
    s.setConversion({ status: 'done', progress: 100, mode, error: null });
    showSuccess(conversionMessage(mode, summary));
  } catch (err) {
    // Échec : les traits hors-plateau du fichier source restent affichés s'ils l'étaient, mais
    // arrêtent de clignoter — le clignotement ne signifie qu'une conversion EN COURS.
    if (hasOffPlate) setOffPlateHighlight(true, false);
    const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
    s.setConversion({ status: 'error', progress: 0, mode, error: message });
    showError(`Conversion impossible : ${message}`);
  }
}

/** Enregistre un texte G-code (boîte d'enregistrement native, ou téléchargement hors application). */
async function exportText(text: string, name: string) {
  try {
    if (window.apexDesktop) {
      const result = await window.apexDesktop.saveGCode({ name, text });
      if (result.saved) showSuccess(`G-code exporté : ${result.path}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    showError(`Export impossible : ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Texte du G-code affiché, modifications de l'onglet Édition comprises (lignes réécrites, et
 * journal dans l'en-tête chiffré si le réglage est activé) ; null si la réécriture est impossible
 * (erreur déjà signalée). */
export async function currentGCodeText(s: GCodeSession): Promise<string | null> {
  const current = s.currentRef.current;
  const parsed = s.parsedRef.current;
  if (!current) return null;
  if (!parsed) return current.text;
  const result = writeEditedGCode(current.text, parsed);
  if ('error' in result) {
    showError(`Enregistrement impossible : ${result.error}`);
    return null;
  }
  const journal = parsed.editJournal;
  // Des plages insérées (re-tranchage) décalent la numérotation : le journal ne vaudrait plus pour le fichier écrit.
  const hasJournal = !!journal && !parsed.insertedBlocks?.length && (journal.undo.length > 0 || journal.redo.length > 0);
  const header = parsed.apexHeader;
  // Rien à changer à l'en-tête : ni journal à écrire, ni journal existant à retirer.
  if (!hasJournal && !header?.journal) return result.text;
  const payload: ApexHeaderPayload = { ...(header ?? {}), format: 1 };
  if (hasJournal && isEditJournalEnabled()) payload.journal = journal;
  else delete payload.journal;
  const empty = !payload.journal && !payload.sliced && !payload.meta;
  try {
    return await writeApexHeader(result.text, empty ? null : payload);
  } catch (err) {
    showError(`En-tête Apex impossible à écrire : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Enregistre le G-code affiché, modifications comprises. */
export async function exportCurrentGCode(s: GCodeSession) {
  const current = s.currentRef.current;
  const text = await currentGCodeText(s);
  if (current && text !== null) await exportText(text, current.name);
}

/** Modification en place (G-code tranché par Apex, chemin connu — CDC D4, D6) ou EXPORT COPY.
 * Si l'écriture en place échoue, la copie est proposée à la place. */
export async function saveEditedGCode(s: GCodeSession, mode: EditSaveMode) {
  const current = s.currentRef.current;
  const text = await currentGCodeText(s);
  if (!current || text === null) return;
  if (mode === 'inplace' && canSaveInPlace(s) && window.apexDesktop) {
    try {
      await window.apexDesktop.writeGCode({ path: current.path!, text });
      showSuccess(`G-code enregistré : ${current.path}`);
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
      showError(`Écriture impossible (${reason}) : enregistrez une copie.`);
    }
  }
  await exportText(text, current.name);
}

/** Retire les contours dans l'air du G-code affiché et affiche le résultat (le fichier d'origine
 * n'est pas touché : copie à l'export). */
export async function removeAirContoursFromCurrent(s: GCodeSession) {
  const current = s.currentRef.current;
  const parsed = s.parsedRef.current;
  if (!current || !parsed) return;
  const result = removeAirContours(current.text, parsed);
  if ('error' in result) { showError(`Suppression impossible : ${result.error}`); return; }
  const path = current.path;
  const next = await loadGCodeText(s, result.text, current.name);
  if (!next) return;
  if (s.currentRef.current) s.currentRef.current.path = path;
  publishEditFileInfo(s);
  s.sourceRef.current = next.kind === 'cartesian' ? { text: result.text, name: current.name, parsed: next } : null;
  showSuccess(`${result.contours} contour${result.contours > 1 ? 's' : ''} en l'air supprimé${result.contours > 1 ? 's' : ''} (${result.removedMm.toFixed(0)} mm de matière) : exportez une copie pour l'enregistrer.`);
}
