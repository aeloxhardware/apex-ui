import type { ParsedGCode } from '@/components/gcodeTypes';

/**
 * Bus d'événements d'Apex : le SEUL endroit où existent les noms `apex-*` et le type de leur `detail`.
 * L'interface n'a ni store ni contexte partagé entre le viewport et les panneaux (cf. docs/ARCHITECTURE.md) : ils se
 * parlent par ces événements. `emitApex` / `onApex` les rendent vérifiés à la compilation (nom inconnu, mauvais
 * `detail`). Ajouter un événement = l'ajouter ici ; `check-quality` refuse tout `new CustomEvent('apex-…')` ou
 * `addEventListener('apex-…')` en dehors de ce fichier (dette existante : scripts/quality-baseline.json).
 */

type Vec3 = { x: number; y: number; z: number };
type SubMesh = { id: string; name: string; color: string };
type Tooltip = { title: string; desc: string };
type SketchPlaneRef =
  | { kind: 'axis'; plane: string }
  | { kind: 'face'; origin: Vec3; normal: Vec3 };

export interface ApexEventMap {
  // --- Espaces et rideau de transition ---
  'apex-space-changed': { space: string };
  'apex-space-transition': { label: string; onCovered?: () => void };
  'apex-entering-modeling': void;
  'apex-leaving-modeling': void;
  'apex-entering-preview': void;
  'apex-entering-preview-with-file': { file: File };
  'apex-preview-toggled': { active: boolean };
  'apex-preview-morph-done': void;
  'apex-preview-tab-changed': { tab: string };
  'apex-mode-changed': { mode: 'modeling' | 'slicer' };
  'apex-home-ready': void;
  'apex-viewport-ready': void;
  'apex-render-pause': { paused: boolean };
  'apex-gcode-loading': { active: boolean; label?: string };
  'apex-shutdown-begin': void;
  'apex-shutdown-started': void;
  'apex-shutdown-3d': void;
  'apex-shutdown-message': { text?: string };
  'apex-shutdown-curtain-ready': void;
  'apex-close-requested': void;
  // --- Modèles du plateau ---
  'apex-import-model': File;
  'apex-import-model-settled': void;
  'apex-arrange-models': void;
  /** Dispose seulement les modèles sélectionnés ; les autres restent en place et servent d'obstacles. */
  'apex-arrange-selection': void;
  /** Fin d'une disposition (modèles déplacés ou non) : l'historique en prend la pose finale. */
  'apex-arrange-finished': void;
  /** Verrouille la sélection (la disposition automatique la laisse en place) ou la déverrouille si elle l'est déjà. */
  'apex-toggle-lock-models': void;
  'apex-select-all-models': void;
  'apex-delete-all-models': void;
  'apex-select-model': { name: string; additive?: boolean };
  'apex-mesh-selected': { name: string | null; names?: string[]; subMeshes?: SubMesh[]; dimensions?: Vec3 | undefined };
  'apex-mesh-deleted': { name?: string };
  'apex-model-hover': { visible: boolean; x: number; y: number; modelName: string; hasTexture: boolean; triangles?: number; gcode?: Record<string, unknown> };
  'apex-model-positioned': Vec3;
  'apex-model-rotated': Vec3;
  'apex-set-model-unit': { name: string; unit: 'mm' | 'in' };
  'apex-transform-request': void;
  'apex-transform-state': { position: Vec3; rotation?: Vec3; [key: string]: unknown };
  'apex-transform-set': { kind: string; axis: string; value: number; keepProportions?: boolean };
  'apex-request-textures': void;
  'apex-textures-loaded': { textures: { id: string; name: string; type: string; res: string; color: string }[] };
  // --- Caméra et vue ---
  'apex-camera-updated': { alpha: number; beta: number };
  'apex-set-camera-view': { view: string };
  'apex-set-camera-custom': { alpha: number; beta: number };
  'apex-reset-camera': void;
  'apex-fit-screen': void;
  'apex-axis-changed': { mode: string };
  'apex-set-blur-level': { level: number };
  'apex-set-tooltip': Tooltip;
  'apex-reset-tooltip': void;
  // --- Outils ---
  'apex-tool-changed': { tool: string };
  'apex-selection-mode-changed': { mode: string };
  'apex-primitive-box-start': void;
  'apex-primitive-pyramid-start': void;
  'apex-sketch-tool': { entity: string | null; sketchId: string | null; planeRef?: SketchPlaneRef };
  'apex-sketch-plane-pick-start': void;
  'apex-sketch-plane-pick-cancel': void;
  'apex-sketch-plane-selected': SketchPlaneRef & Record<string, unknown>;
  'apex-sketch-entity-added': { entity: { id: string; kind: string; points: { x: number; y: number }[] } };
  'apex-sketch-finished': void;
  'apex-modeling-sketch-active': { active: boolean };
  'apex-feature-tree-updated': { models: unknown[] };
  'apex-extrude-commit': void;
  'apex-extrude-distance': { distance: number };
  'apex-extrude-set-distance': { distance: number };
  'apex-extrude-focus-distance': void;
  'apex-extrude-face': Record<string, unknown> | null;
  'apex-model-tree-resized': { overflow: number };
  // --- Tranchage ---
  'apex-request-slice-models': void;
  'apex-slice-models': { names: string[]; triangles: number };
  'apex-slice-all-models': void;
  'apex-slicing-started': { names: string[] };
  'apex-export-plate-stl': { resolve: (stl: Uint8Array | null) => void };
  'apex-open-sliced-gcode': { file: File };
  // --- Aperçu G-code ---
  'apex-gcode-loaded': { parsed: ParsedGCode; handled: boolean; onBuilt: () => void };
  'apex-gcode-time': { t: number };
  'apex-gcode-line-visibility': { visibility: Record<string, boolean> };
  'apex-gcode-color-by': { mode: string; scope?: unknown };
  'apex-gcode-render-precision': { mm: number | null };
  'apex-gcode-show-full-head': { show: boolean };
  'apex-gcode-highlight-offplate': { show: boolean; blinking: boolean };
  'apex-gcode-pick-mode': { active: boolean };
  'apex-gcode-point-picked': { t: number };
}

type DetailArgs<K extends keyof ApexEventMap> = ApexEventMap[K] extends void ? [] : [detail: ApexEventMap[K]];

/** Diffuse un événement `apex-*` ; le nom et le `detail` sont vérifiés à la compilation. */
export function emitApex<K extends keyof ApexEventMap>(name: K, ...detail: DetailArgs<K>): void {
  window.dispatchEvent(detail.length ? new CustomEvent(name, { detail: detail[0] }) : new CustomEvent(name));
}

/** S'abonne à un événement `apex-*` ; renvoie la fonction de désabonnement. @public */
export function onApex<K extends keyof ApexEventMap>(name: K, handler: (detail: ApexEventMap[K]) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ApexEventMap[K]>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
