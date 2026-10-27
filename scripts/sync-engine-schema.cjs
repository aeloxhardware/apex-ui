// Schéma des paramètres du moteur (contrat C1, apex/integration/RULES.md §4) :
//   node scripts/sync-engine-schema.cjs            copie le schéma du moteur et régénère les types
//   node scripts/sync-engine-schema.cjs --check    échoue si la copie ou les types sont en retard sur le moteur
//   node scripts/sync-engine-schema.cjs --verify   sans le moteur : copie interne cohérente, types à jour,
//                                                   numéro de contrat identique à APEX_CONTRACT_VERSION
// Le moteur reste la source : `src/generated/` ne s'édite jamais à la main.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const engineSchema = path.join(process.env.APEX_ENGINE_DIR || path.join(root, '..', 'slicer_engine'), 'config', 'params.schema.json');
const outDir = path.join(root, 'src', 'generated');
const schemaCopy = path.join(outDir, 'params.schema.json');
const typesFile = path.join(outDir, 'params.schema.ts');
const contractFile = path.join(root, 'src', 'utils', 'engineContract.ts');

const mode = process.argv.includes('--verify') ? 'verify' : process.argv.includes('--check') ? 'check' : 'sync';

const pascal = (s) => s;

/** Type TypeScript d'un fragment de schéma JSON. */
function tsType(node, indent) {
  if (node.$ref) return node.$ref.replace('#/$defs/', '');
  if (node.anyOf) return [...new Set(node.anyOf.map((n) => tsType(n, indent)))].join(' | ');
  if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  switch (node.type) {
    case 'null': return 'null';
    case 'boolean': return 'boolean';
    case 'integer': case 'number': return 'number';
    case 'string': return 'string';
    case 'array':
      if (node.prefixItems) return `[${node.prefixItems.map((n) => tsType(n, indent)).join(', ')}]`;
      return node.items ? `${wrap(tsType(node.items, indent))}[]` : 'unknown[]';
    case 'object':
      if (node.properties) return objectType(node, indent);
      return 'Record<string, unknown>';
    default: return 'unknown';
  }
}

const wrap = (t) => (/[| ]/.test(t) && !t.startsWith('[') ? `(${t})` : t);

function objectType(node, indent) {
  const pad = '  '.repeat(indent + 1);
  const fields = Object.entries(node.properties).map(([name, prop]) => {
    const doc = prop.description ? `${pad}/** ${prop.description.replace(/\*\//g, '* /').split('\n').join(` */\n${pad}/** `)} */\n` : '';
    return `${doc}${pad}${/^[A-Za-z_]\w*$/.test(name) ? name : JSON.stringify(name)}?: ${tsType(prop, indent + 1)};`;
  });
  return `{\n${fields.join('\n')}\n${'  '.repeat(indent)}}`;
}

/** Tous les champs sont facultatifs : une requête est partielle, le moteur complète avec ses défauts. */
function generateTypes(schema) {
  const lines = [
    '// Généré par scripts/sync-engine-schema.cjs depuis apex-engine/config/params.schema.json. NE PAS ÉDITER.',
    `// Contrat C1, version ${schema['x-apex-contract']}.`,
    '',
    `export const SCHEMA_CONTRACT_VERSION = ${schema['x-apex-contract']};`,
    '',
  ];
  for (const [name, def] of Object.entries(schema.$defs)) {
    if (def.description) lines.push(`/** ${def.description.replace(/\*\//g, '* /').split('\n').join(' ')} */`);
    lines.push(`export interface ${pascal(name)} ${objectType(def, 0)}`, '');
  }
  return lines.join('\n');
}

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fail = (msg) => { console.error(`sync-engine-schema : ${msg}`); process.exit(1); };

function declaredContract() {
  const m = /APEX_CONTRACT_VERSION\s*=\s*(\d+)/.exec(read(contractFile));
  if (!m) fail(`APEX_CONTRACT_VERSION introuvable dans ${path.relative(root, contractFile)}`);
  return Number(m[1]);
}

if (mode === 'sync') {
  if (!fs.existsSync(engineSchema)) fail(`schéma du moteur introuvable : ${engineSchema} (variable APEX_ENGINE_DIR)`);
  const schema = JSON.parse(read(engineSchema));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(schemaCopy, `${JSON.stringify(schema, null, 2)}\n`);
  fs.writeFileSync(typesFile, `${generateTypes(schema)}\n`);
  console.log(`schéma copié (contrat ${schema['x-apex-contract']}), types régénérés dans src/generated/`);
  if (schema['x-apex-contract'] !== declaredContract()) {
    fail(`le moteur est au contrat ${schema['x-apex-contract']}, l'interface déclare ${declaredContract()} : mettre à jour src/utils/engineContract.ts après avoir lu CONTRACT_CHANGES.md du moteur`);
  }
  process.exit(0);
}

if (!fs.existsSync(schemaCopy) || !fs.existsSync(typesFile)) fail('src/generated/ absent : lancer `node scripts/sync-engine-schema.cjs`');
const copy = JSON.parse(read(schemaCopy));
if (read(typesFile) !== `${generateTypes(copy)}\n`) fail('les types générés ne correspondent pas à la copie du schéma : relancer le script');
if (copy['x-apex-contract'] !== declaredContract()) {
  fail(`le schéma copié est au contrat ${copy['x-apex-contract']}, l'interface déclare ${declaredContract()}`);
}
if (mode === 'check') {
  if (!fs.existsSync(engineSchema)) fail(`schéma du moteur introuvable : ${engineSchema}`);
  const live = JSON.parse(read(engineSchema));
  if (JSON.stringify(live) !== JSON.stringify(copy)) {
    fail(`la copie est en retard sur le moteur (contrat moteur ${live['x-apex-contract']}, copie ${copy['x-apex-contract']}) : relancer le script`);
  }
}
console.log(`schéma et contrat ${copy['x-apex-contract']} cohérents`);
