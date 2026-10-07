import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initUiScale } from "./utils/uiScalePrefs";
import "./globals.css";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";

initUiScale();
// Windows n'affiche pas les drapeaux en émoji : police locale (pas de CDN, l'application est hors ligne).
polyfillCountryFlagEmojis("Twemoji Country Flags", flagFontUrl);
createRoot(document.getElementById("root")!).render(<App />);
