/**
 * Integration tests for the Ranking question type in task/ranking-question-type.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ033 — a participant submits one ordering; the tally turns a pile of
 *              orderings into one aggregated ranking (Borda points by position),
 *              and a re-submission replaces that participant's order rather than
 *              adding a second one
 *   - REQ034 — the authored item list round-trips through create → fetch, and
 *              the vote endpoint rejects submissions it cannot score (unknown
 *              item, repeated item, empty order)
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / mc
 * harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

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

async function createAndStart(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Ranking Test", slides }),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

async function vote(
	presentationId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Submit `order` (best first) as one participant's ranking. */
async function rank(
	presentationId: string,
	participantId: string,
	order: string[],
): Promise<Response> {
	return vote(presentationId, {
		slideId: "rk",
		value: order.join(","),
		participantId,
	});
}

async function results(
	presentationId: string,
	slideId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** Look up one item's standing in a ranking results payload. */
function itemIn(payload: AnyJson, itemId: string): AnyJson {
	return payload.items.find((item: AnyJson) => item.id === itemId);
}

/** A three-item ranking slide. */
function rankingSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "rk",
		type: "ranking",
		question: "Order these by priority",
		rankingItems: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		],
		...overrides,
	};
}

describe("Ranking question type integration", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes);

		app.listen({ port: 0, hostname: "127.0.0.1" });
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = {
			stop: () => bunServer.stop(true),
			hostname: bunServer.hostname,
			port: bunServer.port,
		};
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here — bun tears it
		// down with the process.
		await server?.stop();
	});

	// ── REQ034 — the authored item list ────────────────────────

	test("rankingItems round-trip through create → fetch (REQ034)", async () => {
		const pres = await createAndStart([rankingSlide()]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].type).toBe("ranking");
		expect(fetched.slides[0].rankingItems).toEqual([
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		]);
	});

	// ── REQ033 — aggregating orderings into one ranking ────────

	test("unanimous orderings produce that same ranking (REQ033)", async () => {
		const pres = await createAndStart([rankingSlide()]);
		await rank(pres.id, "p1", ["b", "a", "c"]);
		await rank(pres.id, "p2", ["b", "a", "c"]);

		const payload = await results(pres.id, "rk");
		expect(payload.type).toBe("ranking");
		expect(payload.ballots).toBe(2);
		expect(payload.itemCount).toBe(3);
		expect(payload.items.map((item: AnyJson) => item.id)).toEqual([
			"b",
			"a",
			"c",
		]);
		expect(payload.items.map((item: AnyJson) => item.rank)).toEqual([1, 2, 3]);
		// Three items, so first place is worth 3 points, second 2, third 1.
		expect(itemIn(payload, "b").points).toBe(6);
		expect(itemIn(payload, "a").points).toBe(4);
		expect(itemIn(payload, "c").points).toBe(2);
	});

	test("split orderings rank by total points, not by any one ballot", async () => {
		const pres = await createAndStart([rankingSlide()]);
		// A wins one first place; B is never first but never last either.
		await rank(pres.id, "p1", ["a", "b", "c"]);
		await rank(pres.id, "p2", ["c", "b", "a"]);
		await rank(pres.id, "p3", ["c", "b", "a"]);

		const payload = await results(pres.id, "rk");
		// C: 3+3+1 = 7, B: 2+2+2 = 6, A: 1+1+3 = 5.
		expect(payload.items.map((item: AnyJson) => item.id)).toEqual([
			"c",
			"b",
			"a",
		]);
		expect(itemIn(payload, "c").points).toBe(7);
		expect(itemIn(payload, "b").points).toBe(6);
		expect(itemIn(payload, "a").points).toBe(5);
		// Average position is reported on the 1-indexed scale the audience reads.
		expect(itemIn(payload, "b").averageRank).toBe(2);
	});

	test("re-submitting replaces that participant's ordering (REQ033)", async () => {
		const pres = await createAndStart([rankingSlide()]);
		await rank(pres.id, "p1", ["a", "b", "c"]);
		await rank(pres.id, "p1", ["c", "b", "a"]);

		const payload = await results(pres.id, "rk");
		// One person, one ballot — the first ordering is gone, not stacked.
		expect(payload.totalVotes).toBe(1);
		expect(payload.ballots).toBe(1);
		expect(payload.items[0].id).toBe("c");
		expect(itemIn(payload, "c").points).toBe(3);
		expect(itemIn(payload, "a").points).toBe(1);
	});

	// ── REQ034 — partial orderings and what is rejected ────────

	test("a partial ordering scores only what it placed (REQ034)", async () => {
		const pres = await createAndStart([rankingSlide()]);
		await rank(pres.id, "p1", ["a"]);
		await rank(pres.id, "p2", ["b", "c"]);

		const payload = await results(pres.id, "rk");
		expect(payload.ballots).toBe(2);
		// A was first on one ballot (3 points) and left off the other.
		expect(itemIn(payload, "a").points).toBe(3);
		expect(itemIn(payload, "a").rankedCount).toBe(1);
		expect(itemIn(payload, "a").notRanked).toBe(1);
		expect(itemIn(payload, "b").points).toBe(3);
		expect(itemIn(payload, "c").points).toBe(2);
	});

	test("an item nobody placed reports an explicit null average (ADR-0024)", async () => {
		const pres = await createAndStart([rankingSlide()]);
		await rank(pres.id, "p1", ["a", "b"]);

		const payload = await results(pres.id, "rk");
		const gamma = itemIn(payload, "c");
		expect(gamma.points).toBe(0);
		expect(gamma.rankedCount).toBe(0);
		expect(gamma.notRanked).toBe(1);
		// The key is present and explicitly null — not omitted, not a 0 that would
		// read as "everybody ranked it first".
		expect("averageRank" in gamma).toBe(true);
		expect(gamma.averageRank).toBe(null);
	});

	test("rejects an ordering naming an item the slide does not have", async () => {
		const pres = await createAndStart([rankingSlide()]);
		const res = await rank(pres.id, "p1", ["a", "nope"]);
		expect(res.status).toBe(400);

		const payload = await results(pres.id, "rk");
		expect(payload.ballots).toBe(0);
	});

	test("rejects an ordering that places the same item twice", async () => {
		const pres = await createAndStart([rankingSlide()]);
		const res = await rank(pres.id, "p1", ["a", "b", "a"]);
		expect(res.status).toBe(400);

		const payload = await results(pres.id, "rk");
		expect(payload.ballots).toBe(0);
	});

	test("an empty results payload is well-formed before any vote lands", async () => {
		const pres = await createAndStart([rankingSlide()]);
		const payload = await results(pres.id, "rk");
		expect(payload.ballots).toBe(0);
		expect(payload.totalVotes).toBe(0);
		expect(payload.items).toHaveLength(3);
		// Authored order stands in for a ranking nobody has voted on yet.
		expect(payload.items.map((item: AnyJson) => item.id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(
			payload.items.every((item: AnyJson) => item.points === 0),
		).toBe(true);
	});
});
