import React, { useEffect, useRef } from 'react';
import { TOPO_FRAG, TOPO_VERT } from './topoShader';

/**
 * Fond animé de l'espace Accueil : carte topographique en terrasses blanches vue de côté (lumière
 * rasante, ombres douces). WebGL2 brut, un seul quad plein écran : la hauteur est un bruit fractal
 * quantifié en paliers, parcouru par raymarching depuis une caméra basse. Les courbes de niveau
 * bougent car le bruit dérive lentement et le « niveau de l'eau » monte et descend.
 */
const VERT = TOPO_VERT;
const FRAG = TOPO_FRAG;

export const TopoBackground: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) { window.dispatchEvent(new Event('apex-home-ready')); return; }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');

    const uSeed = gl.getUniformLocation(prog, 'uSeed');
    const uPhase = gl.getUniformLocation(prog, 'uPhase');
    const uDrift = gl.getUniformLocation(prog, 'uDrift');
    // Relief aléatoire à chaque affichage de l'Accueil, avec dérive et oscillations lentes aléatoires.
    const rnd = Math.random;
    const ang = rnd() * Math.PI * 2;
    const speed = 0.008 + rnd() * 0.01;
    gl.uniform2f(uSeed, rnd() * 200, rnd() * 200);
    gl.uniform3f(uPhase, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    gl.uniform2f(uDrift, Math.cos(ang) * speed, Math.sin(ang) * speed);

    // Résolution adaptative : plein débit si le GPU suit, sinon on réduit l'échelle (le shader suréchantillonne déjà).
    let scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.max(2, Math.floor(canvas.clientWidth * scale));
      canvas.height = Math.max(2, Math.floor(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      // Changer la taille d'un canvas l'efface : on redessine tout de suite, dans la même tâche,
      // sinon une image noire s'affiche jusqu'à la prochaine frame.
      render(performance.now());
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    const start = last;
    const render = (now: number) => {
      gl.uniform1f(uTime, 20 + (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    resize();
    window.addEventListener('resize', resize);
    // GPU faible (low_gpu_pwr) : relief figé, une seule image (redessinée au redimensionnement), aucune boucle.
    if (window.apexDesktop?.lowGpuPower) {
      window.dispatchEvent(new Event('apex-home-ready'));
      return () => {
        window.removeEventListener('resize', resize);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      };
    }
    let announced = false;
    const frame = (now: number) => {
      render(now);
      if (!announced) {
        announced = true;
        window.dispatchEvent(new Event('apex-home-ready'));
      }
      acc += now - last;
      last = now;
      if (++frames === 40) {
        if (acc / frames > 24 && scale > 0.5) {
          scale = Math.max(0.5, scale * 0.8);
          resize();
        }
        acc = 0;
        frames = 0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      id="topo-background"
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
};
