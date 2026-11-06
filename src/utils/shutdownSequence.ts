/**
 * Fermeture d'Apex en étapes (rideau de fermeture). Le processus principal intercepte toute demande de fermeture
 * (electron/shutdown.cjs → `apexDesktop.onCloseRequested`) ; ce module joue alors les huit étapes dans l'ordre. Chaque
 * message correspond à une vraie opération (rien n'est décoratif) : l'application ne doit laisser aucune trace derrière
 * elle (processus, caches, fichiers temporaires, verrous). Les réglages de l'utilisateur sont voulus : conservés.
 *
 * Affichage : interface LiquidGlass → événements `apex-shutdown-begin` / `apex-shutdown-message` au rideau plein écran
 * (SpaceTransitionOverlay, au-dessus de tout) ; interface classique → écran noir à plat (ShutdownSequence.tsx).
 */
import { cancelAllParsing } from '@/utils/gcodeParseAsync';
import { closeUiAudio } from '@/utils/uiSound';

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const frames = (n: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(n);
});
const mainStep = (name: string) => window.apexDesktop?.shutdownStep?.(name) ?? Promise.resolve(null);

const CURTAIN_WAIT_MS = 4500;

/** Nom de l'OS pour les messages : fourni par le processus principal, sinon déduit du navigateur. */
function osName(): string {
  const fromMain = window.apexDesktop?.osName;
  if (fromMain) return fromMain;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  return 'Linux';
}

// 1. Plus aucune commande utilisateur : entrées bloquées (capture, avant tout le reste de l'interface), sons libérés.
let inputsBlocked = false;
const swallow = (e: Event) => {
  // Le bouton « Forcer la fermeture » reste utilisable.
  if (e.target instanceof Element && e.target.closest('[data-apex-force-close]')) return;
  e.stopImmediatePropagation();
  e.preventDefault();
};
const BLOCKED_EVENTS = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu', 'dragover', 'drop'];
function unloadControls() {
  if (!inputsBlocked) {
    inputsBlocked = true;
    for (const name of BLOCKED_EVENTS) window.addEventListener(name, swallow, { capture: true, passive: false });
  }
  (document.activeElement as HTMLElement | null)?.blur?.();
  closeUiAudio();
}

// 3. Buffer d'événements : tout ce qui est en file (événements `apex-*`, tâches différées, images) est traité avant la suite.
async function drainEvents() {
  emit('apex-shutdown-drain');
  await sleep(0);
  await frames(2);
  await sleep(0);
}

// 4. RAM / vRAM : scène et moteur 3D libérés (la vRAM suit), caches de la page, puis caches et fichiers temporaires du processus principal.
async function purgeMemory() {
  emit('apex-shutdown-3d', { phase: 'purge' });
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch { /* Cache Storage indisponible */ }
  try { sessionStorage.clear(); } catch { /* indisponible */ }
  await mainStep('purge');
}

interface Step { text: string; run: () => void | Promise<unknown> }

function buildSteps(): Step[] {
  const os = osName();
  return [
    { text: 'Déchargement des système de contrôle utilisateur...', run: unloadControls },
    { text: "Fermeture du portail d'accès à l'espace virtuel 3D....", run: () => emit('apex-shutdown-3d', { phase: 'close' }) },
    { text: "Vidange du buffer d'évènements....", run: drainEvents },
    { text: 'Purge des données stockées en RAM et vRAM...', run: purgeMemory },
    { text: 'Vérification et suspension des tâches en cours....', run: async () => { cancelAllParsing(); await mainStep('tasks'); } },
    { text: "Arrêt des processus du pipeline d'exécution...", run: () => mainStep('pipeline') },
    { text: `Révocation de l'autorité administrateur ${os} du logiciel...`, run: () => mainStep('authority') },
    { text: `Fermeture de la session ${os}`, run: () => mainStep('session') },
  ];
}

let running = false;

/** Joue la fermeture. `showMessage` sert à l'interface classique (écran à plat) ; en LiquidGlass le rideau s'en charge. */
export async function runShutdownSequence(flat: boolean, showMessage: (text: string) => void) {
  if (running) return;
  running = true;
  emit('apex-shutdown-started');
  try {
    if (flat) {
      showMessage('');
    } else {
      // Le rideau s'installe d'abord (flou, tuiles) ; sans lui (interface pas encore montée) on n'attend pas plus que nécessaire.
      const covered = new Promise<void>((resolve) => window.addEventListener('apex-shutdown-curtain-ready', () => resolve(), { once: true }));
      emit('apex-shutdown-begin');
      await Promise.race([covered, sleep(CURTAIN_WAIT_MS)]);
    }
    const steps = buildSteps();
    for (let i = 0; i < steps.length; i++) {
      const { text, run } = steps[i];
      if (flat) showMessage(text); else emit('apex-shutdown-message', { text });
      // Un message ne reste affiché que le temps de son opération : aucune attente ajoutée.
      try { await run(); } catch (error) { console.warn(`[apex] fermeture, « ${text} » :`, error); }
    }
  } finally {
    // Quoi qu'il arrive, l'application se ferme : le processus principal détruit les fenêtres et quitte.
    window.apexDesktop?.shutdownFinish?.();
  }
}
