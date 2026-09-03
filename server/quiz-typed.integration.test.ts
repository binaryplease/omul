/**
 * Integration tests for typed quiz answers (REQ055).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - a quiz question can be authored to take a free-text answer, and the
 *     boundary judges it against the organizer's accepted solutions
 *   - the answer runs through the rules REQ054/REQ056/REQ057 already set —
 *     one final answer, inside the window, scored on correctness plus speed,
 *     summed on the same scorecard
 *   - the answer key never reaches a competitor early, and neither do the
 *     room's typed answers, which on this question type *are* the key
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the quiz / guess /
 * points harnesses.
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

/** A typed-answer quiz question accepting two spellings of one answer. */
function typedQuizSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "tq",
		type: "quiz",
		question: "Which city hosts the FIFA headquarters?",
		options: [],
		quizAnswerMode: "type",
		quizAnswers: [
			{ id: "a1", text: "Zürich" },
			{ id: "a2", text: "Zurich, Switzerland" },
		],
		timeLimit: 30,
		...overrides,
	};
}

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Typed Quiz Test", slides }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

async function createAndStart(
	slides: AnyJson[] = [typedQuizSlide()],
): Promise<AnyJson> {
	const pres = await create(slides);
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

/** Submit one participant's typed answer. */
async function answer(
	presentationId: string,
	participantId: string,
	text: string,
	slideId = "tq",
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value: text, participantId }),
	});
}

/**
 * Read a slide's tally. Without a token this is the room's view, which is what
 * a competitor's browser receives; with one it is the deck editor's (REQ056).
 */
async function results(
	presentationId: string,
	slideId = "tq",
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

describe("typed quiz answers integration (REQ055)", () => {
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

	// ── What the organizer authored ────────────────────────────

	test("the answer mode and the accepted answers round-trip for the deck's editor", async () => {
		const pres = await createAndStart();
		const fetched = await fetchPresentation(pres.id, pres.creatorToken);
		expect(fetched.slides[0].type).toBe("quiz");
		expect(fetched.slides[0].quizAnswerMode).toBe("type");
		expect(
			fetched.slides[0].quizAnswers.map((accepted: AnyJson) => accepted.text),
		).toEqual(["Zürich", "Zurich, Switzerland"]);
	});

	test("a quiz authored without an answer mode is still a select-answer quiz", async () => {
		// Every deck written before REQ055 carries no mode at all, and must keep
		// behaving exactly as it did.
		const pres = await createAndStart([
			{
				id: "legacy",
				type: "quiz",
				question: "Closest planet to the sun?",
				options: [
					{ id: "venus", text: "Venus" },
					{ id: "mercury", text: "Mercury", isCorrect: true },
				],
				timeLimit: 30,
			},
		]);
		const fetched = await fetchPresentation(pres.id, pres.creatorToken);
		expect(fetched.slides[0].quizAnswerMode).toBe("select");
		expect(fetched.slides[0].quizAnswers).toEqual([]);

		const res = await answer(pres.id, "p1", "mercury", "legacy");
		expect(res.status).toBe(200);
		expect((await results(pres.id, "legacy")).typedAnswers).toBe(null);
		expect((await scorecard(pres.id, "p1")).slides[0].optionId).toBe("mercury");
		expect((await scorecard(pres.id, "p1")).slides[0].answer).toBe(null);
	});

	// ── The matching rule ──────────────────────────────────────

	test("an answer counts when it matches an accepted spelling, however it was typed", async () => {
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "Zürich")).status).toBe(200);
		expect((await answer(pres.id, "p2", "zurich")).status).toBe(200);
		expect((await answer(pres.id, "p3", "  ZURICH.  ")).status).toBe(200);
		expect((await answer(pres.id, "p4", "Zurich, Switzerland")).status).toBe(200);

		const payload = await results(pres.id);
		expect(payload.scoring.answeredCount).toBe(4);
		expect(payload.scoring.correctCount).toBe(4);
	});

	test("an answer the organizer did not name scores nothing", async () => {
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "Bern")).status).toBe(200);
		// One edit away is a different answer, not a typo to be forgiven: a grader
		// that awarded this would award the wrong year on the next question too.
		expect((await answer(pres.id, "p2", "Zuric")).status).toBe(200);

		const payload = await results(pres.id);
		expect(payload.scoring.answeredCount).toBe(2);
		expect(payload.scoring.correctCount).toBe(0);
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(0);
		expect((await scorecard(pres.id, "p2")).totalPoints).toBe(0);
	});

	test("a question with no accepted answer scores nobody", async () => {
		// The same stance a choice slide takes when its author marked no option
		// (REQ013): no notion of correctness at all, rather than everyone right.
		const pres = await createAndStart([
			typedQuizSlide({ id: "tq", quizAnswers: [] }),
		]);
		expect((await answer(pres.id, "p1", "anything")).status).toBe(200);
		const payload = await results(pres.id);
		expect(payload.scoring.answeredCount).toBe(1);
		expect(payload.scoring.correctCount).toBe(0);
	});

	test("a submission that states no answer is refused", async () => {
		const pres = await createAndStart();
		const blank = await answer(pres.id, "p1", "   ");
		expect(blank.status).toBe(400);
		// Refused, not stored: the participant still holds their one answer.
		expect((await answer(pres.id, "p1", "Zürich")).status).toBe(200);
	});

	// ── The rules a typed answer inherits (REQ054, REQ056, REQ057) ─

	test("the answer is final — a second one is refused with the quiz's own reason", async () => {
		const pres = await createAndStart();
		expect((await answer(pres.id, "p1", "Bern")).status).toBe(200);
		const second = await answer(pres.id, "p1", "Zürich");
		expect(second.status).toBe(400);
		expect((await second.json()).error).toBe(
			"Your answer to this quiz question is final",
		);
		// The first answer stands — a refused correction does not overwrite it.
		expect((await scorecard(pres.id, "p1")).slides[0].answer).toBe("Bern");
	});

	test("a participant who somehow holds two typed answers is counted once", async () => {
		// A typed tally groups what the room wrote, and it has to group it by
		// people: a deck holding two standing rows for one participant — written
		// before the answer path was queued (REQ054, see the quiz suite) — would
		// otherwise report two answers from one respondent and split them across
		// two rows of the very block that is meant to say what the room thinks.
		//
		// Written straight into the collection because `submitVote` will no longer
		// produce the state under test.
		const pres = await createAndStart();
		const { createStore } = await import("./db");
		const { StoredVoteSchema } = await import("./schemas");
		const voteStore = createStore("votes", StoredVoteSchema);
		for (const text of ["Zürich", "Bern"]) {
			await voteStore.insert({
				presentationId: pres.id,
				slideId: "tq",
				value: text,
				participantId: "p1",
				statementId: null,
				skip: false,
				createdAt: new Date().toISOString(),
			});
		}

		const payload = await results(pres.id, "tq", pres.creatorToken);
		expect(payload.respondentCount).toBe(1);
		expect(payload.totalVotes).toBe(1);
		expect(payload.scoring.answeredCount).toBe(1);
		// One person wrote one thing — the first — so the block shows one row.
		expect(payload.typedAnswers.distinctCount).toBe(1);
		expect(payload.typedAnswers.entries).toEqual([
			{ text: "Zürich", count: 1, isCorrect: true },
		]);
	});

	test("an answer after the window closed is refused with the quiz's own reason", async () => {
		const pres = await createAndStart([typedQuizSlide({ timeLimit: 1 })]);
		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);
		const late = await answer(pres.id, "p1", "Zürich");
		expect(late.status).toBe(400);
		expect((await late.json()).error).toBe(
			"The time for this quiz question is over",
		);
	}, 10_000);

	test("an id-less submission is refused outright", async () => {
		// Under the one-answer rule the first id-less caller would otherwise lock
		// out every other one.
		const pres = await createAndStart();
		expect((await answer(pres.id, "", "Zürich")).status).toBe(400);
	});

	test("a fast correct answer outscores a slower one (REQ054)", async () => {
		const pres = await createAndStart([typedQuizSlide({ timeLimit: 20 })]);
		await answer(pres.id, "fast", "Zürich");
		await wait(600);
		await answer(pres.id, "slow", "zurich.");

		const quick = (await scorecard(pres.id, "fast")).slides[0];
		const late = (await scorecard(pres.id, "slow")).slides[0];
		expect(quick.isCorrect).toBe(true);
		expect(late.isCorrect).toBe(true);
		expect(quick.points).toBeGreaterThan(late.points);
		expect(late.points).toBeGreaterThanOrEqual(QUIZ_CORRECT_POINTS);
		expect(quick.points).toBeLessThanOrEqual(QUIZ_MAX_POINTS);
	});

	test("the scorecard reports the typed answer where a select question reports an option", async () => {
		const pres = await createAndStart();
		await answer(pres.id, "p1", "  Zürich ");
		const card = await scorecard(pres.id, "p1");
		expect(card.quizCount).toBe(1);
		expect(card.answeredCount).toBe(1);
		expect(card.correctCount).toBe(1);
		expect(card.slides[0].answerMode).toBe("type");
		// Stored as the participant wrote it, only trimmed — a verdict is shown
		// under these words, so they have to be the participant's own.
		expect(card.slides[0].answer).toBe("Zürich");
		// The option-id key is emitted as an explicit null, never dropped.
		expect(card.slides[0].optionId).toBe(null);
	});

	test("an unanswered typed question is spelled with explicit nulls", async () => {
		const pres = await createAndStart();
		const card = await scorecard(pres.id, "nobody");
		expect(card.slides[0].answered).toBe(false);
		expect(card.slides[0].answer).toBe(null);
		expect(card.slides[0].optionId).toBe(null);
		expect(card.slides[0].isCorrect).toBe(null);
		expect(card.slides[0].points).toBe(0);
	});

	test("re-authoring the accepted answers re-scores the room with no migration", async () => {
		// Points are derived, never stored (REQ056), so an organizer who forgot a
		// spelling can add it and the room is scored as if they always had.
		const pres = await createAndStart();
		await answer(pres.id, "p1", "Zurigo");
		expect((await scorecard(pres.id, "p1")).totalPoints).toBe(0);

		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						typedQuizSlide({
							quizAnswers: [
								{ id: "a1", text: "Zürich" },
								{ id: "a3", text: "Zurigo" },
							],
						}),
					],
				}),
			},
		);
		expect(patch.status).toBe(200);
		expect((await scorecard(pres.id, "p1")).totalPoints).toBeGreaterThanOrEqual(
			QUIZ_CORRECT_POINTS,
		);
	});

	// ── The room's tally ───────────────────────────────────────

	test("the tally groups answers that are the same answer", async () => {
		const pres = await createAndStart([typedQuizSlide({ timeLimit: 0 })]);
		await answer(pres.id, "p1", "Zürich");
		await answer(pres.id, "p2", "zurich");
		await answer(pres.id, "p3", "Bern");
		// An untimed question is over once the presenter reveals it (REQ102).
		await authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ slideId: "tq" }),
		});

		const payload = await results(pres.id);
		expect(payload.answerMode).toBe("type");
		expect(payload.respondentCount).toBe(3);
		expect(payload.typedAnswers.distinctCount).toBe(2);
		expect(payload.typedAnswers.entries).toEqual([
			// Labelled with the first spelling that arrived — words somebody typed.
			{ text: "Zürich", count: 2, isCorrect: true },
			{ text: "Bern", count: 1, isCorrect: false },
		]);
		expect(payload.typedAnswers.accepted).toEqual([
			"Zürich",
			"Zurich, Switzerland",
		]);
		// A typed question has no options to tally, and says so rather than
		// inventing an empty bar chart.
		expect(payload.options).toEqual([]);
	});

	test("an empty typed tally is well-formed before any answer lands", async () => {
		const pres = await createAndStart();
		const payload = await results(pres.id, "tq", pres.creatorToken);
		expect(payload.type).toBe("quiz");
		expect(payload.answerMode).toBe("type");
		expect(payload.totalVotes).toBe(0);
		expect(payload.typedAnswers.distinctCount).toBe(0);
		expect(payload.typedAnswers.entries).toEqual([]);
		expect(payload.scoring.averagePoints).toBe(null);
		expect(payload.scoring.correctShare).toBe(null);
	});

	// ── The answer key never reaches a competitor early (REQ056) ─

	test("the deck a participant joins with carries no accepted answers", async () => {
		// On a typed question the accepted answers *are* the answer key, in the
		// plainest possible form — one look at the network tab would end the quiz.
		const pres = await createAndStart([
			typedQuizSlide(),
			typedQuizSlide({ id: "tq2", question: "Second" }),
		]);
		const joined = await joinByCode(pres.code);
		for (const slide of joined.slides) {
			expect(slide.quizAnswers).toEqual([]);
		}
		expect(JSON.stringify(joined)).not.toContain("Zürich");
	});

	test("an unauthorized fetch of a running question carries no accepted answers", async () => {
		const pres = await createAndStart();
		const fetched = await fetchPresentation(pres.id);
		expect(fetched.slides[0].quizAnswers).toEqual([]);
		// The editor sees what they authored.
		const authoredView = await fetchPresentation(pres.id, pres.creatorToken);
		expect(authoredView.slides[0].quizAnswers.length).toBe(2);
	});

	test("leftover options from a select question are not a second answer key", async () => {
		// A question switched from select to type keeps its options — deliberately,
		// so the answers given under the old question stay recognisable — and the
		// correct one is still spelled out among them. A typed question offers no
		// options to anyone, so the audience is sent none at all.
		const pres = await createAndStart([
			typedQuizSlide({
				options: [
					{ id: "opt-zurich", text: "Zürich", isCorrect: true },
					{ id: "opt-bern", text: "Bern" },
				],
			}),
		]);
		const joined = await joinByCode(pres.code);
		expect(joined.slides[0].options).toEqual([]);
		expect(JSON.stringify(joined)).not.toContain("Zürich");
		// The author still sees everything they wrote.
		const authoredView = await fetchPresentation(pres.id, pres.creatorToken);
		expect(authoredView.slides[0].options.length).toBe(2);
	});

	test("the tally withholds the room's answers while the question runs", async () => {
		// Every answer that lands re-broadcasts this payload to the whole room. On
		// a typed question the answer most of the room gave is the answer, so the
		// rows are withheld on the same gate as the key itself — as an explicit
		// null, never an empty list that would claim nobody answered.
		const pres = await createAndStart();
		await answer(pres.id, "p1", "Zürich");

		const audience = await results(pres.id);
		expect(audience.typedAnswers.entries).toBe(null);
		expect(audience.typedAnswers.accepted).toBe(null);
		// The head count still reads, which is what a presenter watches for.
		expect(audience.typedAnswers.distinctCount).toBe(1);
		expect(audience.scoring.answeredCount).toBe(1);

		const presenter = await results(pres.id, "tq", pres.creatorToken);
		expect(presenter.typedAnswers.entries).toEqual([
			{ text: "Zürich", count: 1, isCorrect: true },
		]);
		expect(presenter.typedAnswers.accepted).toEqual([
			"Zürich",
			"Zurich, Switzerland",
		]);
	});

	test("the tally of a typed question carries no options, to anyone", async () => {
		// The reviewer's scenario: a question authored in select mode with the
		// answer among its options, then switched to typed. This payload is
		// re-broadcast to the whole room after every answer, so an option list
		// left in would be a shortlist containing the answer — on a question whose
		// entire point is that there is nothing to read off. A two-option deck
		// would become a coin flip.
		const pres = await createAndStart([
			typedQuizSlide({
				options: [
					{ id: "opt-z", text: "Zürich", isCorrect: true },
					{ id: "opt-b", text: "Bern" },
				],
			}),
		]);
		await answer(pres.id, "p1", "Zürich");

		const audience = await results(pres.id);
		expect(audience.options).toEqual([]);
		expect(JSON.stringify(audience)).not.toContain("Zürich");
		// Emptied for the editor too: the option text is not a result of *this*
		// question, and a shared screen drawing bars for options nobody was
		// offered would report a tally that does not exist.
		const presenter = await results(pres.id, "tq", pres.creatorToken);
		expect(presenter.options).toEqual([]);
	});

	test("a stale select vote counts nowhere, head count included", async () => {
		// Three numbers in one payload have to agree about who answered: a row
		// that is no longer an answer to the question as it stands must not be
		// read by the head count while the score and the typed tally drop it.
		const options = [
			{ id: "opt-z", text: "Zürich", isCorrect: true },
			{ id: "opt-b", text: "Bern" },
		];
		const pres = await createAndStart([
			{
				id: "tq",
				type: "quiz",
				question: "Which city hosts the FIFA headquarters?",
				options,
				timeLimit: 0,
			},
		]);
		expect((await answer(pres.id, "p1", "opt-b")).status).toBe(200);

		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [typedQuizSlide({ timeLimit: 0, options })],
				}),
			},
		);
		expect(patch.status).toBe(200);

		const payload = await results(pres.id, "tq", pres.creatorToken);
		expect(payload.respondentCount).toBe(0);
		expect(payload.scoring.answeredCount).toBe(0);
		expect(payload.typedAnswers.distinctCount).toBe(0);
	});

	test("the room's answers and the key open once the question is over", async () => {
		const pres = await createAndStart([typedQuizSlide({ timeLimit: 1 })]);
		await answer(pres.id, "p1", "Zürich");
		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);

		const payload = await results(pres.id);
		expect(payload.scoring.closed).toBe(true);
		expect(payload.typedAnswers.entries).toEqual([
			{ text: "Zürich", count: 1, isCorrect: true },
		]);
		expect((await joinByCode(pres.code)).slides[0].quizAnswers.length).toBe(2);
	}, 10_000);

	test("ending the presentation opens the key to everyone", async () => {
		const pres = await createAndStart([typedQuizSlide({ timeLimit: 0 })]);
		expect((await joinByCode(pres.code)).slides[0].quizAnswers).toEqual([]);
		const end = await authed(
			`/api/presentations/${pres.id}/end`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(end.status).toBe(200);
		expect((await joinByCode(pres.code)).slides[0].quizAnswers.length).toBe(2);
	});

	// ── Re-authoring under answers already given ───────────────

	test("switching a question to typed answers frees the participants it locked", async () => {
		// An option id is not a typed answer to the question the slide now asks,
		// so it neither counts nor keeps its participant from answering once.
		// Switching the mode in the editor leaves the options standing — the
		// author may switch back — which is what makes the old rows recognisable.
		const options = [
			{ id: "opt-zurich", text: "Zürich", isCorrect: true },
			{ id: "opt-bern", text: "Bern" },
		];
		const pres = await createAndStart([
			{
				id: "tq",
				type: "quiz",
				question: "Which city hosts the FIFA headquarters?",
				options,
				timeLimit: 0,
			},
		]);
		expect((await answer(pres.id, "p1", "opt-bern")).status).toBe(200);

		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [typedQuizSlide({ timeLimit: 0, options })],
				}),
			},
		);
		expect(patch.status).toBe(200);

		// The stale row no longer counts as an answer…
		const stale = await results(pres.id, "tq", pres.creatorToken);
		expect(stale.scoring.answeredCount).toBe(0);
		expect(stale.typedAnswers.entries).toEqual([]);
		// …and the participant may answer the question as it now stands.
		expect((await answer(pres.id, "p1", "Zürich")).status).toBe(200);
		expect((await scorecard(pres.id, "p1")).slides[0].answer).toBe("Zürich");
	});
});
