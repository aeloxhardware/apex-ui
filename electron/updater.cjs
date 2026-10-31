// Mise à jour d'Apex : logique pure (aucune dépendance à Electron, testée par updater.test.ts).
//
// Une release GitHub d'`apex` porte `update-manifest.json` (liste des fichiers de l'application avec leur SHA-256 et
// leur taille) et `update-manifest.sig` (signature Ed25519 de ce manifeste, clé publique dans update-public-key.pem).
// Les fichiers eux-mêmes sont des assets nommés par leur SHA-256 (adressage par contenu) : seuls ceux qui ont changé
// depuis la version précédente y sont publiés ; l'entrée du manifeste dit dans `src` quelle release l'héberge.
// Le client compare le manifeste à ce qui est installé et ne télécharge que ce qui diffère.
//
// Fichiers en cours d'exécution : Windows interdit de les écraser mais autorise à les RENOMMER. Chaque fichier à
// remplacer est donc renommé en `.old`, le nouveau prend sa place, l'application relance, et les `.old` sont
// supprimés au démarrage suivant (cleanupOld). Au moindre échec, tout est remis comme avant (rollback).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_ASSET = 'update-manifest.json';
const SIGNATURE_ASSET = 'update-manifest.sig';
const STATE_DIR = '.apex-update';
const INSTALLED_MANIFEST = 'installed-manifest.json';
const OLD_LIST = 'old-files.json';
const PRERELEASE_ORDER = ['alpha', 'beta', 'rc', ''];

// --- Versions -------------------------------------------------------------------------------------------------------

/** « alpha-0.2.3.0.5.0.0.221 » → { pre: 'alpha', nums: [0,2,3,0,5,0,0,221] } ; null si inexploitable. */
function parseVersion(raw) {
  const m = /^(?:([a-z]+)-)?(\d+(?:\.\d+)*)$/i.exec(String(raw ?? '').trim());
  return m ? { pre: (m[1] ?? '').toLowerCase(), nums: m[2].split('.').map(Number) } : null;
}

/** Compare deux numéros de version : négatif si a < b. La lettre de préversion ne compte qu'à numéros égaux. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Numéro de version illisible : ${!x ? a : b}`);
  const n = Math.max(x.nums.length, y.nums.length);
  for (let i = 0; i < n; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  return PRERELEASE_ORDER.indexOf(x.pre) - PRERELEASE_ORDER.indexOf(y.pre);
}

// --- Manifeste ------------------------------------------------------------------------------------------------------

/** Vrai si la signature Ed25519 (base64) du manifeste correspond à la clé publique (PEM). */
function verifySignature(manifestBytes, signatureBase64, publicKeyPem) {
  try {
    return crypto.verify(null, manifestBytes, crypto.createPublicKey(publicKeyPem), Buffer.from(String(signatureBase64).trim(), 'base64'));
  } catch {
    return false;
  }
}

/** Chemin relatif sûr (jamais absolu, jamais de `..`, pas de dossier d'état) ; sinon lève. */
function checkRelativePath(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes('\0')) {
    throw new Error(`Chemin invalide dans le manifeste : ${rel}`);
  }
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === '..' || p === '' || p === '.') || parts[0] === STATE_DIR) {
    throw new Error(`Chemin invalide dans le manifeste : ${rel}`);
  }
}

function parseManifest(manifestBytes) {
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!parseVersion(manifest.version)) throw new Error('Manifeste : numéro de version invalide.');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Manifeste : aucun fichier.');
  const seen = new Set();
  for (const f of manifest.files) {
    checkRelativePath(f.path);
    if (!/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size) || f.size < 0) throw new Error(`Manifeste : entrée invalide (${f.path}).`);
    if (f.src != null && typeof f.src !== 'string') throw new Error(`Manifeste : src invalide (${f.path}).`);
    const key = f.path.replace(/\\/g, '/').toLowerCase();
    if (seen.has(key)) throw new Error(`Manifeste : chemin en double (${f.path}).`);
    seen.add(key);
  }
  return manifest;
}

function safeJoin(root, rel) {
  checkRelativePath(rel);
  const abs = path.resolve(root, ...rel.split(/[\\/]/));
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`Chemin hors de l'installation : ${rel}`);
  return abs;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// --- Plan : que faut-il télécharger ? -------------------------------------------------------------------------------

function readInstalledManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STATE_DIR, INSTALLED_MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare le manifeste à l'installation. `changed` : fichiers absents ou différents (taille d'abord, SHA-256 ensuite) ;
 * `removed` : fichiers du manifeste précédent qui n'existent plus dans le nouveau (sans manifeste précédent, on ne
 * supprime rien : on ne touche qu'à ce qu'on connaît).
 */
async function planUpdate(root, manifest, previous = readInstalledManifest(root), onProgress = () => {}) {
  const changed = [];
  let done = 0;
  for (const f of manifest.files) {
    const abs = safeJoin(root, f.path);
    let same = false;
    try {
      const st = fs.statSync(abs);
      same = st.isFile() && st.size === f.size && (await sha256File(abs)) === f.sha256;
    } catch { /* absent */ }
    if (!same) changed.push(f);
    onProgress(++done, manifest.files.length);
  }
  const keep = new Set(manifest.files.map((f) => f.path.replace(/\\/g, '/').toLowerCase()));
  const removed = (previous?.files ?? []).map((f) => f.path).filter((p) => !keep.has(p.replace(/\\/g, '/').toLowerCase()));
  return { changed, removed, bytes: changed.reduce((n, f) => n + f.size, 0) };
}

// --- Release GitHub -------------------------------------------------------------------------------------------------

async function getJson(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ApexSlicer-Updater' }, signal });
  if (!res.ok) throw new Error(`GitHub ${res.status} sur ${url}`);
  return res.json();
}

async function getBytes(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'ApexSlicer-Updater' }, redirect: 'follow', signal });
  if (!res.ok) throw new Error(`Téléchargement refusé (${res.status}) : ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Cherche la dernière release et en lit le manifeste signé. `channel` : « release » (défaut : seulement les releases,
 * pas les pré-releases, cf. RULES §4.3 d'apex) ou « prerelease » (la plus récente publiée, pré-release comprise).
 * Rend { manifest, release } ; null s'il n'y a pas de release exploitable ou pas de version plus récente.
 */
async function checkForUpdate({ repo, channel = 'release', currentVersion, publicKeyPem, fetchImpl = fetch, timeoutMs = 4000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const api = `https://api.github.com/repos/${repo}`;
    const release = channel === 'prerelease'
      ? (await getJson(`${api}/releases?per_page=10`, fetchImpl, controller.signal)).find((r) => !r.draft)
      : await getJson(`${api}/releases/latest`, fetchImpl, controller.signal);
    if (!release) return null;
    const asset = (name) => release.assets?.find((a) => a.name === name);
    const manifestAsset = asset(MANIFEST_ASSET);
    const signatureAsset = asset(SIGNATURE_ASSET);
    if (!manifestAsset || !signatureAsset) return null;
    const bytes = await getBytes(manifestAsset.browser_download_url, fetchImpl, controller.signal);
    const signature = (await getBytes(signatureAsset.browser_download_url, fetchImpl, controller.signal)).toString('utf8');
    if (!verifySignature(bytes, signature, publicKeyPem)) throw new Error('Signature du manifeste invalide : mise à jour refusée.');
    const manifest = parseManifest(bytes);
    if (compareVersions(manifest.version, currentVersion) <= 0) return null;
    return { manifest, release };
  } finally {
    clearTimeout(timer);
  }
}

/** Résout l'URL de l'asset d'un fichier : dans la release courante, ou dans celle que nomme `src`. */
function createAssetResolver({ repo, release, fetchImpl = fetch }) {
  const releases = new Map([[release.tag_name, release]]);
  return async function resolve(entry) {
    const tag = entry.src || release.tag_name;
    if (!releases.has(tag)) releases.set(tag, await getJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, fetchImpl));
    const asset = releases.get(tag).assets?.find((a) => a.name === entry.sha256);
    if (!asset) throw new Error(`Fichier absent de la release ${tag} : ${entry.path}`);
    return asset.browser_download_url;
  };
}

// --- Téléchargement vérifié -----------------------------------------------------------------------------------------

/** Télécharge vers `dest` (via .part) et vérifie taille et SHA-256 ; un fichier incorrect n'est jamais gardé. */
async function downloadVerified(url, dest, entry, { fetchImpl = fetch, onBytes = () => {}, signal } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'ApexSlicer-Updater' }, redirect: 'follow', signal });
  if (!res.ok || !res.body) throw new Error(`Téléchargement refusé (${res.status}) : ${entry.path}`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let size = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      size += chunk.length;
      onBytes(chunk.length);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => { out.end((err) => (err ? reject(err) : resolve())); });
  } catch (err) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw err;
  }
  if (size !== entry.size || hash.digest('hex') !== entry.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`Intégrité : ${entry.path} ne correspond pas à son empreinte SHA-256.`);
  }
  fs.renameSync(part, dest);
}

// --- Bascule --------------------------------------------------------------------------------------------------------

function uniqueOldName(abs) {
  for (let i = 0; ; i++) {
    const candidate = `${abs}${i ? `.${i}` : ''}.old`;
    if (!fs.existsSync(candidate)) return candidate;
    try { fs.rmSync(candidate, { force: true }); } catch { /* verrouillé : on essaie le suivant */ }
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/**
 * Applique la mise à jour : `staged` = [{ entry, file }] (fichiers déjà téléchargés et vérifiés, sur le même volume que
 * l'installation), `removed` = chemins à retirer. Chaque fichier existant est renommé en `.old`, le nouveau est posé,
 * puis le manifeste installé est écrit. Échec : tout est annulé et l'erreur relancée.
 */
function applyUpdate(root, staged, removed, manifest) {
  const done = [];  // { dest, old | null } pour l'annulation
  const stateDir = path.join(root, STATE_DIR);
  try {
    for (const { entry, file } of staged) {
      const dest = safeJoin(root, entry.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let old = null;
      if (fs.existsSync(dest)) {
        old = uniqueOldName(dest);
        fs.renameSync(dest, old);
      }
      done.push({ dest, old });
      fs.renameSync(file, dest);
    }
    for (const rel of removed) {
      const dest = safeJoin(root, rel);
      if (!fs.existsSync(dest)) continue;
      const old = uniqueOldName(dest);
      fs.renameSync(dest, old);
      done.push({ dest: null, old, original: dest });
    }
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, OLD_LIST), JSON.stringify(done.map((d) => d.old).filter(Boolean).map((p) => path.relative(root, p))));
    fs.writeFileSync(path.join(stateDir, INSTALLED_MANIFEST), JSON.stringify(manifest));
  } catch (err) {
    for (const d of done.reverse()) {
      try {
        if (d.dest) fs.rmSync(d.dest, { force: true });
        if (d.old) fs.renameSync(d.old, d.dest ?? d.original);
      } catch { /* meilleur effort */ }
    }
    throw err;
  }
}

/** Au démarrage : supprime les `.old` laissés par la bascule précédente (ceux encore verrouillés restent listés). */
function cleanupOld(root) {
  const listFile = path.join(root, STATE_DIR, OLD_LIST);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch { return; }
  const left = [];
  for (const rel of list) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(path.resolve(root) + path.sep)) continue;
    try { fs.rmSync(abs, { force: true }); } catch { left.push(rel); }
    if (fs.existsSync(abs)) left.push(rel);
  }
  try {
    if (left.length) fs.writeFileSync(listFile, JSON.stringify([...new Set(left)]));
    else fs.rmSync(listFile, { force: true });
    fs.rmSync(path.join(root, STATE_DIR, 'staging'), { recursive: true, force: true });
  } catch { /* meilleur effort */ }
}

module.exports = {
  MANIFEST_ASSET, SIGNATURE_ASSET, STATE_DIR,
  parseVersion, compareVersions, verifySignature, parseManifest, safeJoin, sha256File,
  planUpdate, readInstalledManifest, checkForUpdate, createAssetResolver, downloadVerified, applyUpdate, cleanupOld,
};
