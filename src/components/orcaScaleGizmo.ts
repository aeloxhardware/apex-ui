/**
 * Gizmo de mise à l'échelle à la OrcaSlicer.
 *
 * Portage vers Babylon.js du comportement de `GLGizmoScale3D` (OrcaSlicer, `src/slic3r/GUI/Gizmos/
 * GLGizmoScale.cpp`, AGPL-3.0, https://github.com/OrcaSlicer/OrcaSlicer ; lui-même issu de PrusaSlicer,
 * AGPL-3.0). Sont repris : les six poignées de face (X, profondeur, vertical) et les quatre poignées d'angle
 * du bas, leurs couleurs, leur taille (5 % de la taille moyenne de la boîte, 4 mm au moins, ×1,25 pendant le
 * glissement), le calcul du rapport par projection du rayon sur le plan de glissement (`calc_ratio`), le pas
 * de 0,05 avec Maj, la mise à l'échelle autour du CENTRE DE LA BASE (le modèle reste posé sur le plateau), et
 * l'ancrage de la face ou de l'angle opposé avec Ctrl. Non repris : Alt (mise à l'échelle indépendante des
 * volumes), la limite de rapport d'Orca et son infobulle en pourcentage. Crédit : `src/utils/credits.ts`.
 *
 * Axes : Orca dessine Z vertical ; ici, comme dans orcaRotateGizmo.ts, Y est vertical. Orca (x, y, z)
 * correspond donc à (x, z, y) : l'axe X reste rouge, le vertical bleu, la profondeur verte.
 *
 * Le repère du gizmo est celui du maillage (sa rotation), comme le « local » d'Orca : l'échelle du maillage
 * est donc toujours selon ses propres axes. Le maillage est supposé à la racine de la scène.
 */
import * as BABYLON from 'babylonjs';
import { localPointOf, scaleKeepingPoint } from '@/utils/meshScale';

/** Taille des poignées (`GLGizmoBase::Grabber`) : 5 % de la taille moyenne, 4 mm au moins. */
const GRABBER_SIZE_FACTOR = 0.05;
const GRABBER_MIN_HALF = 4;
const GRABBER_DRAG_FACTOR = 1.25;
/** Pas du rapport avec Maj (`m_snap_step`). */
const SNAP_STEP = 0.05;
const PICK_TOLERANCE_PX = 12;
/** Poignée du dessus (axe vertical) et centre de la base (point d'ancrage, jamais affiché). */
const TOP = 5;
const BOTTOM = 4;
/** Les poignées à partir de 6 sont les angles du bas : mise à l'échelle uniforme. */
const UNIFORM_FIRST = 6;

/** Axe de chaque poignée : 0 = X, 1 = vertical, 2 = profondeur (`GLGizmoScale3D::on_dragging`). */
const AXIS_OF = [0, 0, 2, 2, 1, 1];
/** Couleurs des axes : X rouge, vertical bleu, profondeur verte. */
const AXIS_COLORS = [new BABYLON.Color3(1, 0, 0), new BABYLON.Color3(0, 0, 1), new BABYLON.Color3(0, 1, 0)];
const UNIFORM_COLOR = new BABYLON.Color3(0, 1, 1);
const UNIFORM_HOVER_COLOR = new BABYLON.Color3(0, 0.7, 0.7);
const CONSTRAINED_COLOR = new BABYLON.Color3(0.5, 0.5, 0.5);

/** Poignée opposée (`constraint_id`) : 0↔1, 2↔3, 4↔5, 6↔8, 7↔9. */
const OPPOSITE = [1, 0, 3, 2, 5, 4, 8, 9, 6, 7];
/**
 * Position de chaque poignée dans le repère de la boîte, en signes sur (X, vertical, profondeur), à multiplier
 * par la demi-taille de la boîte selon chaque axe (`GLGizmoScale3D::update_grabbers_data`).
 */
const SIGNS: number[][] = [
  [-1, -1, 0], [1, -1, 0], // X : faces gauche et droite, au niveau de la base
  [0, -1, -1], [0, -1, 1], // profondeur : faces arrière et avant, au niveau de la base
  [0, -1, 0], // centre de la base
  [0, 1, 0], // dessus
  [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], // angles de la base
];
/** Arêtes du carré du bas, avec la poignée dont la couleur les teinte (`render_grabbers_connection`). */
const CONNECTIONS: [number, number, number][] = [[6, 7, 2], [7, 8, 2], [8, 9, 0], [9, 6, 0]];

export interface OrcaScaleGizmoOptions {
  /** Appelé après chaque pas de mise à l'échelle, le changement étant déjà appliqué au maillage. */
  onScaled: (mesh: BABYLON.AbstractMesh) => void;
  /** Appelé quand le glissement se termine. */
  onDragEnd?: (() => void) | undefined;
}

/** Boîte du maillage, dans son propre repère : centre, axes unitaires, demi-tailles, rotation. */
interface Frame {
  center: BABYLON.Vector3;
  axes: BABYLON.Vector3[];
  half: number[];
  rotation: BABYLON.Quaternion;
}

interface DragStart {
  index: number;
  ctrl: boolean;
  frame: Frame;
  /** Point de la poignée saisie, à l'instant du clic. */
  drag: BABYLON.Vector3;
  /** Point de référence du rapport : la base, ou la poignée opposée avec Ctrl (`calc_ratio`). */
  ratioPivot: BABYLON.Vector3;
  /** Point fixe pendant la mise à l'échelle : la base, ou la poignée opposée avec Ctrl (`offset`). */
  anchor: BABYLON.Vector3;
  /** Même point, dans le repère local du maillage : il reste fixe quand le pivot du maillage est décalé. */
  localAnchor: BABYLON.Vector3;
  position: BABYLON.Vector3;
  scaling: BABYLON.Vector3;
}

/**
 * Boîte du maillage et de ses enfants, dans le repère du maillage. `fresh` recalcule la boîte locale de chaque
 * partie : nécessaire après une modification de la géométrie (ex. `bakeTransformIntoVertices`), pas à chaque image.
 */
function measure(mesh: BABYLON.AbstractMesh, fresh = false): Frame | null {
  mesh.computeWorldMatrix(true);
  const rotation = new BABYLON.Quaternion();
  mesh.getWorldMatrix().decompose(undefined, rotation);
  const rotationMatrix = new BABYLON.Matrix();
  rotation.toRotationMatrix(rotationMatrix);
  const axes = [BABYLON.Axis.X, BABYLON.Axis.Y, BABYLON.Axis.Z].map((axis) =>
    BABYLON.Vector3.TransformNormal(axis, rotationMatrix).normalize());

  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const part of [mesh, ...mesh.getChildMeshes(false)]) {
    if (part.getTotalVertices() === 0) continue;
    if (fresh) part.refreshBoundingInfo({});
    const world = part.getWorldMatrix();
    for (const corner of part.getBoundingInfo().boundingBox.vectors) {
      const point = BABYLON.Vector3.TransformCoordinates(corner, world);
      axes.forEach((axis, j) => {
        const along = BABYLON.Vector3.Dot(point, axis);
        low[j] = Math.min(low[j], along);
        high[j] = Math.max(high[j], along);
      });
    }
  }
  if (low[0] > high[0]) return null;

  const center = BABYLON.Vector3.Zero();
  axes.forEach((axis, j) => center.addInPlace(axis.scale((low[j] + high[j]) / 2)));
  return { center, axes, half: low.map((value, j) => (high[j] - value) / 2), rotation };
}

/** Point de la poignée `index` dans le monde. */
function worldOf(frame: Frame, index: number): BABYLON.Vector3 {
  const point = frame.center.clone();
  SIGNS[index].forEach((sign, j) => {
    if (sign !== 0) point.addInPlace(frame.axes[j].scale(sign * frame.half[j]));
  });
  return point;
}

export class OrcaScaleGizmo {
  private readonly layer: BABYLON.UtilityLayerRenderer;
  private readonly grabbers: BABYLON.Mesh[] = [];
  private readonly materials: BABYLON.StandardMaterial[] = [];
  private readonly connections: BABYLON.LinesMesh[] = [];
  private readonly pointerObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>>;
  private readonly renderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;

  private mesh: BABYLON.AbstractMesh | null = null;
  private frame: Frame | null = null;
  private hover = -1;
  private dragging = -1;
  private ctrlDown = false;
  private start: DragStart | null = null;

  constructor(private readonly scene: BABYLON.Scene, private readonly options: OrcaScaleGizmoOptions) {
    this.layer = new BABYLON.UtilityLayerRenderer(scene);
    const uscene = this.layer.utilityLayerScene;

    for (let i = 0; i < SIGNS.length; i++) {
      const material = new BABYLON.StandardMaterial(`orcaScaleGrabberMat${i}`, uscene);
      material.disableLighting = true;
      material.backFaceCulling = false;
      const box = BABYLON.MeshBuilder.CreateBox(`orcaScaleGrabber${i}`, { size: 1 }, uscene);
      box.material = material;
      box.isPickable = false;
      this.grabbers.push(box);
      this.materials.push(material);
    }
    for (const [a, b] of CONNECTIONS) {
      const line = BABYLON.MeshBuilder.CreateLines(`orcaScaleConnection${a}-${b}`, {
        points: [BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()],
        updatable: true,
      }, uscene);
      line.isPickable = false;
      this.connections.push(line);
    }

    this.setVisible(false);
    // Avant tous les autres : un clic sur une poignée ne doit pas désélectionner le modèle.
    this.pointerObserver = scene.onPointerObservable.add((info, state) => this.onPointer(info, state), undefined, true);
    this.renderObserver = scene.onBeforeRenderObservable.add(() => this.onFrame());
  }

  /** Rattache le gizmo à un modèle (null : le masque). */
  attach(mesh: BABYLON.AbstractMesh | null) {
    if (this.dragging >= 0) this.endDrag();
    this.mesh = mesh && !mesh.isDisposed() ? mesh : null;
    this.hover = -1;
    this.updateFrame(true);
  }

  dispose() {
    this.scene.onPointerObservable.remove(this.pointerObserver);
    this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    this.setCursor('');
    this.layer.dispose();
  }

  // --- affichage -----------------------------------------------------------------------------

  private setVisible(visible: boolean) {
    this.grabbers.forEach((box, i) => box.setEnabled(visible && i !== BOTTOM));
    this.connections.forEach((line) => line.setEnabled(visible));
  }

  private updateFrame(fresh = false) {
    this.frame = this.mesh ? measure(this.mesh, fresh) : null;
    if (!this.frame) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.refresh(this.frame);
  }

  private onFrame() {
    if (!this.mesh) return;
    if (this.mesh.isDisposed()) { this.attach(null); return; }
    // Les poignées suivent le modèle, y compris pendant la mise à l'échelle.
    this.updateFrame();
  }

  private refresh(frame: Frame) {
    const meanSize = (2 * (frame.half[0] + frame.half[1] + frame.half[2])) / 3;
    const half = Math.max(meanSize * GRABBER_SIZE_FACTOR, GRABBER_MIN_HALF);
    // Le centre de la base (BOTTOM) reste masqué, mais garde sa place : il sert de point de référence.
    this.grabbers.forEach((box, i) => {
      box.rotationQuaternion = frame.rotation;
      box.position.copyFrom(worldOf(frame, i));
      box.scaling.setAll(2 * half * (i === this.dragging ? GRABBER_DRAG_FACTOR : 1));
      this.materials[i].emissiveColor = this.colorOf(i);
    });
    CONNECTIONS.forEach(([a, b, colorFrom], k) => {
      const line = this.connections[k];
      BABYLON.MeshBuilder.CreateLines(line.name, { points: [worldOf(frame, a), worldOf(frame, b)], instance: line });
      line.color = AXIS_COLORS[AXIS_OF[colorFrom]];
    });
  }

  private colorOf(i: number): BABYLON.Color3 {
    const active = this.hover === i || this.dragging === i;
    if (this.ctrlDown && this.hover === OPPOSITE[i]) return CONSTRAINED_COLOR;
    if (i >= UNIFORM_FIRST) return active ? UNIFORM_HOVER_COLOR : UNIFORM_COLOR;
    const base = AXIS_COLORS[AXIS_OF[i]];
    return active ? base.scale(1.2) : base;
  }

  // --- interaction ---------------------------------------------------------------------------

  private setCursor(cursor: string) {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (canvas) canvas.style.cursor = cursor;
  }

  private ray() {
    return this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, BABYLON.Matrix.Identity(), this.scene.activeCamera);
  }

  /** Poignée sous le pointeur (à `PICK_TOLERANCE_PX` près, la plus proche), ou -1. */
  private pickGrabber(): number {
    const frame = this.frame;
    const camera = this.scene.activeCamera;
    if (!frame || !camera) return -1;
    const engine = this.scene.getEngine();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    let best = -1;
    let bestDistance = PICK_TOLERANCE_PX;
    for (let i = 0; i < SIGNS.length; i++) {
      if (i === BOTTOM || !this.grabbers[i].isEnabled()) continue;
      const screen = BABYLON.Vector3.Project(worldOf(frame, i), BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
      if (screen.z < 0 || screen.z > 1) continue;
      const distance = Math.hypot(screen.x - this.scene.pointerX, screen.y - this.scene.pointerY);
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    }
    return best;
  }

  private onPointer(info: BABYLON.PointerInfo, state: BABYLON.EventState) {
    if (!this.mesh) return;
    const type = info.type;
    const event = info.event as PointerEvent;
    if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      this.ctrlDown = event.ctrlKey;
      if (this.dragging >= 0) { this.drag(event.shiftKey); return; }
      const hover = this.pickGrabber();
      if (hover !== this.hover) {
        this.hover = hover;
        this.setCursor(hover >= 0 ? 'grab' : '');
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      if (event.button !== 0) return;
      const index = this.pickGrabber();
      if (index < 0) return;
      this.beginDrag(index, event.ctrlKey);
      state.skipNextObservers = true;
    } else if (type === BABYLON.PointerEventTypes.POINTERUP && this.dragging >= 0) {
      this.endDrag();
      state.skipNextObservers = true;
    }
  }

  private beginDrag(index: number, ctrl: boolean) {
    const mesh = this.mesh;
    const frame = mesh ? measure(mesh, true) : null;
    if (!mesh || !frame) return;
    const plate = worldOf(frame, BOTTOM);
    const opposite = worldOf(frame, OPPOSITE[index]);
    const anchor = ctrl ? opposite : plate;
    this.start = {
      index,
      ctrl,
      frame,
      drag: worldOf(frame, index),
      ratioPivot: ctrl && index < UNIFORM_FIRST ? opposite : plate,
      anchor,
      localAnchor: localPointOf(mesh, anchor),
      position: mesh.position.clone(),
      scaling: mesh.scaling.clone(),
    };
    this.dragging = index;
    this.hover = index;
    this.ctrlDown = ctrl;
    this.setCursor('grabbing');
  }

  /** `calc_ratio` d'Orca : rapport entre la distance actuelle et la distance de départ au pivot. */
  private calcRatio(shift: boolean): number {
    const start = this.start;
    if (!start) return 0;
    const vertical = start.frame.axes[1];
    const starting = start.drag.subtract(start.ratioPivot);
    const length = starting.length();
    if (length === 0) return 0;

    const ray = this.ray();
    const direction = ray.direction.normalizeToNew();
    // Plan de glissement : horizontal, sauf pour la poignée du dessus, qui glisse dans le plan face à la caméra.
    let normal = vertical;
    if (start.index === TOP) {
      const planeVector = BABYLON.Vector3.Cross(direction, vertical);
      normal = BABYLON.Vector3.Cross(planeVector, vertical);
    }
    normal = normal.normalizeToNew();
    const cosine = Math.min(1, Math.max(-1, BABYLON.Vector3.Dot(normal, direction)));
    const angle = BABYLON.Tools.ToDegrees(Math.acos(cosine));
    // Rayon presque parallèle au plan : le rapport reste à 1 (pas de mise à l'échelle).
    if (angle < 95 && angle > 85) return 1;

    // Intersection du rayon avec le plan de glissement (GetIntersectionOfRayAndPlane).
    const t = BABYLON.Vector3.Dot(normal, start.drag.subtract(ray.origin)) / BABYLON.Vector3.Dot(normal, direction);
    const hit = ray.origin.add(direction.scale(t));
    const along = BABYLON.Vector3.Dot(hit.subtract(start.drag), starting.normalizeToNew());
    let ratio = (length + along) / length;
    if (shift) ratio = SNAP_STEP * Math.round(ratio / SNAP_STEP);
    return ratio;
  }

  /** `on_dragging` d'Orca : l'échelle part de l'échelle de départ, multipliée par le rapport. */
  private drag(shift: boolean) {
    const start = this.start;
    const mesh = this.mesh;
    if (!start || !mesh) return;
    const ratio = this.calcRatio(shift);
    if (!(ratio > 0)) return;

    let k: number[];
    if (start.index < UNIFORM_FIRST) {
      k = [1, 1, 1];
      k[AXIS_OF[start.index]] = ratio;
    } else {
      // Avec Ctrl, la hauteur ne change pas (`m_scale.z() = starting` chez Orca).
      k = start.ctrl ? [ratio, 1, ratio] : [ratio, ratio, ratio];
    }
    // Échelle locale : les axes du maillage sont ceux du repère de la boîte (cf. measure).
    const scaling = new BABYLON.Vector3(start.scaling.x * k[0], start.scaling.y * k[1], start.scaling.z * k[2]);
    scaleKeepingPoint(mesh, { position: start.position, scaling }, start.localAnchor, start.anchor);
    this.options.onScaled(mesh);
  }

  private endDrag() {
    this.dragging = -1;
    this.start = null;
    this.setCursor(this.hover >= 0 ? 'grab' : '');
    this.options.onDragEnd?.();
    this.updateFrame(true);
  }
}
