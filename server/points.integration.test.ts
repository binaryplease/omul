/**
 * Integration tests for the 100 Points question type (REQ044, REQ045).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ045 — the authored items round-trip through create → fetch
 *   - REQ044 — a participant distributes exactly 100 points; the tally sums
 *     them per item and reports the distribution behind that sum
 *   - REQ044 — a ballot that does not spend the whole budget is rejected at the
 *     boundary rather than stored, and one participant holds one budget
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / mc /
 * ranking / grid harnesses.
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
		body: JSON.stringify({ title: "Points Test", slides }),
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

/** Submit one participant's whole allocation as a single vote. */
async function allocate(
	presentationId: string,
	participantId: string,
	value: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId: "pt", value, participantId }),
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

/** Look up one item's standing in a 100 Points results payload. */
function itemIn(payload: AnyJson, itemId: string): AnyJson {
	return payload.items.find((item: AnyJson) => item.id === itemId);
}

/** A three-item 100 Points slide. */
function pointsSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "pt",
		type: "points",
		question: "Where should next quarter's budget go?",
		pointsItems: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		],
		...overrides,
	};
}

describe("100 Points question type integration", () => {
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

	// ── REQ045 — what the organizer authored ───────────────────

	test("the item list round-trips through create → fetch", async () => {
		const pres = await createAndStart([pointsSlide()]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].type).toBe("points");
		expect(fetched.slides[0].pointsItems).toEqual([
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		]);
	});

	test("an empty results payload is well-formed before any vote lands", async () => {
		const pres = await createAndStart([pointsSlide()]);
		const payload = await results(pres.id, "pt");
		expect(payload.type).toBe("points");
		expect(payload.totalVotes).toBe(0);
		expect(payload.ballots).toBe(0);
		expect(payload.budget).toBe(100);
		expect(payload.itemCount).toBe(3);
		expect(payload.totalPoints).toBe(0);
		expect(payload.items).toHaveLength(3);
		expect(
			payload.items.every(
				(item: AnyJson) =>
					item.points === 0 &&
					item.share === 0 &&
					item.funderCount === 0 &&
					item.notFunded === 0 &&
					item.averagePoints === null,
			),
		).toBe(true);
	});

	// ── REQ044 — the aggregated distribution ───────────────────

	test("allocations sum per item and rank the room's priorities", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect((await allocate(pres.id, "p1", "a:60,b:30,c:10")).status).toBe(200);
		expect((await allocate(pres.id, "p2", "a:50,b:50")).status).toBe(200);

		const payload = await results(pres.id, "pt");
		expect(payload.ballots).toBe(2);
		expect(payload.totalPoints).toBe(200);

		// Most points first — Alpha 110, Beta 80, Gamma 10.
		expect(payload.items.map((item: AnyJson) => item.id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(payload.items.map((item: AnyJson) => item.rank)).toEqual([1, 2, 3]);

		const alpha = itemIn(payload, "a");
		expect(alpha.points).toBe(110);
		expect(alpha.share).toBe(55);
		expect(alpha.funderCount).toBe(2);
		expect(alpha.notFunded).toBe(0);
		expect(alpha.averagePoints).toBe(55);

		// Gamma was funded by one of the two ballots — the average among its
		// funders is a different (and higher) reading than its share of the room.
		const gamma = itemIn(payload, "c");
		expect(gamma.points).toBe(10);
		expect(gamma.share).toBe(5);
		expect(gamma.funderCount).toBe(1);
		expect(gamma.notFunded).toBe(1);
		expect(gamma.averagePoints).toBe(10);
	});

	test("shares add up to the whole budget the room distributed", async () => {
		const pres = await createAndStart([pointsSlide()]);
		await allocate(pres.id, "p1", "a:34,b:33,c:33");
		await allocate(pres.id, "p2", "a:34,b:33,c:33");
		await allocate(pres.id, "p3", "a:34,b:33,c:33");

		const payload = await results(pres.id, "pt");
		expect(payload.totalPoints).toBe(300);
		const shareSum = payload.items.reduce(
			(sum: number, item: AnyJson) => sum + item.share,
			0,
		);
		expect(Math.round(shareSum)).toBe(100);
	});

	test("an item nobody funded reports an explicit null average (ADR-0024)", async () => {
		const pres = await createAndStart([pointsSlide()]);
		await allocate(pres.id, "p1", "a:50,b:50");
		await allocate(pres.id, "p2", "a:50,b:50");

		const gamma = itemIn(await results(pres.id, "pt"), "c");
		expect(gamma.points).toBe(0);
		expect(gamma.share).toBe(0);
		expect(gamma.funderCount).toBe(0);
		expect(gamma.notFunded).toBe(2);
		// The key is present and explicitly null — not omitted, and not a 0 that
		// would read as a deliberate zero from every participant.
		expect("averagePoints" in gamma).toBe(true);
		expect(gamma.averagePoints).toBe(null);
	});

	test("a share is reported to two decimals", async () => {
		const pres = await createAndStart([pointsSlide()]);
		await allocate(pres.id, "p1", "a:33,b:33,c:34");
		await allocate(pres.id, "p2", "a:33,b:33,c:34");
		await allocate(pres.id, "p3", "a:33,b:33,c:34");

		expect(itemIn(await results(pres.id, "pt"), "a").share).toBe(33);
		// 100 of 300 points → 33.33%, not 33.333333333333336.
		await allocate(pres.id, "p4", "a:1,b:0,c:99");
		const alpha = itemIn(await results(pres.id, "pt"), "a");
		expect(alpha.points).toBe(100);
		expect(alpha.share).toBe(25);
	});

	test("a tie breaks on the broader backing, then the authored order", async () => {
		const pres = await createAndStart([pointsSlide()]);
		// Alpha and Beta both end on 50, but two people funded Beta and one
		// funded Alpha — the broader backing ranks first.
		await allocate(pres.id, "p1", "a:50,b:25,c:25");
		await allocate(pres.id, "p2", "b:25,c:75");

		const payload = await results(pres.id, "pt");
		expect(itemIn(payload, "a").points).toBe(50);
		expect(itemIn(payload, "b").points).toBe(50);
		expect(itemIn(payload, "b").rank).toBeLessThan(itemIn(payload, "a").rank);
	});

	// ── REQ044 — the budget is forced, at the boundary ─────────

	test("rejects an under-spent ballot (REQ044)", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect((await allocate(pres.id, "p1", "a:30,b:30")).status).toBe(400);
		expect((await results(pres.id, "pt")).totalVotes).toBe(0);
	});

	test("rejects an over-spent ballot (REQ044)", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect((await allocate(pres.id, "p1", "a:60,b:60")).status).toBe(400);
		expect((await results(pres.id, "pt")).totalVotes).toBe(0);
	});

	test("rejects an allocation naming an item the slide does not have", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect((await allocate(pres.id, "p1", "a:50,zz:50")).status).toBe(400);
		expect((await results(pres.id, "pt")).totalVotes).toBe(0);
	});

	test("rejects the same item funded twice in one ballot", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect((await allocate(pres.id, "p1", "a:60,a:40")).status).toBe(400);
		expect((await results(pres.id, "pt")).totalVotes).toBe(0);
	});

	// ── REQ044 — one participant, one budget ───────────────────

	test("re-allocating replaces the participant's budget rather than adding one", async () => {
		const pres = await createAndStart([pointsSlide()]);
		await allocate(pres.id, "p1", "a:100");
		await allocate(pres.id, "p1", "c:100");
		await allocate(pres.id, "p2", "a:100");

		const payload = await results(pres.id, "pt");
		expect(payload.totalVotes).toBe(2);
		expect(payload.ballots).toBe(2);
		expect(payload.totalPoints).toBe(200);
		expect(itemIn(payload, "a").points).toBe(100);
		expect(itemIn(payload, "c").points).toBe(100);
		expect(itemIn(payload, "a").funderCount).toBe(1);
	});

	test("a stored allocation is normalized — canonical order, zeros dropped", async () => {
		const pres = await createAndStart([pointsSlide()]);
		expect(
			(await allocate(pres.id, "p1", " c : 20 , a : 80 , b : 0 ")).status,
		).toBe(200);

		const payload = await results(pres.id, "pt");
		expect(payload.ballots).toBe(1);
		expect(itemIn(payload, "a").points).toBe(80);
		expect(itemIn(payload, "c").points).toBe(20);
		expect(itemIn(payload, "b").funderCount).toBe(0);
	});

	test("an item dropped under a stored allocation drops the whole ballot", async () => {
		const pres = await createAndStart([pointsSlide()]);
		await allocate(pres.id, "p1", "a:50,c:50");
		await allocate(pres.id, "p2", "a:100");

		// The organizer re-authors the slide without Gamma. p1's budget no longer
		// sums to 100 over the items that remain, so it stops counting entirely
		// rather than being read as a half-spent one.
		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						pointsSlide({
							pointsItems: [
								{ id: "a", text: "Alpha" },
								{ id: "b", text: "Beta" },
							],
						}),
					],
				}),
			},
		);
		expect(patch.status).toBe(200);

		const payload = await results(pres.id, "pt");
		expect(payload.totalVotes).toBe(2);
		expect(payload.ballots).toBe(1);
		expect(payload.totalPoints).toBe(100);
		expect(itemIn(payload, "a").points).toBe(100);
	});
});
