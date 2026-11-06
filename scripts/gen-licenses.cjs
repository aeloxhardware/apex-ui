// Génère docs/THIRD_PARTY_LICENSES.md : licence, version et dépôt de chaque dépendance directe de package.json,
// lus dans les package.json réellement installés (node_modules). Rien n'est écrit à la main.
//   node scripts/gen-licenses.cjs            écrit le fichier
//   node scripts/gen-licenses.cjs --check    échoue si le fichier n'est plus à jour
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'THIRD_PARTY_LICENSES.md');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function licenseOf(meta) {
  if (typeof meta.license === 'string') return meta.license;
  if (meta.license && meta.license.type) return meta.license.type;
  if (Array.isArray(meta.licenses)) return meta.licenses.map((l) => l.type || l).join(' OR ');
  return 'NON DÉCLARÉE';
}

function repoOf(meta) {
  const r = typeof meta.repository === 'string' ? meta.repository : meta.repository && meta.repository.url;
  return (r || meta.homepage || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

function section(title, deps) {
  const rows = Object.keys(deps).sort().map((name) => {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
    return `| ${name} | ${meta.version} | ${licenseOf(meta)} | ${repoOf(meta)} |`;
  });
  return `## ${title}\n\n| Paquet | Version | Licence | Dépôt |\n|---|---|---|---|\n${rows.join('\n')}\n`;
}

const text = [
  '# Licences des dépendances',
  '',
  'Généré par `node scripts/gen-licenses.cjs` à partir des `package.json` installés : ne pas éditer à la main.',
  'Dépendances directes seulement ; les dépendances transitives sont figées dans `pnpm-lock.yaml`.',
  '',
  section('Dépendances (livrées avec l\'application)', pkg.dependencies || {}),
  section('Outils de développement et de build', pkg.devDependencies || {}),
].join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) { console.error('docs/THIRD_PARTY_LICENSES.md est périmé : node scripts/gen-licenses.cjs'); process.exit(1); }
  console.log('licences : à jour');
} else {
  fs.writeFileSync(OUT, text);
  console.log('écrit', path.relative(ROOT, OUT));
}
