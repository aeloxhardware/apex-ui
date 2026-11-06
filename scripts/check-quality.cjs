#!/usr/bin/env node
// Quality gate « cliquet » (CLAUDE.md, « Quality gate ») : complexité, profondeur, assertions non nulles, `any`,
// frontières d'architecture (dependency-cruiser), code mort (knip), bus d'événements typé, dérogations ESLint et
// contournements datés. Chaque mesure est comparée à scripts/quality-baseline.json : elle peut diminuer, jamais
// augmenter. `--update` resserre la baseline (jamais ne la desserre) ; `--report` affiche les totaux.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'quality-baseline.json');
const args = new Set(process.argv.slice(2));

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, shell: process.platform === 'win32' });
  return r.stdout || '';
};
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const counts = {};
const add = (key, n = 1) => { counts[key] = (counts[key] || 0) + n; };

// 1. ESLint : complexité, profondeur, assertions non nulles, any, @ts-*.
{
  const out = run('npx', ['eslint', '-c', 'eslint.quality.config.js', '-f', 'json', 'src']);
  const report = JSON.parse(out);
  for (const f of report) {
    for (const m of f.messages) {
      if (!m.ruleId || m.ruleId.startsWith('react-hooks')) continue;
      add(`eslint:${m.ruleId}:${rel(f.filePath)}`);
    }
  }
}

// 2. Frontières d'architecture.
{
  const out = run('npx', ['depcruise', 'src', '--config', '.dependency-cruiser.cjs', '-T', 'json']);
  const report = JSON.parse(out);
  for (const v of report.summary.violations) add(`depcruise:${v.rule.name}:${v.from}>${v.to}`);
}

// 3. Code mort.
{
  const out = run('npx', ['knip', '--reporter', 'json']);
  const report = JSON.parse(out);
  for (const issue of report.issues) {
    for (const kind of ['files', 'exports', 'types', 'duplicates', 'unlisted', 'unresolved']) {
      const list = issue[kind] || [];
      if (list.length) add(`knip:${kind}:${issue.file}`, list.length);
    }
  }
}

// 4. Contrôles par expressions régulières (bus d'événements, dérogations, contournements).
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'ui'].includes(e.name)) walk(p, files); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p);
  }
  return files;
}
const BUS_FILE = 'src/events/apexEvents.ts';
for (const file of walk(path.join(ROOT, 'src'))) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isTest = /\.test\.tsx?$/.test(r);
  if (r !== BUS_FILE && !isTest) {
    // Événements `apex-*` : toujours via emitApex / onApex (src/events/apexEvents.ts), typés.
    const raw = (text.match(/new CustomEvent\(\s*['"`]apex-/g) || []).length
      + (text.match(/(?:add|remove)EventListener\(\s*['"`]apex-/g) || []).length;
    if (raw) add(`events:raw-apex-event:${r}`, raw);
  }
  lines.forEach((line, i) => {
    // Une dérogation ESLint porte sa raison (`-- raison` ou commentaire sur la ligne précédente).
    if (/eslint-disable/.test(line) && !/--\s*\S/.test(line) && !(i > 0 && /^\s*\/\/\s*\S/.test(lines[i - 1]) && !/eslint-disable/.test(lines[i - 1]))) {
      add(`workaround:eslint-disable-without-reason:${r}`);
    }
    // Un contournement : WORKAROUND(ID, revue AAAA-MM-JJ) ; passé la date, il échoue.
    const wk = /WORKAROUND(?:\(([^)]*)\))?/.exec(line);
    if (wk) {
      const m = wk[1] && /^\s*[A-Z]+-\d+\s*,\s*revue\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(wk[1]);
      if (!m) add(`workaround:malformed:${r}`);
      else if (new Date(m[1]) < new Date()) add(`workaround:review-overdue:${r}`);
    }
    if (/\b(?:TODO|FIXME|HACK)\b/.test(line)) add(`workaround:untracked-todo:${r}`);
  });
}

// 5. Configuration TypeScript : strict partout.
{
  const strictFlags = ['strict', 'noUnusedLocals', 'noUnusedParameters', 'noImplicitAny'];
  const app = fs.readFileSync(path.join(ROOT, 'tsconfig.app.json'), 'utf8');
  for (const f of strictFlags) if (!new RegExp(`"${f}"\\s*:\\s*true`).test(app)) add(`tsconfig:${f}-off`);
  const root = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
  if (/"strictNullChecks"\s*:\s*false/.test(root)) add('tsconfig:root-strictNullChecks-off');
}

// 6. Formatage : tout fichier hors baseline doit être formaté (Prettier, .prettierrc.json) ; toucher un fichier de la
// baseline puis le formater l'en retire (`pnpm quality:update`).
{
  const out = run('npx', ['prettier', '--list-different', 'src/**/*.{ts,tsx}']);
  for (const line of out.split(/\r?\n/)) if (line.trim()) add(`format:unformatted:${line.trim().replace(/\\/g, '/')}`);
}

// 7. Options TypeScript plus strictes : le nombre d'erreurs ne peut que baisser, jusqu'à pouvoir activer l'option.
for (const flag of ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes']) {
  const out = run('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit', `--${flag}`]);
  const n = (out.match(/error TS/g) || []).length;
  if (n) add(`tsc:${flag}`, n);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (args.has('--report') || !baseline) {
  const byGroup = {};
  for (const [k, v] of Object.entries(counts)) {
    const g = k.split(':').slice(0, 2).join(':');
    byGroup[g] = (byGroup[g] || 0) + v;
  }
  console.log(JSON.stringify(byGroup, null, 2));
  console.log(`total : ${total}`);
  if (!baseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + '\n');
    console.log('baseline créée : scripts/quality-baseline.json');
  }
  if (args.has('--report')) process.exit(0);
}

if (baseline) {
  const worse = [];
  const better = [];
  for (const [k, v] of Object.entries(counts)) {
    const b = baseline[k] ?? 0;
    if (v > b) worse.push(`${k} : ${v} (baseline ${b})`);
    else if (v < b) better.push(k);
  }
  for (const k of Object.keys(baseline)) if (!(k in counts)) better.push(k);
  if (args.has('--update')) {
    const next = {};
    for (const [k, v] of Object.entries(counts)) if (v <= (baseline[k] ?? 0)) next[k] = v;
    fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + '\n');
    console.log(`cliquet resserré : ${better.length} entrées en baisse ou supprimées`);
  }
  if (worse.length) {
    console.error('check-quality : ÉCHEC, nouvelles violations :');
    worse.slice(0, 60).forEach((w) => console.error('  ' + w));
    if (worse.length > 60) console.error(`  … et ${worse.length - 60} autres`);
    process.exit(1);
  }
  if (!args.has('--update')) console.log(`check-quality : ok (${total} violations de dette, ${better.length} à resserrer avec --update)`);
}
