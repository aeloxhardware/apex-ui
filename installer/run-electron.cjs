// Voir scripts/run-electron.cjs a la racine du projet pour le detail du
// probleme contourne ici (ELECTRON_RUN_AS_NODE qui fuit depuis l'outil qui
// lance ce process et fait planter Electron en mode pur Node).
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
  cwd: __dirname,
});

child.on('close', (code) => process.exit(code ?? 0));
