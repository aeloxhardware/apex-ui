import React, { useEffect, useRef, useState } from 'react';

/**
 * Fond « chute de lumière » de l'Accueil : traînées lumineuses en WebGL2, bien plus légères que le
 * relief topographique (un seul passage de traînées + bloom à résolution réduite, boucle arrêtée quand
 * rien ne bouge ou que l'onglet est caché). Adapté du composant Lightfall (React Bits) en TSX, sans CSS externe.
 */

const MAX_COLORS = 8;
const BLOOM_LEVELS = 4;

import { VERTEX, STREAKS, DOWNSAMPLE, BLUR, COMPOSITE } from './lightfallShaders';

const INTRO_SECONDS = 2.6;
const WARP_SPEED = 9;
const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
};

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };

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

export interface LightfallProps {
  colors?: string[];
  backgroundColor?: string;
  speed?: number;
  streakCount?: number;
  streakWidth?: number;
  streakLength?: number;
  glow?: number;
  density?: number;
  twinkle?: number;
  zoom?: number;
  backgroundGlow?: number;
  headGlow?: number;
  depth?: number;
  bloom?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  mouseDampening?: number;
  lens?: number;
  holdToWarp?: boolean;
  intro?: boolean;
  fade?: number;
  lightMode?: boolean;
  mixBlendMode?: React.CSSProperties['mixBlendMode'];
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Appelé une fois, après la première image (ou si WebGL2 est indisponible). */
  onReady?: () => void;
}

const Lightfall: React.FC<LightfallProps> = ({
  colors = ['#ffffff'],
  backgroundColor = '#94a3b8',
  speed = 0.3,
  streakCount = 2,
  streakWidth = 0.8,
  streakLength = 1,
  glow = 1,
  density = 0.6,
  twinkle = 0.3,
  zoom = 3,
  backgroundGlow = 0.1,
  headGlow = 0.6,
  depth = 0.5,
  bloom = 0.35,
  opacity = 1,
  mouseInteraction = true,
  mouseStrength = 0.4,
  mouseRadius = 0.45,
  mouseDampening = 0.15,
  lens = 0.5,
  holdToWarp = true,
  intro = true,
  fade = 0,
  lightMode = false,
  mixBlendMode,
  paused = false,
  dpr,
  className,
  style,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [generation, setGeneration] = useState(0);
  const settings = {
    colors: (Array.isArray(colors) && colors.length ? colors : ['#ffffff']).slice(0, MAX_COLORS).map(String),
    backgroundColor: String(backgroundColor),
    speed,
    streakCount: Math.round(clamp(streakCount, 1, 16)),
    streakWidth: Math.max(0.05, streakWidth),
    streakLength: Math.max(0.05, streakLength),
    glow: Math.max(0, glow),
    density,
    twinkle: clamp(twinkle, 0, 1),
    zoom: Math.max(0.1, zoom),
    backgroundGlow: Math.max(0, backgroundGlow),
    headGlow: clamp(headGlow, 0, 1),
    depth: Math.max(0, depth),
    bloom: Math.max(0, bloom),
    opacity: clamp(opacity, 0, 1),
    mouseInteraction,
    mouseStrength: Math.max(0, mouseStrength),
    mouseRadius: Math.max(0.01, mouseRadius),
    mouseDampening: Math.max(0, mouseDampening),
    lens: clamp(lens, 0, 1),
    holdToWarp,
    intro,
    fade: clamp(fade, 0, 1),
    lightMode,
    paused,
    dpr,
  };
  const settingsRef = useRef(settings); settingsRef.current = settings;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      // Le verre de l'Accueil (GlassPanelBackdrop) recopie ce canevas avec drawImage : sans cela le
      // tampon est vide dès que l'image est composée.
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      readyRef.current?.();
    };
    if (!container || !canvas || !gl) {
      announce();
      return undefined;
    }

    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    const streakProgram = link(gl, STREAKS);
    const downProgram = link(gl, DOWNSAMPLE);
    const blurProgram = link(gl, BLUR);
    const compositeProgram = link(gl, COMPOSITE);
    if (!streakProgram || !downProgram || !blurProgram || !compositeProgram) {
      announce();
      return undefined;
    }

    const onContextLost = (event: Event) => {
      event.preventDefault();
    };
    const onContextRestored = () => setGeneration((value) => value + 1);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    type Target = { texture: WebGLTexture | null; framebuffer: WebGLFramebuffer | null; width: number; height: number };
    const format = floatTargets ? gl.RGBA16F : gl.RGBA8;
    const encode = floatTargets ? 1 : 0.25;
    const createTarget = (): Target => ({ texture: null, framebuffer: gl.createFramebuffer(), width: 0, height: 0 });
    const scene = createTarget();
    const levels = Array.from({ length: BLOOM_LEVELS }, () => [createTarget(), createTarget()]);

    const allocate = (target: Target, width: number, height: number) => {
      if (target.texture && target.width === width && target.height === height) return;
      if (target.texture) gl.deleteTexture(target.texture);
      target.texture = gl.createTexture();
      target.width = width;
      target.height = height;
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    };

    const pass = (target: Target | null, program: Program) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
      gl.viewport(0, 0, target ? target.width : canvas.width, target ? target.height : canvas.height);
      gl.useProgram(program.program);
      return program.uniforms;
    };

    const bind = (unit: number, texture: WebGLTexture | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    };

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
    const toLinear = (value: string) => toRgb(value).map((channel) => channel * channel);

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const palette = new Float32Array(MAX_COLORS * 3);
    const pointer = { x: 0, y: 0, inside: false, held: false };
    const state = {
      travel: 0,
      intro: settingsRef.current.intro && !reduce ? 0 : 1,
      mouseX: 0,
      mouseY: 0,
      lensX: 0,
      lensY: 0,
      touch: 0,
      warp: 0,
    };
    let raf = 0;
    let last = 0;
    let visible = true;

    const render = () => {
      const s = settingsRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const cssWidth = Math.max(1, container.clientWidth);
      const cssHeight = Math.max(1, container.clientHeight);
      gl.bindVertexArray(vao);
      allocate(scene, width, height);
      levels.forEach((pair, index) => {
        const levelWidth = Math.max(1, Math.round(cssWidth / 2 ** (index + 1)));
        const levelHeight = Math.max(1, Math.round(cssHeight / 2 ** (index + 1)));
        allocate(pair[0], levelWidth, levelHeight);
        allocate(pair[1], levelWidth, levelHeight);
      });

      const introValue = state.intro;
      const presence = Math.min(1, introValue * 2.2);
      const stretch = 1 + 5 * Math.pow(1 - introValue, 2) + 2.5 * state.warp;
      const rings = Math.max(1, Math.floor(TAU * Math.max(s.density, 0.05) + 0.5));
      const period = TAU / rings;
      const clock = 9 + state.travel;

      const list: number[][] = s.colors.map(toLinear);
      palette.fill(0);
      for (let i = 0; i < MAX_COLORS; i++) palette.set(list[Math.min(i, list.length - 1)], i * 3);

      const toScreenX = (value: number) => (2 * value - width) / width;
      const toScreenY = (value: number) => (2 * value - height) / width;

      const r = pass(scene, streakProgram);
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

      if (s.bloom > 0) {
        let source = scene;
        levels.forEach(([front, back]) => {
          const d = pass(front, downProgram);
          bind(0, source.texture);
          gl.uniform1i(d.uSource, 0);
          gl.uniform2f(d.uTarget, front.width, front.height);
          gl.uniform2f(d.uTexel, 1 / source.width, 1 / source.height);
          gl.uniform1f(d.uLimit, 4 * encode);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          let b = pass(back, blurProgram);
          bind(0, front.texture);
          gl.uniform1i(b.uSource, 0);
          gl.uniform2f(b.uTarget, back.width, back.height);
          gl.uniform2f(b.uStep, 1 / front.width, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          b = pass(front, blurProgram);
          bind(0, back.texture);
          gl.uniform1i(b.uSource, 0);
          gl.uniform2f(b.uTarget, front.width, front.height);
          gl.uniform2f(b.uStep, 0, 1 / back.height);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          source = front;
        });
      }

      const c = pass(null, compositeProgram);
      bind(0, scene.texture);
      gl.uniform1i(c.uScene, 0);
      levels.forEach(([front], index) => {
        bind(index + 1, front.texture);
        gl.uniform1i(c[`uBloom${index}`], index + 1);
      });
      gl.uniform2f(c.uView, width, height);
      gl.uniform1f(c.uDecode, 1 / encode);
      gl.uniform1f(c.uGlow, s.glow);
      gl.uniform1f(c.uBloom, s.bloom);
      gl.uniform1f(c.uPresence, presence);
      gl.uniform1f(c.uOpacity, s.opacity);
      gl.uniform1f(c.uFade, s.fade);
      gl.uniform1f(c.uLightMode, s.lightMode ? 1 : 0);
      gl.uniform3fv(c.uTopColor, toLinear(s.backgroundColor));
      gl.uniform1f(c.uTopGlow, s.backgroundGlow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let unit = BLOOM_LEVELS; unit >= 0; unit--) bind(unit, null);
      announce();
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const s = settingsRef.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
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

      render();

      const settling = state.intro < 1 || state.warp > 0.001 || Math.abs((engaged ? 1 : 0) - state.touch) > 0.002;
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
      if (!raf) render();
      wake();
    };

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
      last = 0;
      wake();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        last = 0;
        wake();
      }
    });
    intersection.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    let lastDpr = settingsRef.current.dpr;
    wakeRef.current = () => {
      const s = settingsRef.current;
      if (s.dpr !== lastDpr) {
        lastDpr = s.dpr;
        resize();
        return;
      }
      if (!raf) render();
      wake();
    };

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      [scene, ...levels.flat()].forEach((target) => {
        if (target.texture) gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      });
      [streakProgram, downProgram, blurProgram, compositeProgram].forEach((item) => gl.deleteProgram(item.program));
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [generation]);

  useEffect(() => {
    wakeRef.current?.();
  });

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...(mixBlendMode ? { mixBlendMode } : null),
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        id="home-background"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

export default Lightfall;
