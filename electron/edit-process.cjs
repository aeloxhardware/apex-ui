// Processus utilitaire (utilityProcess) qui heberge le noyau C++ d'edition du G-code
// (native/, addon N-API). L'interface lui parle directement par un MessagePort, sans passer par
// le processus principal : requetes { id, op, args }, reponses { id, result } ou { id, error }.
// Un seul noyau pour tout le processus : une seule session d'edition a la fois.
const addonPath = process.argv[2];

let addon = null;
let loadError = null;
try {
  addon = require(addonPath);
} catch (error) {
  loadError = `Noyau d'édition introuvable ou illisible (${addonPath}) : ${error.message}`;
}

const OPS = {
  load: (request) => addon.load(request),
  setHandle: (index, influence) => addon.setHandle(index, influence),
  drag: (transform, options) => addon.drag(transform, options ?? {}),
  commit: () => addon.commit(),
  cancel: () => addon.cancel(),
  undo: () => addon.undo(),
  redo: () => addon.redo(),
  setLocked: (indices, locked) => addon.setLocked(indices, locked),
  clearLocks: () => addon.clearLocks(),
};

function serve(port) {
  port.on('message', (event) => {
    const { id, op, args } = event.data ?? {};
    if (!addon) {
      port.postMessage({ id, error: loadError, unavailable: true });
      return;
    }
    const handler = OPS[op];
    if (!handler) {
      port.postMessage({ id, error: `Opération inconnue : ${op}` });
      return;
    }
    try {
      port.postMessage({ id, result: handler(...(Array.isArray(args) ? args : [])) });
    } catch (error) {
      port.postMessage({ id, error: error.message });
    }
  });
  port.start();
}

// Chaque fenetre qui ouvre un canal envoie son propre port.
process.parentPort.on('message', (event) => {
  if (event.data?.type === 'port' && event.ports[0]) serve(event.ports[0]);
});
