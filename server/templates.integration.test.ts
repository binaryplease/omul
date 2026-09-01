/**
 * Integration tests for the template catalog and the create path that starts
 * from it.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ005 — the catalog is listed and filtered over HTTP, and one entry is
 *     readable on its own
 *   - REQ006 — `POST /api/presentations` with a `templateId` answers with a deck
 *     whose slides are copies of that template's, editable by the caller and
 *     detached from the entry they came from
 *
 * The point of testing this over HTTP rather than only at the functions: what
 * REQ006 promises is a *deck* — one that exists, that the caller can edit, and
 * that is no longer connected to the catalog. Each of those three is a property
 * of the round trip. So the tests here create a deck, edit it with the token the
 * create handed back, and then read the template again to prove the edit could
 * not reach it.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DECK_TEMPLATE_CATEGORIES } from "./schemas";
import { DECK_TEMPLATES } from "./templates";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

async function getJson(path: string): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}${path}`);
	expect(res.status).toBe(200);
	return await res.json();
}

async function create(body: Record<string, unknown>): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function createdFrom(templateId: string): Promise<AnyJson> {
	const res = await create({ templateId });
	expect(res.status).toBe(201);
	return await res.json();
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

describe("Deck templates integration", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { templateRoutes } = await import("./routes/templates");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(templateRoutes)
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
		await server?.stop();
	});

	// ── REQ005 — the catalog is listed ──────────────────────────

	test("the catalog is served whole, with the slides each entry would copy", async () => {
		const catalog = await getJson("/api/templates");
		expect(catalog.length).toBe(DECK_TEMPLATES.length);
		for (const entry of catalog) {
			expect(typeof entry.id).toBe("string");
			expect(typeof entry.title).toBe("string");
			// Every key present, none omitted (ADR-0024): a card renders the same
			// shape whether or not the entry was authored with tags.
			expect(typeof entry.description).toBe("string");
			expect(Array.isArray(entry.tags)).toBe(true);
			expect(DECK_TEMPLATE_CATEGORIES).toContain(entry.category);
			expect(entry.slides.length).toBeGreaterThan(0);
		}
	});

	test("no credential is needed, and none changes what comes back", async () => {
		// The catalog ships with the build. Nothing about it is anybody's, so an
		// authorized read and an anonymous one are the same read.
		const anonymous = await getJson("/api/templates");
		const withHeaders = await fetch(`${baseUrl}/api/templates`, {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(withHeaders.status).toBe(200);
		expect(await withHeaders.json()).toEqual(anonymous);
	});

	// ── REQ005 — and filtered ───────────────────────────────────

	test("a category narrows the catalog to the entries filed under it", async () => {
		const whole = await getJson("/api/templates");
		const meetings = await getJson("/api/templates?category=meeting");
		expect(meetings.length).toBeGreaterThan(0);
		expect(meetings.length).toBeLessThan(whole.length);
		for (const entry of meetings) expect(entry.category).toBe("meeting");
	});

	test("a search matches the words an entry is described by", async () => {
		const found = await getJson("/api/templates?search=retro");
		expect(found.map((entry: AnyJson) => entry.id)).toContain("retrospective");
		const nothing = await getJson("/api/templates?search=zzzzz-nothing-here");
		expect(nothing).toEqual([]);
	});

	test("the two filters apply together", async () => {
		const both = await getJson(
			"/api/templates?category=engagement&search=quiz",
		);
		expect(both.map((entry: AnyJson) => entry.id)).toEqual(["quiz-round"]);
		// The same search under the wrong category finds nothing: an AND.
		expect(await getJson("/api/templates?category=meeting&search=quiz")).toEqual(
			[],
		);
	});

	test("a category outside the set is refused rather than ignored", async () => {
		// Silently returning the whole catalog would tell a client its filter had
		// been applied when it had not.
		const res = await fetch(`${baseUrl}/api/templates?category=nonsense`);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	// ── REQ005 — one entry on its own ───────────────────────────

	test("an entry is readable by its id, and a missing one is a 404", async () => {
		const entry = await getJson("/api/templates/quiz-round");
		expect(entry.id).toBe("quiz-round");
		expect(entry.slides.length).toBeGreaterThan(0);
		const missing = await fetch(`${baseUrl}/api/templates/no-such-template`);
		expect(missing.status).toBe(404);
	});

	// ── REQ006 — the create path takes a template id ────────────

	test("a create that names a template answers with that template's deck", async () => {
		const template = await getJson("/api/templates/team-check-in");
		const deck = await createdFrom("team-check-in");
		expect(deck.title).toBe(template.title);
		expect(deck.status).toBe("draft");
		expect(deck.code).toMatch(/^\d{6}$/);
		expect(deck.slides.length).toBe(template.slides.length);
		deck.slides.forEach((slide: AnyJson, index: number) => {
			expect(slide.type).toBe(template.slides[index].type);
			expect(slide.question).toBe(template.slides[index].question);
		});
	});

	test("every built-in entry produces a deck", async () => {
		// Walking the catalog rather than sampling it: an entry added later and
		// broken fails here rather than in front of the first organizer to pick it.
		for (const template of DECK_TEMPLATES) {
			const deck = await createdFrom(template.id);
			expect(deck.slides.length).toBe(template.slides.length);
		}
	});

	test("the deck's slides are copies — no id is shared with the template", async () => {
		const template = await getJson("/api/templates/quiz-round");
		const deck = await createdFrom("quiz-round");
		const templateIds = template.slides.map((slide: AnyJson) => slide.id);
		for (const slide of deck.slides) {
			expect(templateIds).not.toContain(slide.id);
		}
		// And the answer key's option ids are re-minted with them.
		const templateOptionIds = template.slides.flatMap((slide: AnyJson) =>
			(slide.options ?? []).map((option: AnyJson) => option.id),
		);
		for (const slide of deck.slides) {
			for (const option of slide.options ?? []) {
				expect(templateOptionIds).not.toContain(option.id);
			}
		}
	});

	test("two decks from one entry share nothing with each other", async () => {
		const first = await createdFrom("icebreaker");
		const second = await createdFrom("icebreaker");
		expect(first.id).not.toBe(second.id);
		expect(first.code).not.toBe(second.code);
		const firstSlideIds = first.slides.map((slide: AnyJson) => slide.id);
		for (const slide of second.slides) {
			expect(firstSlideIds).not.toContain(slide.id);
		}
	});

	test("the deck is fully editable, and editing it cannot reach the template", async () => {
		// The whole of "detached from their source": the caller holds an edit
		// token for the new deck, uses it, and the catalog is exactly as it was.
		const before = await getJson("/api/templates/retrospective");
		const deck = await createdFrom("retrospective");
		expect(typeof deck.creatorToken).toBe("string");

		const edited = await authed(
			`/api/presentations/${deck.id}`,
			deck.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					title: "Our retro",
					slides: [
						{ ...deck.slides[0], question: "Rewritten by the organizer" },
					],
				}),
			},
		);
		expect(edited.status).toBe(200);
		const saved = await edited.json();
		expect(saved.title).toBe("Our retro");
		expect(saved.slides.length).toBe(1);
		expect(saved.slides[0].question).toBe("Rewritten by the organizer");

		expect(await getJson("/api/templates/retrospective")).toEqual(before);
		// And a deck created afterwards still gets the original.
		const after = await createdFrom("retrospective");
		expect(after.title).toBe(before.title);
		expect(after.slides.length).toBe(before.slides.length);
	});

	test("a marked answer survives the copy for whoever may edit the deck", async () => {
		// REQ056 withholds an answer key from anyone who cannot edit the deck, so a
		// copied quiz that lost its marks would look identical to a correct one on
		// the participant's side and be wrong only when it was scored.
		const deck = await createdFrom("quiz-round");
		const asEditor = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			headers: { Authorization: `Bearer ${deck.creatorToken}` },
		});
		const editorView = await asEditor.json();
		const quiz = editorView.slides.find(
			(slide: AnyJson) => slide.type === "quiz" && slide.options.length > 0,
		);
		expect(quiz.options.some((option: AnyJson) => option.isCorrect)).toBe(true);
	});

	test("the deck's title may be given instead of inherited", async () => {
		const res = await create({ templateId: "icebreaker", title: "Kickoff" });
		expect(res.status).toBe(201);
		expect((await res.json()).title).toBe("Kickoff");
	});

	test("the deck's settings are the request's, never the template's", async () => {
		// A template holds slides. The Q&A layer and the participant channels stay
		// off unless this request asked for them — picking a prebuilt deck out of a
		// gallery is not the organizer opening their room's chat.
		const deck = await createdFrom("lecture-pulse");
		expect(deck.qaEnabled).toBe(false);
		expect(deck.qaVisibility).toBe("presenter");
		expect(deck.reactionsEnabled).toBe(false);
		expect(deck.chatEnabled).toBe(false);
		expect(deck.mode).toBe("live");
		expect(deck.resultsVisibility).toBe("instant");

		// Stated settings are honoured on the same create.
		const configured = await create({
			templateId: "lecture-pulse",
			mode: "survey",
			qaEnabled: true,
			language: "de",
		});
		const withSettings = await configured.json();
		expect(withSettings.mode).toBe("survey");
		expect(withSettings.qaEnabled).toBe(true);
		expect(withSettings.language).toBe("de");
	});

	test("a per-slide reveal decision travels with the slides", async () => {
		// The one deck-shaped decision a template *can* carry, because it lives on
		// the slide rather than on the room (REQ102).
		const template = await getJson("/api/templates/lecture-pulse");
		const withheld = template.slides.filter(
			(slide: AnyJson) => slide.resultsVisibility === "on-click",
		);
		expect(withheld.length).toBeGreaterThan(0);
		const deck = await createdFrom("lecture-pulse");
		expect(
			deck.slides.filter(
				(slide: AnyJson) => slide.resultsVisibility === "on-click",
			).length,
		).toBe(withheld.length);
	});

	test("an id nothing is filed under is refused, and writes nothing", async () => {
		const before = await getJson("/api/presentations");
		const res = await create({ templateId: "no-such-template" });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("No such template");
		expect((await getJson("/api/presentations")).length).toBe(before.length);
	});

	test("a create with neither a template nor slides is still refused", async () => {
		// The floor the boundary has always enforced, unchanged for every create
		// that names no template.
		const noSlides = await create({ title: "Empty" });
		expect(noSlides.status).toBeGreaterThanOrEqual(400);
		expect(noSlides.status).toBeLessThan(500);
		const noTitle = await create({
			slides: [{ id: "s1", type: "text", question: "Hi" }],
		});
		expect(noTitle.status).toBeGreaterThanOrEqual(400);
		expect(noTitle.status).toBeLessThan(500);
	});

	test("a deck made from a template carries none of the creator's secrets", async () => {
		const deck = await createdFrom("team-check-in");
		expect(deck.creatorTokenHash).toBeUndefined();
		expect(deck.creatorId).toBeUndefined();
		const joined = await getJson(`/api/join/${deck.code}`);
		expect(joined.creatorTokenHash).toBeUndefined();
		expect(joined.creatorToken).toBeUndefined();
		expect(joined.creatorId).toBeUndefined();
	});
});
