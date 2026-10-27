import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Serveur de développement seulement : conversion polaire des G-codes par le script Python local
 * (même module que l'application de bureau, electron/python-runner.cjs), pour pouvoir convertir
 * depuis le navigateur sans lancer Electron. Réponse en flux : lignes `PROGRESS <n>`, puis
 * `RESULT` suivi du JSON { text, summary }, ou `ERROR` suivi du message.
 * Réservé aux requêtes locales : le serveur écoute sur toutes les interfaces (host "::").
 */
function apexConvertDevServer(): Plugin {
  return {
    name: "apex-convert-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__apex/convert-gcode", (req, res) => {
        const remote = req.socket.remoteAddress ?? "";
        if (req.method !== "POST" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          try {
            const { convertGCode } = require("./electron/python-runner.cjs");
            const result = await convertGCode(JSON.parse(Buffer.concat(chunks).toString("utf8")), {
              script: path.resolve(__dirname, "python/gcode_to_polar.py"),
              embeddedPython: path.resolve(__dirname, "build/python-embed/python.exe"),
              nativeExe: path.resolve(__dirname, "native/build/apex_gcode_to_polar" + (process.platform === "win32" ? ".exe" : "")),
              headSamples: path.resolve(__dirname, "native/data/head-samples.bin"),
              onProgress: (percent: number) => res.write(`PROGRESS ${percent}\n`),
            });
            res.end(`RESULT\n${JSON.stringify(result)}`);
          } catch (err) {
            res.end(`ERROR\n${err instanceof Error ? err.message : String(err)}`);
          }
        });
      });
    },
  };
}

/**
 * Serveur de développement seulement : profils d'imprimantes (dossier `profiles/`) lus par le même
 * module que l'application de bureau (electron/profiles.cjs), pour le menu Imprimantes en navigateur.
 */
function apexProfilesDevServer(): Plugin {
  const root = path.resolve(__dirname, "profiles");
  return {
    name: "apex-profiles-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__apex/profiles", (req, res) => {
        const { scanProfiles, readProfile } = require("./electron/profiles.cjs");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          const body = url.pathname === "/read"
            ? readProfile(root, url.searchParams.get("path"))
            : scanProfiles(root);
          res.end(JSON.stringify(body));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig(() => ({
  // Chemins relatifs : l'application de bureau charge dist/index.html par file:// (electron/main.cjs), ou `/assets/...`
  // pointerait vers la racine du disque et l'ecran resterait noir.
  base: "./",
  define: {
    __APEX_VERSION__: JSON.stringify(require("./package.json").apexVersion),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), apexConvertDevServer(), apexProfilesDevServer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
