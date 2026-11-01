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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Presentation, Slide } from "../types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type QuizCountdown,
	QuizTimer,
	quizCountdownAnnouncement,
	quizCountdownFrom,
	quizWindowFor,
} from "./QuizTimer";

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

/** A countdown standing at `remainingSeconds` of a `timeLimit`-second window. */
function countdownAt(remainingSeconds: number, timeLimit: number): QuizCountdown {
	return {
		remainingMs: remainingSeconds * 1000,
		remainingSeconds,
		expired: remainingSeconds <= 0,
		remainingShare: remainingSeconds / timeLimit,
		timed: true,
		timeLimit,
	};
}

describe("quizCountdownFrom, the instant a question starts (REQ235)", () => {
	const NOW = Date.parse(OPENED_AT);
	const STARTED = { timeLimit: 30, deadline: NOW + 30_000 };

	test("a question just started is running, not over", () => {
		// The reading in hand is the one taken while the question waited: no
		// deadline, nothing left. Rendered against the new deadline it read as
		// "Time's up", and the status lines announced it for the few milliseconds
		// until the clock was read again.
		const waited = { deadline: null, remainingMs: 0 };
		const countdown = quizCountdownFrom(waited, STARTED, NOW);
		expect(countdown.expired).toBe(false);
		expect(countdown.remainingSeconds).toBe(30);
		expect(quizCountdownAnnouncement(countdown)).toBe(null);
	});

	test("a restarted question is running, not over", () => {
		// "Restart timer": the reading in hand ran out on the old deadline.
		const ranOut = { deadline: NOW - 5_000, remainingMs: 0 };
		const countdown = quizCountdownFrom(ranOut, STARTED, NOW);
		expect(countdown.expired).toBe(false);
		expect(countdown.remainingShare).toBe(1);
	});

	test("a reading taken against this deadline is the one shown", () => {
		// The interval's own ticks: held as read, not re-read on every render.
		const ticked = { deadline: STARTED.deadline, remainingMs: 12_400 };
		expect(quizCountdownFrom(ticked, STARTED, NOW).remainingSeconds).toBe(13);
		const ranOut = { deadline: STARTED.deadline, remainingMs: 0 };
		expect(quizCountdownFrom(ranOut, STARTED, NOW).expired).toBe(true);
	});

	test("the countdown hook reads through it", () => {
		const source = readFileSync(join(import.meta.dir, "QuizTimer.tsx"), "utf8");
		expect(source).toContain("return quizCountdownFrom(reading, quizWindow, serverNow());");
	});
});

describe("quizCountdownAnnouncement (REQ221)", () => {
	test("says nothing until the first threshold, then holds it until the next", () => {
		// The region's text is the value, so a countdown re-rendering every 250 ms
		// changes it exactly twice before the buzzer — never once a second.
		expect(quizCountdownAnnouncement(countdownAt(60, 60))).toBe(null);
		expect(quizCountdownAnnouncement(countdownAt(31, 60))).toBe(null);
		expect(quizCountdownAnnouncement(countdownAt(30, 60))).toBe(30);
		expect(quizCountdownAnnouncement(countdownAt(11, 60))).toBe(30);
		expect(quizCountdownAnnouncement(countdownAt(10, 60))).toBe(10);
		expect(quizCountdownAnnouncement(countdownAt(1, 60))).toBe(10);
		expect(quizCountdownAnnouncement(countdownAt(0, 60))).toBe("expired");
	});

	test("a window no longer than a threshold does not open by announcing it", () => {
		// A ten-second question starts at ten seconds left: saying so over the
		// question as it appears would only talk over it.
		expect(quizCountdownAnnouncement(countdownAt(10, 10))).toBe(null);
		expect(quizCountdownAnnouncement(countdownAt(30, 30))).toBe(null);
		expect(quizCountdownAnnouncement(countdownAt(10, 30))).toBe(10);
	});

	test("an untimed question announces nothing", () => {
		expect(
			quizCountdownAnnouncement({
				...countdownAt(0, 30),
				timed: false,
				expired: false,
				timeLimit: null,
			}),
		).toBe(null);
	});
});

describe("QuizTimer's accessible shape (REQ221)", () => {
	const draw = (countdown: QuizCountdown) =>
		renderToStaticMarkup(
			createElement(QuizTimer, {
				countdown,
				label: "s left",
				spokenLabel: "{seconds} seconds left",
				expiredLabel: "Time's up",
			}),
		);

	test("the number is a silent timer and the announcement a polite status", () => {
		const markup = draw(countdownAt(8, 30));
		expect(markup).toContain('<span role="timer"');
		expect(markup).toContain(">8s left</span>");
		// At 8 s the last threshold crossed is 10, spelled out in full.
		expect(markup).toContain('<p role="status" class="sr-only">10 seconds left</p>');
		// The bar repeats the number as a picture.
		expect(markup).toContain('aria-hidden="true"');
	});

	test("the region says the window has closed", () => {
		expect(draw(countdownAt(0, 30))).toContain(
			'<p role="status" class="sr-only">Time&#x27;s up</p>',
		);
	});

	test("before the first threshold the region is there, and empty", () => {
		// Mounted from the start, or the first announcement would go unheard.
		expect(draw(countdownAt(45, 60))).toContain(
			'<p role="status" class="sr-only"></p>',
		);
	});
});
