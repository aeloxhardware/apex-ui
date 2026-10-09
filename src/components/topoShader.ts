// Shaders du fond topographique de l'Accueil (voir TopoBackground.tsx). Fichier sans backtick dans les commentaires GLSL.
export const TOPO_VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

export const TOPO_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uSeed;   // décalage aléatoire du relief (tiré à chaque montage)
uniform vec3 uPhase;  // phases aléatoires des oscillations lentes
uniform vec2 uDrift;  // direction aléatoire de dérive
out vec4 o;

float hash(vec2 q) {
  q = fract(q * vec2(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
float noise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// relief lisse (non quantifié) : grandes collines et cuvettes, un peu de détail
float smoothField(vec2 xz) {
  vec2 q = xz * 0.3 + uSeed + uDrift * uTime;
  float w1 = 0.3 + 0.08 * sin(uTime * 0.11 + uPhase.x);
  float w2 = 0.1 + 0.05 * sin(uTime * 0.17 + uPhase.y);
  float n = noise(q) * (0.6 - 0.5 * w1 + 0.15)
          + noise(q * 2.1 + 5.3 + vec2(uTime * 0.02, 0.0)) * w1
          + noise(q * 4.3 + 1.7 - vec2(0.0, uTime * 0.03)) * w2;
  n /= (0.75 - 0.5 * w1 + w1 + w2) / 1.0;
  n *= 1.0;
  return n;
}

const float LEVELS = 12.0;
const float AMP = 1.0;
float field(vec2 xz) {
  float n = (smoothField(xz) - 0.3 + 0.05 * sin(uTime * 0.13 + uPhase.z)) * 2.1;
  return floor(clamp(n, 0.0, 1.0) * LEVELS) / LEVELS * AMP;
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

vec3 shade(vec2 fc) {
  float jit = ign(fc);
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.2, 2.9, -4.6);
  vec3 ta = vec3(0.2, 0.15, 0.4);
  // (cible et distance réglées sur l'image de référence)
  vec3 f = normalize(ta - ro);
  vec3 r = normalize(cross(vec3(0, 1, 0), f));
  vec3 u = cross(f, r);
  vec3 rd = normalize(f * 1.55 + r * uv.x + u * uv.y);

  vec3 sun = normalize(vec3(-0.35, 0.75, 0.55));
  vec3 bg = mix(vec3(0.165, 0.176, 0.204), vec3(0.285, 0.30, 0.34), smoothstep(0.35, -0.3, uv.y));
  vec3 col = bg;

  float t = 0.5, tp = 0.5;
  bool hit = false, top = false;
  vec3 pos = ro;
  for (int i = 0; i < 400; i++) {
    pos = ro + rd * t;
    if (t > 60.0) break;
    float h = field(pos.xz);
    if (pos.y < h) {
      float a = tp, b = t;
      for (int k = 0; k < 12; k++) {
        float m = 0.5 * (a + b);
        vec3 pm = ro + rd * m;
        if (pm.y < field(pm.xz)) b = m; else a = m;
      }
      vec3 pa = ro + rd * a, pb = ro + rd * b;
      top = abs(field(pa.xz) - field(pb.xz)) < 1e-4;
      t = b; pos = pb; hit = true; break;
    }
    float dt = clamp((pos.y - h) * 0.4, 0.01, 0.12);
    if (pos.y > AMP + 0.05 && rd.y > 0.0) break;
    tp = t;
    t += dt;
  }

  if (hit) {
    vec2 e = vec2(0.09, 0.0);
    vec2 g = vec2(smoothField(pos.xz + e.xy) - smoothField(pos.xz - e.xy),
                  smoothField(pos.xz + e.yx) - smoothField(pos.xz - e.yx));
    vec3 n = top ? vec3(0, 1, 0) : normalize(vec3(-g.x, 0.02, -g.y) + vec3(1e-5));
    float h0 = field(pos.xz);
    float diff = max(dot(n, sun), 0.0);

    // ombre portée douce (pénombre qui s'élargit avec la distance)
    float sh = 1.0;
    vec3 sp = pos + n * 0.015;
    float st = 0.03 + 0.05 * jit;
    for (int i = 0; i < 64; i++) {
      vec3 q = sp + sun * st;
      float d = q.y - field(q.xz);
      sh = min(sh, 2.2 * d / st);
      st += clamp(d, 0.02, 0.15) * (0.85 + 0.3 * jit);
      if (sh < 0.0 || st > 5.0 || q.y > AMP + 0.1) break;
    }
    sh = smoothstep(0.0, 1.0, clamp(sh, 0.0, 1.0));

    // occlusion ambiante : voisinage plus haut = plus sombre (pied des parois)
    float ao = 0.0, wsum = 0.0;
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float ang = fi * 2.39996 + jit * 6.2832;
      float rr = 0.03 + 0.7 * pow((fi + jit) / 24.0, 1.4);
      float w = 1.0 - rr / 0.75;
      float hh = field(pos.xz + vec2(cos(ang), sin(ang)) * rr);
      ao += w * clamp((hh - h0) / 0.12, 0.0, 1.0);
      wsum += w;
    }
    ao = 1.0 - 0.55 * ao / wsum;

    float l;
    if (top) {
      l = (0.62 + 0.38 * diff * sh) * ao;
      col = vec3(0.43, 0.45, 0.50) * l;
    } else {
      float lvl = clamp(1.0 - (h0 - pos.y) * LEVELS / AMP, 0.0, 1.0);
      float grad = mix(0.78, 1.0, smoothstep(0.1, 1.0, lvl));
      l = (0.50 + 0.22 * diff) * grad;
      col = vec3(0.40, 0.42, 0.47) * l;
    }
    // un peu de lumière globale plus forte vers le haut de l'image
    col *= 0.9 + 0.18 * smoothstep(-0.4, 0.4, uv.y);
    float fog = 1.0 - exp(-max(t - 6.0, 0.0) * 0.03);
    col = mix(col, bg, fog);
  }

  float vg = smoothstep(1.4, 0.3, length(uv * vec2(0.75, 1.0)));
  col *= mix(0.7, 1.0, vg);
  return col;
}

void main() {
  // suréchantillonnage 2x2 en grille tournée : bords nets, sans crénelage
  vec3 c = shade(gl_FragCoord.xy + vec2(-0.125, -0.375))
         + shade(gl_FragCoord.xy + vec2(0.375, -0.125))
         + shade(gl_FragCoord.xy + vec2(0.125, 0.375))
         + shade(gl_FragCoord.xy + vec2(-0.375, 0.125));
  c = c * 0.25 + (ign(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
