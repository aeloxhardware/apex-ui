import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Le contrôleur touche `window` dès son import (mode de tranchage) : on le charge après avoir posé un faux `window`.
let sliceController: typeof import('./sliceController').sliceController;

type Listener = (event: ApexSliceEvent) => void;

// Faux pont Electron : le moteur « rapporte » les événements donnés pendant `slice`, comme les lignes JSON de `main.py slice`.
function stubDesktop(events: ApexSliceEvent[]) {
  const target = new EventTarget();
  target.addEventListener('apex-export-plate-stl', (e) => (e as CustomEvent<{ resolve: (b: Uint8Array) => void }>).detail.resolve(new Uint8Array([1])));
  let listener: Listener | undefined;
  Object.assign(target, {
    apexDesktop: {
      sliceSteps: async () => ({ contract: 3, steps: [{ slug: 'import', label: 'Import' }, { slug: 'tetrahedralization', label: 'Tétra' }] }),
      onSliceProgress: (cb: Listener) => { listener = cb; return () => { listener = undefined; }; },
      slice: async () => {
        events.forEach((e) => listener?.(e));
        return { result: { status: 'ok', gcode: 'a.gcode' }, gcodeText: ';G' };
      },
    },
  });
  vi.stubGlobal('window', target);
}

const sub = (name: string, fraction: number): ApexSliceEvent => ({ type: 'substep', slug: 'tetrahedralization', sub: name, fraction });

describe('sous-étapes du tranchage', () => {
  beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget());
    ({ sliceController } = await import('./sliceController'));
    sliceController.reset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('garde la fraction réelle de chaque sous-étape, sans jamais reculer', async () => {
    stubDesktop([sub('prepare', 0.4), sub('prepare', 0.2), sub('prepare', 1), sub('tetrahedralize', 0.3)]);
    await sliceController.start();
    expect(sliceController.getState().substeps).toEqual({ tetrahedralization: { prepare: 1, tetrahedralize: 0.3 } });
  });

  it('ignore une sous-étape que l’interface ne connaît pas et borne la fraction', async () => {
    stubDesktop([sub('inconnue', 0.5), sub('verify', 7)]);
    await sliceController.start();
    expect(sliceController.getState().substeps).toEqual({ tetrahedralization: { verify: 1 } });
  });

  it('n’affiche aucune sous-barre quand le moteur n’en rapporte pas (TetGen)', async () => {
    stubDesktop([{ type: 'step', slug: 'tetrahedralization', fraction: 0.5 }]);
    await sliceController.start();
    expect(sliceController.getState().substeps).toEqual({});
  });
});
