// Dimensionnement de la grille d'index spatial de la sélection de points (logique pure).

/**
 * Taille de cellule et nombre de cellules par axe pour une boîte de dimensions (`sizeX`, `sizeY`,
 * `sizeZ`) : on part de `cell0` et on grossit la cellule de 50 % tant que la grille dépasse
 * `maxCells`, pour que l'index tienne en mémoire même sur un très gros fichier.
 */
export function pickGridDimensions(
  sizeX: number, sizeY: number, sizeZ: number, cell0: number, maxCells: number,
): { cell: number; nx: number; ny: number; nz: number } {
  let cell = cell0;
  for (;;) {
    const nx = Math.max(1, Math.ceil(sizeX / cell));
    const ny = Math.max(1, Math.ceil(sizeY / cell));
    const nz = Math.max(1, Math.ceil(sizeZ / cell));
    if (nx * ny * nz <= maxCells) return { cell, nx, ny, nz };
    cell *= 1.5;
  }
}
