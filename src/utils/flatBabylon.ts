import type * as BABYLONNS from 'babylonjs';
import { isFlatUi } from './interfaceMode';

/**
 * Interface classique : aucune animation, y compris celles de Babylon (caméra des vues prédéfinies, apparition des
 * voxels…). On court-circuite les deux API utilisées par le viewport pour qu'elles posent directement la valeur finale
 * et appellent leur rappel de fin ; le reste du code n'a pas à changer.
 */

type Keyed = { getKeys(): { frame: number; value: unknown }[]; targetPropertyPath: string[] };

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let obj = target;
  for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] as Record<string, unknown>;
  const last = path[path.length - 1];
  const current = obj[last] as { copyFrom?: (v: unknown) => void } | undefined;
  if (current && typeof current.copyFrom === 'function') current.copyFrom(value);
  else obj[last] = value;
}

export function installFlatBabylon(BABYLON: typeof BABYLONNS) {
  if (!isFlatUi()) return;
  const done = { stop() {}, pause() {}, onAnimationEnd: null } as never;

  BABYLON.Scene.prototype.beginDirectAnimation = function (target, animations, _from, _to, _loop, _speed, onAnimationEnd) {
    for (const a of animations as unknown as Keyed[]) {
      const keys = a.getKeys();
      if (keys.length) setPath(target as Record<string, unknown>, a.targetPropertyPath, keys[keys.length - 1].value);
    }
    onAnimationEnd?.();
    return done;
  };

  BABYLON.Animation.CreateAndStartAnimation = function (_name, node, targetProperty, _fps, _totalFrame, _from, to, _loop, _easing, onAnimationEnd) {
    setPath(node as unknown as Record<string, unknown>, targetProperty.split('.'), to);
    onAnimationEnd?.();
    return done;
  };
}
