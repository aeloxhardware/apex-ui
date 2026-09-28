// Télécharge la distribution Python « embeddable » officielle (Windows x64, bibliothèque standard
// seule, ~11 Mo) dans build/python-embed/, embarquée ensuite dans l'application par electron-builder
// (build.win.extraResources → resources/python/) pour exécuter python/gcode_to_polar.py sans que
// Python soit installé sur la machine. Sans effet si elle est déjà présente.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const JSZip = require('jszip');

const PYTHON_VERSION = '3.12.10';
const DOWNLOAD_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const TARGET = path.join(__dirname, '..', 'build', 'python-embed');

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Téléchargement impossible (${res.statusCode}) : ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(path.join(TARGET, 'python.exe'))) {
    console.log(`Python embarqué déjà présent : ${TARGET}`);
    return;
  }
  console.log(`Téléchargement de Python ${PYTHON_VERSION} (embeddable)…`);
  const zip = await JSZip.loadAsync(await download(DOWNLOAD_URL));
  fs.mkdirSync(TARGET, { recursive: true });
  for (const entry of Object.values(zip.files)) {
    const dest = path.join(TARGET, entry.name);
    if (!dest.startsWith(TARGET)) throw new Error(`Entrée d'archive suspecte : ${entry.name}`);
    if (entry.dir) {
      fs.mkdirSync(dest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await entry.async('nodebuffer'));
    }
  }
  console.log(`Python embarqué prêt : ${TARGET}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
