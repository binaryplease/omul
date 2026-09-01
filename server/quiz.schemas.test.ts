/**
 * Unit tests for the quiz-competition rules in server/schemas.ts
 * (REQ054, REQ056, REQ057).
 *
 * These cover the three decisions the whole slice hangs off, in isolation from
 * the store and the HTTP surface:
 *   - REQ057 — how long a question stays open, and when it is past
 *   - REQ056 — which answer is the solution, on a slide that has one at all
 *   - REQ054 — what an answer scores, by correctness and by speed
 */

import { describe, expect, test } from "bun:test";
import {
	correctQuizOptionIds,
	isCorrectQuizAnswer,
	isQuizWindowOpen,
	QUIZ_CORRECT_POINTS,
	QUIZ_MAX_POINTS,
	QUIZ_SPEED_POINTS,
	QUIZ_SUBMISSION_GRACE_MS,
	quizDeadlineFor,
	quizRemainingMs,
	quizTimeLimitFor,
	scoreQuizAnswer,
} from "./schemas";

const OPENED_AT = "2026-01-01T12:00:00.000Z";
const OPENED_MS = Date.parse(OPENED_AT);

describe("quizTimeLimitFor (REQ057)", () => {
	test("reads the authored number of seconds", () => {
		expect(quizTimeLimitFor({ timeLimit: 30 })).toBe(30);
	});

	test("zero is the authored spelling of 'no limit', not 'no time'", () => {
		expect(quizTimeLimitFor({ timeLimit: 0 })).toBe(null);
	});

	test("a slide that never carried a limit has none", () => {
		expect(quizTimeLimitFor({})).toBe(null);
		expect(quizTimeLimitFor({ timeLimit: undefined })).toBe(null);
	});

	test("a limit that cannot be counted down reads as none", () => {
		expect(quizTimeLimitFor({ timeLimit: -5 })).toBe(null);
		expect(quizTimeLimitFor({ timeLimit: Number.NaN })).toBe(null);
		expect(quizTimeLimitFor({ timeLimit: Number.POSITIVE_INFINITY })).toBe(null);
	});
});

describe("quizDeadlineFor (REQ057)", () => {
	test("closes the window `timeLimit` seconds after it opened", () => {
		expect(quizDeadlineFor(OPENED_AT, 30)).toBe(OPENED_MS + 30_000);
	});

	test("a question nobody has opened yet has no deadline", () => {
		// Survey mode has no shared instant a question started (REQ003), and a
		// live deck has none for a slide the presenter has not reached. Both are
		// "no deadline to be past", never "a deadline already gone".
		expect(quizDeadlineFor(null, 30)).toBe(null);
		expect(quizDeadlineFor(undefined, 30)).toBe(null);
	});

	test("an untimed question has no deadline however long ago it opened", () => {
		expect(quizDeadlineFor(OPENED_AT, null)).toBe(null);
	});

	test("an unreadable opening instant has no deadline", () => {
		expect(quizDeadlineFor("not a date", 30)).toBe(null);
	});
});

describe("isQuizWindowOpen (REQ057)", () => {
	const deadline = OPENED_MS + 10_000;

	test("accepts a submission inside the window", () => {
		expect(isQuizWindowOpen(deadline, OPENED_MS)).toBe(true);
		expect(isQuizWindowOpen(deadline, deadline - 1)).toBe(true);
	});

	test("accepts one still in flight at the buzzer, within the grace", () => {
		expect(isQuizWindowOpen(deadline, deadline + 1)).toBe(true);
		expect(isQuizWindowOpen(deadline, deadline + QUIZ_SUBMISSION_GRACE_MS)).toBe(
			true,
		);
	});

	test("refuses one past the grace", () => {
		expect(
			isQuizWindowOpen(deadline, deadline + QUIZ_SUBMISSION_GRACE_MS + 1),
		).toBe(false);
	});

	test("a question with no deadline is always open", () => {
		expect(isQuizWindowOpen(null, OPENED_MS + 10_000_000)).toBe(true);
	});
});

describe("quizRemainingMs (REQ057)", () => {
	test("counts down to the deadline and stops at zero", () => {
		const deadline = OPENED_MS + 10_000;
		expect(quizRemainingMs(deadline, OPENED_MS)).toBe(10_000);
		expect(quizRemainingMs(deadline, OPENED_MS + 4_000)).toBe(6_000);
		expect(quizRemainingMs(deadline, deadline + 9_999)).toBe(0);
	});

	test("a question with no deadline has nothing to count down", () => {
		expect(quizRemainingMs(null, OPENED_MS)).toBe(0);
	});
});

describe("correctness (REQ013, REQ056)", () => {
	const slide = {
		options: [
			{ id: "a", text: "A", isCorrect: true },
			{ id: "b", text: "B" },
			{ id: "c", text: "C", isCorrect: true },
		],
	};

	test("names every option the organizer marked", () => {
		expect(correctQuizOptionIds(slide)).toEqual(["a", "c"]);
	});

	test("a marked option is a correct answer, an unmarked one is not", () => {
		expect(isCorrectQuizAnswer(slide, "a")).toBe(true);
		expect(isCorrectQuizAnswer(slide, "c")).toBe(true);
		expect(isCorrectQuizAnswer(slide, "b")).toBe(false);
	});

	test("an option the slide does not have is not a correct answer", () => {
		expect(isCorrectQuizAnswer(slide, "zz")).toBe(false);
	});

	test("nothing is correct on a slide whose author marked nothing", () => {
		const unfinished = { options: [{ id: "a", text: "A" }] };
		expect(correctQuizOptionIds(unfinished)).toEqual([]);
		expect(isCorrectQuizAnswer(unfinished, "a")).toBe(false);
	});
});

describe("scoreQuizAnswer (REQ054, REQ056)", () => {
	test("a wrong answer scores nothing, however fast it was", () => {
		expect(
			scoreQuizAnswer({ isCorrect: false, elapsedMs: 0, timeLimitSeconds: 30 }),
		).toBe(0);
	});

	test("an instant correct answer scores the maximum", () => {
		expect(
			scoreQuizAnswer({ isCorrect: true, elapsedMs: 0, timeLimitSeconds: 30 }),
		).toBe(QUIZ_MAX_POINTS);
	});

	test("the speed bonus falls linearly across the window", () => {
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: 15_000,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_CORRECT_POINTS + QUIZ_SPEED_POINTS / 2);
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: 24_000,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_CORRECT_POINTS + QUIZ_SPEED_POINTS * 0.2);
	});

	test("a correct answer at the buzzer still banks the correctness half", () => {
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: 30_000,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_CORRECT_POINTS);
	});

	test("an answer inside the grace scores what one at the buzzer scores", () => {
		// The grace buys acceptance, never points — see QUIZ_SUBMISSION_GRACE_MS.
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: 30_000 + QUIZ_SUBMISSION_GRACE_MS,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_CORRECT_POINTS);
	});

	test("an answer that predates its window claims no speed at all", () => {
		// The presenter restarted the timer under an answer already given, so the
		// window this answer is being measured against is not the one it was given
		// in. Crediting it as instant would hand the maximum to whoever answered
		// last before the restart — the slowest in the room outscoring everyone
		// who answers the fresh window quickly.
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: -5_000,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_CORRECT_POINTS);
	});

	test("a restart never lets a pre-restart answer outscore a fast fresh one", () => {
		// The reviewer's scenario, as an ordering: p1 answered at t=28 of a 30s
		// window; the presenter restarts at t=35; p2 answers 2s into the new one.
		const beforeRestart = scoreQuizAnswer({
			isCorrect: true,
			elapsedMs: -7_000,
			timeLimitSeconds: 30,
		});
		const freshAndFast = scoreQuizAnswer({
			isCorrect: true,
			elapsedMs: 2_000,
			timeLimitSeconds: 30,
		});
		expect(beforeRestart).toBeLessThan(freshAndFast);
		expect(beforeRestart).toBeLessThan(QUIZ_MAX_POINTS);
	});

	test("an untimed question awards the speed bonus in full", () => {
		// There is no window to be fast inside, so nobody is ranked against a
		// clock the slide never offered — and every question stays worth the same.
		expect(
			scoreQuizAnswer({
				isCorrect: true,
				elapsedMs: 900_000,
				timeLimitSeconds: null,
			}),
		).toBe(QUIZ_MAX_POINTS);
		expect(
			scoreQuizAnswer({ isCorrect: true, elapsedMs: null, timeLimitSeconds: 30 }),
		).toBe(QUIZ_MAX_POINTS);
	});
});
