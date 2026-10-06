/**
 * Integration tests for the session clock (REQ108), over the real HTTP surface.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - going live stamps `sessionStartedAt`, and a second start while live keeps
 *     it rather than restarting the clock
 *   - ending stamps `sessionEndedAt`, so the displayed duration stops there
 *   - a reset clears both, so the next run is timed from its own start
 *   - the stamps survive a fresh read of the deck (a presenter page refresh)
 *     and cannot be written through the deck PATCH
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API response is loosely typed
type AnyJson = any;

async function authed(
	path: string,
	token: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			Authorization: `Bearer ${token}`,
		},
	});
}

async function createDeck(): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Session Clock Test",
			slides: [
				{
					id: "s1",
					type: "multiple-choice",
					question: "Ready?",
					options: [
						{ id: "s1-a", text: "Yes" },
						{ id: "s1-b", text: "No" },
					],
				},
			],
		}),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

/** Move the deck through one of its lifecycle routes, returning the deck. */
async function transition(
	pres: AnyJson,
	action: "start" | "end" | "reset",
): Promise<AnyJson> {
	const res = await authed(
		`/api/presentations/${pres.id}/${action}`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The deck as its presenter re-reads it — what a page refresh fetches. */
async function reread(pres: AnyJson): Promise<AnyJson> {
	const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("the session clock (REQ108)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia().use(presentationRoutes);
		app.listen({ port: 0, hostname: "127.0.0.1" });
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("a draft deck has no session recorded", async () => {
		const pres = await createDeck();
		expect(pres.sessionStartedAt).toBeNull();
		expect(pres.sessionEndedAt).toBeNull();
	});

	test("going live stamps the start, and a refresh reads the same instant", async () => {
		const pres = await createDeck();
		const before = Date.now();
		const live = await transition(pres, "start");
		const after = Date.now();

		const startedMs = Date.parse(live.sessionStartedAt);
		expect(startedMs).toBeGreaterThanOrEqual(before);
		expect(startedMs).toBeLessThanOrEqual(after);
		expect(live.sessionEndedAt).toBeNull();

		const refreshed = await reread(pres);
		expect(refreshed.sessionStartedAt).toBe(live.sessionStartedAt);
		expect(refreshed.sessionEndedAt).toBeNull();
	});

	test("starting a deck that is already live keeps its clock", async () => {
		const pres = await createDeck();
		const first = await transition(pres, "start");
		await Bun.sleep(5);
		const again = await transition(pres, "start");
		expect(again.sessionStartedAt).toBe(first.sessionStartedAt);
	});

	test("ending stamps where the clock stops, and ending again keeps it", async () => {
		const pres = await createDeck();
		const live = await transition(pres, "start");
		await Bun.sleep(5);
		const ended = await transition(pres, "end");

		expect(ended.status).toBe("ended");
		expect(ended.sessionStartedAt).toBe(live.sessionStartedAt);
		expect(Date.parse(ended.sessionEndedAt)).toBeGreaterThanOrEqual(
			Date.parse(live.sessionStartedAt),
		);

		await Bun.sleep(5);
		const endedAgain = await transition(pres, "end");
		expect(endedAgain.sessionEndedAt).toBe(ended.sessionEndedAt);
		expect((await reread(pres)).sessionEndedAt).toBe(ended.sessionEndedAt);
	});

	test("going live again after an end begins a fresh session", async () => {
		const pres = await createDeck();
		const first = await transition(pres, "start");
		await transition(pres, "end");
		await Bun.sleep(5);
		const second = await transition(pres, "start");

		expect(second.sessionEndedAt).toBeNull();
		expect(Date.parse(second.sessionStartedAt)).toBeGreaterThan(
			Date.parse(first.sessionStartedAt),
		);
	});

	test("a reset clears the clock with the rest of the run", async () => {
		const pres = await createDeck();
		await transition(pres, "start");
		await transition(pres, "end");
		const reset = await transition(pres, "reset");

		expect(reset.sessionStartedAt).toBeNull();
		expect(reset.sessionEndedAt).toBeNull();
		const refreshed = await reread(pres);
		expect(refreshed.sessionStartedAt).toBeNull();
		expect(refreshed.sessionEndedAt).toBeNull();
	});

	test("a deck PATCH cannot write the clock", async () => {
		const pres = await createDeck();
		const live = await transition(pres, "start");

		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					title: "Renamed mid-session",
					sessionStartedAt: "2000-01-01T00:00:00.000Z",
					sessionEndedAt: "2000-01-01T00:00:01.000Z",
				}),
			},
		);
		expect(patched.status).toBe(200);
		const deck = await patched.json();
		expect(deck.title).toBe("Renamed mid-session");
		expect(deck.sessionStartedAt).toBe(live.sessionStartedAt);
		expect(deck.sessionEndedAt).toBeNull();
	});
});
