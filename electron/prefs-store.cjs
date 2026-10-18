// Réglages de l'interface (Paramètres) persistés dans un fichier du dossier utilisateur de l'application, au lieu du
// seul localStorage de la page : celui-ci dépend de l'origine (en développement, le port de Vite change quand 8080
// est pris ; en version installée, file://) et peut perdre des écritures si le processus est tué avant son
// enregistrement différé. Le preload recopie ce fichier dans localStorage avant le chargement de la page et lui
// renvoie chaque écriture d'une clé `apex-*`.
const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let cache = null;
const file = () => path.join(app.getPath('userData'), 'apex-settings.json');

function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file());  // atomique : jamais de fichier à moitié écrit
  } catch (error) {
    console.warn('[apex] réglages non enregistrés :', error.message);
  }
}

function register() {
  ipcMain.on('apex:prefs-load', (event) => { event.returnValue = load(); });
  ipcMain.on('apex:prefs-set', (event, key, value) => {
    if (typeof key !== 'string' || !key.startsWith('apex-')) return;
    const data = load();
    if (value === null) delete data[key];
    else if (typeof value === 'string') data[key] = value;
    else return;
    save();
  });
}

module.exports = { register };
