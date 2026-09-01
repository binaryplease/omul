/**
 * Unit tests for the quiz countdown's shared descriptor (REQ057).
 *
 * `quizWindowFor` is the one place the participant's phone and the shared
 * screen agree on when a question closes, and it is the same derivation the
 * server's boundary enforces (`quizDeadlineFor`). What it has to get right is
 * every way a question can have *no* window — because that must never render as
 * a window that has already closed, which would lock a slide nobody was timing.
 */

import { describe, expect, test } from "bun:test";
import type { Presentation, Slide } from "../types";
import { quizWindowFor } from "./QuizTimer";

const OPENED_AT = "2026-01-01T12:00:00.000Z";

function quizSlide(overrides: Partial<Slide> = {}): Slide {
	return {
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		timeLimit: 30,
		...overrides,
	} as Slide;
}

/** A presentation carrying only what the window is read from. */
function withStamps(
	slideStartedAt: Record<string, string>,
): Pick<Presentation, "slideStartedAt"> {
	return { slideStartedAt };
}

describe("quizWindowFor (REQ057)", () => {
	test("closes the authored number of seconds after the question opened", () => {
		const window = quizWindowFor(quizSlide(), withStamps({ qz: OPENED_AT }));
		expect(window.timeLimit).toBe(30);
		expect(window.deadline).toBe(Date.parse(OPENED_AT) + 30_000);
	});

	test("a question the presenter has not reached has no deadline", () => {
		// It is still ahead in the deck, or nobody paces the deck at all (survey
		// mode). Either way there is no deadline — never one already gone.
		const window = quizWindowFor(quizSlide(), withStamps({}));
		expect(window.timeLimit).toBe(30);
		expect(window.deadline).toBe(null);
	});

	test("an untimed question has no deadline however long ago it opened", () => {
		const window = quizWindowFor(
			quizSlide({ timeLimit: 0 }),
			withStamps({ qz: OPENED_AT }),
		);
		expect(window.timeLimit).toBe(null);
		expect(window.deadline).toBe(null);
	});

	test("only the slide's own stamp opens it", () => {
		// A neighbour's countdown must not close this question.
		const window = quizWindowFor(
			quizSlide(),
			withStamps({ other: OPENED_AT }),
		);
		expect(window.deadline).toBe(null);
	});

	test("a non-quiz slide has no window at all", () => {
		// A poll or a word cloud stays open for as long as it is on screen, even
		// when a deck-wide `timeLimit` was left on the slide by a type change.
		const window = quizWindowFor(
			quizSlide({ type: "multiple-choice" }),
			withStamps({ qz: OPENED_AT }),
		);
		expect(window.timeLimit).toBe(null);
		expect(window.deadline).toBe(null);
	});

	test("no slide and no presentation are both an open-ended window", () => {
		expect(quizWindowFor(null, withStamps({ qz: OPENED_AT }))).toEqual({
			timeLimit: null,
			deadline: null,
		});
		expect(quizWindowFor(quizSlide(), null)).toEqual({
			timeLimit: 30,
			deadline: null,
		});
	});
});
