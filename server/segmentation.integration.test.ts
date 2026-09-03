/**
 * Integration tests for segmented results (REQ020, REQ116).
 *
 * The requirement is one sentence — "a question's results can be broken down by
 * the answers the same participants gave to an earlier slide on the deck, joined
 * on participant id" — and every claim in it is a claim about what the wire
 * carries, so every one of them is tested over HTTP:
 *
 *   - **The join is real.** The room splits into the groups the earlier slide's
 *     options name, each group's tally counts that group and nobody else, and
 *     the groups add back up to the room the unsegmented endpoint reports.
 *   - **It is the same aggregation.** A breakdown whose groups happen to hold
 *     the whole room reproduces that slide's own tally, field for field — the
 *     thing that could only be true if no second tally was written for this.
 *   - **Earlier, and one choice from a fixed set.** A later slide, a slide
 *     grouping itself, a multi-select slide, a typed quiz question and a word
 *     cloud are each refused, with a code and the reason in words.
 *   - **It publishes nothing the tallies behind it do not.** Both slides pass
 *     the reveal-mode gate (REQ015–REQ017); the results link (REQ098) lifts that
 *     gate here as elsewhere and does not lift the small-group floor, which only
 *     a caller who can edit the deck reads past.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the results-link and
 * reveal-mode harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RESULTS_TOKEN_HEADER } from "./schemas";
import { SEGMENT_MIN_RESPONDENTS } from "./segmentation";

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

/** A request carrying the deck's edit token — the organizer's own credential. */
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

/** A request carrying the deck's results link and nothing else (REQ098). */
async function viaLink(
	path: string,
	resultsToken: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			[RESULTS_TOKEN_HEADER]: resultsToken,
		},
	});
}

/** A single-select choice slide with two named options. */
function choiceSlide(
	id: string,
	options: { id: string; text: string }[],
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		type: "multiple-choice",
		question: `Question ${id}`,
		options,
		...overrides,
	};
}

const TEAM_OPTIONS = [
	{ id: "team-a", text: "Alpha" },
	{ id: "team-b", text: "Beta" },
];
const TOPIC_OPTIONS = [
	{ id: "yes", text: "Yes" },
	{ id: "no", text: "No" },
];

/**
 * The deck every case below is run against.
 *
 * `topic` is the slide being broken down and `team` is the only slide that may
 * group it. The three between them are the refusals — a word cloud, a
 * multi-select choice slide and a typed quiz question — sitting *earlier* than
 * the target on purpose, so each is refused for its own shape rather than for
 * its position. `later` is the reverse case.
 */
function segmentableDeck() {
	return [
		choiceSlide("team", TEAM_OPTIONS),
		{ id: "cloud", type: "word-cloud", question: "One word?" },
		choiceSlide("multi", TOPIC_OPTIONS, { mcMaxSelections: 0 }),
		{
			id: "typed",
			type: "quiz",
			question: "Which year?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "a1", text: "1969" }],
		},
		choiceSlide("topic", TOPIC_OPTIONS),
		choiceSlide("later", TOPIC_OPTIONS),
		// A slide that shows something rather than asking it — the target end of the
		// refusal vocabulary.
		{ id: "title", type: "text", question: "Thanks for coming" },
	];
}

async function createAndStart(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Segmentation Test", slides, ...deck }),
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
	slideId: string,
	value: string,
	participantId: string,
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value, participantId }),
	});
	expect(res.ok).toBe(true);
}

/**
 * The room this suite reasons about, cast onto a fresh deck.
 *
 * Five participants on Alpha, three on Beta, one who answered `team` and then
 * left, and one who arrived late and answered only `topic` — so every group the
 * breakdown can produce is populated, including the one for people the grouping
 * slide has nothing to say about.
 */
async function castTheRoom(presentationId: string): Promise<void> {
	const alpha = ["p1", "p2", "p3", "p4", "p5"];
	const beta = ["p6", "p7", "p8"];
	for (const participantId of alpha) {
		await vote(presentationId, "team", "team-a", participantId);
	}
	for (const participantId of beta) {
		await vote(presentationId, "team", "team-b", participantId);
	}
	// Answered the grouping slide and nothing else — never in the breakdown.
	await vote(presentationId, "team", "team-a", "p9");

	for (const participantId of ["p1", "p2", "p3", "p6", "p7", "p10"]) {
		await vote(presentationId, "topic", "yes", participantId);
	}
	for (const participantId of ["p4", "p5", "p8"]) {
		await vote(presentationId, "topic", "no", participantId);
	}
}

/** A breakdown, read with whatever credential the caller supplies. */
async function segments(
	presentationId: string,
	slideId: string,
	by: string,
	read: (path: string) => Promise<Response> = (path) => fetch(`${baseUrl}${path}`),
): Promise<AnyJson> {
	const res = await read(
		`/api/presentations/${presentationId}/results/${slideId}/segments?by=${by}`,
	);
	expect(res.status).toBe(200);
	return res.json();
}

/** One group out of a breakdown, by the option id it stands for. */
function segmentFor(payload: AnyJson, key: string | null): AnyJson {
	const found = payload.segments.find((segment: AnyJson) => segment.key === key);
	expect(found).toBeDefined();
	return found;
}

/** An option's count out of a tally, by option id. */
function countFor(results: AnyJson, optionId: string): number {
	const option = results.options.find((entry: AnyJson) => entry.id === optionId);
	expect(option).toBeDefined();
	return option.count;
}

describe("Segmented results integration (REQ020, REQ116)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
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
		await server?.stop();
	});

	// ── The join ────────────────────────────────────────────

	test("a slide's tally splits into the groups an earlier slide's options name", async () => {
		const pres = await createAndStart(segmentableDeck());
		await castTheRoom(pres.id);

		const payload = await segments(pres.id, "topic", "team", (path) =>
			authed(path, pres.creatorToken),
		);
		expect(payload.slideId).toBe("topic");
		expect(payload.withheld).toBe(false);
		expect(payload.segmentBy).toEqual({
			slideId: "team",
			question: "Question team",
			type: "multiple-choice",
		});
		// Every authored option gets a group, in authored order, plus the explicit
		// group for people the grouping slide has nothing to say about.
		expect(payload.segments.map((segment: AnyJson) => segment.key)).toEqual([
			"team-a",
			"team-b",
			null,
		]);
		expect(payload.segments.map((segment: AnyJson) => segment.label)).toEqual([
			"Alpha",
			"Beta",
			"Did not answer",
		]);

		const alpha = segmentFor(payload, "team-a");
		expect(alpha.respondentCount).toBe(5);
		expect(countFor(alpha.results, "yes")).toBe(3);
		expect(countFor(alpha.results, "no")).toBe(2);

		const beta = segmentFor(payload, "team-b");
		expect(beta.respondentCount).toBe(3);
		expect(countFor(beta.results, "yes")).toBe(2);
		expect(countFor(beta.results, "no")).toBe(1);

		// p10 answered `topic` and never answered `team`; p9 did the reverse and is
		// in no group at all, because the breakdown is of the people this slide
		// heard from.
		const unanswered = segmentFor(payload, null);
		expect(unanswered.respondentCount).toBe(1);
		expect(countFor(unanswered.results, "yes")).toBe(1);
	});

	test("the groups add back up to the room the unsegmented endpoint reports", async () => {
		const pres = await createAndStart(segmentableDeck());
		await castTheRoom(pres.id);

		const plainRes = await authed(
			`/api/presentations/${pres.id}/results/topic`,
			pres.creatorToken,
		);
		const plain = await plainRes.json();
		const payload = await segments(pres.id, "topic", "team", (path) =>
			authed(path, pres.creatorToken),
		);

		const heads = payload.segments.reduce(
			(sum: number, segment: AnyJson) => sum + segment.respondentCount,
			0,
		);
		expect(heads).toBe(plain.respondentCount);
		for (const optionId of ["yes", "no"]) {
			const split = payload.segments.reduce(
				(sum: number, segment: AnyJson) => sum + countFor(segment.results, optionId),
				0,
			);
			expect(split).toBe(countFor(plain, optionId));
		}
	});

	test("a group holding the whole room reproduces that slide's own tally", async () => {
		// The claim this suite exists to protect: a segment is the *same*
		// aggregation over fewer people, not a second one written beside it. If a
		// field ever diverges, it diverges here first.
		const pres = await createAndStart(segmentableDeck());
		for (const participantId of ["p1", "p2", "p3"]) {
			await vote(pres.id, "team", "team-a", participantId);
			await vote(pres.id, "topic", "yes", participantId);
		}

		const plainRes = await authed(
			`/api/presentations/${pres.id}/results/topic`,
			pres.creatorToken,
		);
		const plain = await plainRes.json();
		const payload = await segments(pres.id, "topic", "team", (path) =>
			authed(path, pres.creatorToken),
		);
		expect(segmentFor(payload, "team-a").results).toEqual(plain);
	});

	test("the standings on a leaderboard slide are the group's own (REQ059)", async () => {
		// The wrapper hides other participants on *every* slide, not just the one
		// being broken down — which is the only way a segmented leaderboard can mean
		// "among these people" rather than redrawing the whole room's board.
		const pres = await createAndStart([
			{
				id: "quiz",
				type: "quiz",
				question: "Which year?",
				options: [
					{ id: "right", text: "1969", isCorrect: true },
					{ id: "wrong", text: "1972" },
				],
			},
			{ id: "board", type: "leaderboard", question: "Standings" },
		]);
		for (const participantId of ["p1", "p2", "p3", "p4", "p5"]) {
			await vote(pres.id, "quiz", "right", participantId);
		}
		for (const participantId of ["p6", "p7", "p8"]) {
			await vote(pres.id, "quiz", "wrong", participantId);
		}

		const payload = await segments(pres.id, "board", "quiz", (path) =>
			authed(path, pres.creatorToken),
		);
		expect(segmentFor(payload, "right").results.rankedCount).toBe(5);
		expect(segmentFor(payload, "wrong").results.rankedCount).toBe(3);
	});

	// ── What may group what ─────────────────────────────────

	test("only an earlier slide answered with one choice from a fixed set may group", async () => {
		const pres = await createAndStart(segmentableDeck());
		const refusals: [string, string, string][] = [
			["topic", "topic", "same-slide"],
			["team", "later", "not-earlier"],
			["topic", "cloud", "unsupported-type"],
			["topic", "multi", "multi-select"],
			["topic", "typed", "typed-answers"],
			// The target end of the pair: a slide with no tally has nothing to split.
			["title", "team", "no-tally"],
		];
		for (const [slideId, by, refused] of refusals) {
			const res = await authed(
				`/api/presentations/${pres.id}/results/${slideId}/segments?by=${by}`,
				pres.creatorToken,
			);
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.refused).toBe(refused);
			// The words a person reads travel with the code, so a client never has to
			// keep its own copy of the table.
			expect(typeof body.error).toBe("string");
			expect(body.error.length).toBeGreaterThan(0);
		}
	});

	test("a missing deck, slide or grouping is a 404, and a missing `by` is refused outright", async () => {
		const pres = await createAndStart(segmentableDeck());

		const noDeck = await fetch(
			`${baseUrl}/api/presentations/nope/results/topic/segments?by=team`,
		);
		expect(noDeck.status).toBe(404);

		const noSlide = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/nope/segments?by=team`,
		);
		expect(noSlide.status).toBe(404);

		const noSource = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/topic/segments?by=nope`,
		);
		expect(noSource.status).toBe(404);

		const noQuery = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/topic/segments`,
		);
		expect(noQuery.status).toBeGreaterThanOrEqual(400);
		expect(noQuery.status).toBeLessThan(500);
	});

	// ── What a breakdown may publish ────────────────────────

	test("a group too small to hide anybody in is suppressed, not drawn", async () => {
		const pres = await createAndStart(segmentableDeck());
		await castTheRoom(pres.id);

		const payload = await segments(pres.id, "topic", "team");
		expect(payload.minRespondents).toBe(SEGMENT_MIN_RESPONDENTS);

		// Five answered from Alpha, which is the floor exactly.
		const alpha = segmentFor(payload, "team-a");
		expect(alpha.suppressed).toBe(false);
		expect(countFor(alpha.results, "yes")).toBe(3);

		// Three from Beta and one who skipped the grouping slide. Neither their
		// answers nor their head count survives: "exactly one person skipped the
		// grouping slide and answered this" is a fact about that person, and it is
		// also the pointer that says which group is worth reconstructing.
		for (const key of ["team-b", null]) {
			const segment = segmentFor(payload, key);
			expect(segment.suppressed).toBe(true);
			expect(segment.results).toBeNull();
			expect(segment.respondentCount).toBeNull();
		}
	});

	test("a lone small group is never held back alone — the residual would be that group", async () => {
		// The attack this floor exists to stop, and the shape it is defeated by:
		// suppression decided one group at a time. Six on Alpha, one on Beta, all
		// seven answering the slide being broken down. Publish Alpha and an
		// anonymous caller subtracts it from the unsegmented tally — which the same
		// caller may read — and holds the lone Beta participant's answers.
		const pres = await createAndStart(segmentableDeck());
		const alpha = ["a1", "a2", "a3", "a4", "a5", "a6"];
		for (const participantId of alpha) {
			await vote(pres.id, "team", "team-a", participantId);
			await vote(pres.id, "topic", "yes", participantId);
		}
		await vote(pres.id, "team", "team-b", "b1");
		await vote(pres.id, "topic", "no", "b1");

		const open = await segments(pres.id, "topic", "team");
		const held = open.segments.filter((segment: AnyJson) => segment.suppressed);

		// Whatever is held back, at least two groups **holding people** are held
		// together, so no residual belongs to one of them. The true head counts come
		// from the organizer's own read, since the public one no longer carries them.
		const truth = await segments(pres.id, "topic", "team", (path) =>
			authed(path, pres.creatorToken),
		);
		const countOf = (key: string | null) => segmentFor(truth, key).respondentCount;
		const heldWithPeople = held.filter(
			(segment: AnyJson) => countOf(segment.key) > 0,
		);
		expect(heldWithPeople.length).toBeGreaterThanOrEqual(2);

		// Stated as the attacker would run it: subtract every published group from
		// the unsegmented tally and the remainder is more than one person's answers.
		const plainRes = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/topic`,
		);
		const plain = await plainRes.json();
		const published = open.segments.filter(
			(segment: AnyJson) => !segment.suppressed,
		);
		const residual = ["yes", "no"].map(
			(optionId) =>
				countFor(plain, optionId) -
				published.reduce(
					(sum: number, segment: AnyJson) => sum + countFor(segment.results, optionId),
					0,
				),
		);
		const recovered = residual.reduce((sum, count) => sum + count, 0);
		expect(recovered).toBeGreaterThan(1);
	});

	test("a tally that names individual people is not broken down for anyone but its organizer", async () => {
		// No group size makes a list of what each person wrote anonymous: the same
		// sentence is matchable across two breakdowns of the slide by two different
		// groupings, and an intersection of two large groups is one person.
		const pres = await createAndStart([
			choiceSlide("team", TEAM_OPTIONS),
			{ id: "gripe", type: "open-text", question: "What frustrates you most?" },
		]);
		const alpha = ["a1", "a2", "a3", "a4", "a5", "a6"];
		for (const participantId of alpha) {
			await vote(pres.id, "team", "team-a", participantId);
			await vote(pres.id, "gripe", `gripe from ${participantId}`, participantId);
		}
		await vote(pres.id, "team", "team-b", "b1");
		await vote(pres.id, "gripe", "my manager takes credit for my work", "b1");

		const open = await segments(pres.id, "gripe", "team");
		expect(open.withheld).toBe(true);
		expect(open.withheldReason).toBe("identifiable");
		expect(open.segments).toEqual([]);
		// Not one verbatim answer anywhere in the payload.
		expect(JSON.stringify(open)).not.toContain("takes credit");

		// The slide's own tally is still public — it is the *grouping* of it that is
		// not, and the organizer reads that in full.
		const plain = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/gripe`,
		);
		expect((await plain.json()).responses.length).toBe(7);
		const own = await segments(pres.id, "gripe", "team", (path) =>
			authed(path, pres.creatorToken),
		);
		expect(own.withheld).toBe(false);
		expect(own.withheldReason).toBeNull();
		expect(segmentFor(own, "team-b").results.responses.length).toBe(1);
	});

	test("whoever can edit the deck reads every group, whatever its size", async () => {
		const pres = await createAndStart(segmentableDeck());
		await castTheRoom(pres.id);

		const payload = await segments(pres.id, "topic", "team", (path) =>
			authed(path, pres.creatorToken),
		);
		for (const segment of payload.segments) {
			expect(segment.suppressed).toBe(false);
			expect(segment.results).not.toBeNull();
		}
	});

	test("a withheld tally is a withheld breakdown — for either slide (REQ015–REQ017)", async () => {
		const priv = await createAndStart(segmentableDeck(), {
			resultsVisibility: "private",
		});
		await castTheRoom(priv.id);
		const hidden = await segments(priv.id, "topic", "team");
		expect(hidden.withheld).toBe(true);
		expect(hidden.segments).toEqual([]);
		// The organizer still reads their own.
		const own = await segments(priv.id, "topic", "team", (path) =>
			authed(path, priv.creatorToken),
		);
		expect(own.withheld).toBe(false);

		// And the grouping slide's own mode counts too: the labels and counts of a
		// breakdown *are* that slide's tally under another name.
		const mixed = await createAndStart(
			segmentableDeck().map((slide) =>
				slide.id === "team" ? { ...slide, resultsVisibility: "private" } : slide,
			),
		);
		await castTheRoom(mixed.id);
		const half = await segments(mixed.id, "topic", "team");
		expect(half.withheld).toBe(true);
		expect(half.segments).toEqual([]);
		const plain = await fetch(
			`${baseUrl}/api/presentations/${mixed.id}/results/topic`,
		);
		// The slide's own tally is still public — only the breakdown is not.
		expect((await plain.json()).withheld).toBeUndefined();
	});

	test("the results link lifts the reveal mode and not the floor (REQ098)", async () => {
		const pres = await createAndStart(segmentableDeck(), {
			resultsVisibility: "private",
		});
		await castTheRoom(pres.id);
		const mintRes = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(mintRes.status).toBe(201);
		const resultsToken = (await mintRes.json()).resultsToken as string;

		const payload = await segments(pres.id, "topic", "team", (path) =>
			viaLink(path, resultsToken),
		);
		expect(payload.withheld).toBe(false);
		expect(segmentFor(payload, "team-a").suppressed).toBe(false);
		// A group of three is one participant away from being three names; a link
		// the organizer forwarded delegates their numbers, not their room.
		expect(segmentFor(payload, "team-b").suppressed).toBe(true);
		expect(segmentFor(payload, "team-b").results).toBeNull();
	});
});
