/**
 * Integration tests for a participant's own quiz verdict while it is not theirs
 * to see yet (REQ228).
 *
 * A verdict is the answer key read one answer at a time: "Correct!" beside the
 * option a participant picked names the solution, and a participant id is minted
 * by the browser, so anybody can answer under a fresh one per option and read
 * each verdict back. So while a quiz question is running — or its solution is
 * not yet the audience's under its reveal setting ("Instant", "On click",
 * "Private") — nobody who cannot edit the deck is sent a verdict derived from
 * it:
 *
 *  - the participant's scorecard reads `isCorrect` and `points` as an explicit
 *    `null` for that slide and leaves it out of `correctCount`, `totalPoints`
 *    and `rank`, while `answered`, `optionId` and `answer` still read;
 *  - the leaderboard standings the room is sent carry no total that counts it;
 *  - the quiz frames carry no `correctCount` (REQ215, pinned here once more
 *    beside the standings they travel with).
 *
 * Once the window is over and the reveal setting allows, the verdict reads as it
 * always did.
 *
 * Runs the real Elysia app — routes and WebSocket — against a throw-away
 * in-memory zodstore, like the harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	QUIZ_CORRECT_POINTS,
	QUIZ_SUBMISSION_GRACE_MS,
	RESULTS_TOKEN_HEADER,
	scorecardVerdictWithheld,
} from "./schemas";

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void>; port: number } | null = null;

// API response is loosely typed
type AnyJson = any;

type Envelope = { event: string; data: AnyJson };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A three-option quiz question whose second option is the marked solution. */
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

/** A typed-answer quiz question (REQ055) accepting one spelling. */
function typedQuizSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		options: [],
		quizAnswerMode: "type",
		quizAnswers: [{ id: "a1", text: "Mercury" }],
		timeLimit: 30,
		...overrides,
	};
}

/** The deck's standings, after its quiz question (REQ059). */
function leaderboardSlide() {
	return { id: "lb", type: "leaderboard", question: "Standings" };
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

/** Create a deck and take it live, with whatever reveal mode it is given. */
async function goLive(
	slides: AnyJson[],
	extra: Record<string, unknown> = {},
): Promise<AnyJson> {
	const created = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Withheld Quiz Verdict", slides, ...extra }),
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

/** Open the question's window, as the presenter's "Start timer" does (REQ226). */
async function startTimer(pres: AnyJson): Promise<void> {
	const res = await authed(`/api/presentations/${pres.id}/timer`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify({ slideId: "qz" }),
	});
	expect(res.status).toBe(200);
}

/** End the running question by closing it to answers (REQ111, REQ216). */
async function closeQuestion(pres: AnyJson): Promise<void> {
	const res = await authed(
		`/api/presentations/${pres.id}/participation`,
		pres.creatorToken,
		{ method: "POST", body: JSON.stringify({ slideId: "qz", open: false }) },
	);
	expect(res.status).toBe(200);
}

/** The presenter's reveal of the question's results (REQ102). */
async function reveal(pres: AnyJson): Promise<void> {
	const res = await authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify({ slideId: "qz" }),
	});
	expect(res.status).toBe(200);
}

async function endDeck(pres: AnyJson): Promise<void> {
	const res = await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
		method: "POST",
	});
	expect(res.status).toBe(200);
}

async function answer(
	presentationId: string,
	participantId: string,
	value: string,
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId: "qz", value, participantId }),
	});
	expect(res.status).toBe(200);
}

async function read(path: string, headers: Record<string, string> = {}) {
	const res = await fetch(`${baseUrl}${path}`, { headers });
	expect(res.status).toBe(200);
	return (await res.json()) as AnyJson;
}

/** One participant's scorecard — what their phone fetches. */
function scorecard(pres: AnyJson, participantId = "p1") {
	return read(
		`/api/presentations/${pres.id}/scorecard?participantId=${participantId}`,
	);
}

function entryOf(card: AnyJson) {
	const entry = card.slides.find((slide: AnyJson) => slide.slideId === "qz");
	expect(entry).toBeDefined();
	return entry;
}

/** A card whose only quiz question's verdict is withheld. */
function expectVerdictWithheld(
	card: AnyJson,
	submitted: { optionId: string | null; answer: string | null },
) {
	const entry = entryOf(card);
	expect(scorecardVerdictWithheld(entry)).toBe(true);
	// Explicit nulls, not missing keys (ADR-0024).
	expect(entry).toHaveProperty("isCorrect", null);
	expect(entry).toHaveProperty("points", null);
	// What may stay: that they answered, and what.
	expect(entry.answered).toBe(true);
	expect(entry.optionId).toBe(submitted.optionId);
	expect(entry.answer).toBe(submitted.answer);
	// And the slide counts towards none of the totals.
	expect(card.correctCount).toBe(0);
	expect(card.totalPoints).toBe(0);
	expect(card.rank).toBe(null);
	expect(card.answeredCount).toBe(1);
}

/** A card whose only quiz question was answered right, with its verdict out. */
function expectVerdictFilled(card: AnyJson) {
	const entry = entryOf(card);
	expect(scorecardVerdictWithheld(entry)).toBe(false);
	expect(entry.isCorrect).toBe(true);
	expect(entry.points).toBeGreaterThanOrEqual(QUIZ_CORRECT_POINTS);
	expect(card.correctCount).toBe(1);
	expect(card.totalPoints).toBe(entry.points);
	expect(card.rank).toBe(1);
}

const SELECTED = { optionId: "mercury", answer: null };
const TYPED = { optionId: null, answer: "Mercury" };

async function joinRoom(
	presentationId: string,
	role: "presenter" | "participant",
): Promise<{
	received: Envelope[];
	close: () => Promise<void>;
}> {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	socket.addEventListener("message", (event) => {
		try {
			const raw = (event as MessageEvent).data;
			received.push(
				JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)),
			);
		} catch {
			// ignore non-JSON frames
		}
	});
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("ws error")), {
			once: true,
		});
	});
	socket.send(JSON.stringify({ type: "join", presentationId, role }));
	// Let the join land before anything is broadcast to the room.
	await wait(50);
	return {
		received,
		async close() {
			socket.close();
			await wait(50);
		},
	};
}

/** Every leaderboard frame a socket has been sent. */
function standingsFrames(received: Envelope[]): AnyJson[] {
	return received
		.filter(
			(envelope) =>
				envelope.event === "results.updated" && envelope.data.slideId === "lb",
		)
		.map((envelope) => envelope.data.results);
}

/** A board that counts nothing scored — nobody ranked, no total anywhere. */
function expectNoTotals(board: AnyJson) {
	expect(board.type).toBe("leaderboard");
	expect(board.rankedCount).toBe(0);
	expect(board.entries).toEqual([]);
}

describe("a participant's quiz verdict while it is not theirs yet (REQ228)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia().use(presentationRoutes).ws("/ws", {
			open(connection) {
				const clientId = ws.registerClient(connection);
				// See server/index.ts for the rationale — mutate ws.raw.data.
				(connection.raw as any).data = {
					...((connection.raw as any).data ?? {}),
					clientId,
				};
			},
			message(connection, message) {
				try {
					const parsed =
						typeof message === "string" ? JSON.parse(message) : message;
					if (parsed.type !== "join") return;
					const clientId = (connection.raw as any).data?.clientId as
						| string
						| undefined;
					if (!clientId) return;
					ws.joinRoom(clientId, parsed.presentationId, parsed.role || "participant");
				} catch {
					// ignore malformed
				}
			},
			close(connection) {
				const clientId = (connection.raw as any).data?.clientId as
					| string
					| undefined;
				if (clientId) ws.removeClient(clientId);
			},
		});

		app.listen({ port: 0, hostname: "127.0.0.1" });
		const bunServer = (app as any).server as {
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = { stop: () => bunServer.stop(true), port: bunServer.port };
		baseUrl = `http://127.0.0.1:${bunServer.port}`;
		wsUrl = `ws://127.0.0.1:${bunServer.port}/ws`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	// ── The scorecard, under each reveal setting ────────────────

	test("under 'on click' a select question's verdict waits for the reveal", async () => {
		const pres = await goLive([quizSlide()], { resultsVisibility: "on-click" });
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		expectVerdictWithheld(await scorecard(pres), SELECTED);

		// The question being over is not enough: the organizer has not revealed it.
		await closeQuestion(pres);
		expectVerdictWithheld(await scorecard(pres), SELECTED);

		await reveal(pres);
		expectVerdictFilled(await scorecard(pres));
	});

	test("under 'on click' a typed question's verdict waits for the reveal", async () => {
		const pres = await goLive([typedQuizSlide()], { resultsVisibility: "on-click" });
		await startTimer(pres);
		await answer(pres.id, "p1", "Mercury");
		expectVerdictWithheld(await scorecard(pres), TYPED);

		await closeQuestion(pres);
		expectVerdictWithheld(await scorecard(pres), TYPED);

		await reveal(pres);
		expectVerdictFilled(await scorecard(pres));
	});

	test("under 'instant' the verdict is withheld while the window runs, and out once it is over", async () => {
		const pres = await goLive([quizSlide({ timeLimit: 1 })]);
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		expectVerdictWithheld(await scorecard(pres), SELECTED);

		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);
		expectVerdictFilled(await scorecard(pres));
	}, 10_000);

	test("under 'instant' a typed question's verdict is withheld while the window runs", async () => {
		const pres = await goLive([typedQuizSlide()]);
		await startTimer(pres);
		await answer(pres.id, "p1", "Mercury");
		expectVerdictWithheld(await scorecard(pres), TYPED);

		await closeQuestion(pres);
		expectVerdictFilled(await scorecard(pres));
	});

	test("under 'private' the verdict is withheld while the window runs, and stays withheld", async () => {
		const pres = await goLive([quizSlide()], { resultsVisibility: "private" });
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		expectVerdictWithheld(await scorecard(pres), SELECTED);

		// "Never on screen": not once the question is over, nor once the deck ends.
		await closeQuestion(pres);
		expectVerdictWithheld(await scorecard(pres), SELECTED);
		await endDeck(pres);
		expectVerdictWithheld(await scorecard(pres), SELECTED);
	});

	test("a per-slide 'on click' over an 'instant' deck withholds the same way", async () => {
		const pres = await goLive([quizSlide({ resultsVisibility: "on-click" })]);
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		await closeQuestion(pres);
		expectVerdictWithheld(await scorecard(pres), SELECTED);
		await reveal(pres);
		expectVerdictFilled(await scorecard(pres));
	});

	test("an untimed question's verdict waits for the question to end", async () => {
		// No deadline to wait for, but the verdict is still the key while anybody
		// can be answering.
		const pres = await goLive([quizSlide({ timeLimit: 0 })]);
		await answer(pres.id, "p1", "mercury");
		expectVerdictWithheld(await scorecard(pres), SELECTED);
		await reveal(pres);
		expectVerdictFilled(await scorecard(pres));
	});

	test("a fresh id per option reads no key off the card", async () => {
		// The probe the requirement exists for: one answer per option, each under
		// an id the browser minted, and every card read back.
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		for (const option of ["venus", "mercury", "mars"]) {
			await answer(pres.id, `probe-${option}`, option);
			const entry = entryOf(await scorecard(pres, `probe-${option}`));
			expect(entry.isCorrect).toBe(null);
			expect(entry.points).toBe(null);
		}
	});

	test("an unanswered question's withheld entry still says it was not answered", async () => {
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		const entry = entryOf(await scorecard(pres, "nobody"));
		expect(entry.answered).toBe(false);
		expect(entry.isCorrect).toBe(null);
		expect(entry.points).toBe(null);
		expect(scorecardVerdictWithheld(entry)).toBe(true);

		await closeQuestion(pres);
		const over = entryOf(await scorecard(pres, "nobody"));
		expect(over.points).toBe(0);
		expect(scorecardVerdictWithheld(over)).toBe(false);
	});

	test("a question already over still counts while the next one runs", async () => {
		const pres = await goLive([quizSlide({ id: "first" }), quizSlide()]);
		const firstOpen = await authed(
			`/api/presentations/${pres.id}/timer`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "first" }) },
		);
		expect(firstOpen.status).toBe(200);
		const firstAnswer = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "first", value: "mercury", participantId: "p1" }),
		});
		expect(firstAnswer.status).toBe(200);
		const closeFirst = await authed(
			`/api/presentations/${pres.id}/participation`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "first", open: false }) },
		);
		expect(closeFirst.status).toBe(200);

		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		const card = await scorecard(pres);
		const first = card.slides.find((slide: AnyJson) => slide.slideId === "first");
		expect(first.isCorrect).toBe(true);
		expect(entryOf(card).points).toBe(null);
		expect(card.correctCount).toBe(1);
		expect(card.totalPoints).toBe(first.points);
		expect(card.rank).toBe(1);
		expect(card.answeredCount).toBe(2);
	});

	// ── The standings the room is sent ──────────────────────────

	test("a leaderboard frame sent mid-question carries no totals from the running slide", async () => {
		const pres = await goLive([quizSlide(), leaderboardSlide()]);
		await startTimer(pres);
		const phone = await joinRoom(pres.id, "participant");
		// `role` is self-declared, so a socket that says "presenter" is sent the
		// room's frame too — and must not be able to buy a better one by saying so.
		const claimed = await joinRoom(pres.id, "presenter");

		await answer(pres.id, "p1", "mercury");
		await answer(pres.id, "p2", "venus");
		// Both broadcasts are coalesced (REQ150); let the trailing standings land.
		await wait(700);

		for (const room of [phone, claimed]) {
			const boards = standingsFrames(room.received);
			expect(boards.length).toBeGreaterThan(0);
			for (const board of boards) expectNoTotals(board);

			// And the quiz frames beside them carry no correct count (REQ215).
			const quizFrames = room.received.filter(
				(envelope) =>
					envelope.event === "results.updated" && envelope.data.slideId === "qz",
			);
			expect(quizFrames.length).toBeGreaterThan(0);
			for (const frame of quizFrames) {
				expect(frame.data.results.scoring.correctCount).toBe(null);
			}
		}

		// Once the question is over the room's board counts it, without a reload.
		phone.received.length = 0;
		await closeQuestion(pres);
		await wait(700);
		const after = standingsFrames(phone.received).at(-1);
		expect(after).toBeDefined();
		expect(after.rankedCount).toBe(2);
		expect(after.entries[0].correctCount).toBe(1);
		expect(after.entries[0].totalPoints).toBeGreaterThanOrEqual(QUIZ_CORRECT_POINTS);

		await phone.close();
		await claimed.close();
	});

	test("under 'on click' the room's standings wait for the reveal", async () => {
		// The case the board leaked in: the quiz frame was already withheld, and
		// the leaderboard frame beside it named the right answer's points.
		const pres = await goLive([
			quizSlide({ resultsVisibility: "on-click" }),
			leaderboardSlide(),
		]);
		await startTimer(pres);
		const phone = await joinRoom(pres.id, "participant");

		await answer(pres.id, "p1", "mercury");
		await closeQuestion(pres);
		await wait(700);
		const boards = standingsFrames(phone.received);
		expect(boards.length).toBeGreaterThan(0);
		for (const board of boards) expectNoTotals(board);

		phone.received.length = 0;
		await reveal(pres);
		await wait(700);
		const revealed = standingsFrames(phone.received).at(-1);
		expect(revealed).toBeDefined();
		expect(revealed.rankedCount).toBe(1);
		expect(revealed.entries[0].correctCount).toBe(1);

		await phone.close();
	});

	test("the leaderboard read is withheld from the audience and the results link, not from an editor", async () => {
		const pres = await goLive([quizSlide(), leaderboardSlide()]);
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");

		expectNoTotals(await read(`/api/presentations/${pres.id}/results/lb`));
		const linked = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(linked.status).toBe(201);
		const resultsToken = (await linked.json()).resultsToken as string;
		expectNoTotals(
			await read(`/api/presentations/${pres.id}/results/lb`, {
				[RESULTS_TOKEN_HEADER]: resultsToken,
			}),
		);

		// The presenter authored the deck and reads every score, as before.
		const editor = await read(`/api/presentations/${pres.id}/results/lb`, {
			Authorization: `Bearer ${pres.creatorToken}`,
		});
		expect(editor.rankedCount).toBe(1);
		expect(editor.entries[0].correctCount).toBe(1);
	});

	// ── The answer key on the deck payload, under each reveal setting ──
	//
	// A phone holding the key beside the option it picked has its verdict, so the
	// deck the audience is sent keeps the key back on the verdict's terms: not
	// merely once the question is over, but once its reveal setting allows.

	/** The audience's copy of the question, as a joining phone reads it. */
	async function joinedQuestion(pres: AnyJson): Promise<AnyJson> {
		const deck = await read(`/api/join/${pres.code}`);
		return deck.slides.find((slide: AnyJson) => slide.id === "qz");
	}

	/** The same, off the public deck read. */
	async function publicQuestion(pres: AnyJson): Promise<AnyJson> {
		const deck = await read(`/api/presentations/${pres.id}`);
		return deck.slides.find((slide: AnyJson) => slide.id === "qz");
	}

	function expectNoKey(slide: AnyJson) {
		for (const option of slide.options) {
			expect(option).not.toHaveProperty("isCorrect");
		}
		expect(slide.quizAnswers).toEqual([]);
	}

	function expectKey(slide: AnyJson) {
		const mercury = slide.options.find((option: AnyJson) => option.id === "mercury");
		expect(mercury.isCorrect).toBe(true);
	}

	/** Save the slides unchanged, which sends the room a `presentation.slides` frame. */
	async function saveSlides(pres: AnyJson, slides: AnyJson[]): Promise<void> {
		const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ slides }),
		});
		expect(res.status).toBe(200);
	}

	function slidesFrames(received: Envelope[]): AnyJson[] {
		return received
			.filter((envelope) => envelope.event === "presentation.slides")
			.map((envelope) =>
				envelope.data.slides.find((slide: AnyJson) => slide.id === "qz"),
			);
	}

	test("under 'private' a closed question's key reaches no phone, not even once the deck ends", async () => {
		const pres = await goLive([quizSlide()], { resultsVisibility: "private" });
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		await closeQuestion(pres);

		// The probe: the scorecard withholds the verdict, and the deck must not
		// hand the participant the key to work it out.
		expectVerdictWithheld(await scorecard(pres), SELECTED);
		expectNoKey(await joinedQuestion(pres));
		expectNoKey(await publicQuestion(pres));

		const phone = await joinRoom(pres.id, "participant");
		await saveSlides(pres, [quizSlide()]);
		await wait(100);
		const frames = slidesFrames(phone.received);
		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) expectNoKey(frame);
		await phone.close();

		await endDeck(pres);
		expectNoKey(await joinedQuestion(pres));
	});

	test("under 'on click' a closed question's key waits for the reveal", async () => {
		const pres = await goLive([quizSlide()], { resultsVisibility: "on-click" });
		await startTimer(pres);
		await answer(pres.id, "p1", "mercury");
		await closeQuestion(pres);
		expectNoKey(await joinedQuestion(pres));

		const phone = await joinRoom(pres.id, "participant");
		await saveSlides(pres, [quizSlide()]);
		await wait(100);
		const frames = slidesFrames(phone.received);
		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) expectNoKey(frame);
		await phone.close();

		await reveal(pres);
		expectKey(await joinedQuestion(pres));
	});

	test("under 'on click' a typed question's accepted answers wait for the reveal", async () => {
		const pres = await goLive([typedQuizSlide()], { resultsVisibility: "on-click" });
		await startTimer(pres);
		await answer(pres.id, "p1", "Mercury");
		await closeQuestion(pres);
		expect((await joinedQuestion(pres)).quizAnswers).toEqual([]);

		await reveal(pres);
		expect((await joinedQuestion(pres)).quizAnswers).toEqual([
			{ id: "a1", text: "Mercury" },
		]);
	});

	test("under 'instant' the key reaches the room once the question is over, as before", async () => {
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		expectNoKey(await joinedQuestion(pres));
		await closeQuestion(pres);
		expectKey(await joinedQuestion(pres));
	});
});
