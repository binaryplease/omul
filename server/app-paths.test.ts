/**
 * The path split this app shares its host under (REQ179) — the descriptor in
 * `server/app-paths.ts` and the static handler that acts on it.
 *
 * What these cover is one sentence and its consequences: the app moved its own
 * front door to `/app` so the marketing site could have the host root, and
 * `/join/1234` did **not** move, because that link is read aloud to a room and
 * is the entire reason the split exists. Everything below is that sentence made
 * checkable — which paths still answer at the root, which assets moved, and
 * what the app now refuses to answer for, since a fallback that answers
 * everything is the app quietly shadowing whatever the site put there.
 *
 * The handler half runs against a fixture directory rather than a built
 * `dist/client/`, so it asserts the decision (file / fallback / redirect / 404)
 * without a build having to have happened first.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	APP_ASSET_BASE,
	APP_BASE_PATH,
	APP_OWNED_PREFIXES,
	assetSubpath,
	isAppOwnedPath,
	isAppPagePath,
	ROOT_OWNED_PREFIXES,
	ROOT_OWNED_SERVICE_PREFIXES,
} from "./app-paths";
import { serveStatic } from "./routes/static";

describe("which paths this app owns on a shared host", () => {
	test("the join link keeps the host root — the whole point of the split", () => {
		expect(isAppPagePath("/join/1234")).toBe(true);
		expect(APP_OWNED_PREFIXES).toContain("/join");
	});

	test("every page somebody may already hold a link to keeps the root", () => {
		for (const pathname of [
			"/join/1234",
			"/present/deck-1",
			"/preview/deck-1",
			"/results/deck-1",
			"/edit/deck-1",
			"/workspaces",
			"/workspaces/team-1",
			"/templates",
			"/generate",
		]) {
			expect(isAppPagePath(pathname)).toBe(true);
		}
	});

	test("the app's own home and everything under it is the base", () => {
		expect(isAppPagePath(APP_BASE_PATH)).toBe(true);
		expect(isAppPagePath(APP_ASSET_BASE)).toBe(true);
		expect(isAppPagePath("/app/assets/index.js")).toBe(true);
	});

	test("the host root is not the app's", () => {
		expect(isAppPagePath("/")).toBe(false);
		expect(isAppOwnedPath("/")).toBe(false);
	});

	test("a marketing path that merely starts with an app prefix is the site's", () => {
		// The boundary, not the prefix: taking `/templates-for-teams` would take it
		// from a surface with no way to notice it had been taken.
		for (const pathname of [
			"/templates-for-teams",
			"/joining-a-session",
			"/editorial",
			"/generated",
			"/apps",
			"/preise",
			"/blog",
			"/en",
		]) {
			expect(isAppPagePath(pathname)).toBe(false);
			expect(isAppOwnedPath(pathname)).toBe(false);
		}
	});

	test("the API and the WebSocket are owned but are not pages", () => {
		for (const pathname of ["/api", "/api/health", "/api/docs", "/ws"]) {
			expect(isAppPagePath(pathname)).toBe(false);
			expect(isAppOwnedPath(pathname)).toBe(true);
		}
	});

	test("the proxy list is the base plus the pages plus the services", () => {
		expect([...APP_OWNED_PREFIXES]).toEqual([
			APP_BASE_PATH,
			...ROOT_OWNED_PREFIXES,
			...ROOT_OWNED_SERVICE_PREFIXES,
		]);
	});
});

describe("which requests name a file of this app's", () => {
	test("assets are addressed under the base, where the build stamps them", () => {
		expect(assetSubpath("/app/assets/index.js")).toBe("/assets/index.js");
		expect(assetSubpath("/app/brand/omul-icon-ring.svg")).toBe(
			"/brand/omul-icon-ring.svg",
		);
	});

	test("a root-level asset URL is the marketing site's, not ours", () => {
		// Both products build into a directory called `assets`. Answering this one
		// would serve our JavaScript under the site's address.
		expect(assetSubpath("/assets/index.js")).toBeNull();
		expect(assetSubpath("/brand/omul-icon-ring.svg")).toBeNull();
	});

	test("a page path names no file", () => {
		expect(assetSubpath("/join/1234")).toBeNull();
		expect(assetSubpath("/")).toBeNull();
	});
});

describe("what the server answers, against a built client directory", () => {
	let fixtureRoot = "";
	let staticDir = "";

	beforeAll(() => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "omul-static-"));
		staticDir = join(fixtureRoot, "client");
		mkdirSync(join(staticDir, "assets"), { recursive: true });
		mkdirSync(join(staticDir, "brand"), { recursive: true });
		writeFileSync(join(staticDir, "index.html"), "<!doctype html><html></html>");
		writeFileSync(join(staticDir, "assets", "index.js"), "export {};");
		writeFileSync(join(staticDir, "brand", "ring.svg"), "<svg></svg>");
		// The escape target: a file beside the static root, which a traversal would
		// reach and a contained resolution must not.
		writeFileSync(join(fixtureRoot, "omul-secret-neighbour"), "secret");
	});

	afterAll(() => {
		rmSync(fixtureRoot, { recursive: true, force: true });
	});

	test("the app's home page is served under the base", async () => {
		for (const pathname of [APP_BASE_PATH, APP_ASSET_BASE]) {
			const response = await serveStatic(pathname, staticDir);
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("text/html");
		}
	});

	test("a join link is answered with the app, at the root, unchanged", async () => {
		const response = await serveStatic("/join/1234", staticDir);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html");
	});

	test("built assets are served from under the base", async () => {
		const script = await serveStatic("/app/assets/index.js", staticDir);
		expect(script.status).toBe(200);
		expect(script.headers.get("Content-Type")).toBe("application/javascript");
		const signet = await serveStatic("/app/brand/ring.svg", staticDir);
		expect(signet.status).toBe(200);
		expect(signet.headers.get("Content-Type")).toBe("image/svg+xml");
	});

	test("the same asset asked for at the root is not served", async () => {
		const response = await serveStatic("/assets/index.js", staticDir);
		expect(response.status).toBe(404);
	});

	test("the host root points at the app rather than answering as it", async () => {
		// A shared host never routes `/` here at all; a standalone deployment has
		// no site in front, and the visitor typing the bare host wants the app.
		const response = await serveStatic("/", staticDir);
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(APP_ASSET_BASE);
	});

	test("a path the app does not own is not answered with the app", async () => {
		for (const pathname of ["/preise", "/blog", "/en", "/templates-for-teams"]) {
			const response = await serveStatic(pathname, staticDir);
			expect(response.status).toBe(404);
		}
	});

	test("a traversal out of the static root is refused", async () => {
		for (const pathname of [
			"/app/../omul-secret-neighbour",
			"/app/assets/../../omul-secret-neighbour",
			// The same walk written so the router never sees a segment boundary:
			// `%2f` is a slash the path was not split on, which is why the check
			// runs on the decoded path rather than the requested one.
			"/app/..%2fomul-secret-neighbour",
			"/app/assets/..%2f..%2fomul-secret-neighbour",
		]) {
			const response = await serveStatic(pathname, staticDir);
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("secret");
		}
	});

	test("a malformed percent-escape is refused rather than guessed at", async () => {
		const response = await serveStatic("/app/assets/%E0%A4%A.js", staticDir);
		expect(response.status).toBe(404);
	});
});
