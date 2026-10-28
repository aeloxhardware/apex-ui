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

const registryFile = path.join(root, 'src', 'utils', 'engineSettings.json');

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

/**
 * Chaque réglage du panneau (engineSettings.json) doit désigner un champ réel du schéma, du bon type, avec le même
 * défaut et les mêmes valeurs énumérées : un paramètre renommé ou retiré par le moteur fait échouer la construction.
 */
function verifyRegistry(schema) {
  const defs = schema.$defs;
  const refOf = (node) => (node.$ref ?? (node.anyOf ?? []).find((n) => n.$ref)?.$ref ?? '').split('/').pop();
  const problems = [];
  for (const s of JSON.parse(read(registryFile))) {
    const [root0, ...rest] = s.path.split('.');
    let def = root0 === 'gcode_params' ? defs.GcodeParams : defs.PipelineParams;
    let node = null;
    let pipelineDefault = root0 === 'gcode_params' ? undefined : schema.$defs.PipelineParams.properties;
    const keys = root0 === 'gcode_params' ? rest : [root0, ...rest];
    let ok = true;
    for (const [i, key] of keys.entries()) {
      node = def.properties[key];
      if (!node) { problems.push(`${s.path} : « ${key} » absent du schéma`); ok = false; break; }
      if (i < keys.length - 1) def = defs[refOf(node)];
    }
    if (!ok) continue;
    const types = (node.anyOf ?? [node]).map((n) => n.type).filter(Boolean).sort().join('|');
    const expected = s.type === 'number|null' ? 'null|number' : s.type;
    if (types !== expected) problems.push(`${s.path} : type ${types} dans le schéma, ${s.type} dans la liste`);
    // Le schéma n'énumère pas toujours les valeurs (ex. `mesher`, chaîne libre côté schéma) : on compare quand il le fait.
    if (s.enum && node.enum && JSON.stringify(node.enum) !== JSON.stringify(s.enum)) problems.push(`${s.path} : valeurs énumérées différentes`);
    // Défaut : celui du champ, sinon celui de l'objet imbriqué par défaut de PipelineParams (ex. collision.safety_margin).
    let dflt = node.default;
    if (dflt === undefined && keys.length === 2 && pipelineDefault) dflt = pipelineDefault[keys[0]]?.default?.[keys[1]];
    if (dflt !== undefined && dflt !== s.default) problems.push(`${s.path} : défaut ${dflt} dans le schéma, ${s.default} dans la liste`);
  }
  if (problems.length) fail(['engineSettings.json en désaccord avec le schéma :', ...problems.map((p) => `  ${p}`)].join(String.fromCharCode(10)));
}

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
  verifyRegistry(schema);
  if (schema['x-apex-contract'] !== declaredContract()) {
    fail(`le moteur est au contrat ${schema['x-apex-contract']}, l'interface déclare ${declaredContract()} : mettre à jour src/utils/engineContract.ts après avoir lu CONTRACT_CHANGES.md du moteur`);
  }
  process.exit(0);
}

if (!fs.existsSync(schemaCopy) || !fs.existsSync(typesFile)) fail('src/generated/ absent : lancer `node scripts/sync-engine-schema.cjs`');
const copy = JSON.parse(read(schemaCopy));
if (read(typesFile) !== `${generateTypes(copy)}\n`) fail('les types générés ne correspondent pas à la copie du schéma : relancer le script');
verifyRegistry(copy);
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
