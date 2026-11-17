import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS,
  SHORTCUTS,
  buildShortcutTree,
  countAssigned,
  shortcutFor,
  type ShortcutNode,
} from './shortcuts';

const ids = (nodes: ShortcutNode[]): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)]);

describe('arbre des raccourcis', () => {
  it('a pour racines Touche seule, Ctrl, Maj, Alt', () => {
    expect(buildShortcutTree().map((n) => n.title)).toEqual(['Touche seule', 'Ctrl', 'Maj', 'Alt']);
  });

  it('contient chaque combinaison de modificateurs une fois, sans doublon', () => {
    expect(ids(buildShortcutTree()).sort()).toEqual(
      ['Alt', 'Ctrl', 'Ctrl+Alt', 'Ctrl+Maj', 'Ctrl+Maj+Alt', 'Maj', 'Maj+Alt', 'seule'].sort(),
    );
  });

  it('range Ctrl + Maj + Alt sous Ctrl + Maj', () => {
    const ctrl = buildShortcutTree().find((n) => n.id === 'Ctrl');
    const ctrlMaj = ctrl?.children.find((n) => n.id === 'Ctrl+Maj');
    expect(ctrlMaj?.children.map((n) => n.id)).toEqual(['Ctrl+Maj+Alt']);
  });
});

describe('registre', () => {
  it('ne déclare aucune touche inconnue ni aucun doublon', () => {
    const seen = new Set<string>();
    for (const d of SHORTCUTS) {
      if (!d.mouse) expect(ALL_KEYS).toContain(d.key);
      const id = `${d.mods.join('+')}|${d.key}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('retrouve un raccourci attribué et laisse les autres libres', () => {
    expect(shortcutFor(['Ctrl'], 'Z')?.label).toBe('Annuler');
    expect(shortcutFor(['Ctrl'], 'Q')).toBeUndefined();
    expect(shortcutFor([], 'Z')).toBeUndefined();
  });

  it('compte les raccourcis d’un nœud et de ses descendants', () => {
    const ctrl = buildShortcutTree().find((n) => n.id === 'Ctrl');
    expect(ctrl && countAssigned(ctrl)).toBe(SHORTCUTS.filter((d) => d.mods[0] === 'Ctrl').length);
  });
});
