import { useCallback, useEffect, useRef, useState } from 'react';
import {
  stateAt,
  timeAtIndex,
  indexAtTime,
  type ParsedGCode,
  type GCodeKind,
  type LineTypeStat,
  type ConversionMode,
  type ColorByMode,
  type ColorByRanges,
  type ContinuousColorByMode,
} from '@/components/gcodeLayer';
import { DEFAULT_LINE_VISIBILITY, type LineTypeId, type LineTypeVisibility } from '@/components/gcodeLineTypes';
import { defaultColorByScope, type ColorByScope } from '@/components/gcodeColormap';
import { type GCodeGenerator } from '@/components/gcodeGenerator';
import { isConversionAvailable } from '@/utils/gcodeConversion';
import { hasApexSignature } from '@/utils/apexSignature';
import { AIR_CONTOURS_REMOVE_EVENT } from '@/components/airContourCallout';
import {
  EDIT_REQUEST_STATE_EVENT,
  EDIT_SAVE_EVENT,
  type EditSaveMode,
} from '@/components/edit-node/editProtocol';
import {
  GCODE_ACCEPT, GCODE_FILE_EXT, IDLE_CONVERSION, convertSource, currentGCodeText, exportCurrentGCode, loadGCodeFile,
  publishEditFileInfo, removeAirContoursFromCurrent, saveEditedGCode, setOffPlateHighlight, type GCodeSession,
} from './gcodePreviewSession';

import { emitApex } from '@/events/apexEvents';
/** Fichier écrit par Aeolis (signature Apex) : son mode 3 axes est un choix du tranchage, pas un
 * fichier étranger à convertir — pas de carte de conversion, export direct. */
const isApexGenerated = (text: string) => hasApexSignature(text);

/**
 * Logique de l'espace Prévisualisation, sans interface : chargement de fichier G-code (dépôt sur
 * la fenêtre ou sélecteur), horloge de lecture et affichage des trajets à vide. Le rendu 3D est
 * fait par Viewport3D, piloté par les événements :
 *  - `apex-gcode-loaded` { parsed } : nouvelle trajectoire à afficher ;
 *  - `apex-gcode-time` { t } : position de lecture (index de mouvement fractionnaire) ;
 *  - `apex-gcode-line-visibility` { visibility } : types de ligne affichés (cf. gcodeLineTypes.ts) ;
 *  - `apex-gcode-color-by` { mode, scope? } : critère de coloration du tracé et sa portée affichée
 *    (curseurs min/max de la légende), cf. gcodeColormap.ts.
 * Les opérations sur le fichier (chargement, conversion, export) sont dans gcodePreviewSession.ts.
 */

// Multiplicateurs du temps machine réel (1 = vitesse d'impression réelle, avances F du fichier).
export const GCODE_SPEED_OPTIONS = [0.01, 1, 4, 16, 64, 256];
export { GCODE_ACCEPT, GCODE_FILE_EXT };

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

const dispatchTime = (t: number) =>
  emitApex('apex-gcode-time', { t });

/**
 * Critère de coloration du tracé et sa portée (curseurs min/max, « hors-portée en gris »), précision de
 * rendu : mémorisés par mode pendant la session, réinitialisés à chaque nouveau fichier chargé. La portée
 * effective est celle mémorisée, sinon les bornes réelles du fichier. Diffuse le tout au viewport.
 */
function useColorByState(fileInfo: GCodeFileInfo | null) {
  const [colorBy, setColorByState] = useState<ColorByMode>('lineType');
  const [colorByScopes, setColorByScopes] = useState<Partial<Record<ContinuousColorByMode, ColorByScope>>>({});
  // Précision du rendu (longueur max de sous-segment cartésien, mm) en mode continu ; null = comportement
  // le moins précis (un anneau par mouvement, valeur par défaut avant tout réglage).
  const [renderPrecisionMm, setRenderPrecisionMmState] = useState<Partial<Record<ContinuousColorByMode, number>>>({});

  const activeColorByScope: ColorByScope | null = fileInfo && colorBy !== 'lineType'
    ? colorByScopes[colorBy] ?? defaultColorByScope(fileInfo.colorByRanges[colorBy])
    : null;
  // Bornes du curseur « Précision du rendu » : maximum = longueur moyenne des segments extrudés du
  // fichier (le moins précis) ; minimum = 20× plus petit. Sans fichier ou hors mode continu, sans objet.
  const renderPrecisionBounds = fileInfo && colorBy !== 'lineType'
    ? { max: fileInfo.colorByRanges.segmentLength.avg || 1, min: (fileInfo.colorByRanges.segmentLength.avg || 1) / 20 }
    : null;
  const activeRenderPrecisionMm: number | null = fileInfo && colorBy !== 'lineType'
    ? renderPrecisionMm[colorBy] ?? null
    : null;

  // apex-gcode-color-by porte AUSSI la précision courante du mode qui devient actif (mémorisée par
  // mode comme le scope) : reconstruit la géométrie au bon niveau de détail dès qu'on bascule vers
  // un mode déjà réglé.
  useEffect(() => {
    emitApex('apex-gcode-color-by', { mode: colorBy, scope: activeColorByScope ?? undefined });
    emitApex('apex-gcode-render-precision', { mm: activeRenderPrecisionMm });
    // activeColorByScope/activeRenderPrecisionMm sont dérivés à chaque rendu : colorByScopes/
    // renderPrecisionMm/fileInfo ne changent que sur une vraie action utilisateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [colorBy, colorByScopes, renderPrecisionMm, fileInfo]);

  const setColorBy = useCallback((mode: ColorByMode) => {
    setColorByState(mode);
  }, []);
  /** Règle la portée (curseurs min/max) et/ou l'écrêtage hors-portée du mode continu `mode`. */
  const setColorByScope = useCallback((mode: ContinuousColorByMode, scope: ColorByScope) => {
    setColorByScopes((prev) => ({ ...prev, [mode]: scope }));
  }, []);
  /** Règle la précision de rendu du mode continu `mode` — à n'appeler qu'au RELÂCHEMENT du curseur
   * (reconstruit la géométrie des cordons, coûteux à répéter à chaque pixel glissé). */
  const setRenderPrecision = useCallback((mode: ContinuousColorByMode, mm: number | null) => {
    setRenderPrecisionMmState((prev) => ({ ...prev, [mode]: mm ?? undefined }));
  }, []);
  const resetColor = useCallback(() => {
    setColorByState('lineType');
    setColorByScopes({});
    setRenderPrecisionMmState({});
  }, []);
  return {
    colorBy, setColorBy, activeColorByScope, setColorByScope, renderPrecisionBounds, activeRenderPrecisionMm,
    setRenderPrecision, resetColor,
  };
}

/** Types de ligne affichés et tête complète : diffusés au viewport à chaque changement. */
function useDisplayOptions() {
  const [lineVisibility, setLineVisibility] = useState<LineTypeVisibility>(DEFAULT_LINE_VISIBILITY);
  const [showFullHead, setShowFullHead] = useState(true);
  useEffect(() => {
    emitApex('apex-gcode-line-visibility', { visibility: lineVisibility });
  }, [lineVisibility]);
  // Stable : la légende (mémoïsée) ne doit pas se redessiner à chaque rafraîchissement de lecture.
  const setLineVisible = useCallback((id: LineTypeId, visible: boolean) =>
    setLineVisibility((prev) => ({ ...prev, [id]: visible })), []);
  useEffect(() => {
    emitApex('apex-gcode-show-full-head', { show: showFullHead });
  }, [showFullHead]);
  return { lineVisibility, setLineVisible, showFullHead, setShowFullHead };
}

/**
 * Horloge de lecture : avance le temps machine (durées réelles des mouvements, cf. `ParsedGCode.times`) à
 * `speed` × le temps réel, le reconvertit en index de mouvement `t`, pousse chaque image au viewport et
 * rafraîchit l'état React à ~20 Hz seulement.
 */
function usePlayback(active: boolean, parsedRef: React.MutableRefObject<ParsedGCode | null>) {
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(GCODE_SPEED_OPTIONS[1]);

  useEffect(() => {
    if (!active) setIsPlaying(false);
  }, [active]);

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
  }, [isPlaying, speed, parsedRef]);

  // Place la lecture sur l'index de mouvement `value` (fractionnaire) et met la lecture en pause. Viewport
  // mis à jour immédiatement ; l'état React (qui redessine toute la page) au plus une fois par image.
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

  /** Lecture/pause ; repart du début si la lecture est au bout. */
  const togglePlay = () => {
    const parsed = parsedRef.current;
    if (!parsed) return;
    if (!isPlaying && tRef.current >= parsed.moves.length - 1) seek(0);
    setIsPlaying(!isPlaying);
  };
  return { t, setT, tRef, isPlaying, setIsPlaying, speed, setSpeed, seek, togglePlay };
}

/**
 * Sélection d'un point de trajectoire sur le modèle (cf. Viewport3D `apex-gcode-pick-mode`) : un clic sur un
 * point saute la lecture à l'avancement où la tête le dépose, puis le mode s'éteint (un seul point par
 * activation) ; Échap l'annule. Éteint aussi en quittant l'espace ou sans fichier.
 */
function usePointPicking(pickAllowed: boolean, seek: (t: number) => void) {
  const [isPickingPoint, setIsPickingPoint] = useState(false);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  useEffect(() => {
    if (!pickAllowed) setIsPickingPoint(false);
  }, [pickAllowed]);
  useEffect(() => {
    emitApex('apex-gcode-pick-mode', { active: isPickingPoint });
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
  return { isPickingPoint, togglePickPoint };
}

/**
 * Dépôt de fichier sur toute la fenêtre tant que l'espace est affiché : le viewport garde la souris pour
 * la caméra, aucun élément d'interface n'a donc besoin de capter le dépôt.
 */
function useFileDrop(active: boolean, onFile: React.MutableRefObject<(file: File) => void>) {
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
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
      if (file) onFile.current(file);
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
  }, [active, onFile]);
  return isDragging;
}

/** Écouteurs d'événements : enregistrement et état du panneau Édition, suppression des contours dans l'air,
 * fichier reçu de Sidebar.tsx (dépôt en Préparation). Les fonctions sont lues par ref : un seul abonnement. */
function useGCodeEvents(handlers: { save: (mode: EditSaveMode) => void; publish: () => void; removeAir: () => void; load: (file: File) => void }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onSave = (e: Event) => ref.current.save((e as CustomEvent<{ mode: EditSaveMode }>).detail?.mode ?? 'copy');
    const onRequestState = () => ref.current.publish();
    const onRemove = () => ref.current.removeAir();
    // Dispatché seulement APRÈS `apex-preview-toggled { active: true }`, donc toujours reçu avec `active` déjà vrai.
    const onEnteringPreviewWithFile = (e: Event) => {
      const file = (e as CustomEvent<{ file: File }>).detail?.file;
      if (file) ref.current.load(file);
    };
    window.addEventListener(EDIT_SAVE_EVENT, onSave);
    window.addEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
    window.addEventListener(AIR_CONTOURS_REMOVE_EVENT, onRemove);
    window.addEventListener('apex-entering-preview-with-file', onEnteringPreviewWithFile);
    return () => {
      window.removeEventListener(EDIT_SAVE_EVENT, onSave);
      window.removeEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
      window.removeEventListener(AIR_CONTOURS_REMOVE_EVENT, onRemove);
      window.removeEventListener('apex-entering-preview-with-file', onEnteringPreviewWithFile);
    };
  }, []);
}

/** Ouvre le sélecteur de fichier système (sans élément `<input>` dans l'interface). */
const openGCodePicker = (onFile: (file: File) => void) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = GCODE_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
};

/** Source de conversion proposée (G-code 3 axes étranger) et droit d'export. */
function conversionView(fileInfo: GCodeFileInfo | null, source: GCodeSession['sourceRef']['current'], conversion: ConversionState) {
  return {
    /** G-code 3 axes chargé, convertible en polaire (qu'il l'ait déjà été ou non), sinon null. */
    conversionSource: fileInfo && source && !isApexGenerated(source.text)
      ? { name: source.name, nonPlanar: source.parsed.nonPlanar, offPlateTraits: source.parsed.offPlate.traits }
      : null,
    /** Seul un G-code polaire (natif Apex ou converti) s'exporte pour l'Apex. */
    canExport: (fileInfo?.kind === 'polar' || (fileInfo?.kind === 'cartesian' && !!source && isApexGenerated(source.text)))
      && conversion.status !== 'running',
  };
}

/** @param active Espace Prévisualisation affiché (active le dépôt de fichier, coupe la lecture sinon). */
export function useGCodePreview(active: boolean) {
  const parsedRef = useRef<ParsedGCode | null>(null);
  const loadSeqRef = useRef(0);
  const [fileInfo, setFileInfo] = useState<GCodeFileInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const sourceRef = useRef<GCodeSession['sourceRef']['current']>(null);
  const currentRef = useRef<GCodeSession['currentRef']['current']>(null);
  const [conversion, setConversion] = useState<ConversionState>(IDLE_CONVERSION);

  const display = useDisplayOptions();
  const color = useColorByState(fileInfo);
  const playback = usePlayback(active, parsedRef);
  const { t, tRef, setT, setIsPlaying } = playback;

  const session: GCodeSession = {
    parsedRef, tRef, loadSeqRef, sourceRef, currentRef,
    getConversionStatus: () => conversion.status,
    setIsPlaying, setT, resetColor: color.resetColor, setFileInfo, setIsLoading, setConversion,
  };
  const loadFile = (file: File) => loadGCodeFile(session, file);
  const loadFileRef = useRef(loadFile);
  loadFileRef.current = loadFile;
  const publish = () => publishEditFileInfo(session);
  useGCodeEvents({
    save: (mode) => { void saveEditedGCode(session, mode); },
    publish,
    removeAir: () => { void removeAirContoursFromCurrent(session); },
    load: (file) => { void loadFileRef.current(file); },
  });
  if (import.meta.env.DEV) (window as unknown as { __apexSavedText?: () => Promise<string | null> }).__apexSavedText = () => currentGCodeText(session);
  const isDragging = useFileDrop(active, loadFileRef as React.MutableRefObject<(file: File) => void>);
  const picking = usePointPicking(active && !!fileInfo, playback.seek);

  const parsed = parsedRef.current;
  /** État machine interpolé (r, c, z, b) à la position de lecture. */
  const current = parsed ? stateAt(parsed.moves, t) : null;
  /** Mouvement en cours d'exécution (pour savoir s'il extrude). */
  const currentMove = parsed ? parsed.moves[Math.min(parsed.moves.length - 1, Math.ceil(t))] : null;
  const source = sourceRef.current;

  return {
    fileInfo,
    t,
    lastIndex: fileInfo ? fileInfo.moves - 1 : 0,
    current,
    currentMove,
    isPlaying: playback.isPlaying,
    togglePlay: playback.togglePlay,
    seek: playback.seek,
    speed: playback.speed,
    setSpeed: playback.setSpeed,
    ...display,
    colorBy: color.colorBy,
    setColorBy: color.setColorBy,
    /** Portée effective (curseurs + écrêtage) du mode continu actif, ou null en mode `lineType`
     * ou sans fichier chargé. */
    activeColorByScope: color.activeColorByScope,
    setColorByScope: color.setColorByScope,
    /** Bornes (mm) et valeur active du curseur « Précision du rendu », ou null hors mode continu /
     * sans fichier — le curseur ne s'affiche pas dans ce cas. */
    renderPrecisionBounds: color.renderPrecisionBounds,
    activeRenderPrecisionMm: color.activeRenderPrecisionMm,
    setRenderPrecision: color.setRenderPrecision,
    isPickingPoint: picking.isPickingPoint,
    togglePickPoint: picking.togglePickPoint,
    isDragging,
    isLoading,
    loadFile,
    openFilePicker: () => openGCodePicker((file) => { void loadFile(file); }),
    conversion,
    ...conversionView(fileInfo, source, conversion),
    setOffPlateHighlight,
    convert: (mode: ConversionMode, dropOffPlate: boolean) => convertSource(session, mode, dropOffPlate),
    exportGCode: () => exportCurrentGCode(session),
    /** Conversion possible ici : application de bureau, ou serveur de développement Vite. */
    conversionAvailable: isConversionAvailable(),
  };
}
