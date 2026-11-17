import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stashPut, stashPutText, stashTake, stashTakeText } from './spaceStash';

/** Faux pont de bureau : un « disque » en mémoire, avec une écriture volontairement lente. */
function installDesktop() {
  const disk = new Map<string, Uint8Array>();
  (globalThis as unknown as { window: unknown }).window = {
    apexDesktop: {
      stashWrite: async (key: string, bytes: Uint8Array) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        disk.set(key, bytes);
      },
      stashRead: async (key: string) => disk.get(key) ?? null,
      stashDrop: async (key: string) => {
        disk.delete(key);
      },
    },
  };
  return disk;
}

describe('spaceStash', () => {
  let disk: Map<string, Uint8Array>;
  beforeEach(() => {
    disk = installDesktop();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('rend le texte déposé puis vide la réserve', async () => {
    await stashPutText('g', 'G1 X10\n');
    expect(await stashTakeText('g')).toBe('G1 X10\n');
    expect(disk.size).toBe(0);
    expect(await stashTakeText('g')).toBeNull();
  });

  it('attend une écriture encore en cours avant de relire', async () => {
    const pending = stashPutText('m', 'plateau');
    expect(await stashTakeText('m')).toBe('plateau');
    await pending;
  });

  it('garde la dernière valeur quand une clé est réécrite', async () => {
    void stashPut('k', new Uint8Array([1]));
    void stashPut('k', new Uint8Array([2]));
    expect(Array.from((await stashTake('k')) ?? [])).toEqual([2]);
  });
});
