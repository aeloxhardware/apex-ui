import { describe, expect, it } from 'vitest';
import { DEFAULT_GIZMO_ORIENTATION, getGizmoOrientation, sanitizeGizmoOrientation, setGizmoOrientation } from './gizmoOrientationPrefs';

describe('orientation des flèches de déplacement', () => {
  it('est relative par défaut (comportement d’origine)', () => {
    expect(DEFAULT_GIZMO_ORIENTATION).toBe('relative');
    expect(sanitizeGizmoOrientation(null)).toBe('relative');
    expect(sanitizeGizmoOrientation('n’importe quoi')).toBe('relative');
  });

  it('garde une valeur connue', () => {
    expect(sanitizeGizmoOrientation('absolute')).toBe('absolute');
    expect(sanitizeGizmoOrientation('relative')).toBe('relative');
  });

  it('retient le dernier choix', () => {
    setGizmoOrientation('absolute');
    expect(getGizmoOrientation()).toBe('absolute');
    setGizmoOrientation('relative');
    expect(getGizmoOrientation()).toBe('relative');
  });
});
