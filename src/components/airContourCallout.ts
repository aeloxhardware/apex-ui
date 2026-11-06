import * as BABYLON from 'babylonjs';
import type { ParsedGCode } from './gcodeParse';
import type { LineTypeVisibility } from './gcodeLineTypes';
import type { GCodeLayer } from './gcodeLayer';
import { isFlatUi } from '@/utils/interfaceMode';

/**
 * Infobulle ancrée aux contours imprimés dans l'air (type `airContour`, cf. gcodeAirContours.ts) : une
 * carte posée à côté de la pièce, avec un trait vers chaque contour, qui explique le risque de collision
 * et qu'Apex peut les supprimer. Calque DOM par-dessus le canvas, repositionné à chaque image.
 * Piloté par Viewport3D comme le contrôleur d'édition (`createGCodeEditController`).
 */

const MAX_LEADERS = 6;
const CARD_WIDTH_PX = 250;
const CARD_OFFSET_PX = { x: 70, y: -90 };
const RED = '#ff0000';
const SVG_NS = 'http://www.w3.org/2000/svg';
const PULSE_STYLE_ID = 'apex-air-pulse-style';

/** Demande de suppression (écoutée par use-gcode-preview.ts). */
export const AIR_CONTOURS_REMOVE_EVENT = 'apex-air-contours-remove';

const AIR_CONTOUR_TOOLTIP =
  "Le fork de PrusaSlicer ayant généré ce G-Code est connu pour buggé et génère des trajectoires dans l'air pouvant engendrer des collisions. Apex peut tenter de les supprimer.";

interface Options {
  scene: BABYLON.Scene;
  engine: BABYLON.Engine;
  camera: BABYLON.Camera;
  canvas: HTMLCanvasElement;
  layer: GCodeLayer;
  isPreviewActive: () => boolean;
}

/** Carte (texte, bouton de suppression, croix de fermeture) ; l'interface classique n'a ni flou, ni ombre, ni animation. */
function buildCard(flat: boolean) {
  const card = document.createElement('div');
  card.setAttribute('data-apex-tooltip', AIR_CONTOUR_TOOLTIP);
  card.style.cssText = [
    'position:absolute;left:0;top:0;box-sizing:border-box;padding:10px 12px;pointer-events:auto;',
    `width:${CARD_WIDTH_PX}px;font:12px/1.4 system-ui,sans-serif;color:#fff;`,
    // Interface classique : ni flou, ni ombre, ni animation (cf. CLAUDE.md).
    flat
      ? 'background:#000;border:1px solid #fff;'
      : 'background:rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;'
        + 'backdrop-filter:blur(6px) saturate(1.1);-webkit-backdrop-filter:blur(6px) saturate(1.1);'
        + 'box-shadow:0 10px 30px rgba(0,0,0,0.5);',
  ].join('');
  // Filtre rouge qui pulse à 1 Hz derrière le texte.
  if (!flat) {
    if (!document.getElementById(PULSE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = PULSE_STYLE_ID;
      style.textContent = '@keyframes apexAirPulse{0%,100%{opacity:.04}50%{opacity:.2}}';
      document.head.appendChild(style);
    }
    const tint = document.createElement('div');
    tint.style.cssText = `position:absolute;inset:0;background:${RED};pointer-events:none;animation:apexAirPulse 1s ease-in-out infinite;`;
    card.appendChild(tint);
  }
  const title = document.createElement('div');
  title.style.cssText = 'position:relative;font-weight:600;margin-bottom:4px;padding-right:16px;';
  const body = document.createElement('div');
  body.style.position = 'relative';
  body.textContent = AIR_CONTOUR_TOOLTIP;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Masquer');
  close.style.cssText = 'position:absolute;z-index:1;top:2px;right:6px;border:0;background:none;color:#fff;font-size:16px;cursor:pointer;';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = "Supprimer les contours en l'air";
  remove.setAttribute('data-apex-tooltip', "Retire du G-code les contours imprimés dans l'air et affiche le résultat ; le fichier d'origine n'est pas modifié, une copie est enregistrée à l'export.");
  remove.style.cssText = [
    'position:relative;display:block;width:100%;margin-top:10px;padding:7px 10px;cursor:pointer;color:#fff;font:inherit;font-weight:600;',
    flat ? 'background:#000;border:1px solid #fff;' : 'background:rgba(255,255,255,0.14);border:0;border-radius:9px;',
  ].join('');
  remove.addEventListener('click', () => window.dispatchEvent(new CustomEvent(AIR_CONTOURS_REMOVE_EVENT)));
  card.append(title, body, remove, close);
  return { card, title, close };
}

/** Projette un point local du plateau en pixels CSS du canevas (vue × projection de la caméra de la vue). */
function createProjector({ engine, camera, canvas, layer }: Pick<Options, 'engine' | 'camera' | 'canvas' | 'layer'>) {
  const scratchWorld = new BABYLON.Vector3();
  const scratchTransform = new BABYLON.Matrix();

  return (local: BABYLON.Vector3) => {
    BABYLON.Vector3.TransformCoordinatesToRef(local, layer.getPlateWorldMatrix(), scratchWorld);
    // Vue × projection de la caméra de la vue (cf. gcodeEditController.project).
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), scratchTransform);
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = BABYLON.Vector3.Project(scratchWorld, BABYLON.Matrix.IdentityReadOnly, scratchTransform, viewport);
    const s = canvas.clientWidth / Math.max(1, engine.getRenderWidth());
    return { x: p.x * s, y: p.y * s, z: p.z };
  };
}

/** Un trait (avec point) par ancre, redessiné dans le calque SVG. */
function rebuildLeaders(svg: SVGSVGElement, lines: SVGGElement[], count: number) {
  for (const g of lines) g.remove();
  lines.length = 0;
  for (let i = 0; i < count; i++) {
    const g = document.createElementNS(SVG_NS, 'g');
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', RED);
    line.setAttribute('stroke-width', '1.5');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', RED);
    g.append(line, dot);
    svg.appendChild(g);
    lines.push(g);
  }
}

/** Ancres : milieu de chaque contour (au plus `MAX_LEADERS`, les plus longs d'abord), et leur nombre. */
function anchorsOf(parsed: ParsedGCode | null, layer: GCodeLayer): { anchors: BABYLON.Vector3[]; count: number } {
  const ranges = parsed?.airContours;
  if (!parsed || !ranges || !ranges.length) return { anchors: [], count: 0 };
  const list: { mid: number; len: number }[] = [];
  for (let r = 0; r < ranges.length; r += 2) list.push({ mid: (ranges[r] + ranges[r + 1]) >> 1, len: ranges[r + 1] - ranges[r] });
  list.sort((a, b) => b.len - a.len);
  return { anchors: list.slice(0, MAX_LEADERS).map(({ mid }) => layer.getMoveTip(mid, new BABYLON.Vector3()).clone()), count: ranges.length / 2 };
}

export function createAirContourCallout({ scene, engine, camera, canvas, layer, isPreviewActive }: Options) {
  const host = canvas.parentElement;
  const flat = isFlatUi();
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;display:none;z-index:5;';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible;';
  const { card, title, close } = buildCard(flat);
  root.append(svg, card);
  host?.appendChild(root);

  let anchors: BABYLON.Vector3[] = [];
  let dismissed = false;
  let typeVisible = true;
  const lines: SVGGElement[] = [];
  const project = createProjector({ engine, camera, canvas, layer });

  const rebuildLines = () => rebuildLeaders(svg, lines, anchors.length);

  const show = () => root.style.display = anchors.length && !dismissed && typeVisible && isPreviewActive() ? 'block' : 'none';

  const place = () => {
    if (root.style.display === 'none') return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pts = anchors.map(project);
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    // Carte au-dessus et à droite du centre des contours, gardée dans la fenêtre.
    const cardH = card.offsetHeight;
    const left = Math.min(Math.max(8, cx + CARD_OFFSET_PX.x), Math.max(8, w - CARD_WIDTH_PX - 8));
    const top = Math.min(Math.max(8, cy + CARD_OFFSET_PX.y - cardH), Math.max(8, h - cardH - 8));
    card.style.transform = `translate(${left}px,${top}px)`;
    const fromX = left + CARD_WIDTH_PX / 2, fromY = top + cardH;
    pts.forEach((p, i) => {
      const g = lines[i];
      const line = g.firstChild as SVGLineElement, dot = g.lastChild as SVGCircleElement;
      line.setAttribute('x1', String(fromX)); line.setAttribute('y1', String(fromY));
      line.setAttribute('x2', String(p.x)); line.setAttribute('y2', String(p.y));
      dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y));
    });
  };

  const observer = scene.onAfterRenderObservable.add(place);
  close.addEventListener('click', () => { dismissed = true; show(); });

  const setParsed = (parsed: ParsedGCode | null) => {
    const found = anchorsOf(parsed, layer);
    anchors = found.anchors;
    dismissed = false;
    if (found.count) title.textContent = `${found.count} contour${found.count > 1 ? 's' : ''} dans l'air détecté${found.count > 1 ? 's' : ''}`;
    rebuildLines();
    show();
  };

  return {
    setParsed,
    setPreviewActive: show,
    /** Masquée avec le type « Contour en l'air » de la légende. */
    setLineVisibility(visibility: LineTypeVisibility) { typeVisible = visibility.airContour !== false; show(); },
    dispose() {
      scene.onAfterRenderObservable.remove(observer);
      root.remove();
    },
  };
}
