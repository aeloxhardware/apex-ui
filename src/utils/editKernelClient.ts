/**
 * Client du noyau C++ d'édition du G-code (native/, cf. CLAUDE.md « G-code editing »). Le noyau
 * tourne dans un processus utilitaire d'Electron (electron/edit-process.cjs) ; ce client lui parle
 * par un MessagePort direct, sans passer par le processus principal.
 *
 * Indisponible dans un simple navigateur (serveur Vite seul) : `available` vaut alors faux et
 * l'onglet Édition doit désactiver ses outils.
 *
 * Repère des transformations : celui du noyau, droit, z vers le haut. Depuis Babylon (y vers le
 * haut, main gauche) : (x, y, z) → (x, z, y), et une rotation d'angle θ autour de (ux, uy, uz)
 * devient une rotation d'angle −θ autour de (ux, uz, uy).
 */

export type EditFalloff = 'linear' | 'gaussian' | 'cubic' | 'plateau';

export interface EditDistanceMetric {
  enabled: boolean;
  radiusMm: number;
  falloff: EditFalloff;
}

/** Trajectoires adjacentes : déposées avant (elles portent) / après (elles reposent dessus). */
export interface EditAdjacencyMetric {
  enabled: boolean;
  before: boolean;
  after: boolean;
  hopsBefore: number;
  hopsAfter: number;
  falloff: EditFalloff;
}

/** Produit : les métriques actives se restreignent ; maximum : elles s'étendent. */
export interface EditInfluence {
  spatial: EditDistanceMetric;
  along: EditDistanceMetric;
  adjacency: EditAdjacencyMetric;
  combine: 'product' | 'max';
  /** Poignées du nœud (repère du noyau), 4 valeurs par poignée : dx, dy, dz, portée (mm). La
   * portée 3D dans la direction u vaut max(spatial.radiusMm, max portée·max(0, u·dir)^netteté). */
  directions?: Float64Array;
  directionSharpness?: number;
  /** Poignées verrouillées (ancrages, repère du noyau), 4 valeurs : x, y, z, rayon (mm). */
  anchors?: Float64Array;
  /** Recalcul de E des segments touchés : désactivé, ou automatique (volume conservé : longueur ×
   * épaisseur) ; le facteur amplifie la correction, E × (1 + facteur × (rapport − 1)). */
  extrusion?: { mode: 'off' | 'auto'; factor: number };
  /** L'objet garde sa forme (défaut) : plateau et surface libre fixes, coques glissantes,
   * épaisseur bornée avec freinage. Faux : déformation rigide pondérée seule. */
  keepShape?: boolean;
  /** Sens du glissement (repère du noyau) : le long de l'empilement, les poids se répartissent selon
   * la marge d'épaisseur des couches (cf. edit_kernel.hpp). */
  dragDirection?: Float64Array;
  /** Lissage automatique de B après déformation : 0 = aucun, 1 = fort. */
  smoothB?: number;
  smoothBIterations?: number;
  /** Rognage : seules la couche du nœud et `layers` couches de chaque côté se déforment ; la matière
   * des autres couches que la déformation envahit est rognée (extrusion supprimée). */
  trim?: { enabled: boolean; layers: number; clearanceMm?: number };
  /** Barrière d'influence : ne déforme que les points du même type de ligne que le nœud. */
  typeBarrier?: boolean;
  /** Re-tranchage : au-delà de l'épaisseur maximale, des couches sont interpolées (insérées dans le
   * fichier à la validation) au lieu de freiner l'étirement. Ignoré avec le rognage. */
  reslice?: boolean;
  /** Couches insérées au plus par intervalle de couches (défaut 4). */
  resliceMaxLayers?: number;
}

/** Valeurs échangées par point avec le noyau : R, C, Z, B, E. */
export const EDIT_VALUES_PER_POINT = 5;

/** Entrée d'historique (journal) : points et valeurs avant / après, EDIT_VALUES_PER_POINT par point. */
export interface EditHistoryEntry {
  indices: Uint32Array;
  before: Float64Array;
  after: Float64Array;
  /** Points rognés par cette modification (sous-ensemble de `indices`). */
  trimmed?: Uint32Array;
}

export interface EditKernelParams {
  /** Doit être celui du rendu (NOZZLE_PIVOT_MM). */
  pivotMm: number;
  supportRadiusMm?: number;
  supportConeDeg?: number;
  /** Épaisseur de couche minimale / maximale (profil d'imprimante ; défauts 0,06 / 0,3 mm). */
  minLayerMm?: number;
  maxLayerMm?: number;
  /** Largeur variable : plancher d'épaisseur = minLayerMm / widthFactor (1 : bornes strictes). */
  widthFactor?: number;
  threads?: number;
}

/** Valeurs firmware par point (X = R, Y = C, Z, B) et dépôt du segment qui y arrive. */
export interface EditMoves {
  r: Float64Array;
  c: Float64Array;
  z: Float64Array;
  b: Float64Array;
  /** Extrusion du segment qui arrive au point (mm, delta E du fichier). */
  e?: Float64Array;
  extruding: Uint8Array;
  /** Temps machine cumulé à l'arrivée de chaque mouvement (s) : vitesse et accélération de B. */
  times?: Float64Array;
  /** Type de ligne de chaque mouvement (indice) : barrière d'influence aux changements de type. */
  types?: Uint8Array;
  /** Modèle de tête échantillonné (repère de la tête, pointe à l'origine), 3 valeurs par point :
   * contrôle des collisions. */
  headSamples?: Float32Array;
}

export interface EditLoadStats {
  points: number;
  passPoints: number;
  passes: number;
  supportEdges: number;
  cellMm: number;
  totalMs: number;
}

export interface EditHandleInfluence {
  /** Point effectivement retenu (un point à vide est ramené au point de matière le plus proche). */
  handle: number;
  /** Indices croissants des points déplacés, et leur poids. */
  affected: Uint32Array;
  weights: Float32Array;
  /** Normale de paroi (repère du noyau), 3 valeurs par point de `affected` ; nulle hors coque. */
  slideNormals: Float32Array;
  /** Sens d'empilement retenu (-1, 0, 1) ; non nul : chaque point avance le long de son axe. */
  stackSign: number;
  /** Axe de tête du nœud (repère du noyau). */
  handleAxis: Float64Array;
  /** Axe de tête de chaque point de `affected` (repère du noyau), 3 valeurs par point. */
  axes: Float32Array;
  /** Points immobiles dont la hauteur change (ils reposent sur un point déplacé). */
  dependents: Uint32Array;
  /** Hauteurs avant déformation : `affected` puis `dependents`. */
  baseHeights: Float32Array;
  /** Déplacement axial maximal (mm) que les couches de la portée absorbent avant leurs bornes d'épaisseur ; null : illimité ou sens inconnu. */
  capacityMm: number | null;
}

/** Pourquoi un point ne peut pas porter le nœud. */
export type EditHandleRefusal = 'invalid' | 'locked' | 'plate' | 'surface';

export interface EditTransform {
  translation: Float64Array;
  axis: Float64Array;
  angleRad: number;
}

export interface EditDragOptions {
  heights?: boolean;
  deformed?: boolean;
  /** Renvoie aussi les déplacements à vide touchés (indices et pointes déformées). */
  travel?: boolean;
}

/** Limites de la machine (profil d'imprimante) et réglages du contrôle de collision. */
export interface EditMachineLimits {
  bMinDeg?: number;
  bMaxDeg?: number;
  bSpeedDegS?: number;
  bAccelDegS2?: number;
  plateRadiusMm?: number;
  collisionMarginMm?: number;
  beadRadiusMm?: number;
  contactClearanceMm?: number;
  maxPoses?: number;
}

export interface EditValidateOptions {
  limits?: EditMachineLimits;
  /** Contrôle tête / matière / plateau en plus des limites de B (coûteux : poses échantillonnées). */
  collisions?: boolean;
  /** Intervalle de points jugés (état validé) ; vide : tous. Ignoré pendant un glissement. */
  lo?: number;
  hi?: number;
}

/** Bits de `violationFlags`. */
export const EDIT_VIOLATION_B_RANGE = 1;
export const EDIT_VIOLATION_B_SPEED = 2;
export const EDIT_VIOLATION_B_ACCEL = 4;
export const EDIT_VIOLATION_HEAD_PART = 8;
export const EDIT_VIOLATION_HEAD_PLATE = 16;

export interface EditValidation {
  /** Points en défaut (indices croissants) et leurs drapeaux. */
  violations: Uint32Array;
  violationFlags: Uint8Array;
  judged: number;
  bRange: number;
  bSpeed: number;
  bAccel: number;
  headPart: number;
  headPlate: number;
  posesTested: number;
  collisionChecked: boolean;
  timingKnown: boolean;
  /** Écart tête / normale de couche (°) des points qui en ont une, échantillonnés pour le graphe. */
  normalIndices: Uint32Array;
  normalDeviation: Float32Array;
  normalWorst: number;
}

export interface EditDragResult {
  /** Valeurs exactes du point de la poignée : R, C, Z, B, E. */
  handle: Float64Array;
  handleResidualDeg: number;
  maxResidualDeg: number;
  /** Translation réellement appliquée (freinée près des limites d'épaisseur), repère du noyau. */
  appliedTranslation: Float64Array;
  /** Angle réellement appliqué (freiné comme la translation aux bornes d'épaisseur). */
  appliedAngleRad: number;
  /** Limite en multiple de la translation demandée ; null : aucune. */
  limitScale: number | null;
  /** Le glissement a changé de sens le long de l'empilement : recalculer les poids (setHandle). */
  rebuild: boolean;
  /** Couple (point, support) qui fixe la limite : la couche qui bloque, s'il y en a une. */
  limitPoint?: number;
  limitSupport?: number;
  heights?: Float32Array;
  /** Re-tranchage : nombre de couches à insérer sous chaque point (`affected` puis dépendants). */
  layerCounts?: Uint8Array;
  /** EDIT_VALUES_PER_POINT valeurs par point de `affected`. */
  deformed?: Float64Array;
  /** Dépôts que la déformation en cours rognerait (rognage actif), indices croissants. */
  trimmed?: Uint32Array;
  /** Déplacements à vide touchés (option `travel`) : indices et pointes déformées (repère du noyau). */
  travelIndices?: Uint32Array;
  travelTips?: Float32Array;
}

/** Couches insérées par une validation (re-tranchage) : points à insérer AVANT l'indice `before` (indices
 * de l'état d'avant), EDIT_VALUES_PER_POINT valeurs par point (R, C, Z, B, E = delta E du segment qui y
 * arrive) ; `extruding[i]` : ce segment dépose. */
export interface EditResliceInsert {
  before: number;
  values: Float64Array;
  extruding: Uint8Array;
}

export interface EditChange {
  ok: boolean;
  /** Couches à insérer dans le fichier (re-tranchage) ; absent sans insertion. */
  reslice?: EditResliceInsert[];
  /** Points modifiés : déplacés, et ceux dont seul E change. */
  indices?: Uint32Array;
  /** EDIT_VALUES_PER_POINT valeurs par indice : R, C, Z, B, E. */
  values?: Float64Array;
  undoDepth: number;
  redoDepth: number;
  /** Dépôts rognés (`trimState` vrai) ou rétablis par une annulation (faux) : sous-ensemble de `indices`. */
  trimmed?: Uint32Array;
  trimState?: boolean;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

interface QueuedDrag {
  transform: EditTransform;
  options: EditDragOptions;
  resolve: (value: EditDragResult | null) => void;
  reject: (error: Error) => void;
}

const OPEN_TIMEOUT_MS = 5000;

class EditKernelClient {
  private port: MessagePort | null = null;
  private opening: Promise<boolean> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private dragInFlight = false;
  private queuedDrag: QueuedDrag | null = null;

  /** Vrai dans l'application de bureau (le noyau peut néanmoins manquer : voir `open`). */
  get available(): boolean {
    return typeof window !== 'undefined' && typeof window.apexDesktop?.openEditChannel === 'function';
  }

  /** Ouvre le canal (une fois) ; faux hors application de bureau ou sans réponse du processus. */
  open(): Promise<boolean> {
    if (this.port) return Promise.resolve(true);
    if (this.opening) return this.opening;
    if (!this.available) return Promise.resolve(false);
    this.opening = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        this.opening = null;
        resolve(false);
      }, OPEN_TIMEOUT_MS);
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.data?.type !== 'apex-edit-port' || !event.ports[0]) return;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        this.attach(event.ports[0]);
        resolve(true);
      };
      window.addEventListener('message', onMessage);
      window.apexDesktop!.openEditChannel();
    });
    return this.opening;
  }

  private attach(port: MessagePort) {
    this.port = port;
    port.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.error !== undefined) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.result);
    };
    port.start();
  }

  private call<T>(op: string, ...args: unknown[]): Promise<T> {
    if (!this.port) return Promise.reject(new Error("Canal d'édition fermé : appeler open() d'abord."));
    const id = this.nextId++;
    const port = this.port;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      port.postMessage({ id, op, args });
    });
  }

  load(moves: EditMoves, params: EditKernelParams): Promise<EditLoadStats> {
    return this.call('load', { ...moves, params });
  }

  /** Change les bornes d'épaisseur du noyau chargé (sans rechargement) ; refaire setHandle ensuite. */
  setLayerLimits(minMm: number, maxMm: number, widthFactor: number): Promise<void> {
    return this.call('setLayerLimits', minMm, maxMm, widthFactor);
  }

  /** null si la poignée tombe sur un point verrouillé. */
  setHandle(index: number, influence: EditInfluence): Promise<EditHandleInfluence | { refused: EditHandleRefusal }> {
    return this.call('setHandle', index, influence);
  }

  /**
   * Une seule requête de glissement en vol : la suivante attend, et toute requête plus récente
   * remplace celle qui attendait (sa promesse se résout à null). Le noyau suit donc toujours la
   * dernière position connue, sans retard accumulé.
   */
  drag(transform: EditTransform, options: EditDragOptions = {}): Promise<EditDragResult | null> {
    return new Promise((resolve, reject) => {
      this.queuedDrag?.resolve(null);
      this.queuedDrag = { transform, options, resolve, reject };
      this.pumpDrag();
    });
  }

  private pumpDrag() {
    if (this.dragInFlight || !this.queuedDrag) return;
    const request = this.queuedDrag;
    this.queuedDrag = null;
    this.dragInFlight = true;
    this.call<EditDragResult>('drag', request.transform, request.options)
      .then(request.resolve, request.reject)
      .finally(() => {
        this.dragInFlight = false;
        this.pumpDrag();
      });
  }

  /**
   * Valide la position finale : la transformation donnée est appliquée juste avant (le port est
   * ordonné), ce qui écarte toute requête de glissement encore en attente.
   */
  commit(finalTransform?: EditTransform): Promise<EditChange> {
    this.queuedDrag?.resolve(null);
    this.queuedDrag = null;
    if (finalTransform) void this.call('drag', finalTransform, {}).catch(() => undefined);
    return this.call('commit');
  }

  cancel(): Promise<void> {
    this.queuedDrag?.resolve(null);
    this.queuedDrag = null;
    return this.call('cancel');
  }

  undo(): Promise<EditChange> {
    return this.call('undo');
  }

  redo(): Promise<EditChange> {
    return this.call('redo');
  }

  /** Historique relu dans le journal du fichier (réouverture) : remplace celui du noyau. */
  restoreHistory(history: { undo: EditHistoryEntry[]; redo: EditHistoryEntry[] }): Promise<{ undoDepth: number; redoDepth: number }> {
    return this.call('restoreHistory', history);
  }

  setLocked(indices: Uint32Array, locked: boolean): Promise<void> {
    return this.call('setLocked', indices, locked);
  }

  clearLocks(): Promise<void> {
    return this.call('clearLocks');
  }

  /** Verrouille (ou déverrouille) toute la matière à moins de `radiusMm` du point `index`. */
  lockRegion(index: number, radiusMm: number, locked: boolean): Promise<Uint32Array> {
    return this.call('lockRegion', index, radiusMm, locked);
  }

  /** Point de matière le plus proche (repère du noyau) à moins de `maxDistanceMm` ; -1 : aucun. */
  nearest(x: number, y: number, z: number, maxDistanceMm: number): Promise<number> {
    return this.call('nearest', x, y, z, maxDistanceMm);
  }

  lockedIndices(): Promise<Uint32Array> {
    return this.call('lockedIndices');
  }

  setHeadSamples(samples: Float32Array): Promise<void> {
    return this.call('setHeadSamples', samples);
  }

  /** Valide la déformation en cours (glissement) ou l'état validé : limites de B, collisions, écart tête / normale. */
  validate(options: EditValidateOptions = {}): Promise<EditValidation> {
    return this.call('validate', options);
  }
}

export const editKernel = new EditKernelClient();
