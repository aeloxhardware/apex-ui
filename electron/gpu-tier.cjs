// Niveau de puissance GPU, évalué avant l'ouverture de la moindre fenêtre. Le résultat est publié dans la variable
// d'environnement `low_gpu_pwr` : « 1 » si aucun GPU de la machine n'atteint au moins une RTX 3080, « 0 » sinon.
// Les effets coûteux (verre liquide natif, cf. backdrop.cjs) se désactivent quand elle vaut 1.
//
// Ce n'est pas un banc d'essai chronométré (trop long et trop instable avant l'affichage d'une fenêtre) : on lit
// le nom des GPU et on le compare à une liste de modèles au moins équivalents à une RTX 3080.
// Forcer le résultat : lancer avec `low_gpu_pwr=1` (ou `0`) déjà défini ; il est alors laissé tel quel.
const { execFile } = require('node:child_process');

// Modèles de puissance supérieure ou égale à une RTX 3080 (hors portables, plus lents à nom égal).
const AT_LEAST_RTX_3080 = [
  /RTX\s*30[89]0/i,                       // 3080, 3080 Ti, 3090, 3090 Ti
  /RTX\s*40(70\s*(Ti|Super)|[89]0)/i,     // 4070 Ti, 4070 Super, 4080, 4090
  /RTX\s*50(70\s*Ti|[89]0)/i,             // 5070 Ti, 5080, 5090
  /RTX\s*A(4500|5000|5500|6000)/i,        // stations de travail équivalentes
  /RX\s*6[89]00/i,                        // 6800, 6800 XT, 6900 XT
  /RX\s*7(800\s*XT|900)/i,                // 7800 XT, 7900
  /RX\s*9070/i,
];
const LAPTOP = /laptop|mobile|max-q/i;

function listGpuNames() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
      { timeout: 4000, windowsHide: true },
      (error, stdout) => resolve(error ? [] : String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)),
    );
  });
}

function isAtLeastRtx3080(name) {
  return !LAPTOP.test(name) && AT_LEAST_RTX_3080.some((re) => re.test(name));
}

/** Évalue la machine et renseigne `process.env.low_gpu_pwr` ; renvoie vrai si la puissance est jugée faible. */
async function detectLowGpuPower() {
  if (process.env.low_gpu_pwr === '0' || process.env.low_gpu_pwr === '1') return process.env.low_gpu_pwr === '1';
  const names = await listGpuNames();
  // Détection impossible (autre OS, PowerShell absent) : on ne bride rien.
  const low = names.length > 0 && !names.some(isAtLeastRtx3080);
  process.env.low_gpu_pwr = low ? '1' : '0';
  console.log(`[apex] GPU : ${names.join(' | ') || 'inconnu'} -> low_gpu_pwr=${process.env.low_gpu_pwr}`);
  return low;
}

module.exports = { detectLowGpuPower };
