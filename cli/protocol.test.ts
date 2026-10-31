/**
 * What `cli/` restates instead of importing.
 *
 * `cli/protocol.ts` carries its own copy of the edit-token header name, and of
 * the one reading of a withheld quiz result (REQ215), so that the directory
 * imports nothing outside itself and the flake can build the executable
 * offline, from source, with nothing but Bun. That duplication is only safe
 * while the two copies agree, and this is what makes them agree: the test —
 * which runs with `node_modules` present and may therefore import the server —
 * reads the server's own copy and compares.
 *
 * If the header check fails, the header was renamed on the server side and
 * every mutation this client authorizes with an edit token is about to start
 * answering `401`. If the quiz check fails, the server changed the shape a
 * withheld result is sent in, and `omul results` is about to print its nulls
 * as if they were a room that answered nothing.
 */

import { describe, expect, test } from "bun:test";
import {
	quizResultWithheld as serverQuizResultWithheld,
	EDIT_TOKEN_HEADER as SERVER_EDIT_TOKEN_HEADER,
} from "../server/schemas";
import { summarizeTally } from "./commands";
import { EDIT_TOKEN_HEADER, quizResultWithheld } from "./protocol";

/** A quiz question's scoring block, its correctness half as given. */
function quizScoring(correctness: Record<string, unknown>) {
	return {
		maxPoints: 1000,
		timeLimit: 30,
		startedAt: "2026-01-01T12:00:00.000Z",
		deadline: "2026-01-01T12:00:30.000Z",
		closed: false,
		answeredCount: 2,
		...correctness,
	};
}

const WITHHELD_QUIZ = {
	type: "quiz",
	totalVotes: 2,
	respondentCount: 2,
	options: [{ id: "a", text: "A", count: null, isCorrect: null }],
	scoring: quizScoring({
		correctCount: null,
		totalPoints: null,
		averagePoints: null,
		correctShare: null,
	}),
};

/** Payloads the two readings must agree on, one per shape a tally comes in. */
const TALLIES: unknown[] = [
	WITHHELD_QUIZ,
	{
		...WITHHELD_QUIZ,
		options: [{ id: "a", text: "A", count: 2, isCorrect: true }],
		scoring: quizScoring({
			correctCount: 2,
			totalPoints: 1800,
			averagePoints: 900,
			correctShare: 100,
		}),
	},
	{
		...WITHHELD_QUIZ,
		totalVotes: 0,
		respondentCount: 0,
		scoring: quizScoring({
			answeredCount: 0,
			correctCount: 0,
			totalPoints: 0,
			averagePoints: null,
			correctShare: null,
		}),
	},
	{ type: "quiz", withheld: true },
	{ type: "multiple-choice", totalVotes: 1, scoring: null },
	{ type: "leaderboard", totalVotes: 0 },
	null,
	"quiz",
];

describe("the wire vocabulary", () => {
	test("the client's edit-token header is the server's", () => {
		expect(EDIT_TOKEN_HEADER).toBe(SERVER_EDIT_TOKEN_HEADER);
	});

	test("the client reads a withheld quiz result exactly as the server does (REQ215)", () => {
		for (const tally of TALLIES) {
			expect(quizResultWithheld(tally)).toBe(serverQuizResultWithheld(tally));
		}
		expect(quizResultWithheld(WITHHELD_QUIZ)).toBe(true);
	});
});

describe("omul results on a quiz question that is not over (REQ215)", () => {
	test("says the answers are withheld rather than leaving nulls to read as zeros", () => {
		const line = summarizeTally(WITHHELD_QUIZ);
		expect(line).toContain("2 respondents");
		expect(line).toContain("answers withheld until the question is over");
	});

	test("a published quiz result says nothing of the kind", () => {
		expect(summarizeTally(TALLIES[1] as Record<string, unknown>)).not.toContain(
			"withheld",
		);
	});
});
