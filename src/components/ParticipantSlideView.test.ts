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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationSchema, QUIZ_SUBMISSION_GRACE_MS } from "../../server/schemas";
import type { Presentation, Slide } from "../types";
import { ParticipantSlideView } from "./ParticipantSlideView";

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
			liveDeck(SELECT_QUIZ, RUNNING, { closedSlideIds: ["q1"] }),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
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
