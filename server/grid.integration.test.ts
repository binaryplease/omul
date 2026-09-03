/**
 * Integration tests for the 2x2 Grid question type (REQ046–REQ050).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ046/REQ047 — a participant places each item; the tally averages the
 *     coordinates per item and reports the placements behind that average
 *   - REQ048/REQ049 — the authored axes round-trip through create → fetch and
 *     are echoed with the results, and a point off the grid is rejected
 *   - REQ050 — an item may be marked "not assessable" only where the organizer
 *     allowed it, and a skip is counted rather than averaged
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / mc /
 * ranking harnesses.
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
		body: JSON.stringify({ title: "Grid Test", slides }),
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

/** Place one item at `(x, y)` for one participant. */
async function place(
	presentationId: string,
	participantId: string,
	itemId: string,
	x: number,
	y: number,
): Promise<Response> {
	return vote(presentationId, {
		slideId: "gd",
		statementId: itemId,
		value: `${x},${y}`,
		participantId,
	});
}

/** Mark one item not assessable for one participant (REQ050). */
async function skipItem(
	presentationId: string,
	participantId: string,
	itemId: string,
): Promise<Response> {
	return vote(presentationId, {
		slideId: "gd",
		statementId: itemId,
		value: "0,0",
		participantId,
		skip: true,
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

/** Look up one item's standing in a grid results payload. */
function itemIn(payload: AnyJson, itemId: string): AnyJson {
	return payload.items.find((item: AnyJson) => item.itemId === itemId);
}

/** A two-item grid slide on an Impact/Effort pair of axes. */
function gridSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "gd",
		type: "grid",
		question: "Position these initiatives",
		gridItems: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
		],
		gridXAxis: {
			title: "Effort",
			min: 0,
			max: 10,
			minLabel: "Low effort",
			maxLabel: "High effort",
		},
		gridYAxis: {
			title: "Impact",
			min: 0,
			max: 10,
			minLabel: "Low impact",
			maxLabel: "High impact",
		},
		...overrides,
	};
}

describe("2x2 Grid question type integration", () => {
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

	// ── REQ047, REQ048, REQ049 — what the organizer authored ───

	test("items and both labelled axes round-trip through create → fetch", async () => {
		const pres = await createAndStart([gridSlide()]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].type).toBe("grid");
		expect(fetched.slides[0].gridItems).toEqual([
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
		]);
		// REQ048/REQ049: titles, numeric endpoints and pole labels all survive.
		expect(fetched.slides[0].gridXAxis).toEqual({
			title: "Effort",
			min: 0,
			max: 10,
			minLabel: "Low effort",
			maxLabel: "High effort",
		});
		expect(fetched.slides[0].gridYAxis.title).toBe("Impact");
	});

	test("the results payload echoes both axes so the plot can be drawn (REQ048)", async () => {
		const pres = await createAndStart([gridSlide()]);
		const payload = await results(pres.id, "gd");
		expect(payload.type).toBe("grid");
		expect(payload.xAxis.title).toBe("Effort");
		expect(payload.yAxis.maxLabel).toBe("High impact");
		expect(payload.itemCount).toBe(2);
		expect(payload.allowSkip).toBe(false);
	});

	// ── REQ046, REQ047 — averaging coordinates per item ────────

	test("placements average into one coordinate per item (REQ047)", async () => {
		const pres = await createAndStart([gridSlide()]);
		await place(pres.id, "p1", "a", 2, 8);
		await place(pres.id, "p2", "a", 4, 6);
		await place(pres.id, "p1", "b", 9, 1);

		const payload = await results(pres.id, "gd");
		const alpha = itemIn(payload, "a");
		expect(alpha.placed).toBe(2);
		expect(alpha.averageX).toBe(3);
		expect(alpha.averageY).toBe(7);
		// The individual placements travel with the average, for the cluster.
		expect(alpha.placements).toEqual([
			{ x: 2, y: 8 },
			{ x: 4, y: 6 },
		]);
		const beta = itemIn(payload, "b");
		expect(beta.placed).toBe(1);
		expect(beta.averageX).toBe(9);
		expect(beta.averageY).toBe(1);
	});

	test("an average is reported to two decimals", async () => {
		const pres = await createAndStart([gridSlide()]);
		await place(pres.id, "p1", "a", 1, 0);
		await place(pres.id, "p2", "a", 2, 0);
		await place(pres.id, "p3", "a", 2, 0);

		const alpha = itemIn(await results(pres.id, "gd"), "a");
		expect(alpha.averageX).toBe(1.67);
	});

	test("re-placing an item replaces that participant's placement, not the item's", async () => {
		const pres = await createAndStart([gridSlide()]);
		await place(pres.id, "p1", "a", 1, 1);
		await place(pres.id, "p1", "a", 9, 9);
		await place(pres.id, "p2", "a", 5, 5);

		const alpha = itemIn(await results(pres.id, "gd"), "a");
		expect(alpha.placed).toBe(2);
		expect(alpha.averageX).toBe(7);
		expect(alpha.averageY).toBe(7);
	});

	test("items are answered independently — one placed, one left alone", async () => {
		const pres = await createAndStart([gridSlide()]);
		await place(pres.id, "p1", "a", 3, 3);

		const payload = await results(pres.id, "gd");
		const beta = itemIn(payload, "b");
		expect(beta.placed).toBe(0);
		// The keys are present and explicitly null — not omitted, and
		// not a 0,0 that would pin the item to the corner of the field.
		expect("averageX" in beta).toBe(true);
		expect(beta.averageX).toBe(null);
		expect(beta.averageY).toBe(null);
		expect(beta.placements).toEqual([]);
	});

	// ── REQ049 — a placement has to be a point on the grid ─────

	test("rejects a placement off the authored axes (REQ049)", async () => {
		const pres = await createAndStart([gridSlide()]);
		expect((await place(pres.id, "p1", "a", 11, 5)).status).toBe(400);
		expect((await place(pres.id, "p1", "a", 5, -1)).status).toBe(400);

		const payload = await results(pres.id, "gd");
		expect(itemIn(payload, "a").placed).toBe(0);
	});

	test("rejects a placement on an item the slide does not have", async () => {
		const pres = await createAndStart([gridSlide()]);
		expect((await place(pres.id, "p1", "nope", 3, 3)).status).toBe(400);
		expect((await results(pres.id, "gd")).totalVotes).toBe(0);
	});

	test("rejects a placement that names no item at all", async () => {
		const pres = await createAndStart([gridSlide()]);
		const res = await vote(pres.id, {
			slideId: "gd",
			value: "3,3",
			participantId: "p1",
		});
		expect(res.status).toBe(400);
		expect((await results(pres.id, "gd")).totalVotes).toBe(0);
	});

	test("an axis narrowed under a stored placement drops it from the average", async () => {
		const pres = await createAndStart([gridSlide()]);
		await place(pres.id, "p1", "a", 2, 2);
		await place(pres.id, "p2", "a", 9, 9);

		// The organizer re-authors the slide onto a 0–5 grid; the 9,9 placement is
		// no longer a point on it.
		const narrowed = gridSlide({
			gridXAxis: { title: "Effort", min: 0, max: 5 },
			gridYAxis: { title: "Impact", min: 0, max: 5 },
		});
		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ slides: [narrowed] }) },
		);
		expect(patch.status).toBe(200);

		const alpha = itemIn(await results(pres.id, "gd"), "a");
		expect(alpha.placed).toBe(1);
		expect(alpha.averageX).toBe(2);
	});

	// ── REQ050 — skippable items ───────────────────────────────

	test("a skip is refused unless the organizer allowed it (REQ050)", async () => {
		const pres = await createAndStart([gridSlide()]);
		expect((await skipItem(pres.id, "p1", "a")).status).toBe(400);
		expect((await results(pres.id, "gd")).totalVotes).toBe(0);
	});

	test("a skipped item is counted, never averaged (REQ050)", async () => {
		const pres = await createAndStart([gridSlide({ gridAllowSkip: true })]);
		await place(pres.id, "p1", "a", 8, 8);
		await skipItem(pres.id, "p2", "a");
		await skipItem(pres.id, "p3", "a");

		const payload = await results(pres.id, "gd");
		expect(payload.allowSkip).toBe(true);
		const alpha = itemIn(payload, "a");
		expect(alpha.placed).toBe(1);
		expect(alpha.skipped).toBe(2);
		expect(alpha.totalVotes).toBe(3);
		// The two "not assessable" answers do not drag the average toward 0,0.
		expect(alpha.averageX).toBe(8);
		expect(alpha.averageY).toBe(8);
	});

	test("a participant can place an item after skipping it", async () => {
		const pres = await createAndStart([gridSlide({ gridAllowSkip: true })]);
		await skipItem(pres.id, "p1", "a");
		await place(pres.id, "p1", "a", 4, 4);

		const alpha = itemIn(await results(pres.id, "gd"), "a");
		expect(alpha.totalVotes).toBe(1);
		expect(alpha.skipped).toBe(0);
		expect(alpha.placed).toBe(1);
		expect(alpha.averageX).toBe(4);
	});

	test("an empty results payload is well-formed before any vote lands", async () => {
		const pres = await createAndStart([gridSlide()]);
		const payload = await results(pres.id, "gd");
		expect(payload.totalVotes).toBe(0);
		expect(payload.items).toHaveLength(2);
		expect(
			payload.items.every(
				(item: AnyJson) =>
					item.averageX === null &&
					item.averageY === null &&
					item.placed === 0 &&
					item.skipped === 0,
			),
		).toBe(true);
	});
});
