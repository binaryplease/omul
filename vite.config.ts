import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { APP_ASSET_BASE, isAppPagePath } from "./server/app-paths";
import {
  KEPT_QUERY_PARAMS_ENV,
  injectKeptQueryParams,
  resolveKeptQueryParams,
} from "./server/kept-query-params";

/**
 * Serve the app's root-level pages in dev the way production serves them
 * (REQ179).
 *
 * `base` moves the dev server's whole surface under `/app/`, and Vite answers
 * anything outside it with a 404 — which is every path the app kept at the
 * root, `/join/1234` first among them. Since that link is the entire reason for
 * the split, a dev server that cannot open it would make the change
 * unverifiable on the machine it is written on.
 *
 * So those requests are rewritten onto the base internally: Vite's own SPA
 * fallback hands back the same index.html production does, while the browser's
 * URL — the only thing `src/router.ts` reads — is untouched. The rewrite is
 * driven by `isAppPagePath`, so it covers exactly what the production handler
 * covers, and it deliberately leaves `/api` and `/ws` alone: those belong to
 * the proxy below, and an HTML page is not an answer to either.
 */
function rootOwnedPages(): Plugin {
  return {
    name: "omul-root-owned-pages",
    configureServer(server) {
      // Registered from `configureServer` without returning a function, so it
      // runs *before* Vite's internal middlewares — including the base check
      // that would otherwise have already 404'd the request.
      server.middlewares.use((request, _response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        if (isAppPagePath(pathname) && !pathname.startsWith(APP_ASSET_BASE)) {
          request.url = APP_ASSET_BASE;
        }
        next();
      });
    },
  };
}

/**
 * Write the kept query parameters into the dev server's index.html the way
 * production does (REQ203, `server/routes/static.ts`).
 *
 * In production the Bun server rewrites the page it hands out; in dev Vite hands
 * it out, so without this the list would be empty here whatever the operator
 * set, and the behaviour could not be tried on the machine it is written on.
 * The variable is read the way the dev server process reads it — the shell
 * first, then `.env` in the project directory — which `loadEnv` does when given
 * the repository root rather than Vite's `root`. Serve only: a build that wrote
 * the list into `dist/client/index.html` would bake one deployment's
 * configuration into the image, and the server would then write it a second
 * time.
 */
function keptQueryParamsInDev(): Plugin {
  let environment: Record<string, string> = {};
  return {
    name: "omul-kept-query-params",
    apply: "serve",
    config(_config, { mode }) {
      environment = loadEnv(mode, __dirname, KEPT_QUERY_PARAMS_ENV);
    },
    transformIndexHtml(html) {
      return injectKeptQueryParams(html, resolveKeptQueryParams(environment));
    },
  };
}

export default defineConfig({
  // The app's home page and every built asset live under this prefix, because
  // the host root belongs to the marketing site — and `/assets/` does too,
  // which is the collision that makes this a move rather than a preference
  // (REQ179, server/app-paths.ts).
  base: APP_ASSET_BASE,
  plugins: [react(), tailwindcss(), rootOwnedPages(), keptQueryParamsInDev()],
  root: "src",
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "^/api/.*": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
