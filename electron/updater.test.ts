import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const u: any = createRequire(import.meta.url)('./updater.cjs');

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const entry = (rel: string, content: string, src: string | null = null) => ({ path: rel, sha256: sha(content), size: Buffer.byteLength(content), src });

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-update-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const write = (rel: string, content: string) => {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};
const read = (rel: string) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

const fakeFetch = (files: Record<string, string | Buffer>) => async (url: string) => {
  const body = files[url];
  if (body === undefined) return new Response('nope', { status: 404 });
  return new Response(body);
};

describe('versions', () => {
  it('compare les numéros, puis la lettre de préversion', () => {
    expect(u.compareVersions('alpha-0.2.3.0.6.0.0.221', 'alpha-0.2.3.0.5.0.0.221')).toBeGreaterThan(0);
    expect(u.compareVersions('alpha-0.2.3.0.5.0.0.221', 'alpha-0.2.3.0.5.0.0.221')).toBe(0);
    expect(u.compareVersions('alpha-0.2.10', 'alpha-0.2.9')).toBeGreaterThan(0);
    expect(u.compareVersions('beta-0.2.3', 'alpha-0.2.3')).toBeGreaterThan(0);
    expect(() => u.compareVersions('n’importe quoi', 'alpha-0.2.3')).toThrow();
  });
});

describe('manifeste signé', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const bytes = Buffer.from(JSON.stringify({ version: 'alpha-0.2.3.0.6.0.0.221', files: [entry('a.txt', 'x')] }));
  const sig = crypto.sign(null, bytes, privateKey).toString('base64');

  it('accepte la bonne signature, refuse un manifeste modifié ou une autre clé', () => {
    expect(u.verifySignature(bytes, sig, pem)).toBe(true);
    expect(u.verifySignature(Buffer.from(bytes.toString().replace('a.txt', 'b.txt')), sig, pem)).toBe(false);
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) as string;
    expect(u.verifySignature(bytes, sig, other)).toBe(false);
    expect(u.verifySignature(bytes, 'pas-du-base64', pem)).toBe(false);
  });

  it('refuse les chemins qui sortent de l’installation ou touchent au dossier d’état', () => {
    for (const bad of ['../evil.dll', '/etc/passwd', 'C:/Windows/x.dll', 'a/../../b', '.apex-update/x', 'a//b']) {
      const m = Buffer.from(JSON.stringify({ version: 'alpha-0.1', files: [entry(bad, 'x')] }));
      expect(() => u.parseManifest(m), bad).toThrow();
    }
  });

  it('cherche la release, vérifie la signature et ne rend que ce qui est plus récent', async () => {
    const release = {
      tag_name: 'alpha-0.2.3.0.6.0.0.221',
      assets: [
        { name: 'update-manifest.json', browser_download_url: 'm' },
        { name: 'update-manifest.sig', browser_download_url: 's' },
      ],
    };
    const fetchImpl = fakeFetch({ 'https://api.github.com/repos/o/r/releases/latest': JSON.stringify(release), m: bytes, s: sig });
    const found = await u.checkForUpdate({ repo: 'o/r', currentVersion: 'alpha-0.2.3.0.5.0.0.221', publicKeyPem: pem, fetchImpl });
    expect(found.manifest.version).toBe('alpha-0.2.3.0.6.0.0.221');
    expect(await u.checkForUpdate({ repo: 'o/r', currentVersion: 'alpha-0.2.3.0.6.0.0.221', publicKeyPem: pem, fetchImpl })).toBeNull();
    const forged = fakeFetch({ 'https://api.github.com/repos/o/r/releases/latest': JSON.stringify(release), m: bytes, s: (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1) });
    await expect(u.checkForUpdate({ repo: 'o/r', currentVersion: 'alpha-0.2.3.0.5.0.0.221', publicKeyPem: pem, fetchImpl: forged })).rejects.toThrow(/Signature/);
  });
});

describe('plan, téléchargement, bascule', () => {
  it('ne retient que les fichiers modifiés, absents ou retirés', async () => {
    write('app.exe', 'exe-v1');
    write('resources/app.asar', 'asar-v1');
    write('resources/old.dat', 'old');
    const previous = { files: [entry('app.exe', 'exe-v1'), entry('resources/app.asar', 'asar-v1'), entry('resources/old.dat', 'old')] };
    const manifest = { files: [entry('app.exe', 'exe-v1'), entry('resources/app.asar', 'asar-v2'), entry('resources/new.dat', 'new')] };
    const plan = await u.planUpdate(root, manifest, previous);
    expect(plan.changed.map((f: { path: string }) => f.path)).toEqual(['resources/app.asar', 'resources/new.dat']);
    expect(plan.removed).toEqual(['resources/old.dat']);
    expect(plan.bytes).toBe(Buffer.byteLength('asar-v2') + Buffer.byteLength('new'));
  });

  it('refuse un fichier dont le contenu ne correspond pas à son empreinte', async () => {
    const e = entry('a.bin', 'bon contenu');
    const dest = path.join(root, 'staging', e.sha256);
    await expect(u.downloadVerified('u', dest, e, { fetchImpl: fakeFetch({ u: 'contenu altéré' }) })).rejects.toThrow(/Intégrité/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    await u.downloadVerified('u', dest, e, { fetchImpl: fakeFetch({ u: 'bon contenu' }) });
    expect(fs.readFileSync(dest, 'utf8')).toBe('bon contenu');
  });

  it('remplace un fichier OUVERT (renommage en .old), puis nettoie au démarrage suivant', async () => {
    const exe = write('app.exe', 'exe-v1');
    write('resources/old.dat', 'old');
    const manifest = { version: 'alpha-0.2', files: [entry('app.exe', 'exe-v2'), entry('resources/new.dat', 'new')] };
    const e1 = manifest.files[0];
    const e2 = manifest.files[1];
    const f1 = path.join(root, '.apex-update', 'staging', e1.sha256);
    const f2 = path.join(root, '.apex-update', 'staging', e2.sha256);
    fs.mkdirSync(path.dirname(f1), { recursive: true });
    fs.writeFileSync(f1, 'exe-v2');
    fs.writeFileSync(f2, 'new');

    const fd = fs.openSync(exe, 'r');  // le fichier est « en cours d'utilisation » pendant la bascule
    try {
      u.applyUpdate(root, [{ entry: e1, file: f1 }, { entry: e2, file: f2 }], ['resources/old.dat'], manifest);
    } finally { fs.closeSync(fd); }

    expect(read('app.exe')).toBe('exe-v2');
    expect(read('resources/new.dat')).toBe('new');
    expect(fs.existsSync(path.join(root, 'resources', 'old.dat'))).toBe(false);
    expect(fs.existsSync(`${exe}.old`)).toBe(true);
    expect(u.readInstalledManifest(root).version).toBe('alpha-0.2');

    u.cleanupOld(root);
    expect(fs.existsSync(`${exe}.old`)).toBe(false);
    expect(fs.existsSync(path.join(root, 'resources', 'old.dat.old'))).toBe(false);
    expect(read('app.exe')).toBe('exe-v2');
  });

  it('annule tout si un fichier ne peut pas être posé (rollback)', () => {
    write('a.dll', 'a-v1');
    write('b.dll', 'b-v1');
    const ea = entry('a.dll', 'a-v2');
    const eb = entry('b.dll', 'b-v2');
    const fa = path.join(root, '.apex-update', 'staging', ea.sha256);
    fs.mkdirSync(path.dirname(fa), { recursive: true });
    fs.writeFileSync(fa, 'a-v2');
    const missing = path.join(root, '.apex-update', 'staging', eb.sha256);  // jamais téléchargé : la pose échoue
    expect(() => u.applyUpdate(root, [{ entry: ea, file: fa }, { entry: eb, file: missing }], [], { version: 'alpha-0.2', files: [ea, eb] })).toThrow();
    expect(read('a.dll')).toBe('a-v1');
    expect(read('b.dll')).toBe('b-v1');
    expect(fs.existsSync(path.join(root, 'a.dll.old'))).toBe(false);
  });
});
