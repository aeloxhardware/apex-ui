import { useEffect, useRef, useState } from 'react';

/**
 * Un menu de catégorie de la pilule (Qualité, Solidité…) reste ouvert tant que l'utilisateur ne change pas d'avis.
 * L'entrée en Prévisualisation le ferme pourtant (la pilule devient un panneau, cf. categoriesPreviewState.ts) :
 * ce hook retient celui qui était ouvert, pour que CategoriesSidebar le rouvre au retour en Préparation. Il est
 * oublié dès qu'un menu est rouvert, donc le bouton Profils imprimante (qui ferme volontairement le menu) ne le
 * ressuscite pas.
 */
export function useResumeCategory(activeCategory: string | null, isPreviewActive: boolean): string | null {
  const lastOpenRef = useRef(activeCategory);
  // Pendant la Prévisualisation, `activeCategory` vaut null : on garde la valeur d'avant l'entrée.
  if (!isPreviewActive) lastOpenRef.current = activeCategory;
  const [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    if (isPreviewActive) setResume(lastOpenRef.current);
  }, [isPreviewActive]);
  useEffect(() => {
    if (activeCategory !== null) setResume(null);
  }, [activeCategory]);
  return resume;
}
