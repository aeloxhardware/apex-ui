// Registre des raccourcis clavier d'Apex, et arbre qui les range pour la page « Raccourcis » de l'Accueil.
// Une seule source : tout raccourci branché dans l'interface (voir l'écouteur cité en commentaire) y est déclaré ;
// toute autre touche du clavier est « non attribuée ». Données pures, sans React.

export type Modifier = 'Ctrl' | 'Maj' | 'Alt';

/** Ordre fixe des modificateurs : Ctrl, puis Maj, puis Alt (la combinaison s'écrit toujours dans cet ordre). */
export const MODIFIER_ORDER: readonly Modifier[] = ['Ctrl', 'Maj', 'Alt'];

export interface ShortcutDef {
  mods: readonly Modifier[];
  /** Identifiant de touche : l'un de ceux de `KEY_GROUPS`, ou, pour la souris, `Clic` / `Glisser`. */
  key: string;
  label: string;
  desc: string;
  /** Raccourci à la souris (clic ou glisser avec le modificateur tenu), non à une touche. */
  mouse?: true;
}

const ctrl = ['Ctrl'] as const;
const ctrlShift = ['Ctrl', 'Maj'] as const;
const alt = ['Alt'] as const;
const none = [] as const;

/** Tous les raccourcis branchés. Les écouteurs : sidebarHooks, ModelingSidebar, FileMenu, viewport/*, edit-node/*. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { mods: none, key: 'M', label: 'Déplacer', desc: 'Active ou quitte l’outil Déplacer (Préparation).' },
  { mods: none, key: 'R', label: 'Pivoter', desc: 'Active ou quitte l’outil Pivoter (Préparation).' },
  { mods: none, key: 'S', label: 'Échelle', desc: 'Active ou quitte l’outil Échelle (Préparation).' },
  { mods: none, key: 'T', label: 'Texture', desc: 'Active ou quitte l’outil Texture (Préparation).' },
  { mods: none, key: 'C', label: 'Couper', desc: 'Active ou quitte l’outil Couper (Préparation).' },
  { mods: none, key: 'E', label: 'Extrusion', desc: 'Lance l’outil Extrusion (Modélisation).' },
  {
    mods: none,
    key: 'Échap',
    label: 'Annuler / revenir',
    desc: 'Retour à la sélection, annule l’esquisse, la disposition automatique ou le mode en cours.',
  },
  { mods: none, key: 'Suppr', label: 'Supprimer', desc: 'Supprime les modèles sélectionnés.' },
  { mods: none, key: 'Retour arrière', label: 'Supprimer', desc: 'Supprime les modèles sélectionnés.' },
  { mods: ctrl, key: 'S', label: 'Enregistrer le projet', desc: 'Enregistre le projet en 3MF, s’il a été modifié.' },
  { mods: ctrl, key: 'Z', label: 'Annuler', desc: 'Annule la dernière modification des modèles (ou de l’édition de nœuds).' },
  { mods: ctrl, key: 'Y', label: 'Rétablir', desc: 'Rétablit la modification annulée.' },
  { mods: ctrl, key: 'C', label: 'Copier', desc: 'Copie les modèles sélectionnés.' },
  { mods: ctrl, key: 'V', label: 'Coller', desc: 'Colle les modèles copiés sur le plateau.' },
  { mods: ctrl, key: 'X', label: 'Couper', desc: 'Copie puis supprime les modèles sélectionnés.' },
  { mods: ctrl, key: 'A', label: 'Tout sélectionner', desc: 'Sélectionne tous les modèles du plateau.' },
  { mods: ctrl, key: 'Clic', label: 'Sélection additive', desc: 'Ajoute ou retire le modèle cliqué de la sélection.', mouse: true },
  {
    mods: ctrl,
    key: 'Glisser',
    label: 'Compléter la sélection',
    desc: 'Rectangle de sélection qui complète la sélection au lieu de la remplacer ; en édition de nœuds, tourne la déformation seule ; avec une poignée d’échelle, ancre la face ou l’angle opposé.',
    mouse: true,
  },
  { mods: ctrlShift, key: 'S', label: 'Enregistrer sous…', desc: 'Enregistre une nouvelle copie du projet en 3MF.' },
  { mods: ctrlShift, key: 'Z', label: 'Rétablir', desc: 'Rétablit la modification annulée (comme Ctrl + Y).' },
  { mods: ctrlShift, key: '4', label: 'Cadre de rendu 4K', desc: 'Affiche ou masque le cadre de rendu 4K.' },
  {
    mods: alt,
    key: 'F4',
    label: 'Fermer Apex',
    desc: 'Demande la fermeture : le rideau de fermeture se joue (une 2e fois, fermeture forcée).',
  },
  {
    mods: alt,
    key: 'Glisser',
    label: 'Influence seule',
    desc: 'En édition de nœuds, règle l’influence de la poignée sans la tourner.',
    mouse: true,
  },
];

export interface KeyGroup {
  title: string;
  keys: readonly string[];
}

const range = (from: number, to: number, make: (i: number) => string): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => make(from + i));

/** Toutes les touches d'un clavier (rangée de chiffres, lettres, fonctions, édition, flèches, ponctuation AZERTY). */
export const KEY_GROUPS: readonly KeyGroup[] = [
  { title: 'Lettres', keys: range(0, 25, (i) => String.fromCharCode(65 + i)) },
  { title: 'Chiffres (rangée du haut)', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] },
  { title: 'Touches de fonction', keys: range(1, 12, (i) => `F${i}`) },
  { title: 'Édition', keys: ['Échap', 'Tab', 'Espace', 'Entrée', 'Retour arrière', 'Suppr', 'Inser'] },
  { title: 'Navigation', keys: ['Début', 'Fin', 'Page ↑', 'Page ↓', '←', '↑', '↓', '→'] },
  { title: 'Ponctuation et symboles', keys: ['²', ')', '=', '^', '$', 'ù', '*', '<', ',', ';', ':', '!'] },
];

export const ALL_KEYS: readonly string[] = KEY_GROUPS.flatMap((g) => g.keys);

export interface ShortcutNode {
  id: string;
  mods: readonly Modifier[];
  title: string;
  children: ShortcutNode[];
}

/** Titre d'un nœud : « Ctrl + Maj », ou « Touche seule » pour la racine sans modificateur. */
export function comboTitle(mods: readonly Modifier[]): string {
  return mods.length === 0 ? 'Touche seule' : mods.join(' + ');
}

function makeNode(mods: readonly Modifier[]): ShortcutNode {
  // « Touche seule » n'a pas d'enfants : Ctrl, Maj et Alt sont ses voisines, pas ses sous-niveaux.
  const last = MODIFIER_ORDER.indexOf(mods[mods.length - 1] as Modifier);
  const children = mods.length === 0 ? [] : MODIFIER_ORDER.slice(last + 1).map((m) => makeNode([...mods, m]));
  return { id: mods.join('+') || 'seule', mods, title: comboTitle(mods), children };
}

/**
 * Arbre des combinaisons : racines Touche seule, Ctrl, Maj, Alt ; sous chacune, les combinaisons à deux modificateurs
 * (Ctrl + Maj, Ctrl + Alt sous Ctrl ; Maj + Alt sous Maj), puis à trois (Ctrl + Maj + Alt sous Ctrl + Maj).
 */
export function buildShortcutTree(): ShortcutNode[] {
  return [[], ...MODIFIER_ORDER.map((m) => [m])].map((mods) => makeNode(mods as Modifier[]));
}

/** Raccourcis dont la combinaison de modificateurs est exactement `mods`. */
export function shortcutsOf(mods: readonly Modifier[], defs: readonly ShortcutDef[] = SHORTCUTS): ShortcutDef[] {
  const wanted = mods.join('+');
  return defs.filter((d) => d.mods.join('+') === wanted);
}

/** Raccourci attribué à une touche (clavier) pour cette combinaison, sinon `undefined` : la touche est libre. */
export function shortcutFor(mods: readonly Modifier[], key: string, defs: readonly ShortcutDef[] = SHORTCUTS): ShortcutDef | undefined {
  return shortcutsOf(mods, defs).find((d) => d.key === key && !d.mouse);
}

/** Nombre de raccourcis d'un nœud et de tous ses descendants. */
export function countAssigned(node: ShortcutNode, defs: readonly ShortcutDef[] = SHORTCUTS): number {
  return shortcutsOf(node.mods, defs).length + node.children.reduce((n, c) => n + countAssigned(c, defs), 0);
}
