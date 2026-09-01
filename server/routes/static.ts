/**
 * Static file serving for production.
 *
 * Serves the Vite build output from dist/client/.
 * Handles SPA routing by falling back to index.html for non-file paths.
 * In development, Vite's dev server handles static files via proxy.
 */

import { Elysia } from "elysia";
import { extname, join, resolve } from "path";

// In the bundled server (dist/server/index.js), import.meta.dir points to
// dist/server/. We need dist/client/ which is a sibling directory.
const STATIC_DIR = resolve(import.meta.dir, "..", "client");

/** MIME types for common static assets. */
const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".eot": "application/vnd.ms-fontobject",
	".webp": "image/webp",
	".avif": "image/avif",
	".map": "application/json",
	// The bundled webfonts' OFL-1.1 notice ships as public/licenses/*.txt and
	// has to be readable where the fonts are served, not downloaded as an
	// opaque blob — without this entry it falls through to
	// application/octet-stream (NOTICE.md §3).
	".txt": "text/plain; charset=utf-8",
};

export const staticRoutes = new Elysia().get("/*", async ({ path }) => {
	// Try to serve the exact file
	const filePath = join(STATIC_DIR, path);
	const file = Bun.file(filePath);

	if (await file.exists()) {
		const ext = extname(filePath);
		const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
		return new Response(file, {
			headers: { "Content-Type": contentType },
		});
	}

	// SPA fallback: return index.html for client-side routing
	const indexFile = Bun.file(join(STATIC_DIR, "index.html"));
	if (await indexFile.exists()) {
		return new Response(indexFile, {
			headers: { "Content-Type": "text/html" },
		});
	}

	return new Response("Not Found", { status: 404 });
});
