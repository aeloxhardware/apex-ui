import { useCallback, useEffect, useRef, useState } from 'react';
import { showError, showSuccess, showWarning } from '@/utils/toast';
import {
  stateAt,
  timeAtIndex,
  indexAtTime,
  SUSPICIOUS_C_RANGE_DEG,
  PLATE_RADIUS_MM,
  type ParsedGCode,
  type GCodeKind,
  type LineTypeStat,
  type ConversionMode,
  type ColorByMode,
  type ColorByRanges,
  type ContinuousColorByMode,
} from '@/components/gcodeLayer';
import { DEFAULT_LINE_VISIBILITY, type LineTypeId, type LineTypeVisibility } from '@/components/gcodeLineTypes';
import { defaultColorByScope, COLOR_BY_LABELS, type ColorByScope } from '@/components/gcodeColormap';
import type { GCodeGenerator } from '@/components/gcodeGenerator';
import { isConversionAvailable, runConversion } from '@/utils/gcodeConversion';
import { parseGCodeAsync } from '@/utils/gcodeParseAsync';
import { isLocallySliced, writeEditedGCode } from '@/utils/gcodeWriter';
import { readApexHeader, writeApexHeader, type ApexHeaderPayload } from '@/utils/apexHeader';
import { isEditJournalEnabled } from '@/utils/editJournalPrefs';
import {
  EDIT_FILE_INFO_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_SAVE_EVENT,
  type EditFileInfo,
  type EditSaveMode,
} from '@/components/edit-node/editProtocol';

/**
 * Logique de l'espace Prévisualisation, sans interface : chargement de fichier G-code (dépôt sur
 * la fenêtre ou sélecteur), horloge de lecture et affichage des trajets à vide. Le rendu 3D est
 * fait par Viewport3D, piloté par les événements :
 *  - `apex-gcode-loaded` { parsed } : nouvelle trajectoire à afficher ;
 *  - `apex-gcode-time` { t } : position de lecture (index de mouvement fractionnaire) ;
 *  - `apex-gcode-line-visibility` { visibility } : types de ligne affichés (cf. gcodeLineTypes.ts) ;
 *  - `apex-gcode-color-by` { mode, scope? } : critère de coloration du tracé et sa portée affichée
 *    (curseurs min/max de la légende), cf. gcodeColormap.ts.
 */

// Multiplicateurs du temps machine réel (1 = vitesse d'impression réelle, avances F du fichier).
export const GCODE_SPEED_OPTIONS = [0.01, 1, 4, 16, 64, 256];
export const GCODE_ACCEPT = '.gcode,.gco,.g,.ngc';
/** Reconnaît un nom de fichier G-code par son extension — exporté pour Sidebar.tsx (bascule
 * automatique vers l'espace Prévisualisation au dépôt d'un tel fichier en Préparation). */
export const GCODE_FILE_EXT = /\.(gcode|gco|g|ngc)$/i;

export interface GCodeFileInfo {
  name: string;
  kind: GCodeKind;
  lineStats: Record<LineTypeId, LineTypeStat>;
  /** Temps machine total (s). */
  totalTime: number;
  generator: GCodeGenerator | null;
  printer: string | null;
  /** 3 axes à Z variable dans les couches : l'angle dynamique est recommandé pour la conversion. */
  nonPlanar: boolean;
  /** 3 axes dont le fichier pilote l'orientation de l'outil (B/C) : la tête s'incline à la lecture. */
  toolOriented: boolean;
  /** Fichier issu de la conversion polaire d'Apex (mode), sinon null. */
  conversion: ConversionMode | null;
  moves: number;
  extruding: number;
  minZ: number;
  maxZ: number;
  minC: number;
  maxC: number;
  /** Min/max/moyenne de chaque critère de coloration continu, pour le dégradé de la légende
   * (cf. GCodeLineTypeLegend.tsx et gcodeColormap.ts). */
  colorByRanges: ColorByRanges;
}

export interface ConversionState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** Avancement 0–100 pendant la conversion. */
  progress: number;
  /** Mode demandé (en cours) ou obtenu (terminé). */
  mode: ConversionMode | null;
  error: string | null;
}

const IDLE_CONVERSION: ConversionState = { status: 'idle', progress: 0, mode: null, error: null };

/** Surlignage rouge, dans le viewport, des traits hors plateau de la source 3 axes affichée —
 * clignotant (`blinking`) pendant que la conversion qui va les retirer est en cours, pour rester
 * visible sans jamais s'éteindre (cf. `convert`, plus bas). */
const setOffPlateHighlight = (show: boolean, blinking = false) =>
  window.dispatchEvent(new CustomEvent('apex-gcode-highlight-offplate', { detail: { show, blinking } }));

/** Au-delà (caractères du texte), le chargement affiche le rideau le temps de l'analyse (worker) et
 * de la construction du maillage (par tranches) — l'interface, elle, ne gèle jamais. */
const HEAVY_GCODE_CHARS = 8_000_000;

/** Rideau de chargement (SpaceTransitionOverlay) : l'afficher s'il n'est pas déjà là, le garder
 * jusqu'à `active: false`. */
const setLoadingCurtain = (active: boolean) =>
  window.dispatchEvent(new CustomEvent('apex-gcode-loading', { detail: { active, label: 'Chargement' } }));

const dispatchTime = (t: number) =>
  window.dispatchEvent(new CustomEvent('apex-gcode-time', { detail: { t } }));

/** @param active Espace Prévisualisation affiché (active le dépôt de fichier, coupe la lecture sinon). */
export function useGCodePreview(active: boolean) {
  const parsedRef = useRef<ParsedGCode | null>(null);
  const tRef = useRef(0);
  const dragDepthRef = useRef(0);

  const [fileInfo, setFileInfo] = useState<GCodeFileInfo | null>(null);
  const [t, setT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(GCODE_SPEED_OPTIONS[1]);
  const [lineVisibility, setLineVisibility] = useState<LineTypeVisibility>(DEFAULT_LINE_VISIBILITY);
  const [showFullHead, setShowFullHead] = useState(true);
  /** Critère de coloration du tracé (cf. gcodeColormap.ts) ; remis à `lineType` à chaque nouveau
   * fichier chargé (cf. `loadText`), comme les autres réglages qui n'ont plus de sens d'un fichier
   * à l'autre. */
  const [colorBy, setColorByState] = useState<ColorByMode>('lineType');
  /** Portée affichée (curseurs min/max + « hors-portée en gris ») de chaque mode continu, mémorisée
   * par mode pendant la session (retour à un mode déjà réglé → sa portée resserrée est toujours là) ;
   * absente tant que l'utilisateur n'y a jamais touché, auquel cas les bornes réelles du fichier
   * (cf. `fileInfo.colorByRanges`) servent de valeur effective (cf. `activeColorByScope` plus bas).
   * Réinitialisée à chaque nouveau fichier chargé, comme `colorBy`. */
  const [colorByScopes, setColorByScopes] = useState<Partial<Record<ContinuousColorByMode, ColorByScope>>>({});
  // Précision du rendu (longueur max de sous-segment cartésien, mm) en mode continu (cf.
  // gcodeLayer.ts, « Précision du rendu » de la légende) ; null = comportement le moins précis
  // (un anneau par mouvement, valeur par défaut avant tout réglage). Mémorisée par mode comme
  // colorByScopes ; réinitialisée à chaque nouveau fichier chargé.
  const [renderPrecisionMm, setRenderPrecisionMmState] = useState<Partial<Record<ContinuousColorByMode, number>>>({});
  const [isDragging, setIsDragging] = useState(false);
  // Le temps de lire le fichier et de parser son texte (`loadFile`, ci-dessous) : permet à
  // GCodePreviewBar de s'afficher dès le début du chargement plutôt que d'attendre `fileInfo`.
  const [isLoading, setIsLoading] = useState(false);
  // Fichier 3 axes chargé par l'utilisateur (source de la conversion polaire, gardée après
  // conversion pour reconvertir dans l'autre mode) et G-code actuellement affiché (celui exporté).
  const sourceRef = useRef<{ text: string; name: string; parsed: ParsedGCode } | null>(null);
  // `text` est le texte D'ORIGINE du fichier chargé (base de toute réécriture après édition, cf.
  // gcodeWriter.ts) ; `path` son chemin sur disque quand il est connu (modification en place).
  const currentRef = useRef<{ text: string; name: string; path: string | null } | null>(null);
  const [conversion, setConversion] = useState<ConversionState>(IDLE_CONVERSION);

  useEffect(() => {
    if (!active) setIsPlaying(false);
  }, [active]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-gcode-line-visibility', { detail: { visibility: lineVisibility } }));
  }, [lineVisibility]);

  // Stable : la légende (mémoïsée) ne doit pas se redessiner à chaque rafraîchissement de lecture.
  const setLineVisible = useCallback((id: LineTypeId, visible: boolean) =>
    setLineVisibility((prev) => ({ ...prev, [id]: visible })), []);

  // Portée effective du mode actif : celle mémorisée si l'utilisateur y a déjà touché, sinon les
  // bornes réelles du fichier (cf. fileInfo.colorByRanges) — jamais undefined pour un mode continu
  // tant qu'un fichier est chargé.
  const activeColorByScope: ColorByScope | null = fileInfo && colorBy !== 'lineType'
    ? colorByScopes[colorBy] ?? defaultColorByScope(fileInfo.colorByRanges[colorBy])
    : null;

  // Bornes du curseur « Précision du rendu » (cf. GCodeLineTypeLegend.tsx) : maximum = longueur
  // moyenne des segments extrudés du fichier (comportement actuel, le moins précis — un anneau par
  // mouvement) ; minimum = 20× plus petit (demande explicite). Sans fichier ou hors mode continu,
  // sans objet — le curseur ne s'affiche pas.
  const renderPrecisionBounds = fileInfo && colorBy !== 'lineType'
    ? { max: fileInfo.colorByRanges.segmentLength.avg || 1, min: (fileInfo.colorByRanges.segmentLength.avg || 1) / 20 }
    : null;
  // null : comportement par défaut de ce mode (pas encore réglé) — le calque interprète lui-même
  // null comme « un anneau par mouvement » (cf. gcodeLayer.ts setRenderPrecision).
  const activeRenderPrecisionMm: number | null = fileInfo && colorBy !== 'lineType'
    ? renderPrecisionMm[colorBy] ?? null
    : null;

  // apex-gcode-color-by porte AUSSI la précision courante du mode qui devient actif (mémorisée par
  // mode comme le scope) : reconstruit la géométrie au bon niveau de détail dès qu'on bascule vers
  // un mode déjà réglé, sans attendre un nouveau glisser du curseur de précision.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-gcode-color-by', {
      detail: { mode: colorBy, scope: activeColorByScope ?? undefined },
    }));
    window.dispatchEvent(new CustomEvent('apex-gcode-render-precision', { detail: { mm: activeRenderPrecisionMm } }));
    // activeColorByScope/activeRenderPrecisionMm sont dérivés à chaque rendu (pas des states à
    // part) : les comparer par valeur éviterait un effet à chaque rendu, mais colorByScopes/
    // renderPrecisionMm/fileInfo eux-mêmes ne changent que sur une vraie action utilisateur
    // (glisser un curseur, cocher la case, charger un fichier) — donc aussi peu fréquent qu'un
    // state dédié l'aurait été, sans la complexité d'une comparaison profonde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy, colorByScopes, renderPrecisionMm, fileInfo]);

  const setColorBy = useCallback((mode: ColorByMode) => {
    setColorByState(mode);
    const label = mode === 'lineType' ? 'Type de ligne' : COLOR_BY_LABELS[mode];
    showSuccess(`Coloration : ${label}.`);
  }, []);

  /** Règle la portée (curseurs min/max) et/ou l'écrêtage hors-portée du mode continu `mode`,
   * mémorisée indépendamment des autres modes pour le reste de la session sur ce fichier. */
  const setColorByScope = useCallback((mode: ContinuousColorByMode, scope: ColorByScope) => {
    setColorByScopes((prev) => ({ ...prev, [mode]: scope }));
  }, []);

  /** Règle la précision de rendu (longueur max de sous-segment, mm) du mode continu `mode` — à
   * n'appeler qu'au RELÂCHEMENT du curseur (jamais pendant le glisser) : reconstruit la géométrie
   * des cordons (cf. gcodeLayer.ts setRenderPrecision), coûteux à répéter à chaque pixel glissé. */
  const setRenderPrecision = useCallback((mode: ContinuousColorByMode, mm: number | null) => {
    setRenderPrecisionMmState((prev) => ({ ...prev, [mode]: mm ?? undefined }));
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-gcode-show-full-head', { detail: { show: showFullHead } }));
  }, [showFullHead]);

  // Horloge de lecture : avance le temps machine (durées réelles des mouvements, cf.
  // `ParsedGCode.times`) à `speed` × le temps réel, le reconvertit en index de mouvement `t`,
  // pousse chaque image au viewport et rafraîchit l'état React à ~20 Hz seulement.
  useEffect(() => {
    if (!isPlaying) return;
    const parsed = parsedRef.current;
    if (!parsed) return;
    const last = parsed.moves.length - 1;
    let raf = 0;
    let prev = performance.now();
    let sinceUiSync = 0;
    const step = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const s = timeAtIndex(parsed.times, tRef.current) + speed * dt;
      tRef.current = Math.min(last, indexAtTime(parsed.times, s));
      dispatchTime(tRef.current);
      sinceUiSync += dt;
      if (tRef.current >= last) {
        setT(last);
        setIsPlaying(false);
        return;
      }
      if (sinceUiSync > 1 / 20) {
        sinceUiSync = 0;
        setT(tRef.current);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, speed]);

  const loadSeqRef = useRef(0);

  /** Parse (worker) et affiche un G-code ; renvoie le résultat, ou null (erreur déjà signalée, ou
   * chargement supplanté par un plus récent). */
  const loadText = async (text: string, name: string): Promise<ParsedGCode | null> => {
    const seq = ++loadSeqRef.current;
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
      if (seq !== loadSeqRef.current) return null;
      if (parsed.moves.length < 2) {
        showError('Aucune trajectoire exploitable dans ce fichier.');
        return null;
      }
      return await applyParsed(parsed, text, name, seq);
    } finally {
      if (heavy && seq === loadSeqRef.current) setLoadingCurtain(false);
    }
  };

  const applyParsed = async (parsed: ParsedGCode, text: string, name: string, seq: number): Promise<ParsedGCode | null> => {
    // En-tête chiffré Apex (métadonnées, marqueur, journal) : lu AVANT l'affichage, pour que
    // l'onglet Édition retrouve l'historique dès le chargement du noyau.
    try {
      parsed.apexHeader = await readApexHeader(text);
    } catch {
      parsed.apexHeader = null;
      showWarning("En-tête Apex illisible : l'historique des modifications de ce fichier est ignoré.");
    }
    if (seq !== loadSeqRef.current) return null;
    parsedRef.current = parsed;
    currentRef.current = { text, name, path: null };
    if (import.meta.env.DEV) (window as unknown as { __apexGCodeText?: () => string | null }).__apexGCodeText = () => currentRef.current?.text ?? null;
    const last = parsed.moves.length - 1;
    tRef.current = last;
    setIsPlaying(false);
    setT(last);
    setColorByState('lineType');
    setColorByScopes({});
    setRenderPrecisionMmState({});
    // Le viewport construit le maillage par tranches et résout `onBuilt` à la fin ; sans viewport à
    // l'écoute (`handled` resté faux), rien à attendre.
    await new Promise<void>((resolve) => {
      const detail = { parsed, handled: false, onBuilt: resolve };
      window.dispatchEvent(new CustomEvent('apex-gcode-loaded', { detail }));
      if (!detail.handled) resolve();
    });
    if (seq !== loadSeqRef.current) return null;

    setFileInfo({
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
    return parsed;
  };

  const loadFile = async (file: File) => {
    if (!GCODE_FILE_EXT.test(file.name)) {
      showError('Format non supporté. Utilisez un fichier .gcode, .gco, .g ou .ngc.');
      return;
    }
    setIsLoading(true);
    const text = await file.text().catch(() => null);
    const parsed = text === null ? null : await loadText(text, file.name);
    setIsLoading(false);
    if (!parsed) return;
    if (currentRef.current) currentRef.current.path = window.apexDesktop?.pathForFile?.(file) ?? null;
    publishEditFileInfo();

    // Nouveau fichier : il devient la source d'une éventuelle conversion polaire (s'il est 3 axes).
    sourceRef.current = parsed.kind === 'cartesian'
      ? { text: text!, name: file.name, parsed }
      : null;
    setConversion(IDLE_CONVERSION);
    setOffPlateHighlight(false);

    // Un C qui accumule les tours est normal dans un fichier converti (le plateau suit la pièce).
    if (parsed.kind === 'polar' && !parsed.conversion && parsed.maxC - parsed.minC > SUSPICIOUS_C_RANGE_DEG) {
      showWarning(`L'angle C dérive sur ${(parsed.maxC - parsed.minC).toFixed(0)}° : ce fichier vient probablement d'une version boguée du générateur.`);
    } else {
      showSuccess(`G-code chargé : ${parsed.moves.length} mouvements.`);
    }
  };

  /** Convertit la source 3 axes en G-code polaire Apex (script Python de l'application de bureau)
   * et affiche le résultat ; la source est conservée pour reconvertir dans l'autre mode. */
  const convert = async (mode: ConversionMode, dropOffPlate: boolean) => {
    const source = sourceRef.current;
    if (!source || conversion.status === 'running') return;
    // Traits hors plateau déjà surlignés en rouge (confirmation dans GCodeConversionCard, s'il y en
    // avait — cf. `hasOffPlate`) : restent affichés, mais clignotent pendant que la conversion qui
    // va les retirer tourne, pour signaler qu'un changement est en cours sans les faire disparaître
    // (cf. GCodeConversionCard.answerOffPlate, qui ne les éteint plus non plus). Sans traits hors
    // plateau, rien à surligner : ne pas allumer le surlignage sans raison.
    const hasOffPlate = source.parsed.offPlate.traits > 0;
    if (hasOffPlate) setOffPlateHighlight(true, true);
    setConversion({ status: 'running', progress: 0, mode, error: null });
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
        (progress) => setConversion((prev) => (prev.status === 'running' ? { ...prev, progress } : prev)),
      );
      const name = `${source.name.replace(/\.[^.]+$/, '')}_apex${mode === 'dynamic' ? '_dynamique' : ''}.gcode`;
      // loadText() charge le G-code CONVERTI (polaire) : les anciens traits hors-plateau du
      // fichier source n'existent plus dans ce nouveau tracé — le surlignage s'éteint de lui-même
      // (setFileInfo d'un nouveau fichier ne réaffiche rien), mais on l'éteint explicitement pour
      // ne pas laisser le clignotement tourner indéfiniment si jamais rien ne le fait.
      if (!(await loadText(text, name))) throw new Error('Le G-code converti est illisible.');
      publishEditFileInfo();
      setOffPlateHighlight(false);
      setConversion({ status: 'done', progress: 100, mode, error: null });
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
      showSuccess(`G-code converti en polaire${mode === 'dynamic' ? ' à angle dynamique' : ''}${detail}.${notes.length ? ` ${notes.join(' ; ')}.` : ''}`);
    } catch (err) {
      // Échec : les traits hors-plateau du fichier source restent affichés s'ils l'étaient (rien
      // n'a changé côté tracé), mais arrêtent de clignoter — le clignotement ne signifie qu'une
      // conversion EN COURS.
      if (hasOffPlate) setOffPlateHighlight(true, false);
      const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
      setConversion({ status: 'error', progress: 0, mode, error: message });
      showError(`Conversion impossible : ${message}`);
    }
  };

  /** Enregistre un texte G-code (boîte d'enregistrement native, ou téléchargement hors application). */
  const exportText = async (text: string, name: string) => {
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
  };

  /** Texte du G-code affiché, modifications de l'onglet Édition comprises (lignes réécrites, et
   * journal dans l'en-tête chiffré si le réglage est activé) ; null si la réécriture est impossible
   * (erreur déjà signalée). */
  const currentText = async (): Promise<string | null> => {
    const current = currentRef.current;
    const parsed = parsedRef.current;
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
  };

  if (import.meta.env.DEV) (window as unknown as { __apexSavedText?: () => Promise<string | null> }).__apexSavedText = () => currentText();

  /** Enregistre le G-code affiché, modifications comprises. */
  const exportGCode = async () => {
    const current = currentRef.current;
    const text = await currentText();
    if (current && text !== null) await exportText(text, current.name);
  };

  /** Modification en place (G-code tranché par Apex, chemin connu — CDC D4, D6) ou EXPORT COPY.
   * Si l'écriture en place échoue, la copie est proposée à la place. */
  const saveEdited = async (mode: EditSaveMode) => {
    const current = currentRef.current;
    const text = await currentText();
    if (!current || text === null) return;
    if (mode === 'inplace' && canSaveInPlace() && window.apexDesktop) {
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
  };

  // Tranché par Apex : marqueur en clair écrit par le moteur, ou marqueur du bloc chiffré (D4).
  const canSaveInPlace = () => {
    const current = currentRef.current;
    const sliced = !!current && (isLocallySliced(current.text) || !!parsedRef.current?.apexHeader?.sliced);
    return !!current?.path && !!window.apexDesktop && sliced;
  };

  const publishEditFileInfo = () => {
    const detail: EditFileInfo = { name: currentRef.current?.name ?? null, canSaveInPlace: canSaveInPlace() };
    window.dispatchEvent(new CustomEvent(EDIT_FILE_INFO_EVENT, { detail }));
  };

  // Panneau Édition : enregistrement, et demande d'état (réémission de l'information du fichier).
  const saveEditedRef = useRef(saveEdited);
  saveEditedRef.current = saveEdited;
  const publishEditFileInfoRef = useRef(publishEditFileInfo);
  publishEditFileInfoRef.current = publishEditFileInfo;
  useEffect(() => {
    const onSave = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: EditSaveMode }>).detail?.mode ?? 'copy';
      void saveEditedRef.current(mode);
    };
    const onRequestState = () => publishEditFileInfoRef.current();
    window.addEventListener(EDIT_SAVE_EVENT, onSave);
    window.addEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
    return () => {
      window.removeEventListener(EDIT_SAVE_EVENT, onSave);
      window.removeEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
    };
  }, []);

  // Fichier reçu de Sidebar.tsx (dépôt en Préparation, cf. `enterPreview`) une fois la bascule
  // animée vers l'espace Prévisualisation terminée — dispatché seulement APRÈS
  // `apex-preview-toggled { active: true }`, donc toujours reçu ici avec `active` déjà vrai.
  // `loadFileRef` : la fonction est recréée à chaque rendu (elle ferme sur `file`, capturé par
  // paramètre, pas par un état qui changerait), mais l'effet ne doit s'abonner qu'une fois — sans
  // quoi il se désabonnerait/réabonnerait à chaque rendu de ce hook, coûteux pour rien puisque
  // seuls des setters stables (jamais lus depuis une valeur figée) sont appelés à l'intérieur.
  const loadFileRef = useRef(loadFile);
  loadFileRef.current = loadFile;
  useEffect(() => {
    const onEnteringPreviewWithFile = (e: Event) => {
      const file = (e as CustomEvent<{ file: File }>).detail?.file;
      if (file) loadFileRef.current(file);
    };
    window.addEventListener('apex-entering-preview-with-file', onEnteringPreviewWithFile);
    return () => window.removeEventListener('apex-entering-preview-with-file', onEnteringPreviewWithFile);
  }, []);

  /** Ouvre le sélecteur de fichier système (sans élément `<input>` dans l'interface). */
  const openFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = GCODE_ACCEPT;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) loadFile(file);
    };
    input.click();
  };

  // Dépôt de fichier sur toute la fenêtre tant que l'espace est affiché : le viewport garde la
  // souris pour la caméra, aucun élément d'interface n'a donc besoin de capter le dépôt.
  useEffect(() => {
    if (!active) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current++;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    // Compteur : `dragleave` se déclenche aussi en passant d'un élément à un de ses enfants.
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) loadFileRef.current(file);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      dragDepthRef.current = 0;
      setIsDragging(false);
    };
  }, [active]);

  /** Place la lecture sur l'index de mouvement `value` (fractionnaire) et met la lecture en pause. */
  // Viewport mis à jour immédiatement ; l'état React (qui redessine toute la page) au plus une fois
  // par image, pour qu'un glisser envoyant plusieurs événements par image reste fluide.
  const seekSyncRafRef = useRef(0);
  const seek = (value: number) => {
    setIsPlaying(false);
    tRef.current = value;
    dispatchTime(value);
    if (seekSyncRafRef.current) return;
    seekSyncRafRef.current = requestAnimationFrame(() => {
      seekSyncRafRef.current = 0;
      setT(tRef.current);
    });
  };

  // Sélection d'un point de trajectoire sur le modèle (cf. Viewport3D `apex-gcode-pick-mode`) : un
  // clic sur un point saute la lecture à l'avancement où la tête le dépose, puis le mode s'éteint
  // (un seul point par activation) ; Échap l'annule. Éteint aussi en quittant l'espace ou sans fichier.
  const [isPickingPoint, setIsPickingPoint] = useState(false);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const pickAllowed = active && !!fileInfo;
  useEffect(() => {
    if (!pickAllowed) setIsPickingPoint(false);
  }, [pickAllowed]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-gcode-pick-mode', { detail: { active: isPickingPoint } }));
    if (!isPickingPoint) return;
    const onPicked = (e: Event) => {
      const t = (e as CustomEvent<{ t: number }>).detail?.t;
      if (typeof t !== 'number') return;
      seekRef.current(t);
      setIsPickingPoint(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsPickingPoint(false); };
    window.addEventListener('apex-gcode-point-picked', onPicked);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('apex-gcode-point-picked', onPicked);
      window.removeEventListener('keydown', onKey);
    };
  }, [isPickingPoint]);
  const togglePickPoint = useCallback(() => setIsPickingPoint((v) => !v), []);

  /** Lecture/pause ; repart du début si la lecture est au bout. */
  const togglePlay = () => {
    const parsed = parsedRef.current;
    if (!parsed) return;
    if (!isPlaying && tRef.current >= parsed.moves.length - 1) seek(0);
    setIsPlaying(!isPlaying);
  };

  const parsed = parsedRef.current;
  /** État machine interpolé (r, c, z, b) à la position de lecture. */
  const current = parsed ? stateAt(parsed.moves, t) : null;
  /** Mouvement en cours d'exécution (pour savoir s'il extrude). */
  const currentMove = parsed ? parsed.moves[Math.min(parsed.moves.length - 1, Math.ceil(t))] : null;
  const lastIndex = fileInfo ? fileInfo.moves - 1 : 0;

  return {
    fileInfo,
    t,
    lastIndex,
    current,
    currentMove,
    isPlaying,
    togglePlay,
    seek,
    speed,
    setSpeed,
    lineVisibility,
    setLineVisible,
    showFullHead,
    setShowFullHead,
    colorBy,
    setColorBy,
    /** Portée effective (curseurs + écrêtage) du mode continu actif, ou null en mode `lineType`
     * ou sans fichier chargé. */
    activeColorByScope,
    setColorByScope,
    /** Bornes (mm) et valeur active du curseur « Précision du rendu », ou null hors mode continu /
     * sans fichier — le curseur ne s'affiche pas dans ce cas. */
    renderPrecisionBounds,
    activeRenderPrecisionMm,
    setRenderPrecision,
    isPickingPoint,
    togglePickPoint,
    isDragging,
    isLoading,
    loadFile,
    openFilePicker,
    conversion,
    /** G-code 3 axes chargé, convertible en polaire (qu'il l'ait déjà été ou non), sinon null. */
    conversionSource: fileInfo && sourceRef.current
      ? {
        name: sourceRef.current.name,
        nonPlanar: sourceRef.current.parsed.nonPlanar,
        offPlateTraits: sourceRef.current.parsed.offPlate.traits,
      }
      : null,
    setOffPlateHighlight,
    convert,
    /** Seul un G-code polaire (natif Apex ou converti) s'exporte pour l'Apex. */
    canExport: fileInfo?.kind === 'polar' && conversion.status !== 'running',
    exportGCode,
    /** Conversion possible ici : application de bureau, ou serveur de développement Vite. */
    conversionAvailable: isConversionAvailable(),
  };
}
