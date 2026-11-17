// Réserve de fichiers temporaires : les données d'un espace quitté (modèles du plateau, G-code analysé)
// y sont déposées pour libérer la RAM, puis relues au retour. Un dossier par lancement, supprimé à la
// fermeture : rien ne survit à une session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let root = null;

function dir() {
  if (!root) root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-stash-'));
  return root;
}

/** Une clé ne désigne jamais qu'un fichier de la réserve : tout ce qui sort de l'alphabet sûr est remplacé. */
function fileOf(key) {
  if (typeof key !== 'string' || !key) throw new Error('Clé de réserve invalide.');
  return path.join(dir(), key.replace(/[^a-zA-Z0-9_.-]/g, '_'));
}

async function write(key, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Données de réserve invalides.');
  await fs.promises.writeFile(fileOf(key), bytes);
}

/** Octets du fichier, ou null s'il n'existe pas. */
async function read(key) {
  try {
    return await fs.promises.readFile(fileOf(key));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function drop(key) {
  await fs.promises.rm(fileOf(key), { force: true });
}

function purge() {
  if (!root) return;
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* fichier verrouillé : l'OS nettoiera le dossier temporaire */ }
  root = null;
}

module.exports = { write, read, drop, purge };
