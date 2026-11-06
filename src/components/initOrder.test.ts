import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Trois grosses fermetures (viewport, calque G-code, contrôleur d'édition) s'initialisent par
// morceaux `setupXxx(st)` qui se passent leurs valeurs par un objet d'état `st`. Un morceau qui
// lirait une valeur pas encore posée planterait au premier lancement sans que le compilateur le
// voie : ce test vérifie statiquement l'ordre d'initialisation de chacune.

const SRC = path.dirname(fileURLToPath(import.meta.url));

interface Split {
  name: string;
  /** Fichier qui appelle les sections dans l'ordre. */
  entry: string;
  /** Dossier des morceaux. */
  dir: string;
  /** Appels de section dans `entry`. */
  sectionCall: RegExp;
  /** Préfixe du nom des fonctions de section. */
  sectionName: RegExp;
  /** Fichier d'état et nom du type des valeurs fournies d'avance par l'appelant. */
  stateFile: string;
  hostType: string;
}

const SPLITS: Split[] = [
  {
    name: 'viewport', entry: 'Viewport3D.tsx', dir: 'viewport', sectionCall: /(setupViewport\w+)\(st\)/g,
    sectionName: /^setupViewport/, stateFile: 'viewportState.ts', hostType: 'ViewportHost',
  },
  {
    name: 'calque G-code', entry: 'gcodeLayer.ts', dir: 'gcodeLayerParts', sectionCall: /(setupGCodeLayer\w+)\(st\)/g,
    sectionName: /^setupGCodeLayer/, stateFile: 'gcodeLayerState.ts', hostType: 'GCodeLayerStateHost',
  },
  {
    name: 'contrôleur d\'édition', entry: 'edit-node/gcodeEditController.ts', dir: 'edit-node/controllerParts',
    sectionCall: /(setupEditController\w+)\(st\)/g, sectionName: /^setupEditController/,
    stateFile: 'controllerState.ts', hostType: 'EditControllerStateHost',
  },
];

const parse = (file: string) =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function hostFields(split: Split): Set<string> {
  const source = fs.readFileSync(path.join(SRC, split.dir, split.stateFile), 'utf8');
  const match = source.match(new RegExp(`${split.hostType} = Pick<\\w+, ([^>]*)>`));
  if (!match) throw new Error(`${split.hostType} introuvable dans ${split.stateFile}`);
  return new Set(match[1].split('|').map((s) => s.trim().replace(/'/g, '')));
}

function sectionFiles(split: Split): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(SRC, split.dir);
  fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).forEach((f) => {
    parse(path.join(dir, f)).statements.forEach((s) => {
      if (ts.isFunctionDeclaration(s) && s.name && split.sectionName.test(s.name.text)) out.set(s.name.text, f);
    });
  });
  return out;
}

/** Morceaux appelés directement par une section, dans l'ordre. */
function chunkCalls(entry: ts.FunctionDeclaration): string[] {
  const calls: string[] = [];
  entry.body?.statements.forEach((s) => {
    const call = ts.isReturnStatement(s) ? s.expression : ts.isExpressionStatement(s) ? s.expression : undefined;
    if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)) calls.push(call.expression.text);
  });
  return calls;
}

/** Noms lus en tête de morceau (`const { a, b } = st;`). */
function readsOf(fn: ts.FunctionDeclaration, sf: ts.SourceFile): string[] {
  const reads: string[] = [];
  fn.body?.statements.forEach((s) => {
    if (!ts.isVariableStatement(s)) return;
    s.declarationList.declarations.forEach((d) => {
      if (ts.isObjectBindingPattern(d.name) && d.initializer?.getText(sf) === 'st') d.name.elements.forEach((e) => reads.push(e.name.getText(sf)));
    });
  });
  return reads;
}

/** Noms posés par un morceau : `st.x = …` et `Object.assign(st, { … })`. */
function writesOf(fn: ts.FunctionDeclaration, sf: ts.SourceFile): string[] {
  const writes: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(n.left) && n.left.expression.getText(sf) === 'st') writes.push(n.left.name.text);
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'Object.assign' && n.arguments[0]?.getText(sf) === 'st'
      && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) {
      n.arguments[1].properties.forEach((p) => writes.push(p.name ? p.name.getText(sf) : p.getText(sf)));
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return writes;
}

describe.each(SPLITS)('initialisation par morceaux : $name', (split) => {
  const entrySource = fs.readFileSync(path.join(SRC, split.entry), 'utf8');
  const order = [...entrySource.matchAll(split.sectionCall)].map((m) => m[1]);
  const files = sectionFiles(split);

  it('appelle toutes les sections définies, chacune une fois', () => {
    expect(order.length).toBeGreaterThan(3);
    expect(new Set(order).size).toBe(order.length);
    expect([...files.keys()].sort()).toEqual([...order].sort());
  });

  it('ne lit jamais dans `st` une valeur qu\'aucun morceau précédent n\'a posée', () => {
    const provided = hostFields(split);
    const problems: string[] = [];
    for (const section of order) {
      const file = files.get(section)!;
      const sf = parse(path.join(SRC, split.dir, file));
      const fns = new Map<string, ts.FunctionDeclaration>();
      sf.statements.filter(ts.isFunctionDeclaration).forEach((s) => s.name && fns.set(s.name.text, s));
      for (const name of chunkCalls(fns.get(section)!)) {
        const fn = fns.get(name);
        if (!fn) { problems.push(`${file}: ${name} introuvable`); continue; }
        readsOf(fn, sf).filter((r) => !provided.has(r)).forEach((r) => problems.push(`${file} > ${name} lit st.${r} avant qu'il soit posé`));
        writesOf(fn, sf).forEach((w) => provided.add(w));
      }
    }
    expect(problems).toEqual([]);
  });
});
