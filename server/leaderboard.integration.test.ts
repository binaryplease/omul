/**
 * Integration tests for the leaderboard slide (REQ059).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - the board sums a participant's score across *several* quiz questions,
 *     which is what makes the competition visible over a deck rather than a
 *     question
 *   - it is ordered, placed, and capped at the number of rows the slide asked
 *     for — while everyone who answered stays ranked behind the cut
 *   - it names nobody: no participant id reaches the public payload, and the
 *     one person told which row is theirs is the one holding that id
 *   - scores stay derived, so re-marking a solution re-orders the board
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the quiz / p0 / p1
 * harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LEADERBOARD_DEFAULT_SIZE, QUIZ_MAX_POINTS } from "./schemas";

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

/** One quiz question whose second option is the marked solution. */
function quizSlide(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		type: "quiz",
		question: `Question ${id}`,
		options: [
			{ id: `${id}-wrong`, text: "Wrong" },
			{ id: `${id}-right`, text: "Right", isCorrect: true },
		],
		timeLimit: 30,
		...overrides,
	};
}

function boardSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "board",
		type: "leaderboard",
		question: "",
		...overrides,
	};
}

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Leaderboard Test", slides }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

async function createAndStart(slides: AnyJson[]): Promise<AnyJson> {
	const pres = await create(slides);
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

async function answer(
	presentationId: string,
	participantId: string,
	slideId: string,
	optionId: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value: optionId, participantId }),
	});
}

/** The board as a participant's browser reads it — public, unauthenticated. */
async function board(
	presentationId: string,
	slideId = "board",
): Promise<AnyJson> {
	const res = await fetch(
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

/** A two-question deck with a board at the end — the shape REQ059 describes. */
function quizDeck(boardOverrides: Record<string, unknown> = {}) {
	return [quizSlide("q1"), quizSlide("q2"), boardSlide(boardOverrides)];
}

describe("leaderboard slide integration (REQ059)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

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

	// ── The board itself ───────────────────────────────────────

	test("an empty board is well-formed before anybody has answered", async () => {
		const pres = await createAndStart(quizDeck());
		const payload = await board(pres.id);
		expect(payload.type).toBe("leaderboard");
		expect(payload.entries).toEqual([]);
		expect(payload.rankedCount).toBe(0);
		expect(payload.quizCount).toBe(2);
		expect(payload.maxPoints).toBe(2 * QUIZ_MAX_POINTS);
		expect(payload.size).toBe(LEADERBOARD_DEFAULT_SIZE);
		// A board collects nothing of its own, and says so rather than omitting it.
		expect(payload.totalVotes).toBe(0);
	});

	test("scores are summed across the deck's quiz questions, not one of them", async () => {
		// The requirement in one test: the competition has to be visible *across
		// several questions*, so a participant who was right twice must outrank one
		// who was right once, whatever either did on a single question.
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "twice", "q1", "q1-right");
		await answer(pres.id, "twice", "q2", "q2-right");
		await answer(pres.id, "once", "q1", "q1-right");
		await answer(pres.id, "once", "q2", "q2-wrong");

		const payload = await board(pres.id);
		expect(payload.rankedCount).toBe(2);
		expect(payload.entries[0].rank).toBe(1);
		expect(payload.entries[0].correctCount).toBe(2);
		expect(payload.entries[0].answeredCount).toBe(2);
		expect(payload.entries[1].rank).toBe(2);
		expect(payload.entries[1].correctCount).toBe(1);
		expect(payload.entries[0].totalPoints).toBeGreaterThan(
			payload.entries[1].totalPoints,
		);
	});

	test("a participant who answered and got everything wrong is still ranked", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "right", "q1", "q1-right");
		await answer(pres.id, "wrong", "q1", "q1-wrong");

		const payload = await board(pres.id);
		expect(payload.rankedCount).toBe(2);
		expect(payload.entries[1].totalPoints).toBe(0);
		expect(payload.entries[1].answeredCount).toBe(1);
	});

	test("somebody who answered nothing is not on the board at all", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "played", "q1", "q1-right");

		const payload = await board(pres.id);
		expect(payload.rankedCount).toBe(1);
		const watcher = await scorecard(pres.id, "watched");
		expect(watcher.rank).toBe(null);
		expect(watcher.rankedCount).toBe(1);
	});

	test("the slide shows the places it asked for, and counts the rest", async () => {
		const pres = await createAndStart(quizDeck({ leaderboardSize: 2 }));
		// Four competitors, each on a different score, so the cut is unambiguous.
		await answer(pres.id, "a", "q1", "q1-right");
		await answer(pres.id, "a", "q2", "q2-right");
		await answer(pres.id, "b", "q1", "q1-right");
		await answer(pres.id, "c", "q1", "q1-wrong");
		await answer(pres.id, "d", "q2", "q2-wrong");

		const payload = await board(pres.id);
		expect(payload.size).toBe(2);
		expect(payload.entries).toHaveLength(2);
		// Everyone stays ranked behind the cut — the size bounds the view, not the
		// standings, which is what lets a participant below it be told their place.
		expect(payload.rankedCount).toBe(4);
		expect(payload.entries[0].rank).toBe(1);
		expect(payload.entries[1].rank).toBe(2);
	});

	test("the cut is hard, and equality of place survives it", async () => {
		// A tied block straddling the cut: the board shows one of the two, and the
		// other is counted in the remainder rather than extending the slide past
		// the size its author asked for — a cap that grew through ties would put a
		// whole room on the projector after one question everybody got right. What
		// ties buy is the *place*, and that survives: the row below the cut holds
		// the same rank and is told it on its own screen.
		const pres = await createAndStart(quizDeck({ leaderboardSize: 1 }));
		await answer(pres.id, "level-one", "q1", "q1-wrong");
		await answer(pres.id, "level-two", "q1", "q1-wrong");

		const payload = await board(pres.id);
		expect(payload.entries).toHaveLength(1);
		expect(payload.entries[0].rank).toBe(1);
		expect(payload.rankedCount).toBe(2);

		const shown = payload.entries[0].entryId;
		const cutCard = await scorecard(
			pres.id,
			(await scorecard(pres.id, "level-one")).entryId === shown
				? "level-two"
				: "level-one",
		);
		expect(cutCard.rank).toBe(1);
		expect(cutCard.rankedCount).toBe(2);
	});

	test("two participants who scored the same share a place", async () => {
		const pres = await createAndStart(quizDeck());
		// Both wrong on the same question: level at zero, and level is level.
		await answer(pres.id, "one", "q1", "q1-wrong");
		await answer(pres.id, "two", "q1", "q1-wrong");

		const payload = await board(pres.id);
		expect(payload.entries.map((entry: AnyJson) => entry.rank)).toEqual([1, 1]);
	});

	// ── Anonymity ──────────────────────────────────────────────

	test("the board names nobody — no participant id reaches it", async () => {
		// The results endpoint is public, and a participant id is the only
		// credential a vote carries: publishing the room's ids on the most-watched
		// surface in the product would hand anyone the means to answer as anyone.
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "secret-participant", "q1", "q1-right");

		const payload = JSON.stringify(await board(pres.id));
		expect(payload).not.toContain("secret-participant");
		expect(payload).not.toContain("participantId");
	});

	test("a row's handle is stable, and different from another room's", async () => {
		const first = await createAndStart(quizDeck());
		const second = await createAndStart(quizDeck());
		await answer(first.id, "same-person", "q1", "q1-right");
		await answer(second.id, "same-person", "q1", "q1-right");

		const firstHandle = (await board(first.id)).entries[0].entryId;
		const secondHandle = (await board(second.id)).entries[0].entryId;
		expect(firstHandle).toBeTruthy();
		// Re-read: the same participant keeps the same handle across refreshes, so
		// a phone can keep matching its own row.
		expect((await board(first.id)).entries[0].entryId).toBe(firstHandle);
		// ...and a different deck is a different handle, so two boards cannot be
		// joined to follow one person around.
		expect(secondHandle).not.toBe(firstHandle);
	});

	test("a row is called something a room can read, derived from that handle", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "somebody", "q1", "q1-right");
		const entry = (await board(pres.id)).entries[0];
		expect(entry.label).toBe(`Player ${entry.entryId.slice(0, 6).toUpperCase()}`);
	});

	// ── Finding yourself on an anonymous board ─────────────────

	test("a participant's own card tells them which row is theirs, and where", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "leader", "q1", "q1-right");
		await answer(pres.id, "leader", "q2", "q2-right");
		await answer(pres.id, "follower", "q1", "q1-wrong");

		const card = await scorecard(pres.id, "follower");
		expect(card.rank).toBe(2);
		expect(card.rankedCount).toBe(2);
		expect(card.label).toBe(`Player ${card.entryId.slice(0, 6).toUpperCase()}`);

		const payload = await board(pres.id);
		const own = payload.entries.find(
			(entry: AnyJson) => entry.entryId === card.entryId,
		);
		expect(own).toBeTruthy();
		expect(own.rank).toBe(card.rank);
		expect(own.totalPoints).toBe(card.totalPoints);
	});

	test("a card's place agrees with the board even when the board cannot show it", async () => {
		// The point of telling somebody their place: they are 3rd of 3 on a board
		// that shows one row, and "3 of 3" is still the answer to where they stand.
		const pres = await createAndStart(quizDeck({ leaderboardSize: 1 }));
		await answer(pres.id, "first", "q1", "q1-right");
		await answer(pres.id, "first", "q2", "q2-right");
		await answer(pres.id, "second", "q1", "q1-right");
		await answer(pres.id, "third", "q1", "q1-wrong");

		const payload = await board(pres.id);
		expect(payload.entries).toHaveLength(1);
		expect(payload.rankedCount).toBe(3);

		const card = await scorecard(pres.id, "third");
		expect(card.rank).toBe(3);
		expect(card.rankedCount).toBe(3);
		// And their handle is genuinely absent from the shown rows, so the client
		// highlighting "you" cannot accidentally match somebody else.
		expect(
			payload.entries.some((entry: AnyJson) => entry.entryId === card.entryId),
		).toBe(false);
	});

	test("a card carries a handle before its holder has scored anything", async () => {
		const pres = await createAndStart(quizDeck());
		const card = await scorecard(pres.id, "not-yet");
		expect(card.entryId).toBeTruthy();
		expect(card.rank).toBe(null);
		expect(card.rankedCount).toBe(0);
	});

	// ── Still derived, never stored ────────────────────────────

	test("re-marking a solution re-orders the board with no migration", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "picked-wrong", "q1", "q1-wrong");
		await answer(pres.id, "picked-right", "q1", "q1-right");

		const before = await board(pres.id);
		const winner = before.entries[0].entryId;
		expect(before.entries[0].totalPoints).toBeGreaterThan(0);

		// The organizer decides the other option was the right one all along.
		const patch = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						quizSlide("q1", {
							options: [
								{ id: "q1-wrong", text: "Wrong", isCorrect: true },
								{ id: "q1-right", text: "Right" },
							],
						}),
						quizSlide("q2"),
						boardSlide(),
					],
				}),
			},
		);
		expect(patch.status).toBe(200);

		const after = await board(pres.id);
		expect(after.entries[0].entryId).not.toBe(winner);
		expect(after.entries[0].totalPoints).toBeGreaterThan(0);
		expect(after.entries[1].totalPoints).toBe(0);
	});

	test("a deck with no quiz questions has a board with nothing to rank", async () => {
		// Authored correctly and still empty — which is why the editor says so
		// rather than leaving the author to find out on the projector.
		const pres = await createAndStart([
			{ id: "t", type: "text", question: "Hello", body: "" },
			boardSlide(),
		]);
		const payload = await board(pres.id);
		expect(payload.quizCount).toBe(0);
		expect(payload.maxPoints).toBe(0);
		expect(payload.entries).toEqual([]);
	});

	test("the board rides the all-results export like every other slide", async () => {
		const pres = await createAndStart(quizDeck());
		await answer(pres.id, "p1", "q1", "q1-right");

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/results`);
		expect(res.status).toBe(200);
		const all = (await res.json()) as AnyJson[];
		const entry = all.find((slide) => slide.slideId === "board");
		expect(entry.type).toBe("leaderboard");
		expect(entry.rankedCount).toBe(1);
	});
});
