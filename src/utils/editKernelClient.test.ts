// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Le client parle au processus du noyau par un MessagePort. Node fournit un vrai MessageChannel :
// une extrémité va au client, l'autre joue le noyau (on y lit les requêtes et on y répond).
type Msg = { id: number; op: string; args: unknown[] };
type Listener = (event: unknown) => void;

function setup() {
  const listeners = new Set<Listener>();
  const channel = new MessageChannel();
  const received: Msg[] = [];
  channel.port2.onmessage = (e: MessageEvent) => { received.push(e.data as Msg); };
  const fakeWindow: Record<string, unknown> = {
    apexDesktop: {
      openEditChannel: () => {
        queueMicrotask(() => {
          for (const l of [...listeners]) l({ source: fakeWindow, data: { type: 'apex-edit-port' }, ports: [channel.port1] });
        });
      },
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  };
  vi.stubGlobal('window', fakeWindow);
  const reply = (id: number, body: { result?: unknown; error?: string }) => channel.port2.postMessage({ id, ...body });
  const flush = () => new Promise((r) => setTimeout(r, 10));
  return { received, reply, flush, channel };
}

async function freshClient() {
  vi.resetModules();
  return (await import('./editKernelClient')).editKernel;
}

describe('editKernelClient : protocole avec le noyau', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => { env = setup(); });
  afterEach(() => { env.channel.port1.close(); env.channel.port2.close(); vi.unstubAllGlobals(); });

  it('hors application de bureau, open() vaut faux et un appel est refusé', async () => {
    vi.stubGlobal('window', {});
    const kernel = await freshClient();
    expect(kernel.available).toBe(false);
    expect(await kernel.open()).toBe(false);
    await expect(kernel.undo()).rejects.toThrow(/Canal d'édition fermé/);
  });

  it('envoie {id, op, args} et résout avec le résultat', async () => {
    const kernel = await freshClient();
    expect(await kernel.open()).toBe(true);
    const p = kernel.setLayerLimits(0.06, 0.3, 1);
    await env.flush();
    expect(env.received).toHaveLength(1);
    expect(env.received[0]).toMatchObject({ op: 'setLayerLimits', args: [0.06, 0.3, 1] });
    env.reply(env.received[0].id, { result: undefined });
    await expect(p).resolves.toBeUndefined();
  });

  it('rejette avec le message d\'erreur du noyau', async () => {
    const kernel = await freshClient();
    await kernel.open();
    const p = kernel.undo();
    await env.flush();
    env.reply(env.received[0].id, { error: 'rien à annuler' });
    await expect(p).rejects.toThrow('rien à annuler');
  });

  it('glissement : une requête en vol, la plus récente remplace celle qui attend', async () => {
    const kernel = await freshClient();
    await kernel.open();
    const t = (x: number) => ({ translation: [x, 0, 0] }) as never;
    const a = kernel.drag(t(1));
    const b = kernel.drag(t(2));
    const c = kernel.drag(t(3));
    await env.flush();
    // Seule la première part ; b est remplacée par c avant d'être envoyée.
    expect(env.received.map((m) => m.args[0])).toEqual([t(1)]);
    await expect(b).resolves.toBeNull();
    env.reply(env.received[0].id, { result: { ok: 1 } });
    await expect(a).resolves.toEqual({ ok: 1 });
    await env.flush();
    expect(env.received.map((m) => m.args[0])).toEqual([t(1), t(3)]);
    env.reply(env.received[1].id, { result: { ok: 3 } });
    await expect(c).resolves.toEqual({ ok: 3 });
    expect(env.received).toHaveLength(2);
  });

  it('commit : écarte le glissement en attente, applique la position finale puis valide', async () => {
    const kernel = await freshClient();
    await kernel.open();
    const t = (x: number) => ({ translation: [x, 0, 0] }) as never;
    const inFlight = kernel.drag(t(1));
    const waiting = kernel.drag(t(2));
    const done = kernel.commit(t(9));
    await env.flush();
    await expect(waiting).resolves.toBeNull();
    // Le port est ordonné : glissement en vol, position finale, commit.
    expect(env.received.map((m) => m.op)).toEqual(['drag', 'drag', 'commit']);
    expect(env.received[1].args[0]).toEqual(t(9));
    env.reply(env.received[0].id, { result: null });
    env.reply(env.received[1].id, { result: null });
    env.reply(env.received[2].id, { result: { committed: true } });
    await inFlight;
    await expect(done).resolves.toEqual({ committed: true });
  });
});
