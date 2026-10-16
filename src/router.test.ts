/**
 * The client half of the path split this app shares its host under (REQ179).
 *
 * `routeForLocation` and `pathForRoute` are the two directions of the same
 * rule, and they are asserted as a pair because the failure that matters is
 * asymmetric: a route that *reads* `/join/:code` but *writes* `/app/join/:code`
 * moves the join link the moment somebody navigates rather than arrives, which
 * is exactly the link the split exists to keep where it is.
 *
 * The server's half — which of these paths it answers, and with what — is in
 * `server/app-paths.test.ts`; both read the same descriptor.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { APP_BASE_PATH, isAppPagePath } from "../server/app-paths";
import {
	KEPT_QUERY_PARAMS_META,
	LANDING_QUERY_PARAMS,
} from "../server/kept-query-params";
import {
	filterQuery,
	navigate,
	passThroughSearch,
	pathForRoute,
	type Route,
	routeForLocation,
} from "./router";

/** Every route the app has, with the URL it is written to the bar as. */
const ROUTES: ReadonlyArray<[Route, string]> = [
	[{ page: "home" }, APP_BASE_PATH],
	[{ page: "create" }, `${APP_BASE_PATH}#create`],
	[{ page: "join" }, `${APP_BASE_PATH}#join`],
	[{ page: "templates" }, "/templates"],
	[{ page: "generate" }, "/generate"],
	[{ page: "workspaces" }, "/workspaces"],
	[{ page: "workspace", id: "team-1" }, "/workspaces/team-1"],
	[{ page: "edit", id: "deck-1" }, "/edit/deck-1"],
	[{ page: "present", id: "deck-1" }, "/present/deck-1"],
	[{ page: "preview", id: "deck-1" }, "/preview/deck-1"],
	[{ page: "results", id: "deck-1" }, "/results/deck-1"],
	[{ page: "participate", code: "1234" }, "/join/1234"],
	[{ page: "adminFeedback" }, `${APP_BASE_PATH}/admin/feedback`],
];

describe("the join link stays at the host root", () => {
	test("a spoken join link reads as a participate route", () => {
		expect(routeForLocation("/join/1234", "")).toEqual({
			page: "participate",
			code: "1234",
		});
	});

	test("and navigating to one writes that same root path back", () => {
		expect(pathForRoute({ page: "participate", code: "1234" })).toBe(
			"/join/1234",
		);
	});
});

describe("the app's own front door moved under the base", () => {
	test("home, and the two dialogs that open on it", () => {
		expect(routeForLocation(APP_BASE_PATH, "")).toEqual({ page: "home" });
		expect(routeForLocation(`${APP_BASE_PATH}/`, "")).toEqual({ page: "home" });
		expect(routeForLocation(APP_BASE_PATH, "create")).toEqual({
			page: "create",
		});
		expect(routeForLocation(APP_BASE_PATH, "join")).toEqual({ page: "join" });
	});

	test("nothing is written to the host root any more", () => {
		for (const [route] of ROUTES) {
			expect(pathForRoute(route)).not.toBe("/");
			expect(pathForRoute(route).startsWith("/#")).toBe(false);
		}
	});
});

describe("the administrators' feedback page lives under the base (REQ185)", () => {
	test("it is /app/admin/feedback, and nothing at the root claims /admin", () => {
		expect(pathForRoute({ page: "adminFeedback" })).toBe("/app/admin/feedback");
		expect(routeForLocation("/app/admin/feedback", "")).toEqual({
			page: "adminFeedback",
		});
		// A root-level /admin is the marketing site's: no proxy in front of the
		// app was taught it, so the page must not be reachable there.
		expect(isAppPagePath("/admin/feedback")).toBe(false);
		expect(routeForLocation("/admin/feedback", "")).toEqual({ page: "home" });
	});
});

describe("every route round-trips, and lands on a path the server serves", () => {
	for (const [route, path] of ROUTES) {
		test(`${route.page} is written as ${path}`, () => {
			expect(pathForRoute(route)).toBe(path);
			// The hash is the client's alone; the server only ever sees the path.
			const [pathname, hash = ""] = path.split("#");
			expect(routeForLocation(pathname, hash)).toEqual(route);
			// And that path is one the app claims, so it is not the marketing
			// site's to answer.
			expect(isAppPagePath(pathname)).toBe(true);
		});
	}
});

describe("the operator's kept query parameters survive in-app navigation (REQ203)", () => {
	const originalWindow = globalThis.window;
	const originalDocument = globalThis.document;

	/**
	 * Just enough of a browser for `navigate`: an address bar, and a
	 * `pushState` that writes to it the way the real one does.
	 */
	function stubAddressBar(start: string): { readonly current: URL } {
		const bar = { current: new URL(start, "https://omul.test") };
		globalThis.window = {
			get location() {
				return bar.current;
			},
			history: {
				pushState(_state: unknown, _unused: string, url: string) {
					bar.current = new URL(url, bar.current);
				},
			},
		} as unknown as Window & typeof globalThis;
		return bar;
	}

	/**
	 * The page as the server hands it out: with the kept-parameters tag when
	 * `content` is given, without one when it is `null`.
	 */
	function stubPage(content: string | null): void {
		globalThis.document = {
			querySelector(selector: string) {
				if (content === null) return null;
				if (selector !== `meta[name="${KEPT_QUERY_PARAMS_META}"]`) return null;
				return { getAttribute: (name: string) => (name === "content" ? content : null) };
			},
		} as unknown as Document;
	}

	afterEach(() => {
		globalThis.window = originalWindow;
		globalThis.document = originalDocument;
	});

	const VISITS: Route[] = [
		{ page: "create" },
		{ page: "home" },
		{ page: "join" },
		{ page: "templates" },
		{ page: "edit", id: "deck-1" },
		{ page: "participate", code: "1234" },
		{ page: "workspace", id: "team-1" },
		{ page: "home" },
	];

	const ARRIVAL = `${APP_BASE_PATH}/?campaign_source=news%20letter&mode=x&ref=hero+cta&campaign_name=launch&other=1`;

	test("every route keeps exactly the configured ones, values unchanged", () => {
		stubPage("ref,campaign_*");
		const bar = stubAddressBar(ARRIVAL);
		const kept = "?campaign_source=news%20letter&ref=hero+cta&campaign_name=launch";
		for (const route of VISITS) {
			navigate(route);
			expect(bar.current.search).toBe(kept);
			// The route itself is unchanged — the query sits between path and hash.
			expect(routeForLocation(bar.current.pathname, bar.current.hash.slice(1)))
				.toEqual(route);
		}
		navigate({ page: "create" });
		expect(`${bar.current.pathname}${bar.current.search}${bar.current.hash}`)
			.toBe(`${APP_BASE_PATH}${kept}#create`);
	});

	test("a page without the tag keeps nothing — the default", () => {
		stubPage(null);
		const bar = stubAddressBar(ARRIVAL);
		for (const route of VISITS) {
			navigate(route);
			expect(bar.current.search).toBe("");
			expect(bar.current.href).not.toContain("?");
		}
	});

	test("a URL without the configured ones gains no query", () => {
		stubPage("ref,campaign_*");
		const bar = stubAddressBar(`${APP_BASE_PATH}?mode=verify-email&other=1`);
		for (const route of VISITS) {
			navigate(route);
			expect(bar.current.search).toBe("");
			expect(bar.current.href).not.toContain("?");
		}
	});

	test("only what the list names is passed through", () => {
		const entries = ["ref", "campaign_*"];
		expect(passThroughSearch("", entries)).toBe("");
		expect(passThroughSearch("?", entries)).toBe("");
		expect(passThroughSearch("?referrer=a&campaign=b&xcampaign_c=d&mode=e", entries))
			.toBe("");
		expect(passThroughSearch("?ref=&campaign_=x", entries)).toBe("?ref=&campaign_=x");
		expect(passThroughSearch("token=t&ref=a%2Fb", entries)).toBe("?ref=a%2Fb");
		expect(passThroughSearch("?ref=a&campaign_b=c", [])).toBe("");
	});

	test("an auth landing's parameters are never passed through, whatever the list", () => {
		expect(
			passThroughSearch("?mode=reset-password&token=t&error=X&ref=a", [
				...LANDING_QUERY_PARAMS,
				"ref",
			]),
		).toBe("?ref=a");
	});

	test("a filtered query keeps the segments it leaves raw", () => {
		// The landing clean-up in auth.tsx drops mode/token/error this way; the
		// kept parameters it leaves must not be re-encoded.
		const withoutLanding = (name: string) => !LANDING_QUERY_PARAMS.includes(name);
		expect(
			filterQuery(
				"?mode=verify-email&campaign_source=news%20letter&error=X&ref=a+b&token=t",
				withoutLanding,
			),
		).toBe("?campaign_source=news%20letter&ref=a+b");
		expect(filterQuery("?mode=verify-email&error=X", withoutLanding)).toBe("");
		expect(filterQuery("", withoutLanding)).toBe("");
	});
});
