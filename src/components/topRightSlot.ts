import { useEffect, useState } from 'react';

/** Emplacement, en tête de la rangée en haut à droite (AxisSidebar), où se pose le bouton « Découper le plateau ». */
export const TOP_RIGHT_SLOT_ID = 'apex-top-right-slot';

/** L'emplacement dès qu'il existe dans le DOM (la barre des axes et le bouton ne montent pas toujours ensemble). */
export function useTopRightSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(() => document.getElementById(TOP_RIGHT_SLOT_ID));
  useEffect(() => {
    const sync = () => setSlot((current) => {
      const next = document.getElementById(TOP_RIGHT_SLOT_ID);
      return next === current ? current : next;
    });
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return slot;
}
