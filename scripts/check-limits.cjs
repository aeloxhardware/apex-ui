#!/usr/bin/env node
// Contrôle des limites dures (RULES §11.1) avec cliquet.
//   fichier source ≤ 800 lignes ; fonction ≤ 80 lignes (composant React ≤ 150) ; ≤ 8 paramètres.
// `scripts/limits-baseline.json` liste la dette existante : une valeur ne peut que diminuer, et
// aucune nouvelle entrée n'est admise. Usage :
//   node scripts/check-limits.cjs            contrôle (code 1 au moindre dépassement nouveau)
//   node scripts/check-limits.cjs --update   abaisse / retire les entrées réduites (n'en ajoute jamais)
//   node scripts/check-limits.cjs --report   rapport de dette (pour apex/RELEASES.md)
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'limits-baseline.json');
const DIRS = ['src', 'electron', 'scripts'];
const EXT = /\.(ts|tsx|cjs|mjs)$/;
const SKIP = /(^|\/)(node_modules|dist|build|\.git)(\/|$)|\.d\.ts$|src\/components\/ui\//;
const MAX_FILE = 800, MAX_FN = 80, MAX_COMPONENT = 150, MAX_PARAMS = 8;

function walk(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out);
    else if (EXT.test(e.name)) out.push(rel);
  }
}

function nameOf(node) {
  const n = node.name;
  if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n))) return n.text;
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return p.left.getText().slice(0, 40);
  return null;
}

function measure(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const entries = { [`file:${rel}`]: lines };
  const kind = rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.cjs') || rel.endsWith('.mjs') ? ts.ScriptKind.JS : kind);
  const seen = new Map();
  const visit = (node, scope) => {
    const isFn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node);
    let next = scope;
    if (isFn) {
      const own = nameOf(node);
      const label = own ? (scope ? `${scope}/${own}` : own) : `${scope || ''}/<anon>`;
      const n = (seen.get(label) || 0) + 1;
      seen.set(label, n);
      const key = `${label}#${n}`;
      const a = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const b = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      const len = b - a + 1;
      const isComponent = rel.endsWith('.tsx') && own && /^[A-Z]/.test(own);
      if (len > (isComponent ? MAX_COMPONENT : MAX_FN)) entries[`fn:${rel}::${key}`] = len;
      if (node.parameters.length > MAX_PARAMS) entries[`params:${rel}::${key}`] = node.parameters.length;
      next = own ? (scope ? `${scope}/${own}` : own) : scope;
    }
    ts.forEachChild(node, (c) => visit(c, next));
  };
  visit(sf, '');
  return entries;
}

function limitOf(key, value) {
  if (key.startsWith('file:')) return MAX_FILE;
  if (key.startsWith('params:')) return MAX_PARAMS;
  return key.includes('.tsx::') && /::[A-Z][^/#]*#\d+$/.test(key) ? MAX_COMPONENT : MAX_FN;
}

const files = [];
DIRS.forEach((d) => walk(d, files));
const current = {};
for (const f of files) {
  const m = measure(f);
  for (const [k, v] of Object.entries(m)) if (v > limitOf(k, v)) current[k] = v;
}
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const mode = process.argv[2];

if (mode === '--init') {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, 1) + '\n');
  console.log(`baseline écrite : ${Object.keys(current).length} dépassements`);
  process.exit(0);
}
if (!baseline) { console.error('limits-baseline.json absent (node scripts/check-limits.cjs --init)'); process.exit(2); }

const worse = [], fresh = [], better = [];
for (const [k, v] of Object.entries(current)) {
  if (!(k in baseline)) fresh.push(`${k} = ${v}`);
  else if (v > baseline[k]) worse.push(`${k} : ${baseline[k]} -> ${v}`);
  else if (v < baseline[k]) better.push(k);
}
const fixed = Object.keys(baseline).filter((k) => !(k in current));

// --file <chemin> : dépassements courants d'un fichier (et de ses dossiers frères non), lecture seule,
// indépendante du cliquet — pour travailler à plusieurs sur des fichiers différents sans toucher la baseline.
if (mode === '--file') {
  const target = (process.argv[3] || '').replace(/\\/g, '/');
  const mine = Object.entries(current).filter(([k]) => k.split('::')[0].endsWith(':' + target));
  if (!mine.length) { console.log(`${target} : aucun dépassement`); process.exit(0); }
  mine.forEach(([k, v]) => console.log(`${k.split('::')[1]} = ${v} (limite ${limitOf(k, v)})`));
  process.exit(1);
}
if (mode === '--report') {
  const by = (p) => Object.keys(current).filter((k) => k.startsWith(p)).length;
  console.log(`fichiers > ${MAX_FILE} : ${by('file:')}\nfonctions > limite : ${by('fn:')}\nsignatures > ${MAX_PARAMS} : ${by('params:')}`);
  Object.entries(current).filter(([k]) => k.startsWith('file:')).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v}\t${k.slice(5)}`));
  process.exit(0);
}
if (mode === '--update') {
  const next = { ...baseline };
  fixed.forEach((k) => delete next[k]);
  better.forEach((k) => { next[k] = current[k]; });
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 1) + '\n');
  console.log(`cliquet resserré : ${fixed.length} retirées, ${better.length} réduites`);
  if (worse.length || fresh.length) { console.error('des régressions subsistent (non ajoutées)'); process.exit(1); }
  process.exit(0);
}
if (worse.length || fresh.length) {
  console.error('check-limits : RÉGRESSION');
  fresh.forEach((l) => console.error('  nouveau  ' + l));
  worse.forEach((l) => console.error('  aggravé  ' + l));
  process.exit(1);
}
console.log(`check-limits : ok (${Object.keys(current).length} dettes, ${better.length + fixed.length} à resserrer avec --update)`);
