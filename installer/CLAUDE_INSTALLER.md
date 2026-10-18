# Apex Slicer — Installateur — Contexte projet — FICHIER MODIFIABLE PAR L'IA

Installateur graphique (Electron) du logiciel Apex Slicer. **Mini-application
autonome**, séparée de l'UI du slicer : son propre `package.json`, ses
propres dépendances, son propre build. Ce fichier centralise le contexte
nécessaire pour reprendre le développement sans redemander les décisions
déjà actées. L'IA peut et doit modifier ce fichier lorsqu'elle opère.

---

## COMMENT LIRE CE FICHIER (à lire AVANT le reste)

Ce document décrit ce qui **est**, pas ce qui doit rester. Presque chaque
décision ci-dessous a été prise en réaction à un symptôme observé à
l'écran, souvent après plusieurs essais infructueux : ce sont des constats
de terrain, pas une architecture pensée d'avance.

**Les limites numérotées sont la partie la plus utile.** Plusieurs
documentent des pièges qui ont coûté des heures et qui se re-tendront à
l'identique (Electron dégradé en Node, `app.getPath()` appelé trop tôt,
cible portable + UAC, `node_modules` vidé par le workspace parent). Les
relire avant de débugger un symptôme de démarrage évite de refaire le même
parcours.

### Ce que ce fichier ne dit pas

- **L'installation elle-même n'existe pas.** `installer:run-install` est une
  simulation (limite #1). Tout le travail à ce jour porte sur le parcours,
  l'habillage et le son.
- Les choix esthétiques (sons, animations, gag FitGirl) viennent de demandes
  explicites de l'utilisateur en session, pas d'une intention produit
  documentée ailleurs. Ils se changent sans cérémonie.

---

## Objectif

Donner à Apex Slicer un installateur au design entièrement maison, très
travaillé visuellement et sonorement, plutôt qu'un installateur système
générique (NSIS/Inno) :

- **identité visuelle continue** avec le slicer (glassmorphism sombre,
  accent cyan `#00f0ff`, Orbitron pour les titres / Inter pour le corps) ;
- **retour sonore systématique** (survol, clic, sélection, refus, démarrage,
  fin) ;
- **fenêtre qui s'adapte au contenu** plutôt qu'un contenu qui défile ;
- **écrans de sélection en cartes**, pas des arborescences de cases à cocher.

---

## Emplacement et voisinage

```
R:\APEX_NEW_VERSION\
├── slicer_engine\        # moteur de slicing Python (son propre CLAUDE.md)
└── slicer_ux\            # DÉPÔT GIT — UI du slicer (React/Vite/Tailwind)
    ├── src\, public\, package.json, vite.config.ts…
    ├── electron\main.cjs # packaging Electron DU SLICER (à ne pas confondre)
    └── installer\        # ← CE PROJET
```

`slicer_ux` et `installer` ont chacun leur `package.json` et leur
`electron/main.cjs` : deux fichiers homonymes pour deux applications
différentes. Des copier-coller malheureux ont déjà fusionné les deux
projets dans un même dossier et écrasé le `package.json` de l'installateur
par celui du slicer (`vite_react_shadcn_ts`). **Vérifier le champ `name`
avant de toucher à un `package.json` ici.**

---

## Arborescence

```
installer/
├── package.json              # "apex-slicer-installer" — build electron-builder (portable)
├── run-electron.cjs          # lance Electron en purgeant ELECTRON_RUN_AS_NODE (limite #2)
├── electron/
│   ├── main.cjs              # ~740 l. — process principal : fenêtres, UAC, IPC, resize animé
│   ├── preload.cjs           # API installerApi
│   ├── preflight.html        # fenêtre "Setup" imitant un installeur Inno (gag, limite #8)
│   ├── preflight-preload.cjs # API preflightApi + gagApi
│   ├── gag.html              # 4 répliques en fondu, habillage du VRAI installateur
│   ├── option-window.html    # UNE mini-fenêtre flottante = UNE case à cocher (limite #7)
│   ├── option-preload.cjs    # API optionApi (toggle + hover)
│   ├── icon-256.png          # icône du build, générée depuis res/logo.svg (limite #5)
│   ├── icon.svg, fitgirl.jpg, fgr_music_theme.mp3, mini-logo.png
├── scripts/render-icon.cjs   # rend logo.svg en PNG 256×256 via Electron offscreen (limite #5)
├── res/                      # sources d'origine (logo, assets du gag)
└── src/
    ├── index.html            # ~457 l. — TOUS les écrans dans un seul document
    ├── renderer.js           # ~950 l. — sons, navigation, sélections, mesures, alerte critique
    ├── styles.css            # ~1275 l. — habillage complet
    ├── mesh-background.js    # fond WebGL réactif au son (@paper-design/shaders)
    └── sounds/               # 14 fichiers
```

`release/` et `release2/` sont des artefacts de build, jamais à versionner.
`main.cjs.old-backup` (racine) est une ancienne version de 511 lignes
conservée par prudence — le fichier vivant est `electron/main.cjs`.

---

## Commandes

```bash
cd installer
pnpm install --ignore-workspace   # OBLIGATOIRE : voir limite #15
pnpm dev                          # lance l'app (déclenche l'UAC, limite #3)
pnpm build                        # -> release/apex-installer.exe (~106 Mo, portable)
```

**Aucun test automatisé, aucun linter** sur ce sous-projet. La vérification
se fait à l'œil et à l'oreille, écran par écran ; `node --check` sur les
fichiers modifiés est le seul garde-fou systématique.

---

## Parcours utilisateur

```
intro → mode ─┬─ (rapide) ──────────────────────────────→ progress → done
              └─ (standard) → path → aelox → plan → shortcuts → progress → done
```

**L'ordre `path` avant `aelox` est délibéré** (demande explicite de
l'utilisateur, inversant l'ordre initial) : on demande le dossier avant de
savoir si le matériel Aelox restreint les plans disponibles.

| Écran | Rôle | Particularités |
|---|---|---|
| `intro` | Logo animé + musique | Tracé SVG du logo en grand, puis bascule sur le petit ; texte "Aelox Hardware / Chargement" puis "Apex Slicer / Assistant d'installation". Dure 6,5 s (`SCREEN_INTRO_DURATION_MS`), indépendamment de la longueur du son. |
| `mode` | Standard vs Rapide | **Rapide n'affiche aucun autre écran** : installe tout sauf le modèle de langage local, chemin et raccourcis par défaut. |
| `path` | Dossier d'installation | `dialog.showOpenDialog` côté main. |
| `aelox` | « Propriétaire d'une imprimante Aelox Hardware ? » | Répondre **Oui grise Eco et Basic**. Suivant **inactif tant qu'aucune réponse** (`data-requires`, limite #10). |
| `plan` | Eco / Basic / Pro / Ultimate | Options en **mini-fenêtres OS flottantes** (limite #7). Ultimate coche tout par défaut. Fenêtre élargie à 940 px (limite #6). Eco/Basic grisés par `aelox=Oui` **reculent** au survol au lieu de se surligner (limite #16), et un clic dessus joue un son dédié à instance unique (voir Sons). |
| `shortcuts` | Bureau / Menu Démarrer / Barre des tâches | Libellés **adaptés à l'OS** via `installerApi.platform` (Dock sous macOS, pas de menu Démarrer hors Windows). |
| `progress` | Barre de progression | **Simulation** (limite #1). |
| `done` | Fin + « Lancer maintenant » | La croix y déclenche l'alerte critique (limite #9). |

### Plans et options

| Plan | Contenu | OPTION (cases à cocher) |
|---|---|---|
| Eco | Slicer 3 axes, prévisualiseur basique | aucune |
| Basic | + prévisualiseur multicolore, fonctions d'impression | synthèse vocale ; impression non-planaire |
| Pro | Slicer 3/4/5 axes non-planaire, blob printing, orientation manuelle | auto-orientation ; reconnaissance vocale |
| Ultimate | Tout le slicer | auto-orientation ; collisions ; GPU ; Nvidia ; édition de couches ; assistant LLM local ; modélisateur |

Les `<input type="checkbox">` restent dans le DOM de `index.html` et
demeurent **la source de vérité** lue par `buildInstallOptions()` ; les
mini-fenêtres n'en sont qu'une présentation. Changer de plan décoche les
options des autres plans.

---

## Sons

Registre `SOUND_FILES` (`src/renderer.js`). Chaque lecture crée une
**nouvelle instance `Audio`** : deux sons qui se chevauchent ne se coupent
jamais.

| Clé | Fichier | Déclencheur |
|---|---|---|
| `prestart` | `prestart.mp3` | Démarrage (volume 0.8) |
| `introExtra` | `intro-extra.mp3` | Démarrage, **simultané** (volume 0.95) |
| `hover` | `hover.mp3` | Survol de tout élément interactif |
| `hoverClose` | `hover-close-real.mp3` | Survol de la croix **uniquement** |
| `refuse` | `hover-close.mp3` | Clic sur un élément désactivé |
| `click` | `click.mp3` | Clic sur tout `[data-action]` |
| `select` | `select.mp3` | Sélection d'une carte |
| `checkbox` | `checkbox.mp3` | Coche/décoche |
| `cancelAbort` | `cancel-abort.mp3` | « Continuer l'installation » (alerte critique) |
| `installDone` | `install-done.mp3` | Arrivée sur l'écran final |

Hors registre, chacun avec sa propre logique de lecture (pas de simple
`playSound()`) :
- `critical-alert.mp3` — boucle, volume 0.22 (alerte critique, limite #9).
- `close-warning-tts-echo.mp3` — TTS pré-enregistré (alerte critique).
- `plan-forbidden.mp3` — clic sur un plan Eco/Basic grisé par `aelox=Oui`.
  **Seul son du projet en instance UNIQUE et partagée** (`planForbiddenAudio`,
  déclaré hors de `playSound()`) : un nouveau clic pendant la lecture
  l'arrête et la redémarre de zéro (`pause()` + `currentTime = 0`), au lieu
  de superposer une seconde instance comme tous les autres sons. Ne pas le
  faire passer par `playSound()`/`SOUND_FILES`, qui créerait une nouvelle
  instance à chaque appel et perdrait ce comportement.

`startup.mp3` n'est plus utilisé.

**`hoverClose` et `refuse` sont deux fichiers distincts** : ils ont partagé
le même fichier, et renommer l'un a écrasé l'autre (perdu, redéposé par
l'utilisateur). Ne jamais les refusionner.

---

## Contrat IPC

`preload.cjs` expose `window.installerApi` :

| Canal | Sens | Rôle |
|---|---|---|
| `installer:choose-directory` | R→M | Sélecteur de dossier |
| `installer:default-install-path` | R→M | Chemin par défaut |
| `installer:run-install` | R→M | Lance l'installation (**simulée**) |
| `installer:progress` | M→R | Avancement |
| `installer:launch-app` / `:quit` | R→M | Sortie |
| `installer:resize-window` | R→M | Redimensionnement **animé** `{width, height}` |
| `installer:set-window-width` | R→M | Largeur **immédiate**, avant mesure (limite #6) |
| `installer:show-options` / `:hide-options` | R→M | Crée/détruit les mini-fenêtres |
| `installer:option-changed` / `:option-hover` | M→R | Retour des mini-fenêtres |
| `installer:request-close` / `:sounds-idle` | M↔R | Fermeture propre (limite #4) |
| `installer:debug-log` | R→M | Journal de debug |

`platform` (`'win32' | 'darwin' | 'linux'`) est exposé comme **valeur**.

---

## Décisions techniques actées et limites connues

### 1. L'installation n'installe rien
`installer:run-install` boucle sur `INSTALL_STEPS` (5 libellés, 600 ms
chacun) et renvoie `{success: true}`. Les options collectées
(`buildInstallOptions()` : `mode`, `plan`, `shortcuts`, `options{}`) sont
transmises mais **jamais lues**. Copie de fichiers, raccourcis,
enregistrement du programme et désinstalleur restent à écrire.

### 2. `ELECTRON_RUN_AS_NODE` dégrade Electron en Node.js — piège majeur
Quand cette variable est présente, `electron.exe` s'exécute comme un
**interpréteur Node** : `require('electron')` échoue, aucune fenêtre ne
s'ouvre, le process **sort en code 0 sans le moindre message**. Symptôme :
« ça mouline puis ça meurt ».

`run-electron.cjs` la purge (c'est sa seule raison d'être), mais **tout
lancement direct d'un exe depuis un terminal qui la porte reproduira le
bug** — y compris les exe packagés. Diagnostic : `echo
$ELECTRON_RUN_AS_NODE`. Une session entière a été perdue à conclure que
l'app était cassée alors que seul le terminal l'était.

### 3. Élévation UAC : demandée par l'app, pas par le manifeste
Le manifeste est `asInvoker`. C'est `main.cjs` qui teste `net session` puis
relance l'app élevée via PowerShell `Start-Process -Verb RunAs`.

**Pourquoi pas `requireAdministrator` :** avec la cible `portable`, le stub
d'auto-extraction échoue silencieusement sous ce manifeste — rien ne
s'extrait, aucun code n'est exécuté.

**En portable, relancer `PORTABLE_EXECUTABLE_FILE`, jamais
`process.execPath`** : ce dernier pointe vers la copie extraite dans
`%TEMP%`, effacée à la fermeture. `-WorkingDirectory` calculé depuis
`__dirname` échoue aussi en packagé (chemin dans `app.asar`).

### 4. Fermeture différée par les sons
`requestGracefulQuit()` masque la fenêtre puis attend que le renderer
confirme que les sons UI courts sont finis avant `app.quit()` — filet à
20 s. `prestart` est **exclu** (15 s de musique bloquaient la fermeture,
perçu comme un plantage). Le son d'alerte critique, en boucle, ne doit
jamais entrer dans `activeSounds`.

### 5. L'icône de l'exe exige 256×256 minimum
`mini-logo.png` fait 25×21 px : `electron-builder` refuse le build.
`scripts/render-icon.cjs` rend `res/logo.svg` en PNG 256×256 **via une
fenêtre Electron offscreen** — aucun convertisseur SVG (ImageMagick,
rsvg-convert, sharp) n'est disponible sur cette machine.

`executableName` ne nomme que le binaire **interne** ; le fichier portable
distribué suit `artifactName` (`apex-installer.${ext}`).

### 6. La fenêtre s'adapte au contenu
`measureAndResize()` somme les enfants de l'écran actif + padding + gaps,
puis le main **interpole sur ~320 ms** (easeOutCubic) en recentrant.

- **La largeur est appliquée AVANT la mesure** (canal séparé, sans
  animation) : plus large, le texte revient moins à la ligne, donc la
  hauteur change. Mesurer d'abord donnerait la hauteur de l'ancienne largeur.
- **Le `.screenFooter` est exclu de la mesure** : il est en
  `position: absolute` (#10), sa place est réservée par le `padding-bottom`.
- **`overflow: visible` + `flex-shrink: 0`** sur les écrans et leurs
  enfants, sinon flexbox comprime le contenu et la mesure sous-estime.

Largeurs : 640 px, **940 px sur `plan`**. Hauteur plancher : 520 px.

### 7. Les options sont de vraies fenêtres OS
Chaque OPTION est une `BrowserWindow` (`frame:false`, `transparent`,
`focusable:false`, `parent: mainWindow`), empilée le long du bord **droit**.
Elles glissent en cascade (70 ms d'écart), suivent la fenêtre principale
(`move`/`resize`), et sont détruites en quittant `plan`.

Le **dégradé est partagé** : chaque fenêtre peint la même image, décalée de
sa position dans la pile (`--slice-y`) et dimensionnée sur la hauteur totale
(`--slice-total`), pour composer un dégradé continu.

Le survol est relayé à la fenêtre principale (`option:hover`), seule à
porter le registre de sons.

**`pushOptionWindows()` ne fait rien hors de l'écran `plan`** :
`syncPlanOptions()` est aussi appelé depuis `aelox`, ce qui faisait
apparaître les options à côté du mauvais écran.

### 8. Décor « FitGirl » — `const fitgirl = false`
Interrupteur en tête de `main.cjs` : décor gag complet avant l'UAC (fenêtre
imitant un installeur de repack, puis après 9 s d'inaction quatre répliques
en fondu — « non, je rigole » → « je t'ai eu » → « signé : le développeur »
→ « Ouverture de la boîte d'élévation des droits. »). À `false`, tout est
court-circuité.

### 9. Alerte critique sur la croix
Cliquer la croix, **sur n'importe quel écran**, ne ferme jamais
directement : 7 triangles rouges éclatent depuis le centre, un message TTS
pré-enregistré est joué, une boucle sonore tourne à faible volume.

- L'opacité des 6 triangles latéraux est pilotée **en JS**, pas en CSS : une
  animation CSS `forwards` garde la main sur `opacity` en permanence. La
  pulsation ne démarre qu'**après** l'éclatement (850 ms).
- Une **custom property CSS ne s'interpole pas** en `@keyframes` sans
  `@property` : `translate(var(--tx))` produisait un saut sec. D'où une
  `@keyframes` dédiée par position, valeurs en dur.
- L'écho du TTS est un **fichier pré-enregistré** : `speechSynthesis` ne
  passe pas par le graphe Web Audio de Chromium.

### 10. Boutons de navigation : jamais centrés, parfois inactifs
`.screenFooter` est en `position: absolute` ancré aux coins inférieurs —
sorti du flux exprès, car le contenu est centré verticalement et le footer
suivait ce centrage.

Un bouton `data-requires` est désactivé tant que sa condition
(`GATE_CONDITIONS`) n'est pas remplie. Comme **un `<button disabled>`
n'émet jamais de `click`**, le son de refus part sur `pointerdown`.

### 11. `hidden` vs `display:flex`
Une classe qui pose `display: flex` **bat l'attribut `[hidden]`** (même
spécificité, règle plus tardive) : l'overlay s'affichait en permanence.
Toujours ajouter `.maClasse[hidden] { display: none; }`.

### 12. Fond meshique réactif au son
`mesh-background.js` monte un shader `meshGradient`
(`@paper-design/shaders`) et module `u_distortion`/`u_swirl` via un
`AnalyserNode` partagé.

- **`speed` vaut 0 par défaut** dans `ShaderMount` : sans valeur explicite
  non nulle, rien ne s'anime *et* les `setUniforms` n'ont aucun effet, rien
  ne se redessinant.
- Chargé en `type="module"`, donc **toujours différé** : le son de démarrage
  joue avant que `window.__installerAudio` existe. D'où la file
  `__installerAudioPendingHooks`, vidée à l'init.
- `triggerRefuseFlash()` assombrit/désature brièvement la palette lors d'un
  refus. Le shader n'expose **aucun uniform de luminosité** : passer par
  `u_colors`.
- L'import est un **chemin relatif en dur**
  (`../node_modules/@paper-design/shaders/dist/index.js`) : il casse si le
  paquet n'est pas installé dans `installer/node_modules` (voir #15).

### 13. Zone de drag limitée
`-webkit-app-region: drag` sur toute la surface rendait **hover et clic
morts sur tous les boutons**, même marqués `no-drag` : Chromium route
l'événement vers la zone draggable avant le hit-test des enfants. Le drag
est confiné à `.dragHandle`, bande haute qui ne recouvre aucun contrôle
(marges de 56 px, strictement supérieures aux 42 px des boutons ronds).

### 14. Journal de debug : chemin résolu paresseusement
`app.getPath('home')` appelé **au chargement du module** (avant
`app.whenReady()`) lève et tue le process avant la première ligne de log —
au niveau top-level, rien n'est rattrapé. Le chemin est résolu à la première
écriture, via `os.homedir()`.

En packagé, le journal va dans `~/apex-installer-debug.log` : `__dirname`
pointe dans `app.asar` (non inscriptible) et le dossier de l'exe portable
disparaît à la fermeture.

### 15. `pnpm install` doit être isolé du parent
`slicer_ux` contient un `pnpm-workspace.yaml` avec `packages: [.]` — ne
déclare QUE la racine, jamais `installer/`. pnpm traite malgré tout
`installer/` comme sous-arbre du workspace parent et **vide
`installer/node_modules`**, y compris après une installation réussie —
`@paper-design/shaders` disparaît et le fond meshique ne s'affiche plus.
(Une version antérieure de ce fichier attribuait le bug à l'absence de
`packages:` ; le champ existe désormais et le symptôme est identique — ce
n'est donc pas la présence/absence de `packages:` qui est en cause, mais le
fait qu'`installer/` n'y figure pas.)

Toujours installer avec `pnpm install --ignore-workspace` depuis
`installer/`. Ajouter `CI=true` en contexte non interactif (pnpm refuse
sinon de supprimer un `node_modules` existant).

Un déplacement du projet (ex. `C:` → `R:`) casse aussi les liens du store
pnpm : `node_modules/electron` existe mais **vide**. Même remède.

### 16. Un `<button disabled>` ne reçoit AUCUN événement souris
Pas seulement `click` : Chromium bloque aussi `:hover` en CSS et
`mouseover`/`mouseout`/`mouseenter`/`mouseleave` en JS sur un élément
désactivé. Une règle `.planCard:disabled:hover { … }` ne se déclenche
**jamais**, silencieusement — c'est le bug qui a fait échouer une première
tentative d'effet de survol sur les plans grisés.

Seuls les événements de **pointeur bas niveau** traversent encore l'état
disabled : `pointerdown` (déjà utilisé pour le son de refus, limite #7/#10)
et `pointerenter`/`pointerleave`. Ces deux derniers ne **bubblent pas** :
les écouter en délégation depuis un conteneur parent exige la phase de
capture (3ᵉ argument `true` sur `addEventListener`). Pattern actuel
(`initCardGroup`, `src/renderer.js`) : ces deux écouteurs posent/retirent
une classe `.recoil`, et c'est cette classe — jamais `:hover` — que cible
le CSS de recul des plans grisés.

---

### 17. Fond : verre liquide natif (2026-10-08, non testé à l'écran)
La fenêtre principale utilise le même verre natif que l'écran de démarrage du slicer (`../native/src/backdrop.cpp`,
addon `apex_backdrop.node`, chargé par `electron/backdrop.cjs`) : le bureau Windows est réfracté derrière la fenêtre,
la page n'est plus qu'un contenu sur fond quasi transparent (`html.glass` dans `styles.css`, alpha 3 % pour que la
souris ne traverse pas). La fenêtre reste à opacité 0 jusqu'au premier verre (filet 1,5 s).
- **Le fond meshique est masqué** (`display:none`) quand le verre tourne : le fond WebGL réactif au son (#12) n'est plus
  visible, mais reste le repli sans addon (autre OS, addon non construit).
- Dev : l'addon vient de `../native/build/` (construire avec `node native/build.cjs` à la racine du slicer).
  Packagé : `extraResources` → `resources/native/apex_backdrop.node`.
- Windows 10 2004+ seulement ; les deux fenêtres (page + verre) sont exclues des captures d'écran.
- Lancer l'app déclenche l'UAC (#3) : non essayé depuis la session de l'IA.

## Ce qui reste ouvert

- **Écrire l'installation réelle** (#1) : copie de fichiers, raccourcis
  selon l'OS, enregistrement, désinstalleur.
- **Retirer l'instrumentation de debug** (`quitLog`, canal
  `installer:debug-log`, `debugLog`) une fois le démarrage packagé fiable.
- **Retirer le bouton dev ⟲** (`.devReplayBtn`, touche R) avant diffusion.
- **Vérifier macOS et Linux** : `syncShortcutLabels()` prévoit Dock et barre
  des tâches, mais rien n'a jamais tourné hors Windows ; toute l'élévation
  est spécifique à Windows.
- **Signer l'exécutable** : non signé, Windows affiche « Éditeur inconnu ».
- **Juger le rendu du dégradé partagé** entre mini-fenêtres : les
  interstices de 10 px coupent la continuité, l'effet peut se lire comme des
  tranches plutôt qu'une surface unique.
