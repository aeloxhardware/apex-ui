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
