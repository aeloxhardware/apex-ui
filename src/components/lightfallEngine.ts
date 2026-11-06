import {
  BLOOM_LEVELS, allocate, bind, createRig, destroyRig, linkPrograms, pass,
  type LightfallSettings, type Rig,
} from './lightfallGl';

/** Boucle de rendu du fond Lightfall : dessin d'une image, mouvement, pointeur, observateurs. */

const INTRO_SECONDS = 2.6;
const WARP_SPEED = 9;
const TAU = Math.PI * 2;

interface Pointer { x: number; y: number; inside: boolean; held: boolean }

/** Quelques constantes de l'image courante, partagées par les trois passes. */
interface FrameInfo { width: number; height: number; presence: number }

/** Passe 1 : traînées lumineuses vers la cible `scene`. */
function drawStreaks(rig: Rig, s: LightfallSettings, f: FrameInfo, list: number[][]) {
  const { gl, scene, state, palette, encode, programs } = rig;
  const { width, height } = f;
  const stretch = 1 + 5 * Math.pow(1 - state.intro, 2) + 2.5 * state.warp;
  const rings = Math.max(1, Math.floor(TAU * Math.max(s.density, 0.05) + 0.5));
  const period = TAU / rings;
  const clock = 9 + state.travel;
  const toScreenX = (value: number) => (2 * value - width) / width;
  const toScreenY = (value: number) => (2 * value - height) / width;

  const r = pass(rig, scene, programs.streak);
  gl.uniform2f(r.uView, width, height);
  gl.uniform1f(r.uZoom, s.zoom);
  gl.uniform1f(r.uPhase, clock % (16 * period));
  gl.uniform1f(r.uTwinkleClock, clock % TAU);
  gl.uniform1f(r.uRings, rings);
  gl.uniform3fv(r.uColors, palette);
  gl.uniform1i(r.uColorCount, list.length);
  gl.uniform1i(r.uStreakCount, s.streakCount);
  gl.uniform1i(r.uColumns, s.streakWidth > 1 ? 2 : 1);
  gl.uniform1f(r.uWidth, 5e-4 * s.streakWidth);
  gl.uniform1f(r.uTail, 19 / (s.streakLength * stretch));
  gl.uniform1f(r.uTwinkle, s.twinkle);
  gl.uniform1f(r.uHead, s.headGlow);
  gl.uniform1f(r.uDepth, s.depth);
  gl.uniform4f(
    r.uMouse,
    toScreenX(state.mouseX),
    toScreenY(state.mouseY),
    s.mouseInteraction ? s.mouseStrength * state.touch : 0,
    s.mouseRadius,
  );
  gl.uniform3f(
    r.uLens,
    toScreenX(state.lensX),
    toScreenY(state.lensY),
    s.mouseInteraction ? 0.5 * s.lens * state.touch : 0,
  );
  gl.uniform1f(r.uLightMode, s.lightMode ? 1 : 0);
  gl.uniform1f(r.uEncode, encode);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Passe 2 : bloom (réduction puis flou séparable, par niveau). */
function drawBloom(rig: Rig) {
  const { gl, scene, levels, programs, encode } = rig;
  let source = scene;
  levels.forEach(([front, back]) => {
    const d = pass(rig, front, programs.down);
    bind(rig, 0, source.texture);
    gl.uniform1i(d.uSource, 0);
    gl.uniform2f(d.uTarget, front.width, front.height);
    gl.uniform2f(d.uTexel, 1 / source.width, 1 / source.height);
    gl.uniform1f(d.uLimit, 4 * encode);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    let b = pass(rig, back, programs.blur);
    bind(rig, 0, front.texture);
    gl.uniform1i(b.uSource, 0);
    gl.uniform2f(b.uTarget, back.width, back.height);
    gl.uniform2f(b.uStep, 1 / front.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    b = pass(rig, front, programs.blur);
    bind(rig, 0, back.texture);
    gl.uniform1i(b.uSource, 0);
    gl.uniform2f(b.uTarget, front.width, front.height);
    gl.uniform2f(b.uStep, 0, 1 / back.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    source = front;
  });
}

/** Passe 3 : composition à l'écran (scène, bloom, voile du haut). */
function drawComposite(rig: Rig, s: LightfallSettings, f: FrameInfo) {
  const { gl, scene, levels, programs, encode, toLinear } = rig;
  const c = pass(rig, null, programs.composite);
  bind(rig, 0, scene.texture);
  gl.uniform1i(c.uScene, 0);
  levels.forEach(([front], index) => {
    bind(rig, index + 1, front.texture);
    gl.uniform1i(c[`uBloom${index}`], index + 1);
  });
  gl.uniform2f(c.uView, f.width, f.height);
  gl.uniform1f(c.uDecode, 1 / encode);
  gl.uniform1f(c.uGlow, s.glow);
  gl.uniform1f(c.uBloom, s.bloom);
  gl.uniform1f(c.uPresence, f.presence);
  gl.uniform1f(c.uOpacity, s.opacity);
  gl.uniform1f(c.uFade, s.fade);
  gl.uniform1f(c.uLightMode, s.lightMode ? 1 : 0);
  gl.uniform3fv(c.uTopColor, toLinear(s.backgroundColor));
  gl.uniform1f(c.uTopGlow, s.backgroundGlow);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Dessine une image complète. */
function renderFrame(rig: Rig, s: LightfallSettings) {
  const { gl, canvas, container, scene, levels, palette, state, toLinear } = rig;
  const width = canvas.width;
  const height = canvas.height;
  const cssWidth = Math.max(1, container.clientWidth);
  const cssHeight = Math.max(1, container.clientHeight);
  gl.bindVertexArray(rig.vao);
  allocate(rig, scene, width, height);
  levels.forEach((pair, index) => {
    const levelWidth = Math.max(1, Math.round(cssWidth / 2 ** (index + 1)));
    const levelHeight = Math.max(1, Math.round(cssHeight / 2 ** (index + 1)));
    allocate(rig, pair[0], levelWidth, levelHeight);
    allocate(rig, pair[1], levelWidth, levelHeight);
  });

  const list: number[][] = s.colors.map(toLinear);
  palette.fill(0);
  for (let i = 0; i < palette.length / 3; i++) palette.set(list[Math.min(i, list.length - 1)], i * 3);

  const frame: FrameInfo = { width, height, presence: Math.min(1, state.intro * 2.2) };
  drawStreaks(rig, s, frame, list);
  if (s.bloom > 0) drawBloom(rig);
  drawComposite(rig, s, frame);
  for (let unit = BLOOM_LEVELS; unit >= 0; unit--) bind(rig, unit, null);
  rig.announce();
}

/** Fait avancer l'introduction, le voyage, l'élan du pointeur ; dit si la boucle doit continuer. */
function advanceMotion(rig: Rig, s: LightfallSettings, pointer: Pointer, dt: number, reduce: boolean) {
  const { canvas, container, state } = rig;
  if (!s.intro || reduce) state.intro = 1;
  else if (state.intro < 1) state.intro = Math.min(1, state.intro + dt / INTRO_SECONDS);

  const holding = s.holdToWarp && pointer.held && pointer.inside && !reduce;
  state.warp += ((holding ? 1 : 0) - state.warp) * (1 - Math.exp(-dt * (holding ? 2.2 : 1.6)));
  const rush = WARP_SPEED * Math.pow(1 - state.intro, 2) + 6 * state.warp;
  const running = !s.paused && !reduce;
  if (running) state.travel += dt * 0.1 * s.speed * (1 + rush);

  const ratio = canvas.width / Math.max(1, container.clientWidth);
  const targetX = pointer.x * ratio;
  const targetY = (container.clientHeight - pointer.y) * ratio;
  const engaged = s.mouseInteraction && pointer.inside && !reduce;
  if (engaged && state.touch < 0.01) {
    state.mouseX = targetX;
    state.mouseY = targetY;
    state.lensX = targetX;
    state.lensY = targetY;
  }
  const follow = s.mouseDampening > 0 ? 1 - Math.exp(-dt / s.mouseDampening) : 1;
  state.mouseX += (targetX - state.mouseX) * follow;
  state.mouseY += (targetY - state.mouseY) * follow;
  const lensFollow = 1 - Math.exp(-dt * 6);
  state.lensX += (targetX - state.lensX) * lensFollow;
  state.lensY += (targetY - state.lensY) * lensFollow;
  state.touch += ((engaged ? 1 : 0) - state.touch) * (1 - Math.exp(-dt * (engaged ? 4 : 2)));

  const settling = state.intro < 1 || state.warp > 0.001 || Math.abs((engaged ? 1 : 0) - state.touch) > 0.002;
  return { running, settling };
}

/** Boucle d'animation : image suivante, réveil, redimensionnement. */
function createLoop(rig: Rig, settingsRef: { current: LightfallSettings }, reduce: boolean) {
  const { canvas, container } = rig;
  const pointer: Pointer = { x: 0, y: 0, inside: false, held: false };
  let raf = 0;
  let last = 0;
  let visible = true;

  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const s = settingsRef.current;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const { running, settling } = advanceMotion(rig, s, pointer, dt, reduce);
    renderFrame(rig, s);
    if ((running && s.speed !== 0) || settling) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    const s = settingsRef.current;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    if (!raf) renderFrame(rig, s);
    wake();
  };

  return {
    pointer,
    wake,
    resize,
    renderIdle: () => { if (!raf) renderFrame(rig, settingsRef.current); },
    resetClock: () => { last = 0; },
    setVisible: (value: boolean) => { visible = value; },
    stop: () => cancelAnimationFrame(raf),
  };
}

/** Écouteurs du pointeur (fenêtre entière) ; renvoie la fonction qui les retire. */
function attachPointer(container: HTMLElement, pointer: Pointer, wake: () => void, resetClock: () => void) {
  const locate = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
  };
  const onPointerMove = (event: PointerEvent) => {
    const point = locate(event);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.inside = point.inside;
    wake();
  };
  const onPointerDown = (event: PointerEvent) => {
    const point = locate(event);
    if (!point.inside) return;
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.inside = true;
    pointer.held = true;
    wake();
  };
  const onPointerUp = () => {
    pointer.held = false;
    wake();
  };
  const onPointerLeave = () => {
    pointer.inside = false;
    pointer.held = false;
    wake();
  };
  const onVisibility = () => {
    resetClock();
    wake();
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export interface LightfallEngineOptions {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  settingsRef: { current: LightfallSettings };
  announce: () => void;
  onContextRestored: () => void;
}

/** Démarre le fond : programmes, cibles, boucle, observateurs. `null` si les shaders ne se lient pas. */
export function startLightfall(o: LightfallEngineOptions) {
  const { gl, canvas, container, settingsRef } = o;
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const programs = linkPrograms(gl);
  if (!programs) return null;

  const onContextLost = (event: Event) => {
    event.preventDefault();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', o.onContextRestored);

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const rig = createRig(gl, canvas, container, programs, o.announce, floatTargets, settingsRef.current.intro, reduce);
  const loop = createLoop(rig, settingsRef, reduce);
  const detachPointer = attachPointer(container, loop.pointer, loop.wake, loop.resetClock);

  const resizeObserver = new ResizeObserver(loop.resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    loop.setVisible(visible);
    if (visible) {
      loop.resetClock();
      loop.wake();
    }
  });
  intersection.observe(container);
  loop.resize();

  let lastDpr = settingsRef.current.dpr;
  return {
    /** Réveil après un changement de réglages (le rendu repart, la taille suit le dpr). */
    wake() {
      if (settingsRef.current.dpr !== lastDpr) {
        lastDpr = settingsRef.current.dpr;
        loop.resize();
        return;
      }
      loop.renderIdle();
      loop.wake();
    },
    dispose() {
      loop.stop();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', o.onContextRestored);
      resizeObserver.disconnect();
      intersection.disconnect();
      detachPointer();
      destroyRig(rig);
    },
  };
}

