const screens = Array.from(document.querySelectorAll('.screen'));
const pathInput = document.getElementById('install-path');

// --- Sons UI (demarrage / survol / clic) ---
// Chaque appel cree une NOUVELLE instance HTMLAudioElement plutot que de
// reutiliser/rembobiner une instance partagee : ainsi deux lectures qui se
// chevauchent (ex. survol rapide de plusieurs boutons, ou clic pendant que
// hover joue encore) ne s'interrompent jamais l'une l'autre - chaque son va
// jusqu'au bout independamment. Volume au maximum (1.0) sur chaque clip.
const SOUND_FILES = {
  prestart: './sounds/prestart.mp3',
  hover: './sounds/hover.mp3',
  // Survol REEL de la croix de fermeture (son distinct du hover generique).
  hoverClose: './sounds/hover-close-real.mp3',
  // Refus/negation : joue quand on clique sur une option non-selectionnable
  // (carte grisee) - historiquement le meme fichier que hoverClose, separe
  // depuis pour ne pas confondre "survol de la croix" et "option refusee".
  refuse: './sounds/hover-close.mp3',
  click: './sounds/click.mp3',
  // Son dedie a la selection d'une carte (plan d'interface, options Oui/Non
  // non-planaire/axes/modelisateur) - distinct du 'click' generique des
  // boutons classiques, pour bien marquer un changement de choix.
  select: './sounds/select.mp3',
  // Joue sur "Continuer l'installation" dans la boite de confirmation
  // critique (annule l'annulation) - distinct du 'click' generique.
  cancelAbort: './sounds/cancel-abort.mp3',
};

// Suivi des sons actuellement en train de jouer, pour pouvoir laisser le
// PROCESS (pas seulement la fenetre) attendre qu'ils finissent avant de
// vraiment se terminer - voir installerApi.notifyClosing() plus bas et le
// handler cote main (electron/main.cjs) qui cache la fenetre puis attend
// 'installer:sounds-idle' avant d'appeler app.exit().
const activeSounds = new Set();

// mesh-background.js est charge en <script type="module">, donc TOUJOURS
// differe (equivalent a defer) meme place apres ce script classique dans
// index.html : le tout premier son (prestart, joue par playIntro() en bas
// de ce fichier) demarre forcement avant que window.__installerAudio
// n'existe. On met donc en file d'attente les instances audio pas encore
// branchees ; mesh-background.js les traite tous des qu'il est pret (voir
// window.__installerAudio.hook et le flush de cette file la-bas).
window.__installerAudioPendingHooks = [];

function playSound(name) {
  const src = SOUND_FILES[name];
  if (!src) return;
  const audio = new Audio(src);
  audio.volume = 1;
  // no-op par defaut : pour 'prestart' (musique d'ambiance ~15s), il n'y a
  // rien a retirer de activeSounds puisqu'il n'y est jamais ajoute (voir
  // ci-dessous) - stopTracking doit neanmoins toujours exister, sinon
  // audio.play().catch(stopTracking) plus bas plantait (ReferenceError)
  // et arretait TOUT le reste du script, y compris playIntro()/l'animation
  // des logos, des le tout premier son joue au chargement de la page.
  let stopTracking = () => {};
  // prestart est volontairement EXCLU du blocage de fermeture : seuls les
  // sons d'interface courts (hover, click, hoverClose) doivent finir de
  // jouer avant que le process se termine vraiment. Sans cette exclusion,
  // fermer l'app pendant les ~15s de prestart forcait une attente percue
  // comme un blocage/artefact (icone taskbar residuelle prolongee).
  if (name !== 'prestart') {
    activeSounds.add(audio);
    stopTracking = () => activeSounds.delete(audio);
    audio.addEventListener('ended', stopTracking, { once: true });
    audio.addEventListener('error', stopTracking, { once: true });
  }
  // Branche cette instance sur l'analyseur audio partage du fond degrade
  // meshique (voir mesh-background.js), pour qu'il reagisse au volume/
  // frequences de ce son - immediatement si le module est deja pret,
  // sinon mis en file pour etre traite des qu'il le sera.
  if (window.__installerAudio) {
    window.__installerAudio.hook(audio);
  } else {
    window.__installerAudioPendingHooks.push(audio);
  }
  // Lecture best-effort : si l'autoplay est bloque (improbable ici, cette
  // lecture est toujours declenchee par un geste utilisateur ou le boot de
  // l'app), on ignore silencieusement plutot que de faire planter le flux.
  audio.play().catch(stopTracking);
}

// Elements animes en cascade a chaque entree d'ecran : logo, titre, texte,
// champs, lignes d'options, barre de progression, boutons... Chaque element
// cible recoit .animItem + un delai (--stagger) proportionnel a sa
// position, pour une sequence lente et bien separee (voir styles.css,
// section "Animation d'entree par element"). STAGGER_STEP_MS plus large
// qu'au premier jet pour laisser chaque etape se terminer avant la
// suivante plutot que de les faire se chevaucher.
const STAGGER_STEP_MS = 130;

function primeScreenAnimations(screen) {
  const items = screen.querySelectorAll(
    // .brandTitle/.brandSubtitle retires : ils sont geres par le crossfade
    // dedie .introTextSwap (voir styles.css), pas par cette animation
    // d'entree generique - .introTextSwap recoit sa propre entree ici.
    '.logoRing, .introTextSwap, .screenHeader > h2, .screenHeader > .screenLead, .field, .optionList > .optionRow, .progressBarTrack, .progressCount, .screenFooter, .doneCheck, .doneTitle, .doneCheck ~ .screenLead, .optionRowCentered, .planList > .planCard, .choiceList > .choiceCard',
  );

  items.forEach((el, index) => {
    el.classList.remove('animItem');
    el.style.removeProperty('--stagger');
    // Force un reflow pour que le retrait de la classe soit bien applique
    // avant qu'on la remette, sinon l'animation ne se relance pas au
    // second passage sur le meme ecran.
    void el.offsetWidth;
    el.style.setProperty('--stagger', `${index * STAGGER_STEP_MS}ms`);
    el.classList.add('animItem');
  });
}

function showScreen(name) {
  for (const screen of screens) {
    const isTarget = screen.dataset.screen === name;
    screen.dataset.active = String(isTarget);
    if (isTarget) primeScreenAnimations(screen);
  }
}

// DEV UNIQUEMENT : reprend toute la fenetre depuis le tout debut (ecran
// intro, tracage du logo, son prestart inclus), comme un redemarrage de
// l'app, sans avoir a fermer/rouvrir Electron. Delegue a playIntro()
// (definie plus bas) qui pilote deja l'integralite de cette sequence, et
// remet a zero l'etat visuel des ecrans qu'on pourrait avoir traverse
// (barre de progression) pour que "depuis le debut" soit complet.
function replayFromStart() {
  const fill = document.querySelector('[data-role="progress-fill"]');
  const count = document.querySelector('[data-role="progress-count"]');
  const labelEl = document.querySelector('[data-role="progress-label"]');
  if (fill) fill.style.width = '0%';
  if (count) count.textContent = '0 / 0';
  if (labelEl) labelEl.textContent = 'Préparation…';

  playIntro();

  const btn = document.querySelector('.devReplayBtn');
  if (btn) {
    btn.classList.remove('isSpinning');
    void btn.offsetWidth;
    btn.classList.add('isSpinning');
  }
}

async function initInstallPath() {
  const defaultPath = await window.installerApi.getDefaultInstallPath();
  pathInput.value = defaultPath;
}

// Ecran d'intro (logo anime) affiche juste apres l'acceptation de l'UAC,
// en meme temps que le debut de prestart.mp3. L'ecran (et son animation de
// logo) ne dure que 6.5s puis on passe a "welcome" - le son, lui, continue
// de jouer independamment jusqu'a sa fin naturelle (~15.05s, echo de
// sortie deja present dans le fichier) sans etre coupe par le changement
// d'ecran : playSound() cree une instance audio autonome (voir plus haut).
const SCREEN_INTRO_DURATION_MS = 4500;

function playIntro() {
  showScreen('intro');
  playSound('prestart');
  setTimeout(() => showScreen('welcome'), SCREEN_INTRO_DURATION_MS);
}

// --- Selection "carte" (plan d'interface + choix Oui/Non) ---
// Un seul <button> actif a la fois par groupe (aria-pressed), comme un choix
// radio, mais sans case a cocher visible - le style vient de la carte
// elle-meme (voir .planCard/.choiceCard[aria-pressed] dans styles.css).
// Etat initial neutre : Pro presélectionné (juste milieu), le reste a "Non"
// tant que l'utilisateur n'a pas choisi explicitement "Oui".
const installSelection = {
  plan: 'pro',
  nonplanar: 'no',
  axis45: 'no',
  modeler: 'no',
};

function selectCard(groupEl, selectedBtn) {
  for (const btn of groupEl.querySelectorAll('[aria-pressed]')) {
    btn.setAttribute('aria-pressed', String(btn === selectedBtn));
  }
}

function initCardGroup(role, onSelect) {
  const group = document.querySelector(`[data-role="${role}"]`);
  if (!group) return;
  group.addEventListener('click', (event) => {
    const btn = event.target.closest('.planCard, .choiceCard');
    if (!btn || !group.contains(btn)) return;
    playSound('select');
    selectCard(group, btn);
    onSelect(btn.dataset.plan ?? btn.dataset.choice);
  });
  // Un <button disabled> n'emet JAMAIS de 'click' (le navigateur l'annule
  // avant), donc la tentative de clic sur une carte non-selectionnable
  // (ex : "4/5 axes" avant que le non-planaire soit installe) ne passerait
  // jamais par le handler ci-dessus. 'pointerdown', lui, se declenche meme
  // sur un element disabled : on s'en sert uniquement pour jouer le son de
  // refus ('refuse', distinct du son de survol reel de la croix 'hoverClose').
  group.addEventListener('pointerdown', (event) => {
    const btn = event.target.closest('.choiceCard:disabled, .planCard:disabled');
    if (!btn || !group.contains(btn)) return;
    playSound('refuse');
    // Assombrit/desature brievement le fond meshique en meme temps que ce
    // son "desagreable" (voir triggerRefuseFlash() dans mesh-background.js)
    // - retombe tout seul vers la normale, pas besoin de le "reactiver".
    if (window.__installerAudio) window.__installerAudio.triggerRefuseFlash();
  });
}

initCardGroup('plan-list', (value) => {
  installSelection.plan = value;
});

// Le choix "4/5 axes" depend strictement du non-planaire : tant que celui-ci
// n'est pas a "Oui", le sous-groupe reste visible mais grise/desactive et
// fige sur "Non" (l'utilisateur voit l'option exister sans pouvoir la
// cocher), avec un message expliquant le prerequis.
function syncAxisAvailability() {
  const axisGroup = document.querySelector('[data-role="axis-choice"]');
  const axisHint = document.querySelector('[data-role="axis-hint"]');
  const enabled = installSelection.nonplanar === 'yes';

  for (const btn of axisGroup.querySelectorAll('.choiceCard')) {
    btn.disabled = !enabled;
  }
  axisHint.hidden = enabled;

  if (!enabled) {
    installSelection.axis45 = 'no';
    for (const btn of axisGroup.querySelectorAll('[aria-pressed]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.choice === 'no'));
    }
  }
}

initCardGroup('nonplanar-choice', (value) => {
  installSelection.nonplanar = value;
  syncAxisAvailability();
});

initCardGroup('axis-choice', (value) => {
  installSelection.axis45 = value;
});

initCardGroup('modeler-choice', (value) => {
  installSelection.modeler = value;
});

// Preselectionne visuellement le plan par defaut (installSelection.plan) des
// le chargement, pour que l'ecran n'arrive jamais sans aucune carte active,
// et applique l'etat initial grise/fige du sous-groupe "4/5 axes" (deja pose
// en dur dans le HTML, mais recalcule ici pour n'avoir qu'une seule source
// de verite - evite tout desaccord si l'etat initial venait a changer).
document.addEventListener('DOMContentLoaded', () => {
  const defaultCard = document.querySelector(`.planCard[data-plan="${installSelection.plan}"]`);
  if (defaultCard) defaultCard.setAttribute('aria-pressed', 'true');
  syncAxisAvailability();
});

// --- Alerte critique (croix cliquee, tout ecran confondu) ---
// Son en boucle + glow des triangles reactif a SON niveau audio propre
// (analyseur dedie, distinct de celui - partage entre tous les sons UI - de
// mesh-background.js : impossible d'isoler un seul son depuis l'analyseur
// partage, donc plus simple et plus fiable d'avoir le sien ici) + lecture a
// voix haute via l'API Web Speech (moteur TTS local de l'OS, aucun service
// distant).
let criticalAudio = null;
let criticalAnalyser = null;
let criticalFreqData = null;
let criticalRafId = null;
let criticalPulseStart = 0;

// Triangles concernes par la pulsation d'opacite, ordonnes du centre vers
// les bords (le triangle central .alertTri-center n'en fait PAS partie : il
// reste fixe, seuls les 6 autres pulsent). Chaque paire gauche/droite a le
// meme rang (donc le meme dephasage), pour une sequence symetrique.
const CRITICAL_PULSE_RANKS = [
  ['.alertTri-left1', '.alertTri-right1'],
  ['.alertTri-left2', '.alertTri-right2'],
  ['.alertTri-left3', '.alertTri-right3'],
];

function startCriticalAlertLoop() {
  if (criticalAudio) return; // deja en cours
  criticalAudio = new Audio('./sounds/critical-alert.mp3');
  criticalAudio.loop = true;
  // Volume nettement reduit par rapport aux autres sons UI (1.0) : en
  // boucle et pendant potentiellement plusieurs secondes/minutes, meme
  // 0.45 restait trop present derriere le TTS.
  criticalAudio.volume = 0.22;

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextCtor();
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createMediaElementSource(criticalAudio);
    criticalAnalyser = ctx.createAnalyser();
    criticalAnalyser.fftSize = 256;
    criticalAnalyser.smoothingTimeConstant = 0.6;
    source.connect(criticalAnalyser);
    criticalAnalyser.connect(ctx.destination);
    criticalFreqData = new Uint8Array(criticalAnalyser.frequencyBinCount);
  } catch {
    // Best-effort : la pulsation retombe sur un rythme base sur le temps
    // seul (voir updateCriticalAlertPulse) si l'analyse audio echoue - la
    // lecture du son lui-meme n'en depend pas.
  }

  criticalAudio.play().catch(() => {});
  criticalPulseStart = performance.now();
  // Attend la fin de l'animation CSS d'eclatement (alertTriExpand*, la plus
  // longue commence a 0.24s + dure 0.55s) avant de prendre la main sur
  // l'opacite en JS : cette animation pilote deja `opacity` (de 0 a
  // --final-opacity) pendant sa duree, en `forwards` - un style inline pose
  // plus tot serait immediatement ecrase par elle tant qu'elle tourne.
  setTimeout(updateCriticalAlertPulse, 850);
}

function stopCriticalAlertLoop() {
  if (criticalAudio) {
    criticalAudio.pause();
    criticalAudio.currentTime = 0;
    criticalAudio = null;
  }
  if (criticalRafId) {
    cancelAnimationFrame(criticalRafId);
    criticalRafId = null;
  }
  criticalAnalyser = null;
  criticalFreqData = null;
  // Remet chaque triangle a son opacite de repos (--final-opacity, posee en
  // CSS) plutot que de laisser une valeur inline figee sur le dernier
  // niveau calcule avant l'arret.
  for (const ranks of CRITICAL_PULSE_RANKS) {
    for (const selector of ranks) {
      const el = document.querySelector(selector);
      if (el) el.style.opacity = '';
    }
  }
}

function getCriticalAudioLevel() {
  if (!criticalAnalyser || !criticalFreqData) return null;
  criticalAnalyser.getByteFrequencyData(criticalFreqData);
  let sum = 0;
  for (let i = 0; i < criticalFreqData.length; i++) sum += criticalFreqData[i];
  return sum / criticalFreqData.length / 255;
}

// Fait pulser l'opacite des triangles PAR RANG (les deux plus proches du
// centre d'abord, puis les suivants, puis les plus exterieurs), au rythme
// du son : un dephasage croissant (RANK_DELAY_S) sur la meme onde de niveau
// audio cree une vague qui semble partir du centre et se propager vers les
// bords, plutot qu'une pulsation uniforme sur tous les triangles a la fois.
// Le triangle central (.alertTri-center) n'est jamais touche ici.
const RANK_DELAY_S = 0.12;

function updateCriticalAlertPulse() {
  if (!criticalAudio) return;

  const t = (performance.now() - criticalPulseStart) / 1000;
  const level = getCriticalAudioLevel();

  CRITICAL_PULSE_RANKS.forEach((selectors, rankIndex) => {
    const phase = t - rankIndex * RANK_DELAY_S;
    // Rythme base sur le son quand l'analyse est disponible (le niveau
    // audio module directement l'amplitude de l'oscillation), sinon un
    // sinus regulier en secours pour ne jamais rester totalement statique.
    const wave = level === null
      ? (Math.sin(phase * 5) + 1) / 2
      : Math.max(0, Math.sin(phase * 5)) * Math.min(1, level * 2.2);
    const opacity = 0.15 + wave * 0.7;

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) el.style.opacity = opacity.toFixed(2);
    }
  });

  criticalRafId = requestAnimationFrame(updateCriticalAlertPulse);
}

// Message d'alerte pre-enregistre AVEC echo (close-warning-tts-echo.mp3) -
// remplace la lecture live via speechSynthesis : Chromium ne route pas le
// TTS systeme a travers le graphe Web Audio, impossible d'y appliquer un
// vrai effet d'echo en direct, d'ou ce fichier pre-rendu.
let criticalTtsAudio = null;

function speakCriticalAlert() {
  criticalTtsAudio = new Audio('./sounds/close-warning-tts-echo.mp3');
  criticalTtsAudio.volume = 1;
  criticalTtsAudio.play().catch(() => {});
}

function stopCriticalAlertTts() {
  if (criticalTtsAudio) {
    criticalTtsAudio.pause();
    criticalTtsAudio.currentTime = 0;
    criticalTtsAudio = null;
  }
}

function showCloseConfirm() {
  document.querySelector('[data-role="close-confirm"]').hidden = false;
  startCriticalAlertLoop();
  speakCriticalAlert();
}

function hideCloseConfirm() {
  document.querySelector('[data-role="close-confirm"]').hidden = true;
  stopCriticalAlertLoop();
  stopCriticalAlertTts();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  playSound('click');
  const action = target.dataset.action;

  switch (action) {
    case 'choose-directory': {
      const chosen = await window.installerApi.chooseDirectory(pathInput.value);
      if (chosen) pathInput.value = chosen;
      break;
    }
    case 'go-welcome':
      showScreen('welcome');
      break;
    case 'go-options':
      showScreen('options');
      break;
    case 'go-plan':
      showScreen('plan');
      break;
    case 'go-nonplanar':
      showScreen('nonplanar');
      break;
    case 'go-modeler':
      showScreen('modeler');
      break;
    case 'go-install': {
      showScreen('progress');
      const options = {
        installPath: pathInput.value,
        createDesktopShortcut: document.getElementById('opt-desktop').checked,
        createStartMenuShortcut: document.getElementById('opt-start-menu').checked,
        uiPlan: installSelection.plan,
        installNonPlanar: installSelection.nonplanar === 'yes',
        installAxis45: installSelection.axis45 === 'yes',
        installModeler: installSelection.modeler === 'yes',
      };
      const result = await window.installerApi.runInstall(options);
      if (!result || !result.success) {
        // Echec : retour arriere deja fait cote main ; on revient au choix du dossier avec le message d'erreur.
        window.alert(`L'installation a echoue.

${(result && result.error) || 'Erreur inconnue.'}`);
        showScreen('welcome');
        break;
      }
      showScreen('done');
      break;
    }
    case 'finish': {
      const launchNow = document.getElementById('opt-launch-now').checked;
      if (launchNow) {
        await window.installerApi.launchApp();
      } else {
        await window.installerApi.quit();
      }
      break;
    }
    case 'quit':
      // Sur TOUT ecran, la croix de fermeture ne quitte jamais directement :
      // l'utilisateur a pu cliquer dessus par erreur, donc on demande
      // toujours confirmation (alerte critique - triangles + son en boucle
      // + lecture vocale) plutot que de fermer sans avertissement.
      showCloseConfirm();
      break;
    case 'close-confirm-stay':
      hideCloseConfirm();
      playSound('cancelAbort');
      break;
    case 'close-confirm-quit':
      hideCloseConfirm();
      await window.installerApi.quit();
      break;
    case 'dev-replay':
      replayFromStart();
      break;
    default:
      break;
  }
});

// DEV UNIQUEMENT : touche R = reprendre la fenetre depuis le debut.
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    replayFromStart();
  }
});

// Son de survol sur tout element interactif (boutons, champ, lignes
// d'options). Delegue sur 'mouseover' (qui bubble, contrairement a
// mouseenter) + closest() pour n'attacher qu'un seul listener global plutot
// qu'un par element, y compris pour les boutons ajoutes/retires plus tard.
// .closeBtn a son propre son (hoverClose) et est donc exclu du hover
// generique, sinon les deux sons se declencheraient ensemble sur lui.
const HOVER_TARGET_SELECTOR = 'button, .optionRow, .pathInput';
let lastHoverTarget = null;

document.addEventListener('mouseover', (event) => {
  const target = event.target.closest(HOVER_TARGET_SELECTOR);
  if (!target || target === lastHoverTarget) return;
  lastHoverTarget = target;
  playSound(target.classList.contains('closeBtn') ? 'hoverClose' : 'hover');
});

document.addEventListener('mouseout', (event) => {
  const target = event.target.closest(HOVER_TARGET_SELECTOR);
  if (target !== lastHoverTarget) return;
  // Si la souris se deplace vers un autre enfant du MEME target (ex : du
  // span .optionCheck vers le span .optionText a l'interieur d'un seul
  // <label class="optionRow">), on n'a pas reellement quitte l'element -
  // ne pas reinitialiser, sinon le mouseover suivant (toujours sur ce
  // meme target) le reprend pour neuf et rejoue le son en double.
  const related = event.relatedTarget;
  if (related && target.contains(related)) return;
  lastHoverTarget = null;
});

window.installerApi.onProgress(({ index, total, label, percent: exactPercent }) => {
  const fill = document.querySelector('[data-role="progress-fill"]');
  const count = document.querySelector('[data-role="progress-count"]');
  const labelEl = document.querySelector('[data-role="progress-label"]');

  const percent = typeof exactPercent === 'number' ? exactPercent : Math.round(((index + 1) / total) * 100);
  fill.style.width = `${percent}%`;
  count.textContent = `${index + 1} / ${total}`;
  labelEl.textContent = label;
});

// Le main process cache la fenetre puis demande ici si les sons en cours
// sont termines (voir electron/main.cjs, handleCloseRequest). On repond
// immediatement s'il n'y en a aucun ; sinon on attend que le dernier
// termine (event 'ended'/'error' sur chaque Audio, voir playSound) avant
// de donner le feu vert a la fermeture reelle du process.
window.installerApi.onRequestClose(() => {
  window.installerApi.debugLog(`onRequestClose recu, activeSounds.size=${activeSounds.size}`);
  if (activeSounds.size === 0) {
    window.installerApi.debugLog('aucun son actif -> notifySoundsIdle immediat');
    window.installerApi.notifySoundsIdle();
    return;
  }
  let remaining = activeSounds.size;
  for (const audio of activeSounds) {
    // Verification defensive : si ce son s'est deja termine entre temps
    // (audio.ended true) mais n'a pas encore ete retire de activeSounds
    // (improbable vu stopTracking dans playSound, mais coute rien a
    // verifier), on ne doit pas attendre un evenement 'ended' qui ne se
    // redeclenchera jamais.
    if (audio.ended || audio.error) {
      remaining -= 1;
      continue;
    }
    const onSettled = (eventName) => {
      window.installerApi.debugLog(`son termine (${eventName}), src=${audio.currentSrc}`);
      remaining -= 1;
      if (remaining <= 0) {
        window.installerApi.debugLog('tous les sons termines -> notifySoundsIdle');
        window.installerApi.notifySoundsIdle();
      }
    };
    audio.addEventListener('ended', () => onSettled('ended'), { once: true });
    audio.addEventListener('error', () => onSettled('error'), { once: true });
  }
  if (remaining <= 0) {
    window.installerApi.debugLog('tous deja termines (verif defensive) -> notifySoundsIdle');
    window.installerApi.notifySoundsIdle();
  }
});

initInstallPath();
// L'intro (musique prestart, trace du logo) ne demarre qu'APRES la disparition du logo de chargement : le main envoie
// `installer:start` une fois la fenetre revelee (voir electron/main.cjs).
window.installerApi.onStart(() => playIntro());
window.installerApi.rendererReady();

// Glisser la fenetre depuis toute zone sans element interactif (voir main.cjs, installer:drag-start). Le drag natif
// (-webkit-app-region) reste limite a .dragHandle : sur toute la surface il tue hover et clic (limite #13).
(function initWindowDrag() {
  const INTERACTIVE = 'button, input, select, textarea, a, label, [data-action], [role="button"], .planCard, .modeCard, .dragHandle';
  let dragging = false;
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest(INTERACTIVE)) return;
    dragging = true;
    document.documentElement.setPointerCapture?.(event.pointerId);
    window.installerApi.dragStart();
  });
  document.addEventListener('pointermove', () => {
    if (dragging) window.installerApi.dragMove();
  });
  const stop = () => { dragging = false; };
  document.addEventListener('pointerup', stop);
  document.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
})();
