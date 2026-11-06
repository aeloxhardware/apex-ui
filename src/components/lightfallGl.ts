import { VERTEX, STREAKS, DOWNSAMPLE, BLUR, COMPOSITE } from './lightfallShaders';

/** Socle WebGL2 du fond Lightfall : compilation, cibles de rendu, état d'animation (objet + fonctions de premier niveau). */

export const MAX_COLORS = 8;
export const BLOOM_LEVELS = 4;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
};

export type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };

const link = (gl: WebGL2RenderingContext, fragmentSource: string): Program | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const uniforms: Program['uniforms'] = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
};

export interface Programs {
  streak: Program;
  down: Program;
  blur: Program;
  composite: Program;
}

/** Compile et lie les quatre programmes ; `null` si l'un d'eux échoue. */
export const linkPrograms = (gl: WebGL2RenderingContext): Programs | null => {
  const streak = link(gl, STREAKS);
  const down = link(gl, DOWNSAMPLE);
  const blur = link(gl, BLUR);
  const composite = link(gl, COMPOSITE);
  if (!streak || !down || !blur || !composite) return null;
  return { streak, down, blur, composite };
};

export type Target = { texture: WebGLTexture | null; framebuffer: WebGLFramebuffer | null; width: number; height: number };

export interface LightfallSettings {
  colors: string[];
  backgroundColor: string;
  speed: number;
  streakCount: number;
  streakWidth: number;
  streakLength: number;
  glow: number;
  density: number;
  twinkle: number;
  zoom: number;
  backgroundGlow: number;
  headGlow: number;
  depth: number;
  bloom: number;
  opacity: number;
  mouseInteraction: boolean;
  mouseStrength: number;
  mouseRadius: number;
  mouseDampening: number;
  lens: number;
  holdToWarp: boolean;
  intro: boolean;
  fade: number;
  lightMode: boolean;
  paused: boolean;
  dpr: number | undefined;
}

interface MotionState {
  travel: number;
  intro: number;
  mouseX: number;
  mouseY: number;
  lensX: number;
  lensY: number;
  touch: number;
  warp: number;
}

export interface Rig {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  programs: Programs;
  buffer: WebGLBuffer | null;
  vao: WebGLVertexArrayObject | null;
  format: number;
  encode: number;
  scene: Target;
  levels: Target[][];
  palette: Float32Array;
  state: MotionState;
  toLinear: (value: string) => number[];
  announce: () => void;
}

const createTarget = (gl: WebGL2RenderingContext): Target => ({
  texture: null,
  framebuffer: gl.createFramebuffer(),
  width: 0,
  height: 0,
});

/** Convertisseur couleur CSS -> RGB linéaire approché (carré), avec cache. */
const createColorConverter = () => {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const colorCache = new Map<string, number[]>();
  const toRgb = (value: string) => {
    if (colorCache.has(value)) return colorCache.get(value)!;
    let rgb = [1, 1, 1];
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#ffffff';
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = [r / 255, g / 255, b / 255];
    }
    colorCache.set(value, rgb);
    return rgb;
  };
  return (value: string) => toRgb(value).map((channel) => channel * channel);
};

/** Crée tampon plein écran, VAO, cibles de rendu et état d'animation. */
export const createRig = (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  programs: Programs,
  announce: () => void,
  floatTargets: boolean,
  introEnabled: boolean,
  reduce: boolean,
): Rig => {
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const format = floatTargets ? gl.RGBA16F : gl.RGBA8;
  const encode = floatTargets ? 1 : 0.25;
  const scene = createTarget(gl);
  const levels = Array.from({ length: BLOOM_LEVELS }, () => [createTarget(gl), createTarget(gl)]);
  const toLinear = createColorConverter();
  const palette = new Float32Array(MAX_COLORS * 3);
  const state: MotionState = {
    travel: 0,
    intro: introEnabled && !reduce ? 0 : 1,
    mouseX: 0,
    mouseY: 0,
    lensX: 0,
    lensY: 0,
    touch: 0,
    warp: 0,
  };
  return { gl, canvas, container, programs, buffer, vao, format, encode, scene, levels, palette, state, toLinear, announce };
};

export const allocate = (rig: Rig, target: Target, width: number, height: number) => {
  const { gl } = rig;
  if (target.texture && target.width === width && target.height === height) return;
  if (target.texture) gl.deleteTexture(target.texture);
  target.texture = gl.createTexture();
  target.width = width;
  target.height = height;
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, rig.format, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
};

export const pass = (rig: Rig, target: Target | null, program: Program) => {
  const { gl, canvas } = rig;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
  gl.viewport(0, 0, target ? target.width : canvas.width, target ? target.height : canvas.height);
  gl.useProgram(program.program);
  return program.uniforms;
};

export const bind = (rig: Rig, unit: number, texture: WebGLTexture | null) => {
  rig.gl.activeTexture(rig.gl.TEXTURE0 + unit);
  rig.gl.bindTexture(rig.gl.TEXTURE_2D, texture);
};

/** Libère toutes les ressources GL du rig. */
export const destroyRig = (rig: Rig) => {
  const { gl, scene, levels, programs } = rig;
  [scene, ...levels.flat()].forEach((target) => {
    if (target.texture) gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  });
  [programs.streak, programs.down, programs.blur, programs.composite].forEach((item) => gl.deleteProgram(item.program));
  gl.deleteBuffer(rig.buffer);
  gl.deleteVertexArray(rig.vao);
  if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
};
