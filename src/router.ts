import { useEffect } from "react";
import { APP_BASE_PATH } from "../server/app-paths";
import {
	KEPT_QUERY_PARAMS_META,
	keepsQueryParam,
	splitKeptQueryParams,
} from "../server/kept-query-params";
import { BRAND_NAME } from "./components/BrandMark";

// ── Client-side routing ──────────────────────────────────────
//
// Two path shapes live here, and the difference between them is the whole of
// REQ179. The app's *own* front door — the home page and the two dialogs that
// hang off it — sits under `APP_BASE_PATH`, because the host root belongs to
// the marketing site this app now shares a host with. Every page somebody is
// *sent* to keeps the root it has always had: `/join/:code` above all, which is
// read aloud to a room, but also the edit, preview, results and workspace links
// that are already in circulation. `server/app-paths.ts` is the one description
// of that split; this file only spells the routes on either side of it.

export type Route =
	| { page: "home" }
	| { page: "create" }
	/** The prebuilt-deck catalog (REQ005) — a page of its own, so it is linkable. */
	| { page: "templates" }
	/**
	 * Drafting a deck from a prompt (REQ007) — a page of its own for the reason
	 * the catalog next door has one: it is the second way a deck starts from
	 * something rather than from nothing, and both deserve a link to send
	 * somebody.
	 */
	| { page: "generate" }
	/**
	 * The workspaces this account is in (REQ128), and one of them. Two routes
	 * rather than a selection inside one page, for the reason the catalog and the
	 * generator have pages of their own: a workspace is a place a team works, and
	 * a place is something you send somebody a link to.
	 */
	| { page: "workspaces" }
	| { page: "workspace"; id: string }
	| { page: "edit"; id: string }
	| { page: "present"; id: string }
	| { page: "preview"; id: string }
	/**
	 * The deck's results, read-only and account-free (REQ098). A page of its own
	 * because that is what a shareable link points at: the presenter surface is a
	 * console with a projector on the other end of it, and handing somebody a
	 * results link must not hand them that.
	 */
	| { page: "results"; id: string }
	| { page: "join" }
	| { page: "participate"; code: string }
	/**
	 * The administrators' read of the feedback sent about omul (REQ185) — the
	 * first admin page. Under the base rather than at a root prefix of its own:
	 * nobody is *sent* this link, so it has no claim on the root, and a root
	 * prefix would have to be taught to every proxy in front of the app.
	 */
	| { page: "adminFeedback" };

/** Where the administrators' feedback page lives (REQ185). */
export const ADMIN_FEEDBACK_PATH = `${APP_BASE_PATH}/admin/feedback`;

/**
 * The route a URL names — the path and the hash, without the `#`.
 *
 * Split out of {@link getInitialRoute} so the shape of the split can be
 * asserted without a DOM: which paths kept the root and which moved under the
 * base is the thing REQ179 has to hold, and a rule only the browser can run is
 * one nothing checks.
 */
export function routeForLocation(path: string, hash: string): Route {
	if (path.startsWith("/preview/")) {
		return { page: "preview", id: path.split("/preview/")[1] };
	}
	if (path.startsWith("/results/")) {
		return { page: "results", id: path.split("/results/")[1] };
	}
	if (path.startsWith("/present/")) {
		return { page: "present", id: path.split("/present/")[1] };
	}
	if (path.startsWith("/edit/")) {
		return { page: "edit", id: path.split("/edit/")[1] };
	}
	if (path.startsWith("/join/")) {
		return { page: "participate", code: path.split("/join/")[1] };
	}
	if (path.startsWith("/workspaces/")) {
		return { page: "workspace", id: path.split("/workspaces/")[1] };
	}
	if (path === "/workspaces") return { page: "workspaces" };
	if (path === "/templates") return { page: "templates" };
	if (path === "/generate") return { page: "generate" };
	if (path === ADMIN_FEEDBACK_PATH) return { page: "adminFeedback" };
	if (hash === "create") return { page: "create" };
	if (hash === "join") return { page: "join" };
	return { page: "home" };
}

export function getInitialRoute(): Route {
	return routeForLocation(
		window.location.pathname,
		window.location.hash.slice(1),
	);
}

/**
 * The URL a route is written to the address bar as — the counterpart of
 * {@link routeForLocation}, and pure for the same reason.
 */
export function pathForRoute(route: Route): string {
	switch (route.page) {
		// The app's own front door and the two dialogs that open on it — the
		// routes the split moved, since `/` is the marketing site's now — and the
		// one page born under the base.
		case "home":
			return APP_BASE_PATH;
		case "create":
			return `${APP_BASE_PATH}#create`;
		case "join":
			return `${APP_BASE_PATH}#join`;
		case "adminFeedback":
			return ADMIN_FEEDBACK_PATH;
		// Everything below is a link somebody may already hold, so it stays where
		// it has always been.
		case "templates":
			return "/templates";
		case "generate":
			return "/generate";
		case "workspaces":
			return "/workspaces";
		case "workspace":
			return `/workspaces/${route.id}`;
		case "edit":
			return `/edit/${route.id}`;
		case "present":
			return `/present/${route.id}`;
		case "preview":
			return `/preview/${route.id}`;
		case "results":
			return `/results/${route.id}`;
		case "participate":
			return `/join/${route.code}`;
	}
}

/**
 * The query parameters this deployment keeps across navigation (REQ203), as the
 * server wrote them into the page — `[]` when it wrote none, which is the
 * default, and outside a browser.
 */
function keptQueryParamsFromPage(): string[] {
	if (typeof document === "undefined") return [];
	return splitKeptQueryParams(
		document
			.querySelector(`meta[name="${KEPT_QUERY_PARAMS_META}"]`)
			?.getAttribute("content"),
	);
}

/**
 * The part of a query string the address bar keeps across in-app navigation
 * (REQ203) — `?` and the parameters `keptQueryParams` names, or `""` when there
 * are none. Which ones those are is the operator's (`OMUL_KEPT_QUERY_PARAMS`,
 * `server/kept-query-params.ts`); unconfigured, nothing is kept.
 *
 * The parameters are kept as the raw `name=value` segments they arrived as, in
 * their order, rather than decoded and re-encoded: a round trip through
 * `URLSearchParams` would rewrite `%20` as `+`, and the values must leave as
 * they came. Pure given its list, so the rule can be asserted without a DOM.
 */
export function passThroughSearch(
	search: string,
	keptQueryParams: readonly string[] = keptQueryParamsFromPage(),
): string {
	return filterQuery(search, (name) => keepsQueryParam(keptQueryParams, name));
}

/**
 * A query string reduced to the raw `name=value` segments whose name `keep`
 * accepts, in their order and never re-encoded — `?` and those segments, or
 * `""` when none are left. The one place the app filters a query by hand, so
 * the pass-through rule and the landing clean-up in `auth.tsx` cannot drift.
 */
export function filterQuery(
	search: string,
	keep: (name: string) => boolean,
): string {
	const query = search.startsWith("?") ? search.slice(1) : search;
	const kept = query
		.split("&")
		.filter((segment) => segment !== "" && keep(segment.split("=")[0]));
	return kept.length > 0 ? `?${kept.join("&")}` : "";
}

/**
 * The URL a route is written to the address bar as, carrying the kept
 * parameters of `currentSearch` (REQ203). The query goes between the path and
 * the hash, so the hash dialogs keep it too.
 */
export function urlForRoute(
	route: Route,
	currentSearch: string,
	keptQueryParams: readonly string[] = keptQueryParamsFromPage(),
): string {
	const [path, hash] = pathForRoute(route).split("#");
	const fragment = hash === undefined ? "" : `#${hash}`;
	return `${path}${passThroughSearch(currentSearch, keptQueryParams)}${fragment}`;
}

export function navigate(route: Route) {
	window.history.pushState(
		null,
		"",
		urlForRoute(route, window.location.search),
	);
}

/**
 * The app's home page as an absolute URL, optionally carrying a query string.
 *
 * Absolute because the callers that need it are links followed from somewhere
 * this origin is not implied — a mail client opening a verification link, a
 * full page load after an account is deleted. One helper rather than an
 * `origin + "/"` at each of them, which is what put four of them on the
 * marketing site's front page the moment the base moved.
 */
export function appHomeUrl(search?: string): string {
	const query = search ? `?${search}` : "";
	return `${window.location.origin}${APP_BASE_PATH}${query}`;
}

/**
 * The tab's words. The product is named by its name alone (REQ167) — the mark
 * stands without a gloss, and so does the word.
 */
export function usePageTitle(title: string) {
	useEffect(() => {
		document.title = title ? `${title} - ${BRAND_NAME}` : BRAND_NAME;
	}, [title]);
}
