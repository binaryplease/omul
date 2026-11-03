/**
 * Integration tests for skipping a slide (REQ110), through the real app.
 *
 * Skipping is navigation and nothing else, so what is asked here is the half a
 * client cannot see for itself:
 *
 *   - the field round-trips through the ordinary deck update and back out of
 *     the deck fetch, and is cleared by the same update;
 *   - it reaches the participants' door, because an audience-paced phone pages
 *     by it;
 *   - marking a slide skipped leaves the slide and every answer already on it
 *     exactly where they were, and so does unmarking it.
 *
 * Runs the Elysia presentation routes against a throw-away in-memory zodstore,
 * like the harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

const DECK: AnyJson[] = [
	{
		id: "intro",
		type: "text",
		question: "Welcome",
	},
	{
		id: "poll",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "weekly", text: "Weekly" },
			{ id: "monthly", text: "Monthly" },
		],
		resultsVisibility: "instant",
	},
	{
		id: "cloud",
		type: "word-cloud",
		question: "One word for this quarter",
	},
];

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

/** An audience-paced deck, so a vote lands without starting a session. */
async function create(): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Skip Test", mode: "survey", slides: DECK }),
	});
	expect(response.status).toBe(201);
	return response.json();
}

async function vote(
	presentationId: string,
	participantId: string,
	value: string,
): Promise<void> {
	const response = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/vote`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "poll", value, participantId }),
		},
	);
	expect(response.status).toBe(200);
}

/** Write the deck's slides with `skipped` set on the slides named. */
async function setSkipped(
	presentation: AnyJson,
	skippedIds: string[],
): Promise<AnyJson> {
	const slides = (presentation.slides as AnyJson[]).map((slide) => ({
		...slide,
		skipped: skippedIds.includes(slide.id),
	}));
	const response = await authed(
		`/api/presentations/${presentation.id}`,
		presentation.creatorToken,
		{ method: "PATCH", body: JSON.stringify({ slides }) },
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function fetchDeck(presentation: AnyJson): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${presentation.id}`,
		presentation.creatorToken,
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function pollResults(presentation: AnyJson): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${presentation.id}/results/poll`,
		presentation.creatorToken,
	);
	expect(response.status).toBe(200);
	return response.json();
}

function skippedOf(presentation: AnyJson): boolean[] {
	return (presentation.slides as AnyJson[]).map((slide) => slide.skipped);
}

describe("Skipping a slide (REQ110)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia().use(presentationRoutes);
		app.listen({ port: 0, hostname: "127.0.0.1" });
		const bunServer = (app as any).server as {
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://127.0.0.1:${bunServer.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("a deck created without the field has no skipped slide", async () => {
		const presentation = await create();
		expect(skippedOf(presentation)).toEqual([false, false, false]);
		expect(skippedOf(await fetchDeck(presentation))).toEqual([
			false,
			false,
			false,
		]);
	});

	test("the skipped state round-trips through the deck update", async () => {
		const presentation = await create();
		const updated = await setSkipped(presentation, ["poll", "cloud"]);
		expect(skippedOf(updated)).toEqual([false, true, true]);
		expect(skippedOf(await fetchDeck(presentation))).toEqual([
			false,
			true,
			true,
		]);

		await setSkipped(presentation, []);
		expect(skippedOf(await fetchDeck(presentation))).toEqual([
			false,
			false,
			false,
		]);
	});

	test("the update is gated like every other authored field", async () => {
		const presentation = await create();
		const response = await fetch(`${baseUrl}/api/presentations/${presentation.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slides: DECK.map((slide) => ({ ...slide, skipped: true })),
			}),
		});
		expect(response.status).toBe(401);
		expect(skippedOf(await fetchDeck(presentation))).toEqual([
			false,
			false,
			false,
		]);
	});

	test("the participants' door carries it, so an audience-paced phone can page by it", async () => {
		const presentation = await create();
		await setSkipped(presentation, ["poll"]);
		const response = await fetch(`${baseUrl}/api/join/${presentation.code}`);
		expect(response.status).toBe(200);
		expect(skippedOf(await response.json())).toEqual([false, true, false]);
	});

	test("a skipped slide's recorded answers are untouched by marking it skipped", async () => {
		const presentation = await create();
		await vote(presentation.id, "alice", "weekly");
		await vote(presentation.id, "bob", "monthly");
		await vote(presentation.id, "carol", "weekly");
		const before = await pollResults(presentation);
		expect(before.totalVotes).toBe(3);

		const updated = await setSkipped(presentation, ["poll"]);
		// The slide is still in the deck, in its place, with its content.
		expect((updated.slides as AnyJson[]).map((slide) => slide.id)).toEqual([
			"intro",
			"poll",
			"cloud",
		]);
		expect(updated.slides[1].question).toBe("Which release train?");
		expect(updated.slides[1].options.map((option: AnyJson) => option.id)).toEqual([
			"weekly",
			"monthly",
		]);

		const skipped = await pollResults(presentation);
		expect(skipped).toEqual(before);

		await setSkipped(presentation, []);
		expect(await pollResults(presentation)).toEqual(before);
	});
});
