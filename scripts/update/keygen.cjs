// Génère la paire de clés Ed25519 qui signe les manifestes de mise à jour.
//   node scripts/update/keygen.cjs [dossier-de-la-clé-privée]
// La clé PUBLIQUE va dans electron/update-public-key.pem (commitée, embarquée dans l'application). La clé PRIVÉE reste
// hors des dépôts (défaut : ~/.apex/update-private.pem) : qui la détient peut publier des mises à jour que tous les
// postes installeront. Ne jamais la committer, ne jamais la perdre (sans elle, plus de mise à jour possible : il faudrait
// livrer une nouvelle clé publique par réinstallation).
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = process.argv[2] || path.join(os.homedir(), '.apex');
const privateFile = path.join(dir, 'update-private.pem');
const publicFile = path.join(__dirname, '../../electron/update-public-key.pem');
if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) {
  console.error('Une clé existe déjà : la supprimer à la main pour en refaire une (cela invalide toutes les installations existantes).');
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Clé privée : ${privateFile}\nClé publique : ${publicFile}`);
