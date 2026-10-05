import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Banc d'essai isolé du nœud d'édition (onglet Édition, cf. CLAUDE.md) : une page seule, sans le
 * reste d'Apex, pour concevoir l'élément d'interface pas à pas. `pnpm dev:lab-node`, port 8090 —
 * tourne à côté de l'application (8080, ou 8081 quand 8080 est pris) sans la gêner.
 */
export default defineConfig(() => ({
  root: path.resolve(__dirname, "src/lab/edit-node"),
  server: {
    host: "::",
    port: 8090,
    strictPort: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
