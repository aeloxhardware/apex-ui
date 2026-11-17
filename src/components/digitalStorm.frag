// Fond « orage numérique » de l'Accueil (voir DigitalStorm.tsx), importé tel quel (`?raw`).
// Le bruit, les filaments, la couronne et les éclairs viennent de la sphère d'énergie de l'écran de démarrage
// (electron/splash-sphere.html) ; s'y ajoutent l'orage sur toute la page, un globe en pointillés, des orbites et des
// pistes de circuit.
//
// Photosensibilité (WCAG 2.3.1) : rien ne clignote. Les arcs sont continus (ils rampent, s'allument et s'éteignent
// en fondu d'une seconde environ) ; les décharges suivent une seule horloge pour toute la page, au plus une par
// créneau de SLOT s, avec une montée et une descente douces, sans rebond. `pnpm check:photosensitivity` le mesure.
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uPower;

const float RADIUS = 0.40; // rayon de la sphère, en demi-hauteurs d'écran
const float SLOT = 0.55; // un créneau de décharge (s) pour toute la page
const float TAU = 6.2831853;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
// Bruit en crêtes : plis fins et brillants, l'allure de filaments électriques.
float ridge(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(2.0 * noise(p) - 1.0);
    s += a * n * n;
    p = p * 2.11 + 5.3;
    a *= 0.52;
  }
  return s;
}
// Éclair le long de l'axe +x de son repère : il erre de plus en plus en s'éloignant et s'affine en pointe.
// `drift` fait ramper sa forme dans le temps (0 : forme figée).
float bolt(float along, float across, float len, float seed, float width, float drift) {
  float reach = abs(across) / (len * 0.28 + 0.4);
  if (along < 0.0 || along > len || reach > 1.0) return 0.0;
  float k = along / len;
  // Un long éclair garde le grain d'un court : seule la grande ondulation grandit avec lui.
  float grain = min(len, 1.5);
  float sweep = (noise(vec3(along * 4.0 * grain / len, seed, 11.0 + drift * 0.5)) - 0.5) * 0.30 * (0.25 + k);
  float wander = (noise(vec3(along * 4.0, seed, drift)) - 0.5) * 0.36 * (0.25 + k)
               + (noise(vec3(along * 13.0, seed, 3.0 + drift)) - 0.5) * 0.14
               + (noise(vec3(along * 37.0, seed, 7.0 + drift)) - 0.5) * 0.04;
  float d = abs(across - (sweep * len + wander * grain) * 0.9);
  float w = width * (1.0 - 0.85 * k);
  float ends = smoothstep(0.0, 0.03, along) * smoothstep(len, len * 0.9, along);
  return w / (d + w * 0.35) * ends * (1.0 - smoothstep(0.5, 1.0, reach));
}
// Enveloppe d'une décharge, `a` en secondes depuis son départ : montée en 90 ms, extinction en une demi-seconde.
float envelope(float a) { return smoothstep(0.0, 0.09, a) * exp(-max(a - 0.09, 0.0) * 5.5); }
// Fondu d'un arc sur sa vie k (0 → 1) : il s'allume sur le premier quart et s'éteint sur le dernier.
float lifeFade(float k) { return smoothstep(0.0, 0.25, k) * smoothstep(1.0, 0.75, k); }
// Distance du bord de la sphère au bord de la page dans la direction ax (rayons de sphère).
float toEdge(vec2 ax, vec2 page) { return min(page.x / max(abs(ax.x), 1e-3), page.y / max(abs(ax.y), 1e-3)) - 0.99; }

// ── Décor : pistes de circuit, trame, poussière ──

// Une piste de circuit : horizontale, un coude à 45 degrés, une pastille à chaque bout. x = (trait, impulsion).
vec2 trace(vec2 q, float j, float h, float seed, float px) {
  float k = hash21(vec2(j, seed));
  if (k < 0.22) return vec2(0.0);
  float y0 = (j + 0.5) * h;
  float xs = 0.62 + abs(y0) * 0.75 + 0.35 * k; // en entonnoir autour de la sphère
  float xe = xs + 0.35 + 1.3 * hash21(vec2(j, seed + 1.0));
  if (q.x < xs - 0.02 || q.x > xe + 0.02) return vec2(0.0);
  float xb = mix(xs, xe, 0.25 + 0.5 * hash21(vec2(j, seed + 2.0)));
  float d = (floor(hash21(vec2(j, seed + 3.0)) * 3.0) - 1.0) * h * 0.5;
  float y = y0 + d * clamp((q.x - xb) / max(abs(d), 1e-4), 0.0, 1.0);
  float dist = abs(q.y - y);
  float inside = step(xs, q.x) * step(q.x, xe);
  float line = inside * (1.0 - smoothstep(px * 0.6, px * 1.8, dist));
  float halo = inside * 0.0005 / (dist + 0.004);
  float padEnd = 1.0 - smoothstep(0.005, 0.005 + px, max(abs(q.x - xe), abs(q.y - y0 - d)));
  float padStart = 1.0 - smoothstep(0.0035, 0.0035 + px, max(abs(q.x - xs), abs(q.y - y0)));
  // L'énergie part de la sphère et file vers l'extérieur.
  float head = xs + fract(uTime * (0.06 + 0.12 * k) + k * 7.0) * (xe - xs + 0.5);
  float tail = exp(-(head - q.x) * 9.0) * step(q.x, head);
  return vec2(line * 0.55 + halo + padEnd + padStart * 0.7, (line + halo * 2.0) * tail);
}
vec2 circuits(vec2 q, float h, float seed, float px) {
  float j = floor(q.y / h);
  vec2 s = vec2(0.0);
  for (int i = -1; i <= 1; i++) s += trace(q, j + float(i), h, seed, px);
  return s;
}
float hexEdge(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - 0.5 * s;
  vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
  vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
  return 0.5 - max(g.x, dot(g, vec2(0.5, 0.8660254)));
}
vec3 backdrop(vec2 p, float t) {
  float px = 2.0 / uRes.y;
  float band = exp(-abs(p.y) * 2.6);
  vec3 col = vec3(0.004, 0.010, 0.036) + vec3(0.008, 0.035, 0.150) * exp(-length(p) * 1.3);
  col += vec3(0.0, 0.035, 0.150) * band * (0.35 + 0.65 * fbm(vec3(p.x * 1.5 - t * 0.05, p.y * 4.0, t * 0.05)));
  // Trame hexagonale, à peine visible, sur les côtés.
  float sides = smoothstep(0.45, 1.1, abs(p.x));
  col += vec3(0.02, 0.07, 0.26) * (1.0 - smoothstep(0.0, 0.03, hexEdge(p * 5.0))) * sides * band * 0.6;
  // Poussière lumineuse, qui scintille lentement (moins d'un battement par seconde).
  vec2 g = p * 26.0;
  vec2 id = floor(g);
  float h = hash21(id);
  vec2 f = fract(g) - 0.5 - (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.7;
  float twinkle = 0.5 + 0.5 * sin(t * (1.0 + 3.0 * h) + h * 40.0);
  col += vec3(0.25, 0.50, 1.0) * step(0.55, h) * twinkle * pow(0.004 / (dot(f, f) + 0.004), 2.0) * (0.2 + 0.8 * band);
  // Pistes de circuit, en miroir de part et d'autre : un plan net, un plan plus fin en retrait.
  vec2 q = vec2(abs(p.x), p.y);
  float side = p.x < 0.0 ? 17.0 : 0.0;
  vec2 near = circuits(q, 0.085, 1.0 + side, px);
  vec2 far = circuits(q + vec2(0.0, 0.021), 0.052, 40.0 + side, px);
  float breath = 0.75 + 0.25 * sin(t * 0.7 + q.x * 3.0);
  col += vec3(0.16, 0.42, 1.0) * (near.x * 0.55 + far.x * 0.22) * breath;
  col += vec3(0.40, 0.70, 1.0) * (near.y * 1.0 + far.y * 0.45);
  return col;
}

// ── La sphère ──

// La surface : globe en pointillés sous une peau de filaments, et arcs qui suivent la courbure en rampant.
vec3 surface(vec2 p, float r, float t) {
  float z = sqrt(1.0 - r * r);
  float a = t * 0.08;
  vec3 q = vec3(p.x * cos(a) + z * sin(a), p.y, -p.x * sin(a) + z * cos(a));
  vec3 w = q * 2.3 + 0.7 * vec3(fbm(q * 3.0 + t * 0.1), fbm(q * 3.0 + 7.0 - t * 0.07), fbm(q * 3.0 + 13.0));
  float veins = ridge(w + vec3(0.0, t * 0.08, 0.0));
  float fine = ridge(w * 3.1 - vec3(t * 0.12, 0.0, 0.0));
  float web = pow(veins, 2.6) * 1.5 + pow(fine, 3.2) * 0.9;
  float limb = pow(r, 4.0);
  vec3 col = vec3(0.006, 0.020, 0.090);
  // Globe : points sur la grille longitude/latitude, plus vifs sur les « continents ».
  float lat = asin(clamp(q.y, -1.0, 1.0));
  vec2 cell = fract(vec2(atan(q.x, q.z), lat) * 21.0) - 0.5;
  float dots = (1.0 - smoothstep(0.16, 0.30, length(cell))) * smoothstep(1.45, 1.15, abs(lat));
  float land = smoothstep(0.47, 0.53, fbm(q * 2.2 + 3.0));
  col += vec3(0.10, 0.34, 1.0) * dots * (0.10 + 0.8 * land) * (0.35 + 0.65 * z);
  col += vec3(0.02, 0.06, 0.36) * web * (0.20 + 1.0 * limb);
  col += vec3(0.10, 0.40, 1.00) * pow(web, 2.2) * (0.05 + 0.9 * limb);
  col += vec3(0.08, 0.42, 1.00) * pow(r, 16.0) * (0.2 + 2.4 * pow(veins, 1.5));
  col += vec3(0.70, 0.93, 1.00) * pow(r, 44.0) * (0.3 + 1.2 * fine);
  float lon = p.x / max(0.05, sqrt(1.0 - p.y * p.y));
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float life = t / (3.2 + 1.1 * fi) + fi * 0.5;
    float seed = floor(life) * 7.31 + fi * 19.0;
    float x0 = mix(-0.42, 0.34, fi) + (hash1(seed) - 0.5) * 0.25;
    float len = 1.25 + 0.3 * hash1(seed + 2.0);
    float along = 0.78 - 0.2 * hash1(seed + 1.0) - p.y;
    float drift = t * 0.4 + fi * 5.0;
    float I = bolt(along, lon - x0, len, seed, 0.034, drift);
    float fork = 0.35 + 0.3 * hash1(seed + 3.0);
    float lean = (along - fork * len) * (hash1(seed + 4.0) - 0.5) * 1.1;
    I += 0.6 * bolt(along - fork * len, lon - x0 - lean, len * 0.4, seed + 50.0, 0.02, drift);
    vec3 light = vec3(0.30, 0.62, 1.0) * 1.2 * I + vec3(1.0) * pow(I * 0.33, 3.0);
    col += light * lifeFade(fract(life)) * sqrt(z * z + 0.25);
  }
  return col;
}
// Orbites : ellipses inclinées dont la moitié arrière passe derrière la sphère, et nœuds lumineux qui les parcourent.
vec3 orbits(vec2 p, float r, float t) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float th = -0.55 + fi * 0.62 + 0.08 * sin(t * 0.1 + fi);
    vec2 o = vec2(p.x * cos(th) + p.y * sin(th), -p.x * sin(th) + p.y * cos(th));
    vec2 ab = vec2(1.42 + 0.13 * fi, 0.32 + 0.14 * fi);
    vec2 e = o / ab;
    float len = max(length(e), 1e-4);
    float d = abs(len - 1.0) * len / max(length(e / ab), 1e-4);
    float hidden = (r < 1.0 && o.y > 0.0) ? 0.10 : 1.0;
    col += vec3(0.25, 0.55, 1.0) * ((1.0 - smoothstep(0.004, 0.013, d)) * 0.5 + 0.0012 / (d + 0.02)) * hidden;
    for (int k = 0; k < 2; k++) {
      float ph = t * (0.22 + 0.06 * fi) * (mod(fi, 2.0) < 1.0 ? 1.0 : -1.0) + fi * 1.7 + float(k) * 2.6;
      vec2 n = ab * vec2(cos(ph), sin(ph));
      vec2 v = o - n;
      // Le nœud passe derrière la sphère en fondu, pas d'un coup.
      float behind = mix(1.0, 0.08, smoothstep(-0.25, 0.25, sin(ph)) * (1.0 - smoothstep(0.9, 1.1, length(n))));
      col += vec3(0.60, 0.86, 1.0) * 0.0005 / (dot(v, v) + 0.0003) * behind;
    }
  }
  return col;
}
// La couronne : filaments qui bouillonnent sur le bord, dedans comme dehors.
vec3 corona(vec2 p, float r, float t) {
  float rr = r - 1.0;
  vec2 dir = p / max(r, 1e-4);
  vec3 warp = vec3(fbm(vec3(p * 3.0, t * 0.25)), fbm(vec3(p * 3.0 + 9.0, t * 0.25)), fbm(vec3(p * 3.0 + 17.0, t * 0.2))) - 0.5;
  vec3 c = vec3(p * 3.6, t * 0.2) + warp * 1.6 - vec3(dir * t * 0.3, 0.0);
  float f1 = ridge(c);
  float f2 = ridge(c * 2.9 + 31.0);
  float f3 = ridge(c * 7.3 + 57.0);
  float fil = pow(f1, 2.6) * 1.5 + pow(f2, 3.0) * 1.1 + pow(f3, 3.2) * 0.8;
  float reach = pow(fbm(vec3(dir * 2.6, t * 0.6)), 1.6) * 3.4 + 0.12;
  float tongues = rr > 0.0 ? exp(-rr * 13.0 / reach) : exp(rr * 30.0);
  vec3 col = (vec3(0.04, 0.28, 1.0) * fil * 1.5 + vec3(0.35, 0.65, 1.0) * pow(fil, 2.2) * 0.7) * tongues;
  return col + vec3(0.5, 0.8, 1.0) * exp(-abs(rr) * 80.0) * (0.35 + 0.9 * pow(f2, 1.5));
}

// ── L'orage ──

// Les arcs : partis du bord de la sphère jusqu'aux bords de la page, ils restent allumés quelques secondes en rampant,
// puis s'éteignent en fondu et reviennent ailleurs. Un par cinquième de tour, pour entourer la sphère.
vec3 arcs(vec2 p, float t, vec2 page) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float life = t / (4.5 + 2.5 * hash1(fi * 7.1)) + hash1(fi * 3.3);
    float seed = floor(life) * 31.7 + fi * 57.0;
    float ang = (fi + hash1(seed)) * TAU / 5.0;
    vec2 ax = vec2(cos(ang), sin(ang));
    float along = dot(p, ax) - 0.99;
    float across = dot(p, vec2(-ax.y, ax.x));
    float len = toEdge(ax, page) * (0.6 + 0.4 * hash1(seed + 1.0));
    float drift = t * 0.2 + fi * 3.0;
    float I = bolt(along, across, len, seed, 0.024, drift);
    float fork = 0.3 + 0.35 * hash1(seed + 2.0);
    float slope = (hash1(seed + 3.0) - 0.5) * 1.4;
    I += 0.5 * bolt(along - fork * len, across - (along - fork * len) * slope, len * 0.45, seed + 70.0, 0.016, drift);
    vec3 tint = mix(vec3(0.25, 0.45, 1.0), vec3(0.62, 0.30, 1.0), smoothstep(0.0, 0.5, along / len));
    col += (tint * I * 1.3 + vec3(0.9, 0.9, 1.0) * pow(I * 0.33, 3.0)) * lifeFade(fract(life));
  }
  return col;
}
// La décharge du créneau n : un éclair du ciel (du haut ou du bas de la page) ou un éclair parti de la sphère, avec ses
// fourches. rgb = lumière, a = éclat local (pour la nuée).
vec4 strike(vec2 p, float r, float n, float t, vec2 page) {
  float seed = n * 13.37 + 5.0;
  if (hash1(seed) < 0.3) return vec4(0.0); // certains créneaux restent calmes
  float env = envelope(t - n * SLOT);
  if (env < 0.003) return vec4(0.0);
  bool sky = hash1(seed + 1.0) < 0.45;
  vec2 o;
  vec2 ax;
  float len;
  if (sky) {
    float up = hash1(seed + 2.0) < 0.3 ? -1.0 : 1.0;
    float ang = (hash1(seed + 4.0) - 0.5) * 1.1;
    o = vec2((hash1(seed + 3.0) - 0.5) * 1.8 * page.x, page.y * up);
    ax = vec2(sin(ang), -cos(ang) * up);
    len = 2.0 * page.y * (0.55 + 0.6 * hash1(seed + 5.0));
  } else {
    float ang = hash1(seed + 3.0) * TAU;
    ax = vec2(cos(ang), sin(ang));
    o = ax * 0.99;
    len = toEdge(ax, page) * (0.75 + 0.35 * hash1(seed + 5.0));
  }
  vec2 d = p - o;
  float along = dot(d, ax);
  float across = dot(d, vec2(-ax.y, ax.x));
  float I = bolt(along, across, len, seed, 0.032, 0.0);
  float f1 = 0.25 + 0.3 * hash1(seed + 6.0);
  float s1 = (hash1(seed + 7.0) - 0.5) * 1.4;
  I += 0.55 * bolt(along - f1 * len, across - (along - f1 * len) * s1, len * 0.45, seed + 70.0, 0.02, 0.0);
  float f2 = 0.5 + 0.25 * hash1(seed + 8.0);
  I += 0.45 * bolt(along - f2 * len, across + (along - f2 * len) * s1 * 0.8, len * 0.35, seed + 130.0, 0.017, 0.0);
  vec3 tint = mix(vec3(0.28, 0.5, 1.0), vec3(0.62, 0.32, 1.0), hash1(seed + 9.0));
  float sheet = exp(-abs(across) * 1.1) * step(0.0, along) * smoothstep(len * 1.2, len * 0.5, along);
  vec3 col = (tint * I * 1.6 + vec3(0.92, 0.9, 1.0) * pow(I * 0.33, 3.0) + tint * 0.05 * sheet) * env;
  if (sky) col *= mix(0.15, 1.0, smoothstep(0.98, 1.02, r)); // un éclair du ciel passe derrière le globe
  return vec4(col, env * sheet);
}
// La nuée : les filaments de la couronne étalés sur toute la page, par bancs qui vont et viennent ; une décharge
// l'éclaire autour d'elle, doucement.
vec3 stormField(vec2 p, float t, float glow) {
  vec3 warp = vec3(fbm(vec3(p * 1.4, t * 0.12)), fbm(vec3(p * 1.4 + 9.0, t * 0.12)), 0.5) - 0.5;
  vec3 c = vec3(p * 1.9, t * 0.1) + warp * 1.8;
  float fil = pow(ridge(c), 3.0) * 1.4 + pow(ridge(c * 2.7 + 31.0), 3.4) * 0.8;
  float bank = smoothstep(0.35, 0.7, fbm(vec3(p * 0.9 + 20.0, t * 0.3)));
  vec3 col = vec3(0.03, 0.14, 0.75) * fil + vec3(0.25, 0.5, 1.0) * pow(fil, 2.4) * 0.6;
  return col * (0.2 + 0.8 * bank) * (0.45 + 0.35 * min(glow, 1.0));
}

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  float t = uTime;
  vec2 sp = p / RADIUS;
  float r = length(sp);
  float rr = r - 1.0;
  vec2 page = vec2(uRes.x / uRes.y, 1.0) / RADIUS; // demi-page, en rayons de sphère
  float n = floor(t / SLOT);
  vec4 s0 = strike(sp, r, n, t, page);
  vec4 s1 = strike(sp, r, n - 1.0, t, page);
  vec3 col = backdrop(p, t) + stormField(p, t, s0.a + s1.a);
  if (r < 1.0) col = mix(col, surface(sp, r, t), smoothstep(1.0, 0.985, r));
  col += orbits(sp, r, t);
  if (r < 2.4) col += corona(sp, r, t);
  if (rr > -0.02) col += arcs(sp, t, page);
  col += s0.rgb + s1.rgb;
  // Brume : bleue près de la sphère, violette plus loin.
  if (rr > 0.0) col += vec3(0.02, 0.07, 0.42) * exp(-rr * 4.0) * 0.7 + vec3(0.12, 0.04, 0.34) * exp(-rr * 1.6) * 0.22;
  col *= uPower * (1.0 - 0.4 * smoothstep(0.9, 2.2, length(p * vec2(0.55, 1.0))));
  gl_FragColor = vec4(col, 1.0);
}
