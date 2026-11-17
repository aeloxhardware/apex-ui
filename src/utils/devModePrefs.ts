/**
 * Variable « dev » de l'application (et non un réglage de l'utilisateur : rien dans Paramètres). Désactivée, elle
 * n'affiche que les deux bandeaux rouges de préversion (haut, français ; bas, anglais) et ne change rien d'autre
 * (ordre de l'utilisateur, 2026-11-17). Par défaut : activée en développement (vite serve / build de développement),
 * désactivée dans l'application livrée (build de production). Forçable au démarrage ou à la compilation par
 * `VITE_APEX_DEV=false` (ou `true`), p. ex. `cross-env VITE_APEX_DEV=false pnpm electron:dev`.
 */

const forced = import.meta.env.VITE_APEX_DEV;

export const DEV_MODE: boolean = forced === undefined || forced === '' ? import.meta.env.DEV : forced !== 'false';

/** Texte de présentation (Accueil, infobulle du logo). */
export const APP_TAGLINE =
  'Openware de tranchage de modèles 3D destiné à la fabrication additive non-planaire à plan de construction dynamique.';
