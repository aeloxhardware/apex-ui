import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initUiScale } from "./utils/uiScalePrefs";
import "./globals.css";
import { isFlatUi } from "./utils/interfaceMode";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";

if (isFlatUi()) void import("./styles/flat.css");
initUiScale();
// Windows n'affiche pas les drapeaux en émoji : police locale (pas de CDN, l'application est hors ligne).
polyfillCountryFlagEmojis("Twemoji Country Flags", flagFontUrl);
createRoot(document.getElementById("root")!).render(<App />);

// Écran de démarrage (application de bureau) : annoncé « prêt » au premier rendu de l'espace de départ,
// viewport 3D (`apex-viewport-ready`, cf. Viewport3D) ou Accueil (`apex-home-ready`, cf. HomePanel) ;
// garde-fou si aucun des deux n'arrive.
let appReadySent = false;
const sendAppReady = () => {
  if (appReadySent) return;
  appReadySent = true;
  // Deux images : la scène rendue doit avoir été présentée avant que la fenêtre ne s'affiche.
  requestAnimationFrame(() => requestAnimationFrame(() => window.apexDesktop?.appReady()));
};
// Interface moderne : l'Accueil ET le viewport 3D (préchargé au lancement, cf. Index) doivent être prêts.
// Interface classique : le premier des deux suffit (le viewport n'y est monté qu'à l'ouverture de son espace).
const pending = new Set(isFlatUi() ? [] : ["apex-viewport-ready", "apex-home-ready"]);
for (const name of ["apex-viewport-ready", "apex-home-ready"]) {
  window.addEventListener(name, () => {
    pending.delete(name);
    if (pending.size === 0 || isFlatUi()) sendAppReady();
  }, { once: true });
}
window.setTimeout(sendAppReady, 15000);
