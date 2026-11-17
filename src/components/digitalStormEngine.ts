import STORM_FRAGMENT from './digitalStorm.frag?raw';

const STORM_VERTEX = 'attribute vec2 aPosition; void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }';

/** Boucle de rendu du fond « orage numérique » : un seul passage plein écran, arrêté quand la page est cachée. */

/** Plafond de pixels dessinés (1600 x 900) : au-delà le canevas est sous-échantillonné, le fond reste léger en 4K. */
export const STORM_MAX_PIXELS = 1600 * 900;
const INTRO_SECONDS = 1.4;
/** Instant figé quand le système demande moins d'animations. */
const STILL_TIME = 8;

/** Taille du tampon du canevas pour une zone CSS donnée, plafonnée à `maxPixels` en gardant les proportions. */
export function stormCanvasSize(cssWidth: number, cssHeight: number, maxPixels = STORM_MAX_PIXELS) {
  const width = Math.max(1, Math.round(cssWidth));
  const height = Math.max(1, Math.round(cssHeight));
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Montée en puissance à l'apparition : 0 → 1, adoucie. */
export function stormPower(elapsed: number) {
  const k = Math.min(1, Math.max(0, elapsed / INTRO_SECONDS));
  return k * k * (3 - 2 * k);
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/** Lance la liaison du programme (en parallèle du fil principal quand le navigateur sait le faire). */
function beginProgram(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, STORM_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, STORM_FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
}

/**
 * Le programme est-il lié ? On n'interroge LINK_STATUS qu'une fois la compilation finie : getProgramParameter
 * attend sinon la fin de la compilation et bloquait le fil principal ~0,5 s à l'arrivée sur l'Accueil, en pleine transition (saccade).
 */
function isLinkDone(gl: WebGLRenderingContext, program: WebGLProgram) {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  return !ext || gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) === true;
}

/** Programme lié : pose le triangle plein écran ; null si les shaders ne se lient pas. */
function finishProgram(gl: WebGLRenderingContext, program: WebGLProgram) {
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Fond orage numérique indisponible :', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  return {
    program,
    buffer,
    uRes: gl.getUniformLocation(program, 'uRes'),
    uTime: gl.getUniformLocation(program, 'uTime'),
    uPower: gl.getUniformLocation(program, 'uPower'),
  };
}

export interface DigitalStormOptions {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  /** Appelé après chaque image dessinée (le composant n'annonce que la première). */
  announce: () => void;
  onContextRestored: () => void;
}

type Rig = NonNullable<ReturnType<typeof finishProgram>>;

/** Boucle, observateurs : le programme est déjà lié. */
function runDigitalStorm(o: DigitalStormOptions, rig: Rig) {
  const { gl, canvas, container } = o;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let visible = true;

  const draw = () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(rig.uRes, canvas.width, canvas.height);
    gl.uniform1f(rig.uTime, reduce ? STILL_TIME : time);
    gl.uniform1f(rig.uPower, reduce ? 1 : stormPower(time));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    o.announce();
  };
  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    // Le temps n'avance que quand on dessine : pas de saut au retour d'une page cachée.
    time += last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    draw();
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    last = 0;
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const resize = () => {
    const size = stormCanvasSize(container.clientWidth, container.clientHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    draw();
    wake();
  };
  const onContextLost = (event: Event) => event.preventDefault();

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', o.onContextRestored);
  document.addEventListener('visibilitychange', wake);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    wake();
  });
  intersection.observe(container);
  resize();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', o.onContextRestored);
      document.removeEventListener('visibilitychange', wake);
      resizeObserver.disconnect();
      intersection.disconnect();
      gl.deleteBuffer(rig.buffer);
      gl.deleteProgram(rig.program);
    },
  };
}

/** Attente maximale de la fin de liaison avant de la forcer. */
const LINK_WAIT_MAX_MS = 600;

/** Démarre le fond : liaison du programme sans bloquer, puis boucle. null si le programme ne peut pas même être créé. */
export function startDigitalStorm(o: DigitalStormOptions) {
  const { gl } = o;
  const program = beginProgram(gl);
  if (!program) return null;
  let running: { dispose(): void } | null = null;
  let waiting = 0;
  let disposed = false;
  const started = performance.now();
  const poll = () => {
    waiting = 0;
    if (disposed) return;
    // Certains pilotes n'annoncent jamais la fin sur un contexte neuf : passé le délai, on lie comme avant (en bloquant).
    if (!isLinkDone(gl, program) && performance.now() - started < LINK_WAIT_MAX_MS) {
      waiting = requestAnimationFrame(poll);
      return;
    }
    const rig = finishProgram(gl, program);
    if (rig) running = runDigitalStorm(o, rig);
    else o.announce();
  };
  poll();
  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(waiting);
      if (running) running.dispose();
      else gl.deleteProgram(program);
    },
  };
}
