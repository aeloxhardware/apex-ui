/**
 * Courbes d'accélération de l'interface. `APEX_EASE` est la courbe `cubic-bezier(0.16, 1, 0.3, 1)` déjà utilisée
 * par les menus et les panneaux (souvent attribuée à Emil Kowalski) ; Framer Motion la prend telle quelle, le
 * moteur 3D la calcule ici.
 */

/** Courbe de Bézier cubique (x1, y1, x2, y2), comme CSS `cubic-bezier` : renvoie y pour un x dans [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const sampleX = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const sampleY = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const derivativeX = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton pour retrouver t tel que sampleX(t) = x, puis bissection si la pente s'annule.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      const slope = derivativeX(t);
      if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    if (!(t >= 0 && t <= 1) || Math.abs(sampleX(t) - x) > 1e-5) {
      let low = 0;
      let high = 1;
      t = x;
      for (let i = 0; i < 40; i++) {
        if (sampleX(t) < x) low = t; else high = t;
        t = (low + high) / 2;
      }
    }
    return sampleY(t);
  };
}

export const apexEase = cubicBezier(0.16, 1, 0.3, 1);
