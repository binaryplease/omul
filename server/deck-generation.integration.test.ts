/**
 * Integration tests for generating a draft deck from a prompt (REQ007).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore,
 * and — this is the whole point of the route factory — against a **stub
 * generator**. No provider key is read, no network call is made and nobody is
 * billed: `createDeckGenerationRoutes` takes the generator it will use, so the
 * suite hands it one over a function that returns a fixed draft.
 *
 * What REQ007 promises is a *deck*: one that exists, that opens as an ordinary
 * editable presentation, and that treats nothing it contains as verified. Each
 * of those is a property of the round trip rather than of the generator, so the
 * tests here generate a deck, fetch it back, edit it with the token the call
 * handed over, and search the payload for a mark nothing should have made. The
 * pure half — what a generator may author, and what it refuses — is in
 * `deck-generation.schemas.test.ts`.
 *
 * Two servers are started, because "can this deployment generate?" has two
 * answers and both are ordinary: one app over a stub (configured), one over the
 * environment's own generator with the key deleted below (unconfigured).
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
// The unconfigured half of this suite has to be genuinely unconfigured, whatever
// the developer running it happens to have exported. Deleting the key here is
// also what guarantees the promise in the file header: this suite cannot reach a
// provider even if it tried.
//
// `bun test` loads every file into one process, so this deletion would outlive
// the suite and reach whatever runs next. It is captured here and put back in
// `afterAll` — the same discipline the sibling schemas suite keeps, and worth
// keeping while nothing else reads the key rather than the day something does.
const PROVIDER_KEY_BEFORE = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const ALLOW_ANONYMOUS_BEFORE = process.env.OMUL_GENERATION_ALLOW_ANONYMOUS;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
// Most of this suite drives the route as an anonymous caller, which the default
// posture refuses (REQ007 — the paid path is account-only unless opened). The
// account gate has cases of its own below; the rest opt out of it here.
process.env.OMUL_GENERATION_ALLOW_ANONYMOUS = "true";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type DeckDraftModel,
	GENERATED_SLIDE_TYPES,
} from "./deck-generator";
import { DECK_PROMPT_MAX_LENGTH } from "./schemas";

/** The draft the stub answers with unless a case installs another. */
const DEFAULT_DRAFT = {
	title: "Sprint retrospective",
	slides: [
		{
			type: "instruction",
			question: "Join the retro",
			body: "Answers are anonymous — say the thing you would say in the corridor.",
		},
		{
			type: "scale",
			question: "How did this one go?",
			scaleMinLabel: "Badly",
			scaleMaxLabel: "Well",
		},
		{
			type: "quiz",
			question: "Which of these shipped this sprint?",
			options: ["The importer", "The exporter", "Neither", "Both"],
		},
		{ type: "open-text", question: "What should we change?" },
	],
};

/** What the stub will answer next, and what it was last asked. */
let nextAnswer: () => Promise<unknown> = async () => DEFAULT_DRAFT;
let lastRequest: { prompt: string; language: string } | null = null;

const stubModel: DeckDraftModel = async (request) => {
	lastRequest = request;
	return nextAnswer();
};

/** Answer the next generation with this, then go back to the default draft. */
function answerOnceWith(answer: () => Promise<unknown>) {
	nextAnswer = async () => {
		nextAnswer = async () => DEFAULT_DRAFT;
		return answer();
	};
}

// API response is loosely typed
type AnyJson = any;

/** The app over the stub generator — a configured deployment. */
let baseUrl = "";
/** The app over the environment's generator, with no key — an unconfigured one. */
let bareUrl = "";

type RunningServer = { stop: () => Promise<void> };
const servers: RunningServer[] = [];

async function listen(app: AnyJson): Promise<string> {
	app.listen({ port: 0, hostname: "127.0.0.1" });
	const bunServer = app.server as {
		hostname: string;
		port: number;
		stop: (closeActive?: boolean) => Promise<void>;
	};
	if (!bunServer) throw new Error("Elysia did not expose a Bun server");
	servers.push({ stop: () => bunServer.stop(true) });
	return `http://${bunServer.hostname}:${bunServer.port}`;
}

async function generate(
	body: Record<string, unknown>,
	origin = baseUrl,
): Promise<Response> {
	return fetch(`${origin}/api/deck-generation`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function generated(body: Record<string, unknown>): Promise<AnyJson> {
	const res = await generate(body);
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

describe("Deck generation integration (REQ007)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { createDeckGenerator } = await import("./deck-generator");
		const { createDeckGenerationRoutes } = await import("./routes/deck-generation");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

		baseUrl = await listen(
			new Elysia()
				.use(createDeckGenerationRoutes(createDeckGenerator({ model: stubModel })))
				.use(presentationRoutes),
		);
		// A second app whose generator is the ordinary environment-configured one.
		// With the key deleted above, this is exactly a self-hosted server that
		// never set one — the default posture, and the one that must fail closed.
		bareUrl = await listen(
			new Elysia({ name: "unconfigured" }).use(
				createDeckGenerationRoutes(createDeckGenerator()),
			),
		);
	});

	afterAll(async () => {
		for (const server of servers) await server.stop();
		// Hand the rest of the run back the environment this suite found.
		if (PROVIDER_KEY_BEFORE === undefined) {
			delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		} else {
			process.env.GOOGLE_GENERATIVE_AI_API_KEY = PROVIDER_KEY_BEFORE;
		}
		if (ALLOW_ANONYMOUS_BEFORE === undefined) {
			delete process.env.OMUL_GENERATION_ALLOW_ANONYMOUS;
		} else {
			process.env.OMUL_GENERATION_ALLOW_ANONYMOUS = ALLOW_ANONYMOUS_BEFORE;
		}
	});

	// ── Is generation available? (ADR-0025) ─────────────────

	describe("the capability route", () => {
		test("a configured deployment says so, with an explicit null reason", async () => {
			const res = await fetch(`${baseUrl}/api/deck-generation`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.available).toBe(true);
			// ADR-0024 — present and null, never absent.
			expect(body).toHaveProperty("reason");
			expect(body.reason).toBeNull();
		});

		test("it reports the terms a surface needs to draw the control", async () => {
			const body = await (await fetch(`${baseUrl}/api/deck-generation`)).json();
			expect(body.promptMaxLength).toBe(DECK_PROMPT_MAX_LENGTH);
			expect(body.slideTypes).toEqual([...GENERATED_SLIDE_TYPES]);
		});

		test("an unconfigured deployment says why, rather than looking broken", async () => {
			const res = await fetch(`${bareUrl}/api/deck-generation`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.available).toBe(false);
			// The reason is what the surface puts on the disabled control
			// (ADR-0025), so it has to be a sentence rather than a flag.
			expect(typeof body.reason).toBe("string");
			expect(body.reason.length).toBeGreaterThan(0);
		});

		test("it is public — no credential changes the answer", async () => {
			const anonymous = await (await fetch(`${baseUrl}/api/deck-generation`)).json();
			const withToken = await (
				await fetch(`${baseUrl}/api/deck-generation`, {
					headers: { Authorization: "Bearer not-a-real-token" },
				})
			).json();
			expect(withToken).toEqual(anonymous);
		});
	});

	// ── A prompt becomes an ordinary editable deck ──────────

	describe("a prompt becomes a deck", () => {
		test("it answers 201 with a presentation, not a proposal to confirm", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			expect(typeof deck.id).toBe("string");
			expect(deck.status).toBe("draft");
			expect(deck.title).toBe("Sprint retrospective");
			expect(deck.slides).toHaveLength(4);
			// The six-digit join code every deck has — this is a real one, already
			// runnable, not a draft object awaiting a second create.
			expect(deck.code).toMatch(/^\d{6}$/);
		});

		test("the deck is in the store and reads back as any other does", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			const res = await fetch(`${baseUrl}/api/presentations/${deck.id}`);
			expect(res.status).toBe(200);
			const fetched = await res.json();
			expect(fetched.id).toBe(deck.id);
			expect(fetched.slides.map((slide: AnyJson) => slide.type)).toEqual([
				"instruction",
				"scale",
				"quiz",
				"open-text",
			]);
		});

		test("the one-time edit token it returns really edits the deck", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			expect(typeof deck.creatorToken).toBe("string");
			const res = await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify({ title: "Renamed by its owner" }),
			});
			expect(res.status).toBe(200);
			const reread = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`)
			).json();
			expect(reread.title).toBe("Renamed by its owner");
		});

		test("its slides are editable slides — replacing them is an ordinary save", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			const edited = deck.slides.map((slide: AnyJson) => ({
				...slide,
				question: `${slide.question}?`,
			}));
			const res = await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify({ slides: edited }),
			});
			expect(res.status).toBe(200);
			const reread = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`)
			).json();
			for (const slide of reread.slides) expect(slide.question.endsWith("?")).toBe(true);
		});

		test("the deck's own credentials never reach the client", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			expect(deck.creatorTokenHash).toBeUndefined();
			expect(deck.creatorId).toBeUndefined();
		});

		test("the deck's language is the request's, and the brief is written in it", async () => {
			const deck = await generated({ prompt: "eine Retro", language: "de" });
			expect(deck.language).toBe("de");
			expect(lastRequest).toEqual({ prompt: "eine Retro", language: "de" });
		});

		test("the room's settings are the ordinary defaults, not the prompt's to set", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			// A prompt is not the organizer opening their room's chat — the same
			// stance a template create takes (REQ036/REQ077/REQ078).
			expect(deck.qaEnabled).toBe(false);
			expect(deck.reactionsEnabled).toBe(false);
			expect(deck.chatEnabled).toBe(false);
			expect(deck.mode).toBe("live");
			expect(deck.resultsVisibility).toBe("instant");
			expect(deck.theme).toBe("signal");
		});

		test("nothing records that the deck was generated", async () => {
			const deck = await generated({ prompt: "a retro for my team" });
			const payload = JSON.stringify(deck);
			// The template path records no origin either, and for the same reason:
			// a provenance field is one more thing to keep off every
			// participant-facing payload, for no capability in return.
			expect(deck.prompt).toBeUndefined();
			expect(deck.generated).toBeUndefined();
			expect(deck.generatedFrom).toBeUndefined();
			expect(payload).not.toContain("a retro for my team");
		});

		test("two decks from the same prompt share nothing", async () => {
			const first = await generated({ prompt: "a retro for my team" });
			const second = await generated({ prompt: "a retro for my team" });
			expect(first.id).not.toBe(second.id);
			expect(first.code).not.toBe(second.code);
			const firstIds = first.slides.map((slide: AnyJson) => slide.id);
			const secondIds = second.slides.map((slide: AnyJson) => slide.id);
			for (const id of secondIds) expect(firstIds).not.toContain(id);
		});
	});

	// ── The draft rule, on the wire ─────────────────────────

	describe("the output is a draft (REQ007)", () => {
		test("no answer comes back marked correct, anywhere in the payload", async () => {
			const deck = await generated({ prompt: "a pub quiz about oceans" });
			const quiz = deck.slides.find((slide: AnyJson) => slide.type === "quiz");
			expect(quiz).toBeDefined();
			expect(quiz.options).toHaveLength(4);
			for (const option of quiz.options) {
				expect(option.isCorrect).toBeUndefined();
			}
			expect(quiz.quizAnswers).toEqual([]);
			// Nothing anywhere in the deck asserts a right answer — checked over the
			// whole payload rather than the one slide, because the promise is about
			// the deck rather than about quiz slides.
			expect(JSON.stringify(deck)).not.toContain('"isCorrect"');
		});

		test("a marked answer is the organizer's own edit, and it lands", async () => {
			// The other half of the same claim: the key is *withheld*, not
			// forbidden — the deck is an ordinary one and marking it is an
			// ordinary save.
			const deck = await generated({ prompt: "a pub quiz about oceans" });
			const slides = deck.slides.map((slide: AnyJson) =>
				slide.type === "quiz"
					? {
							...slide,
							options: slide.options.map((option: AnyJson, index: number) => ({
								...option,
								isCorrect: index === 0,
							})),
						}
					: slide,
			);
			const res = await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify({ slides }),
			});
			expect(res.status).toBe(200);
			const reread = await (
				await authed(`/api/presentations/${deck.id}`, deck.creatorToken)
			).json();
			const quiz = reread.slides.find((slide: AnyJson) => slide.type === "quiz");
			expect(quiz.options[0].isCorrect).toBe(true);
		});
	});

	// ── Refusals ────────────────────────────────────────────

	describe("what it refuses, and how", () => {
		test("an unconfigured deployment answers 503 rather than failing on the provider", async () => {
			const res = await generate({ prompt: "a retro" }, bareUrl);
			expect(res.status).toBe(503);
			const body = await res.json();
			expect(body.refused).toBe("unavailable");
			expect(typeof body.error).toBe("string");
		});

		test("a provider that fails is a 502, and its words stay in the log", async () => {
			answerOnceWith(async () => {
				throw new Error("upstream exploded: key sk-abcdef");
			});
			const res = await generate({ prompt: "a retro" });
			expect(res.status).toBe(502);
			const body = await res.json();
			expect(body.refused).toBe("provider-failed");
			expect(body.error).not.toContain("sk-abcdef");
		});

		test("an answer that is not a deck is a 502, not a deck of nothing", async () => {
			answerOnceWith(async () => "I'm sorry, I can't help with that.");
			const res = await generate({ prompt: "a retro" });
			expect(res.status).toBe(502);
			expect((await res.json()).refused).toBe("unusable-draft");
		});

		test("a draft with no usable slide in it is a 502, and writes nothing", async () => {
			answerOnceWith(async () => ({ title: "Empty", slides: [] }));
			const before = await (await fetch(`${baseUrl}/api/presentations`)).json();
			const res = await generate({ prompt: "a retro" });
			expect(res.status).toBe(502);
			const after = await (await fetch(`${baseUrl}/api/presentations`)).json();
			expect(after.length).toBe(before.length);
		});

		test("an empty prompt is refused at the boundary", async () => {
			const res = await generate({ prompt: "   " });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});

		test("a missing prompt is refused at the boundary", async () => {
			const res = await generate({});
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});

		test("a prompt past the ceiling is refused, and never forwarded", async () => {
			lastRequest = null;
			const res = await generate({ prompt: "x".repeat(DECK_PROMPT_MAX_LENGTH + 1) });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
			// The bound is on what this server forwards to a third party on a
			// caller's word, so it has to hold *before* the call.
			expect(lastRequest).toBeNull();
		});

		test("a flooded language is refused, and never forwarded either", async () => {
			// The hole: `prompt` was capped and `language` was not, while both are
			// interpolated into the brief sent to the paid provider. 500 KB in the
			// uncapped field bills the operator ~125k input tokens on a route whose
			// stated ceiling is a 500-character brief — five times per five minutes,
			// from any address, with no account.
			lastRequest = null;
			const res = await generate({ prompt: "a retro", language: "x".repeat(500_000) });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
			expect(lastRequest).toBeNull();
		});

		test("an ordinary language tag still passes", async () => {
			const deck = await generated({ prompt: "eine Retro", language: "pt-BR" });
			expect(deck.language).toBe("pt-BR");
		});
	});

	// ── Who may spend the provider budget ───────────────────

	describe("the account gate on the paid path", () => {
		/** Run one case with the anonymous switch at a stated value. */
		async function withAnonymous(allowed: boolean, run: () => Promise<void>) {
			const before = process.env.OMUL_GENERATION_ALLOW_ANONYMOUS;
			process.env.OMUL_GENERATION_ALLOW_ANONYMOUS = allowed ? "true" : "false";
			try {
				await run();
			} finally {
				if (before === undefined) {
					delete process.env.OMUL_GENERATION_ALLOW_ANONYMOUS;
				} else {
					process.env.OMUL_GENERATION_ALLOW_ANONYMOUS = before;
				}
			}
		}

		test("by default an anonymous caller is refused 401 and costs nothing", async () => {
			await withAnonymous(false, async () => {
				lastRequest = null;
				const res = await generate({ prompt: "a retro for my team" });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.refused).toBe("account-required");
				expect(typeof body.error).toBe("string");
				// Refused before the provider is reached: an open LLM proxy is the
				// thing this gate exists to not be.
				expect(lastRequest).toBeNull();
			});
		});

		test("the capability route reports the requirement, so a surface can say why", async () => {
			await withAnonymous(false, async () => {
				const body = await (await fetch(`${baseUrl}/api/deck-generation`)).json();
				expect(body.requiresAccount).toBe(true);
			});
			await withAnonymous(true, async () => {
				const body = await (await fetch(`${baseUrl}/api/deck-generation`)).json();
				expect(body.requiresAccount).toBe(false);
			});
		});

		test("the rate-limit switch cannot open it", async () => {
			// The reason this control exists rather than leaning on GENERATION_RULE:
			// OMUL_RATE_LIMITS_DISABLED is documented for a self-hoster on a
			// trusted network and would otherwise take the money limiter off with
			// the disk limiter. The whole test run has limits disabled already
			// (test-preload.ts), so this asserts the state that run is in.
			expect(process.env.OMUL_RATE_LIMITS_DISABLED).toBe("true");
			await withAnonymous(false, async () => {
				const res = await generate({ prompt: "a retro for my team" });
				expect(res.status).toBe(401);
			});
		});

		test("opened up, the anonymous caller is served again", async () => {
			await withAnonymous(true, async () => {
				const res = await generate({ prompt: "a retro for my team" });
				expect(res.status).toBe(201);
			});
		});
	});
});
