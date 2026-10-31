// Profils d'imprimantes : le dossier `profiles/` est le catalogue. Chaque sous-dossier est un
// niveau du menu Imprimantes ; une imprimante = `<nom>.json` (+ `<nom>.png`, la photo) placés dans
// le dossier de son niveau. Module partagé par Electron (IPC) et le serveur de développement Vite.
const fs = require('node:fs');
const path = require('node:path');

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);

/** Chemins relatifs toujours en `/`, quel que soit le système. */
const toRel = (...parts) => parts.filter(Boolean).join('/');

/** Catalogue propre à Apex : jamais grisé, même sans profil OrcaSlicer. */
const OWN_FOLDERS = new Set(['Aelox Hardware']);

/** Une imprimante est inactive si son profil ne vient pas d'OrcaSlicer (`apex.orca_source` nul). */
function hasOrcaSource(abs) {
  try {
    const j = JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '') || 'null');
    return !!j?.apex?.orca_source;
  } catch {
    return false;
  }
}

/**
 * Arbre du dossier : { name, path, folders: [...], printers: [{ name, path, inactive }], inactive }.
 * `path` d'une imprimante est celui de son .json, relatif à la racine.
 */
function scanProfiles(root, rel = '') {
  const abs = path.join(root, ...rel.split('/').filter(Boolean));
  const node = { name: rel ? rel.split('/').pop() : '', path: rel, folders: [], printers: [], inactive: false };
  const own = OWN_FOLDERS.has(rel.split('/')[0]);
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return node;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      node.folders.push(scanProfiles(root, toRel(rel, entry.name)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      const name = entry.name.slice(0, -'.json'.length);
      node.printers.push({ name, path: toRel(rel, entry.name), inactive: !own && !hasOrcaSource(path.join(abs, entry.name)) });
    }
  }
  // Un dossier est inactif quand tout ce qu'il contient l'est (un dossier vide reste actif).
  node.inactive = node.folders.length + node.printers.length > 0
    && node.folders.every((f) => f.inactive) && node.printers.every((p) => p.inactive);
  node.folders.sort(byName);
  node.printers.sort(byName);
  return node;
}

/**
 * Lit un profil : { status: 'ok' | 'empty' | 'invalid', data, error, image }.
 * `image` : data URL de la photo voisine (même nom, .png), null si absente ou vide.
 * Refuse tout chemin qui sortirait de la racine ou qui n'est pas un .json.
 */
function readProfile(root, rel) {
  if (typeof rel !== 'string' || !rel.toLowerCase().endsWith('.json')) {
    throw new Error('Profil invalide.');
  }
  const abs = path.resolve(root, ...rel.split('/'));
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('Profil hors du dossier profiles.');

  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { status: 'invalid', data: null, error: err.message, image: null };
  }

  let result;
  if (text.trim() === '') {
    result = { status: 'empty', data: null, error: null };
  } else {
    try {
      result = { status: 'ok', data: JSON.parse(text.replace(/^﻿/, '')), error: null };
    } catch (err) {
      result = { status: 'invalid', data: null, error: err.message };
    }
  }

  let image = null;
  try {
    const png = fs.readFileSync(abs.slice(0, -'.json'.length) + '.png');
    if (png.length > 0) image = `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    // pas de photo
  }
  return { ...result, image };
}

module.exports = { scanProfiles, readProfile };
