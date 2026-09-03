/**
 * Integration tests for the quiz competition (REQ054, REQ056, REQ057).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ054 — participants pick an option; the room's tally reads as a choice
 *     slide's does, with a score riding alongside it
 *   - REQ056 — points are awarded automatically from the marked solution, the
 *     scorecard adds them up per participant, and re-marking re-scores
 *   - REQ057 — a question opens when the presenter reaches it, closes
 *     `timeLimit` seconds later, and the boundary refuses what arrives after
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / mc /
 * ranking / grid / points harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	QUIZ_CORRECT_POINTS,
	QUIZ_MAX_POINTS,
	QUIZ_SUBMISSION_GRACE_MS,
} from "./schemas";

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

/** A two-option quiz slide whose second option is the marked solution. */
function quizSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		options: [
			{ id: "venus", text: "Venus" },
			{ id: "mercury", text: "Mercury", isCorrect: true },
			{ id: "mars", text: "Mars" },
		],
		timeLimit: 30,
		...overrides,
	};
}

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Quiz Test", slides }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

async function createAndStart(slides: AnyJson[] = [quizSlide()]): Promise<AnyJson> {
	const pres = await create(slides);
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

/** Submit one participant's answer to a quiz question. */
async function answer(
	presentationId: string,
	participantId: string,
	optionId: string,
	slideId = "qz",
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value: optionId, participantId }),
	});
}

/**
 * Read a slide's tally. Without a token this is the room's view, which is what
 * a competitor's browser receives; with one it is the deck editor's (REQ056).
 */
async function results(
	presentationId: string,
	slideId = "qz",
	token?: string,
): Promise<AnyJson> {
	const res = token
		? await authed(`/api/presentations/${presentationId}/results/${slideId}`, token)
		: await fetch(
				`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
			);
	expect(res.status).toBe(200);
	return await res.json();
}

async function scorecard(
	presentationId: string,
	participantId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/scorecard?participantId=${participantId}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

async function fetchPresentation(
	presentationId: string,
	token?: string,
): Promise<AnyJson> {
	const res = token
		? await authed(`/api/presentations/${presentationId}`, token)
		: await fetch(`${baseUrl}/api/presentations/${presentationId}`);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The participants' door — never authorized, whoever knocks. */
async function joinByCode(code: string): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/join/${code}`);
	expect(res.status).toBe(200);
	return await res.json();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("quiz competition integration", () => {
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

	// ── REQ054 — what the organizer authored ───────────────────

	test("the marked solution and the time limit round-trip for the deck's editor", async () => {
		const pres = await createAndStart();
		const fetched = await fetchPresentation(pres.id, pres.creatorToken);
		expect(fetched.slides[0].type).toBe("quiz");
		expect(fetched.slides[0].timeLimit).toBe(30);
		expect(
			fetched.slides[0].options.map((option: AnyJson) => option.isCorrect),
		).toEqual([undefined, true, undefined]);
	});

	// ── REQ056 — the answer key never reaches a competitor early ─

	test("the deck a participant joins with carries no answer key", async () => {
		// The whole deck arrives at the join, so a quiz three slides ahead would
		// otherwise land answered — read straight out of the network tab.
		const pres = await createAndStart([
			quizSlide(),
			quizSlide({ id: "qz2", question: "Second" }),
		]);
		const joined = await joinByCode(pres.code);
		for (const slide of joined.slides) {
			for (const option of slide.options) {
				expect(option.isCorrect).toBeUndefined();
			}
		}
		expect(JSON.stringify(joined)).not.toContain("isCorrect");
	});

	test("an unauthorized fetch of a running question carries no answer key", async () => {
		const pres = await createAndStart();
		const fetched = await fetchPresentation(pres.id);
		expect(
			fetched.slides[0].options.map((option: AnyJson) => option.isCorrect),
		).toEqual([undefined, undefined, undefined]);
	});

	test("the tally withholds the solution while the question runs, and the editor's does not", async () => {
		// Every answer that lands re-broadcasts this payload to the whole room, so
		// a flag here is a flag in every competitor's browser mid-question.
		const pres = await createAndStart();
		await answer(pres.id, "p1", "venus");

		const audience = await results(pres.id);
		expect(audience.options.map((option: AnyJson) => option.isCorrect)).toEqual(
			[null, null, null],
		);
		// The shared screen is the presenter's, and they authored the answer.
		const presenter = await results(pres.id, "qz", pres.creatorToken);
		expect(
			presenter.options.map((option: AnyJson) => option.isCorrect),
		).toEqual([false, true, false]);
	});

	test("the solution reaches the room once the question is over", async () => {
		const pres = await createAndStart([quizSlide({ timeLimit: 1 })]);
		await answer(pres.id, "p1", "mercury");
		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);

		const payload = await results(pres.id);
		expect(payload.scoring.closed).toBe(true);
		expect(payload.options.map((option: AnyJson) => option.isCorrect)).toEqual([
			false,
			true,
			false,
		]);
		const fetched = await fetchPresentation(pres.id);
		expect(
			fetched.slides[0].options.map((option: AnyJson) => option.isCorrect),
		).toEqual([undefined, true, undefined]);
	}, 10_000);

	test("a deliberate reveal opens the solution on an untimed question (REQ102)", async () => {
		// An untimed question has no deadline to wait for, so the presenter's
		// reveal is the signal that it is over.
		const pres = await createAndStart([quizSlide({ timeLimit: 0 })]);
		expect((await results(pres.id)).options[1].isCorrect).toBe(null);

		const reveal = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(reveal.status).toBe(200);
		expect((await results(pres.id)).options[1].isCorrect).toBe(true);
		expect((await joinByCode(pres.code)).slides[0].options[1].isCorrect).toBe(
			true,
		);
	});

	test("ending the presentation opens the solution to everyone", async () => {
		const pres = await createAndStart([quizSlide({ timeLimit: 0 })]);
		expect((await joinByCode(pres.code)).slides[0].options[1].isCorrect).toBe(
			undefined,
		);
		const end = await authed(
			`/api/presentations/${pres.id}/end`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(end.status).toBe(200);
		expect((await joinByCode(pres.code)).slides[0].options[1].isCorrect).toBe(
			true,
		);
	});

	test("a plain choice slide still reveals its solution as it always did (REQ013)", async () => {
		// The withholding is a quiz rule. A knowledge check keeps no score, and
		// hiding its answer key from its own tally would leave it pointless.
		const pres = await createAndStart([
			{
				id: "mc",
				type: "multiple-choice",
				question: "Pick one",
				options: [
					{ id: "a", text: "A", isCorrect: true },
					{ id: "b", text: "B" },
				],
			},
		]);
		expect((await joinByCode(pres.code)).slides[0].options[0].isCorrect).toBe(
			true,
		);
		expect((await results(pres.id, "mc")).options[0].isCorrect).toBe(true);
	});

	test("an empty results payload is well-formed before any answer lands", async () => {
		const pres = await createAndStart();
		const payload = await results(pres.id);
		expect(payload.type).toBe("quiz");
		expect(payload.totalVotes).toBe(0);
		expect(payload.scoring.answeredCount).toBe(0);
		expect(payload.scoring.correctCount).toBe(0);
		expect(payload.scoring.totalPoints).toBe(0);
		expect(payload.scoring.maxPoints).toBe(QUIZ_MAX_POINTS);
		expect(payload.scoring.timeLimit).toBe(30);
		// No answers means no average and no share at all — an explicit
		// null, not a 0 that would read as a room that answered and was all wrong.
		expect(payload.scoring.averagePoints).toBe(null);
		expect(payload.scoring.correctShare).toBe(null);
	});

	// ── REQ056 — points, awarded automatically ─────────────────

	test("a correct answer scores and a wrong one does not", async () => {
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "mercury")).status).toBe(200);
		expect((await answer(pres.id, "p2", "venus")).status).toBe(200);

		const payload = await results(pres.id);
		expect(payload.scoring.answeredCount).toBe(2);
		expect(payload.scoring.correctCount).toBe(1);
		expect(payload.scoring.correctShare).toBe(50);

		expect((await scorecard(pres.id, "p1")).totalPoints).toBeGreaterThanOrEqual(
			QUIZ_CORRECT_POINTS,
		);
		expect((await scorecard(pres.id, "p2")).totalPoints).toBe(0);
	});

	test("a fast correct answer outscores a slower one (REQ054)", async () => {
		const pres = await createAndStart([quizSlide({ timeLimit: 20 })]);
		await answer(pres.id, "fast", "mercury");
		await wait(600);
		await answer(pres.id, "slow", "mercury");

		const quick = (await scorecard(pres.id, "fast")).slides[0];
		const late = (await scorecard(pres.id, "slow")).slides[0];
		expect(quick.isCorrect).toBe(true);
		expect(late.isCorrect).toBe(true);
		expect(quick.points).toBeGreaterThan(late.points);
		// Both banked the correctness half; only the bonus separates them.
		expect(late.points).toBeGreaterThanOrEqual(QUIZ_CORRECT_POINTS);
		expect(quick.points).toBeLessThanOrEqual(QUIZ_MAX_POINTS);
	});

	test("the room's tally never names who answered", async () => {
		// The results endpoint is public and a participant id is the only
		// credential a vote carries, so scores are reported anonymously.
		const pres = await createAndStart();
		await answer(pres.id, "secret-participant", "mercury");
		const payload = JSON.stringify(await results(pres.id));
		expect(payload).not.toContain("secret-participant");
		expect(payload).not.toContain("participantId");
	});

	test("a quiz slide with no marked answer scores nobody", async () => {
		const pres = await createAndStart([
			quizSlide({
				options: [
					{ id: "venus", text: "Venus" },
					{ id: "mercury", text: "Mercury" },
				],
			}),
		]);
		await answer(pres.id, "p1", "mercury");

		const payload = await results(pres.id);
		expect(payload.scoring.answeredCount).toBe(1);
		expect(payload.scoring.correctCount).toBe(0);
		expect(payload.scoring.totalPoints).toBe(0);
		expect((await scorecard(pres.id, "p1")).slides[0].isCorrect).toBe(false);
	});

	test("re-marking the correct answer re-scores the room (REQ056)", async () => {
		// Scores are derived from the slide as it stands now, never stored, so an
		// organizer fixing a mis-marked solution needs no migration.
		const pres = await createAndStart();
		await answer(pres.id, "p1", "venus");
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(0);

		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						quizSlide({
							options: [
								{ id: "venus", text: "Venus", isCorrect: true },
								{ id: "mercury", text: "Mercury" },
								{ id: "mars", text: "Mars" },
							],
						}),
					],
				}),
			},
		);
		expect(patch.status).toBe(200);
		expect(
			(await scorecard(pres.id, "p1")).totalPoints,
		).toBeGreaterThanOrEqual(QUIZ_CORRECT_POINTS);
		expect((await results(pres.id)).scoring.correctCount).toBe(1);
	});

	test("an answer to an option the slide does not have is refused", async () => {
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "pluto")).status).toBe(400);
		expect((await results(pres.id)).totalVotes).toBe(0);
	});

	// ── REQ054 — an answer is final ────────────────────────────

	test("a participant cannot change their answer", async () => {
		// Speed is part of the score, so a second answer would let someone bank a
		// fast time and then correct it once the room reacted.
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "venus")).status).toBe(200);
		expect((await answer(pres.id, "p1", "mercury")).status).toBe(400);

		const payload = await results(pres.id);
		expect(payload.totalVotes).toBe(1);
		expect(payload.scoring.correctCount).toBe(0);
		expect(
			payload.options.find((option: AnyJson) => option.id === "venus").count,
		).toBe(1);
	});

	test("answers arriving at once leave the participant holding one (REQ054)", async () => {
		// The one-answer rule is a read-modify-write: the "has this participant
		// answered yet?" lookup awaits, and without a queue the next submission
		// runs in that gap and reads the state that predated the first one's
		// insert. Both then write. A double-tap or a retried POST is enough, and a
		// quiz — unlike every other slide type — permanently refuses the later
		// submission that would have collapsed the extras, so both rows would
		// stand for the rest of the session.
		//
		// Driven through the service rather than over HTTP, which is the only way
		// to reproduce it deterministically: three `fetch` calls are three round
		// trips that may or may not land in the same event-loop gap, so an HTTP
		// version of this test passes against the bug about as often as it fails.
		// The gap is at the service boundary, so that is where it is provoked —
		// the route above it is the rate-limit guard, this call, and a status code.
		const pres = await createAndStart();
		const { submitVote, isVoteRefusal } = await import(
			"./services/presentations"
		);
		const outcomes = await Promise.all(
			["mercury", "venus", "mars"].map((optionId) =>
				submitVote(pres.id, "qz", optionId, "p1"),
			),
		);

		// Exactly one lands; the rest meet the rule they were always meant to meet,
		// which the route turns into the 400 the neighbouring cases assert on.
		const stored = outcomes.filter(
			(outcome) => outcome !== null && !isVoteRefusal(outcome),
		);
		expect(stored.length).toBe(1);
		for (const refused of outcomes.filter(isVoteRefusal)) {
			expect(refused.refused).toBe("quiz-already-answered");
		}

		const payload = await results(pres.id, "qz", pres.creatorToken);
		expect(payload.totalVotes).toBe(1);
		expect(payload.respondentCount).toBe(1);
		expect(payload.scoring.answeredCount).toBe(1);
		// One person, one bar — never one person spread across three of them.
		expect(
			payload.options.reduce(
				(sum: number, option: AnyJson) => sum + option.count,
				0,
			),
		).toBe(1);
		// A share over people, not over rows: whatever landed, this room is either
		// wholly right or wholly wrong.
		expect([0, 100]).toContain(payload.scoring.correctShare);
	});

	test("a deck already holding two answers from one participant reads as one", async () => {
		// The write path above stops new duplicates; this is the other half. A deck
		// may already hold two standing rows for one participant — written before
		// that path was queued — and a read that counted both would report a room
		// that does not exist: one respondent beside two answers, and a correct
		// share of 50% on a question that one person got right.
		//
		// Written straight into the collection because `submitVote` will no longer
		// produce the state under test. It is the same `votes` table the service
		// holds, reached through a second handle on it.
		const pres = await createAndStart();
		const { createStore } = await import("./db");
		const { StoredVoteSchema } = await import("./schemas");
		const voteStore = createStore("votes", StoredVoteSchema);
		for (const value of ["mercury", "venus"]) {
			await voteStore.insert({
				presentationId: pres.id,
				slideId: "qz",
				value,
				participantId: "p1",
				statementId: null,
				skip: false,
				createdAt: new Date().toISOString(),
			});
		}

		const payload = await results(pres.id, "qz", pres.creatorToken);
		expect(payload.respondentCount).toBe(1);
		expect(payload.totalVotes).toBe(1);
		expect(payload.scoring.answeredCount).toBe(1);
		// The first answer is the one that stands, so the tally reads the room as
		// having got it right — not as half right across two rows.
		expect(payload.scoring.correctCount).toBe(1);
		expect(payload.scoring.correctShare).toBe(100);
		expect(
			payload.options.find((option: AnyJson) => option.id === "mercury").count,
		).toBe(1);
		expect(
			payload.options.find((option: AnyJson) => option.id === "venus").count,
		).toBe(0);

		// And the scorecard and the standings agree with the bars beside them,
		// rather than each silently picking one of the two rows.
		const card = await scorecard(pres.id, "p1");
		expect(card.answeredCount).toBe(1);
		expect(card.correctCount).toBe(1);
		expect(card.totalPoints).toBe(payload.scoring.totalPoints);
		expect(card.rankedCount).toBe(1);
	});

	test("a refused quiz answer says which rule refused it", async () => {
		// "You were too slow" and "the presentation isn't live" are not the same
		// news for the participant reading the toast.
		const pres = await createAndStart([quizSlide({ timeLimit: 1 })]);
		await answer(pres.id, "p1", "venus");

		const repeat = await answer(pres.id, "p1", "mercury");
		expect(repeat.status).toBe(400);
		expect((await repeat.json()).error).toContain("final");

		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);
		const late = await answer(pres.id, "p2", "mercury");
		expect(late.status).toBe(400);
		expect((await late.json()).error).toContain("time");
	}, 10_000);

	test("a quiz answer without a participant id is refused", async () => {
		// Under the one-answer rule the first id-less request would otherwise lock
		// out every other one — a scripted room sharing a single answer.
		const pres = await createAndStart();
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "qz", value: "mercury" }),
		});
		expect(res.status).toBe(400);
		expect((await results(pres.id)).totalVotes).toBe(0);
	});

	test("an answer whose option was re-authored away does not lock the participant out", async () => {
		// The tally already drops a row it cannot score; leaving it to block a
		// replacement would strand the participant on a question they can see.
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "venus")).status).toBe(200);

		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						quizSlide({
							options: [
								{ id: "mercury", text: "Mercury", isCorrect: true },
								{ id: "mars", text: "Mars" },
							],
						}),
					],
				}),
			},
		);
		expect(patch.status).toBe(200);

		expect((await answer(pres.id, "p1", "mercury")).status).toBe(200);
		const payload = await results(pres.id);
		// The stale row is gone rather than sitting alongside the new one.
		expect(payload.totalVotes).toBe(1);
		expect(payload.scoring.answeredCount).toBe(1);
		expect(payload.scoring.correctCount).toBe(1);
		// And the answer is final again from here.
		expect((await answer(pres.id, "p1", "mars")).status).toBe(400);
	});

	// ── REQ056 — the participant's own scorecard ───────────────

	test("the scorecard adds a deck's quiz questions up per participant", async () => {
		const pres = await createAndStart([
			quizSlide(),
			quizSlide({ id: "qz2", question: "Second" }),
			{ id: "mc", type: "multiple-choice", question: "Not a quiz", options: [] },
		]);
		await answer(pres.id, "p1", "mercury", "qz");
		await answer(pres.id, "p1", "venus", "qz2");

		const card = await scorecard(pres.id, "p1");
		// Only the quiz slides are scored; the choice slide keeps no score.
		expect(card.quizCount).toBe(2);
		expect(card.maxPoints).toBe(2 * QUIZ_MAX_POINTS);
		expect(card.answeredCount).toBe(2);
		expect(card.correctCount).toBe(1);
		expect(card.totalPoints).toBe(card.slides[0].points);
		expect(card.slides.map((slide: AnyJson) => slide.slideId)).toEqual([
			"qz",
			"qz2",
		]);
	});

	test("an unanswered question is spelled with explicit nulls", async () => {
		const pres = await createAndStart();
		const card = await scorecard(pres.id, "never-answered");
		expect(card.answeredCount).toBe(0);
		const slide = card.slides[0];
		expect(slide.answered).toBe(false);
		// A `false` here would claim they answered and got it wrong.
		expect(slide).toHaveProperty("isCorrect");
		expect(slide.isCorrect).toBe(null);
		expect(slide.optionId).toBe(null);
		expect(slide.elapsedMs).toBe(null);
		expect(slide.points).toBe(0);
	});

	test("a scorecard for a presentation that does not exist is a 404", async () => {
		const res = await fetch(
			`${baseUrl}/api/presentations/nope/scorecard?participantId=p1`,
		);
		expect(res.status).toBe(404);
	});

	// ── REQ057 — the question's window ─────────────────────────

	test("going live opens the first question and publishes its deadline", async () => {
		const pres = await createAndStart();
		const fetched = await fetchPresentation(pres.id);
		const startedAt = fetched.slideStartedAt.qz;
		expect(typeof startedAt).toBe("string");
		// The client renders its countdown against the same clock the deadline was
		// written in, so the response carries the server's own instant.
		expect(typeof fetched.serverNow).toBe("string");

		const payload = await results(pres.id);
		expect(payload.scoring.startedAt).toBe(startedAt);
		expect(Date.parse(payload.scoring.deadline)).toBe(
			Date.parse(startedAt) + 30_000,
		);
		expect(payload.scoring.closed).toBe(false);
	});

	test("navigating to a question opens it, and paging back does not reopen it", async () => {
		// Re-stamping on every visit would make a question's window — and so every
		// score measured against it — depend on how often the presenter paged back.
		const pres = await createAndStart([
			quizSlide(),
			quizSlide({ id: "qz2", question: "Second" }),
		]);
		const opened = (await fetchPresentation(pres.id)).slideStartedAt.qz;

		const goTo = (index: number) =>
			authed(`/api/presentations/${pres.id}/slide`, pres.creatorToken, {
				method: "POST",
				body: JSON.stringify({ index }),
			});
		expect((await goTo(1)).status).toBe(200);
		await wait(20);
		expect((await goTo(0)).status).toBe(200);

		const stamps = (await fetchPresentation(pres.id)).slideStartedAt;
		expect(stamps.qz).toBe(opened);
		expect(typeof stamps.qz2).toBe("string");
	});

	test("an untimed question never closes", async () => {
		// `timeLimit: 0` is the authored spelling of "no limit" — the pace is the
		// organizer's, not a clock's.
		const pres = await createAndStart([quizSlide({ timeLimit: 0 })]);
		const payload = await results(pres.id);
		expect(payload.scoring.timeLimit).toBe(null);
		expect(payload.scoring.deadline).toBe(null);
		expect(payload.scoring.closed).toBe(false);
		expect((await answer(pres.id, "p1", "mercury")).status).toBe(200);
		// With no window to be fast inside, the speed bonus is awarded in full.
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(QUIZ_MAX_POINTS);
	});

	test("an answer after the window is refused, and a restarted timer reopens it", async () => {
		const pres = await createAndStart([quizSlide({ timeLimit: 1 })]);
		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);

		expect((await answer(pres.id, "late", "mercury")).status).toBe(400);
		expect((await results(pres.id)).totalVotes).toBe(0);
		expect((await results(pres.id)).scoring.closed).toBe(true);

		// The presenter hands the room a fresh window (REQ057).
		const restart = await authed(
			`/api/presentations/${pres.id}/timer`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(restart.status).toBe(200);
		expect((await results(pres.id)).scoring.closed).toBe(false);
		expect((await answer(pres.id, "late", "mercury")).status).toBe(200);
	}, 10_000);

	test("a restart never lets an earlier answer outscore a fast answer in the new window", async () => {
		// The restart moves the question's opening instant forward, under answers
		// already given. Crediting those as instant would rank the room by who
		// answered *last* before the restart.
		const pres = await createAndStart([quizSlide({ timeLimit: 30 })]);
		await answer(pres.id, "early", "mercury");
		const beforeRestart = (await scorecard(pres.id, "early")).totalPoints;
		expect(beforeRestart).toBeGreaterThan(QUIZ_CORRECT_POINTS);

		// Opening instants are recorded to the millisecond, and a presenter
		// restarts a question seconds after an answer, not inside the same tick.
		await wait(20);
		const restart = await authed(
			`/api/presentations/${pres.id}/timer`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(restart.status).toBe(200);
		expect((await answer(pres.id, "fresh", "mercury")).status).toBe(200);

		const early = (await scorecard(pres.id, "early")).totalPoints;
		const fresh = (await scorecard(pres.id, "fresh")).totalPoints;
		// The pre-restart answer keeps the correctness half and claims no speed —
		// there is no honest speed to report against a window it never ran in.
		expect(early).toBe(QUIZ_CORRECT_POINTS);
		expect(early).toBeLessThan(fresh);
		expect(early).toBeLessThan(QUIZ_MAX_POINTS);
	});

	test("restarting the timer of a slide the deck does not have is a 404", async () => {
		const pres = await createAndStart();
		const res = await authed(
			`/api/presentations/${pres.id}/timer`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "nope" }) },
		);
		expect(res.status).toBe(404);
	});

	test("restarting a timer needs edit rights", async () => {
		const pres = await createAndStart();
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/timer`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "qz" }),
		});
		expect(res.status).toBe(401);
	});

	test("a survey-mode quiz has no shared window and stays answerable", async () => {
		// Nobody navigates the room through a survey (REQ003/REQ082), so there is
		// no instant a question started — and none to be past.
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Survey quiz",
				mode: "survey",
				slides: [quizSlide({ timeLimit: 1 })],
			}),
		});
		expect(res.status).toBe(201);
		const pres = await res.json();
		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);

		const payload = await results(pres.id);
		expect(payload.scoring.startedAt).toBe(null);
		expect(payload.scoring.deadline).toBe(null);
		expect(payload.scoring.closed).toBe(false);
		expect((await answer(pres.id, "p1", "mercury")).status).toBe(200);
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(QUIZ_MAX_POINTS);
	}, 10_000);

	test("a reset clears the answers and the windows that timed them", async () => {
		const pres = await createAndStart();
		await answer(pres.id, "p1", "mercury");
		expect((await fetchPresentation(pres.id)).slideStartedAt.qz).toBeString();

		const reset = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(reset.status).toBe(200);

		const fetched = await fetchPresentation(pres.id);
		expect(fetched.slideStartedAt).toEqual({});
		expect((await results(pres.id)).totalVotes).toBe(0);
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(0);
	});

	// ── A plain choice slide keeps no score ────────────────────

	test("a multiple-choice slide reveals its solution but scores nothing (REQ013)", async () => {
		const pres = await createAndStart([
			{
				id: "mc",
				type: "multiple-choice",
				question: "Pick one",
				options: [
					{ id: "a", text: "A", isCorrect: true },
					{ id: "b", text: "B" },
				],
			},
		]);
		await answer(pres.id, "p1", "a", "mc");

		const payload = await results(pres.id, "mc");
		expect(payload.options[0].isCorrect).toBe(true);
		// The key is present and explicitly null — a choice slide can
		// have a solution without being a competition.
		expect(payload).toHaveProperty("scoring");
		expect(payload.scoring).toBe(null);
		// And a choice slide still lets a participant change their mind.
		expect((await answer(pres.id, "p1", "b", "mc")).status).toBe(200);
	});
});
