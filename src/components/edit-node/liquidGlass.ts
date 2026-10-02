/**
 * Rendu « Liquid Glass » des nœuds d'édition, en WebGL2, à la pleine résolution de l'écran.
 *
 * Remplace le filtre SVG en backdrop-filter : Chromium y échantillonne le fond au plus proche
 * voisin, d'où une pixellisation dès que le verre agrandit le fond (mesuré en capture). Ici, le
 * fond est une texture lue avec interpolation bilinéaire, et la lentille est calculée exactement
 * en chaque pixel.
 *
 * Pipeline : fond -> flou gaussien vertical -> horizontal -> passe principale (pour chaque pixel :
 * distance signée au bord des lentilles, réfraction de Snell, dispersion, Fresnel, reflet).
 * Les lentilles sont des cercles donnés en pixels CSS, avec une intensité 0..1 (fondu pendant le
 * gonflement du nœud).
 *
 * Shaders adaptés de « Liquid Glass Studio » (https://github.com/iyinchao/liquid-glass-studio),
 * fragment-main.glsl / fragment-bg-*blur.glsl / lib/color.glsl, simplifiés pour des cercles :
 *
 *   MIT License — Copyright (c) 2024 Charles Yin
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *   and associated documentation files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions: The above copyright
 *   notice and this permission notice shall be included in all copies or substantial portions of
 *   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 *   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 *   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 *   IN THE SOFTWARE.
 *
 * Conversions LCH reprises par ce projet de
 * https://github.com/Rachmanin0xFF/GLSL-Color-Functions.
 */

/** Traction d'une poignée sur le verre : le bord s'étire vers elle. */
export interface GlassPull {
  /** Direction unitaire, repère écran (y vers le bas). */
  dx: number;
  dy: number;
  /** Allongement relatif du rayon dans cette direction (négatif : creux). */
  stretch: number;
}

export interface GlassLens {
  /** Centre, en pixels CSS dans le repère du canevas. */
  x: number;
  y: number;
  /** Rayon, en pixels CSS. */
  radius: number;
  /** 0 : invisible, 1 : verre complet. */
  strength: number;
  pulls?: GlassPull[];
  /** Portée de fusion avec les lentilles voisines, px CSS (absent : réglage global). */
  mergePx?: number;
}

/** Réglages du verre, mêmes noms et unités que Liquid Glass Studio sauf mention contraire. */
export interface GlassParams {
  /** Épaisseur de la zone qui réfracte, en fraction du rayon (Studio : en px). */
  thickness: number;
  /** Indice de réfraction. */
  refractiveIndex: number;
  /** Déplacement maximal du fond, en fraction du rayon. */
  distance: number;
  dispersion: number;
  fresnelRange: number;
  fresnelHardness: number;
  fresnelFactor: number;
  glareRange: number;
  glareHardness: number;
  glareFactor: number;
  glareConvergence: number;
  glareOppositeFactor: number;
  /** Degrés. */
  glareAngle: number;
  /** Flou du fond vu à travers le verre, en pixels CSS (écart type). */
  blurPx: number;
  /** Ombre portée (suit la forme étirée) : opacité, décalage vers le bas et flou en px CSS. */
  shadowOpacity: number;
  shadowOffsetPx: number;
  shadowBlurPx: number;
  /** Portée de la fusion lisse entre lentilles voisines, en px CSS. */
  mergePx: number;
}

export const DEFAULT_GLASS: GlassParams = {
  thickness: 0.85,
  refractiveIndex: 1.4,
  distance: 0.55,
  dispersion: 7,
  fresnelRange: 30,
  fresnelHardness: 0.2,
  fresnelFactor: 0.2,
  glareRange: 30,
  glareHardness: 0.2,
  glareFactor: 0.9,
  glareConvergence: 0.5,
  glareOppositeFactor: 0.8,
  glareAngle: -45,
  blurPx: 0.55,
  shadowOpacity: 0.45,
  shadowOffsetPx: 8,
  shadowBlurPx: 10,
  mergePx: 12,
};

export const MAX_LENSES = 8;
export const MAX_PULLS = 8;
const MAX_BLUR_TAPS = 32;

const VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const COPY = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, v_uv); }`;

// Flou gaussien séparable (une direction par passe).
const BLUR = `#version 300 es
precision highp float;
#define MAX_TAPS ${MAX_BLUR_TAPS}
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform int u_taps;
uniform float u_weights[MAX_TAPS + 1];
out vec4 fragColor;
void main() {
  vec4 color = texture(u_tex, v_uv) * u_weights[0];
  for (int i = 1; i <= MAX_TAPS; ++i) {
    if (i > u_taps) break;
    vec2 o = u_step * float(i);
    color += (texture(u_tex, v_uv + o) + texture(u_tex, v_uv - o)) * u_weights[i];
  }
  fragColor = color;
}`;

const MAIN = `#version 300 es
precision highp float;
#define PI 3.14159265359
#define MAX_LENSES ${MAX_LENSES}
#define MAX_PULLS ${MAX_PULLS}
const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
uniform sampler2D u_bg;
uniform sampler2D u_blurredBg;
uniform vec2 u_resolution;   // pixels physiques
uniform float u_dpr;
uniform int u_lensCount;
uniform vec4 u_lenses[MAX_LENSES]; // centre (px physiques, y vers le haut), rayon (px phys.), intensité
uniform vec4 u_pulls[MAX_LENSES * MAX_PULLS]; // direction (y vers le haut), allongement, -
uniform float u_shadowOpacity;
uniform float u_shadowOffset; // px physiques
uniform float u_shadowBlur;   // px physiques
uniform float u_merge;        // px physiques
uniform float u_lensMerge[MAX_LENSES]; // portée de fusion propre à une lentille (0 : u_merge)
uniform float u_thickness;
uniform float u_refFactor;
uniform float u_distance;
uniform float u_dispersion;
uniform float u_fresnelRange;
uniform float u_fresnelHardness;
uniform float u_fresnelFactor;
uniform float u_glareRange;
uniform float u_glareHardness;
uniform float u_glareFactor;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareAngle;
out vec4 fragColor;

float safeAsin(float x) { return asin(clamp(x, -1.0, 1.0)); }

const vec3 WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
const mat3 RGB_TO_XYZ_M = mat3(0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505);
const mat3 XYZ_TO_RGB_M = mat3(3.2406255, -1.537208, -0.4986286, -0.9689307, 1.8757561, 0.0415175, 0.0557101, -0.2040211, 1.0569959);
float uncompand(float a) { return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92; }
float compand(float a) { return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055; }
float labF(float x) { return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448; }
float labFInv(float x) { return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034); }
vec3 srgbToLch(vec3 c) {
  vec3 xyz = vec3(uncompand(c.x), uncompand(c.y), uncompand(c.z)) * RGB_TO_XYZ_M / WHITE;
  xyz = vec3(labF(xyz.x), labF(xyz.y), labF(xyz.z));
  vec3 lab = vec3(116.0 * xyz.y - 16.0, 500.0 * (xyz.x - xyz.y), 200.0 * (xyz.y - xyz.z));
  return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y) * 57.2957795131);
}
vec3 lchToSrgb(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z * 0.01745329251), lch.y * sin(lch.z * 0.01745329251));
  float w = (lab.x + 16.0) / 116.0;
  vec3 xyz = WHITE * vec3(labFInv(w + lab.y / 500.0), labFInv(w), labFInv(w - lab.z / 200.0));
  vec3 rgb = xyz * XYZ_TO_RGB_M;
  return vec3(compand(rgb.x), compand(rgb.y), compand(rgb.z));
}

vec4 sampleDispersion(vec2 offset) {
  float f = u_dispersion;
  vec2 oR = offset * (1.0 - (N_R - 1.0) * f);
  vec2 oG = offset * (1.0 - (N_G - 1.0) * f);
  vec2 oB = offset * (1.0 - (N_B - 1.0) * f);
  return vec4(texture(u_blurredBg, v_uv + oR).r, texture(u_blurredBg, v_uv + oG).g, texture(u_blurredBg, v_uv + oB).b, 1.0);
}

// Distance signée (approchée) au bord de la lentille i : un cercle dont le rayon s'allonge en lobes
// lisses vers chaque poignée qui tire. Exacte pour un cercle, bonne pour les faibles étirements.
float lensSd(vec2 p, int i) {
  vec4 L = u_lenses[i];
  vec2 d = p - L.xy;
  float len = length(d);
  vec2 n = d / max(len, 1e-4);
  float k = 1.0;
  for (int j = 0; j < MAX_PULLS; ++j) {
    vec4 P = u_pulls[i * MAX_PULLS + j];
    if (P.z == 0.0) continue;
    k += P.z * pow(max(dot(n, P.xy), 0.0), 6.0);
  }
  return len - L.z * k;
}

// Union lisse : deux lentilles proches se rejoignent par un pont de verre (gouttes qui fusionnent).
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sceneSd(vec2 p) {
  float sd = 1e9;
  for (int i = 0; i < MAX_LENSES; ++i) {
    if (i >= u_lensCount) break;
    float k = u_lensMerge[i] > 0.0 ? u_lensMerge[i] : u_merge;
    sd = smin(sd, lensSd(p, i), k);
  }
  return sd;
}

float shadowAt(vec2 p, float offset, float blur) {
  return 1.0 - smoothstep(-blur, blur, sceneSd(p + vec2(0.0, offset)));
}

void main() {
  vec4 bg = texture(u_bg, v_uv);
  vec2 p = gl_FragCoord.xy;

  // Lentille la plus proche : porte rayon (épaisseur) et intensité ; la forme est l'union lisse.
  float nearest = 1e9;
  int best = -1;
  for (int i = 0; i < MAX_LENSES; ++i) {
    if (i >= u_lensCount) break;
    float d = lensSd(p, i);
    if (d < nearest) { nearest = d; best = i; }
  }
  if (best < 0) { fragColor = bg; return; }
  vec4 lens = u_lenses[best];
  float sd = sceneSd(p);

  // Ombre portée de la forme étirée : large et douce + ombre de contact serrée.
  float a1 = u_shadowOpacity * shadowAt(p, u_shadowOffset, u_shadowBlur);
  float a2 = u_shadowOpacity * 0.7 * shadowAt(p, u_shadowOffset * 0.3, u_shadowBlur * 0.3);
  float shadow = (1.0 - (1.0 - a1) * (1.0 - a2)) * lens.w;
  vec4 base = vec4(bg.rgb * (1.0 - shadow), 1.0);
  if (lens.w <= 0.0 || sd > 1.0) { fragColor = base; return; }

  // Normale de la forme déformée (gradient par différences centrées).
  vec2 g = vec2(sceneSd(p + vec2(1.0, 0.0)) - sceneSd(p - vec2(1.0, 0.0)),
                sceneSd(p + vec2(0.0, 1.0)) - sceneSd(p - vec2(0.0, 1.0)));
  vec2 normal = normalize(g + vec2(1e-6));
  float inside = max(-sd, 0.0);               // profondeur dans le verre, px physiques
  float thickness = max(u_thickness * lens.z, 1.0);

  // Réfraction (Snell) : nulle au-delà de l'épaisseur, maximale au bord.
  float x = 1.0 - inside / thickness;
  float thetaI = safeAsin(x * x);
  float thetaT = safeAsin(sin(thetaI) / u_refFactor);
  float edgeFactor = inside >= thickness ? 0.0 : -tan(thetaT - thetaI);

  vec2 offsetPx = -normal * edgeFactor * u_distance * lens.z;
  vec4 glass = sampleDispersion(offsetPx / u_resolution);

  // Fresnel : liseré clair au bord (distances en px CSS, comme le Studio).
  float dCss = -inside / u_dpr;
  float fresnel = clamp(pow(1.0 + dCss / 1500.0 * pow(500.0 / u_fresnelRange, 2.0) + u_fresnelHardness, 5.0), 0.0, 1.0);
  vec3 fresnelLch = vec3(100.0, 0.0, 0.0);
  glass = mix(glass, vec4(lchToSrgb(fresnelLch), 1.0), fresnel * u_fresnelFactor * 0.7);

  // Reflet directionnel.
  float glareGeo = clamp(pow(1.0 + dCss / 1500.0 * pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0), 0.0, 1.0);
  float a = atan(normal.y, normal.x);
  if (a < 0.0) a += 2.0 * PI;
  float glareAngle = (a - PI / 4.0 + u_glareAngle) * 2.0;
  bool farSide = (glareAngle > PI * 1.5 && glareAngle < PI * 3.5) || glareAngle < -PI * 0.5;
  float glareF = (0.5 + sin(glareAngle) * 0.5) * (farSide ? 1.2 * u_glareOppositeFactor : 1.2) * u_glareFactor;
  glareF = clamp(pow(glareF, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);
  vec3 glareLch = srgbToLch(glass.rgb);
  glareLch.x = clamp(glareLch.x + 150.0 * glareF * glareGeo, 0.0, 120.0);
  glareLch.y += 30.0 * glareF * glareGeo;
  glass = mix(glass, vec4(clamp(lchToSrgb(glareLch), 0.0, 1.0), 1.0), glareF * glareGeo);

  // Bord anticrénelé sur ~1 px physique, et fondu pendant le gonflement.
  float coverage = 1.0 - smoothstep(-0.75, 0.75, sd);
  fragColor = mix(base, glass, coverage * lens.w);
}`;

function gaussianWeights(sigmaPx: number): { taps: number; weights: Float32Array } {
  const weights = new Float32Array(MAX_BLUR_TAPS + 1);
  if (!(sigmaPx > 0.05)) {
    weights[0] = 1;
    return { taps: 0, weights };
  }
  const taps = Math.min(MAX_BLUR_TAPS, Math.ceil(sigmaPx * 3));
  let sum = 0;
  for (let i = 0; i <= taps; i++) {
    weights[i] = Math.exp((-0.5 * i * i) / (sigmaPx * sigmaPx));
    sum += i === 0 ? weights[i] : 2 * weights[i];
  }
  for (let i = 0; i <= taps; i++) weights[i] /= sum;
  return { taps, weights };
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export class LiquidGlassRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly copy: WebGLProgram;
  private readonly blur: WebGLProgram;
  private readonly main: WebGLProgram;
  private readonly bgTexture: WebGLTexture;
  private targets: [Target, Target] | null = null;
  private width = 0;
  private height = 0;
  private readonly lensData = new Float32Array(MAX_LENSES * 4);
  private readonly pullData = new Float32Array(MAX_LENSES * MAX_PULLS * 4);
  private readonly mergeData = new Float32Array(MAX_LENSES);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 indisponible.');
    this.gl = gl;
    this.copy = this.program(COPY);
    this.blur = this.program(BLUR);
    this.main = this.program(MAIN);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bgTexture = this.texture();
  }

  private program(fragment: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    return program;
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Taille du canevas en pixels physiques (à appeler au redimensionnement). */
  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.gl;
    for (const t of this.targets ?? []) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    const make = (): Target => {
      const texture = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, framebuffer };
    };
    this.targets = [make(), make()];
  }

  /** Fond à réfracter, à la taille du canevas (pixels physiques). */
  setBackground(source: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  render(lenses: GlassLens[], dpr: number, params: GlassParams = DEFAULT_GLASS) {
    const gl = this.gl;
    if (!this.targets || this.width === 0) return;
    const [a, b] = this.targets;
    gl.viewport(0, 0, this.width, this.height);

    // Flou du fond : vertical vers a, horizontal vers b.
    const { taps, weights } = gaussianWeights(params.blurPx * dpr);
    gl.useProgram(this.blur);
    gl.uniform1i(gl.getUniformLocation(this.blur, 'u_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(this.blur, 'u_taps'), taps);
    gl.uniform1fv(gl.getUniformLocation(this.blur, 'u_weights'), weights);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.uniform2f(gl.getUniformLocation(this.blur, 'u_step'), 0, 1 / this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, a.texture);
    gl.uniform2f(gl.getUniformLocation(this.blur, 'u_step'), 1 / this.width, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Passe principale vers l'écran.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const visible = lenses.filter((l) => l.strength > 0 && l.radius > 0);
    if (visible.length === 0) {
      gl.useProgram(this.copy);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
      gl.uniform1i(gl.getUniformLocation(this.copy, 'u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    const p = this.main;
    gl.useProgram(p);
    const u = (name: string) => gl.getUniformLocation(p, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.uniform1i(u('u_bg'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b.texture);
    gl.uniform1i(u('u_blurredBg'), 1);
    gl.activeTexture(gl.TEXTURE0);

    const count = Math.min(MAX_LENSES, visible.length);
    for (let i = 0; i < count; i++) {
      const l = visible[i];
      this.lensData[4 * i] = l.x * dpr;
      this.lensData[4 * i + 1] = this.height - l.y * dpr;
      this.lensData[4 * i + 2] = l.radius * dpr;
      this.lensData[4 * i + 3] = l.strength;
      this.mergeData[i] = (l.mergePx ?? 0) * dpr;
      for (let j = 0; j < MAX_PULLS; j++) {
        const pull = l.pulls?.[j];
        const o = 4 * (i * MAX_PULLS + j);
        this.pullData[o] = pull?.dx ?? 0;
        this.pullData[o + 1] = -(pull?.dy ?? 0);
        this.pullData[o + 2] = pull?.stretch ?? 0;
        this.pullData[o + 3] = 0;
      }
    }
    gl.uniform4fv(u('u_lenses'), this.lensData);
    gl.uniform4fv(u('u_pulls'), this.pullData);
    gl.uniform1fv(u('u_lensMerge'), this.mergeData);
    gl.uniform1f(u('u_shadowOpacity'), params.shadowOpacity);
    gl.uniform1f(u('u_shadowOffset'), params.shadowOffsetPx * dpr);
    gl.uniform1f(u('u_shadowBlur'), params.shadowBlurPx * dpr);
    gl.uniform1f(u('u_merge'), Math.max(params.mergePx * dpr, 1e-3));
    gl.uniform1i(u('u_lensCount'), count);
    gl.uniform2f(u('u_resolution'), this.width, this.height);
    gl.uniform1f(u('u_dpr'), dpr);
    gl.uniform1f(u('u_thickness'), params.thickness);
    gl.uniform1f(u('u_refFactor'), params.refractiveIndex);
    gl.uniform1f(u('u_distance'), params.distance);
    gl.uniform1f(u('u_dispersion'), params.dispersion);
    gl.uniform1f(u('u_fresnelRange'), params.fresnelRange);
    gl.uniform1f(u('u_fresnelHardness'), params.fresnelHardness);
    gl.uniform1f(u('u_fresnelFactor'), params.fresnelFactor);
    gl.uniform1f(u('u_glareRange'), params.glareRange);
    gl.uniform1f(u('u_glareHardness'), params.glareHardness);
    gl.uniform1f(u('u_glareFactor'), params.glareFactor);
    gl.uniform1f(u('u_glareConvergence'), params.glareConvergence);
    gl.uniform1f(u('u_glareOppositeFactor'), params.glareOppositeFactor);
    gl.uniform1f(u('u_glareAngle'), (params.glareAngle * Math.PI) / 180);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** Attribut posé par EditNode sur l'élément dont la taille porte la lentille. */
export const GLASS_LENS_ATTR = 'data-glass-lens';
/** Attribut d'une poignée, frère de la lentille : "dx,dy,allongement" (cf. GlassPull). */
export const GLASS_PULL_ATTR = 'data-glass-pull';

/**
 * Lentilles des nœuds présents dans `root`, lues sur le DOM (position et taille animées par
 * framer-motion). Intensité : 0 à la taille du point inactif, 1 à la taille de la bulle.
 */
export function collectLenses(root: Element, origin: DOMRect): GlassLens[] {
  const lenses: GlassLens[] = [];
  root.querySelectorAll<HTMLElement>(`[${GLASS_LENS_ATTR}]`).forEach((el) => {
    const r = el.getBoundingClientRect();
    const [core, full, merge] = (el.getAttribute(GLASS_LENS_ATTR) ?? '0,1').split(',').map(Number);
    const t = Math.min(1, Math.max(0, (r.width - core) / Math.max(full - core, 1e-6)));
    const pulls: GlassPull[] = [];
    el.parentElement?.querySelectorAll(`[${GLASS_PULL_ATTR}]`).forEach((h) => {
      const [dx, dy, stretch] = (h.getAttribute(GLASS_PULL_ATTR) ?? '').split(',').map(Number);
      if (pulls.length < MAX_PULLS && Number.isFinite(stretch)) pulls.push({ dx, dy, stretch });
    });
    lenses.push({
      pulls,
      mergePx: Number.isFinite(merge) ? merge : undefined,
      x: r.left - origin.left + r.width / 2,
      y: r.top - origin.top + r.height / 2,
      radius: r.width / 2,
      strength: t * t * (3 - 2 * t),
    });
  });
  return lenses;
}
