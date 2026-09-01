/**
 * Integration tests for P1 slide-type settings in task/0005-slide-type-settings.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ022 / REQ026 — maxResponses cap on Word Cloud / Open Ended
 *   - REQ024 — openTextLayout surfaces through results
 *   - REQ025 — upvote / toggle-off on open-ended responses via
 *              POST /api/presentations/:id/response-vote
 *   - REQ029 / REQ030 / REQ031 — multi-statement scale voting, per-statement
 *              aggregation (average, distribution, skipped), skip gate
 *   - REQ032 — scaleLabels surface through results
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / ws harnesses.
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
		body: JSON.stringify({ title: "P1 Test", slides }),
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

describe("P1 slide-type settings integration", () => {
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
		// down when the test process exits. Only this suite's server is stopped.
		if (server) await server.stop();
	});

	// ── REQ022 / REQ026 — Word Cloud maxResponses ─────────

	test("word-cloud maxResponses=1 replaces the single response (legacy default)", async () => {
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 1 },
		]);

		const r1 = await vote(pres.id, {
			slideId: "wc",
			value: "first",
			participantId: "p1",
		});
		expect(r1.status).toBe(200);

		const r2 = await vote(pres.id, {
			slideId: "wc",
			value: "second",
			participantId: "p1",
		});
		expect(r2.status).toBe(200);

		const res = await results(pres.id, "wc");
		expect(res.totalVotes).toBe(1);
		// The replacement should be the latest value.
		const texts = (res.words || res.responses || []).map(
			(w: AnyJson) => w.text,
		);
		expect(texts).toContain("second");
		expect(texts).not.toContain("first");
	});

	test("word-cloud maxResponses=3 allows 3 submissions, rejects a 4th", async () => {
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 3 },
		]);

		for (const v of ["one", "two", "three"]) {
			const r = await vote(pres.id, {
				slideId: "wc",
				value: v,
				participantId: "p1",
			});
			expect(r.status).toBe(200);
		}
		const reject = await vote(pres.id, {
			slideId: "wc",
			value: "four",
			participantId: "p1",
		});
		expect(reject.status).toBe(400);

		const res = await results(pres.id, "wc");
		expect(res.totalVotes).toBe(3);
	});

	test("word-cloud maxResponses=0 means unlimited", async () => {
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 0 },
		]);
		for (const v of ["a", "b", "c", "d", "e"]) {
			const r = await vote(pres.id, {
				slideId: "wc",
				value: v,
				participantId: "p1",
			});
			expect(r.status).toBe(200);
		}
		const res = await results(pres.id, "wc");
		expect(res.totalVotes).toBe(5);
	});

	test("open-text maxResponses cap applies the same way", async () => {
		const pres = await createAndStart([
			{ id: "oe", type: "open-text", question: "Anything?", maxResponses: 2 },
		]);
		await vote(pres.id, {
			slideId: "oe",
			value: "first",
			participantId: "p1",
		});
		await vote(pres.id, {
			slideId: "oe",
			value: "second",
			participantId: "p1",
		});
		const third = await vote(pres.id, {
			slideId: "oe",
			value: "third",
			participantId: "p1",
		});
		expect(third.status).toBe(400);
		const res = await results(pres.id, "oe");
		expect(res.totalVotes).toBe(2);
	});

	// ── REQ024 — openTextLayout surfaces in results ───────

	test("open-text results include the configured layout (REQ024)", async () => {
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "Q",
				openTextLayout: "grid",
			},
		]);
		await vote(pres.id, {
			slideId: "oe",
			value: "hello",
			participantId: "p1",
		});
		const res = await results(pres.id, "oe");
		expect(res.layout).toBe("grid");
	});

	test("open-text results default layout to 'speech-bubbles'", async () => {
		const pres = await createAndStart([
			{ id: "oe", type: "open-text", question: "Q" },
		]);
		await vote(pres.id, {
			slideId: "oe",
			value: "hi",
			participantId: "p1",
		});
		const res = await results(pres.id, "oe");
		expect(res.layout).toBe("speech-bubbles");
	});

	// ── REQ025 — response upvotes ─────────────────────────

	async function upvote(presentationId: string, body: Record<string, unknown>) {
		return fetch(
			`${baseUrl}/api/presentations/${presentationId}/response-vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
	}

	test("response-vote upvotes a submitted response (REQ025)", async () => {
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "Q",
				allowResponseVotes: true,
			},
		]);
		const voteRes = await vote(pres.id, {
			slideId: "oe",
			value: "great idea",
			participantId: "author",
		});
		const submitted = await voteRes.json();
		const responseId = submitted.id;

		// A different participant upvotes
		const up = await upvote(pres.id, {
			slideId: "oe",
			responseId,
			participantId: "fan1",
		});
		expect(up.status).toBe(200);

		const res = await results(pres.id, "oe");
		expect(res.allowResponseVotes).toBe(true);
		const entry = res.responses.find((r: AnyJson) => r.id === responseId);
		expect(entry).toBeDefined();
		expect(entry.upvotes).toBe(1);
	});

	test("response-vote toggles off on a second call by the same participant", async () => {
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "Q",
				allowResponseVotes: true,
			},
		]);
		const submitted = await (
			await vote(pres.id, {
				slideId: "oe",
				value: "toggle me",
				participantId: "author",
			})
		).json();

		await upvote(pres.id, {
			slideId: "oe",
			responseId: submitted.id,
			participantId: "fan1",
		});
		await upvote(pres.id, {
			slideId: "oe",
			responseId: submitted.id,
			participantId: "fan1",
		});

		const res = await results(pres.id, "oe");
		const entry = res.responses.find((r: AnyJson) => r.id === submitted.id);
		expect(entry.upvotes).toBe(0);
	});

	test("response-vote is rejected when allowResponseVotes is off", async () => {
		const pres = await createAndStart([
			{ id: "oe", type: "open-text", question: "Q" },
		]);
		const submitted = await (
			await vote(pres.id, {
				slideId: "oe",
				value: "x",
				participantId: "author",
			})
		).json();

		const r = await upvote(pres.id, {
			slideId: "oe",
			responseId: submitted.id,
			participantId: "fan",
		});
		expect(r.status).toBe(400);
	});

	test("response-vote rejects unknown responseId", async () => {
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "Q",
				allowResponseVotes: true,
			},
		]);
		const r = await upvote(pres.id, {
			slideId: "oe",
			responseId: "does-not-exist",
			participantId: "fan",
		});
		expect(r.status).toBe(400);
	});

	// ── REQ029 / REQ030 / REQ031 — multi-statement scale ──

	test("multi-statement scale aggregates per-statement average + distribution (REQ029/REQ030)", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate each",
				scaleMin: 1,
				scaleMax: 5,
				scaleStatements: [
					{ id: "st1", text: "Statement A" },
					{ id: "st2", text: "Statement B" },
				],
			},
		]);

		// Three participants rate st1 (5, 3, 1) → avg 3
		for (const [p, v] of [
			["p1", "5"],
			["p2", "3"],
			["p3", "1"],
		]) {
			const r = await vote(pres.id, {
				slideId: "sc",
				value: v,
				participantId: p,
				statementId: "st1",
			});
			expect(r.status).toBe(200);
		}
		// Two rate st2 (4, 2) → avg 3
		for (const [p, v] of [
			["p1", "4"],
			["p2", "2"],
		]) {
			await vote(pres.id, {
				slideId: "sc",
				value: v,
				participantId: p,
				statementId: "st2",
			});
		}

		const res = await results(pres.id, "sc");
		expect(res.type).toBe("scale");
		expect(Array.isArray(res.statements)).toBe(true);
		expect(res.statements).toHaveLength(2);

		const st1 = res.statements.find((s: AnyJson) => s.statementId === "st1");
		expect(st1.text).toBe("Statement A");
		expect(st1.answered).toBe(3);
		expect(st1.skipped).toBe(0);
		expect(st1.average).toBe(3);
		expect(st1.distribution["1"]).toBe(1);
		expect(st1.distribution["3"]).toBe(1);
		expect(st1.distribution["5"]).toBe(1);
		expect(st1.distribution["2"]).toBe(0);

		const st2 = res.statements.find((s: AnyJson) => s.statementId === "st2");
		expect(st2.answered).toBe(2);
		expect(st2.average).toBe(3);
	});

	test("multi-statement scale: same participant re-voting a statement updates, not duplicates", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate",
				scaleMin: 1,
				scaleMax: 5,
				scaleStatements: [{ id: "st1", text: "S" }],
			},
		]);
		await vote(pres.id, {
			slideId: "sc",
			value: "2",
			participantId: "p1",
			statementId: "st1",
		});
		await vote(pres.id, {
			slideId: "sc",
			value: "5",
			participantId: "p1",
			statementId: "st1",
		});

		const res = await results(pres.id, "sc");
		const st1 = res.statements[0];
		expect(st1.answered).toBe(1);
		expect(st1.average).toBe(5);
	});

	test("scaleAllowSkip=true lets a participant skip a statement (REQ031)", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate",
				scaleMin: 1,
				scaleMax: 5,
				scaleAllowSkip: true,
				scaleStatements: [
					{ id: "st1", text: "S1" },
					{ id: "st2", text: "S2" },
				],
			},
		]);
		await vote(pres.id, {
			slideId: "sc",
			value: "4",
			participantId: "p1",
			statementId: "st1",
		});
		const skipRes = await vote(pres.id, {
			slideId: "sc",
			value: "0",
			participantId: "p1",
			statementId: "st2",
			skip: true,
		});
		expect(skipRes.status).toBe(200);

		const res = await results(pres.id, "sc");
		const st2 = res.statements.find((s: AnyJson) => s.statementId === "st2");
		expect(st2.answered).toBe(0);
		expect(st2.skipped).toBe(1);
	});

	test("scaleAllowSkip=false rejects a skip attempt (REQ031)", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate",
				scaleMin: 1,
				scaleMax: 5,
				scaleAllowSkip: false,
				scaleStatements: [{ id: "st1", text: "S1" }],
			},
		]);
		const r = await vote(pres.id, {
			slideId: "sc",
			value: "0",
			participantId: "p1",
			statementId: "st1",
			skip: true,
		});
		expect(r.status).toBe(400);
	});

	// ── REQ032 — scaleLabels surface through results ──────

	test("scale results expose configured scaleLabels (REQ032)", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate",
				scaleMin: 1,
				scaleMax: 5,
				scaleLabels: [
					{ value: 2, label: "Disagree" },
					{ value: 4, label: "Agree" },
				],
				scaleStatements: [{ id: "st1", text: "S1" }],
			},
		]);
		// Need at least one vote for the slide to exist in results
		await vote(pres.id, {
			slideId: "sc",
			value: "3",
			participantId: "p1",
			statementId: "st1",
		});
		const res = await results(pres.id, "sc");
		expect(res.labels).toEqual([
			{ value: 2, label: "Disagree" },
			{ value: 4, label: "Agree" },
		]);
	});

	test("single-statement scale still works (backwards compatibility)", async () => {
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate it",
				scaleMin: 1,
				scaleMax: 5,
			},
		]);
		await vote(pres.id, {
			slideId: "sc",
			value: "4",
			participantId: "p1",
		});
		await vote(pres.id, {
			slideId: "sc",
			value: "2",
			participantId: "p2",
		});
		const res = await results(pres.id, "sc");
		expect(res.type).toBe("scale");
		expect(res.statements).toBeUndefined();
		expect(res.average).toBe(3);
	});
});
