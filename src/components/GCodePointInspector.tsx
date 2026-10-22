import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { GCodePick, ParsedGCode } from './gcodeLayer';
import { LINE_TYPE_BY_ID } from './gcodeLineTypes';

interface PickDetail {
  parsed: ParsedGCode;
  pick: GCodePick | null;
}

const num = (v: number, digits = 2, unit = '') =>
  Number.isFinite(v) ? `${v.toFixed(digits).replace('.', ',')}${unit}` : '—';

/**
 * Outil d'inspection du tracé : affiche le point cliqué dans le viewport (`apex-gcode-pick`,
 * émis par Viewport3D), la ligne du fichier G-code qui l'a produit et toutes les données connues
 * du mouvement correspondant.
 */
export const GCodePointInspector: React.FC = () => {
  const [detail, setDetail] = useState<PickDetail | null>(null);
  // Position choisie par l'utilisateur (px, dans le calque parent) ; null = ancrage par défaut.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const box = panel.getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    const grabX = e.clientX - box.left;
    const grabY = e.clientY - box.top;
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - parentBox.left - grabX;
      const y = ev.clientY - parentBox.top - grabY;
      setPos({
        x: Math.max(0, Math.min(parentBox.width - 60, x)),
        y: Math.max(0, Math.min(parentBox.height - 40, y)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };

  useEffect(() => {
    const onPick = (e: Event) => setDetail((e as CustomEvent<PickDetail>).detail ?? null);
    window.addEventListener('apex-gcode-pick', onPick);
    return () => window.removeEventListener('apex-gcode-pick', onPick);
  }, []);

  if (!detail) return null;
  const { parsed, pick } = detail;

  if (!pick) {
    return (
      <div className="absolute top-20 right-4 z-40 rounded-lg bg-[rgba(10,15,26,0.45)] backdrop-blur-[4px] px-3 py-2 text-xs text-zinc-400 shadow-lg">
        Cliquez sur le tracé pour inspecter un point.
      </div>
    );
  }

  const k = pick.index;
  const m = parsed.moves[k];
  const prev = parsed.moves[k - 1];
  const polar = parsed.kind === 'polar';
  const p = pick.point;

  // Repère plateau Babylon (x, y = hauteur, z) → coordonnées du G-code.
  const pointRows: [string, string][] = polar
    ? [
        ['R (rayon)', num(Math.hypot(p.x, p.z), 3, ' mm')],
        ['C (angle plateau)', num(((Math.atan2(p.z, p.x) * 180) / Math.PI + 360) % 360, 2, '°')],
        ['Z', num(p.y, 3, ' mm')],
      ]
    : [
        ['X', num(p.x, 3, ' mm')],
        ['Y', num(p.z, 3, ' mm')],
        ['Z', num(p.y, 3, ' mm')],
      ];

  const dt = parsed.times[k] - parsed.times[k - 1];
  const volumeMm3 = parsed.depositMm[k] * Math.PI * (parsed.filamentDiameterMm / 2) ** 2;
  const coord = (mv: typeof m) => polar
    ? `R ${num(mv.x, 3)}  C ${num(mv.y, 3)}  Z ${num(mv.z, 3)}  B ${num(mv.b, 2)}`
    : `X ${num(mv.x, 3)}  Y ${num(mv.y, 3)}  Z ${num(mv.z, 3)}`;

  const rows: [string, string][] = [
    ['Type', `${LINE_TYPE_BY_ID[m.type]?.label ?? m.type}${m.extruding ? ' (dépôt)' : ''}`],
    ['Mouvement', `${k} / ${parsed.moves.length - 1}  ·  position ${num(pick.fraction * 100, 0, ' %')}`],
    ['De', coord(prev)],
    ['Vers', coord(m)],
    ['Longueur', num(parsed.segLengthMm[k], 3, ' mm')],
    ['Vitesse', num(parsed.speedMmS[k], 1, ' mm/s')],
    ['Accélération', num(parsed.accelMmS2[k], 0, ' mm/s²')],
    ['Instant', `${num(parsed.times[k], 2, ' s')} (durée ${num(dt, 3, ' s')})`],
    ['Filament déposé', `${num(parsed.depositMm[k], 4, ' mm')}  ·  ${num(volumeMm3, 4, ' mm³')}`],
    ['Débit volumétrique', m.extruding && dt > 0 ? num(volumeMm3 / dt, 2, ' mm³/s') : '—'],
    ['Largeur du cordon', num(parsed.widthMm[k], 3, ' mm')],
    ['Épaisseur de couche', num(parsed.layerHeightMm[k], 3, ' mm')],
    ...(polar ? [] : [['Couche n°', String(parsed.layerIndex[k])] as [string, string]]),
    ['Inclinaison tête (B)', num(m.b, 2, '°')],
    ['Buse / plateau', `${num(parsed.nozzleTempC[k], 0, ' °C')} / ${num(parsed.bedTempC[k], 0, ' °C')}`],
    ['Ventilateur', num(parsed.fanPct[k], 0, ' %')],
  ];

  const context: [number, string][] = [];
  for (let n = Math.max(1, m.line - 2); n <= Math.min(parsed.sourceLines.length, m.line + 2); n++) {
    context.push([n, parsed.sourceLines[n - 1].replace(/\r$/, '')]);
  }

  return (
    <div
      ref={panelRef}
      className={`absolute z-40 w-[22rem] max-h-[70vh] overflow-y-auto rounded-lg bg-[rgba(10,15,26,0.55)] backdrop-blur-[6px] p-3 text-xs text-zinc-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] ${pos ? '' : 'top-20 right-4'}`}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
    >
      <div className="flex items-center justify-between mb-2 cursor-move select-none touch-none" onPointerDown={startDrag}>
        <span className="font-semibold text-zinc-100">Point inspecté — ligne {m.line}</span>
        <button
          type="button"
          className="text-zinc-400 hover:text-zinc-100"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('apex-gcode-pick', { detail: { parsed, pick: null } }));
          }}
          aria-label="Fermer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mb-2 rounded bg-black/30 p-2 font-mono text-[11px] leading-snug">
        {context.map(([n, text]) => (
          <div key={n} className={n === m.line ? 'text-amber-300' : 'text-zinc-500'}>
            <span className="inline-block w-10 text-right mr-2 select-none">{n}</span>
            <span className="whitespace-pre-wrap break-all">{text || ' '}</span>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500 col-span-2 mt-1">Point cliqué</dt>
        {pointRows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-zinc-400">{label}</dt>
            <dd className="text-right font-mono text-zinc-100">{value}</dd>
          </React.Fragment>
        ))}
        <dt className="text-zinc-500 col-span-2 mt-2">Mouvement</dt>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-zinc-400">{label}</dt>
            <dd className="text-right font-mono text-zinc-100 break-words">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
};
