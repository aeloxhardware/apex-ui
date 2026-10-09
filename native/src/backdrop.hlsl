// Verre liquide natif (native/src/backdrop.cpp) : shaders compiles a la CONSTRUCTION par fxc (CMakeLists.txt),
// jamais au lancement (D3DCompile bloquait le thread de l'interface ~350 ms).
// Le verre est le « Liquid Glass Studio » de Charles Yin (MIT, https://github.com/iyinchao/liquid-glass-studio) ;
// conversions de couleur de GLSL-Color-Functions (Rachmanin0xFF, MIT).
cbuffer C : register(b0) {
  float2 winPos;    // coin haut-gauche de la fenetre dans la texture du bureau (px)
  float2 size;      // taille de la fenetre (px)
  float2 texSize;   // taille de la texture du bureau
  float2 blurSize;  // taille des textures de flou (fenetre + marge de chaque cote)
  float margin;     // marge (px)
  float corner;     // rayon des coins (px)
  float scale;      // echelle DPI (px physiques par px CSS)
  float radius;     // rayon de la lentille (px) : porte l'epaisseur du verre
  float sigma;      // ecart type du flou (px)
  float tint;       // assombrissement (lisibilite du texte), 0 = aucun
  float shadowPad;  // marge de la fenetre de verre autour de la fenetre (px) : place de l'ombre portee
  float pad;
};
Texture2D src : register(t0);    // fond FLOU (fenetre + marge)
SamplerState lin : register(s0);

struct VSOut { float4 pos : SV_POSITION; };
VSOut vs(uint id : SV_VertexID) {
  float2 t = float2((id << 1) & 2, id & 2);
  VSOut o;
  o.pos = float4(t * float2(2, -2) + float2(-1, 1), 0, 1);
  return o;
}

// ---- flou gaussien separable : le fond est lu sur la fenetre + une marge (la refraction tire le fond de
// ---- jusqu'a ~66 px hors de la fenetre).
float4 blurLine(float2 center, float2 step) {
  int taps = sigma < 0.05 ? 0 : (int)min(32.0, ceil(sigma * 3.0));  // 0 : pas de flou
  float4 sum = src.SampleLevel(lin, center, 0);
  float wsum = 1.0;
  [loop] for (int k = 1; k <= 32; ++k) {
    if (k > taps) break;
    float w = exp(-0.5 * k * k / (sigma * sigma));
    sum += (src.SampleLevel(lin, center + step * k, 0) + src.SampleLevel(lin, center - step * k, 0)) * w;
    wsum += 2.0 * w;
  }
  return sum / wsum;
}
float4 psBlurH(VSOut i) : SV_Target {
  float2 d = winPos - margin + i.pos.xy;      // pixel du bureau
  return blurLine(d / texSize, float2(1.0 / texSize.x, 0));
}
float4 psBlurV(VSOut i) : SV_Target {
  return blurLine(i.pos.xy / blurSize, float2(0, 1.0 / blurSize.y));
}

// ---- Liquid Glass Studio (Charles Yin), reglages DEFAULT_GLASS de l'application ----
static const float PI = 3.14159265359;
// Reglages du Liquid Glass Studio : epaisseur 66,46 px, distance du fond 0,04 (= 0,04 x 1414 ~ 56,6 px de decalage
// maximal, voir u_refDistance / getNormal du shader du Studio), indice 2,56, dispersion 3,69.
static const float THICKNESS_PX = 66.46, REF_INDEX = 2.56, DISTANCE_PX = 56.57, DISPERSION = 3.69;
static const float FRESNEL_RANGE = 30.0, FRESNEL_HARDNESS = 0.2, FRESNEL_FACTOR = 0.2;
static const float GLARE_RANGE = 30.0, GLARE_HARDNESS = 0.2, GLARE_FACTOR = 0.9;
static const float GLARE_CONVERGENCE = 0.5, GLARE_OPPOSITE = 0.8, GLARE_ANGLE = -0.78539816339;
// Ombre portee de la fenetre (reglages du Studio : expansion 25 px, decalage 10 px vers le bas), dessinee dans la marge.
static const float SHADOW_EXPAND_PX = 26.0, SHADOW_OFFSET_PX = 10.0, SHADOW_INTENSITY = 0.5;
// Teinte dynamique (ni binaire, ni permanente) : sous TINT_START la luminosite dominante du fond derriere la fenetre ne
// change rien ; au-dela, une legere teinte sombre croit progressivement jusqu'a TINT_MAX (atteinte a TINT_FULL).
static const float TINT_START = 0.60, TINT_FULL = 0.90, TINT_MAX = 0.45;
static const float N_R = 0.98, N_G = 1.0, N_B = 1.02;
static const float3 WHITE = float3(0.95045592705, 1.0, 1.08905775076);

float uncompand(float a) { return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92; }
float compand(float a) { return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055; }
float labF(float x) { return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448; }
float labFInv(float x) { return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034); }
float3 srgbToLch(float3 c) {
  float3 l = float3(uncompand(c.x), uncompand(c.y), uncompand(c.z));
  float3 xyz = float3(dot(l, float3(0.4124, 0.3576, 0.1805)), dot(l, float3(0.2126, 0.7152, 0.0722)),
                      dot(l, float3(0.0193, 0.1192, 0.9505))) / WHITE;
  xyz = float3(labF(xyz.x), labF(xyz.y), labF(xyz.z));
  float3 lab = float3(116.0 * xyz.y - 16.0, 500.0 * (xyz.x - xyz.y), 200.0 * (xyz.y - xyz.z));
  return float3(lab.x, length(lab.yz), atan2(lab.z, lab.y) * 57.2957795131);
}
float3 lchToSrgb(float3 lch) {
  float3 lab = float3(lch.x, lch.y * cos(lch.z * 0.01745329251), lch.y * sin(lch.z * 0.01745329251));
  float w = (lab.x + 16.0) / 116.0;
  float3 xyz = WHITE * float3(labFInv(w + lab.y / 500.0), labFInv(w), labFInv(w - lab.z / 200.0));
  float3 rgb = float3(dot(xyz, float3(3.2406255, -1.537208, -0.4986286)), dot(xyz, float3(-0.9689307, 1.8757561, 0.0415175)),
                      dot(xyz, float3(0.0557101, -0.2040211, 1.0569959)));
  return float3(compand(rgb.x), compand(rgb.y), compand(rgb.z));
}

// p : pixels de la fenetre, origine en BAS a gauche (comme le GLSL d'origine) ; offset dans le meme repere.
// Fond flou partout (option « Blur Edge » cochee du Studio) : un seul fond, lu avec la dispersion chromatique.
float3 sampleDispersion(float2 p, float2 offset) {
  float2 base = float2(p.x, size.y - p.y);
  float2 oR = offset * (1.0 - (N_R - 1.0) * DISPERSION);
  float2 oG = offset * (1.0 - (N_G - 1.0) * DISPERSION);
  float2 oB = offset * (1.0 - (N_B - 1.0) * DISPERSION);
  float2 dR = float2(oR.x, -oR.y), dG = float2(oG.x, -oG.y), dB = float2(oB.x, -oB.y);
  return float3(src.SampleLevel(lin, (base + margin + dR) / blurSize, 0).r,
                src.SampleLevel(lin, (base + margin + dG) / blurSize, 0).g,
                src.SampleLevel(lin, (base + margin + dB) / blurSize, 0).b);
}

float lensSd(float2 p) {
  float2 d = p - size * 0.5;
  float2 q = abs(d) - (size * 0.5 - corner);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
}

// Deplacement de Snell au point situe a `inside` px du bord (0 au-dela de `thickness`).
float snellEdge(float inside, float thickness) {
  float x = 1.0 - inside / thickness;
  float thetaI = asin(clamp(x * x, -1.0, 1.0));
  float thetaT = asin(clamp(sin(thetaI) / REF_INDEX, -1.0, 1.0));
  return inside >= thickness ? 0.0 : -tan(thetaT - thetaI);
}

// Opacite de l'ombre portee au point p (repere de la fenetre, y vers le haut).
float shadowAt(float2 p) {
  float d = lensSd(p + float2(0, SHADOW_OFFSET_PX * scale));  // forme decalee vers le bas
  float t = 1.0 - smoothstep(-0.25 * SHADOW_EXPAND_PX * scale, SHADOW_EXPAND_PX * scale, d);
  return SHADOW_INTENSITY * t * t;
}

void glassAt(float2 p, out float3 glass, out float coverage) {
  float sd = lensSd(p);
  if (sd > 1.5) { glass = float3(0, 0, 0); coverage = 0.0; return; }  // hors verre : seule l'ombre compte
  float inside = max(-sd, 0.0);
  float thickness = max(THICKNESS_PX * scale, 1.0);
  // Pas large pour la normale d'un rectangle arrondi : evite la couture le long des diagonales des coins.
  float eps = max(1.0, 0.3 * thickness);
  float2 g = float2(lensSd(p + float2(eps, 0)) - lensSd(p - float2(eps, 0)),
                    lensSd(p + float2(0, eps)) - lensSd(p - float2(0, eps)));
  float2 normal = normalize(g + float2(1e-6, 1e-6));

  // Refraction de Snell (profil exact de l'interface) : nulle au-dela de l'epaisseur, maximale au bord.
  float edgeFactor = snellEdge(inside, thickness);
  float2 offsetPx = -normal * edgeFactor * DISTANCE_PX * scale;
  glass = sampleDispersion(p, offsetPx);

  // Fresnel : liseré clair au bord (distances en px CSS).
  float dCss = -inside / scale;
  float fresnel = clamp(pow(max(1.0 + dCss / 1500.0 * pow(500.0 / FRESNEL_RANGE, 2.0) + FRESNEL_HARDNESS, 0.0), 5.0), 0.0, 1.0);
  glass = lerp(glass, float3(1, 1, 1), fresnel * FRESNEL_FACTOR * 0.7);

  // Reflet directionnel.
  float glareGeo = clamp(pow(max(1.0 + dCss / 1500.0 * pow(500.0 / GLARE_RANGE, 2.0) + GLARE_HARDNESS, 0.0), 5.0), 0.0, 1.0);
  float a = atan2(normal.y, normal.x);
  if (a < 0.0) a += 2.0 * PI;
  float glareAngle = (a - PI / 4.0 + GLARE_ANGLE) * 2.0;
  bool farSide = (glareAngle > PI * 1.5 && glareAngle < PI * 3.5) || glareAngle < -PI * 0.5;
  float glareF = (0.5 + sin(glareAngle) * 0.5) * (farSide ? 1.2 * GLARE_OPPOSITE : 1.2) * GLARE_FACTOR;
  glareF = clamp(pow(max(glareF, 0.0), 0.1 + GLARE_CONVERGENCE * 2.0), 0.0, 1.0);
  float3 glareLch = srgbToLch(glass);
  glareLch.x = clamp(glareLch.x + 150.0 * glareF * glareGeo, 0.0, 120.0);
  glareLch.y += 30.0 * glareF * glareGeo;
  glass = lerp(glass, clamp(lchToSrgb(glareLch), 0.0, 1.0), glareF * glareGeo);

  coverage = 1.0 - smoothstep(-0.75, 0.75, sd);
}

// Luminosite dominante du fond derriere la fenetre : moyenne d'une grille de 8 x 5 points du fond flou.
float dominantLuminance() {
  float sum = 0.0;
  [unroll] for (int gy = 0; gy < 5; ++gy) {
    [unroll] for (int gx = 0; gx < 8; ++gx) {
      float2 px = float2((gx + 0.5) / 8.0 * size.x, (gy + 0.5) / 5.0 * size.y) + margin;
      sum += dot(src.SampleLevel(lin, px / blurSize, 0).rgb, float3(0.2126, 0.7152, 0.0722));
    }
  }
  return sum / 40.0;
}

float4 psMain(VSOut i) : SV_Target {
  // La fenetre de verre deborde de `shadowPad` px de chaque cote (ombre portee) : origine ramenee a la fenetre.
  float2 p0 = float2(i.pos.x - shadowPad, size.y - (i.pos.y - shadowPad));  // repere d'origine : y vers le haut
  // Suréchantillonnage 2x2 (bord, reflets, liseré), comme l'original.
  float3 sum = float3(0, 0, 0);
  float cov = 0.0, sh = 0.0;
  [unroll] for (int k = 0; k < 4; ++k) {
    float2 o = (float2(k - (k / 2) * 2, k / 2) - 0.5) * 0.5;
    float3 gl; float c;
    glassAt(p0 + o, gl, c);
    sum += gl * c;
    cov += c;
    sh += shadowAt(p0 + o);
  }
  float3 rgb = cov > 0.0 ? sum / cov : float3(0, 0, 0);
  float dyn = sqrt(smoothstep(TINT_START, TINT_FULL, dominantLuminance())) * TINT_MAX;  // racine : teinte deja nette des le declenchement
  rgb = lerp(rgb, float3(0.07, 0.08, 0.10), max(tint, dyn));
  float a = cov * 0.25;
  float shadow = sh * 0.25 * (1.0 - a);              // l'ombre n'existe que hors du verre
  float alpha = a + shadow;
  return float4(saturate(rgb) * a, alpha);           // alpha premultiplie : l'ombre est noire (rgb 0)
}
