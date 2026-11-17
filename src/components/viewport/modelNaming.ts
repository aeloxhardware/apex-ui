// Nommage des modèles importés (logique pure).

/**
 * Nom à donner à un modèle importé : celui du fichier, suffixé (2), (3)… avant l'extension s'il est
 * déjà porté par un modèle du plateau — ce qui autorise plusieurs exemplaires du même fichier.
 */
export function uniqueModelName(fileName: string, existing: ReadonlySet<string>): string {
  let uniqueName = fileName;
  let copyIndex = 2;
  while (existing.has(uniqueName)) {
    const dotIndex = fileName.lastIndexOf('.');
    uniqueName = dotIndex > 0
      ? `${fileName.slice(0, dotIndex)} (${copyIndex})${fileName.slice(dotIndex)}`
      : `${fileName} (${copyIndex})`;
    copyIndex++;
  }
  return uniqueName;
}

/** Nom d'un morceau de coupe : « pièce (haut).stl », unique sur le plateau. */
export function cutPartName(sourceName: string, label: string, existing: ReadonlySet<string>): string {
  const dot = sourceName.lastIndexOf('.');
  const named = dot > 0 ? `${sourceName.slice(0, dot)} (${label})${sourceName.slice(dot)}` : `${sourceName} (${label})`;
  return uniqueModelName(named, existing);
}
