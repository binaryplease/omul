/**
 * Integration tests for an answer the deck moved on under (REQ236).
 *
 * Re-Test D (D1): a German deck's participant answered a quiz question, the
 * presenter pressed "End" while the answer was in flight, and the vote route
 * answered `400` with nothing but its English `error` text. The participant page
 * had no code to act on, so it replaced the room's ended screen with that text
 * and an English "Try again". The same bare `400` answered an answer to a slide
 * deleted mid-flight.
 *
 * Both now carry a `refused` code — `presentation-not-live`, `slide-not-found` —
 * the participant page reads it as "this screen is behind the room" and catches
 * up instead (`src/components/ParticipantSlideView.test.ts` pins that end).
 * What stays without a code is pinned too: a value the slide does not take, and
 * a deck that does not exist.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the quiz harness.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DECK_MOVED_ON_CODES, VOTE_REFUSAL_CODES } from "./schemas";

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

/** A quiz question with no time limit, so nothing but the deck can refuse it. */
function quizSlide(id: string) {
	return {
		id,
		type: "quiz",
		question: `Question ${id}`,
		options: [
			{ id: "venus", text: "Venus" },
			{ id: "mercury", text: "Mercury", isCorrect: true },
		],
		timeLimit: 0,
	};
}

async function create(slides: AnyJson[], extra: AnyJson = {}): Promise<AnyJson> {
	const created = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Moved on", language: "de", slides, ...extra }),
	});
	expect(created.status).toBe(201);
	return created.json();
}

async function createAndStart(slides: AnyJson[]): Promise<AnyJson> {
	const pres = await create(slides);
	const started = await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
		method: "POST",
	});
	expect(started.status).toBe(200);
	return pres;
}

async function answer(
	presentationId: string,
	slideId: string,
	value = "mercury",
): Promise<{ status: number; body: AnyJson }> {
	const response = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value, participantId: "phone-1" }),
	});
	return { status: response.status, body: await response.json() };
}

describe("an answer the deck moved on under states it (REQ236)", () => {
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

	test("the two codes are their own vocabulary, apart from the rule refusals", () => {
		for (const code of DECK_MOVED_ON_CODES) {
			expect(VOTE_REFUSAL_CODES as readonly string[]).not.toContain(code);
		}
	});

	test("an answer arriving after the presenter ended the deck: presentation-not-live", async () => {
		const pres = await createAndStart([quizSlide("qz")]);
		const ended = await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});
		expect(ended.status).toBe(200);

		const refused = await answer(pres.id, "qz");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBe("presentation-not-live");
		expect(typeof refused.body.error).toBe("string");

		const tally = await fetch(`${baseUrl}/api/presentations/${pres.id}/results/qz`);
		expect((await tally.json()).totalVotes).toBe(0);
	});

	test("an answer to a deck that has not gone live is the same code", async () => {
		const pres = await create([quizSlide("qz")]);
		const refused = await answer(pres.id, "qz");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBe("presentation-not-live");
	});

	test("an ended survey refuses with the same code", async () => {
		const pres = await create([quizSlide("qz")], { mode: "survey" });
		const ended = await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});
		expect(ended.status).toBe(200);
		const refused = await answer(pres.id, "qz");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBe("presentation-not-live");
	});

	test("an answer to a slide deleted while it was in flight: slide-not-found", async () => {
		const pres = await createAndStart([quizSlide("qz"), quizSlide("qz2")]);
		const saved = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ slides: [quizSlide("qz2")] }),
		});
		expect(saved.status).toBe(200);

		const refused = await answer(pres.id, "qz");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBe("slide-not-found");
		expect(typeof refused.body.error).toBe("string");
	});

	test("a value the slide does not take still answers with the text alone", async () => {
		const pres = await createAndStart([quizSlide("qz")]);
		const refused = await answer(pres.id, "qz", "pluto");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBeUndefined();
		expect(typeof refused.body.error).toBe("string");
	});

	test("a deck that does not exist still answers with the text alone", async () => {
		const refused = await answer("no-such-deck", "qz");
		expect(refused.status).toBe(400);
		expect(refused.body.refused).toBeUndefined();
	});
});
