// Installation reelle d'Apex Slicer (Windows) : extraction du paquet embarque, enregistrement dans « Programmes et
// fonctionnalites », raccourcis, desinstalleur. Appele par main.cjs (installer:run-install / --uninstall).
//
// Le paquet est `payload/apex-slicer.zip` (le slicer empaquete, win-unpacked d'electron-builder) + `payload.json`
// (nombre de fichiers, taille) : voir installer/scripts/make-payload.cjs. Extraction par tar.exe (bsdtar, fourni avec
// Windows 10+), dont la sortie verbeuse sert de compteur de progression.
const { app, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PRODUCT = 'Apex Slicer';
const MAIN_EXE = 'Apex Slicer.exe';
const UNINSTALL_SCRIPT = 'uninstall.ps1';
const MARKER = 'apex-install.json';
const REG_KEY = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ApexSlicer';

const STEPS = [
  'Preparing the destination folder',
  "Copying application files",
  'Registering the program',
  'Creating shortcuts',
  'Finishing up',
];

function payloadDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'payload') : path.join(__dirname, '..', 'payload');
}

/** Dossier « Apex Slicer » du menu Demarrer (tous les utilisateurs) : le raccourci de l'application et celui de
 * desinstallation, comme une application du Store. */
function startMenuDir() {
  return path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT);
}

/** Commande de desinstallation (registre « Programmes et fonctionnalites » et raccourci du menu Demarrer). */
function uninstallCommand(dest) {
  const script = path.join(dest, UNINSTALL_SCRIPT);
  return { args: `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`, script };
}

function desktopShortcut() {
  return path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop', `${PRODUCT}.lnk`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} a echoue (${code}) : ${stderr.trim()}`))));
  });
}

/** Refuse les destinations dangereuses ; renvoie le chemin normalise. */
function validateDestination(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error("No installation folder specified.");
  const dest = path.resolve(raw.trim());
  if (!path.isAbsolute(dest) || path.parse(dest).root === dest) throw new Error("The installation folder cannot be the root of a drive.");
  const windir = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  if (dest.toLowerCase().startsWith(windir)) throw new Error("The installation folder cannot be inside the Windows folder.");
  return dest;
}

/** Extrait le zip avec tar.exe en comptant les lignes de sortie (une par fichier) pour la progression. */
function extractZip(zip, dest, totalFiles, onFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xvf', zip, '-C', dest], { windowsHide: true });
    let count = 0;
    let buffer = '';
    let stderr = '';
    const feed = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        count += 1;
        onFile(Math.min(count, totalFiles), totalFiles);
      }
    };
    // bsdtar ecrit la liste verbeuse sur stderr.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; feed(d); });
    child.stdout.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      // bsdtar sort en erreur pour un simple avertissement « Can't restore time » (ex. dossier dont le nom finit par un point,
      // comme « HP Inc. » dans profiles/, que Windows normalise) : seuls les VRAIS echecs de fichier comptent.
      const fatal = stderr.split(/\r?\n/).filter((line) =>
        /(: (Can't|Cannot|Failed|Permission|Access|Unable)|denied|refus)/i.test(line) && !/Can't restore time/i.test(line));
      if (fatal.length === 0) { resolve(); return; }
      reject(new Error(`Extraction impossible : ${fatal.slice(0, 3).join(' | ')}`));
    });
  });
}

let lastInstall = null;

/** Installe. `emit({index,total,label,percent})` rend compte de l'avancement. Ne leve jamais : renvoie {success, error?}. */
async function runInstall(options, emit) {
  const total = STEPS.length;
  const step = (index, percent) => emit({ index, total, label: STEPS[index], percent });
  let dest = null;
  let createdDir = false;
  const created = { registry: false, desktop: null, startMenu: null };
  try {
    // 1. Preparation
    step(0, 0);
    dest = validateDestination(options && options.installPath);
    const zip = path.join(payloadDir(), 'apex-slicer.zip');
    if (!fs.existsSync(zip)) throw new Error(`Package not found: ${zip}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(payloadDir(), 'payload.json'), 'utf8'));
    if (fs.existsSync(dest)) {
      const entries = fs.readdirSync(dest);
      if (entries.length > 0 && !entries.includes(MARKER)) {
        throw new Error("The chosen folder is not empty and does not contain an Apex installation: choose an empty folder.");
      }
      // Reinstallation / reparation par-dessus une installation existante : l'application ne doit pas tourner (fichiers verrouilles).
      if (entries.includes(MARKER)) {
        await run('taskkill.exe', ['/F', '/IM', MAIN_EXE]).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    } else {
      fs.mkdirSync(dest, { recursive: true });
      createdDir = true;
    }
    fs.writeFileSync(path.join(dest, '.apex-write-test'), 'ok');
    fs.rmSync(path.join(dest, '.apex-write-test'));
    try {
      const stat = fs.statfsSync(dest);
      if (stat.bavail * stat.bsize < (manifest.bytes || 0) * 1.1) throw new Error("Not enough disk space in the installation folder.");
    } catch (error) {
      if (/Not enough disk space/.test(error.message)) throw error;  // statfs indisponible : on continue
    }

    // 2. Copie
    step(1, 0);
    await extractZip(zip, dest, manifest.files || 1, (done, all) => {
      emit({ index: 1, total, label: STEPS[1], percent: Math.round(((1 + done / all) / total) * 100) });
    });
    const exe = path.join(dest, MAIN_EXE);
    if (!fs.existsSync(exe)) throw new Error(`Incomplete installation: ${MAIN_EXE} is missing.`);

    // 3. Enregistrement : marqueur + choix, desinstalleur, « Programmes et fonctionnalites »
    step(2, Math.round((2 / total) * 100));
    fs.writeFileSync(
      path.join(dest, MARKER),
      JSON.stringify({ product: PRODUCT, version: manifest.version || app.getVersion(), installedAt: new Date().toISOString(), options }, null, 2),
    );
    // Desinstalleur : un petit script PowerShell (electron/uninstall.ps1), pas une copie de l'installateur (260 Mo).
    const uninstall = uninstallCommand(dest);
    fs.copyFileSync(path.join(__dirname, 'uninstall.ps1'), uninstall.script);
    const reg = (name, type, value) => run('reg.exe', ['add', REG_KEY, '/v', name, '/t', type, '/d', String(value), '/f']);
    await reg('DisplayName', 'REG_SZ', PRODUCT);
    await reg('DisplayVersion', 'REG_SZ', manifest.version || app.getVersion());
    await reg('Publisher', 'REG_SZ', 'Aelox Hardware');
    await reg('InstallLocation', 'REG_SZ', dest);
    await reg('DisplayIcon', 'REG_SZ', exe);
    await reg('EstimatedSize', 'REG_DWORD', Math.round((manifest.bytes || 0) / 1024));
    await reg('NoModify', 'REG_DWORD', 1);
    await reg('NoRepair', 'REG_DWORD', 1);
    await reg('UninstallString', 'REG_SZ', `powershell.exe ${uninstall.args}`);
    created.registry = true;

    // 4. Raccourcis
    step(3, Math.round((3 / total) * 100));
    const link = { target: exe, cwd: dest, icon: exe, iconIndex: 0, description: PRODUCT };
    if (options.createStartMenuShortcut) {
      created.startMenu = startMenuDir();
      fs.mkdirSync(created.startMenu, { recursive: true });
      if (!shell.writeShortcutLink(path.join(created.startMenu, `${PRODUCT}.lnk`), 'create', link)) throw new Error('Could not create the Start menu shortcut.');
      // Desinstallation directement depuis le menu Demarrer (sans passer par « Ajouter ou supprimer des programmes »).
      const removal = { target: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        args: uninstall.args, cwd: dest, icon: exe, iconIndex: 0, description: `Desinstaller ${PRODUCT}` };
      if (!shell.writeShortcutLink(path.join(created.startMenu, `Uninstall ${PRODUCT}.lnk`), 'create', removal)) throw new Error('Could not create the uninstall shortcut.');
    }
    if (options.createDesktopShortcut) {
      created.desktop = desktopShortcut();
      if (!shell.writeShortcutLink(created.desktop, 'create', link)) throw new Error('Could not create the Desktop shortcut.');
    }

    // 5. Finalisation
    step(4, 100);
    lastInstall = { exe, dest };
    return { success: true, exe };
  } catch (error) {
    // Retour arriere : on ne laisse rien de a moitie installe.
    try { if (created.registry) await run('reg.exe', ['delete', REG_KEY, '/f']); } catch { /* ignore */ }
    for (const f of [created.desktop, created.startMenu]) { try { if (f) fs.rmSync(f, { recursive: true, force: true }); } catch { /* ignore */ } }
    try { if (dest && createdDir) fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    return { success: false, error: error.message };
  }
}

/** Lance l'application installee SANS les droits eleves de l'installateur (via l'explorateur : glisser-deposer d'un
 * fichier depuis l'explorateur ne marcherait pas dans une fenetre eleve). */
function launchInstalled() {
  if (!lastInstall) return false;
  spawn('explorer.exe', [lastInstall.exe], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

module.exports = { runInstall, launchInstalled, STEPS, MARKER, PRODUCT };
