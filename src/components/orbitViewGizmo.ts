/**
 * Gizmo de vue orbitale : trois anneaux nus (sans graduation, sans lettre, sans poignée) autour de la cible de
 * la caméra. Cliquer un anneau choisit l'axe : la caméra orbite alors AUTOMATIQUEMENT autour de lui, à vitesse
 * constante, à partir de l'orientation courante (rien n'est aligné), jusqu'à la prochaine interaction (clic dans la
 * vue, molette, touche, ou changement de vue par le ViewCube). La vue n'est jamais verrouillée. Le bouton « Vue orbitale » du
 * ViewCube l'ouvre et le ferme (événement `apex-orbit-view-mode`).
 *
 * Axes et couleurs de l'application : X rouge, Y (vertical) bleu, Z vert, comme le gizmo de rotation.
 */
import * as BABYLON from 'babylonjs';
import { onApex } from '@/events/apexEvents';
import { orbitAngles } from './viewport/orbitMath';

const RING_SIZE = 0.3; // rayon des anneaux, en part de la distance caméra-cible
const PICK_TOLERANCE_PX = 12;
/** Vitesse de l'orbite automatique : un tour en ~12 s. */
const ORBIT_SPEED = 0.5; // rad/s
const STEPS = 72;
const TAU = 2 * Math.PI;

const AXES: { axis: BABYLON.Vector3; color: BABYLON.Color3 }[] = [
  { axis: new BABYLON.Vector3(1, 0, 0), color: new BABYLON.Color3(1, 0, 0) },
  { axis: new BABYLON.Vector3(0, 1, 0), color: new BABYLON.Color3(0, 0, 1) },
  { axis: new BABYLON.Vector3(0, 0, 1), color: new BABYLON.Color3(0, 1, 0) },
];

interface OrbitRing {
  axis: BABYLON.Vector3;
  u: BABYLON.Vector3;
  v: BABYLON.Vector3;
  root: BABYLON.TransformNode;
  material: BABYLON.StandardMaterial;
  color: BABYLON.Color3;
}

const brighter = (c: BABYLON.Color3) => new BABYLON.Color3(Math.min(1, c.r + 0.35), Math.min(1, c.g + 0.35), Math.min(1, c.b + 0.35));

export class OrbitViewGizmo {
  private readonly layer: BABYLON.UtilityLayerRenderer;
  private readonly rings: OrbitRing[];
  private readonly offMode: () => void;
  private readonly pointerObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>>;
  private readonly renderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;
  private readonly offViewEvents: (() => void)[];
  private readonly onKey = () => this.stop();
  private active = false;
  private selected = -1; // axe en cours d'orbite (-1 : aucun)
  private direction = 1;
  private hover = -1;

  constructor(private readonly scene: BABYLON.Scene, private readonly camera: BABYLON.ArcRotateCamera) {
    this.layer = new BABYLON.UtilityLayerRenderer(scene);
    this.rings = AXES.map(({ axis, color }, i) => this.buildRing(axis, color, i));
    this.setVisible(false);
    this.offMode = onApex('apex-orbit-view-mode', ({ enabled }) => this.setActive(enabled));
    this.pointerObserver = scene.onPointerObservable.add((info, state) => this.onPointer(info, state), undefined, true);
    this.renderObserver = scene.onBeforeRenderObservable.add(() => this.onFrame());
    // Un changement de vue demandé ailleurs (ViewCube, accueil) est une interaction : l'orbite s'arrête.
    this.offViewEvents = [
      onApex('apex-set-camera-custom', () => this.stop()),
      onApex('apex-set-camera-view', () => this.stop()),
      onApex('apex-reset-camera', () => this.stop()),
    ];
    window.addEventListener('keydown', this.onKey);
  }

  dispose() {
    this.offMode();
    window.removeEventListener('keydown', this.onKey);
    this.offViewEvents.forEach((off) => off());
    this.scene.onPointerObservable.remove(this.pointerObserver);
    this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    this.setCursor('');
    this.layer.dispose();
  }

  private buildRing(axis: BABYLON.Vector3, color: BABYLON.Color3, index: number): OrbitRing {
    const uscene = this.layer.utilityLayerScene;
    const reference = Math.abs(axis.y) > 0.9 ? new BABYLON.Vector3(1, 0, 0) : new BABYLON.Vector3(0, 1, 0);
    const u = BABYLON.Vector3.Cross(axis, reference).normalize();
    const v = BABYLON.Vector3.Cross(axis, u).normalize();
    const w = BABYLON.Vector3.Cross(u, v);
    const rotation = new BABYLON.Matrix();
    BABYLON.Matrix.FromValuesToRef(u.x, u.y, u.z, 0, v.x, v.y, v.z, 0, w.x, w.y, w.z, 0, 0, 0, 0, 1, rotation);
    const root = new BABYLON.TransformNode(`orbitViewRing${index}`, uscene);
    root.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(rotation);

    const path = Array.from({ length: STEPS + 1 }, (_, i) => new BABYLON.Vector3(Math.cos((i * TAU) / STEPS), Math.sin((i * TAU) / STEPS), 0));
    const tube = BABYLON.MeshBuilder.CreateTube(`orbitViewTube${index}`, { path, radius: 0.018, tessellation: 8 }, uscene);
    const material = new BABYLON.StandardMaterial(`orbitViewMat${index}`, uscene);
    material.disableLighting = true;
    material.emissiveColor = color;
    tube.material = material;
    tube.parent = root;
    tube.isPickable = false;
    return { axis, u, v, root, material, color };
  }

  private setVisible(visible: boolean) {
    for (const ring of this.rings) ring.root.setEnabled(visible);
  }

  private setActive(enabled: boolean) {
    this.active = enabled;
    this.hover = -1;
    this.setVisible(enabled);
    if (!enabled) {
      this.stop();
      this.setCursor('');
    }
  }

  /** Arrête l'orbite (prochaine interaction) ; les anneaux restent affichés pour en choisir un autre. */
  private stop() {
    this.selected = -1;
  }

  private onFrame() {
    if (!this.active) return;
    this.advance();
    const scale = this.camera.radius * RING_SIZE;
    this.rings.forEach((ring, i) => {
      ring.root.position.copyFrom(this.camera.target);
      ring.root.scaling.setAll(scale);
      const lit = i === this.selected || (this.selected < 0 && i === this.hover);
      ring.material.alpha = this.selected >= 0 && i !== this.selected ? 0.35 : 1;
      ring.material.emissiveColor = lit ? brighter(ring.color) : ring.color;
    });
  }

  private setCursor(cursor: string) {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (canvas) canvas.style.cursor = cursor;
  }

  /** Anneau sous le pointeur (à `PICK_TOLERANCE_PX` près), ou -1. */
  private pickRing(): number {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, BABYLON.Matrix.Identity(), this.camera);
    const center = this.camera.target;
    const radius = this.camera.radius * RING_SIZE;
    const height = this.scene.getEngine().getRenderHeight() || 1;
    const tolerance = PICK_TOLERANCE_PX * ((2 * this.camera.radius * Math.tan(this.camera.fov / 2)) / height);
    let best = -1;
    let bestGap = Infinity;
    this.rings.forEach((ring, i) => {
      const denom = BABYLON.Vector3.Dot(ray.direction, ring.axis);
      if (Math.abs(denom) < 1e-6) return;
      const t = BABYLON.Vector3.Dot(center.subtract(ray.origin), ring.axis) / denom;
      if (t < 0) return;
      const local = ray.origin.add(ray.direction.scale(t)).subtract(center);
      const gap = Math.abs(Math.hypot(BABYLON.Vector3.Dot(local, ring.u), BABYLON.Vector3.Dot(local, ring.v)) - radius);
      if (gap <= tolerance && gap < bestGap) { best = i; bestGap = gap; }
    });
    return best;
  }

  /** Un pas d'orbite autour de l'axe choisi ; au pôle (pas de roulis), la caméra repart dans l'autre sens. */
  private advance() {
    const ring = this.rings[this.selected];
    if (!ring) return;
    const dt = Math.min(this.scene.getEngine().getDeltaTime(), 100) / 1000;
    const next = orbitAngles(this.camera.alpha, this.camera.beta, ring.axis, this.direction * ORBIT_SPEED * dt);
    if (next.clamped) this.direction = -this.direction;
    this.camera.alpha = next.alpha;
    this.camera.beta = next.beta;
  }

  private onPointer(info: BABYLON.PointerInfo, state: BABYLON.EventState) {
    if (!this.active) return;
    const type = info.type;
    if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const hover = this.pickRing();
      if (hover !== this.hover) {
        this.hover = hover;
        this.setCursor(hover >= 0 ? 'pointer' : '');
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERDOWN && (info.event as PointerEvent).button === 0) {
      const ring = this.pickRing();
      if (ring < 0) { this.stop(); return; } // clic dans la vue : interaction ordinaire, la caméra suit la souris
      this.selected = ring;
      this.direction = 1;
      state.skipNextObservers = true; // un clic sur un anneau ne désélectionne pas le modèle
    } else if (type === BABYLON.PointerEventTypes.POINTERWHEEL) {
      this.stop();
    }
  }
}
