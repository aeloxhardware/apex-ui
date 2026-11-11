/**
 * Gizmo de rotation à la OrcaSlicer.
 *
 * Portage vers Babylon.js du comportement de `GLGizmoRotate` (OrcaSlicer, `src/slic3r/GUI/Gizmos/
 * GLGizmoRotate.cpp`, AGPL-3.0, https://github.com/OrcaSlicer/OrcaSlicer ; lui-même issu de PrusaSlicer,
 * AGPL-3.0). Le code d'origine est du C++/OpenGL : sont repris les constantes, la géométrie (trois anneaux
 * autour du CENTRE de la sphère englobante, rayon + 5 mm, graduation de 72 crans, rayons d'accroche,
 * poignée à 15 % au-delà de l'anneau, arc d'angle) et les règles d'accroche de l'angle (par pas de 45° dans
 * la zone centrale, de 5° près de l'anneau). Crédit : `src/utils/credits.ts`.
 *
 * Contrairement au gizmo de Babylon, qui tourne autour de l'origine du fichier, la rotation se fait toujours
 * autour du centre de la boîte englobante du modèle, pris au début du glissement.
 *
 * Axes et couleurs de l'application : X rouge, Y (vertical) bleu, Z vert.
 */
import * as BABYLON from 'babylonjs';

const OFFSET = 5; // mm ajoutés au rayon de la sphère englobante
const SCALE_STEPS = 72;
const SCALE_LONG_EVERY = 2;
const SCALE_LONG_TOOTH = 0.1; // en part du rayon
const SNAP_REGIONS = 8;
const GRABBER_OFFSET = 0.15; // en part du rayon
const ANGLE_RESOLUTION = 64;
const PICK_TOLERANCE_PX = 12;
const TAU = 2 * Math.PI;
/** Police par défaut de l'interface (globals.css : `body`). */
const LETTER_FONT = "'Oxanium', sans-serif";

export interface OrcaRotateGizmoOptions {
  /** Appelé après chaque pas de rotation, le mouvement étant déjà appliqué au maillage. */
  onRotated: (mesh: BABYLON.AbstractMesh) => void;
  /** Appelé quand le glissement se termine. */
  onDragEnd?: (() => void) | undefined;
}

interface Ring {
  axis: BABYLON.Vector3;
  u: BABYLON.Vector3;
  v: BABYLON.Vector3;
  color: BABYLON.Color3;
  root: BABYLON.TransformNode;
  circle: BABYLON.Mesh;
  circleMat: BABYLON.StandardMaterial;
  detail: BABYLON.AbstractMesh[];
  ref: BABYLON.LinesMesh;
  arc: BABYLON.LinesMesh;
  grabber: BABYLON.Mesh;
  /** Angle de la poignée au repos : les trois lettres A, B, C ne se superposent pas. */
  restAngle: number;
}

const mod = (a: number) => ((a % TAU) + TAU) % TAU;
const unitPoint = (angle: number, radius = 1) => new BABYLON.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);

export class OrcaRotateGizmo {
  private readonly layer: BABYLON.UtilityLayerRenderer;
  private readonly rings: Ring[];
  private label: BABYLON.Mesh | null = null;
  private labelTexture: BABYLON.DynamicTexture | null = null;
  private labelFailed = false;
  private readonly pointerObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.PointerInfo>>;
  private readonly renderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;

  private mesh: BABYLON.AbstractMesh | null = null;
  /** Centre des anneaux : figé pendant un glissement, pour que le gizmo ne bouge pas sous le pointeur. */
  private center = BABYLON.Vector3.Zero();
  /** Point autour duquel le modèle tourne : il suit le modèle quand celui-ci est reposé sur le plateau. */
  private pivot = BABYLON.Vector3.Zero();
  private radius = 1;
  private hover = -1;
  private dragging = -1;
  private startTheta = 0;
  private angle = 0; // angle accroché depuis le début du glissement, dans [0, 2π[
  private applied = 0;
  private lastLabel = '';

  constructor(private readonly scene: BABYLON.Scene, private readonly options: OrcaRotateGizmoOptions) {
    this.layer = new BABYLON.UtilityLayerRenderer(scene);
    const uscene = this.layer.utilityLayerScene;

    const axes: [BABYLON.Vector3, BABYLON.Color3][] = [
      [new BABYLON.Vector3(1, 0, 0), new BABYLON.Color3(1, 0, 0)],
      [new BABYLON.Vector3(0, 1, 0), new BABYLON.Color3(0, 0, 1)],
      [new BABYLON.Vector3(0, 0, 1), new BABYLON.Color3(0, 1, 0)],
    ];
    this.rings = axes.map(([axis, color], i) => this.buildRing(uscene, axis, color, i));

    this.setVisible(false);
    // Avant tous les autres : un clic sur un anneau ne doit pas désélectionner le modèle.
    this.pointerObserver = scene.onPointerObservable.add((info, state) => this.onPointer(info, state), undefined, true);
    this.renderObserver = scene.onBeforeRenderObservable.add(() => this.onFrame());
  }

  /** Rattache le gizmo à un modèle (null : le masque). */
  attach(mesh: BABYLON.AbstractMesh | null) {
    if (this.dragging >= 0) this.endDrag();
    this.mesh = mesh && !mesh.isDisposed() ? mesh : null;
    this.hover = -1;
    this.setVisible(!!this.mesh);
    if (this.mesh) this.fitToMesh();
  }

  dispose() {
    this.scene.onPointerObservable.remove(this.pointerObserver);
    this.scene.onBeforeRenderObservable.remove(this.renderObserver);
    this.setCursor('');
    this.layer.dispose();
  }

  // --- construction --------------------------------------------------------------------------

  private buildRing(uscene: BABYLON.Scene, axis: BABYLON.Vector3, color: BABYLON.Color3, index: number): Ring {
    const reference = Math.abs(axis.y) > 0.9 ? new BABYLON.Vector3(1, 0, 0) : new BABYLON.Vector3(0, 1, 0);
    const u = BABYLON.Vector3.Cross(axis, reference).normalize();
    // v : u tourné de +90° autour de l'axe, c'est-à-dire dans le sens où la rotation d'angle positif
    // fait avancer, quelle que soit la convention de main de Babylon.
    const v = new BABYLON.Vector3();
    u.rotateByQuaternionToRef(BABYLON.Quaternion.RotationAxis(axis, Math.PI / 2), v);
    const w = BABYLON.Vector3.Cross(u, v);

    const rotation = new BABYLON.Matrix();
    BABYLON.Matrix.FromValuesToRef(
      u.x, u.y, u.z, 0,
      v.x, v.y, v.z, 0,
      w.x, w.y, w.z, 0,
      0, 0, 0, 1,
      rotation,
    );
    const root = new BABYLON.TransformNode(`orcaRotateRing${index}`, uscene);
    root.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(rotation);

    const material = (name: string) => {
      const mat = new BABYLON.StandardMaterial(name, uscene);
      mat.disableLighting = true;
      mat.emissiveColor = color;
      mat.backFaceCulling = false;
      return mat;
    };
    const lineMesh = (name: string, points: BABYLON.Vector3[], updatable = false) => {
      const lines = BABYLON.MeshBuilder.CreateLines(name, { points, updatable }, uscene);
      lines.color = color;
      lines.parent = root;
      lines.isPickable = false;
      return lines;
    };

    const circlePath = Array.from({ length: SCALE_STEPS + 1 }, (_, i) => unitPoint(i * (TAU / SCALE_STEPS)));
    const circle = BABYLON.MeshBuilder.CreateTube(`orcaRotateCircle${index}`, { path: circlePath, radius: 0.012, tessellation: 8 }, uscene);
    const circleMat = material(`orcaRotateCircleMat${index}`);
    circle.material = circleMat;
    circle.parent = root;
    circle.isPickable = false;

    // Graduation : une dent longue un cran sur deux, courte sinon (render_scale).
    const outLong = 1 + SCALE_LONG_TOOTH;
    const outShort = 1 + 0.5 * SCALE_LONG_TOOTH;
    const ticks: BABYLON.Vector3[][] = [];
    for (let i = 0; i < SCALE_STEPS; i++) {
      const a = i * (TAU / SCALE_STEPS);
      ticks.push([unitPoint(a), unitPoint(a, i % SCALE_LONG_EVERY === 0 ? outLong : outShort)]);
    }
    const scale = BABYLON.MeshBuilder.CreateLineSystem(`orcaRotateScale${index}`, { lines: ticks }, uscene);
    scale.color = color;
    scale.parent = root;
    scale.isPickable = false;

    // Rayons d'accroche (render_snap_radii) : huit rayons entre 1/3 et 2/3 du rayon.
    const spokes: BABYLON.Vector3[][] = [];
    for (let i = 0; i < SNAP_REGIONS; i++) {
      const a = i * (TAU / SNAP_REGIONS);
      spokes.push([unitPoint(a, 1 / 3), unitPoint(a, 2 / 3)]);
    }
    const snap = BABYLON.MeshBuilder.CreateLineSystem(`orcaRotateSnap${index}`, { lines: spokes }, uscene);
    snap.color = color;
    snap.parent = root;
    snap.isPickable = false;

    const ref = lineMesh(`orcaRotateRef${index}`, [BABYLON.Vector3.Zero(), unitPoint(0, 1 + GRABBER_OFFSET)], true);
    const arc = lineMesh(`orcaRotateArc${index}`, Array.from({ length: ANGLE_RESOLUTION + 1 }, () => unitPoint(0, 1 + GRABBER_OFFSET)), true);

    const grabber = this.buildGrabber(uscene, index, color, material(`orcaRotateGrabberMat${index}`));
    grabber.isPickable = false;
    // Poignée au repos sur une diagonale propre à chaque axe (dans le plan de l'anneau) : A en (0,1,1),
    // B en (1,0,-1), C en (-1,1,0). Sans cela les trois se retrouvent au même endroit.
    const rest = [new BABYLON.Vector3(0, 1, 1), new BABYLON.Vector3(1, 0, -1), new BABYLON.Vector3(-1, 1, 0)][index];
    const restAngle = Math.atan2(BABYLON.Vector3.Dot(rest, v), BABYLON.Vector3.Dot(rest, u));

    return { axis, u, v, color, root, circle, circleMat, detail: [scale, snap, ref, arc], ref, arc, grabber, restAngle };
  }

  /**
   * Poignée d'un anneau : la lettre A, B ou C (dans l'ordre des anneaux X, Y, Z) sur un plan toujours
   * face à la caméra, dans la couleur de l'anneau. Sans canvas 2D, une sphère.
   */
  private buildGrabber(uscene: BABYLON.Scene, index: number, color: BABYLON.Color3, fallbackMaterial: BABYLON.StandardMaterial): BABYLON.Mesh {
    try {
      const letter = String.fromCharCode(65 + index);
      const texture = new BABYLON.DynamicTexture(`orcaRotateLetter${index}`, { width: 64, height: 64 }, uscene, true);
      texture.hasAlpha = true;
      const draw = () => {
        const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, 64, 64);
        ctx.font = `bold 44px ${LETTER_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Ombre portée plutôt qu'un contour : la lettre reste lisible sur la pièce comme sur le fond.
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = `rgb(${Math.round(Math.min(1, color.r + 0.25) * 255)},${Math.round(Math.min(1, color.g + 0.25) * 255)},${Math.round(Math.min(1, color.b + 0.25) * 255)})`;
        ctx.fillText(letter, 30, 30);
        texture.update();
      };
      draw();
      // La police est servie par l'application : si elle n'est pas encore chargée, on redessine après.
      void document.fonts?.load(`bold 44px ${LETTER_FONT}`).then(draw, (): void => undefined);
      const mat = new BABYLON.StandardMaterial(`orcaRotateLetterMat${index}`, uscene);
      mat.diffuseTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.emissiveColor = BABYLON.Color3.White();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      const plane = BABYLON.MeshBuilder.CreatePlane(`orcaRotateGrabber${index}`, { size: 0.22 }, uscene);
      plane.material = mat;
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      return plane;
    } catch {
      const sphere = BABYLON.MeshBuilder.CreateSphere(`orcaRotateGrabber${index}`, { diameter: 0.09, segments: 8 }, uscene);
      sphere.material = fallbackMaterial;
      return sphere;
    }
  }

  // --- état et affichage ---------------------------------------------------------------------

  /** Libellé de l'angle (texte sur un plan toujours face à la caméra), créé au premier glissement. */
  private ensureLabel(): { mesh: BABYLON.Mesh; texture: BABYLON.DynamicTexture } | null {
    if (this.label && this.labelTexture) return { mesh: this.label, texture: this.labelTexture };
    if (this.labelFailed) return null;
    try {
      return this.createLabel();
    } catch {
      // Pas de canvas 2D (contexte perdu, environnement sans DOM) : le gizmo marche sans le libellé.
      this.labelFailed = true;
      return null;
    }
  }

  private createLabel(): { mesh: BABYLON.Mesh; texture: BABYLON.DynamicTexture } {
    const uscene = this.layer.utilityLayerScene;
    const texture = new BABYLON.DynamicTexture('orcaRotateLabel', { width: 256, height: 64 }, uscene, true);
    texture.hasAlpha = true;
    const material = new BABYLON.StandardMaterial('orcaRotateLabelMat', uscene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = BABYLON.Color3.White();
    material.disableLighting = true;
    const mesh = BABYLON.MeshBuilder.CreatePlane('orcaRotateLabel', { width: 1, height: 0.25 }, uscene);
    mesh.material = material;
    mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    this.label = mesh;
    this.labelTexture = texture;
    return { mesh, texture };
  }

  private setVisible(visible: boolean) {
    for (const ring of this.rings) {
      ring.root.setEnabled(visible);
      ring.grabber.setEnabled(visible);
      this.setDetail(ring, false);
    }
    if (!visible) this.label?.setEnabled(false);
  }

  private setDetail(ring: Ring, shown: boolean) {
    for (const mesh of ring.detail) mesh.setEnabled(shown);
  }

  private fitToMesh() {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.computeWorldMatrix(true);
    const { min, max } = mesh.getHierarchyBoundingVectors(true);
    this.center = min.add(max).scale(0.5);
    // Sphère englobante de la boîte, plus le décalage d'Orca (Offset + rayon).
    this.radius = OFFSET + max.subtract(min).length() / 2;
    this.layoutRings();
  }

  private layoutRings() {
    for (const ring of this.rings) {
      ring.root.position.copyFrom(this.center);
      ring.root.scaling.setAll(this.radius);
    }
  }

  private onFrame() {
    if (!this.mesh) return;
    if (this.mesh.isDisposed()) { this.attach(null); return; }
    // Hors glissement, les anneaux suivent le modèle (déplacement, mise à l'échelle…).
    if (this.dragging < 0) this.fitToMesh();
    this.refreshVisuals();
  }

  private refreshVisuals() {
    this.rings.forEach((ring, i) => {
      const active = this.dragging >= 0 ? i === this.dragging : true;
      ring.root.setEnabled(active);
      const hot = i === this.hover || i === this.dragging;
      ring.circleMat.emissiveColor = hot
        ? new BABYLON.Color3(Math.min(1, ring.color.r + 0.35), Math.min(1, ring.color.g + 0.35), Math.min(1, ring.color.b + 0.35))
        : ring.color;
      this.setDetail(ring, hot);
      // Poignée sur l'angle accroché pendant le glissement, au repos sinon. Elle est placée en
      // coordonnées monde : un plan « billboard » n'hérite pas de la transformation de l'anneau.
      ring.grabber.setEnabled(active);
      const a = i === this.dragging ? this.startTheta + this.angle : ring.restAngle;
      const r = this.radius * (1 + GRABBER_OFFSET);
      ring.grabber.position.copyFrom(this.center)
        .addInPlace(ring.u.scale(Math.cos(a) * r))
        .addInPlace(ring.v.scale(Math.sin(a) * r));
      ring.grabber.scaling.setAll(this.radius);
    });
    if (this.dragging >= 0) this.updateLabel();
  }

  private updateArc(ring: Ring) {
    const start = this.startTheta;
    const points = Array.from({ length: ANGLE_RESOLUTION + 1 }, (_, k) =>
      unitPoint(start + (this.angle * k) / ANGLE_RESOLUTION, 1 + GRABBER_OFFSET));
    BABYLON.MeshBuilder.CreateLines(ring.arc.name, { points, instance: ring.arc });
    BABYLON.MeshBuilder.CreateLines(ring.ref.name, { points: [BABYLON.Vector3.Zero(), unitPoint(start, 1 + GRABBER_OFFSET)], instance: ring.ref });
  }

  private updateLabel() {
    const ring = this.rings[this.dragging];
    // Sens de lecture d'Orca : angle de 0 à 360°, deux décimales.
    const text = `${BABYLON.Tools.ToDegrees(this.angle).toFixed(2)}°`;
    const made = this.ensureLabel();
    if (!made) return;
    const { mesh: label, texture } = made;
    label.setEnabled(true);
    label.scaling.setAll(this.radius * 0.8);
    const local = unitPoint(this.startTheta + this.angle, 1 + GRABBER_OFFSET + 0.2);
    label.position = this.center.add(ring.u.scale(local.x * this.radius)).add(ring.v.scale(local.y * this.radius));
    if (text === this.lastLabel) return;
    this.lastLabel = text;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 126, 30);
    texture.update();
  }

  // --- interaction ---------------------------------------------------------------------------

  private setCursor(cursor: string) {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (canvas) canvas.style.cursor = cursor;
  }

  private ray() {
    return this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, BABYLON.Matrix.Identity(), this.scene.activeCamera);
  }

  /** Point d'impact du rayon sur le plan de l'anneau, dans sa base (x selon u, y selon v). */
  private hitInPlane(ring: Ring): { x: number; y: number } | null {
    const ray = this.ray();
    const denom = BABYLON.Vector3.Dot(ray.direction, ring.axis);
    if (Math.abs(denom) < 1e-6) return null;
    const t = BABYLON.Vector3.Dot(this.center.subtract(ray.origin), ring.axis) / denom;
    if (t < 0) return null;
    const local = ray.origin.add(ray.direction.scale(t)).subtract(this.center);
    return { x: BABYLON.Vector3.Dot(local, ring.u), y: BABYLON.Vector3.Dot(local, ring.v) };
  }

  /** Anneau sous le pointeur (à `PICK_TOLERANCE_PX` près), ou -1. */
  private pickRing(): number {
    const camera = this.scene.activeCamera;
    if (!camera) return -1;
    const height = this.scene.getEngine().getRenderHeight() || 1;
    const fov = camera.fov;
    const distance = BABYLON.Vector3.Distance(camera.globalPosition, this.center);
    const tolerance = PICK_TOLERANCE_PX * ((2 * distance * Math.tan(fov / 2)) / height);
    const direction = this.ray().direction;
    let best = -1;
    let bestScore = Infinity;
    this.rings.forEach((ring, i) => {
      const hit = this.hitInPlane(ring);
      if (!hit) return;
      const gap = Math.abs(Math.hypot(hit.x, hit.y) - this.radius);
      if (gap > tolerance) return;
      // Aux croisements de deux anneaux, celui qui fait le plus face à la caméra gagne (un anneau vu
      // par la tranche se saisit mal).
      const score = gap + tolerance * 0.5 * (1 - Math.abs(BABYLON.Vector3.Dot(direction, ring.axis)));
      if (score < bestScore) { best = i; bestScore = score; }
    });
    return best;
  }

  private onPointer(info: BABYLON.PointerInfo, state: BABYLON.EventState) {
    if (!this.mesh) return;
    const type = info.type;
    if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      if (this.dragging >= 0) { this.drag(); return; }
      const hover = this.pickRing();
      if (hover !== this.hover) {
        this.hover = hover;
        this.setCursor(hover >= 0 ? 'grab' : '');
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const event = info.event as PointerEvent;
      if (event.button !== 0) return;
      const ring = this.pickRing();
      if (ring < 0) return;
      this.beginDrag(ring);
      state.skipNextObservers = true;
    } else if (type === BABYLON.PointerEventTypes.POINTERUP && this.dragging >= 0) {
      this.endDrag();
      state.skipNextObservers = true;
    }
  }

  private beginDrag(index: number) {
    this.fitToMesh();
    this.pivot.copyFrom(this.center);
    const hit = this.hitInPlane(this.rings[index]);
    this.dragging = index;
    this.hover = index;
    this.startTheta = hit ? mod(Math.atan2(hit.y, hit.x)) : 0;
    this.angle = 0;
    this.applied = 0;
    this.lastLabel = '';
    this.setCursor('grabbing');
    this.updateArc(this.rings[index]);
  }

  /** `on_dragging` d'Orca : angle depuis le départ, accroché selon la distance au centre. */
  private drag() {
    const mesh = this.mesh;
    const index = this.dragging;
    if (!mesh || index < 0) return;
    const ring = this.rings[index];
    const hit = this.hitInPlane(ring);
    if (!hit) return;

    let theta = mod(Math.atan2(hit.y, hit.x) - this.startTheta);
    const length = Math.hypot(hit.x, hit.y);
    const coarseIn = this.radius / 3;
    const fineIn = this.radius;
    if (coarseIn <= length && length <= 2 * coarseIn) {
      const step = TAU / SNAP_REGIONS;
      theta = step * Math.round(theta / step);
    } else if (fineIn <= length && length <= fineIn + this.radius * SCALE_LONG_TOOTH) {
      const step = TAU / SCALE_STEPS;
      theta = step * Math.round(theta / step);
    }
    if (theta >= TAU) theta = 0;
    this.angle = theta;
    this.updateArc(ring);

    // Pas relatif au dernier angle appliqué : le modèle tourne autour du centre pris au départ.
    const delta = theta - this.applied;
    if (Math.abs(delta) < 1e-9) return;
    this.applied = theta;
    mesh.rotateAround(this.pivot, ring.axis, delta);
    // La rotation laisse le pivot en place ; le rappel peut ensuite reposer le modèle sur le plateau.
    // Le pivot suit ce décalage ET les anneaux avec lui : la rotation se fait donc toujours autour du
    // centre du cercle affiché, qui reste confondu avec le centre pris au départ du glissement.
    const afterRotation = mesh.position.clone();
    this.options.onRotated(mesh);
    const shift = mesh.position.subtract(afterRotation);
    this.pivot.addInPlace(shift);
    this.center.copyFrom(this.pivot);
    this.layoutRings();
  }

  private endDrag() {
    this.dragging = -1;
    this.angle = 0;
    this.applied = 0;
    this.label?.setEnabled(false);
    this.setCursor(this.hover >= 0 ? 'grab' : '');
    this.options.onDragEnd?.();
    this.fitToMesh();
  }
}
