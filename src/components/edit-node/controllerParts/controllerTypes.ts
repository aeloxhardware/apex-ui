// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).


// --- symétrie : la déformation validée est répétée en d'autres points (cyclique ou miroir) ---------

export type Vec3k = [number, number, number];

export interface SymmetryMap { point: (v: Vec3k) => Vec3k; axis: (v: Vec3k) => Vec3k }
