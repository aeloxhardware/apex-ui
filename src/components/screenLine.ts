import * as BABYLON from 'babylonjs';

/**
 * Trait d'épaisseur CONSTANTE en pixels écran, quelle que soit la distance : ni plus fin au loin ni
 * plus épais de près (les lignes WebGL font 1 px ; GreasedLine, même sans `sizeAttenuation`, varie
 * encore avec la profondeur le long d'un même trait).
 *
 * Ruban dont chaque sommet est décalé dans l'espace écran, avec jointure en onglet (miter) bornée,
 * et un bord adouci sur ~1 px. L'opacité se règle par `mesh.material.alpha`, relue à chaque rendu.
 */
const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 prevPoint;
attribute vec3 nextPoint;
attribute float side;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform vec2 resolution;
uniform float halfWidth;
varying float vSide;
varying float vHalf;

vec2 safeDir(vec2 d, vec2 fallback) {
  float l = length(d);
  return l > 1e-5 ? d / l : fallback;
}

// Direction écran de la droite portée par \`d\` (3D) en \`pos\`. Projeter deux voisins distants de
// moins d'un pixel donnerait du bruit numérique (d'où des épaisseurs qui varient) : on projette
// la droite sur une longueur proportionnelle à la profondeur, donc toujours de plusieurs pixels.
vec2 screenDir(vec3 pos, vec3 d, float w, vec2 half_res, vec2 fallback) {
  // \`d\` est en repère local : si le maillage est mis à l'échelle (axes de la grille), la longueur
  // monde parcourue serait multipliée d'autant et le point projeté passerait derrière la caméra
  // pour un trait pointant vers elle. On divise donc par l'échelle le long de \`d\`.
  float L = w * 0.3 / max(length((world * vec4(d, 0.0)).xyz), 1e-12);
  vec4 a = worldViewProjection * vec4(pos + d * L, 1.0);
  vec4 b = worldViewProjection * vec4(pos - d * L, 1.0);
  if (a.w < 1e-4 || b.w < 1e-4) return fallback;
  return safeDir(a.xy / a.w * half_res - b.xy / b.w * half_res, fallback);
}

void main() {
  vec4 c = worldViewProjection * vec4(position, 1.0);
  if (c.w < 1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vSide = 0.0; vHalf = halfWidth; return; }
  vec2 half_res = resolution * 0.5;
  vec2 sc = c.xy / c.w * half_res;
  vec3 toNext = nextPoint - position;
  vec3 fromPrev = position - prevPoint;
  bool hasNext = dot(toNext, toNext) > 1e-12;
  bool hasPrev = dot(fromPrev, fromPrev) > 1e-12;
  vec3 dn = hasNext ? normalize(toNext) : (hasPrev ? normalize(fromPrev) : vec3(1.0, 0.0, 0.0));
  vec3 dp = hasPrev ? normalize(fromPrev) : dn;
  vec2 d2 = screenDir(position, dn, c.w, half_res, vec2(1.0, 0.0));
  vec2 d1 = screenDir(position, dp, c.w, half_res, d2);
  vec2 tangent = safeDir(d1 + d2, d2);
  vec2 miter = vec2(-tangent.y, tangent.x);
  vec2 normal1 = vec2(-d1.y, d1.x);
  // Onglet borné : un angle très vif ne doit pas projeter une longue pointe.
  float scale = 1.0 / max(dot(miter, normal1), 0.35);
  vec2 offset = miter * side * halfWidth * scale;
  vec2 ndc = (sc + offset) / half_res;
  gl_Position = vec4(ndc * c.w, c.z, c.w);
  vSide = side;
  vHalf = halfWidth;
}`;

const FRAGMENT = `
precision highp float;
uniform vec3 color;
uniform float alpha;
varying float vSide;
varying float vHalf;
void main() {
  // Le ruban déborde de 0,5 px de chaque côté : bord adouci sur 1 px.
  float distPx = abs(vSide) * vHalf;
  float edge = clamp(vHalf - distPx, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha * edge);
}`;

BABYLON.Effect.ShadersStore['screenLineVertexShader'] = VERTEX;
BABYLON.Effect.ShadersStore['screenLineFragmentShader'] = FRAGMENT;

export interface ScreenLineOptions {
  /** Décalage de profondeur vers la caméra (défaut -4) ; 0 pour un trait qui doit rester occulté par une surface voisine. */
  zOffset?: number;
}

export function createScreenLine(
  scene: BABYLON.Scene,
  name: string,
  points: BABYLON.Vector3[],
  color: BABYLON.Color3,
  widthPx: number,
  alpha = 1,
  options: ScreenLineOptions = {},
): BABYLON.Mesh {
  return createScreenLines(scene, name, [points], color, widthPx, alpha, options);
}

/** Plusieurs polylignes (disjointes ou fermées) dans un seul maillage. */
export function createScreenLines(
  scene: BABYLON.Scene,
  name: string,
  polylines: BABYLON.Vector3[][],
  color: BABYLON.Color3,
  widthPx: number,
  alpha = 1,
  options: ScreenLineOptions = {},
): BABYLON.Mesh {
  const positions: number[] = [];
  const previous: number[] = [];
  const nextArr: number[] = [];
  const side: number[] = [];
  const indices: number[] = [];
  for (const points of polylines) {
    const n = points.length;
    if (n < 2) continue;
    // Contour fermé : dernier point = premier (déjà dupliqué par l'appelant).
    const closed = n > 2 && BABYLON.Vector3.DistanceSquared(points[0], points[n - 1]) < 1e-10;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const cur = points[i];
      const prev = i > 0 ? points[i - 1] : closed ? points[n - 2] : cur;
      const nxt = i < n - 1 ? points[i + 1] : closed ? points[1] : cur;
      for (const s of [-1, 1]) {
        positions.push(cur.x, cur.y, cur.z);
        previous.push(prev.x, prev.y, prev.z);
        nextArr.push(nxt.x, nxt.y, nxt.z);
        side.push(s);
      }
      if (i < n - 1) {
        const a = base + 2 * i;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const mesh = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  // Attributs propres APRÈS applyToMesh : posés sur un maillage encore vide, le premier était perdu
  // silencieusement, et `VertexData.set` ignore les types inconnus.
  mesh.setVerticesData('prevPoint', previous, false, 3);
  mesh.setVerticesData('nextPoint', nextArr, false, 3);
  mesh.setVerticesData('side', side, false, 1);

  const mat = new BABYLON.ShaderMaterial(
    `${name}Mat`,
    scene,
    { vertex: 'screenLine', fragment: 'screenLine' },
    {
      attributes: ['position', 'prevPoint', 'nextPoint', 'side'],
      uniforms: ['worldViewProjection', 'world', 'resolution', 'halfWidth', 'color', 'alpha'],
      needAlphaBlending: true,
    },
  );
  mat.backFaceCulling = false;
  // Posé à fleur d'un maillage (bouton, plateau) : sans décalage de profondeur vers la caméra, le
  // ruban vu de biais perd des morceaux par z-fighting.
  mat.zOffset = options.zOffset ?? -4;
  mat.zOffsetUnits = options.zOffset ?? -4;
  mat.alpha = alpha;
  mat.alphaMode = BABYLON.Constants.ALPHA_COMBINE;
  const engine = scene.getEngine();
  mat.onBindObservable.add(() => {
    const effect = mat.getEffect();
    if (!effect) return;
    effect.setFloat2('resolution', engine.getRenderWidth(), engine.getRenderHeight());
    effect.setFloat('halfWidth', widthPx / 2 + 0.5);
    effect.setColor3('color', color);
    effect.setFloat('alpha', mat.alpha);
  });
  mesh.material = mat;
  mesh.isPickable = false;
  // Le ruban est décalé dans l'espace écran : sa boîte englobante monde n'en tient pas compte.
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}
