// Prépare les assets de mise à jour d'une release GitHub (publiée depuis le dépôt `apex`, cf. RULES §4.3) :
//   node scripts/update/make-manifest.cjs <dossier win-unpacked> [--previous update-manifest.json] [--out dossier] [--version v]
// Écrit dans --out (défaut release/update) : update-manifest.json, update-manifest.sig (Ed25519, clé privée
// ~/.apex/update-private.pem ou APEX_UPDATE_KEY) et UN asset par fichier NOUVEAU, nommé par son SHA-256.
// --previous : manifeste de la release précédente (le dernier publié) ; seuls les fichiers dont le contenu a changé
// sont copiés (les autres gardent le `src` de la release qui les héberge). Sans --previous (première release), aucun
// fichier n'est publié : les installations de cette version les ont déjà.
// Publier ensuite : gh release create <version> <out>/* --repo aeloxhardware/apex  (--prerelease tant qu'aucune
// impression réelle n'a validé la version ; le client ne suit que les releases, pas les pré-releases).
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const source = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!source) { console.error('Usage : make-manifest.cjs <dossier win-unpacked> [--previous manifest] [--out dossier] [--version v]'); process.exit(1); }

const version = opt('--version') || require('../../package.json').apexVersion;
const out = path.resolve(opt('--out') || path.join(__dirname, '../../release/update'));
const previous = opt('--previous') ? JSON.parse(fs.readFileSync(opt('--previous'), 'utf8')) : null;
const prevBySha = new Map((previous?.files ?? []).map((f) => [f.sha256, f]));

// Fichiers posés ou gérés hors de l'application : jamais dans le manifeste.
const SKIP = (rel) => /\.(old|part)$/.test(rel) || rel.startsWith('.apex-update/') || rel === 'uninstall.ps1' || rel === 'apex-install.json';

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.isFile() && !SKIP(path.relative(source, abs).split(path.sep).join('/'))) files.push(abs);
  }
})(path.resolve(source));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const entries = [];
let published = 0;
for (const abs of files.sort()) {
  const bytes = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const entry = { path: path.relative(source, abs).split(path.sep).join('/'), sha256, size: bytes.length, src: null };
  const known = prevBySha.get(sha256);
  if (known) entry.src = known.src ?? null;
  else if (previous) {
    entry.src = version;
    const target = path.join(out, sha256);
    if (!fs.existsSync(target)) { fs.writeFileSync(target, bytes); published++; }
  }
  entries.push(entry);
}

const manifest = Buffer.from(JSON.stringify({ version, generated: new Date().toISOString(), files: entries }));
const keyFile = process.env.APEX_UPDATE_KEY || path.join(os.homedir(), '.apex', 'update-private.pem');
const signature = crypto.sign(null, manifest, crypto.createPrivateKey(fs.readFileSync(keyFile)));
fs.writeFileSync(path.join(out, 'update-manifest.json'), manifest);
fs.writeFileSync(path.join(out, 'update-manifest.sig'), signature.toString('base64'));
console.log(`${version} : ${entries.length} fichiers au manifeste, ${published} nouveau(x) à publier (assets) dans ${out}`);
if (published >= 900) console.warn('Attention : GitHub limite une release à 1000 assets.');
