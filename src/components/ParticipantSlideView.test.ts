/**
 * A participant's phone at the end of a quiz question (REQ216).
 *
 * The room's results under a quiz question appear on the phone when the question
 * is over — its window run out with the submission grace, or closed to answers
 * by the presenter — the same moment the shared screen shows them (REQ214). Not
 * at the countdown's own deadline: an answer in flight is still accepted for the
 * grace after it, so the room's result is not out yet, and the tally in hand is
 * still the running question's withheld one.
 *
 * Rendered to static markup with React's server renderer, which needs no DOM and
 * runs no effects — so the participant here has not answered, and what is drawn
 * is decided by the deck and the tally alone.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationSchema, QUIZ_SUBMISSION_GRACE_MS } from "../../server/schemas";
import type { Presentation, Slide } from "../types";
import { choiceCardState, ParticipantSlideView } from "./ParticipantSlideView";

const TIME_LIMIT_SECONDS = 30;

const SELECT_QUIZ: Slide = {
	id: "q1",
	type: "quiz",
	question: "Which planet is closest to the sun?",
	timeLimit: TIME_LIMIT_SECONDS,
	// The phone's copy of the deck: the key is withheld from it (REQ056).
	options: [
		{ id: "mercury", text: "Mercury" },
		{ id: "mars", text: "Mars" },
	],
};

const TYPED_QUIZ: Slide = {
	id: "q2",
	type: "quiz",
	question: "Which is the largest ocean on Earth?",
	timeLimit: TIME_LIMIT_SECONDS,
	quizAnswerMode: "type",
	quizAnswers: [],
};

const SCORING = {
	answeredCount: 2,
	correctCount: 1,
	totalPoints: 836,
	maxPoints: 1000,
	averagePoints: 418,
	correctShare: 0.5,
};

/** The room's frame for SELECT_QUIZ once it is over: the key is in it. */
const SELECT_TALLY_OVER = {
	type: "quiz",
	answerMode: "select",
	totalVotes: 2,
	respondentCount: 2,
	maxSelections: 1,
	typedAnswers: null,
	scoring: SCORING,
	options: [
		{ id: "mercury", text: "Mercury", count: 1, isCorrect: true },
		{ id: "mars", text: "Mars", count: 1, isCorrect: false },
	],
};

/** The room's last frame for TYPED_QUIZ while it ran: the answers withheld. */
const TYPED_TALLY_RUNNING = {
	...SELECT_TALLY_OVER,
	answerMode: "type",
	options: [],
	typedAnswers: { accepted: null, entries: null, distinctCount: 1 },
};

/** A live deck on `slide`, opened `openedAgoMs` before now. */
function liveDeck(
	slide: Slide,
	openedAgoMs: number,
	overrides: Record<string, unknown> = {},
): Presentation {
	return PresentationSchema.parse({
		id: "deck",
		code: "123456",
		title: "Quiz round",
		slides: [slide],
		status: "live",
		createdAt: "2026-10-30T09:00:00.000Z",
		slideStartedAt: {
			[slide.id]: new Date(Date.now() - openedAgoMs).toISOString(),
		},
		...overrides,
	}) as Presentation;
}

function phone(slide: Slide, pres: Presentation, results: unknown) {
	return renderToStaticMarkup(
		createElement(ParticipantSlideView, {
			pres,
			slide,
			results,
			serverClockOffsetMs: 0,
			isSurvey: false,
			transport: {
				participantId: "phone",
				vote: async () => {},
				upvoteResponse: async () => {},
				scorecard: async () => null,
			},
			onError: () => {},
		}),
	);
}

/** Half a second past the deadline: "Time's up", but still inside the grace. */
const IN_GRACE = TIME_LIMIT_SECONDS * 1000 + 500;
/** Past the deadline and its grace. */
const OVER = TIME_LIMIT_SECONDS * 1000 + QUIZ_SUBMISSION_GRACE_MS + 1000;
/** Five seconds in: the window is open. */
const RUNNING = 5_000;

describe("a participant's phone when a quiz question ends (REQ216)", () => {
	test("inside the grace after the buzzer, the running question's tally is not drawn", () => {
		// The countdown already reads "Time's up", but the result is not out: the
		// withheld frame in hand would read "…they appear once the question is
		// over" under it, which is exactly what stayed on screen.
		const markup = phone(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, IN_GRACE),
			TYPED_TALLY_RUNNING,
		);
		expect(markup).toContain("Time&#x27;s up");
		expect(markup).not.toContain("they appear once the question is over");
		expect(markup).not.toContain("Live results");
	});

	test("once the window and its grace are over, the room's results and the key appear", () => {
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), SELECT_TALLY_OVER);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
		expect(markup).toContain("answered correctly");
	});

	test("closing the question to answers ends it with time still on the clock", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date().toISOString() },
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
	});

	test("a question closed before it opened is not over (REQ216)", () => {
		// A close made ahead of time ended nothing, so the phone does not switch to
		// the results of a question the room has not been asked yet.
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date(Date.now() - 60_000).toISOString() },
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).not.toContain("Live results");
	});

	test("while the window is open, nothing of the room's answers is drawn", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Live results");
	});

	test("On click still waits for the presenter's reveal", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "on-click" }),
			SELECT_TALLY_OVER,
		);
		expect(markup).not.toContain("Live results");
		expect(markup).not.toContain("correct</span>");
	});

	test("and shows them once the presenter has revealed", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, {
				resultsVisibility: "on-click",
				revealedSlideIds: ["q1"],
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
	});
});

describe("a participant's phone while a quiz question waits at go-live (REQ226)", () => {
	/** The deck has just gone live on the quiz; nobody has started its timer. */
	const waiting = (slide: Slide, overrides: Record<string, unknown> = {}) =>
		liveDeck(slide, RUNNING, { slideStartedAt: {}, ...overrides });

	test("the question and its options are shown, locked, with the reason", () => {
		const markup = phone(SELECT_QUIZ, waiting(SELECT_QUIZ), null);
		expect(markup).toContain("Which planet is closest to the sun?");
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		expect(cards).toHaveLength(2);
		for (const card of cards) expect(card).toContain('aria-disabled="true"');
		// Said in the polite region, so it is announced and not only tooltipped.
		expect(markup).toMatch(
			/<div role="status" aria-atomic="false"><p[^>]*>Waiting for the presenter to start this question<\/p>/,
		);
		// No countdown before the window opens, and no verdict on a question
		// nobody could have answered yet.
		expect(markup).not.toContain("s left");
		expect(markup).not.toContain("No answer in time");
		expect(markup).not.toContain("Live results");
	});

	test("a typed question's field is locked the same way", () => {
		const markup = phone(TYPED_QUIZ, waiting(TYPED_QUIZ), null);
		const field = markup.match(/<input[^>]*>/)?.[0] ?? "";
		expect(field).toContain('aria-disabled="true"');
		expect(markup).toContain("Waiting for the presenter to start this question");
	});

	test("the reason is in the deck's language", () => {
		const markup = phone(
			SELECT_QUIZ,
			waiting(SELECT_QUIZ, { language: "de" }),
			null,
		);
		expect(markup).toContain("Warten, bis diese Frage gestartet wird");
	});

	test("a waiting question the presenter has also closed says closed, not waiting (REQ227)", () => {
		// Starting the timer does not reopen a closed slide, so "waiting for the
		// presenter to start" would promise something that is not coming.
		const markup = phone(
			SELECT_QUIZ,
			waiting(SELECT_QUIZ, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date().toISOString() },
			}),
			null,
		);
		expect(markup).toContain("The presenter has closed this question");
		expect(markup).not.toContain("Waiting for the presenter");
	});

	test("once the presenter starts it, the countdown runs and the options open", () => {
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Waiting for the presenter");
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		for (const card of cards) expect(card).not.toContain("aria-disabled");
	});
});

describe("the quiz view to a screen reader (REQ221)", () => {
	test("the answer controls are a group named by the question", () => {
		// An unnamed group is announced as just "group".
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null);
		const labelledBy = markup.match(/<fieldset aria-labelledby="([^"]+)"/)?.[1];
		expect(labelledBy).toBeTruthy();
		expect(markup).toContain(`<h2 id="${labelledBy}"`);
	});

	test("a locked option keeps focus: aria-disabled, never disabled", () => {
		// A disabled button gives up focus, so the card just pressed dropped the
		// participant onto <body> the moment the answer locked.
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), null);
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		expect(cards).toHaveLength(2);
		for (const card of cards) {
			expect(card).toContain('aria-disabled="true"');
			expect(card).not.toContain("disabled=\"\"");
		}
	});

	test("the lock reason sits in a polite region mounted before it is needed", () => {
		// Running: the region is already there, empty, so what lands in it later
		// is announced.
		expect(phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null)).toContain(
			'<div role="status" aria-atomic="false"><p class="text-center text-sm text-text-muted "></p>',
		);
		expect(phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), null)).toMatch(
			/<div role="status" aria-atomic="false"><p[^>]*>The time for this question is over<\/p>/,
		);
	});

	test("the typed answer keeps focus too", () => {
		const markup = phone(TYPED_QUIZ, liveDeck(TYPED_QUIZ, OVER), null);
		const field = markup.match(/<input[^>]*>/)?.[0] ?? "";
		expect(field).toContain("readOnly");
		expect(field).toContain('aria-disabled="true"');
		expect(field).not.toContain(" disabled=");
		expect(markup).toContain('role="timer"');
	});
});

describe("choiceCardState (REQ221, REQ223, REQ224)", () => {
	const base = {
		selectedIds: [] as string[],
		pendingOptionId: null,
		submitting: false,
		blockedByCap: false,
		locked: false,
	};

	test("the card just tapped is drawn as the choice while its answer is sent", () => {
		const sending = { ...base, pendingOptionId: "mercury", submitting: true };
		expect(choiceCardState({ ...sending, optionId: "mercury" })).toEqual({
			selected: true,
			pending: true,
			unavailable: true,
			dimmed: false,
		});
		// The others step back, so which one was picked is not in doubt.
		expect(choiceCardState({ ...sending, optionId: "mars" })).toEqual({
			selected: false,
			pending: false,
			unavailable: true,
			dimmed: true,
		});
	});

	test("a changed single-choice vote shows one chosen card while it is sent, not two", () => {
		const changing = {
			...base,
			selectedIds: ["mars"],
			pendingOptionId: "mercury",
			submitting: true,
		};
		expect(choiceCardState({ ...changing, optionId: "mercury" }).selected).toBe(
			true,
		);
		expect(choiceCardState({ ...changing, optionId: "mars" })).toEqual({
			selected: false,
			pending: false,
			unavailable: true,
			dimmed: true,
		});
	});

	test("an open card answers a tap; a locked one does not, and the chosen one stands out", () => {
		expect(choiceCardState({ ...base, optionId: "mars" }).unavailable).toBe(false);
		const locked = { ...base, selectedIds: ["mercury"], locked: true };
		expect(choiceCardState({ ...locked, optionId: "mercury" })).toEqual({
			selected: true,
			pending: false,
			unavailable: true,
			dimmed: false,
		});
		expect(choiceCardState({ ...locked, optionId: "mars" }).dimmed).toBe(true);
	});
});

describe("an option card under the pointer (REQ223)", () => {
	test("only a card that can still be picked takes the hover style", () => {
		// A locked card under a pointer the layout moved there wore the accent
		// border, which reads as "selected".
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		const hoverRules = css.match(/\.option-card:hover[^{]*\{/g) ?? [];
		expect(hoverRules.length).toBeGreaterThan(0);
		for (const rule of hoverRules) {
			expect(rule).toContain(':not(:disabled, [aria-disabled="true"])');
		}
	});

	test("the hover guard adds no specificity, so a selected card keeps its tint under the pointer", () => {
		// `.option-card:hover:not(...)` outranks `.option-card.selected`, and a
		// phone keeps hover on the card just tapped.
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		const hoverRules = css.match(/\.option-card:hover[^{]*\{/g) ?? [];
		for (const rule of hoverRules) {
			expect(rule).toContain(":where(:not(");
		}
	});
});
