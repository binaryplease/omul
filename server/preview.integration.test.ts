/**
 * Integration tests for preview mode and test votes (REQ103, REQ104).
 *
 * Two things are under test, and the second is the one the slice stands or falls
 * on:
 *
 *   - **REQ103 — the preview renders the deck as it is.** Every slide type the
 *     catalog has shipped comes back from one call, twice: as the shared screen
 *     reads its tally and as a participant's phone reads it. The two differ on a
 *     quiz question exactly where REQ056 says they must, and every payload is
 *     the same shape the live results endpoint produces for that slide type,
 *     because it is produced by the same aggregation.
 *   - **REQ104 — a test vote is not a response.** After previewing a deck at
 *     full size, repeatedly, the presentation is still a draft nobody has voted
 *     on: no stored votes, no results, no leaderboard, no opened questions, no
 *     scorecard — and a real vote cast afterwards is the *only* thing the live
 *     tally has ever seen.
 *
 * Runs the real Elysia app against a throw-away in-memory zodstore, like
 * the p0 / quiz / grid / leaderboard harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

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

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Preview Test", slides }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function preview(
	presentationId: string,
	token: string,
	query = "",
): Promise<AnyJson> {
	const res = await authed(
		`/api/presentations/${presentationId}/preview${query}`,
		token,
	);
	expect(res.status).toBe(200);
	return res.json();
}

/** One slide's entry in a preview payload. */
function slideOf(payload: AnyJson, slideId: string): AnyJson {
	const entry = payload.slides.find((one: AnyJson) => one.slideId === slideId);
	expect(entry).toBeDefined();
	return entry;
}

// ── A deck carrying every slide type the catalog has shipped ──

const DECK: AnyJson[] = [
	{
		id: "mc",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "mc-a", text: "Weekly" },
			{ id: "mc-b", text: "Fortnightly" },
			{ id: "mc-c", text: "Monthly" },
		],
	},
	{
		id: "mc-multi",
		type: "multiple-choice",
		question: "Pick up to two",
		options: [
			{ id: "mm-a", text: "Alpha" },
			{ id: "mm-b", text: "Beta" },
			{ id: "mm-c", text: "Gamma" },
			{ id: "mm-d", text: "Delta" },
		],
		mcMaxSelections: 2,
	},
	{ id: "wc", type: "word-cloud", question: "One word for this quarter" },
	{
		id: "oe",
		type: "open-text",
		question: "What would help most?",
		allowResponseVotes: true,
	},
	{
		id: "sc",
		type: "scale",
		question: "How confident are you?",
		scaleMin: 1,
		scaleMax: 5,
	},
	{
		id: "sc-multi",
		type: "scale",
		question: "Rate each",
		scaleStatements: [
			{ id: "st-1", text: "Tooling" },
			{ id: "st-2", text: "Docs" },
		],
		scaleAllowSkip: true,
	},
	{
		id: "rk",
		type: "ranking",
		question: "Order these",
		rankingItems: [
			{ id: "rk-1", text: "Speed" },
			{ id: "rk-2", text: "Quality" },
			{ id: "rk-3", text: "Cost" },
		],
	},
	{
		id: "gr",
		type: "grid",
		question: "Place each initiative",
		gridItems: [
			{ id: "gr-1", text: "Migration" },
			{ id: "gr-2", text: "Redesign" },
		],
		gridXAxis: { title: "Effort", min: 0, max: 10, minLabel: "Low", maxLabel: "High" },
		gridYAxis: { title: "Impact", min: 0, max: 10, minLabel: "Low", maxLabel: "High" },
		gridAllowSkip: true,
	},
	{
		id: "pt",
		type: "points",
		question: "Split the budget",
		pointsItems: [
			{ id: "pt-1", text: "Hiring" },
			{ id: "pt-2", text: "Tooling" },
			{ id: "pt-3", text: "Marketing" },
		],
	},
	{
		id: "gn",
		type: "guess-number",
		question: "How many countries?",
		guessRange: { min: 0, max: 100, step: 5 },
		guessReference: { value: 45, tolerance: 5 },
	},
	{
		id: "pn",
		type: "pin-image",
		question: "Where is the bottleneck?",
		mediaUrl: "/flow.png",
		mediaAlt: "The delivery flow",
		pinArea: { x: 400, y: 300, width: 200, height: 150 },
	},
	{
		id: "qz",
		type: "quiz",
		question: "Which is the capital?",
		options: [
			{ id: "qz-a", text: "Paris", isCorrect: true },
			{ id: "qz-b", text: "Lyon" },
			{ id: "qz-c", text: "Nice" },
		],
		timeLimit: 30,
	},
	{
		id: "qz-typed",
		type: "quiz",
		question: "Name the capital",
		quizAnswerMode: "type",
		quizAnswers: [{ id: "qa-1", text: "Paris" }],
		timeLimit: 30,
	},
	{ id: "lb", type: "leaderboard", question: "Standings", leaderboardSize: 5 },
	{ id: "tx", type: "text", question: "Welcome", body: "Thanks for coming." },
	{ id: "im", type: "image", question: "The roadmap", mediaUrl: "/roadmap.png" },
	{ id: "in", type: "instruction", question: "How to join", body: "Scan the code." },
];

describe("Preview mode and test votes integration (REQ103, REQ104)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
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
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here — bun tears it
		// down with the process.
		await server?.stop();
	});

	// ── REQ103 — the preview is the deck, in both perspectives ──

	test("every slide in the deck comes back, in order, twice", async () => {
		const pres = await create(DECK);
		const payload = await preview(pres.id, pres.creatorToken);

		expect(payload.slides.map((one: AnyJson) => one.slideId)).toEqual(
			DECK.map((slide) => slide.id),
		);
		for (const entry of payload.slides) {
			expect(entry.type).toBeDefined();
			expect(entry.question).toBeDefined();
			// ADR-0024 — both perspectives are always emitted. A content slide has no
			// tally, and says so with an explicit shape rather than a missing key.
			expect(entry).toHaveProperty("presenterResults");
			expect(entry).toHaveProperty("audienceResults");
		}
	});

	test("every slide type that collects responses is populated", async () => {
		const pres = await create(DECK);
		const payload = await preview(pres.id, pres.creatorToken, "?respondents=24&seed=3");

		const populated = [
			"mc",
			"mc-multi",
			"wc",
			"oe",
			"sc",
			"sc-multi",
			"rk",
			"gr",
			"pt",
			"gn",
			"pn",
			"qz",
			"qz-typed",
		];
		for (const slideId of populated) {
			const entry = slideOf(payload, slideId);
			expect(entry.presenterResults.totalVotes).toBeGreaterThan(0);
		}
		// A leaderboard collects nothing of its own and still fills up, because the
		// quiz questions beside it did (REQ059).
		const board = slideOf(payload, "lb").presenterResults;
		expect(board.totalVotes).toBe(0);
		expect(board.quizCount).toBe(2);
		expect(board.rankedCount).toBeGreaterThan(0);
		expect(board.entries.length).toBeGreaterThan(0);
		expect(board.entries.length).toBeLessThanOrEqual(5);
	});

	test("each tally is the shape that slide type's live results endpoint produces", async () => {
		const pres = await create(DECK);
		const payload = await preview(pres.id, pres.creatorToken, "?respondents=30&seed=11");

		const choice = slideOf(payload, "mc").presenterResults;
		expect(choice.type).toBe("multiple-choice");
		expect(choice.options.map((option: AnyJson) => option.id)).toEqual([
			"mc-a",
			"mc-b",
			"mc-c",
		]);
		expect(choice.respondentCount).toBe(30);
		expect(choice.maxSelections).toBe(1);

		const multi = slideOf(payload, "mc-multi").presenterResults;
		expect(multi.maxSelections).toBe(2);
		expect(multi.totalVotes).toBeGreaterThanOrEqual(multi.respondentCount);
		expect(multi.totalVotes).toBeLessThanOrEqual(multi.respondentCount * 2);

		const cloud = slideOf(payload, "wc").presenterResults;
		expect(cloud.type).toBe("word-cloud");
		expect(cloud.words.length).toBeGreaterThan(1);
		expect(cloud.words[0].count).toBeGreaterThanOrEqual(cloud.words[1].count);

		const openText = slideOf(payload, "oe").presenterResults;
		expect(openText.allowResponseVotes).toBe(true);
		expect(openText.responses.length).toBe(openText.totalVotes);
		expect(
			openText.responses.some((response: AnyJson) => response.upvotes > 0),
		).toBe(true);

		const scale = slideOf(payload, "sc").presenterResults;
		expect(scale.average).toBeGreaterThanOrEqual(1);
		expect(scale.average).toBeLessThanOrEqual(5);

		const statements = slideOf(payload, "sc-multi").presenterResults;
		expect(statements.statements.length).toBe(2);
		for (const statement of statements.statements) {
			expect(statement.answered + statement.skipped).toBe(statement.totalVotes);
		}

		const ranking = slideOf(payload, "rk").presenterResults;
		expect(ranking.itemCount).toBe(3);
		expect(ranking.items.map((item: AnyJson) => item.rank)).toEqual([1, 2, 3]);
		expect(ranking.ballots).toBeGreaterThan(0);

		const grid = slideOf(payload, "gr").presenterResults;
		expect(grid.items.length).toBe(2);
		for (const item of grid.items) {
			expect(item.placements.length).toBe(item.placed);
			expect(item.placed + item.skipped).toBe(item.totalVotes);
		}

		const points = slideOf(payload, "pt").presenterResults;
		expect(points.budget).toBe(100);
		expect(points.totalPoints).toBe(points.ballots * 100);
		const shares = points.items.reduce(
			(sum: number, item: AnyJson) => sum + item.share,
			0,
		);
		expect(Math.round(shares)).toBe(100);

		const guess = slideOf(payload, "gn").presenterResults;
		expect(guess.guessCount).toBe(30);
		expect(guess.range).toEqual({ min: 0, max: 100, step: 5 });
		expect(guess.correctRange).toEqual({ min: 40, max: 50 });
		expect(guess.correctCount).toBeGreaterThan(0);

		const pin = slideOf(payload, "pn").presenterResults;
		expect(pin.type).toBe("pin-image");
		expect(pin.image).toEqual({ url: "/flow.png", alt: "The delivery flow" });
		expect(pin.pinCount).toBe(30);
		expect(pin.pins.length).toBe(30);
		// REQ053 — the organizer's own pane carries the target and the hit rate.
		expect(pin.correctArea).toEqual({ x: 400, y: 300, width: 200, height: 150 });
		expect(pin.correctCount).toBeGreaterThan(0);
		expect(pin.correctCount).toBeLessThan(30);

		const quiz = slideOf(payload, "qz").presenterResults;
		expect(quiz.answerMode).toBe("select");
		expect(quiz.scoring.answeredCount).toBe(30);
		expect(quiz.scoring.correctCount).toBeGreaterThan(0);
		expect(quiz.scoring.correctCount).toBeLessThan(30);
		expect(quiz.scoring.totalPoints).toBeGreaterThan(0);

		const typed = slideOf(payload, "qz-typed").presenterResults;
		expect(typed.answerMode).toBe("type");
		expect(typed.options).toEqual([]);
		expect(typed.typedAnswers.distinctCount).toBeGreaterThan(1);

		// Content slides carry the bare aggregate every slide has, and no more.
		expect(slideOf(payload, "tx").presenterResults).toEqual({
			type: "text",
			totalVotes: 0,
		});
	});

	test("the participant's perspective withholds a running quiz's answer key (REQ056)", async () => {
		const pres = await create(DECK);
		const payload = await preview(pres.id, pres.creatorToken, "?respondents=12&seed=5");

		// The shared screen is the presenter's own authoring, so it shows the marks.
		const presenterQuiz = slideOf(payload, "qz").presenterResults;
		expect(
			presenterQuiz.options.map((option: AnyJson) => option.isCorrect),
		).toEqual([true, false, false]);
		expect(slideOf(payload, "qz-typed").presenterResults.typedAnswers.accepted).toEqual(
			["Paris"],
		);

		// The phone does not, while the question is still running.
		const audienceQuiz = slideOf(payload, "qz").audienceResults;
		expect(
			audienceQuiz.options.every((option: AnyJson) => option.isCorrect === null),
		).toBe(true);
		const audienceTyped = slideOf(payload, "qz-typed").audienceResults;
		expect(audienceTyped.typedAnswers.accepted).toBeNull();
		expect(audienceTyped.typedAnswers.entries).toBeNull();
		// The counts a presenter is actually watching still read on both.
		expect(audienceTyped.respondentCount).toBe(
			slideOf(payload, "qz-typed").presenterResults.respondentCount,
		);

		// A plain choice slide has nothing to withhold, so the two agree.
		expect(slideOf(payload, "mc").audienceResults).toEqual(
			slideOf(payload, "mc").presenterResults,
		);
	});

	test("respondents=0 previews the empty deck, and the shapes still hold", async () => {
		const pres = await create(DECK);
		const payload = await preview(pres.id, pres.creatorToken, "?respondents=0");

		expect(payload.respondents).toBe(0);
		expect(payload.testVoteCount).toBe(0);
		for (const entry of payload.slides) {
			expect(entry.presenterResults.totalVotes).toBe(0);
		}
		// ADR-0024 — an empty room has no average, not an average of zero.
		expect(slideOf(payload, "gn").presenterResults.averageGuess).toBeNull();
		expect(slideOf(payload, "qz").presenterResults.scoring.averagePoints).toBeNull();
		expect(slideOf(payload, "rk").presenterResults.ballots).toBe(0);
	});

	test("the same seed and start reproduce the same run, a new seed does not", async () => {
		const pres = await create(DECK);
		const query = "?respondents=20&seed=42&startedAt=2026-08-06T10:00:00.000Z";
		const first = await preview(pres.id, pres.creatorToken, query);
		const second = await preview(pres.id, pres.creatorToken, query);
		expect(second.startedAt).toBe("2026-08-06T10:00:00.000Z");
		expect(slideOf(second, "mc").presenterResults).toEqual(
			slideOf(first, "mc").presenterResults,
		);

		const different = await preview(
			pres.id,
			pres.creatorToken,
			"?respondents=20&seed=43&startedAt=2026-08-06T10:00:00.000Z",
		);
		expect(slideOf(different, "wc").presenterResults).not.toEqual(
			slideOf(first, "wc").presenterResults,
		);
	});

	test("the run's size is honoured and bounded", async () => {
		const pres = await create(DECK);
		const big = await preview(pres.id, pres.creatorToken, "?respondents=200&seed=2");
		expect(slideOf(big, "mc").presenterResults.respondentCount).toBe(200);

		const tooBig = await authed(
			`/api/presentations/${pres.id}/preview?respondents=201`,
			pres.creatorToken,
		);
		expect(tooBig.status).toBe(422);
	});

	// ── Auth: the preview is the organizer's, not the room's ────

	test("a preview needs the deck's owner or its edit token", async () => {
		const pres = await create(DECK);

		const anonymous = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/preview`,
		);
		expect(anonymous.status).toBe(401);

		const wrongToken = await authed(
			`/api/presentations/${pres.id}/preview`,
			"not-the-token",
		);
		expect(wrongToken.status).toBe(401);
	});

	// ── REQ104 — a test vote is not a response ─────────────────

	test("previewing writes nothing: no votes, no results, no session state", async () => {
		const pres = await create(DECK);

		// Preview hard: full room, several runs, several seeds.
		for (const seed of [1, 2, 3]) {
			const payload = await preview(
				pres.id,
				pres.creatorToken,
				`?respondents=200&seed=${seed}`,
			);
			expect(payload.testVoteCount).toBeGreaterThan(1000);
		}

		// The live tally has never seen a thing.
		const liveResults = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results`,
		);
		expect(liveResults.status).toBe(200);
		for (const slideResults of await liveResults.json()) {
			expect(slideResults.totalVotes).toBe(0);
		}
		const choice = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/mc`,
		);
		expect((await choice.json()).respondentCount).toBe(0);
		// Not even the aggregate that is derived from *other* slides' votes.
		const board = await fetch(`${baseUrl}/api/presentations/${pres.id}/results/lb`);
		expect((await board.json()).rankedCount).toBe(0);

		// And the deck itself is untouched: still a draft nobody has been let into,
		// with no question opened and nothing revealed. Starting it would have ended
		// the dry run by beginning the session.
		const fetched = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const deck = await fetched.json();
		expect(deck.status).toBe("draft");
		expect(deck.slideStartedAt).toEqual({});
		expect(deck.revealedSlideIds).toEqual([]);
		expect(deck.activeSlideIndex).toBe(0);
	});

	test("no synthetic participant exists — their scorecards are empty", async () => {
		const pres = await create(DECK);
		await preview(pres.id, pres.creatorToken, "?respondents=50&seed=9");

		// The generator names its respondents `preview-participant-N`. If one of
		// them had reached the store, the deck would owe them a score.
		const card = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/scorecard?participantId=preview-participant-1`,
		);
		expect(card.status).toBe(200);
		const scorecard = await card.json();
		expect(scorecard.answeredCount).toBe(0);
		expect(scorecard.totalPoints).toBe(0);
		expect(scorecard.rank).toBeNull();
		expect(scorecard.rankedCount).toBe(0);
	});

	test("a real vote afterwards is the only thing the live tally has ever seen", async () => {
		const pres = await create(DECK);
		await preview(pres.id, pres.creatorToken, "?respondents=100&seed=4");

		const started = await authed(
			`/api/presentations/${pres.id}/start`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(started.status).toBe(200);

		const vote = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "mc",
				value: "mc-b",
				participantId: "a-real-person",
			}),
		});
		expect(vote.status).toBe(200);

		const results = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/mc`,
		);
		const tally = await results.json();
		expect(tally.totalVotes).toBe(1);
		expect(tally.respondentCount).toBe(1);
		expect(
			tally.options.find((option: AnyJson) => option.id === "mc-b").count,
		).toBe(1);
		expect(
			tally.options.find((option: AnyJson) => option.id === "mc-a").count,
		).toBe(0);

		// Previewing a live deck is still a dry run beside it, not part of it.
		const during = await preview(pres.id, pres.creatorToken, "?respondents=40&seed=8");
		expect(slideOf(during, "mc").presenterResults.respondentCount).toBe(40);
		const after = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/mc`,
		);
		expect((await after.json()).totalVotes).toBe(1);
	});
});
