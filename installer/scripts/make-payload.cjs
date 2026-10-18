// Fabrique le paquet embarque dans l'installateur : zip du slicer empaquete (release/win-unpacked, produit par
// `electron-builder --dir` a la racine du depot) + payload.json (nombre de fichiers, taille, version) lu par
// electron/install.cjs pour la progression et le controle d'espace disque.
//   node scripts/make-payload.cjs [dossier-source]
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'release', 'win-unpacked'));
const outDir = path.join(__dirname, '..', 'payload');
if (!fs.existsSync(path.join(source, 'Apex Slicer.exe'))) {
  console.error(`Slicer empaquete introuvable : ${source}\nLancer d'abord, a la racine : electron-builder --dir`);
  process.exit(1);
}

let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else { files += 1; bytes += fs.statSync(full).size; }
  }
})(source);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, 'apex-slicer.zip');
// tar.exe (bsdtar, fourni avec Windows 10+) cree le zip ; -a deduit le format de l'extension.
const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', source, '.'], { stdio: 'inherit' });
if (result.status !== 0) { console.error('Creation du zip impossible.'); process.exit(1); }

const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
fs.writeFileSync(path.join(outDir, 'payload.json'), JSON.stringify({ files, bytes, version: rootPkg.apexVersion || rootPkg.version || '0.0.0' }, null, 2));
console.log(`Paquet pret : ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} Mo, ${files} fichiers, ${(bytes / 1048576).toFixed(0)} Mo installes)`);
