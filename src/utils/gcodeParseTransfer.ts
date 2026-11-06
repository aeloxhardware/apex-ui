import type { GCodeMove, ParsedGCode } from '@/components/gcodeParse';
import { LINE_TYPES, type LineTypeId } from '@/components/gcodeLineTypes';

/**
 * Transport d'un `ParsedGCode` entre le worker d'analyse et le thread principal : `moves` (un
 * objet par mouvement, potentiellement des millions) est mis à plat en tableaux typés transférables,
 * puis reconstruit côté principal par tranches de temps (`unpackParsedGCode`) pour ne jamais
 * monopoliser le thread.
 */

const TYPE_IDS: LineTypeId[] = LINE_TYPES.map((t) => t.id);
const TYPE_INDEX = new Map<LineTypeId, number>(TYPE_IDS.map((id, i) => [id, i]));

interface PackedMoves {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  b: Float64Array;
  c: Float64Array;
  extruding: Uint8Array;
  type: Uint8Array;
}

export type PackedParsedGCode = Omit<ParsedGCode, 'moves'> & { packedMoves: PackedMoves };

export function packParsedGCode(parsed: ParsedGCode): { payload: PackedParsedGCode; transfer: ArrayBuffer[] } {
  const { moves, ...rest } = parsed;
  const n = moves.length;
  const packedMoves: PackedMoves = {
    x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), b: new Float64Array(n), c: new Float64Array(n),
    extruding: new Uint8Array(n), type: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const m = moves[i];
    packedMoves.x[i] = m.x; packedMoves.y[i] = m.y; packedMoves.z[i] = m.z; packedMoves.b[i] = m.b; packedMoves.c[i] = m.c;
    packedMoves.extruding[i] = m.extruding ? 1 : 0;
    packedMoves.type[i] = TYPE_INDEX.get(m.type) ?? 0;
  }
  const payload = { ...rest, packedMoves } as PackedParsedGCode;

  // Tous les tampons des tableaux typés (y compris ceux imbriqués : markers, offPlate), dédoublonnés
  // — transférer deux fois le même ArrayBuffer est une erreur.
  const buffers = new Set<ArrayBuffer>();
  const collect = (value: unknown, depth: number) => {
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer as ArrayBuffer); return; }
    if (depth > 2 || value === null || typeof value !== 'object') return;
    for (const v of Object.values(value)) collect(v, depth + 1);
  };
  collect(payload, 0);
  return { payload, transfer: [...buffers] };
}

/** Reconstruit `moves` en cédant la main au navigateur dès qu'une tranche dépasse `sliceMs`. */
export async function unpackParsedGCode(payload: PackedParsedGCode, sliceMs = 6): Promise<ParsedGCode> {
  const { packedMoves: p, ...rest } = payload;
  const n = p.x.length;
  const moves: GCodeMove[] = new Array(n);
  let sliceStart = performance.now();
  for (let i = 0; i < n; i++) {
    moves[i] = { x: p.x[i], y: p.y[i], z: p.z[i], b: p.b[i], c: p.c[i], extruding: p.extruding[i] === 1, type: TYPE_IDS[p.type[i]] };
    if ((i & 0x3fff) === 0x3fff && performance.now() - sliceStart > sliceMs) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      sliceStart = performance.now();
    }
  }
  return { ...rest, moves } as ParsedGCode;
}
