/**
 * Integration tests for the abuse limits on the live routes (REQ145): that
 * create, join, vote and sharing a deck are actually guarded, that over-limit
 * answers a 429
 * carrying a retry hint, that one client's exhaustion does not spill onto
 * another, and that the environment switch takes the whole thing off.
 *
 * The suite runs with `OMUL_TRUST_PROXY=true` so each case can name its own
 * client address through `X-Forwarded-For`; the run's default (proxy headers
 * distrusted) is exercised in `rate-limit.test.ts`.
 */

// Env must be set before importing ./db (read at module load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
	CREATE_RULE,
	GENERATION_RULE,
	guardJoin,
	guardReaction,
	guardSubmission,
	JOIN_RULE,
	REACTION_PARTICIPANT_RULE,
	resetRateLimits,
	SUBMISSION_PARTICIPANT_RULE,
} from "./rate-limit";

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
	},
];

/** Create a deck, sending the given headers verbatim. */
function create(headers: Record<string, string> = {}): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ title: "Deck", slides: SLIDES }),
	});
}

/** Create a deck as the given client address. */
function createAs(address: string): Promise<Response> {
	return create({ "X-Forwarded-For": address });
}

/**
 * Generate a deck as the given client address (REQ007). The app below mounts
 * the generation routes over a stub generator, so this suite reaches a provider
 * no more than any other one does.
 */
function generateAs(address: string): Promise<Response> {
	return fetch(`${baseUrl}/api/deck-generation`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Forwarded-For": address,
		},
		body: JSON.stringify({ prompt: "a retro for my team" }),
	});
}

/**
 * Spend `count` hits of a module-level window directly, as `address` would.
 * The guards are the same instances the routes hold, so this exhausts a client
 * without paying for hundreds of HTTP round trips — the route can then be hit
 * once to prove it consults the guard at all.
 */
function fabricatedRequest(address: string): Request {
	return new Request("http://omul.test/", {
		headers: { "X-Forwarded-For": address },
	});
}

describe("rate limits on create, join and vote (REQ145)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { createDeckGenerator } = await import("./deck-generator");
		const { createDeckGenerationRoutes } = await import(
			"./routes/deck-generation"
		);
		const { Elysia } = await import("elysia");

		await connectDb();

		// The generation routes over a stub: this suite's subject is the budget, not
		// the provider, and no test run may reach one (REQ007).
		const generator = createDeckGenerator({
			model: async () => ({
				title: "Sprint retrospective",
				slides: [
					{ type: "instruction", question: "Join the retro" },
					{ type: "open-text", question: "What should we change?" },
					{ type: "scale", question: "How did it go?" },
				],
			}),
		});

		const app = new Elysia()
			.use(createDeckGenerationRoutes(generator))
			.use(presentationRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		// This is the one suite whose subject is the limit itself: turn the
		// protection the preload switched off back on, and let each case name its
		// own client address.
		delete process.env.OMUL_RATE_LIMITS_DISABLED;
		process.env.OMUL_TRUST_PROXY = "true";
		// The generation route's *other* control is an account (REQ007), and it
		// would refuse these anonymous calls 401 before they ever reached a
		// counter. This suite's subject is the counter, so it opts out of the gate
		// deliberately — the gate itself is exercised in
		// `deck-generation.integration.test.ts`.
		process.env.OMUL_GENERATION_ALLOW_ANONYMOUS = "true";
	});

	afterAll(async () => {
		await server?.stop();
		// Hand the rest of the run back the state the preload established.
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		delete process.env.OMUL_TRUST_PROXY;
		delete process.env.OMUL_GENERATION_ALLOW_ANONYMOUS;
		resetRateLimits();
	});

	beforeEach(() => {
		resetRateLimits();
	});

	test("create is refused with a 429 and a retry hint once the window is full", async () => {
		const address = "203.0.113.1";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			expect((await createAs(address)).status).toBe(201);
		}

		const refused = await createAs(address);
		expect(refused.status).toBe(429);

		const retryAfter = Number(refused.headers.get("Retry-After"));
		expect(retryAfter).toBeGreaterThanOrEqual(1);
		expect(retryAfter).toBeLessThanOrEqual(CREATE_RULE.windowMs / 1000);

		const body: Any = await refused.json();
		expect(typeof body.error).toBe("string");
		expect(body.retryAfterSeconds).toBe(retryAfter);
	});

	test("a caller-prepended forwarded hop buys no extra budget", async () => {
		// The proxy appends what it saw, so every request below reaches the server
		// as "<the caller's invention>, 203.0.113.20". Counting the caller's entry
		// would hand out a fresh window per request and void the limit entirely.
		const peer = "203.0.113.20";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			const spoofed = await create({
				"X-Forwarded-For": `10.${attempt}.0.1, ${peer}`,
			});
			expect(spoofed.status).toBe(201);
		}
		const refused = await create({
			"X-Forwarded-For": `10.255.255.255, ${peer}`,
		});
		expect(refused.status).toBe(429);
	});

	test("with proxy trust off, the socket address is what counts", async () => {
		// The default posture — a self-hoster with no proxy in front. Every request
		// below comes from loopback and claims a different forwarded address; the
		// header must be ignored outright, so they all share one window.
		delete process.env.OMUL_TRUST_PROXY;
		try {
			for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
				const claimed = await create({
					"X-Forwarded-For": `198.51.100.${attempt}`,
					"X-Real-IP": `198.51.100.${attempt}`,
				});
				expect(claimed.status).toBe(201);
			}
			const refused = await create({
				"X-Forwarded-For": "198.51.100.254",
				"X-Real-IP": "198.51.100.254",
			});
			expect(refused.status).toBe(429);
			expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(
				1,
			);

			// And a plain request with no headers at all shares that same window.
			expect((await create()).status).toBe(429);
		} finally {
			process.env.OMUL_TRUST_PROXY = "true";
		}
	});

	test("one client's exhaustion does not limit another", async () => {
		const exhausted = "203.0.113.2";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			expect((await createAs(exhausted)).status).toBe(201);
		}
		expect((await createAs(exhausted)).status).toBe(429);

		// A different address still has its full budget.
		expect((await createAs("203.0.113.3")).status).toBe(201);
	});

	test("an IPv6 client cannot rotate source addresses for a fresh budget", async () => {
		// A subscriber is handed a routed /64 and may source from any of the 2^64
		// addresses in it. Keyed on the full address, the ceiling would be
		// unreachable — one machine walking its own prefix gets a new window per
		// request, which is the bypass the forwarded-header rules refuse and this
		// one would leave wide open.
		const prefix = "2001:db8:c0ff:ee00";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			expect((await createAs(`${prefix}::${attempt.toString(16)}`)).status).toBe(
				201,
			);
		}
		expect((await createAs(`${prefix}:aaaa:bbbb:cccc:dddd`)).status).toBe(429);

		// A neighbouring /64 is a different subscriber and keeps its own budget.
		expect((await createAs("2001:db8:c0ff:ee01::1")).status).toBe(201);
	});

	test("IPv4 clients are not collapsed by the IPv6 truncation", async () => {
		// Bun reports an IPv4 peer on a dual-stack socket as `::ffff:a.b.c.d`.
		// Read as an IPv6 address and truncated, every IPv4 visitor on the
		// internet would land in one `::/64` bucket.
		const first = "::ffff:203.0.113.30";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			expect((await createAs(first)).status).toBe(201);
		}
		expect((await createAs(first)).status).toBe(429);

		// The next IPv4 address along is a different client, mapped form or not.
		expect((await createAs("::ffff:203.0.113.31")).status).toBe(201);
		expect((await createAs("203.0.113.32")).status).toBe(201);
	});

	test("generation is refused with a 429 on a budget of its own (REQ007)", async () => {
		// A generation spends a *third party's* call on the operator's credential,
		// so its ceiling is far below the create one it also spends. Five drafts,
		// then a 429 that names generating rather than creating.
		const address = "203.0.113.40";
		for (let attempt = 0; attempt < GENERATION_RULE.limit; attempt++) {
			expect((await generateAs(address)).status).toBe(201);
		}

		const refused = await generateAs(address);
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
		const body: Any = await refused.json();
		expect(body.error).toContain("generated");

		// The tighter ceiling is reached first, so an exhausted generator has not
		// also had its create budget taken — the ordinary door still opens.
		expect((await createAs(address)).status).toBe(201);
	});

	test("a generate also spends the create budget it writes against (REQ007)", async () => {
		// Being the more expensive door in must not make it the cheaper way
		// through the disk ceiling. Exhaust create, then find generation refused
		// for that reason rather than answering 201.
		const address = "203.0.113.41";
		for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
			expect((await createAs(address)).status).toBe(201);
		}
		const refused = await generateAs(address);
		expect(refused.status).toBe(429);
	});

	test("join is refused with a 429 once its window is full", async () => {
		const address = "203.0.113.4";
		const context = { request: fabricatedRequest(address), server: null };
		for (let attempt = 0; attempt < JOIN_RULE.limit; attempt++) {
			expect(guardJoin(context)).toBeNull();
		}

		const refused = await fetch(`${baseUrl}/api/join/000000`, {
			headers: { "X-Forwarded-For": address },
		});
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);

		// An unexhausted client still reaches the handler — 404 for a code that
		// resolves to nothing, not a 429.
		const allowed = await fetch(`${baseUrl}/api/join/000000`, {
			headers: { "X-Forwarded-For": "203.0.113.5" },
		});
		expect(allowed.status).toBe(404);
	});

	test("a vote is refused once the participant's own window is full", async () => {
		const participantId = "participant-exhausted";
		// Spend the per-participant budget from an address that is not the one the
		// HTTP call will use, so it is unambiguously the participant window that
		// refuses.
		const context = { request: fabricatedRequest("203.0.113.6"), server: null };
		for (
			let attempt = 0;
			attempt < SUBMISSION_PARTICIPANT_RULE.limit;
			attempt++
		) {
			expect(guardSubmission(context, participantId)).toBeNull();
		}

		const vote = (participant: string) =>
			fetch(`${baseUrl}/api/presentations/does-not-exist/vote`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "203.0.113.7",
				},
				body: JSON.stringify({
					slideId: "s1",
					value: "a",
					participantId: participant,
				}),
			});

		const refused = await vote(participantId);
		expect(refused.status).toBe(429);
		const body: Any = await refused.json();
		expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);

		// A participant with budget left reaches the handler, which turns the vote
		// away for its own reason (400) rather than for the limit.
		expect((await vote("participant-fresh")).status).toBe(400);
	});

	test("sharing a deck is budgeted, so it cannot be used to probe for accounts", async () => {
		// `POST …/collaborators` answers `404` for an address with no account and
		// `201` for one that has — a distinction an invite flow needs and an
		// enumerator would like at full speed (REQ075). The budget is spent per
		// deck, and the guard runs *before* the owner check and the account
		// lookup, so what is refused here is the probe itself rather than the
		// caller's standing.
		const deckId = "deck-being-probed";
		const context = { request: fabricatedRequest("203.0.113.40"), server: null };
		for (
			let attempt = 0;
			attempt < SUBMISSION_PARTICIPANT_RULE.limit;
			attempt++
		) {
			expect(guardSubmission(context, `share:${deckId}`)).toBeNull();
		}

		const probe = (deck: string) =>
			fetch(`${baseUrl}/api/presentations/${deck}/collaborators`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "203.0.113.41",
				},
				body: JSON.stringify({ email: "probe@example.com", level: "view" }),
			});

		const refused = await probe(deckId);
		expect(refused.status).toBe(429);
		const body: Any = await refused.json();
		expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);

		// Another deck still has its own budget, and reaches the owner gate — which
		// turns the call away for its own reason (401, no session) rather than for
		// the limit.
		expect((await probe("another-deck")).status).toBe(401);
	});

	// ── Reactions have their own budget (REQ077, REQ145) ──────
	//
	// The failure these two cases exist to prevent: a reaction is one tap with no
	// confirmation, so an enthusiastic participant reaches a shared per-participant
	// ceiling during a single applause moment — and the next thing they do is
	// answer the quiz question the presenter has just opened, on a bounded window
	// (REQ057). If the two shared a counter, the answer would be lost for good.
	// An answer is the payload; a reaction is decoration.

	test("reacting to exhaustion still leaves the participant able to vote", async () => {
		const participantId = "participant-tapping";
		const context = { request: fabricatedRequest("203.0.113.30"), server: null };

		// Spend the whole reaction budget, and one past it.
		for (
			let attempt = 0;
			attempt < REACTION_PARTICIPANT_RULE.limit;
			attempt++
		) {
			expect(guardReaction(context, participantId)).toBeNull();
		}
		expect(guardReaction(context, participantId)).not.toBeNull();

		// The submission budget is untouched: the vote goes through to the handler,
		// which turns it away for its own reason (400 — no such deck) rather than
		// for the limit.
		const vote = await fetch(
			`${baseUrl}/api/presentations/does-not-exist/vote`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "203.0.113.31",
				},
				body: JSON.stringify({ slideId: "s1", value: "a", participantId }),
			},
		);
		expect(vote.status).not.toBe(429);
		expect(vote.status).toBe(400);
	});

	test("voting to exhaustion does not silently close the reaction channel", async () => {
		// And the other direction, because the separation has to hold both ways: a
		// participant who has spent their submissions can still react.
		const participantId = "participant-voting";
		const context = { request: fabricatedRequest("203.0.113.32"), server: null };
		for (
			let attempt = 0;
			attempt < SUBMISSION_PARTICIPANT_RULE.limit;
			attempt++
		) {
			expect(guardSubmission(context, participantId)).toBeNull();
		}
		expect(guardSubmission(context, participantId)).not.toBeNull();

		const reacted = await fetch(
			`${baseUrl}/api/presentations/does-not-exist/reactions`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "203.0.113.33",
				},
				body: JSON.stringify({ kind: "like", participantId }),
			},
		);
		expect(reacted.status).not.toBe(429);
		expect(reacted.status).toBe(400);
	});

	test("an over-limit reaction says it was the reactions, and carries a retry hint", async () => {
		const participantId = "participant-flooding";
		const context = { request: fabricatedRequest("203.0.113.34"), server: null };
		for (
			let attempt = 0;
			attempt < REACTION_PARTICIPANT_RULE.limit;
			attempt++
		) {
			expect(guardReaction(context, participantId)).toBeNull();
		}

		const refused = await fetch(
			`${baseUrl}/api/presentations/does-not-exist/reactions`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": "203.0.113.35",
				},
				body: JSON.stringify({ kind: "like", participantId }),
			},
		);
		expect(refused.status).toBe(429);
		const body: Any = await refused.json();
		// Named for what the participant was doing — being told to slow down on
		// "submissions" when you were tapping a heart reads as a broken feature.
		expect(body.error).toContain("reactions");
		expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
	});

	test("the environment switch takes every limit off", async () => {
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		try {
			const address = "203.0.113.8";
			for (let attempt = 0; attempt < CREATE_RULE.limit + 5; attempt++) {
				expect((await createAs(address)).status).toBe(201);
			}
			const joined = await fetch(`${baseUrl}/api/join/000000`, {
				headers: { "X-Forwarded-For": address },
			});
			expect(joined.status).toBe(404);
		} finally {
			delete process.env.OMUL_RATE_LIMITS_DISABLED;
		}
	});
});
