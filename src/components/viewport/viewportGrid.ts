// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { createScreenLine, createScreenLines } from '../screenLine';
import type { GridLabel, GridStandardPlane } from './viewportTypes';
import { isLabelVisible, labelDecimation } from './gridLabelLogic';
import type { ViewportState } from './viewportState';

function setupMakeScreenLine(st: ViewportState) {
  const { HEIGHT, LINE_WIDTH_PX, RADIUS, flat, glassDisc, scene, volumeRoot } = st;
  const makeScreenLine = (name: string, points: BABYLON.Vector3[], color: BABYLON.Color3, alpha = 1, widthScale = 1) =>
    createScreenLine(scene, name, points, color, LINE_WIDTH_PX * widthScale, alpha);

  const outlinePoints = [];
  for (let i = 0; i <= 720; i++) {
    const angle = (i / 720) * Math.PI * 2;
    // Même hauteur que glassDisc : sans ça le contour cerclait le vide sous le disque surélevé.
    outlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, glassDisc.position.y, Math.sin(angle) * RADIUS));
  }
  const outline = makeScreenLine("plateOutline", outlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0.9608, 0.6196, 0.0431));
  outline.parent = volumeRoot;

  const topOutlinePoints = [];
  for (let i = 0; i <= 720; i++) {
    const angle = (i / 720) * Math.PI * 2;
    topOutlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, HEIGHT, Math.sin(angle) * RADIUS));
  }
  const topOutline = makeScreenLine("topOutline", topOutlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0.9608, 0.6196, 0.0431));
  topOutline.parent = volumeRoot;

  // Grille d'esquisse du mode modélisation : masquée tant qu'on est en mode slicer, elle
  // remplace le volume d'impression pour donner un repère de travail neutre au modéliseur.
  const GRID_WIDTH_AXIS = 2; // px écran — épaisseur des axes colorés, proche des traits de la grille
  Object.assign(st, { makeScreenLine, outline, topOutline, GRID_WIDTH_AXIS });
}

function setupMakeGridLines(st: ViewportState) {
  const { GRID_WIDTH_AXIS, scene } = st;
  const makeGridLines = (
    name: string,
    lines: BABYLON.Vector3[][],
    color: BABYLON.Color3,
    width: number,
    alpha: number,
  ): BABYLON.Mesh => {
    // Trait plat d'épaisseur constante en pixels (comme les autres lignes de la grille), et non
    // un ruban 3D à atténuation de taille, qui paraissait énorme et volumétrique de près.
    // Le shader écarte un sommet situé derrière la caméra : un segment de 2 points (long de
    // milliers de mm une fois mis à l'échelle) disparaîtrait en entier. On le découpe donc en
    // tronçons courts, dont seuls ceux qui franchissent le plan de la caméra sont perdus.
    const SEGMENTS = 400;
    const subdivided = lines.map((pts) => {
      const out: BABYLON.Vector3[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        for (let k = 0; k < SEGMENTS; k++) out.push(BABYLON.Vector3.Lerp(pts[i], pts[i + 1], k / SEGMENTS));
      }
      out.push(pts[pts.length - 1].clone());
      return out;
    });
    const mesh = createScreenLines(scene, name, subdivided, color, width, alpha, { zOffset: -4 });
    mesh.setEnabled(false);
    return mesh;
  };

  // Portée en unités monde des axes colorés et des graduations chiffrées (cf. plus bas) —
  // n'a plus besoin de borner un pavage de lignes : le quadrillage lui-même est maintenant un
  // shader procédural, sans étendue finie (cf. `modelingGridGround` ci-dessous).
  const GRID_TILE_EXTENT = 100;
  // Les deux axes du sol : les plus épais des traits de la grille, colorés comme le repère
  // d'origine (X rouge / Z bleu — mêmes teintes que `AXIS_COLORS` plus bas, l'axe vertical Y
  // vert étant porté par les plans d'esquisse). Légèrement surélevés (`y` non nul) pour ne pas
  // z-fighter avec le quadrillage procédural, coplanaire, juste en dessous.
  const modelingGridAxisX = makeGridLines(
    "modelingGridAxisX",
    [[new BABYLON.Vector3(-GRID_TILE_EXTENT, 0.02, 0), new BABYLON.Vector3(GRID_TILE_EXTENT, 0.02, 0)]],
    new BABYLON.Color3(0.85, 0.22, 0.22), GRID_WIDTH_AXIS, 0.9,
  );
  const modelingGridAxisZ = makeGridLines(
    "modelingGridAxisZ",
    [[new BABYLON.Vector3(0, 0.02, -GRID_TILE_EXTENT), new BABYLON.Vector3(0, 0.02, GRID_TILE_EXTENT)]],
    new BABYLON.Color3(0.25, 0.5, 0.95), GRID_WIDTH_AXIS, 0.9,
  );

  const modelingGridAxisY = makeGridLines(
    "modelingGridAxisY",
    [[new BABYLON.Vector3(0, -GRID_TILE_EXTENT, 0), new BABYLON.Vector3(0, GRID_TILE_EXTENT, 0)]],
    new BABYLON.Color3(0.23, 0.85, 0.36), GRID_WIDTH_AXIS, 0.9,
  );
  Object.assign(st, { makeGridLines, GRID_TILE_EXTENT, modelingGridAxisX, modelingGridAxisZ,
    modelingGridAxisY });
}

function setupModelingGridAxisU(st: ViewportState) {
  const { GRID_TILE_EXTENT, GRID_WIDTH_AXIS, makeGridLines } = st;
  // Axes locaux gris, pour un plan quelconque (face d'un corps) : aucun axe du monde n'y repose.
  const modelingGridAxisU = makeGridLines(
    "modelingGridAxisU",
    [[new BABYLON.Vector3(-GRID_TILE_EXTENT, 0.02, 0), new BABYLON.Vector3(GRID_TILE_EXTENT, 0.02, 0)]],
    new BABYLON.Color3(0.8, 0.82, 0.85), GRID_WIDTH_AXIS, 0.9,
  );
  const modelingGridAxisV = makeGridLines(
    "modelingGridAxisV",
    [[new BABYLON.Vector3(0, 0.02, -GRID_TILE_EXTENT), new BABYLON.Vector3(0, 0.02, GRID_TILE_EXTENT)]],
    new BABYLON.Color3(0.8, 0.82, 0.85), GRID_WIDTH_AXIS, 0.9,
  );

  /**
   * Quadrillage procédural : un unique plan, dont le fragment shader dessine les traits
   * analytiquement à partir de la position monde de chaque pixel — plutôt que des maillages de
   * lignes à un pas UNIQUE choisi pour toute la scène (l'ancienne approche, cf. historique Git),
   * ce qui donnait un effet de « grosse grille au milieu de petites » : en perspective, la
   * distance caméra-sol varie fortement d'un bord à l'autre de l'écran, donc le pas idéal
   * (dérivé de `GRID_MIN_PX` pixels à l'écran) varie lui aussi — un seul pas global ne peut
   * convenir partout à la fois. Ici, `fwidth()` donne au shader la dérivée écran de la
   * position monde EN CHAQUE PIXEL, donc le même calcul que `updateGrid` (log10 + arrondi
   * décade) s'applique localement : chaque zone de l'écran affiche la subdivision qui LUI
   * convient, avec une transition en fondu continue plutôt qu'un saut global.
   *
   * Le plan suit la cible caméra (translation pure, cf. `gridZoomObserver`) pour rester sous
   * le point regardé : le motif étant recalculé analytiquement à chaque pixel (pas de tuile
   * finie à raccorder), cette translation n'a aucune contrainte d'alignement contrairement à
   * l'ancien pavage de lignes.
   */
  BABYLON.Effect.ShadersStore["modelingGridVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform float uScale;
      uniform vec2 uOffset;
      // Position dans le plan du motif, relative à l'ancre de la grille (cf. recenterGridGround).
      // Le plan est un carré unité recentré sur la cible et mis à l'échelle du rayon caméra à
      // chaque frame : ses sommets restent donc à une distance de l'ordre du champ visible, et
      // l'interpolation float32 de cette varying garde une précision proportionnelle au zoom.
      // Avec un plan fixe géant (sommets à des dizaines de mètres), l'erreur d'interpolation
      // (~taille x 6e-8) dépassait la taille d'un pixel, puis du champ entier au zoom extrême :
      // fwidth() devenait bruité, d'où des bandes, puis une grille vide. uOffset (cible - ancre)
      // est calculé côté CPU en double précision et reste petit.
      varying vec2 vGridPos;
      varying vec2 vUnitPos;
      void main(void) {
        vGridPos = position.xz * uScale + uOffset;
        vUnitPos = position.xz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
  Object.assign(st, { modelingGridAxisU, modelingGridAxisV });
}

function setupGridPart4() {
  BABYLON.Effect.ShadersStore["modelingGridFragmentShader"] = `
      precision highp float;
      varying vec2 vGridPos;
      varying vec2 vUnitPos;
      uniform vec3 uMinorColor;
      uniform vec3 uMajorColor;
      uniform float uMinorAlpha;
      uniform float uMajorAlpha;
      // Pas des traits principaux (mm, valeur « ronde » 1 / 2,5 / 5 / 10 x 10^k choisie côté CPU)
      // et taille monde d'un pixel au niveau de la cible : fixent la grille de TOUT l'écran.
      uniform float uStep;
      uniform float uTargetWpp;
      // Origine du repère de la grille, dans les coordonnées (relatives à l'ancre) de vGridPos.
      uniform vec2 uAxisOrigin;

      // Distance (en pixels) au trait le plus proche d'un quadrillage de pas spacing, à partir
      // d'une position ET d'une dérivée déjà calculées (un seul fwidth(), sur une grandeur
      // continue : cf. historique Git pour les artefacts par bandes).
      float gridMask(vec2 worldXZ, vec2 worldDeriv, float spacing, float halfWidthPx) {
        vec2 coord = worldXZ / spacing;
        vec2 coordDeriv = worldDeriv / spacing;
        vec2 dist = abs(fract(coord + 0.5) - 0.5) / max(coordDeriv, vec2(1e-6));
        float d = min(dist.x, dist.y);
        return 1.0 - clamp(d / halfWidthPx, 0.0, 1.0);
      }

      void main(void) {
        vec2 worldDeriv = fwidth(vGridPos);
        float localWpp = max(max(worldDeriv.x, worldDeriv.y), 1e-12);

        // Deux familles seulement, comme Fusion : traits principaux tous les uStep, traits fins
        // tous les uStep / 5. Rendu identique partout (écarts jugés au niveau de la cible) ; seul
        // un garde-fou anti-moiré omet une famille quand son écart LOCAL tombe sous ~1 px (horizon).
        float majorStep = uStep;
        float minorStep = uStep / 5.0;
        float minorPx = minorStep / uTargetWpp;
        float majorMask = gridMask(vGridPos, worldDeriv, majorStep, 0.9);
        float minorMask = gridMask(vGridPos, worldDeriv, minorStep, 0.55);
        float majorVis = smoothstep(0.7, 1.4, majorStep / localWpp);
        float minorVis = smoothstep(7.0, 16.0, minorPx) * smoothstep(0.7, 1.4, minorStep / localWpp);

        float aMajor = majorMask * majorVis * uMajorAlpha;
        float aMinor = minorMask * minorVis * uMinorAlpha;
        float alpha = max(aMajor, aMinor);
        vec3 color = aMajor >= aMinor ? uMajorColor : uMinorColor;

        // Pixels sous les deux axes colorés (origine du repère de la grille) : les axes les
        // recouvrent, inutile d'y dessiner les traits gris.
        vec2 axisPx = abs(vGridPos - uAxisOrigin) / max(worldDeriv, vec2(1e-12));
        if (min(axisPx.x, axisPx.y) < 2.0) discard;

        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `;
}

function setupModelingGridGround(st: ViewportState) {
  const { scene } = st;
  // Écart écran minimal (px) entre deux traits PRINCIPAUX au niveau de la cible : la grille ne
  // se subdivise qu'au-delà, ce qui donne par défaut ~25 mm / ~150 px comme Fusion. Les traits
  // fins (pas / 5) sont alors à 18 px au moins.
  const GRID_MAJOR_MIN_PX = 90;
  // Pas « ronds » d'une décade (x 10^k), dans l'ordre : le pas principal en est le plus petit
  // dont l'écart écran atteint GRID_MAJOR_MIN_PX.
  const GRID_NICE_STEPS = [1, 2.5, 5, 10];
  // En dessous de ce pas (mm), la géométrie flotte en simple précision : les coordonnées
  // locales divisées par un pas aussi microscopique perdent toute précision fractionnaire
  // (c'est la cause des artefacts constatés « sous 1 mm »). On plafonne donc l'affinement —
  // CPU (étiquettes/axes, cf. updateGrid) et shader (uMinExponent) — à cette décade, et on y
  // arrête aussi le zoom caméra (cf. camera.lowerRadiusLimit plus bas) plutôt que de laisser
  // l'utilisateur zoomer sur une grille devenue incohérente.
  const GRID_MIN_STEP_EXPONENT = -6; // 0,000001 mm
  // Demi-taille du plan : GRID_TILE_EXTENT pas de grille (cf. recenterGridGround).
  // Carré unité (±1), subdivisé pour garder des triangles de taille modeste ; sa taille réelle
  // est fixée à chaque frame par `scaling`.
  const modelingGridGround = BABYLON.MeshBuilder.CreateGround(
    "modelingGridGround", { width: 2, height: 2, subdivisions: 16 }, scene,
  );
  // Taille et position changent à chaque frame : on ne laisse pas Babylon l'écarter sur une
  // boîte englobante périmée.
  modelingGridGround.alwaysSelectAsActiveMesh = true;
  const modelingGridMat = new BABYLON.ShaderMaterial(
    "modelingGridMat", scene, { vertex: "modelingGrid", fragment: "modelingGrid" },
    {
      attributes: ["position"],
      uniforms: [
        "worldViewProjection", "uMinorColor", "uMajorColor", "uMinorAlpha", "uMajorAlpha", "uStep", "uTargetWpp",
        "uScale", "uOffset", "uAxisOrigin",
      ],
    },
  );
  modelingGridMat.setColor3("uMinorColor", new BABYLON.Color3(0.6, 0.65, 0.72));
  modelingGridMat.setColor3("uMajorColor", new BABYLON.Color3(0.9, 0.94, 1.0));
  modelingGridMat.setFloat("uMinorAlpha", 0.2);
  modelingGridMat.setFloat("uMajorAlpha", 0.75);
  modelingGridMat.setFloat("uStep", 10);
  modelingGridMat.alpha = 0.999; // active le blend alpha ; la valeur réelle vient du shader
  modelingGridMat.backFaceCulling = false;
  modelingGridMat.needDepthPrePass = false;
  modelingGridGround.material = modelingGridMat;
  Object.assign(st, { GRID_MAJOR_MIN_PX, GRID_NICE_STEPS, GRID_MIN_STEP_EXPONENT, modelingGridGround,
    modelingGridMat });
}

function setupDrawGridLabel(st: ViewportState) {
  const { modelingGridGround } = st;
  modelingGridGround.isPickable = false;
  modelingGridGround.setEnabled(false);

  /**
   * Chiffres de mesure le long des axes X/Z, à chaque graduation majeure — de petits panneaux
   * texturés (`DynamicTexture`) plutôt qu'un module GUI, qui n'est pas une dépendance du
   * projet. Ils sont couchés DANS le plan du sol et orientés le long de leur axe (comme la
   * règle d'un plan CAO), pas en billboard : le chiffre reste ainsi visuellement attaché à sa
   * graduation quel que soit l'angle de caméra. Une même valeur apparaît 4 fois (±X, ±Z) :
   * texture et matériau sont mutualisés par texte pour ne pas en créer 4 copies.
   */
  const gridLabelMatCache = new Map<string, BABYLON.StandardMaterial>();
  // Oxanium est servie depuis /public/fonts, mais reste chargée de façon asynchrone : si elle
  // n'est pas prête au premier dessin, le canvas retombe silencieusement sur sans-serif. On
  // garde les textures pour les redessiner une fois la police disponible.
  const gridLabelTextures = new Map<string, BABYLON.DynamicTexture>();
  // Dessin par le contexte canvas plutôt que `drawText` : celui-ci gère mal un fond
  // transparent (il peint un rectangle au lieu d'effacer) et son dernier paramètre `update`
  // conditionne le réupload GPU. Ici on efface vraiment, et on force l'upload.
  const drawGridLabel = (texture: BABYLON.DynamicTexture, text: string) => {
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const { width, height } = texture.getSize();
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 40px Oxanium, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
    texture.update(true); // `invertY` compense le retournement induit par le plan couché
  };
  // Largeur de texture adaptée au texte (hauteur fixe 64) : à 128 px fixes, les longs nombres
  // (« -0.0007 ») étaient tronqués. Le rapport largeur/hauteur est gardé pour que
  // `layoutGridLabels` donne au panneau les mêmes proportions que sa texture.
  const GRID_LABEL_TEX_HEIGHT = 64;
  const gridLabelAspect = new Map<string, number>();
  const measureGridLabel = (text: string) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return 128;
    ctx.font = '600 40px Oxanium, sans-serif';
    // Marge pour la police définitive (Oxanium, chargée en différé) un peu plus large que le
    // repli sans-serif mesuré ici au premier affichage.
    return Math.ceil(ctx.measureText(text).width * 1.15 + 16);
  };
  Object.assign(st, { gridLabelMatCache, gridLabelTextures, drawGridLabel, GRID_LABEL_TEX_HEIGHT,
    gridLabelAspect, measureGridLabel });
}

function setupGetGridLabelMaterial(st: ViewportState) {
  const { GRID_LABEL_TEX_HEIGHT, drawGridLabel, gridLabelAspect, gridLabelMatCache, gridLabelTextures, measureGridLabel, scene } = st;
  const getGridLabelMaterial = (text: string): BABYLON.StandardMaterial => {
    const cached = gridLabelMatCache.get(text);
    if (cached) return cached;
    const texWidth = Math.max(64, measureGridLabel(text));
    gridLabelAspect.set(text, texWidth / GRID_LABEL_TEX_HEIGHT);
    const texture = new BABYLON.DynamicTexture(
      `gridTickTex_${text}`, { width: texWidth, height: GRID_LABEL_TEX_HEIGHT }, scene, true,
    );
    texture.hasAlpha = true;
    drawGridLabel(texture, text);
    gridLabelTextures.set(text, texture);
    const mat = new BABYLON.StandardMaterial(`gridTickMat_${text}`, scene);
    // `hasAlpha` sur la diffuse suffit à découper le texte. Réutiliser la même texture en
    // `opacityTexture` multiplierait l'alpha par lui-même et, ce canal n'étant pas configuré
    // via `getAlphaFromRGB`, rendait les étiquettes entièrement invisibles.
    mat.diffuseTexture = texture;
    mat.emissiveTexture = texture;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    gridLabelMatCache.set(text, mat);
    return mat;
  };
  const modelingGridLabels: GridLabel[] = [];
  const GRID_LABEL_WIDTH = 0.8;
  const GRID_LABEL_HEIGHT = 0.4;
  const makeGridTickLabel = (tileValue: number, axis: 'x' | 'z') => {
    const label = BABYLON.MeshBuilder.CreatePlane(
      // Proportions de la texture (128 × 64) ; la taille réelle est fixée par `layoutGridLabels`.
      `gridTick_${axis}_${tileValue}`, { width: GRID_LABEL_WIDTH, height: GRID_LABEL_HEIGHT }, scene,
    );
    // Face à la caméra : couché au sol, le chiffre était écrasé par l'angle de vue et devenait
    // illisible en vue rasante, même à taille constante. Il reste ancré à sa graduation.
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.renderingGroupId = 1; // par-dessus les lignes de grille
    label.setEnabled(false);
    modelingGridLabels.push({
      mesh: label, tileValue, axis, aspect: GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT,
    });
  };
  Object.assign(st, { getGridLabelMaterial, modelingGridLabels, GRID_LABEL_WIDTH, GRID_LABEL_HEIGHT,
    makeGridTickLabel });
}

function setupFormatGridValue(st: ViewportState) {
  const { GRID_TILE_EXTENT, drawGridLabel, gridLabelTextures, makeGridTickLabel, modelingGridAxisU, modelingGridAxisV, modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridGround, modelingGridLabels, scene } = st;
  // Une étiquette par unité de tuile (et non toutes les 10) : avec un pas `S` de 10 mm, la
  // graduation tombe ainsi tous les 10 mm. Les matériaux étant mutualisés par texte, ces
  // quelques centaines de plans ne coûtent qu'une poignée de textures.
  for (let k = 1; k <= GRID_TILE_EXTENT; k += 1) {
    makeGridTickLabel(k, 'x');
    makeGridTickLabel(-k, 'x');
    makeGridTickLabel(k, 'z');
    makeGridTickLabel(-k, 'z');
  }

  void document.fonts?.load('600 40px Oxanium').then(() => {
    if (scene.isDisposed) return;
    gridLabelTextures.forEach((texture, text) => drawGridLabel(texture, text));
  }).catch(() => { /* police indisponible : le repli sans-serif déjà dessiné reste lisible */ });

  const modelingGridMeshes = [
    modelingGridGround, modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridAxisU, modelingGridAxisV,
  ];
  const modelingGrid = [...modelingGridMeshes, ...modelingGridLabels.map((l) => l.mesh)];

  // Formate une graduation sans zéros parasites (250, 25, 2.5, 0.25 …).
  const formatGridValue = (v: number) => String(Number(v.toPrecision(6)));

  /**
   * Pas `S` des axes colorés et de leurs graduations chiffrées : on le veut compris entre
   * `GRID_MAJOR_MIN_PX` et 2,5×`GRID_MAJOR_MIN_PX` pixels à l'écran AU NIVEAU DE LA CIBLE — même seuil que
   * `uMinPx` dans le shader du quadrillage, pour que les nombres affichés restent cohérents
   * avec ce qu'on voit près du centre de l'écran (le quadrillage lui-même, lui, s'affine en
   * continu vers la caméra : cf. le commentaire sur `modelingGridGround` plus haut).
   */
  // Demi-étendue visée à l'entrée du mode modélisation, en mm : cadre une dizaine de
  // graduations de part et d'autre de l'origine, le pas restant à 10 mm.
  const GRID_DEFAULT_HALF_EXTENT_MM = 90;
  st.gridStepScale = 0; // 0 = jamais appliqué, force le premier passage
  Object.assign(st, { modelingGrid, formatGridValue, GRID_DEFAULT_HALF_EXTENT_MM });
}

function setupUpdateGrid(st: ViewportState) {
  const { GRID_LABEL_HEIGHT, GRID_LABEL_WIDTH, GRID_MAJOR_MIN_PX, GRID_MIN_STEP_EXPONENT, GRID_NICE_STEPS, formatGridValue, getGridLabelMaterial, gridLabelAspect, modelingGridAxisU, modelingGridAxisV, modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridLabels, modelingGridMat } = st;
  const updateGrid = (worldPerPixel: number) => {
    const wanted = GRID_MAJOR_MIN_PX * worldPerPixel;
    const decade = Math.pow(10, Math.floor(Math.log10(wanted)));
    let step = decade * 10;
    for (const k of GRID_NICE_STEPS) {
      if (decade * k >= wanted) { step = decade * k; break; }
    }
    step = Math.max(step, Math.pow(10, GRID_MIN_STEP_EXPONENT));
    if (step === st.gridStepScale) return;
    st.gridStepScale = step;
    modelingGridMat.setFloat("uStep", step);

    [modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridAxisU, modelingGridAxisV]
      .forEach((axisLine) => axisLine.scaling.setAll(step));
    modelingGridLabels.forEach((label) => {
      const text = formatGridValue(label.tileValue * step);
      label.mesh.material = getGridLabelMaterial(text);
      label.aspect = gridLabelAspect.get(text) ?? GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT;
    });
  };

  /**
   * Chiffres de taille CONSTANTE à l'écran. Dimensionnés en unités monde, ils rétrécissaient
   * avec la distance jusqu'à devenir du micro-texte au loin. On les met donc à l'échelle, à
   * chaque frame, de la taille monde d'un pixel à LEUR distance de la caméra. Des chiffres de
   * taille fixe se chevaucheraient là où les graduations se resserrent à l'écran (au loin, ou
   * sur un axe qui file vers l'horizon) : on n'y garde qu'une graduation sur 2, 10, 20… (valeurs
   * rondes), selon l'espacement réellement disponible à cet endroit.
   */
  const GRID_LABEL_PLANE_PX = 22; // hauteur du panneau à l'écran (glyphe ≈ 60 % de celle-ci)
  const GRID_LABEL_GAP_PX = 6; // marge entre deux chiffres, et entre un chiffre et son axe
  // Suite emboîtée (chaque pas divise le suivant) : une graduation affichée de loin le reste de
  // près, sans suites irrégulières (30, 35, 38, 40…) aux changements de pas. Même rythme que la
  // grille : division par 5 (×2) puis par 10.
  const GRID_LABEL_DECIMATIONS = [1, 2, 10, 20, 100];
  const labelAxisPoint = new BABYLON.Vector3();
  const labelNextPoint = new BABYLON.Vector3();
  const labelToCamera = new BABYLON.Vector3();
  const labelScreen = new BABYLON.Vector3();
  const labelNextScreen = new BABYLON.Vector3();
  Object.assign(st, { updateGrid, GRID_LABEL_PLANE_PX, GRID_LABEL_GAP_PX, GRID_LABEL_DECIMATIONS,
    labelAxisPoint, labelNextPoint, labelToCamera, labelScreen, labelNextScreen });
}

function setupLayoutGridLabels(st: ViewportState) {
  const { GRID_LABEL_DECIMATIONS, GRID_LABEL_GAP_PX, GRID_LABEL_HEIGHT, GRID_LABEL_PLANE_PX, GRID_LABEL_WIDTH, camera, engine, gridFrameInverse, gridFrameMatrix, gridTmpLocal, labelAxisPoint, labelNextPoint, labelNextScreen, labelScreen, labelToCamera, modelingGridLabels, scene } = st;
  const layoutGridLabels = () => {
    const step = st.gridStepScale;
    if (step <= 0) return;
    const renderW = engine.getRenderWidth();
    const renderH = engine.getRenderHeight();
    const pixelsPerWorldAtUnitDistance = renderH / (2 * Math.tan(camera.fov / 2));
    // Tout le calcul se fait dans le repère local de la grille (positions des graduations) ;
    // la caméra y est ramenée, et la projection écran applique la matrice du repère.
    const camPos = BABYLON.Vector3.TransformCoordinates(camera.globalPosition, gridFrameInverse);
    const transform = scene.getTransformMatrix();
    const viewport = camera.viewport.toGlobal(renderW, renderH);
    const identity = gridFrameMatrix;
    const planeH = GRID_LABEL_PLANE_PX;
    // Écart à l'écran (px) entre les graduations de rang `rank` et `rank + 1` d'un axe, mis en
    // cache par frame : chaque bloc le demande pour ses deux bornes.
    const spacingCache = new Map<string, number>();
    const spacingPxAt = (axis: 'x' | 'z', rank: number) => {
      const key = `${axis}${rank}`;
      const cached = spacingCache.get(key);
      if (cached !== undefined) return cached;
      const a = rank * step;
      const b = (rank + 1) * step;
      labelAxisPoint.set(axis === 'x' ? a : 0, 0, axis === 'z' ? a : 0);
      labelNextPoint.set(axis === 'x' ? b : 0, 0, axis === 'z' ? b : 0);
      BABYLON.Vector3.ProjectToRef(labelAxisPoint, identity, transform, viewport, labelScreen);
      BABYLON.Vector3.ProjectToRef(labelNextPoint, identity, transform, viewport, labelNextScreen);
      const px = Math.hypot(labelNextScreen.x - labelScreen.x, labelNextScreen.y - labelScreen.y);
      spacingCache.set(key, px);
      return px;
    };
    modelingGridLabels.forEach(({ mesh, tileValue, axis, aspect }) => {
      const planeW = planeH * aspect;
      const along = tileValue * step;
      labelAxisPoint.set(axis === 'x' ? along : 0, 0, axis === 'z' ? along : 0);
      camPos.subtractToRef(labelAxisPoint, labelToCamera);
      // Orthographique : même échelle partout, celle du rayon d'orbite.
      const distance = st.orthoActive ? camera.radius : labelToCamera.length();
      if (distance <= 0) { mesh.isVisible = false; return; }
      const worldPerPixel = distance / pixelsPerWorldAtUnitDistance;
      // Écart RÉEL à l'écran avec la graduation suivante (vers l'extérieur), perspective
      // comprise : un axe qui file vers l'horizon resserre ses graduations bien plus vite que
      // ne le dit la seule distance.
      const next = along + Math.sign(tileValue) * step;
      labelNextPoint.set(axis === 'x' ? next : 0, 0, axis === 'z' ? next : 0);
      BABYLON.Vector3.ProjectToRef(labelAxisPoint, identity, transform, viewport, labelScreen);
      BABYLON.Vector3.ProjectToRef(labelNextPoint, identity, transform, viewport, labelNextScreen);
      const dx = labelNextScreen.x - labelScreen.x;
      const dy = labelNextScreen.y - labelScreen.y;
      const spacingPx = Math.hypot(dx, dy);
      // Place qu'occupe un chiffre (boîte W × H face caméra) dans la direction de l'axe à
      // l'écran ; le glyphe n'occupe qu'une partie du panneau.
      const footprintPx = spacingPx > 1e-6
        ? (Math.abs(dx) * planeW + Math.abs(dy) * planeH) / spacingPx
        : planeW;
      const needed = footprintPx * 0.6 + GRID_LABEL_GAP_PX;
      // Pas choisi PAR BLOC, pas par étiquette (cf. labelDecimation).
      const decimation = labelDecimation(tileValue, needed, GRID_LABEL_DECIMATIONS, (rank) => spacingPxAt(axis, rank));
      const visible = isLabelVisible(tileValue, decimation);
      mesh.isVisible = visible;
      if (!visible) return;
      const scaleY = (planeH * worldPerPixel) / GRID_LABEL_HEIGHT;
      // Le panneau de base a le rapport GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT : on l'étire en X
      // pour épouser celui de la texture du texte, sans le déformer.
      mesh.scaling.set(scaleY * aspect / (GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT), scaleY, scaleY);
      // Décalé perpendiculairement à l'axe (dans le sol), juste assez pour ne pas le recouvrir.
      const offset = (planeH * 0.9 + GRID_LABEL_GAP_PX) * worldPerPixel;
      gridTmpLocal.set(axis === 'x' ? along : offset, 0, axis === 'z' ? along : offset);
      BABYLON.Vector3.TransformCoordinatesToRef(gridTmpLocal, gridFrameMatrix, mesh.position);
    });
  };
  Object.assign(st, { layoutGridLabels });
}

function setupGridAnchorX(st: ViewportState) {
  /**
   * Place le plan du quadrillage et fixe l'origine de son motif.
   *
   * Deux rôles, découplés :
   *  - le PLAN (géométrie) est recentré sur la cible et mis à l'échelle du rayon caméra à
   *    chaque frame, pour couvrir le sol visible avec des sommets toujours proches du champ
   *    (précision d'interpolation, cf. le vertex shader) ;
   *  - le MOTIF est calculé relativement à une ANCRE (`gridAnchorX/Z`), qui ne bouge que
   *    rarement, par sauts multiples exacts d'une puissance de dix bien plus grande que tout
   *    pas affiché : translater le motif d'un multiple exact de son pas ne déplace aucun
   *    trait. `uOffset` = cible − ancre, calculé ici en double précision, reste petit — c'est
   *    lui (et non une position monde absolue) qui entre dans le shader.
   */
  st.gridAnchorX = 0;
  st.gridAnchorZ = 0;
  // Nombre de pas centraux que la cible peut parcourir avant ré-ancrage : grand pour que ce
  // soit rare, borné pour que `uOffset / pas` reste bien dans la précision float32.
  const GRID_RECENTER_MARGIN_STEPS = 200;
  // Période d'ancrage : 5 décades au-dessus du pas central, pour couvrir les pixels lointains
  // qui, en perspective, affichent localement un pas bien plus grossier (cf. shader).
  const GRID_ANCHOR_PERIOD_STEPS = 100000;
  Object.assign(st, { GRID_RECENTER_MARGIN_STEPS, GRID_ANCHOR_PERIOD_STEPS });
}

function setupRecenterGridGround(st: ViewportState) {
  const { GRID_ANCHOR_PERIOD_STEPS, GRID_MIN_STEP_EXPONENT, GRID_RECENTER_MARGIN_STEPS, GRID_TILE_EXTENT, camera, engine, gridFrameInverse, gridFrameMatrix, gridFrameQuat, gridTmpLocal, modelingGridAxisU, modelingGridAxisV, modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridGround, modelingGridMat } = st;
  const recenterGridGround = () => {
    const step = Math.max(st.gridStepScale, Math.pow(10, GRID_MIN_STEP_EXPONENT));
    const margin = GRID_RECENTER_MARGIN_STEPS * step;
    // Cible dans le repère local de la grille.
    const targetLocal = BABYLON.Vector3.TransformCoordinates(camera.target, gridFrameInverse);
    if (Math.abs(targetLocal.x - st.gridAnchorX) > margin || Math.abs(targetLocal.z - st.gridAnchorZ) > margin) {
      const period = step * GRID_ANCHOR_PERIOD_STEPS;
      st.gridAnchorX = Math.round(targetLocal.x / period) * period;
      st.gridAnchorZ = Math.round(targetLocal.z / period) * period;
    }
    // Carré fini, comme dans Fusion : demi-côté = GRID_TILE_EXTENT pas (soit la portée des axes
    // et des chiffres), donc il change de taille (×10) à chaque changement d'échelle de grille.
    // Son centre est calé sur un multiple de 10 pas proche de la cible : il ne glisse pas
    // en continu avec le panoramique et reste centré sur l'origine tant qu'on y regarde.
    const scale = GRID_TILE_EXTENT * step;
    const snap = 10 * step;
    const centerX = Math.round(targetLocal.x / snap) * snap;
    const centerZ = Math.round(targetLocal.z / snap) * snap;
    gridTmpLocal.set(centerX, 0, centerZ);
    BABYLON.Vector3.TransformCoordinatesToRef(gridTmpLocal, gridFrameMatrix, modelingGridGround.position);
    modelingGridGround.rotationQuaternion = gridFrameQuat;
    modelingGridGround.scaling.set(scale, 1, scale);
    modelingGridMat.setFloat("uScale", scale);
    modelingGridMat.setFloat(
      "uTargetWpp", (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight(),
    );
    modelingGridMat.setVector2(
      "uOffset", new BABYLON.Vector2(centerX - st.gridAnchorX, centerZ - st.gridAnchorZ),
    );
    modelingGridMat.setVector2("uAxisOrigin", new BABYLON.Vector2(-st.gridAnchorX, -st.gridAnchorZ));
  };

  const applyGridAxisVisibility = () => {
    if (!st.modelingActive) return;
    const p = st.gridStandardPlane;
    modelingGridAxisX.setEnabled(p === 'XZ' || p === 'XY');
    modelingGridAxisY.setEnabled(p === 'XY' || p === 'YZ');
    modelingGridAxisZ.setEnabled(p === 'XZ' || p === 'YZ');
    modelingGridAxisU.setEnabled(p === null);
    modelingGridAxisV.setEnabled(p === null);
  };
  Object.assign(st, { recenterGridGround, applyGridAxisVisibility });
}

function setupSetGridFrame(st: ViewportState) {
  const { applyGridAxisVisibility, gridFrameInverse, gridFrameMatrix, gridFrameOrigin, gridFrameQuat, gridNormal, modelingGridAxisU, modelingGridAxisV, modelingGridGround } = st;
  /**
   * Aligne la grille sur un plan : `ex` / `ez` = axes locaux x / z, `ey` = normale (repère
   * direct : ex x ey = ez). Les axes colorés du monde ne sont affichés que s'ils reposent dans
   * le plan (plans principaux) ; sinon des axes locaux gris. L'ancre du motif est recalculée.
   */
  const setGridFrame = (
    origin: BABYLON.Vector3, ex: BABYLON.Vector3, ey: BABYLON.Vector3, ez: BABYLON.Vector3,
    standard: GridStandardPlane | null,
  ) => {
    const m = new BABYLON.Matrix();
    BABYLON.Matrix.FromXYZAxesToRef(ex, ey, ez, m);
    BABYLON.Quaternion.FromRotationMatrixToRef(m, gridFrameQuat);
    gridFrameOrigin.copyFrom(origin);
    BABYLON.Matrix.ComposeToRef(BABYLON.Vector3.One(), gridFrameQuat, gridFrameOrigin, gridFrameMatrix);
    gridFrameMatrix.invertToRef(gridFrameInverse);
    gridNormal.copyFrom(ey).normalize();
    st.gridStandardPlane = standard;
    st.gridAnchorX = Number.POSITIVE_INFINITY;
    st.gridAnchorZ = Number.POSITIVE_INFINITY;
    modelingGridGround.rotationQuaternion = gridFrameQuat;
    [modelingGridAxisU, modelingGridAxisV].forEach((axisLine) => {
      axisLine.rotationQuaternion = gridFrameQuat;
      axisLine.position.copyFrom(gridFrameOrigin);
    });
    applyGridAxisVisibility();
  };
  const setGridStandardPlane = (plane: GridStandardPlane) => {
    const X = new BABYLON.Vector3(1, 0, 0);
    const Y = new BABYLON.Vector3(0, 1, 0);
    const Z = new BABYLON.Vector3(0, 0, 1);
    const zero = BABYLON.Vector3.Zero();
    if (plane === 'XZ') setGridFrame(zero, X, Y, Z, 'XZ');
    else if (plane === 'XY') setGridFrame(zero, X, Z.scale(-1), Y, 'XY'); // x = X, z = Y
    else setGridFrame(zero, Z, X, Y, 'YZ'); // x = Z, z = Y
  };
  st.setGridStandardPlane = setGridStandardPlane;
  Object.assign(st, { setGridFrame });
}

export function setupViewportGrid(st: ViewportState) {
  setupMakeScreenLine(st);
  setupMakeGridLines(st);
  setupModelingGridAxisU(st);
  setupGridPart4();
  setupModelingGridGround(st);
  setupDrawGridLabel(st);
  setupGetGridLabelMaterial(st);
  setupFormatGridValue(st);
  setupUpdateGrid(st);
  setupLayoutGridLabels(st);
  setupGridAnchorX(st);
  setupRecenterGridGround(st);
  setupSetGridFrame(st);
}
