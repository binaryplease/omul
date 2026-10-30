/**
 * Unit tests for the quiz-competition rules in server/schemas.ts
 * (REQ054, REQ056, REQ057).
 *
 * These cover the three decisions the whole slice hangs off, in isolation from
 * the store and the HTTP surface:
 *   - REQ057 — how long a question stays open, and when it is past
 *   - REQ056 — which answer is the solution, on a slide that has one at all
 *   - REQ054 — what an answer scores, by correctness and by speed
 *   - REQ214 — when a question is still being answered, so the shared screen
 *     draws nothing of what the room answered until it is over
 *   - REQ216 — that only a question somebody can be answering is running, and
 *     that closing an opened question ends it for the audience's payload too,
 *     while closing one before it opened ends nothing
 *   - REQ217 — that an answer is timed against the window it was given in
 *   - REQ226 — that a timed question on screen at go-live waits, closed to
 *     answers and with its result withheld, until the presenter starts it
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
	quizAwaitingStart,
	quizClosedAfterOpening,
	quizDeadlineFor,
	quizHasAnswerKey,
	quizQuestionIsRunning,
	quizSlidesWithoutAnswerKey,
	quizRemainingMs,
	quizTimeLimitFor,
	quizWindowNotYetOpened,
	scoreQuizAnswer,
	solutionVisibleToAudience,
	withSlideClosedAt,
} from "./schemas";

const OPENED_AT = "2026-01-01T12:00:00.000Z";
const OPENED_MS = Date.parse(OPENED_AT);

/** The presenter closed the question to answers five seconds after it opened. */
const CLOSED_AFTER_OPENING = {
	closedSlideIds: ["qz"],
	slideClosedAt: { qz: "2026-01-01T12:00:05.000Z" },
};
/** The presenter closed the question a minute before it was ever opened. */
const CLOSED_BEFORE_OPENING = {
	closedSlideIds: ["qz"],
	slideClosedAt: { qz: "2026-01-01T11:59:00.000Z" },
};

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

describe("quizHasAnswerKey (REQ219)", () => {
	const options = [
		{ id: "a", text: "Wien" },
		{ id: "b", text: "Graz" },
	];

	test("a select-answer quiz with no option marked has no key", () => {
		expect(quizHasAnswerKey({ type: "quiz", options })).toBe(false);
	});

	test("one marked option is a key", () => {
		expect(
			quizHasAnswerKey({
				type: "quiz",
				options: [{ ...options[0], isCorrect: true }, options[1]],
			}),
		).toBe(true);
	});

	test("a typed quiz has a key only once it accepts an answer the grader can match", () => {
		const typed = { type: "quiz" as const, quizAnswerMode: "type" as const };
		expect(quizHasAnswerKey({ ...typed, quizAnswers: [] })).toBe(false);
		// Rows the grader drops (blank, or punctuation that normalizes to
		// nothing) are no key either — the same reading that scores answers.
		expect(
			quizHasAnswerKey({ ...typed, quizAnswers: [{ text: " " }, { text: "." }] }),
		).toBe(false);
		expect(quizHasAnswerKey({ ...typed, quizAnswers: [{ text: "Wien" }] })).toBe(
			true,
		);
	});

	test("a typed quiz is not rescued by a marked option it no longer offers", () => {
		expect(
			quizHasAnswerKey({
				type: "quiz",
				quizAnswerMode: "type",
				options: [{ id: "a", isCorrect: true }],
				quizAnswers: [],
			}),
		).toBe(false);
	});

	test("only a quiz can be missing a key", () => {
		expect(quizHasAnswerKey({ type: "multiple-choice", options })).toBe(true);
		expect(quizHasAnswerKey({ type: "leaderboard" })).toBe(true);
	});

	test("the slides without one are listed in deck order", () => {
		expect(
			quizSlidesWithoutAnswerKey([
				{ type: "text" },
				{ type: "quiz", options },
				{ type: "quiz", options: [{ id: "a", isCorrect: true }] },
				{ type: "quiz", quizAnswerMode: "type", quizAnswers: [] },
			]),
		).toEqual([1, 3]);
		expect(quizSlidesWithoutAnswerKey([{ type: "text" }])).toEqual([]);
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
		// An answer stored before votes recorded their window (REQ217), on a
		// question whose timer was restarted after it: the window it is measured
		// against is not the one it was given in. Crediting it as instant would
		// hand the maximum to whoever answered last before the restart — the
		// slowest in the room outscoring everyone who answers the fresh window.
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

describe("quizQuestionIsRunning (REQ214)", () => {
	const quiz = { id: "qz", type: "quiz" as const, timeLimit: 10 };
	const deadline = OPENED_MS + 10_000;
	/** A live deck that opened the question at OPENED_AT and touched nothing else. */
	const opened = {
		status: "live",
		slideStartedAt: { qz: OPENED_AT },
		revealedSlideIds: [],
		closedSlideIds: [],
	};

	test("runs from the moment it opens until the grace after the buzzer", () => {
		expect(quizQuestionIsRunning(quiz, opened, OPENED_MS)).toBe(true);
		expect(quizQuestionIsRunning(quiz, opened, deadline - 1)).toBe(true);
		// An answer in flight at the buzzer still counts, so the screen must not
		// hand the room the answer while it can still be sent.
		expect(
			quizQuestionIsRunning(quiz, opened, deadline + QUIZ_SUBMISSION_GRACE_MS),
		).toBe(true);
	});

	test("is over once the grace has run out", () => {
		expect(
			quizQuestionIsRunning(
				quiz,
				opened,
				deadline + QUIZ_SUBMISSION_GRACE_MS + 1,
			),
		).toBe(false);
	});

	test("is over once the presenter closes it to answers", () => {
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...opened, ...CLOSED_AFTER_OPENING },
				OPENED_MS + 5_000,
			),
		).toBe(false);
	});

	test("a close made before it opened ended nothing, so it still runs (REQ216)", () => {
		// The projector must not draw the result of a question nobody has been
		// asked yet: the presenter reopens it, and the room would answer with it in
		// front of them.
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...opened, ...CLOSED_BEFORE_OPENING },
				OPENED_MS,
			),
		).toBe(true);
		// A close whose instant is unknown reads the same way — the side that
		// withholds.
		expect(
			quizQuestionIsRunning(quiz, { ...opened, closedSlideIds: ["qz"] }, OPENED_MS),
		).toBe(true);
		// Its window still ends it.
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...opened, ...CLOSED_BEFORE_OPENING },
				deadline + QUIZ_SUBMISSION_GRACE_MS + 1,
			),
		).toBe(false);
	});

	test("is over once its results are revealed, or the deck has ended", () => {
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...opened, revealedSlideIds: ["qz"] },
				OPENED_MS,
			),
		).toBe(false);
		expect(
			quizQuestionIsRunning(quiz, { ...opened, status: "ended" }, OPENED_MS),
		).toBe(false);
	});

	test("an untimed question runs until it is closed, however long it has been open", () => {
		const untimed = { ...quiz, timeLimit: 0 };
		expect(quizQuestionIsRunning(untimed, opened, OPENED_MS + 10_000_000)).toBe(
			true,
		);
		expect(
			quizQuestionIsRunning(
				untimed,
				{ ...opened, ...CLOSED_AFTER_OPENING },
				OPENED_MS + 10_000_000,
			),
		).toBe(false);
	});

	test("a question the presenter has not reached is not being answered (REQ216)", () => {
		// Nobody has been asked it, so nobody can have answered: a screen must not
		// call it "still being answered".
		expect(
			quizQuestionIsRunning(quiz, { ...opened, slideStartedAt: {} }, OPENED_MS),
		).toBe(false);
	});

	test("a deck that is not live is collecting nothing (REQ216)", () => {
		// A draft — never started, or reset back to draft — has no question running,
		// so the shared screen says to start the presentation, not to wait for it.
		expect(
			quizQuestionIsRunning(quiz, { ...opened, status: "draft" }, OPENED_MS),
		).toBe(false);
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...opened, status: "draft", slideStartedAt: {} },
				OPENED_MS,
			),
		).toBe(false);
	});

	test("an audience-paced deck runs its questions with no opening instant (REQ216)", () => {
		// A survey collects from before it starts and stamps nothing, so its
		// questions run until they are closed or the deck ends.
		const survey = {
			...opened,
			mode: "survey",
			status: "draft",
			slideStartedAt: {},
		};
		expect(quizQuestionIsRunning(quiz, survey, OPENED_MS)).toBe(true);
		expect(
			quizQuestionIsRunning(quiz, { ...survey, closedSlideIds: ["qz"] }, OPENED_MS),
		).toBe(false);
		expect(
			quizQuestionIsRunning(quiz, { ...survey, status: "ended" }, OPENED_MS),
		).toBe(false);
	});

	test("a plain choice slide with a marked option is not a quiz", () => {
		expect(
			quizQuestionIsRunning(
				{ id: "qz", type: "multiple-choice", timeLimit: 10 },
				opened,
				OPENED_MS,
			),
		).toBe(false);
	});
});

describe("a quiz question waiting at go-live (REQ226)", () => {
	const quiz = { id: "qz", type: "quiz" as const, timeLimit: 30 };
	/** A deck that has just gone live on the quiz, which nobody has started. */
	const waiting = {
		status: "live",
		mode: "live",
		activeSlideIndex: 0,
		slides: [{ id: "qz" }, { id: "next" }],
		slideStartedAt: {},
		revealedSlideIds: [],
		closedSlideIds: [],
	};

	test("is not open: an answer to it is refused rather than scored as instant", () => {
		expect(quizWindowNotYetOpened(quiz, waiting)).toBe(true);
		// Read as "no deadline" it would score the most a question awards.
		expect(
			scoreQuizAnswer({ isCorrect: true, elapsedMs: null, timeLimitSeconds: 30 }),
		).toBe(QUIZ_MAX_POINTS);
	});

	test("is the one the room is waiting on, while it is on screen", () => {
		expect(quizAwaitingStart(quiz, waiting)).toBe(true);
		// A question further on has not been shown to anybody; it opens on arrival.
		expect(quizAwaitingStart(quiz, { ...waiting, activeSlideIndex: 1 })).toBe(
			false,
		);
		// Absent the deck's position, nothing is on screen to wait on.
		expect(
			quizAwaitingStart(quiz, {
				status: "live",
				slideStartedAt: {},
			}),
		).toBe(false);
	});

	test("stops waiting the moment the presenter starts its timer", () => {
		const started = { ...waiting, slideStartedAt: { qz: OPENED_AT } };
		expect(quizWindowNotYetOpened(quiz, started)).toBe(false);
		expect(quizAwaitingStart(quiz, started)).toBe(false);
	});

	test("counts as running, so nothing of its result is shown while it waits", () => {
		// "Not opened" read as "over" would put the key on the projector before
		// anybody had been asked.
		expect(quizQuestionIsRunning(quiz, waiting, OPENED_MS)).toBe(true);
		// A reveal or the end of the deck still ends it, as for any question.
		expect(
			quizQuestionIsRunning(
				quiz,
				{ ...waiting, revealedSlideIds: ["qz"] },
				OPENED_MS,
			),
		).toBe(false);
		expect(
			quizQuestionIsRunning(quiz, { ...waiting, status: "ended" }, OPENED_MS),
		).toBe(false);
	});

	test("an untimed question, a survey and a deck not yet live wait for nothing", () => {
		const untimed = { ...quiz, timeLimit: 0 };
		expect(quizWindowNotYetOpened(untimed, waiting)).toBe(false);
		expect(quizAwaitingStart(untimed, waiting)).toBe(false);
		expect(quizWindowNotYetOpened(quiz, { ...waiting, mode: "survey" })).toBe(
			false,
		);
		expect(quizWindowNotYetOpened(quiz, { ...waiting, status: "draft" })).toBe(
			false,
		);
		expect(
			quizWindowNotYetOpened(
				{ id: "qz", type: "multiple-choice", timeLimit: 30 },
				waiting,
			),
		).toBe(false);
	});
});

describe("solutionVisibleToAudience on a closed quiz question (REQ216)", () => {
	const quiz = { id: "qz", type: "quiz" as const, timeLimit: 10 };
	const opened = {
		status: "live",
		slideStartedAt: { qz: OPENED_AT },
		revealedSlideIds: [],
		closedSlideIds: [],
	};

	test("closing an opened question hands the room its key, with time still left", () => {
		expect(solutionVisibleToAudience(quiz, opened, OPENED_MS)).toBe(false);
		expect(
			solutionVisibleToAudience(
				quiz,
				{ ...opened, ...CLOSED_AFTER_OPENING },
				OPENED_MS + 5_000,
			),
		).toBe(true);
	});

	test("reopening it inside its window withholds the key again", () => {
		expect(
			solutionVisibleToAudience(quiz, { ...opened, closedSlideIds: [] }, OPENED_MS),
		).toBe(false);
	});

	test("a question closed before it was ever opened stays withheld", () => {
		// Closing a slide ahead of time is not a reveal: the deck a participant
		// joins with would otherwise carry that question answered.
		expect(
			solutionVisibleToAudience(
				quiz,
				{ ...opened, slideStartedAt: {}, closedSlideIds: ["qz"] },
				OPENED_MS,
			),
		).toBe(false);
	});

	test("a question closed ahead of time keeps its key back once it opens", () => {
		// The step-2 review's scenario: the presenter closes a draft deck's first
		// quiz, then goes live. The opening stamp lands on a closed slide, and the
		// close must not read as the end of a question that has only just begun.
		expect(
			solutionVisibleToAudience(
				quiz,
				{ ...opened, ...CLOSED_BEFORE_OPENING },
				OPENED_MS,
			),
		).toBe(false);
		// Nor a close nobody recorded the instant of.
		expect(
			solutionVisibleToAudience(
				quiz,
				{ ...opened, closedSlideIds: ["qz"], slideClosedAt: {} },
				OPENED_MS,
			),
		).toBe(false);
	});

	test("a restart puts a question closed before it back on the withholding side", () => {
		// The presenter asked it again: the close ended the old window, not this one.
		const restarted = {
			...opened,
			...CLOSED_AFTER_OPENING,
			slideStartedAt: { qz: "2026-01-01T12:01:00.000Z" },
		};
		expect(
			solutionVisibleToAudience(quiz, restarted, Date.parse("2026-01-01T12:01:01Z")),
		).toBe(false);
		expect(quizClosedAfterOpening(restarted, "qz")).toBe(false);
	});
});

describe("withSlideClosedAt (REQ111, REQ216)", () => {
	const AT = "2026-01-01T12:00:05.000Z";

	test("closing stamps the slide, and opening drops the stamp", () => {
		const closed = withSlideClosedAt({}, "qz", false, AT);
		expect(closed).toEqual({ qz: AT });
		expect(withSlideClosedAt(closed, "qz", true, AT)).toEqual({});
	});

	test("a second close keeps the first instant", () => {
		// A double-tap must not move a close that ended a question past an opening.
		expect(
			withSlideClosedAt({ qz: AT }, "qz", false, "2026-01-01T12:09:00.000Z"),
		).toEqual({ qz: AT });
	});

	test("leaves every other slide's stamp alone and never mutates its input", () => {
		const stamps = { other: AT };
		expect(withSlideClosedAt(stamps, "qz", false, AT)).toEqual({
			other: AT,
			qz: AT,
		});
		expect(stamps).toEqual({ other: AT });
	});
});
