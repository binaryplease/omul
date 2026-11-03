/**
 * Integration tests for the countdown slide (REQ107, slice 1).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - a deck can be created holding a countdown slide, and one that names no
 *     length is stored at the default minute
 *   - an editor can change the length, and the deck reads it back
 *   - a length outside the bounds is refused at the write boundary
 *   - the public read every participant's phone starts from carries the length
 *
 * Nothing here starts a clock: run state is the next slice's.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { COUNTDOWN_DEFAULT_SECONDS, COUNTDOWN_MAX_SECONDS } from "./schemas";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API response is loosely typed
type AnyJson = any;

function countdownSlide(overrides: Record<string, unknown> = {}) {
	return { id: "clock", type: "countdown", question: "Break", ...overrides };
}

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Countdown Test", slides }),
	});
	expect(response.status).toBe(201);
	return await response.json();
}

async function patchSlides(pres: AnyJson, slides: AnyJson[]): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${pres.id}`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${pres.creatorToken}`,
		},
		body: JSON.stringify({ slides }),
	});
}

async function read(presentationId: string): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations/${presentationId}`);
	expect(response.status).toBe(200);
	return await response.json();
}

describe("countdown slide integration (REQ107)", () => {
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
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here.
		await server?.stop();
	});

	test("a countdown that names no length is stored at the default", async () => {
		const pres = await create([countdownSlide()]);
		const deck = await read(pres.id);
		expect(deck.slides[0].type).toBe("countdown");
		expect(deck.slides[0].countdownSeconds).toBe(COUNTDOWN_DEFAULT_SECONDS);
	});

	test("a countdown is created at the length its author set", async () => {
		const pres = await create([countdownSlide({ countdownSeconds: 300 })]);
		expect((await read(pres.id)).slides[0].countdownSeconds).toBe(300);
	});

	test("an editor changes the length and the deck reads it back", async () => {
		const pres = await create([countdownSlide()]);
		const response = await patchSlides(pres, [
			countdownSlide({ countdownSeconds: COUNTDOWN_MAX_SECONDS }),
		]);
		expect(response.status).toBe(200);
		expect((await read(pres.id)).slides[0].countdownSeconds).toBe(
			COUNTDOWN_MAX_SECONDS,
		);
	});

	test("a length outside one second to an hour is refused", async () => {
		const pres = await create([countdownSlide({ countdownSeconds: 90 })]);
		for (const countdownSeconds of [0, COUNTDOWN_MAX_SECONDS + 1, 2.5]) {
			const response = await patchSlides(pres, [
				countdownSlide({ countdownSeconds }),
			]);
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(response.status).toBeLessThan(500);
		}
		expect((await read(pres.id)).slides[0].countdownSeconds).toBe(90);
	});

	test("a countdown needs no question to be saved", async () => {
		// It is content (REQ107): the heading over the clock is optional.
		const pres = await create([countdownSlide({ question: "" })]);
		expect((await read(pres.id)).slides[0].question).toBe("");
	});
});
