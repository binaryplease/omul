/**
 * The shared screen while a quiz question is being answered (REQ214).
 *
 * The presenter page is what gets projected, and it is held by an editor, so the
 * tally in its hands carries the answer key and every option's count even while
 * the room is still deciding. What is asserted here is that none of it reaches
 * the screen until the question is over: the question, its countdown and how
 * many have answered — and then, once the window has closed (or the slide was
 * closed to answers), the results on the slide's own reveal setting.
 *
 * Rendered to static markup with React's server renderer, which needs no DOM.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationSchema } from "../../server/schemas";
import type { Presentation, Slide } from "../types";
import { PresenterSlideView } from "./PresenterSlideView";

const SELECT_QUIZ: Slide = {
	id: "q1",
	type: "quiz",
	question: "Which planet is closest to the sun?",
	timeLimit: 30,
	options: [
		{ id: "mercury", text: "Mercury", isCorrect: true },
		{ id: "mars", text: "Mars" },
	],
};

const TYPED_QUIZ: Slide = {
	id: "q2",
	type: "quiz",
	question: "Which is the largest ocean on Earth?",
	timeLimit: 30,
	quizAnswerMode: "type",
	quizAnswers: [
		{ id: "pacific", text: "Pacific" },
		{ id: "pacific-ocean", text: "Pacific Ocean" },
	],
};

/** What the editor's authenticated poll hands the shared screen for SELECT_QUIZ. */
const SELECT_TALLY = {
	type: "quiz",
	answerMode: "select",
	totalVotes: 2,
	respondentCount: 2,
	maxSelections: 1,
	typedAnswers: null,
	scoring: {
		answeredCount: 2,
		correctCount: 1,
		totalPoints: 836,
		maxPoints: 1000,
		averagePoints: 418,
		correctShare: 0.5,
	},
	options: [
		{ id: "mercury", text: "Mercury", count: 1, isCorrect: true },
		{ id: "mars", text: "Mars", count: 1, isCorrect: false },
	],
};

/** The same for TYPED_QUIZ — the editor reads the key and the groups throughout. */
const TYPED_TALLY = {
	...SELECT_TALLY,
	answerMode: "type",
	options: [],
	typedAnswers: {
		accepted: ["Pacific", "Pacific Ocean"],
		entries: [{ text: "Pacific", count: 2, isCorrect: true }],
		distinctCount: 1,
	},
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

function sharedScreen(slide: Slide, pres: Presentation, results: unknown) {
	return renderToStaticMarkup(
		createElement(PresenterSlideView, {
			slide,
			pres,
			results,
			serverClockOffsetMs: 0,
			controls: {
				canControl: true,
				onReveal: () => {},
				onRestartTimer: () => {},
				onSetParticipation: null,
				onDeleteAnswer: null,
			},
			joinUrl: "http://localhost/join/123456",
		}),
	);
}

/** Five seconds in: the window is open. */
const RUNNING = 5_000;
/** A minute in: the 30-second window and its grace are long gone. */
const OVER = 60_000;

describe("the shared screen while a quiz question runs (REQ214)", () => {
	test("a choice question shows its countdown and response count, and no answer", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING),
			SELECT_TALLY,
		);
		expect(markup).toContain("s left");
		expect(markup).toContain("2 responses");
		expect(markup).toContain("Results appear when the time is up.");
		// No correct mark, no bars to copy the majority off, no score line.
		expect(markup).not.toContain("correct</span>");
		expect(markup).not.toContain("Mercury");
		expect(markup).not.toContain("Mars");
		expect(markup).not.toContain("answered correctly");
	});

	test("a typed question shows neither the accepted answers nor what the room typed", () => {
		const markup = sharedScreen(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, RUNNING),
			TYPED_TALLY,
		);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Accepted:");
		expect(markup).not.toContain("Pacific");
		expect(markup).not.toContain("answered correctly");
	});

	test("an untimed question waits for the presenter to close it", () => {
		const untimed = { ...SELECT_QUIZ, timeLimit: 0 };
		const markup = sharedScreen(untimed, liveDeck(untimed, OVER), SELECT_TALLY);
		expect(markup).toContain(
			"Results appear once the question is closed to answers.",
		);
		expect(markup).not.toContain("Mercury");
	});
});

describe("the shared screen before a quiz question is asked (REQ216)", () => {
	test("a draft deck says to start the presentation, not that the question is being answered", () => {
		const draft = PresentationSchema.parse({
			id: "deck",
			code: "123456",
			title: "Quiz round",
			slides: [SELECT_QUIZ],
			status: "draft",
			createdAt: "2026-10-30T09:00:00.000Z",
		}) as Presentation;
		const markup = sharedScreen(SELECT_QUIZ, draft, null);
		expect(markup).toContain("Start the presentation to collect responses");
		expect(markup).not.toContain("Results appear");
	});
});

describe("the shared screen once a quiz question is over (REQ214)", () => {
	test("Instant shows the results and the solution when the window has closed", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER),
			SELECT_TALLY,
		);
		expect(markup).toContain("Time&#x27;s up");
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
		expect(markup).toContain("answered correctly");
	});

	test("Instant shows a typed question's key and answers when the window has closed", () => {
		const markup = sharedScreen(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, OVER),
			TYPED_TALLY,
		);
		expect(markup).toContain("Accepted: Pacific · Pacific Ocean");
	});

	test("closing the question to answers ends it, with time still on the clock", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, { closedSlideIds: ["q1"] }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
	});

	test("Private keeps them off the shared screen even then", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "private" }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Results are private");
		expect(markup).not.toContain("Mercury");
	});

	test("On click still waits for the presenter's reveal", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "on-click" }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Reveal results");
		expect(markup).not.toContain("Mercury");
	});
});

describe("a plain choice slide with a marked option (REQ013)", () => {
	test("is not a quiz, and keeps showing its tally and solution as answers land", () => {
		const poll: Slide = {
			...SELECT_QUIZ,
			type: "multiple-choice",
			timeLimit: undefined,
		};
		const markup = sharedScreen(poll, liveDeck(poll, RUNNING), {
			...SELECT_TALLY,
			type: "multiple-choice",
			scoring: null,
		});
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
	});
});
