/**
 * Integration tests for refusing a stale deck write (REQ126, slice 1).
 *
 * Two editors who both have a deck open and both press Save used to leave the
 * deck as the second one saved it, slides and settings wholesale, with neither
 * told. This suite holds the precondition that ends that, against the real
 * Elysia app and a throw-away in-memory zodstore:
 *
 *   - every deck read carries a `revision`, and a write naming the current one
 *     lands and advances it;
 *   - a write naming a revision another write has since superseded is refused
 *     `409` and changes nothing — and the refusal carries the deck as it now
 *     stands without the credentials no response may carry;
 *   - a write naming no revision stays unconditional, as every writer but the
 *     editor still sends;
 *   - two writes based on the same revision cannot both land, however closely
 *     they race;
 *   - the other routes that rewrite what the editor saves move the revision too.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PresentationSchema, StoredPresentationSchema } from "./schemas";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API response is loosely typed
type AnyJson = any;

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Original question",
		options: [{ id: "a", text: "A" }],
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

async function createDeck(): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Revision Test", slides: SLIDES }),
	});
	expect(response.status).toBe(201);
	return await response.json();
}

/**
 * The deck as an editor reads it back, without `serverNow` — the clock at the
 * moment of the read, which is the one thing two reads of an untouched deck
 * never agree on.
 */
async function readDeck(pres: AnyJson): Promise<AnyJson> {
	const response = await authed(`/api/presentations/${pres.id}`, pres.creatorToken);
	expect(response.status).toBe(200);
	const { serverNow: _serverNow, ...deck } = await response.json();
	return deck;
}

/** An editor's Save: a retitled slide list, optionally based on a revision. */
function save(
	pres: AnyJson,
	question: string,
	baseRevision?: number,
): Promise<Response> {
	return authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
		method: "PATCH",
		body: JSON.stringify({
			title: question,
			slides: [{ ...SLIDES[0], question }],
			...(baseRevision === undefined ? {} : { baseRevision }),
		}),
	});
}

describe("REQ126 — a stale deck write is refused, not silently applied", () => {
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
		if (server) await server.stop();
	});

	test("a deck stored before the field existed reads as revision 0", () => {
		expect(StoredPresentationSchema.parse({ id: "legacy" }).revision).toBe(0);
		expect(
			PresentationSchema.parse({
				id: "legacy",
				code: "123456",
				title: "",
				slides: [],
				createdAt: "",
			}).revision,
		).toBe(0);
	});

	test("a new deck starts at revision 0 and an editor's read carries it", async () => {
		const pres = await createDeck();
		expect(pres.revision).toBe(0);
		expect((await readDeck(pres)).revision).toBe(0);
	});

	test("a write naming the current revision lands and advances it", async () => {
		const pres = await createDeck();
		const response = await save(pres, "First save", 0);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.revision).toBe(1);
		expect(body.slides[0].question).toBe("First save");

		const read = await readDeck(pres);
		expect(read.revision).toBe(1);
		expect(read.slides[0].question).toBe("First save");
	});

	test("a write naming a superseded revision is refused 409 and changes nothing", async () => {
		const pres = await createDeck();
		// Two editors open the deck at revision 0; the first saves.
		expect((await save(pres, "Editor A", 0)).status).toBe(200);
		const afterFirst = await readDeck(pres);

		const refused = await save(pres, "Editor B", 0);
		expect(refused.status).toBe(409);
		const body = await refused.json();
		expect(body.refused).toBe("stale-revision");
		expect(body.revision).toBe(1);
		expect(body.presentation.revision).toBe(1);
		expect(body.presentation.slides[0].question).toBe("Editor A");

		// Exactly as the first write left it — not merged, not advanced.
		expect(await readDeck(pres)).toEqual(afterFirst);
	});

	test("the 409 body carries no creatorTokenHash and no creatorId", async () => {
		const pres = await createDeck();
		expect((await save(pres, "Editor A", 0)).status).toBe(200);
		const refused = await save(pres, "Editor B", 0);
		expect(refused.status).toBe(409);
		const text = await refused.text();
		expect(text).not.toContain("creatorTokenHash");
		expect(text).not.toContain("creatorId");
		expect(text).not.toContain(pres.creatorToken);
	});

	test("a write naming no revision still lands unconditionally", async () => {
		const pres = await createDeck();
		expect((await save(pres, "Editor A", 0)).status).toBe(200);

		const response = await save(pres, "Script write");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.slides[0].question).toBe("Script write");
		// It is still a write, so it moves the revision on for everyone else.
		expect(body.revision).toBe(2);
		expect((await save(pres, "Stale editor", 1)).status).toBe(409);
	});

	test("two concurrent writes based on the same revision do not both land", async () => {
		const pres = await createDeck();
		const responses = await Promise.all(
			["Racer 1", "Racer 2", "Racer 3", "Racer 4"].map((question) =>
				save(pres, question, 0),
			),
		);
		const statuses = responses.map((response) => response.status).sort();
		expect(statuses).toEqual([200, 409, 409, 409]);

		const winner = responses[responses.findIndex((response) => response.status === 200)];
		const winningDeck = await (winner as Response).json();
		const read = await readDeck(pres);
		expect(read.revision).toBe(1);
		expect(read.slides[0].question).toBe(winningDeck.slides[0].question);
	});

	test("the race holds where it is closest: concurrent service writes on one revision", async () => {
		// Requests over HTTP arrive one event-loop task apart and rarely meet in
		// the gap between the revision's read and its write. Calls started in the
		// same tick do — without the per-deck queue every one of these lands.
		const { updatePresentation } = await import("./services/presentations");
		const pres = await createDeck();
		const outcomes = await Promise.all(
			["Tick 1", "Tick 2", "Tick 3", "Tick 4"].map((title) =>
				updatePresentation(pres.id, { title }, 0),
			),
		);
		const statuses = outcomes.map((outcome) => outcome.status).sort();
		expect(statuses).toEqual(["stale", "stale", "stale", "written"]);
		expect((await readDeck(pres)).revision).toBe(1);
	});

	test("a caller cannot write the revision itself", async () => {
		const pres = await createDeck();
		const response = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ title: "Forged", revision: 99, baseRevision: 0 }),
		});
		expect(response.status).toBe(200);
		const read = await readDeck(pres);
		expect(read.revision).toBe(1);
		expect(read.baseRevision).toBeUndefined();
	});

	test("the other writers of what the editor saves move the revision too", async () => {
		const pres = await createDeck();
		const writes: [string, AnyJson][] = [
			["results-visibility", { resultsVisibility: "private" }],
			["qa/settings", { enabled: true }],
			["channels", { chatEnabled: true }],
		];
		let revision = 0;
		for (const [route, body] of writes) {
			const response = await authed(
				`/api/presentations/${pres.id}/${route}`,
				pres.creatorToken,
				{ method: "POST", body: JSON.stringify(body) },
			);
			expect(response.status).toBe(200);
			revision += 1;
			expect((await readDeck(pres)).revision).toBe(revision);
		}
		// An editor that opened the deck before those writes cannot save over them.
		expect((await save(pres, "Opened earlier", 0)).status).toBe(409);
		expect((await save(pres, "Opened now", revision)).status).toBe(200);
	});
});
