import * as BABYLON from 'babylonjs';
import { createScreenLine } from '../screenLine';
import { GCODE_MESH_PREFIX } from '../gcodeLayer';
import { isPlateShaded, subscribePlateShaded } from '@/utils/plateShadingPrefs';
import { DEFAULT_BLUR_LEVEL } from './constants';
import type { ViewportCtx } from './context';

/** Axes d'origine, flou sous le plateau, disque de verre, ombrage et contours. */
export function setupPlateVisuals(c: ViewportCtx) {
  const { scene, flat, engine, camera, backdropColor, HEIGHT, HOLE_RADIUS, PLATE_SURFACE_Y, RADIUS, modelsRef } = c;


  const volumeRoot = new BABYLON.TransformNode("volumeRoot", scene);
  c.volumeRoot = volumeRoot;

  // Plateau surélevé à mi-hauteur du volume d'impression (0.5 × HEIGHT) pour le détacher
  // visuellement du fond quadrillé. `plateActionRoot` (boutons d'action) suit la même élévation.
  volumeRoot.position.y = HEIGHT * 0.5;


  // Contours en rubans d'épaisseur constante à l'écran (cf. screenLine.ts) : une LinesMesh WebGL
  // fait toujours 1 px, trop fin pour que l'anticrénelage le lisse, et GreasedLine varie encore
  // avec la profondeur. `LINE_WIDTH_PX` : épaisseur en pixels de rendu.
  const LINE_WIDTH_PX = 2.5;
  c.LINE_WIDTH_PX = LINE_WIDTH_PX;

  const originAxisLength = HOLE_RADIUS * 1.4;

  // Sous la surface du plateau (glassDisc est à y = 0.1) : le disque, opaque, les occlut vus
  // du dessus (le depth-test les cache), mais ils entrent dans la capture `blurRT` et
  // apparaissent floutés dans le reflet vu du dessous — cf. capturedInBlur plus bas.
  const originAxisBase = new BABYLON.Vector3(0, 0.08, 0);

  const originAxes: [BABYLON.Vector3, BABYLON.Color3][] = [
    [new BABYLON.Vector3(originAxisLength, 0.08, 0), new BABYLON.Color3(1, 0.23, 0.23)],
    [new BABYLON.Vector3(0, originAxisLength, 0), new BABYLON.Color3(0.23, 1, 0.36)],
    [new BABYLON.Vector3(0, 0.08, originAxisLength), new BABYLON.Color3(0.23, 0.48, 1)],
  ];

  // Pivot commun des axes : en Prévisualisation, il suit la rotation C du plateau G-code
  // (cf. gcodeLayer plus bas) pour que les axes tournent avec la pièce ; ailleurs, fixe.
  const originAxesRoot = new BABYLON.TransformNode("originAxesRoot", scene);
  c.originAxesRoot = originAxesRoot;

  originAxesRoot.parent = volumeRoot;

  originAxes.forEach(([dir, color], i) => {
    // zOffset 0 : sous la surface du plateau, ces axes doivent rester occultés par le disque.
    const axisLine = createScreenLine(scene, `originAxis${i}`, [originAxisBase, dir], flat ? BABYLON.Color3.White() : color, LINE_WIDTH_PX, 1, { zOffset: 0 });
    axisLine.parent = originAxesRoot;
    if (!flat) return;
    // Interface classique : pas de couleur d'axe, une lettre au bout (Z imprimante = Y Babylon, Y imprimante = Z Babylon).
    const letter = ['X', 'Z', 'Y'][i];
    const tex = new BABYLON.DynamicTexture(`originAxisLetter${i}`, { width: 64, height: 64 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 32, 34);
    tex.update();
    tex.hasAlpha = true;
    const plane = BABYLON.MeshBuilder.CreatePlane(`originAxisLetterPlane${i}`, { size: originAxisLength * 0.22 }, scene);
    const letterMat = new BABYLON.StandardMaterial(`originAxisLetterMat${i}`, scene);
    letterMat.emissiveTexture = tex;
    letterMat.opacityTexture = tex;
    letterMat.disableLighting = true;
    letterMat.backFaceCulling = false;
    plane.material = letterMat;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.parent = originAxesRoot;
    // Au-dessus de la surface du plateau (y = 0.1) : sinon le disque opaque coupe la lettre des axes posés à plat.
    plane.position.copyFrom(dir.scale(1.12));
    plane.position.y = Math.max(plane.position.y, originAxisLength * 0.2);
  });


  // Disque flouté au centre du plateau : capture la scène dans une render target à pleine
  // résolution (le sous-échantillonnage introduisait un décalage d'alignement), floutée par
  // deux passes gaussiennes, puis un mesh circulaire échantillonne cette texture en
  // coordonnées écran ("verre dépoli").
  const rtWidth = engine.getRenderWidth();

  const rtHeight = engine.getRenderHeight();

  const blurRT = new BABYLON.RenderTargetTexture("blurRT", { width: rtWidth, height: rtHeight }, scene, { generateMipMaps: false });
  c.blurRT = blurRT;

  blurRT.activeCamera = camera;

  blurRT.ignoreCameraViewport = true;

  // Même teinte que le fond quadrillé (désormais transparent hors de ses lignes) : sans ça,
  // le disque reflète le noir de la clear color par défaut aux endroits où rien n'est dessiné.
  const blurRTClearColor = BABYLON.Color4.FromColor3(BABYLON.Color3.FromHexString(backdropColor), 1);

  blurRT.clearColor = blurRTClearColor;

  blurRT.updateSamplingMode(BABYLON.Texture.BILINEAR_SAMPLINGMODE);

  scene.customRenderTargets.push(blurRT);

  // Interface classique : plateau « à plat » par défaut. La capture floutée du plateau (rendu plein cadre + 2 flous
  // gaussiens à chaque image) n'est alors pas rendue : le plateau et ses boutons restent noirs. Coché
  // (« Rendre le plateau avec ombres »), elle redevient vive. Même bascule pour le matériau des modèles (cf. applyPlateShading).
  if (flat) blurRT.clearColor = new BABYLON.Color4(0, 0, 0, 1);


  const blurH = new BABYLON.BlurPostProcess("blurH", new BABYLON.Vector2(1, 0), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);

  const blurV = new BABYLON.BlurPostProcess("blurV", new BABYLON.Vector2(0, 1), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);

  blurRT.addPostProcess(blurH);

  blurRT.addPostProcess(blurV);


  // Trajectoire et tête de l'AUTRE côté du plateau que la caméra : le disque opaque les cache, et la capture
  // `blurRT` ne contient pas le G-code (du côté de la caméra elle n'ajouterait qu'un halo autour du tracé). Capture
  // à part, coupée au plan du plateau : vue du dessus seule la partie enfouie (Z < 0) y entre, vue du dessous seule la
  // partie posée sur le plateau ; floutée comme le reste, puis composée sur le verre par le shader du disque
  // (couleur prémultipliée : le flou d'un fond transparent donne la couverture en alpha).
  const gcodeBlurRT = new BABYLON.RenderTargetTexture("gcodeBlurRT", { width: rtWidth, height: rtHeight }, scene, { generateMipMaps: false });

  gcodeBlurRT.activeCamera = camera;

  gcodeBlurRT.ignoreCameraViewport = true;

  gcodeBlurRT.clearColor = new BABYLON.Color4(0, 0, 0, 0);

  gcodeBlurRT.updateSamplingMode(BABYLON.Texture.BILINEAR_SAMPLINGMODE);

  gcodeBlurRT.refreshRate = 0;

  scene.customRenderTargets.push(gcodeBlurRT);

  const gcodeBlurH = new BABYLON.BlurPostProcess("gcodeBlurH", new BABYLON.Vector2(1, 0), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);

  const gcodeBlurV = new BABYLON.BlurPostProcess("gcodeBlurV", new BABYLON.Vector2(0, 1), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);

  gcodeBlurRT.addPostProcess(gcodeBlurH);

  gcodeBlurRT.addPostProcess(gcodeBlurV);

  // Z = 0 du G-code : gcodeAnchor, juste au-dessus du disque (cf. plus bas). Un plan de coupe retire les points où
  // plan·p > 0 : le premier ne garde que ce qui est sous le plateau, le second que ce qui est au-dessus.
  const gcodePlateY = PLATE_SURFACE_Y + 0.05;

  const gcodeKeepBelow = new BABYLON.Plane(0, 1, 0, -gcodePlateY);

  const gcodeKeepAbove = new BABYLON.Plane(0, -1, 0, gcodePlateY);

  gcodeBlurRT.onBeforeRenderObservable.add(() => {
    const fromAbove = camera.globalPosition.y >= gcodePlateY;
    scene.clipPlane = fromAbove ? gcodeKeepBelow : gcodeKeepAbove;
    // Vu du dessous, le tracé posé sur le plateau est éclairé par le haut : ses faces visibles sont sombres, on les relève.
    glassDiscMat.setFloat("gcodeGain", fromAbove ? 1 : 2.2);
  });

  gcodeBlurRT.onAfterRenderObservable.add(() => { scene.clipPlane = null; });

  const capturedInGcodeBlur = (m: BABYLON.AbstractMesh) =>
    m.name.startsWith(GCODE_MESH_PREFIX) && !m.name.includes('OffPlate') && !m.name.includes('PickHighlight');

  gcodeBlurRT.renderList = scene.meshes.filter(capturedInGcodeBlur);

  scene.onNewMeshAddedObservable.add((m) => {
    if (capturedInGcodeBlur(m) && gcodeBlurRT.renderList) gcodeBlurRT.renderList.push(m);
  });

  scene.onMeshRemovedObservable.add((m) => {
    const list = gcodeBlurRT.renderList;
    const i = list ? list.indexOf(m) : -1;
    if (list && i >= 0) list.splice(i, 1);
  });

  // Rendue à chaque image seulement quand un G-code est affiché (et que le plateau est en verre) ; à l'extinction,
  // une dernière capture, vide, efface l'image précédente.
  let gcodeBlurOn = false;

  scene.onBeforeRenderObservable.add(() => {
    const root = scene.getTransformNodeByName(`${GCODE_MESH_PREFIX}Root`);
    const on = !!root && root.isEnabled() && !(flat && !isPlateShaded());
    if (on === gcodeBlurOn) return;
    gcodeBlurOn = on;
    gcodeBlurRT.refreshRate = on ? 1 : 0;
    if (!on) gcodeBlurRT.resetRefreshCounter();
  });


  const onSetBlurLevel = (e: Event) => {
    const level = (e as CustomEvent<{ level: number }>).detail?.level;
    if (typeof level === 'number') {
      blurH.kernel = level;
      blurV.kernel = level;
      gcodeBlurH.kernel = level;
      gcodeBlurV.kernel = level;
    }
  };
  c.onSetBlurLevel = onSetBlurLevel;

  window.addEventListener('apex-set-blur-level', onSetBlurLevel);


  BABYLON.Effect.ShadersStore["glassDiscVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec4 vClip;
      void main(void) {
        vec4 outPosition = worldViewProjection * vec4(position, 1.0);
        gl_Position = outPosition;
        vClip = outPosition;
      }
    `;

  BABYLON.Effect.ShadersStore["glassDiscFragmentShader"] = `
      precision highp float;
      varying vec4 vClip;
      uniform sampler2D blurTex;
      uniform sampler2D gcodeTex;
      uniform float gcodeGain;
      void main(void) {
        vec2 ndc = vClip.xy / vClip.w;
        vec2 uv = ndc * 0.5 + 0.5;
        vec3 color = texture2D(blurTex, uv).rgb;
        // Trajectoire et tête enfouies sous le plateau (capture floutée, couleur prémultipliée).
        vec4 buried = texture2D(gcodeTex, uv);
        color = color * (1.0 - buried.a) + min(buried.rgb * gcodeGain, vec3(1.0));
        gl_FragColor = vec4(color, 1.0);
      }
    `;

  const glassDiscMat = new BABYLON.ShaderMaterial("glassDiscMat", scene, { vertex: "glassDisc", fragment: "glassDisc" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "gcodeGain"],
    samplers: ["blurTex", "gcodeTex"],
  });
  c.glassDiscMat = glassDiscMat;

  glassDiscMat.setFloat("gcodeGain", 1);

  glassDiscMat.setTexture("blurTex", blurRT);

  glassDiscMat.setTexture("gcodeTex", gcodeBlurRT);

  glassDiscMat.backFaceCulling = false;


  const glassDisc = BABYLON.MeshBuilder.CreateDisc("glassDisc", { radius: RADIUS, tessellation: 360 }, scene);
  c.glassDisc = glassDisc;

  glassDisc.rotation.x = Math.PI / 2;

  // Nettement au-dessus du fond quadrillé (backdrop, y = -0.05) : l'ancien écart de 0.03 mm
  // était trop fin pour se voir et frôlait le z-fighting à distance. Reste sous 1 mm pour ne
  // pas creuser d'écart visible avec les modèles, posés sur la surface du plateau — cf.
  // PLATE_SURFACE_Y, qui reprend ce même offset de 0.1 (voir handleDragEnd/onImportModel).
  glassDisc.position.y = 0.1;

  glassDisc.material = glassDiscMat;

  glassDisc.parent = volumeRoot;

  // Les maillages qui échantillonnent eux-mêmes `blurRT` (disque, boutons d'action du plateau)
  // n'y sont pas rendus : ils liraient la texture en cours d'écriture. La trajectoire G-code
  // non plus : entièrement au-dessus du disque, elle n'y ajouterait qu'un halo flou autour du
  // tracé, pour le prix d'un second rendu de lignes pouvant compter des millions de sommets.
  const capturedInBlur = (m: BABYLON.AbstractMesh) =>
    m !== glassDisc && !m.name.startsWith('plateAction') && !m.name.startsWith(GCODE_MESH_PREFIX);

  blurRT.renderList = scene.meshes.filter(capturedInBlur);

  scene.onNewMeshAddedObservable.add((m) => {
    if (capturedInBlur(m) && blurRT.renderList && !(flat && !isPlateShaded())) blurRT.renderList.push(m);
  });


  // --- Interface classique : plateau et modèles à plat, ou rendu complet (« avec ombres »). ---
  const flatModelMat = new BABYLON.StandardMaterial("flatModelMat", scene);

  flatModelMat.disableLighting = true;

  flatModelMat.emissiveColor = new BABYLON.Color3(0.85, 0.85, 0.85);

  flatModelMat.backFaceCulling = false;

  const originalMaterials = new Map<BABYLON.AbstractMesh, BABYLON.Material | null>();

  const applyModelShading = () => {
    if (!flat) return;
    const shaded = isPlateShaded();
    modelsRef.current.forEach((root) => {
      if (root.isDisposed()) return;
      [root, ...root.getChildMeshes(false)].forEach((m) => {
        if (shaded) {
          if (originalMaterials.has(m)) { m.material = originalMaterials.get(m) ?? null; originalMaterials.delete(m); }
        } else if (m.getTotalVertices() > 0 && m.material !== flatModelMat) {
          if (!originalMaterials.has(m)) originalMaterials.set(m, m.material);
          m.material = flatModelMat;
        }
      });
    });
  };
  c.applyModelShading = applyModelShading;

  const applyPlateShading = () => {
    if (!flat) return;
    const shaded = isPlateShaded();
    // Capture floutée : rendue à chaque image (verre) ou une dernière fois à vide (plateau noir), puis plus jamais.
    blurRT.renderList = shaded ? scene.meshes.filter(capturedInBlur) : [];
    blurRT.refreshRate = shaded ? 1 : 0;
    applyModelShading();
  };

  applyPlateShading();

  const unsubscribeShading = subscribePlateShaded(applyPlateShading);
  c.unsubscribeShading = unsubscribeShading;


  const makeScreenLine = (name: string, points: BABYLON.Vector3[], color: BABYLON.Color3, alpha = 1, widthScale = 1) =>
    createScreenLine(scene, name, points, color, LINE_WIDTH_PX * widthScale, alpha);
  c.makeScreenLine = makeScreenLine;


  const outlinePoints = [];

  for (let i = 0; i <= 720; i++) {
    const angle = (i / 720) * Math.PI * 2;
    // Même hauteur que glassDisc : sans ça le contour cerclait le vide sous le disque surélevé.
    outlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, glassDisc.position.y, Math.sin(angle) * RADIUS));
  }

  const outline = makeScreenLine("plateOutline", outlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0, 0.94, 1));
  c.outline = outline;

  outline.parent = volumeRoot;


  const topOutlinePoints = [];

  for (let i = 0; i <= 720; i++) {
    const angle = (i / 720) * Math.PI * 2;
    topOutlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, HEIGHT, Math.sin(angle) * RADIUS));
  }

  const topOutline = makeScreenLine("topOutline", topOutlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0, 0.94, 1));
  c.topOutline = topOutline;

  topOutline.parent = volumeRoot;
}
