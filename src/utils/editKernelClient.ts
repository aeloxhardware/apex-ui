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
}

export interface EditKernelParams {
  /** Doit être celui du rendu (NOZZLE_PIVOT_MM). */
  pivotMm: number;
  supportRadiusMm?: number;
  supportConeDeg?: number;
  threads?: number;
}

/** Valeurs firmware par point (X = R, Y = C, Z, B) et dépôt du segment qui y arrive. */
export interface EditMoves {
  r: Float64Array;
  c: Float64Array;
  z: Float64Array;
  b: Float64Array;
  extruding: Uint8Array;
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
  /** Points immobiles dont la hauteur change (ils reposent sur un point déplacé). */
  dependents: Uint32Array;
  /** Hauteurs avant déformation : `affected` puis `dependents`. */
  baseHeights: Float32Array;
}

export interface EditTransform {
  translation: Float64Array;
  axis: Float64Array;
  angleRad: number;
}

export interface EditDragOptions {
  heights?: boolean;
  deformed?: boolean;
}

export interface EditDragResult {
  /** Valeurs firmware exactes de la poignée : R, C, Z, B. */
  handle: Float64Array;
  handleResidualDeg: number;
  maxResidualDeg: number;
  heights?: Float32Array;
  /** 4 valeurs firmware par point de `affected`. */
  deformed?: Float64Array;
}

export interface EditChange {
  ok: boolean;
  indices?: Uint32Array;
  values?: Float64Array;
  undoDepth: number;
  redoDepth: number;
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

  /** null si la poignée tombe sur un point verrouillé. */
  setHandle(index: number, influence: EditInfluence): Promise<EditHandleInfluence | null> {
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

  setLocked(indices: Uint32Array, locked: boolean): Promise<void> {
    return this.call('setLocked', indices, locked);
  }

  clearLocks(): Promise<void> {
    return this.call('clearLocks');
  }
}

export const editKernel = new EditKernelClient();
