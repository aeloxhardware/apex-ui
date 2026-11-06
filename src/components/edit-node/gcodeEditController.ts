import * as BABYLON from 'babylonjs';
import type { GCodeLayer } from '../gcodeLayer';

import { setupState } from './controller/setupState';
import { setupValidation } from './controller/setupValidation';
import { setupLocksPreview } from './controller/setupLocksPreview';
import { setupJournalInfluence } from './controller/setupJournalInfluence';
import { setupNodes } from './controller/setupNodes';
import { setupView } from './controller/setupView';
import { setupDrag } from './controller/setupDrag';
import { setupCommit } from './controller/setupCommit';
import { setupSymmetry } from './controller/setupSymmetry';
import { setupNumericHandles } from './controller/setupNumericHandles';
import { setupEvents } from './controller/setupEvents';
import type { EditCtx } from './controller/context';
import type { GCodeEditController } from './controller/shared';
export type { EditNodeView, EditOverlayView, GCodeEditController } from './controller/shared';

export function createGCodeEditController(opts: {
  scene: BABYLON.Scene;
  engine: BABYLON.AbstractEngine;
  camera: BABYLON.Camera;
  canvas: HTMLCanvasElement;
  layer: GCodeLayer;
  isPreviewActive: () => boolean;
}): GCodeEditController {
  const ctx = { opts } as EditCtx;
  setupState(ctx);
  setupValidation(ctx);
  setupLocksPreview(ctx);
  setupJournalInfluence(ctx);
  setupNodes(ctx);
  setupView(ctx);
  setupDrag(ctx);
  setupCommit(ctx);
  setupSymmetry(ctx);
  setupNumericHandles(ctx);
  return setupEvents(ctx);
}
