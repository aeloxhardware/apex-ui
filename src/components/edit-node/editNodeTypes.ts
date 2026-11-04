export type HandleDragMode = "both" | "rotate" | "influence";

export interface HandleDragEvent {
  id: number;
  phase: "start" | "move" | "end";
  mode: HandleDragMode;
  /** Position de la poignée (px relatifs au nœud). */
  dx: number;
  dy: number;
  locked: boolean;
}
