import { useEffect, useState } from "react";
import {
  playUiSound,
  isUiSoundMuted,
  toggleUiSoundMuted,
  subscribeUiSoundMuted,
} from "@/utils/uiSound";

// Sélecteur des éléments interactifs "génériques" de l'UI : boutons, liens,
// éléments avec un rôle de bouton/menu, inputs cliquables, et tout élément
// marqué explicitement avec data-ui-sound (pour les cas custom qui ne
// matchent aucun des sélecteurs ci-dessus, ou pour désactiver via
// data-ui-sound="off").
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='range']",
  "[data-ui-sound]",
].join(",");

function findInteractiveTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
  if (!el) return null;
  if (el.dataset.uiSound === "off") return null;
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
    return null;
  }
  return el;
}

/**
 * Branche les sons de survol et de clic sur tous les éléments interactifs de
 * l'interface via délégation d'événements sur `document`, plutôt que
 * d'ajouter des handlers à chaque composant un par un - cohérent avec le
 * bus d'événements global `apex-*` déjà utilisé entre Viewport3D et les
 * panneaux (voir CLAUDE.md), on évite ici aussi de faire du prop drilling.
 *
 * À monter une seule fois, au niveau racine de l'app (voir App.tsx).
 */
export function useUiSounds() {
  useEffect(() => {
    let lastHoverTarget: HTMLElement | null = null;

    // `pointerover` remonte depuis chaque enfant (icône, label...) : on ne
    // joue le son que quand l'élément interactif sous le pointeur CHANGE, et
    // on ne se base pas sur `pointerout` de l'enfant (qui faisait rejouer le
    // son en passant de l'icône au bouton lui-même).
    const handlePointerOver = (event: PointerEvent) => {
      const el = findInteractiveTarget(event.target);
      if (el === lastHoverTarget) return;
      lastHoverTarget = el;
      if (el) playUiSound("hover");
    };

    // Sortie de la fenêtre (relatedTarget null) : aucun `pointerover` ne
    // suivra, on réinitialise pour que le retour sur le même bouton rejoue.
    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) lastHoverTarget = null;
    };

    const handleClick = (event: MouseEvent) => {
      const el = findInteractiveTarget(event.target);
      if (!el) return;
      playUiSound("click");
    };

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("click", handleClick);
    };
  }, []);
}

/**
 * Expose l'état mute/unmute des sons UI (coupés par défaut) et une fonction
 * pour le basculer, pour un bouton du type de celui de FileSidebar.
 */
export function useUiSoundMuted() {
  const [muted, setMuted] = useState(isUiSoundMuted);

  useEffect(() => subscribeUiSoundMuted(setMuted), []);

  return [muted, toggleUiSoundMuted] as const;
}
