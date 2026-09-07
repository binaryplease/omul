/**
 * Static file serving for production — and the server half of the path split
 * this app shares its host under (REQ179, `server/app-paths.ts`).
 *
 * Serves the Vite build output from dist/client/, and answers the app's own
 * pages with index.html so the client router can make a page of them. In
 * development, Vite's dev server serves the same shapes instead.
 *
 * Three things it deliberately does *not* do, each of which used to be free
 * when the app was the whole of its origin and is a defect now that it is not:
 *
 *  - It does not answer `/`. That is the marketing site's, and a request for it
 *    reaching this process at all means the proxy in front routed more than the
 *    app owns. A standalone deployment with no site in front is the one case
 *    where the request is somebody looking for the app, so it is redirected to
 *    the app's front door rather than 404'd — see {@link serveStatic}.
 *  - It does not serve files outside `/app/`. The site builds its own bundle
 *    into a same-named `assets/` directory, so a root-level `/assets/…` here is
 *    the site's URL, and answering it with our file of that name would serve
 *    one product's JavaScript under the other's address.
 *  - It does not fall back to index.html for a path the app does not own. The
 *    old catch-all made every unknown path the app's home page, which on a
 *    shared host is the app shadowing whatever the site put there.
 */

import { Elysia } from "elysia";
import { extname, join, resolve, sep } from "path";
import { APP_ASSET_BASE, assetSubpath, isAppPagePath } from "../app-paths";

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

/** The two things {@link serveStatic} takes beyond the path itself. */
interface ServeStaticOptions {
	/** The request's query string, leading `?` included. */
	search?: string;
	/** The built client directory; the tests point it at a fixture. */
	staticDir?: string;
}

/**
 * The absolute path of the file `pathname` addresses inside `staticDir`, or
 * `null` when it addresses none.
 *
 * Two ways to answer `null`, and the second is the one worth stating: a path
 * that is not under the app's asset base names no file of ours, and a path that
 * resolves *outside* `staticDir` never did — `%2e%2e%2f` segments arrive here
 * already decoded, so containment is checked against the resolved path rather
 * than trusted from the shape of the request.
 */
function resolveStaticFile(pathname: string, staticDir: string): string | null {
	const subpath = assetSubpath(pathname);
	if (subpath === null) return null;
	const resolved = resolve(join(staticDir, subpath));
	if (resolved !== staticDir && !resolved.startsWith(staticDir + sep)) {
		return null;
	}
	return resolved;
}

/**
 * What this server answers for `requestPath`.
 *
 * Separated from the route so the whole decision — file, fallback, redirect or
 * 404 — can be exercised against a fixture directory without a socket, which is
 * what `server/app-paths.test.ts` does.
 *
 * `search` is the request's query string, leading `?` included, and it exists
 * for the redirect below alone: Elysia hands a handler the pathname with the
 * query already stripped, so a redirect built from the path could not carry one
 * even in principle. `staticDir` is the built client directory, overridden only
 * by the tests.
 */
export async function serveStatic(
	requestPath: string,
	{ search = "", staticDir = STATIC_DIR }: ServeStaticOptions = {},
): Promise<Response> {
	// Decode first, and decide everything on the decoded path. Percent-escapes
	// are the reason: `%2f` is a `/` the router never split on, so a path that
	// looks like one harmless segment can carry several — and the segment rule
	// below is only a rule if it is applied to the segments the filesystem will
	// see. A malformed escape decodes to nothing and is refused rather than
	// guessed at.
	let pathname: string;
	try {
		pathname = decodeURIComponent(requestPath);
	} catch {
		return new Response("Not Found", { status: 404 });
	}

	// The one path this app answers without owning it. On a shared host the
	// proxy sends `/` to the marketing site and this never runs; on a standalone
	// deployment there is no site, and the visitor typing the bare host is
	// looking for the app. Temporary rather than permanent: where the app's
	// front door sits is a deployment's layout, not a fact to cache in a browser
	// for as long as it feels like.
	//
	// The query comes along, and that is not decoration. Every auth callback
	// minted before this deployment points at `/?mode=…&token=…`, and those
	// tokens stay valid for an hour after it — a redirect that dropped the query
	// would land each of those users on the app's home page with the landing
	// they were sent to silently gone (`src/auth.tsx` reads `mode` and `token`
	// from the search string, and finds neither).
	if (pathname === "/") {
		return new Response(null, {
			status: 302,
			headers: { Location: `${APP_ASSET_BASE}${search}` },
		});
	}

	// A `..` segment addresses something above where the path claims to be, and
	// nothing this app serves needs one. Refused up front rather than reasoned
	// about later: it keeps the fallback below from answering a traversal with a
	// cheerful 200 just because the prefix looked right.
	if (pathname.split("/").includes("..")) {
		return new Response("Not Found", { status: 404 });
	}

	const filePath = resolveStaticFile(pathname, staticDir);
	if (filePath) {
		const file = Bun.file(filePath);
		if (await file.exists()) {
			const contentType =
				MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
			return new Response(file, { headers: { "Content-Type": contentType } });
		}
	}

	// SPA fallback, for the app's own pages only: the client router turns the
	// URL into a page, so the same index.html answers `/app`, `/join/1234` and
	// `/results/:id` alike.
	if (isAppPagePath(pathname)) {
		const indexFile = Bun.file(join(staticDir, "index.html"));
		if (await indexFile.exists()) {
			return new Response(indexFile, {
				headers: { "Content-Type": "text/html" },
			});
		}
	}

	return new Response("Not Found", { status: 404 });
}

export const staticRoutes = new Elysia().get("/*", ({ path, request }) =>
	serveStatic(path, { search: new URL(request.url).search }),
);
