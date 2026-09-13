// Fond degrade "meshique" reactif au son, rendu via le shader WebGL
// meshGradient de @paper-design/shaders (lib vanilla JS, zero dependance,
// voir node_modules/@paper-design/shaders) plutot qu'un rendu canvas 2D
// fait main : rendu plus riche (distorsion organique + vortex geres par le
// shader lui-meme) et anti-aliasing WebGL natif. Charge en <script
// type="module"> depuis index.html, apres renderer.js.
//
// Meme contrat que la version precedente : expose window.__installerAudio
// .hook(audioEl) pour que renderer.js branche chaque son joue (prestart,
// hover, click...) sur un AnalyserNode partage, dont les niveaux de
// frequence pilotent les uniforms du shader (u_distortion, u_swirl) en
// direct via mount.setUniforms().

import { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } from '../node_modules/@paper-design/shaders/dist/index.js';

const container = document.getElementById('meshBackground');
if (container) {
  // --- Analyse audio partagee (identique a la version canvas precedente) ---
  let audioCtx = null;
  let analyser = null;
  let freqData = null;

  function ensureAudioGraph() {
    if (audioCtx) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    audioCtx = new AudioContextCtor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  // Niveau du "flash de refus" (0 = normal, 1 = pleinement assombri/grise) :
  // saute a 1 des que triggerRefuseFlash() est appele (voir renderer.js, sur
  // le son 'refuse' - clic sur une option non-selectionnable), puis
  // redescend en douceur vers 0 a chaque frame (voir updateFromAudio plus
  // bas). Pilote l'interpolation de u_colors vers du gris dans getFrameColors().
  let refuseFlashLevel = 0;

  window.__installerAudio = {
    hook(audioEl) {
      try {
        ensureAudioGraph();
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const source = audioCtx.createMediaElementSource(audioEl);
        source.connect(analyser);
      } catch {
        // Best-effort : voir version precedente pour le detail des cas
        // ou ceci peut echouer sans casser la lecture du son lui-meme.
      }
    },
    // Declenche l'assombrissement/desaturation temporaire du mesh (voir
    // renderer.js : appele en meme temps que le son de refus 'refuse').
    triggerRefuseFlash() {
      refuseFlashLevel = 1;
    },
  };

  // Rattrape les sons deja demarres par renderer.js avant que ce module
  // (charge en type="module", donc toujours differe) ait fini de
  // s'executer - typiquement le son prestart.mp3 joue des le chargement,
  // qui sinon n'aurait jamais ete branche a l'analyseur audio.
  const pending = window.__installerAudioPendingHooks || [];
  for (const audioEl of pending) window.__installerAudio.hook(audioEl);
  pending.length = 0;

  let restPhase = 0;
  // Lissage : level "affiche" suit le niveau brut avec une inertie (monte
  // vite, redescend un peu plus lentement) pour un mesh qui reagit nettement
  // a chaque son sans non plus flasher/trembler frame a frame sur du bruit
  // haute-frequence pur.
  let smoothedLevel = 0;

  function getAudioLevel() {
    let raw;
    if (!analyser || !freqData) {
      restPhase += 0.008;
      raw = 0.15 + ((Math.sin(restPhase) + 1) / 2) * 0.1;
    } else {
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < freqData.length; i++) sum += freqData[i];
      const avg = sum / freqData.length / 255;
      // Gain releve (2.5 -> 3.6) : le mesh doit reagir nettement plus
      // fortement aux sons UI (hover/click/selection...), pas seulement a
      // une musique de fond continue.
      raw = Math.min(1, avg * 3.6);
    }
    const attack = raw > smoothedLevel ? 0.55 : 0.12;
    smoothedLevel += (raw - smoothedLevel) * attack;
    return smoothedLevel;
  }

  // --- Montage du shader ---
  // Palette cyan coherente avec le reste de l'UI, mais plafonnee plus bas
  // en luminosite que la teinte d'accent pure (#00f0ff) : celle-ci en
  // pleine saturation dans le mesh rendait certaines zones presque
  // blanches, ecrasant le contraste avec le texte pale (.brandSubtitle,
  // .screenLead...) pose par-dessus. #1fb8c9/#17939f sont des variantes
  // assombries de la meme teinte, gardant l'identite visuelle sans jamais
  // approcher le blanc.
  const colors = [
    getShaderColorFromString('#0a2540'),
    getShaderColorFromString('#1fb8c9'),
    getShaderColorFromString('#0d6b7a'),
    getShaderColorFromString('#003d4d'),
  ];

  // Gris neutre assombri, cible du "flash de refus" (voir triggerRefuseFlash
  // ci-dessus) : chaque couleur de la palette normale est interpolee vers ce
  // gris (mix, pas remplacement brutal) pour assombrir ET desaturer d'un
  // seul geste, puis revenir progressivement a sa teinte d'origine.
  const REFUSE_GRAY = [0.08, 0.08, 0.09, 1];

  function mixColor(base, target, amount) {
    return [
      base[0] + (target[0] - base[0]) * amount,
      base[1] + (target[1] - base[1]) * amount,
      base[2] + (target[2] - base[2]) * amount,
      base[3],
    ];
  }

  // speed doit etre explicite et non-nul : ShaderMount vaut speed=0 par
  // defaut (shaders statiques), ce qui arrete completement sa boucle de
  // rendu interne - sans ca, ni l'animation continue du mesh ni les
  // mises a jour d'uniforms (setUniforms plus bas, pilotees par le son)
  // n'ont d'effet visible puisque rien ne se redessine.
  const mount = new ShaderMount(
    container,
    meshGradientFragmentShader,
    {
      u_colors: colors,
      u_colorsCount: colors.length,
      u_distortion: 0.35,
      u_swirl: 0.25,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_scale: 1,
    },
    undefined,
    0.5,
  );

  // Boucle qui remonte les niveaux audio vers les uniforms du shader : la
  // musique/les sons UI modulent la distorsion organique (u_distortion) et
  // le vortex (u_swirl), donc la FORME du mesh change avec le son, pas
  // seulement une teinte ou une taille. Le niveau audio module aussi
  // desormais l'intensite de cette distorsion de facon plus marquee (voir
  // les plages elargies ci-dessous), et refuseFlashLevel (quand > 0)
  // assombrit/desature u_colors en plus, independamment du son en cours.
  function updateFromAudio() {
    const level = getAudioLevel();
    mount.setUniforms({
      u_distortion: 0.2 + level * 0.85,
      u_swirl: 0.1 + level * 0.6,
      u_colors: refuseFlashLevel > 0.002
        ? colors.map((c) => mixColor(c, REFUSE_GRAY, refuseFlashLevel))
        : colors,
    });
    // Retombee exponentielle : rapide au debut, de plus en plus lente en
    // s'approchant de 0 - donne un effet "flash puis retour en douceur"
    // plutot qu'une coupure nette ou une decroissance lineaire mecanique.
    if (refuseFlashLevel > 0.002) refuseFlashLevel *= 0.93;
    else if (refuseFlashLevel !== 0) refuseFlashLevel = 0;
    requestAnimationFrame(updateFromAudio);
  }
  requestAnimationFrame(updateFromAudio);
}
