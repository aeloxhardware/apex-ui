# Mise à jour automatique d'Apex

Décidée par l'utilisateur le 2026-10-31. Règles communes (format du manifeste, releases, clé) : `apex/integration/RULES.md`, §4.4.

## Comportement

À **chaque lancement** de l'application installée (Windows, build de production ; jamais en développement), le processus principal
(`electron/update-flow.cjs`, appelé au début de `app.whenReady`) interroge la dernière **release** GitHub du dépôt `aeloxhardware/apex`
(`apexUpdate` dans `package.json` : `repo`, `channel`). Si une version plus récente existe, elle s'installe **sans demander** :
une boîte de dialogue seule, sans voile, en **verre liquide** comme l'écran de démarrage (décision de l'utilisateur, 2026-10-31 : « APEX / MISE À JOUR », texte de l'utilisateur, spinner, barre de
progression, version cible ; `electron/update.html`). L'application relance ensuite. Toute erreur (réseau, signature, intégrité, droits
d'écriture) est journalisée et l'application démarre normalement ; le délai de vérification est plafonné à 4 s.

- `channel` : `release` (défaut, seulement les releases) ou `prerelease`. Une pré-release GitHub est une version pas encore validée par
  une impression réelle (RULES §4.3) : elle n'est pas installée automatiquement.
- `--update-demo` (argument de ligne de commande) : montre l'écran avec une progression factice, sans rien installer.

## Seulement les fichiers nécessaires

La release porte `update-manifest.json` (chemin, SHA-256, taille, `src` de chaque fichier de l'application) et `update-manifest.sig`.
Les fichiers sont des assets **nommés par leur SHA-256** ; seuls ceux dont le contenu a changé depuis la release précédente y sont
publiés, `src` indique la release qui héberge chaque fichier. Le client compare à l'installation (taille, puis SHA-256) et ne
télécharge que la différence. Granularité : le fichier. `resources/app.asar` (tout le code de l'interface) est un seul fichier : il est
re-téléchargé en entier au moindre changement d'interface ; Electron, Python embarqué, moteur et profils, eux, ne bougent pas
d'une version à l'autre.

## Fichiers en cours d'exécution : débrancher, remplacer, rebrancher

Windows interdit d'écraser un exécutable, une DLL ou l'asar en cours d'utilisation, mais autorise à les **renommer**. Pour chaque
fichier à remplacer : l'ancien devient `<nom>.old`, le nouveau (déjà téléchargé et vérifié dans `.apex-update/staging/`) prend sa
place, l'application relance, et les `.old` sont supprimés au démarrage suivant (`cleanupOld`, liste dans `.apex-update/old-files.json`).
Au moindre échec pendant la bascule, tout est remis comme avant. `.apex-update/installed-manifest.json` garde le manifeste installé
(pour savoir quels fichiers retirer). Testé sur un fichier ouvert (`electron/updater.test.ts`) ; **pas encore éprouvé sur un exe
Electron réel** (voir « Reste à faire »).

## Intégrité et authenticité

- Chaque fichier est vérifié (taille + SHA-256) avant d'être gardé ; un fichier incorrect est supprimé.
- Le manifeste est **signé en Ed25519**. La clé publique est dans `electron/update-public-key.pem` (embarquée). La clé privée
  (`~/.apex/update-private.pem`, créée par `scripts/update/keygen.cjs`) reste **hors des dépôts** : qui la détient peut publier une
  mise à jour que tous les postes installeront. La perdre = ne plus pouvoir mettre à jour (réinstallation avec une nouvelle clé publique).
- Les chemins du manifeste sont contrôlés (pas de `..`, pas de chemin absolu, pas le dossier d'état).

## Publier une mise à jour

1. Construire l'application (`electron:build:dir`), ce qui donne `release/win-unpacked/`.
2. `node scripts/update/make-manifest.cjs release/win-unpacked --previous <update-manifest.json de la release précédente>`
   (première release : sans `--previous`, aucun asset de fichier, seulement le manifeste). Sortie : `release/update/`.
3. `gh release create <version> release/update/* --repo aeloxhardware/apex` (`--prerelease` tant qu'aucune impression réelle n'a validé
   la version). Les releases se publient depuis `apex`, jamais depuis `apex-ui` (RULES §4.3).

## Reste à faire

- Essai de bout en bout sur une installation réelle (exe Electron renommé pendant l'exécution, droits d'écriture dans le dossier choisi
  par l'installateur, antivirus qui verrouille un fichier tout juste posé).
- L'installateur doit inscrire dans l'installation le manifeste de la version installée (`.apex-update/installed-manifest.json`) :
  sans lui, le premier passage recalcule les SHA-256 de ce qui est installé (plus long) et ne retire aucun fichier obsolète.
- macOS / Linux : non pris en charge (le code s'arrête hors Windows).
- Texte de la boîte : « Apex Studio » est le nom employé par l'utilisateur ; l'application s'appelle « Apex Slicer » ailleurs.

## Résumé (ex-CLAUDE.md, 2026-11-04)

At every launch of the installed app (Windows, production build) `electron/update-flow.cjs` checks the latest GitHub **release** of `aeloxhardware/apex` and installs a newer one without asking (liquid-glass dialog « APEX / MISE À JOUR » with progress, no veil), downloading only the changed files (manifest of SHA-256, assets named by hash), with a signed manifest (Ed25519, public key `electron/update-public-key.pem`, private key kept outside the repos in `~/.apex/`). Running files are renamed to `.old`, replaced, then the app relaunches. Everything (behaviour, publishing, what is left to do): `docs/UPDATES.md`; shared rules: `apex/integration/RULES.md` §4.4. Pure logic in `electron/updater.cjs` (tested by `electron/updater.test.ts`), publishing scripts in `scripts/update/`.
