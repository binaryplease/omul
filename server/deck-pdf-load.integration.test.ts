/**
 * Integration tests for the PDF export under load (REQ213).
 *
 * The export is the most expensive call a caller with a token can repeat, and
 * Bun answers every request from one thread. Two properties keep that thread
 * the server's rather than the export's, and only the real endpoint can show
 * either:
 *
 *   - **Other requests are answered while a long deck renders.** The renderer
 *     works in slices and yields between them, so a health check that arrives
 *     mid-render waits about one slice, not the rest of the render.
 *   - **Render work in hand is bounded, whoever asks.** One render runs at a
 *     time and a short queue waits behind it; past that the export answers
 *     `503` with `Retry-After` at once, instead of piling up work.
 *
 * Both are measured against the render's own length rather than against a
 * clock, so they hold on a slow runner as on a fast one. The suite runs with
 * the per-client rate limits off (the test preload's default): the gate is not
 * a rate limit and must hold without one.
 *
 * Runs the real Elysia app against a throw-away in-memory zodstore, like the
 * PDF export suite beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DECK_PDF_RENDER_GATE } from "./rate-limit";
import { SLIDE_TEXT_MAX_LENGTH } from "./schemas";

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

/** A deck long enough that one render of it is real work: every field at its cap. */
async function createLongDeck(slideCount: number): Promise<AnyJson> {
	const text = "lorem ipsum dolor sit amet ".repeat(200).slice(0, SLIDE_TEXT_MAX_LENGTH);
	const slides = Array.from({ length: slideCount }, (_, index) => ({
		id: `s${index}`,
		type: "text",
		question: text,
		body: text,
	}));
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Long deck", slides }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

/** Ask for one export, and say how it ended and when. */
async function exportDeck(
	deck: AnyJson,
): Promise<{ status: number; retryAfter: string | null; finishedAt: number }> {
	const res = await fetch(`${baseUrl}/api/presentations/${deck.id}/deck.pdf`, {
		headers: { Authorization: `Bearer ${deck.creatorToken}` },
	});
	await res.arrayBuffer();
	return {
		status: res.status,
		retryAfter: res.headers.get("Retry-After"),
		finishedAt: performance.now(),
	};
}

describe("PDF export under load (REQ213)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes);

		app.listen({ port: 0, hostname: "127.0.0.1" });
		server = app.server as unknown as typeof server;
		baseUrl = `http://127.0.0.1:${server?.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("a health check is answered while a long deck renders", async () => {
		const deck = await createLongDeck(60);
		// Warm the route once, so the measured export is a render rather than a
		// first import.
		expect((await exportDeck(deck)).status).toBe(200);

		const started = performance.now();
		let exporting = true;
		const exported = exportDeck(deck).finally(() => {
			exporting = false;
		});

		// Ask for the health check over and over for as long as the export runs,
		// so some of the asks land in the middle of the render whatever the
		// machine's speed — and keep the slowest answer.
		let slowestHealth = 0;
		let asked = 0;
		while (exporting) {
			const askedAt = performance.now();
			const health = await fetch(`${baseUrl}/api/health`);
			expect(health.status).toBe(200);
			await health.json();
			slowestHealth = Math.max(slowestHealth, performance.now() - askedAt);
			asked += 1;
		}
		const result = await exported;
		const exportTook = result.finishedAt - started;

		expect(result.status).toBe(200);
		expect(asked).toBeGreaterThan(1);
		// A render that holds the thread makes some health check wait for most of
		// it; one that yields makes none wait for more than a sliver.
		expect({ shareOfExportWaited: slowestHealth / exportTook < 0.25 }).toEqual({
			shareOfExportWaited: true,
		});
	});

	test("exports past the running one and its queue are refused at once with 503", async () => {
		const deck = await createLongDeck(60);
		const capacity = DECK_PDF_RENDER_GATE.concurrent + DECK_PDF_RENDER_GATE.queued;
		const asked = capacity + 3;

		const started = performance.now();
		const results = await Promise.all(
			Array.from({ length: asked }, () => exportDeck(deck)),
		);

		const rendered = results.filter((result) => result.status === 200);
		const refused = results.filter((result) => result.status === 503);
		// Nothing else: every export either rendered or was turned away.
		expect(rendered.length + refused.length).toBe(asked);
		// The gate bounds the work in hand: never more renders than it holds.
		expect(rendered.length).toBeLessThanOrEqual(capacity);
		expect(refused.length).toBeGreaterThanOrEqual(asked - capacity);
		for (const result of refused) {
			expect(result.retryAfter).toBe(String(DECK_PDF_RENDER_GATE.retryAfterSeconds));
		}
		// A refusal is answered at once, not after waiting behind the renders: it
		// arrives before the first of them is done.
		const firstRendered = Math.min(...rendered.map((result) => result.finishedAt));
		const lastRefused = Math.max(...refused.map((result) => result.finishedAt));
		expect(lastRefused).toBeLessThan(firstRendered);
		expect(firstRendered).toBeGreaterThan(started);
	});

	test("once the queue has drained, the next export renders again", async () => {
		const deck = await createLongDeck(2);
		expect((await exportDeck(deck)).status).toBe(200);
	});
});
