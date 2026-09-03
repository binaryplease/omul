/**
 * Integration tests for the Multiple Choice question-type settings in
 * task/0012-multiple-choice-settings.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ010 / REQ011 — the visualization and value-display settings survive a
 *     round-trip through create → fetch (they drive rendering, not aggregation)
 *   - REQ013 — correct answers surface in results for a plain choice slide, and
 *     stay an explicit `null` for a slide whose author marked nothing
 *   - REQ014 — server-side enforcement of the per-participant selection limit:
 *     single choice replaces, multi-select accumulates, re-submitting an option
 *     deselects it, and a submission past the cap is rejected. Also pins the
 *     percentage basis: `respondentCount` counts people, `totalVotes` counts
 *     selections, so a multi-select tally divides by the head count.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
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
		body: JSON.stringify({ title: "MC Test", slides }),
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

/** Look up an option's tally in a choice results payload. */
function countFor(payload: AnyJson, optionId: string): number {
	return payload.options.find((opt: AnyJson) => opt.id === optionId)?.count;
}

/** A three-option multiple-choice slide. */
function mcSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "mc",
		type: "multiple-choice",
		question: "Which apply?",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
			{ id: "c", text: "C" },
		],
		...overrides,
	};
}

describe("Multiple Choice settings integration", () => {
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

	// ── REQ010 / REQ011 ────────────────────────────────────────

	test("visualization and value-display settings round-trip (REQ010, REQ011)", async () => {
		const pres = await createAndStart([
			mcSlide({ mcDisplayStyle: "donut", mcValueDisplay: "percentage" }),
		]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].mcDisplayStyle).toBe("donut");
		expect(fetched.slides[0].mcValueDisplay).toBe("percentage");
	});

	test("a slide stored without the new settings reads back with the old behaviour", async () => {
		const pres = await createAndStart([mcSlide()]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.slides[0].mcDisplayStyle).toBe("bars");
		expect(fetched.slides[0].mcValueDisplay).toBe("both");
		expect(fetched.slides[0].mcMaxSelections).toBe(null);
	});

	// ── REQ013 ─────────────────────────────────────────────────

	test("correct answers surface in results for a plain choice slide (REQ013)", async () => {
		const pres = await createAndStart([
			mcSlide({
				options: [
					{ id: "a", text: "A", isCorrect: true },
					{ id: "b", text: "B" },
					{ id: "c", text: "C", isCorrect: true },
				],
			}),
		]);
		const payload = await results(pres.id, "mc");
		expect(payload.options.map((opt: AnyJson) => opt.isCorrect)).toEqual([
			true,
			false,
			true,
		]);
	});

	test("a choice slide with no marked answer emits isCorrect: null (REQ013)", async () => {
		const pres = await createAndStart([mcSlide()]);
		const payload = await results(pres.id, "mc");
		for (const option of payload.options) {
			expect(option).toHaveProperty("isCorrect");
			expect(option.isCorrect).toBe(null);
		}
	});

	test("a quiz withholds isCorrect from the room while the question runs (REQ056)", async () => {
		const pres = await createAndStart([
			{
				id: "qz",
				type: "quiz",
				question: "Guess",
				options: [
					{ id: "a", text: "A" },
					{ id: "b", text: "B" },
				],
			},
		]);
		// A quiz always has a notion of correctness — but the tally an unauthorized
		// caller reads while the question is open must not say which option holds
		// it, so `isCorrect` is the same explicit `null` an unmarked choice slide
		// emits. The editor's own view of the same tally is asserted in
		// quiz.integration.test.ts.
		const payload = await results(pres.id, "qz");
		expect(payload.options.map((opt: AnyJson) => opt.isCorrect)).toEqual([
			null,
			null,
		]);
	});

	// ── REQ014 — selection limit enforcement ───────────────────

	test("single choice still replaces the participant's vote (REQ014 default)", async () => {
		const pres = await createAndStart([mcSlide()]);
		expect(
			(await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" }))
				.status,
		).toBe(200);
		expect(
			(await vote(pres.id, { slideId: "mc", value: "b", participantId: "p1" }))
				.status,
		).toBe(200);

		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(1);
		expect(payload.respondentCount).toBe(1);
		expect(payload.maxSelections).toBe(1);
		expect(countFor(payload, "a")).toBe(0);
		expect(countFor(payload, "b")).toBe(1);
	});

	test("multi-select accumulates one row per option (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 0 })]);
		for (const value of ["a", "b", "c"]) {
			expect(
				(await vote(pres.id, { slideId: "mc", value, participantId: "p1" }))
					.status,
			).toBe(200);
		}
		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(3);
		expect(payload.respondentCount).toBe(1);
		expect(payload.maxSelections).toBe(0);
		expect(countFor(payload, "a")).toBe(1);
		expect(countFor(payload, "c")).toBe(1);
	});

	test("re-submitting a selected option deselects it (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 0 })]);
		await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" });
		await vote(pres.id, { slideId: "mc", value: "b", participantId: "p1" });
		expect(
			(await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" }))
				.status,
		).toBe(200);

		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(1);
		expect(countFor(payload, "a")).toBe(0);
		expect(countFor(payload, "b")).toBe(1);
	});

	test("a selection past the cap is rejected server-side (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 2 })]);
		expect(
			(await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" }))
				.status,
		).toBe(200);
		expect(
			(await vote(pres.id, { slideId: "mc", value: "b", participantId: "p1" }))
				.status,
		).toBe(200);
		// Third selection exceeds the cap — the client cannot talk past it.
		expect(
			(await vote(pres.id, { slideId: "mc", value: "c", participantId: "p1" }))
				.status,
		).toBe(400);

		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(2);
		expect(countFor(payload, "c")).toBe(0);

		// Deselecting frees the slot up again.
		expect(
			(await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" }))
				.status,
		).toBe(200);
		expect(
			(await vote(pres.id, { slideId: "mc", value: "c", participantId: "p1" }))
				.status,
		).toBe(200);
		expect(countFor(await results(pres.id, "mc"), "c")).toBe(1);
	});

	test("the cap is per participant, not per slide (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 1 })]);
		for (const participantId of ["p1", "p2", "p3"]) {
			expect(
				(await vote(pres.id, { slideId: "mc", value: "a", participantId }))
					.status,
			).toBe(200);
		}
		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(3);
		expect(payload.respondentCount).toBe(3);
	});

	test("a legacy allowMultiple slide keeps its unlimited behaviour (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ allowMultiple: true })]);
		await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" });
		await vote(pres.id, { slideId: "mc", value: "b", participantId: "p1" });
		const payload = await results(pres.id, "mc");
		expect(payload.maxSelections).toBe(0);
		expect(payload.totalVotes).toBe(2);
	});

	test("an unknown option id is rejected rather than burning a slot (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 2 })]);
		expect(
			(
				await vote(pres.id, {
					slideId: "mc",
					value: "does-not-exist",
					participantId: "p1",
				})
			).status,
		).toBe(400);
		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(0);
		expect(payload.respondentCount).toBe(0);
	});

	// ── REQ014 — percentage basis ──────────────────────────────

	test("results separate selections from people so percentages divide by the head count (REQ014)", async () => {
		const pres = await createAndStart([mcSlide({ mcMaxSelections: 0 })]);
		// Two participants; both pick A, one of them also picks B.
		await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" });
		await vote(pres.id, { slideId: "mc", value: "b", participantId: "p1" });
		await vote(pres.id, { slideId: "mc", value: "a", participantId: "p2" });

		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(3);
		expect(payload.respondentCount).toBe(2);
		// Both people picked A → 100% of respondents, not 67% of selections.
		expect(countFor(payload, "a") / payload.respondentCount).toBe(1);
		expect(countFor(payload, "b") / payload.respondentCount).toBe(0.5);
	});

	test("single-select tallies leave the two denominators equal", async () => {
		const pres = await createAndStart([mcSlide()]);
		await vote(pres.id, { slideId: "mc", value: "a", participantId: "p1" });
		await vote(pres.id, { slideId: "mc", value: "b", participantId: "p2" });
		const payload = await results(pres.id, "mc");
		expect(payload.respondentCount).toBe(payload.totalVotes);
	});
});
