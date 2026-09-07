/**
 * Where this app lives on its host — one description of it, read by everything
 * that has to agree (REQ179).
 *
 * The app used to be the whole of its origin: it answered `/` with its own home
 * page and served its bundle from `/assets/`, because nothing else was there.
 * It now shares one host with the marketing site, and the reason is a spoken
 * sentence: a presenter reads the join link off the slide to a room, and
 * "omul.app slash join slash 1234" is a sentence a room can hold where
 * "app dot omul dot app slash join slash 1234" is not. So the join link keeps
 * the host root, and what moves is the app's *own* front door.
 *
 * Three consequences, and they are the whole of this module:
 *
 *  1. **The app's home page and its built assets live under {@link APP_BASE_PATH}.**
 *     `/` is the marketing site's, and so is `/assets/` — the site builds its
 *     own bundle into the same-named directory, which is the collision that
 *     forces the move rather than merely suggesting it.
 *  2. **The paths a presenter or a participant is *sent* keep the root**
 *     ({@link ROOT_OWNED_PREFIXES}). `/join/*` is the one the change exists
 *     for; the rest are there because a link already handed out must not stop
 *     resolving, which is the same argument applied to links already in the
 *     wild rather than to links spoken aloud.
 *  3. **Everything else at the root belongs to the site.** This module is the
 *     list of what does not, so the split is derived from the app's own source
 *     rather than transcribed into a proxy configuration and left to drift.
 *
 * Read by `vite.config.ts` (the base it stamps into asset URLs, and the dev
 * server's rewrite), `server/routes/static.ts` (which file, or which fallback,
 * a request gets) and `src/router.ts` (which page a URL is). Deliberately
 * dependency-free so all three can have it: it is a fact about the deployment,
 * not about any one of them.
 *
 * What is *not* here: the proxy in front. Which host, which certificate and
 * which upstream are the deployment's, and this repository states no opinion on
 * them — see docs/deployment.md §"Sharing one host with the marketing site".
 */

/**
 * The path prefix the app's own home page and its built assets live under.
 *
 * No trailing slash: it is also a path in its own right (`/app` is the home
 * page). {@link APP_ASSET_BASE} is the trailing-slash spelling the build wants.
 */
export const APP_BASE_PATH = "/app";

/**
 * The same prefix as Vite's `base` — with the trailing slash Vite requires, and
 * which every asset URL in the built HTML is stamped with.
 */
export const APP_ASSET_BASE = `${APP_BASE_PATH}/`;

/**
 * The root-level path prefixes the app still owns: the pages somebody is *sent*
 * to, which is why they cannot move under {@link APP_BASE_PATH} with the home
 * page.
 *
 * `/join` is the reason the whole split exists — it is read aloud to a room and
 * printed on the slide. The rest are links that have already been handed out:
 * an edit link mailed to a co-presenter, a results link given to somebody who
 * was not in the room (REQ098), the address bar of a tab left open on a
 * workspace. A path that stops resolving breaks each of those in the same way.
 *
 * Matched by {@link isAppPagePath}, which owns the matching rule so a proxy in
 * front and the server behind it cannot disagree about what `/joining` is.
 */
export const ROOT_OWNED_PREFIXES = [
	"/join",
	"/present",
	"/preview",
	"/results",
	"/edit",
	"/workspaces",
	"/templates",
	"/generate",
] as const;

/**
 * The root-level prefixes the *server* answers rather than the SPA: the HTTP
 * API (its docs and the discovery index with it) and the WebSocket.
 *
 * Kept apart from {@link ROOT_OWNED_PREFIXES} because the difference matters to
 * both readers of this module: the static handler must never answer these with
 * `index.html`, and the dev server must never rewrite them onto the base — a
 * rewritten `/api/...` would be served an HTML page instead of being proxied.
 */
export const ROOT_OWNED_SERVICE_PREFIXES = ["/api", "/ws"] as const;

/**
 * Every path prefix this app answers on a shared host, base included — what a
 * reverse proxy in front of it has to route here, and nothing more.
 *
 * The complement is the marketing site's. Deriving the proxy's matcher from
 * this list keeps the two halves of the split from drifting apart silently: a
 * route added here without the proxy learning of it 404s on the site, and a
 * matcher wider than this list shadows a site page with the app's fallback.
 */
export const APP_OWNED_PREFIXES = [
	APP_BASE_PATH,
	...ROOT_OWNED_PREFIXES,
	...ROOT_OWNED_SERVICE_PREFIXES,
] as const;

/**
 * Whether `pathname` sits under `prefix` — the exact path, or something below
 * it.
 *
 * The boundary is the point: `/templates` and `/templates/x` are the app's,
 * `/templates-for-teams` is the site's. A bare `startsWith` would take the
 * third as well, and it would take it from the surface that has no way to know
 * it was taken.
 */
function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Whether `pathname` is a page this app renders — its own home and everything
 * below it, plus the root-level pages it kept.
 *
 * This is the SPA-fallback question: a path that answers `true` and names no
 * file gets `index.html`, because the client router will make a page of it. A
 * path that answers `false` is not this app's to answer at all.
 */
export function isAppPagePath(pathname: string): boolean {
	if (isUnder(pathname, APP_BASE_PATH)) return true;
	return ROOT_OWNED_PREFIXES.some((prefix) => isUnder(pathname, prefix));
}

/**
 * Whether `pathname` addresses this app at all — {@link isAppPagePath} plus the
 * API and the WebSocket.
 *
 * The predicate form of {@link APP_OWNED_PREFIXES}, for anything checking what
 * a proxy should have forwarded.
 */
export function isAppOwnedPath(pathname: string): boolean {
	if (isAppPagePath(pathname)) return true;
	return ROOT_OWNED_SERVICE_PREFIXES.some((prefix) => isUnder(pathname, prefix));
}

/**
 * The file this request addresses, relative to the built client directory — or
 * `null` when the path addresses no file of this app's.
 *
 * Only paths under {@link APP_ASSET_BASE} name a file, and that is the asset
 * half of the split: the build stamps `/app/assets/…` into the HTML, so a
 * request for `/assets/…` at the root is the *site's* bundle being asked for
 * here by mistake, and answering it with a same-named file of ours would serve
 * one product's JavaScript under the other's URL.
 *
 * The returned value keeps its leading slash so it can be joined onto the
 * static root; it is not sanitised here, because the only safe place to decide
 * whether a resolved path escaped its root is after resolving it (see
 * `server/routes/static.ts`).
 */
export function assetSubpath(pathname: string): string | null {
	if (!pathname.startsWith(APP_ASSET_BASE)) return null;
	return pathname.slice(APP_BASE_PATH.length);
}
