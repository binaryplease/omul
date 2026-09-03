/**
 * Integration tests for the Guess the Number question type (REQ039–REQ043).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ040/REQ043 — the authored range, step and reference round-trip through
 *     create → fetch, and bound what the vote endpoint will accept
 *   - REQ039 — the tally reports the distribution of estimates plus the summary
 *     statistics behind it
 *   - REQ041/REQ042 — a slide with no reference has no notion of correctness;
 *     one with a reference reports how many guesses landed inside the tolerance
 *   - one participant holds one guess, replaced on re-submission
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / mc /
 * ranking / grid / points harnesses.
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
		body: JSON.stringify({ title: "Guess Test", slides }),
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

/** Submit one participant's estimate. */
async function guess(
	presentationId: string,
	participantId: string,
	value: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId: "gn", value, participantId }),
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

/** Look up the column a given value falls in. */
function bucketFor(payload: AnyJson, value: number): AnyJson {
	return payload.buckets.find(
		(bucket: AnyJson) => value >= bucket.from && value <= bucket.to,
	);
}

/** A Guess the Number slide over 0–10 in whole numbers. */
function guessSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "gn",
		type: "guess-number",
		question: "How many countries are in the EU?",
		guessRange: { min: 0, max: 10, step: 1 },
		...overrides,
	};
}

describe("Guess the Number question type integration", () => {
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

	// ── REQ040/REQ042/REQ043 — what the organizer authored ─────

	test("the range, step and reference round-trip through create → fetch", async () => {
		const pres = await createAndStart([
			guessSlide({
				guessRange: { min: 1900, max: 2000, step: 5 },
				guessReference: { value: 1965, tolerance: 10 },
			}),
		]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].type).toBe("guess-number");
		expect(fetched.slides[0].guessRange).toEqual({
			min: 1900,
			max: 2000,
			step: 5,
		});
		expect(fetched.slides[0].guessReference).toEqual({
			value: 1965,
			tolerance: 10,
		});
	});

	test("a slide authored with no reference keeps an explicit null (REQ041)", async () => {
		const pres = await createAndStart([guessSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		// The key is present and null — the slide has no notion of
		// correctness, which a consumer must be able to see.
		expect("guessReference" in fetched.slides[0]).toBe(true);
		expect(fetched.slides[0].guessReference).toBe(null);
	});

	test("rejects an authored range with a fractional step at create (REQ043)", async () => {
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Bad frame",
				slides: [guessSlide({ guessRange: { min: 0, max: 10, step: 0.5 } })],
			}),
		});
		// Elysia rejects the body against CreatePresentationSchema before the route
		// runs, so a fractional step never reaches the store (422 is its validation
		// status; what matters is that the deck is not created).
		expect(res.status).toBe(422);
	});

	test("an empty results payload is well-formed before any guess lands", async () => {
		const pres = await createAndStart([guessSlide()]);
		const payload = await results(pres.id, "gn");
		expect(payload.type).toBe("guess-number");
		expect(payload.totalVotes).toBe(0);
		expect(payload.guessCount).toBe(0);
		expect(payload.range).toEqual({ min: 0, max: 10, step: 1 });
		// The frame is drawn before anybody guesses — one empty column per value.
		expect(payload.buckets).toHaveLength(11);
		expect(payload.buckets.every((bucket: AnyJson) => bucket.count === 0)).toBe(
			true,
		);
		// Every statistic is present and explicitly null, never omitted
		// and never a 0 that would read as an estimate somebody made.
		for (const key of [
			"lowestGuess",
			"highestGuess",
			"averageGuess",
			"medianGuess",
		]) {
			expect(key in payload).toBe(true);
			expect(payload[key]).toBe(null);
		}
	});

	// ── REQ039 — the distribution ──────────────────────────────

	test("guesses land in their column and report the room's spread", async () => {
		const pres = await createAndStart([guessSlide()]);
		expect((await guess(pres.id, "p1", "3")).status).toBe(200);
		expect((await guess(pres.id, "p2", "3")).status).toBe(200);
		expect((await guess(pres.id, "p3", "9")).status).toBe(200);

		const payload = await results(pres.id, "gn");
		expect(payload.guessCount).toBe(3);
		expect(bucketFor(payload, 3).count).toBe(2);
		expect(bucketFor(payload, 9).count).toBe(1);
		expect(bucketFor(payload, 0).count).toBe(0);
		// Two of three guesses sat on 3.
		expect(bucketFor(payload, 3).share).toBe(66.67);

		expect(payload.lowestGuess).toBe(3);
		expect(payload.highestGuess).toBe(9);
		expect(payload.averageGuess).toBe(5);
		expect(payload.medianGuess).toBe(3);
	});

	test("the median splits an even number of guesses between the middle two", async () => {
		const pres = await createAndStart([guessSlide()]);
		await guess(pres.id, "p1", "2");
		await guess(pres.id, "p2", "4");
		await guess(pres.id, "p3", "5");
		await guess(pres.id, "p4", "9");

		const payload = await results(pres.id, "gn");
		expect(payload.medianGuess).toBe(4.5);
		expect(payload.averageGuess).toBe(5);
	});

	test("a wide range groups its guesses into shared columns (REQ039)", async () => {
		const pres = await createAndStart([
			guessSlide({ guessRange: { min: 0, max: 1000, step: 1 } }),
		]);
		await guess(pres.id, "p1", "10");
		await guess(pres.id, "p2", "30");
		await guess(pres.id, "p3", "500");

		const payload = await results(pres.id, "gn");
		expect(payload.buckets.length).toBeLessThanOrEqual(24);
		// 10 and 30 fall in the same 42-wide column; 500 is elsewhere.
		expect(bucketFor(payload, 10)).toEqual(bucketFor(payload, 30));
		expect(bucketFor(payload, 10).count).toBe(2);
		expect(bucketFor(payload, 500).count).toBe(1);
	});

	// ── REQ040/REQ043 — the frame is enforced at the boundary ──

	test("rejects a guess above the authored range (REQ040)", async () => {
		const pres = await createAndStart([guessSlide()]);
		expect((await guess(pres.id, "p1", "11")).status).toBe(400);
		expect((await results(pres.id, "gn")).totalVotes).toBe(0);
	});

	test("rejects a guess below the authored range (REQ040)", async () => {
		const pres = await createAndStart([guessSlide()]);
		expect((await guess(pres.id, "p1", "-1")).status).toBe(400);
		expect((await results(pres.id, "gn")).totalVotes).toBe(0);
	});

	test("rejects a guess off the authored step grid (REQ043)", async () => {
		const pres = await createAndStart([
			guessSlide({ guessRange: { min: 0, max: 10, step: 2 } }),
		]);
		expect((await guess(pres.id, "p1", "5")).status).toBe(400);
		// Rejected outright, not snapped to 4 or 6 — an adjusted estimate is one
		// the participant never made.
		expect((await results(pres.id, "gn")).totalVotes).toBe(0);
		expect((await guess(pres.id, "p1", "6")).status).toBe(200);
	});

	test("rejects a non-numeric or fractional submission", async () => {
		const pres = await createAndStart([guessSlide()]);
		expect((await guess(pres.id, "p1", "seven")).status).toBe(400);
		expect((await guess(pres.id, "p1", "3.5")).status).toBe(400);
		expect((await results(pres.id, "gn")).totalVotes).toBe(0);
	});

	// ── REQ041/REQ042 — the reveal and the accepted window ─────

	test("a slide with no reference has no notion of correctness (REQ041)", async () => {
		const pres = await createAndStart([guessSlide()]);
		await guess(pres.id, "p1", "7");

		const payload = await results(pres.id, "gn");
		// All four travel together as null — distinct from "nobody was right".
		expect(payload.reference).toBe(null);
		expect(payload.tolerance).toBe(null);
		expect(payload.correctRange).toBe(null);
		expect(payload.correctCount).toBe(null);
		expect(payload.correctShare).toBe(null);
	});

	test("tolerance 0 accepts only the reference itself (REQ042)", async () => {
		const pres = await createAndStart([
			guessSlide({ guessReference: { value: 7, tolerance: 0 } }),
		]);
		await guess(pres.id, "p1", "6");
		await guess(pres.id, "p2", "7");
		await guess(pres.id, "p3", "8");

		const payload = await results(pres.id, "gn");
		expect(payload.reference).toBe(7);
		expect(payload.tolerance).toBe(0);
		expect(payload.correctRange).toEqual({ min: 7, max: 7 });
		expect(payload.correctCount).toBe(1);
		expect(payload.correctShare).toBe(33.33);
	});

	test("tolerance 1 accepts 6–8 — inclusive at both ends (REQ042)", async () => {
		const pres = await createAndStart([
			guessSlide({ guessReference: { value: 7, tolerance: 1 } }),
		]);
		await guess(pres.id, "p1", "5");
		await guess(pres.id, "p2", "6");
		await guess(pres.id, "p3", "8");
		await guess(pres.id, "p4", "9");

		const payload = await results(pres.id, "gn");
		expect(payload.correctRange).toEqual({ min: 6, max: 8 });
		// Both edges count; 5 and 9 do not.
		expect(payload.correctCount).toBe(2);
		expect(payload.correctShare).toBe(50);
	});

	test("a reference with no guesses yet reports zero correct and no share", async () => {
		const pres = await createAndStart([
			guessSlide({ guessReference: { value: 4, tolerance: 1 } }),
		]);
		const payload = await results(pres.id, "gn");
		expect(payload.correctCount).toBe(0);
		// A percentage of no responses does not exist.
		expect("correctShare" in payload).toBe(true);
		expect(payload.correctShare).toBe(null);
	});

	// ── One participant, one guess ─────────────────────────────

	test("re-guessing replaces the participant's estimate rather than adding one", async () => {
		const pres = await createAndStart([guessSlide()]);
		await guess(pres.id, "p1", "2");
		await guess(pres.id, "p1", "8");
		await guess(pres.id, "p2", "8");

		const payload = await results(pres.id, "gn");
		expect(payload.totalVotes).toBe(2);
		expect(payload.guessCount).toBe(2);
		expect(bucketFor(payload, 2).count).toBe(0);
		expect(bucketFor(payload, 8).count).toBe(2);
	});

	test("a stored guess is normalized to a canonical number", async () => {
		const pres = await createAndStart([guessSlide()]);
		expect((await guess(pres.id, "p1", " 07 ")).status).toBe(200);
		const payload = await results(pres.id, "gn");
		expect(payload.guessCount).toBe(1);
		expect(bucketFor(payload, 7).count).toBe(1);
	});

	test("a guess outside a narrowed range stops counting (REQ040)", async () => {
		const pres = await createAndStart([guessSlide()]);
		await guess(pres.id, "p1", "9");
		await guess(pres.id, "p2", "2");

		// The organizer narrows the range under the stored guesses. 9 is no longer
		// a number this slide offers, so it drops out of the distribution rather
		// than being plotted off the end of the axis.
		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [guessSlide({ guessRange: { min: 0, max: 5, step: 1 } })],
				}),
			},
		);
		expect(patch.status).toBe(200);

		const payload = await results(pres.id, "gn");
		expect(payload.totalVotes).toBe(2);
		expect(payload.guessCount).toBe(1);
		expect(payload.buckets).toHaveLength(6);
		expect(bucketFor(payload, 2).count).toBe(1);
	});
});
