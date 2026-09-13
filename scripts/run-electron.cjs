// Wrapper de lancement d'Electron.
//
// Claude Code (et d'autres outils bases sur Node/VS Code) definissent parfois
// ELECTRON_RUN_AS_NODE=1 dans leur propre environnement pour executer des
// scripts utilitaires via le binaire Electron sans ouvrir de fenetre. Cette
// variable "fuit" vers les process enfants : si electron.exe est lance avec
// elle presente, il bascule en pur mode Node.js (require('electron') rend
// alors le CHEMIN de l'executable, pas l'API {app, BrowserWindow, ...}), et
// l'app plante avec "Cannot read properties of undefined (reading 'whenReady')".
//
// On relance donc electron.exe nous-memes avec un environnement OU cette cle
// est totalement absente (delete, pas juste videe - une chaine vide ne suffit
// pas a desarmer le comportement cote Electron).
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
