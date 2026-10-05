// Banc de la chaine complete d'edition dans Electron :
//   node native/bench/launch.cjs <fichier.gcode>
// Interface -> MessagePort -> electron/edit-process.cjs -> addon (native/build/apex_edit.node).
// ELECTRON_RUN_AS_NODE est retire de l'environnement, comme dans scripts/run-electron.cjs.
const path = require('node:path');
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const file = process.argv[2];
if (!file) {
  console.error('usage : node native/bench/launch.cjs <fichier.gcode>');
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, 'run-bench.cjs'), path.resolve(file)], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
