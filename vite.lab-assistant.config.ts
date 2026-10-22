import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Banc d'essai isolé de l'élément d'interface de l'Assistant vocal (cf. research/assistant/COM.md) :
 * une page seule, sans le reste d'Apex. `pnpm dev:lab-assistant`, port 8091 — tourne à côté de
 * l'application (8080, ou 8081 quand 8080 est pris) et du banc des nœuds (8090) sans les gêner.
 */
export default defineConfig(() => ({
  root: path.resolve(__dirname, "src/lab/assistant"),
  server: {
    host: "::",
    port: 8091,
    strictPort: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
