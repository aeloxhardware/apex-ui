import hoverSoundSrc from "@/assets/sounds/hover.mp3";
import clickSoundSrc from "@/assets/sounds/click.mp3";
import spacePreparationSoundSrc from "@/assets/sounds/space-preparation.mp3";
import spacePreviewSoundSrc from "@/assets/sounds/space-preview.mp3";
import spaceModelingSoundSrc from "@/assets/sounds/space-modeling.mp3";

// Lecture via la Web Audio API plutôt que des HTMLAudioElement : chaque son
// est décodé UNE fois en AudioBuffer, puis chaque appel crée sa propre
// AudioBufferSourceNode. Les lectures qui se chevauchent (survol rapide,
// clic pendant un hover, changement d'onglet...) se mixent donc et vont
// toutes jusqu'au bout, sans latence de chargement ni rejet aléatoire de
// play() comme avec un `new Audio()` à chaque appel.
const SOUND_FILES = {
  hover: hoverSoundSrc,
  click: clickSoundSrc,
  spacePreparation: spacePreparationSoundSrc,
  spacePreview: spacePreviewSoundSrc,
  spaceModeling: spaceModelingSoundSrc,
} as const;

export type UiSoundName = keyof typeof SOUND_FILES;

const VOLUME: Record<UiSoundName, number> = {
  hover: 0.35,
  click: 0.5,
  spacePreparation: 0.5,
  spacePreview: 0.5,
  spaceModeling: 0.5,
};

// Début de lecture (en secondes) dans le fichier : les sons d'espace ont un
// blanc/une attaque en tête qu'on saute pour qu'ils collent au clic.
const START_OFFSET: Partial<Record<UiSoundName, number>> = {
  spacePreparation: 0.3,
  spacePreview: 0.3,
  spaceModeling: 0.3,
};

const MUTE_STORAGE_KEY = "apex-ui-sound-muted";

// Coupés par défaut : seule la présence explicite de "false" dans le
// localStorage (l'utilisateur a déjà réactivé le son une fois) désactive le
// mute. Toute autre valeur (absente, "true", corrompue) => muet.
function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

let muted = readStoredMuted();
const listeners = new Set<(muted: boolean) => void>();

export function isUiSoundMuted() {
  return muted;
}

function setUiSoundMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(next));
  } catch {
    // no-op : localStorage indisponible (navigation privée, quota...).
  }
  listeners.forEach((listener) => listener(muted));
}

export function toggleUiSoundMuted() {
  setUiSoundMuted(!muted);
}

export function subscribeUiSoundMuted(listener: (muted: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;
const buffers: Partial<Record<UiSoundName, AudioBuffer>> = {};
let buffersLoading: Promise<void> | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

/** Fermeture de l'application : libère le contexte audio et les sons décodés (RAM). */
export function closeUiAudio() {
  for (const name of Object.keys(buffers) as UiSoundName[]) delete buffers[name];
  buffersLoading = null;
  void audioContext?.close().catch((): void => undefined);
  audioContext = null;
}

function loadBuffers(context: AudioContext) {
  buffersLoading ??= Promise.all(
    (Object.entries(SOUND_FILES) as [UiSoundName, string][]).map(async ([name, src]) => {
      try {
        const response = await fetch(src);
        const data = await response.arrayBuffer();
        buffers[name] = await context.decodeAudioData(data);
      } catch {
        // no-op : un son manquant ne doit pas empêcher les autres de charger.
      }
    }),
  ).then(() => {});
  return buffersLoading;
}

// Le navigateur garde l'AudioContext suspendu tant qu'il n'y a pas eu de
// geste utilisateur (clic, touche) - un survol ne compte pas. On le débloque
// donc au premier geste, puis on retire les listeners.
function setupUnlock() {
  const context = getAudioContext();
  if (!context) return;
  void loadBuffers(context);
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const unlock = () => {
    void context.resume().then(() => {
      if (context.state === "running") {
        events.forEach((type) => window.removeEventListener(type, unlock, true));
      }
    }).catch(() => {});
  };
  events.forEach((type) => window.addEventListener(type, unlock, true));
}

setupUnlock();

function startBuffer(context: AudioContext, name: UiSoundName, buffer: AudioBuffer) {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = VOLUME[name];
  source.connect(gain).connect(context.destination);
  source.start(0, Math.min(START_OFFSET[name] ?? 0, buffer.duration));
}

export function playUiSound(name: UiSoundName) {
  if (muted) return;
  const context = getAudioContext();
  if (!context) return;
  try {
    if (context.state === "suspended") void context.resume().catch(() => {});
    const buffer = buffers[name];
    if (buffer) {
      startBuffer(context, name, buffer);
      return;
    }
    // Premier appel avant la fin du décodage : on joue dès que c'est prêt.
    void loadBuffers(context).then(() => {
      const loaded = buffers[name];
      if (loaded && !muted) startBuffer(context, name, loaded);
    });
  } catch {
    // no-op : environnement sans Web Audio ou source indisponible.
  }
}
