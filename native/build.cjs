// Construit l'addon natif (native/build/apex_edit.node) contre les en-tetes de l'Electron
// installe, avec la chaine MSVC deja utilisee par le moteur (vswhere -> vcvars64.bat), le CMake
// et le Ninja livres avec Visual Studio : rien a installer en plus. Windows x64 seulement pour
// l'instant (macOS / Linux demanderont leur propre chaine, voir CLAUDE.md).
//
//   node native/build.cjs           construit le noyau, l'addon, les tests et le banc
//   node native/build.cjs --test    ... puis lance les tests (CTest)
//
// Variables facultatives : ELECTRON_HEADERS (dossier include/node), ELECTRON_NODE_LIB (node.lib),
// CMAKE_EXE, NINJA_EXE.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(__dirname, 'build');

function fail(message) {
  console.error(`[apex_edit] ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') fail('construction automatisee prevue pour Windows seulement.');

const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const gypRoot = path.join(os.homedir(), '.electron-gyp', electronVersion);
const headers = process.env.ELECTRON_HEADERS || path.join(gypRoot, 'include', 'node');
const nodeLib = process.env.ELECTRON_NODE_LIB || path.join(gypRoot, 'x64', 'node.lib');
if (!fs.existsSync(path.join(headers, 'node_api.h'))) {
  fail(`en-tetes d'Electron ${electronVersion} introuvables dans ${headers}.`);
}
if (!fs.existsSync(nodeLib)) fail(`node.lib d'Electron ${electronVersion} introuvable : ${nodeLib}.`);

const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!fs.existsSync(vswhere)) fail('vswhere.exe introuvable : Visual Studio ou les Build Tools sont-ils installes ?');
const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
const vsRoot = (found.stdout || '').trim().split(/\r?\n/)[0];
if (!vsRoot) fail('aucune installation Visual Studio avec les outils C++ x64.');

const vcvars = path.join(vsRoot, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
const bundled = path.join(vsRoot, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft');
const cmake = process.env.CMAKE_EXE || path.join(bundled, 'CMake', 'CMake', 'bin', 'cmake.exe');
const ctest = path.join(path.dirname(cmake), 'ctest.exe');
const ninja = process.env.NINJA_EXE || path.join(bundled, 'CMake', 'Ninja', 'ninja.exe');
const runTests = process.argv.includes('--test');
for (const [label, file] of [['vcvars64.bat', vcvars], ['cmake.exe', cmake], ['ninja.exe', ninja]]) {
  if (!fs.existsSync(file)) fail(`${label} introuvable : ${file}`);
}

// Un .cmd temporaire evite tout probleme de guillemets imbriques avec cmd.exe.
const script = path.join(os.tmpdir(), `apex_edit_build_${process.pid}.cmd`);
const q = (p) => `"${p}"`;
fs.writeFileSync(script, [
  '@echo off',
  `call ${q(vcvars)} >nul || exit /b 1`,
  `${q(cmake)} -S ${q(__dirname)} -B ${q(buildDir)} -G Ninja -DCMAKE_MAKE_PROGRAM=${q(ninja)} -DCMAKE_BUILD_TYPE=Release -DELECTRON_HEADERS=${q(headers)} -DELECTRON_NODE_LIB=${q(nodeLib)} || exit /b 1`,
  `${q(cmake)} --build ${q(buildDir)} || exit /b 1`,
  ...(runTests ? [`${q(ctest)} --test-dir ${q(buildDir)} --output-on-failure || exit /b 1`] : []),
].join('\r\n'));

const result = spawnSync('cmd.exe', ['/d', '/c', script], { stdio: 'inherit' });
fs.rmSync(script, { force: true });
if (result.status !== 0) fail('echec de la construction.');
console.log(`[apex_edit] OK : ${path.join(buildDir, 'apex_edit.node')} (Electron ${electronVersion})`);
