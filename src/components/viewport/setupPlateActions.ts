import { Upload, BoxSelect, LayoutGrid, Trash2 } from 'lucide-react';
import * as BABYLON from 'babylonjs';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import type { ViewportCtx } from './context';

/** Boutons d'action autour du plateau (importer, tout sélectionner, ranger, tout supprimer). */
export function setupPlateActions(c: ViewportCtx) {
  const { scene, blurRT, glassDiscMat, makeScreenLine, flat, RADIUS, HEIGHT } = c;


  // Rangée de boutons d'action couchée à plat autour du bord du plateau (mode Préparation) :
  // de vrais maillages de la scène, qui suivent donc la perspective, l'orbite et le zoom comme
  // le plateau lui-même. Chaque bouton est un secteur d'anneau ; les extrémités de la rangée
  // sont arrondies. Survol et clic passent par le picking Babylon.
  const PLATE_ACTION_INNER_R = RADIUS + 6;
 // mm : léger jour entre le plateau et la rangée
  const PLATE_ACTION_WIDTH = 20;
 // mm, dans le sens radial
  const PLATE_ACTION_SPAN_DEG = 15;
 // étendue angulaire d'un bouton
  const PLATE_ACTION_SPACING_DEG = 1.2;

  // Milieu de la rangée, en angle monde (atan2(z, x)) : à l'avant gauche du plateau dans la
  // vue par défaut (caméra à alpha = π/4).
  const PLATE_ACTION_CENTER_DEG = -35;

  const PLATE_ACTION_Y = 0.3;

  const PLATE_ACTION_ICON_MM = 12;

  const plateActions = [
    { icon: Upload, title: 'Importer un modèle', description: 'Ajoutez un fichier STL, GLB ou GLTF sur le plateau.' },
    { icon: BoxSelect, title: 'Tout sélectionner', description: 'Sélectionnez tous les modèles présents sur le plateau.' },
    { icon: LayoutGrid, title: 'Disposer automatiquement', description: 'Réorganisez les modèles au plus près du centre du plateau, sans chevauchement.' },
    { icon: Trash2, title: 'Tout supprimer', description: 'Retirez tous les modèles du plateau.' },
  ];
  c.plateActions = plateActions;

  // Même verre dépoli que le plateau, sans teinte : le shader `glassDisc` échantillonne `blurRT`
  // en coordonnées écran, il s'applique donc tel quel à n'importe quelle forme. Au survol, le
  // verre s'éclaircit légèrement vers le blanc (toujours sans couleur) et le contour s'affirme.
  BABYLON.Effect.ShadersStore["plateActionGlassHoverFragmentShader"] = `
      precision highp float;
      varying vec4 vClip;
      uniform sampler2D blurTex;
      void main(void) {
        vec2 uv = (vClip.xy / vClip.w) * 0.5 + 0.5;
        vec3 color = mix(texture2D(blurTex, uv).rgb, vec3(1.0), 0.12);
        gl_FragColor = vec4(color, 1.0);
      }
    `;

  const plateActionHoverMat = new BABYLON.ShaderMaterial("plateActionGlassHoverMat", scene, { vertex: "glassDisc", fragment: "plateActionGlassHover" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection"],
    samplers: ["blurTex"],
  });
  c.plateActionHoverMat = plateActionHoverMat;

  plateActionHoverMat.setTexture("blurTex", blurRT);

  plateActionHoverMat.backFaceCulling = false;


  const plateActionRoot = new BABYLON.TransformNode('plateActionRoot', scene);
  c.plateActionRoot = plateActionRoot;

  plateActionRoot.position.y = HEIGHT * 0.5;

  // Contours des boutons du plateau : presque blancs au repos, blanc franc au survol.
  // Un ruban GreasedLine n'a pas de jointure : à un angle vif (coins des boutons) les deux
  // tronçons se décalent en un cran visible. On arrondit donc chaque coin franc du contour
  // (courbe de Bézier quadratique de rayon `radius`, mm) ; les points d'arc dense ne bougent pas.
  const roundClosedCorners = (pts: BABYLON.Vector3[], radius: number): BABYLON.Vector3[] => {
    const n = pts.length;
    const out: BABYLON.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i + n - 1) % n], cur = pts[i], next = pts[(i + 1) % n];
      const a = prev.subtract(cur), b = next.subtract(cur);
      const la = a.length(), lb = b.length();
      const cos = BABYLON.Vector3.Dot(a, b) / Math.max(1e-9, la * lb);
      // Angle intérieur > ~150° (quasi droit/arc dense) : on laisse tel quel.
      if (cos < -0.866) { out.push(cur); continue; }
      const r = Math.min(radius, la * 0.45, lb * 0.45);
      const p0 = cur.add(a.scale(r / la)), p1 = cur.add(b.scale(r / lb));
      for (let j = 0; j <= 8; j++) {
        const t = j / 8, u = 1 - t;
        out.push(p0.scale(u * u).addInPlace(cur.scale(2 * u * t)).addInPlace(p1.scale(t * t)));
      }
    }
    out.push(out[0]);
    return out;
  };


  const PLATE_ACTION_OUTLINE_ALPHA = 0.85;
  c.PLATE_ACTION_OUTLINE_ALPHA = PLATE_ACTION_OUTLINE_ALPHA;

  const plateActionButtons: { mesh: BABYLON.Mesh; outline: BABYLON.Mesh; iconMat: BABYLON.StandardMaterial }[] = [];
  c.plateActionButtons = plateActionButtons;

  const rowSpan = plateActions.length * PLATE_ACTION_SPAN_DEG + (plateActions.length - 1) * PLATE_ACTION_SPACING_DEG;

  const midR = PLATE_ACTION_INNER_R + PLATE_ACTION_WIDTH / 2;

  const capR = PLATE_ACTION_WIDTH / 2;

  const polar = (r: number, theta: number) => new BABYLON.Vector3(r * Math.cos(theta), PLATE_ACTION_Y, r * Math.sin(theta));


  plateActions.forEach((action, k) => {
    const first = k === 0;
    const last = k === plateActions.length - 1;
    const startDeg = PLATE_ACTION_CENTER_DEG - rowSpan / 2 + k * (PLATE_ACTION_SPAN_DEG + PLATE_ACTION_SPACING_DEG);
    // Les demi-cercles d'extrémité prennent sur la longueur du bouton, pour que tous les
    // boutons gardent la même taille apparente.
    const capDeg = (capR / midR) * (180 / Math.PI);
    const t0 = ((startDeg + (first ? capDeg : 0)) * Math.PI) / 180;
    const t1 = ((startDeg + PLATE_ACTION_SPAN_DEG - (last ? capDeg : 0)) * Math.PI) / 180;

    // Contour fermé (bord intérieur → cap de fin → bord extérieur à rebours → cap de début),
    // triangulé en éventail depuis le centre du bouton : le secteur est assez peu courbé
    // pour rester étoilé par rapport à ce centre.
    const STEPS = 48;
    const CAP_STEPS = 24;
    const contour: BABYLON.Vector3[] = [];
    for (let j = 0; j <= STEPS; j++) contour.push(polar(PLATE_ACTION_INNER_R, t0 + ((t1 - t0) * j) / STEPS));
    const cap = (theta: number, dir: 1 | -1, fromInner: boolean) => {
      const c = polar(midR, theta);
      const radial = new BABYLON.Vector3(Math.cos(theta), 0, Math.sin(theta));
      const tangent = new BABYLON.Vector3(-Math.sin(theta), 0, Math.cos(theta)).scale(dir);
      for (let j = 1; j < CAP_STEPS; j++) {
        const psi = (Math.PI * j) / CAP_STEPS;
        const toward = radial.scale((fromInner ? -1 : 1) * Math.cos(psi) * capR).addInPlace(tangent.scale(Math.sin(psi) * capR));
        contour.push(c.add(toward));
      }
    };
    if (last) cap(t1, 1, true);
    for (let j = STEPS; j >= 0; j--) contour.push(polar(PLATE_ACTION_INNER_R + PLATE_ACTION_WIDTH, t0 + ((t1 - t0) * j) / STEPS));
    if (first) cap(t0, -1, false);

    const tMid = (t0 + t1) / 2 + (first ? -capDeg / 2 : last ? capDeg / 2 : 0) * (Math.PI / 180);
    const center = polar(midR, tMid);
    const positions: number[] = [center.x, center.y, center.z];
    contour.forEach((p) => positions.push(p.x, p.y, p.z));
    const indices: number[] = [];
    for (let j = 0; j < contour.length; j++) indices.push(0, 1 + j, 1 + ((j + 1) % contour.length));
    const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    const mesh = new BABYLON.Mesh(`plateAction${k}`, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.applyToMesh(mesh);
    mesh.parent = plateActionRoot;

    mesh.material = glassDiscMat;

    const outline = makeScreenLine(
      `plateActionOutline${k}`,
      roundClosedCorners(contour, 1.2).map((p) => p.add(new BABYLON.Vector3(0, 0.05, 0))),
      new BABYLON.Color3(1, 1, 1),
      PLATE_ACTION_OUTLINE_ALPHA,
      1.4,
    );
    outline.parent = plateActionRoot;

    // Icône couchée sur le bouton, orientation fixe : son haut suit la tangente de l'arc (sens
    // des θ décroissants), ce qui la garde droite à l'écran dans la vue par défaut tout en
    // l'inclinant légèrement avec la courbure du plateau. Le haut de la texture d'un
    // `CreateGround` est du côté +Z local, d'où le +π.
    const icon = BABYLON.MeshBuilder.CreateGround(`plateActionIcon${k}`, { width: PLATE_ACTION_ICON_MM, height: PLATE_ACTION_ICON_MM }, scene);
    icon.position = center.add(new BABYLON.Vector3(0, 0.1, 0));
    icon.rotation.y = Math.PI - tMid;
    icon.isPickable = false;
    icon.parent = plateActionRoot;
    const iconTex = new BABYLON.DynamicTexture(`plateActionIconTex${k}`, { width: 128, height: 128 }, scene, true);
    iconTex.hasAlpha = true;
    const iconMat = new BABYLON.StandardMaterial(`plateActionIconMat${k}`, scene);
    iconMat.diffuseTexture = iconTex;
    iconMat.useAlphaFromDiffuseTexture = true;
    iconMat.disableLighting = true;
    iconMat.emissiveColor = new BABYLON.Color3(0.9, 0.93, 1);
    iconMat.backFaceCulling = false;
    iconMat.alpha = 0.8;
    icon.material = iconMat;
    const svg = renderToStaticMarkup(React.createElement(action.icon, { size: 128, color: '#ffffff', strokeWidth: 2.4 }));
    const img = new Image();
    img.onload = () => {
      if (scene.isDisposed) return;
      const ctx = iconTex.getContext();
      ctx.clearRect(0, 0, 128, 128);
      ctx.drawImage(img, 12, 12, 104, 104);
      iconTex.update();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    plateActionButtons.push({ mesh, outline, iconMat });
  });


  let plateActionPreviewActive = false;

  const updatePlateActionVisibility = () => {
    // Interface classique : ces boutons sont dans le panneau de gauche (ClassicApp), pas autour du plateau.
    plateActionRoot.setEnabled(!flat && !c.modelingActive && !plateActionPreviewActive);
  };

  updatePlateActionVisibility();

  const onPlateActionModeChanged = () => updatePlateActionVisibility();
  c.onPlateActionModeChanged = onPlateActionModeChanged;

  const onPlateActionPreviewToggled = (e: Event) => {
    plateActionPreviewActive = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
    updatePlateActionVisibility();
  };
  c.onPlateActionPreviewToggled = onPlateActionPreviewToggled;

  // Enregistré après `onModeChanged` : `modelingActive` est donc déjà à jour ici.
  window.addEventListener('apex-mode-changed', onPlateActionModeChanged);

  window.addEventListener('apex-preview-toggled', onPlateActionPreviewToggled);
}
