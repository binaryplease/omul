/**
 * Integration tests for who may read one slide's results over
 * `GET /api/presentations/:id/results/:slideId`.
 *
 * Each test asks the route over HTTP with the headers a browser holding that
 * credential sends — the deck's edit token, its results link's token, either,
 * both or neither — and without `?filtered=include`, against the reveal modes
 * that decide what a reader may see (REQ015–REQ017):
 *
 *   - **The holder of the edit token** reads every tally under every mode: the
 *     results surface REQ017 keeps a private slide's answers on is theirs.
 *   - **A results-link holder** reads them too while the link is current, and is
 *     refused outright once it is not (REQ098).
 *   - **Anybody else** reads what the room is shown and nothing more: a held
 *     back tally comes back as the withheld marker.
 *   - **Nobody's read carries what the profanity filter withheld** (REQ085)
 *     unless it asks with `?filtered=include`, and none of these does.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the other HTTP
 * harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isWithheldTally, RESULTS_TOKEN_HEADER } from "./schemas";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API response is loosely typed
type AnyJson = any;

/** The credentials a browser may hold for one deck. */
type HeldCredentials = { editToken?: string; resultsToken?: string };

/**
 * One slide's tally: both credentials when held, in the slots the client puts
 * them in, and no `filtered` parameter.
 */
async function slideRead(
	presentationId: string,
	slideId: string,
	held: HeldCredentials = {},
): Promise<Response> {
	const headers: Record<string, string> = {};
	if (held.editToken) headers.Authorization = `Bearer ${held.editToken}`;
	if (held.resultsToken) headers[RESULTS_TOKEN_HEADER] = held.resultsToken;
	return fetch(
		`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
		{ headers },
	);
}

/** The read's body, which must be a 200 for every reader that is not refused. */
async function slideTally(
	presentationId: string,
	slideId: string,
	held: HeldCredentials = {},
): Promise<AnyJson> {
	const response = await slideRead(presentationId, slideId, held);
	expect(response.status).toBe(200);
	return response.json();
}

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

/** A two-option choice slide under the given reveal mode. */
function choiceSlide(id: string, resultsVisibility = "inherit") {
	return {
		id,
		type: "multiple-choice",
		question: `Pick on ${id}`,
		resultsVisibility,
		options: [
			{ id: `${id}-a`, text: "A" },
			{ id: `${id}-b`, text: "B" },
		],
	};
}

/** One slide per reveal mode, the deck itself publishing instantly. */
const MODES = [
	choiceSlide("instant"),
	choiceSlide("on-click", "on-click"),
	choiceSlide("private", "private"),
];

async function createAndStart(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const created = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Slide results", slides, ...deck }),
	});
	expect(created.status).toBe(201);
	const pres = await created.json();
	const started = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(started.status).toBe(200);
	return pres;
}

let participantCounter = 0;

/** One answer from a participant nobody else answers as. */
async function vote(
	presentationId: string,
	slideId: string,
	value: string,
): Promise<void> {
	participantCounter += 1;
	const response = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/vote`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId,
				value,
				participantId: `results-reader-${participantCounter}`,
			}),
		},
	);
	expect(response.status).toBe(200);
}

/** A live deck with one slide per reveal mode, three answers on each. */
async function answeredDeck(): Promise<AnyJson> {
	const pres = await createAndStart(MODES);
	for (const slide of MODES) {
		await vote(pres.id, slide.id, `${slide.id}-a`);
		await vote(pres.id, slide.id, `${slide.id}-a`);
		await vote(pres.id, slide.id, `${slide.id}-b`);
	}
	return pres;
}

async function mintLink(pres: AnyJson): Promise<string> {
	const response = await authed(
		`/api/presentations/${pres.id}/results-link`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(response.status).toBe(201);
	return (await response.json()).resultsToken;
}

/** The counts a choice tally carries, option by option. */
function countsOf(tally: AnyJson): Record<string, number> {
	return Object.fromEntries(
		tally.options.map((option: AnyJson) => [option.id, option.count]),
	);
}

describe("GET /api/presentations/:id/results/:slideId — who may read a slide's tally", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");
		await connectDb();
		const app = new Elysia().use(presentationRoutes);
		app.listen({ port: 0, hostname: "127.0.0.1" });
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("the edit token reads every slide's tally, under every reveal mode", async () => {
		const pres = await answeredDeck();
		for (const slide of MODES) {
			const tally = await slideTally(pres.id, slide.id, {
				editToken: pres.creatorToken,
			});
			expect([slide.id, isWithheldTally(tally)]).toEqual([slide.id, false]);
			expect(countsOf(tally)).toEqual({
				[`${slide.id}-a`]: 2,
				[`${slide.id}-b`]: 1,
			});
		}
	});

	test("a results link reads them too — and is refused, not demoted, once revoked", async () => {
		const pres = await answeredDeck();
		const resultsToken = await mintLink(pres);
		for (const slide of MODES) {
			const tally = await slideTally(pres.id, slide.id, { resultsToken });
			expect(countsOf(tally)).toEqual({
				[`${slide.id}-a`]: 2,
				[`${slide.id}-b`]: 1,
			});
		}

		const revoked = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "DELETE" },
		);
		expect(revoked.status).toBe(200);
		for (const slide of MODES) {
			const refused = await slideRead(pres.id, slide.id, { resultsToken });
			expect(refused.status).toBe(401);
			expect((await refused.json()).error).toBe(
				"This results link is no longer valid",
			);
		}
	});

	test("the organizer's browser still holding a revoked link still reads its own deck", async () => {
		// The client sends both credentials it holds, so an organizer who revoked
		// their link a moment ago sends the dead token beside the live one.
		const pres = await answeredDeck();
		const resultsToken = await mintLink(pres);
		await authed(`/api/presentations/${pres.id}/results-link`, pres.creatorToken, {
			method: "DELETE",
		});
		const tally = await slideTally(pres.id, "private", {
			editToken: pres.creatorToken,
			resultsToken,
		});
		expect(countsOf(tally)).toEqual({ "private-a": 2, "private-b": 1 });
	});

	test("anybody else reads what the room is shown, and a held-back tally comes back withheld", async () => {
		const pres = await answeredDeck();

		const published = await slideTally(pres.id, "instant");
		expect(countsOf(published)).toEqual({ "instant-a": 2, "instant-b": 1 });

		for (const held of ["on-click", "private"]) {
			const tally = await slideTally(pres.id, held);
			expect([held, isWithheldTally(tally)]).toEqual([held, true]);
			// The marker carries no number at all.
			expect(tally.options).toBeUndefined();
			expect(tally.totalVotes).toBeUndefined();
		}

		// The presenter revealing the on-click slide is what publishes it, to this
		// reader as to the room; a private slide stays private.
		const revealed = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "on-click" }) },
		);
		expect(revealed.status).toBe(200);
		expect(isWithheldTally(await slideTally(pres.id, "on-click"))).toBe(false);
		expect(isWithheldTally(await slideTally(pres.id, "private"))).toBe(true);
	});

	test("another deck's edit token is no credential on this one", async () => {
		const pres = await answeredDeck();
		const other = await createAndStart([choiceSlide("elsewhere")]);
		const tally = await slideTally(pres.id, "private", {
			editToken: other.creatorToken,
		});
		expect(isWithheldTally(tally)).toBe(true);
	});

	test("a forged results token alone is refused", async () => {
		const pres = await answeredDeck();
		await mintLink(pres);
		const refused = await slideRead(pres.id, "private", {
			resultsToken: "not-the-link",
		});
		expect(refused.status).toBe(401);
	});

	test("without ?filtered=include the read never carries what the profanity filter withheld — not even for the edit token", async () => {
		const pres = await createAndStart(
			[{ id: "wc", type: "word-cloud", question: "One word", allowMultiple: true }],
			{ profanityFilterEnabled: true, language: "en" },
		);
		for (const word of ["pizza", "shit", "pizza", "coffee"]) {
			await vote(pres.id, "wc", word);
		}
		for (const held of [{ editToken: pres.creatorToken }, {}]) {
			const cloud = await slideTally(pres.id, "wc", held);
			expect(cloud.words.map((word: AnyJson) => word.text).sort()).toEqual([
				"coffee",
				"pizza",
			]);
			expect(cloud.filteredCount).toBe(1);
			expect(cloud.filteredAnswers).toBeNull();
		}
	});
});
