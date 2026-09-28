import * as BABYLON from 'babylonjs';
import type { ColorByRange, ContinuousColorByMode, GCodeMove, ParsedGCode } from './gcodeLayer';

/**
 * Dégradé numérique → couleur, partagé par tous les modes de coloration continus (« colorer par »,
 * cf. GCodeLineTypeLegend.tsx et ParsedGCode.ranges). Le type de ligne reste hors de ce module :
 * coloration catégorielle (LINE_TYPES[].color), jamais un dégradé.
 */

/** Points d'arrêt de la rampe (bleu foncé → cyan → jaune → rouge), en RGB [0,1] — mêmes valeurs que
 * la barre CSS de la légende (cf. GCodeLineTypeLegend.module.scss) pour rester visuellement
 * identiques entre le viewport et la légende. */
export const COLORMAP_STOPS_HEX = ['#1e2f97', '#00c2d1', '#ffd23f', '#ff3b30'] as const;

const STOPS = COLORMAP_STOPS_HEX.map((hex) => BABYLON.Color3.FromHexString(hex));

/** Ramène `value` dans [0, 1] par rapport à `range` (bornes min/max seulement — accepte aussi bien
 * un `ColorByRange` complet qu'un `ColorByScope`) ; 0.5 si l'intervalle est vide (min === max)
 * plutôt qu'une division par zéro. */
export function normalize(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (!(span > 1e-9)) return 0.5;
  return Math.max(0, Math.min(1, (value - range.min) / span));
}

/** Couleur grise des trajectoires hors de la portée choisie (case « hors-portée en gris » cochée,
 * cf. GCodeLineTypeLegend.tsx) — même gris que .dash dans la légende (rgba(255,255,255,0.25)). */
const OUT_OF_SCOPE_GRAY = new BABYLON.Color3(0.4, 0.4, 0.4);

/**
 * Portée affichée d'un mode continu (curseurs min/max de la légende, cf. GCodeLineTypeLegend.tsx) :
 * RECADRE la rampe entière sur cet intervalle (les valeurs qu'il contient s'étalent sur tout le
 * dégradé bleu→rouge), au lieu de simplement masquer ce qui est en dehors. `min`/`max` sont les
 * bornes choisies par l'utilisateur (⊆ ColorByRange du fichier) ; `grayOutOfScope` détermine le
 * traitement des valeurs hors de cet intervalle : grises si vrai, écrêtées à la couleur extrême de
 * la rampe la plus proche si faux (cf. `colorForScope`).
 */
export interface ColorByScope {
  min: number;
  max: number;
  grayOutOfScope: boolean;
}

/** Portée par défaut d'un mode : les bornes réelles du fichier, hors-portée jamais possible tant
 * qu'on ne les a pas resserrées (grayOutOfScope sans effet dans ce cas). */
export function defaultColorByScope(range: ColorByRange): ColorByScope {
  return { min: range.min, max: range.max, grayOutOfScope: false };
}

/** Couleur de la rampe à la fraction `t` ∈ [0, 1], écrite dans `out` (pas d'allocation par appel —
 * important pour le tronçon vivant, recalculé chaque image). */
export function colormapAt(t: number, out: BABYLON.Color3): BABYLON.Color3 {
  const clamped = Math.max(0, Math.min(1, t));
  const span = (STOPS.length - 1) * clamped;
  const i = Math.min(STOPS.length - 2, Math.floor(span));
  const f = span - i;
  BABYLON.Color3.LerpToRef(STOPS[i], STOPS[i + 1], f, out);
  return out;
}

/** Unité affichée pour chaque mode continu (cf. `formatColorByValue` dans GCodeLineTypeLegend.tsx). */
export const COLOR_BY_UNITS: Record<ContinuousColorByMode, string> = {
  speed: 'mm/s',
  accel: 'mm/s²',
  headAngle: '°',
  segmentLength: 'mm',
  elapsedTime: 's',
  extrusionRatio: 'mm/mm',
  volumetricFlow: 'mm³/s',
  layerSpeedRatio: '%',
  lineWidth: 'mm',
  layerHeight: 'mm',
  temperature: '°C',
  fanSpeed: '%',
};

/** Libellé court affiché dans le sélecteur et l'en-tête de la légende. */
export const COLOR_BY_LABELS: Record<ContinuousColorByMode, string> = {
  speed: 'Vitesse',
  accel: 'Accélération',
  headAngle: 'Inclinaison de la tête',
  segmentLength: 'Longueur de segment',
  elapsedTime: 'Temps écoulé',
  extrusionRatio: "Pression d'extrusion",
  volumetricFlow: 'Débit volumétrique',
  layerSpeedRatio: 'Vitesse / vitesse max de couche',
  lineWidth: 'Largeur de ligne',
  layerHeight: 'Hauteur de couche',
  temperature: 'Température',
  fanSpeed: 'Vitesse du ventilateur',
};

/** Valeur brute d'un mode continu au mouvement `k` — mêmes formules que l'agrégation des `ranges`
 * dans `parseGCode` (débit volumétrique, pression d'extrusion, vitesse relative de couche), à
 * partir de `depositMm`/`filamentDiameterMm` qu'il expose pour cette seule raison : rester
 * fidèle au calcul source plutôt que ré-estimer un ratio approximatif ici. */
export function valueForMode(mode: ContinuousColorByMode, k: number, parsed: ParsedGCode): number {
  const mv: GCodeMove = parsed.moves[k];
  switch (mode) {
    case 'speed': return parsed.speedMmS[k];
    case 'accel': return parsed.accelMmS2[k];
    case 'headAngle': return Math.abs(mv.b);
    case 'segmentLength': return parsed.segLengthMm[k];
    case 'elapsedTime': return parsed.times[k];
    case 'lineWidth': return parsed.widthMm[k];
    case 'layerHeight': return parsed.layerHeightMm[k];
    case 'temperature': return parsed.nozzleTempC[k];
    case 'fanSpeed': return parsed.fanPct[k];
    case 'extrusionRatio': {
      const len = parsed.segLengthMm[k];
      if (!mv.extruding || len <= 1e-6) return NaN;
      return parsed.depositMm[k] / len;
    }
    case 'volumetricFlow': {
      const dt = k > 0 ? parsed.times[k] - parsed.times[k - 1] : 0;
      if (!mv.extruding || dt <= 0) return NaN;
      const volumeMm3 = parsed.depositMm[k] * Math.PI * (parsed.filamentDiameterMm / 2) ** 2;
      return volumeMm3 / dt;
    }
    case 'layerSpeedRatio': {
      const maxSpeed = parsed.layerMaxSpeedMmS[k];
      if (!mv.extruding || maxSpeed <= 1e-6) return NaN;
      return (parsed.speedMmS[k] / maxSpeed) * 100;
    }
  }
}

/**
 * Couleur pour le mode `mode` au mouvement `k`, écrite dans `out`, recadrée sur `scope` (curseurs
 * min/max de la légende) plutôt que sur le min/max complet du fichier : les valeurs contenues dans
 * `scope` s'étalent sur toute la rampe, celles en dehors sont grisées ou écrêtées à l'extrême le
 * plus proche selon `scope.grayOutOfScope`. Le mode catégoriel (« lineType ») n'est jamais routé
 * ici — ses couleurs viennent directement de LINE_TYPES.
 */
export function colorForMode(
  mode: ContinuousColorByMode,
  k: number,
  parsed: ParsedGCode,
  scope: ColorByScope,
  out: BABYLON.Color3,
): BABYLON.Color3 {
  const value = valueForMode(mode, k, parsed);
  if (Number.isNaN(value)) return colormapAt(0.5, out);
  if (scope.grayOutOfScope && (value < scope.min || value > scope.max)) {
    return out.copyFrom(OUT_OF_SCOPE_GRAY);
  }
  // `normalize` écrête déjà en [0,1] (Math.max/Math.min), donc une valeur hors de [scope.min,
  // scope.max] retombe naturellement sur 0 ou 1 — l'extrême de rampe le plus proche — quand
  // grayOutOfScope est faux : pas de branche séparée nécessaire pour l'écrêtage.
  const t = normalize(value, scope);
  return colormapAt(t, out);
}
