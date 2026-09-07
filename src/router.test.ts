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

import { describe, expect, test } from "bun:test";
import { APP_BASE_PATH, isAppPagePath } from "../server/app-paths";
import { pathForRoute, type Route, routeForLocation } from "./router";

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
