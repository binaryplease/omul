/**
 * Unit tests for the client half of answer moderation (REQ027).
 *
 * Taking one answer off a word cloud or an open-ended slide is one affordance
 * worn by two renderings — a card in the response wall, a row under the cloud —
 * so what is asserted here is the single descriptor both of them compose
 * and the three answers it has to get right:
 *
 *   - **an editor** gets a live control;
 *   - **a spectator** gets the control drawn and inert, carrying the reason
 *     — not a screen quietly missing a button;
 *   - **a surface with nothing stored behind it**, or a slide type the boundary
 *     refuses, gets no control at all — that is relevance, not availability.
 *
 * The guard the last of those reads (`slideAnswersAreDeletable`) is the server's
 * own, and is pinned down beside the boundary that refuses on it in
 * `server/answer-deletion.schemas.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDict } from "../i18n";
import { ENGLISH_INTERFACE_TEXT, interfaceTextFor } from "../interface-text";
import type { Presentation, Slide, SlideType } from "../types";
import { SLIDE_TYPE_LABELS } from "../types";
import {
	ANSWER_FILTER_LABEL_EN,
	ANSWER_MODERATION_DENIED,
	answerFilterReportOf,
	answerModerationFor,
	describeResponses,
	ENGLISH_RESULTS_WORDING,
	MC_VALUE_DISPLAY_OPTIONS,
	mcValueDisplayOptions,
	ResultsDisplay,
	type ResultsWording,
	resultLabelsFor,
} from "./Results";
import { PresenterSlideView } from "./PresenterSlideView";

/** The two types an answer is *text somebody wrote* on. */
const DELETABLE: SlideType[] = ["word-cloud", "open-text"];

/** Every slide type there is, read off the one descriptor that lists them all. */
const EVERY_SLIDE_TYPE = Object.keys(SLIDE_TYPE_LABELS) as SlideType[];

describe("answerModerationFor (REQ027)", () => {
	const onDelete = () => {};

	test("an editor on a word cloud gets the live control", () => {
		const moderation = answerModerationFor({
			slideType: "word-cloud",
			canControl: true,
			onDelete,
		});
		expect(moderation?.onDelete).toBe(onDelete);
	});

	test("an editor on an open-ended slide gets it too", () => {
		const moderation = answerModerationFor({
			slideType: "open-text",
			canControl: true,
			onDelete,
		});
		expect(moderation?.onDelete).toBe(onDelete);
	});

	test("a spectator gets the control, inert, with the reason on it", () => {
		const moderation = answerModerationFor({
			slideType: "open-text",
			canControl: false,
			onDelete,
		});
		// Present, so the control keeps its place and explains itself rather than
		// coming and going with who is watching.
		expect(moderation).toBeDefined();
		expect(moderation?.onDelete).toBeNull();
		expect(moderation?.disabledReason).toBe(ANSWER_MODERATION_DENIED);
	});

	test("a surface with nothing stored behind it draws nothing at all", () => {
		// The dry run (REQ103/REQ104): its answers were generated for it and never
		// written, so deleting one would delete nothing. Relevance, not
		// availability.
		expect(
			answerModerationFor({
				slideType: "word-cloud",
				canControl: true,
				onDelete: null,
			}),
		).toBeUndefined();
	});

	test("a slide type the boundary refuses is never offered the control", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			if (DELETABLE.includes(type)) continue;
			expect(
				answerModerationFor({ slideType: type, canControl: true, onDelete }),
			).toBeUndefined();
		}
	});

	test("the refusal is one wording, wherever it is drawn", () => {
		const cloud = answerModerationFor({
			slideType: "word-cloud",
			canControl: false,
			onDelete,
		});
		const wall = answerModerationFor({
			slideType: "open-text",
			canControl: false,
			onDelete,
		});
		expect(cloud?.disabledReason).toBe(wall?.disabledReason as string);
	});

	test("the reason names the action and why it is unavailable", () => {
		// A disabled control states why, not merely that.
		expect(ANSWER_MODERATION_DENIED).toContain("Delete this answer");
		expect(ANSWER_MODERATION_DENIED).toContain("cannot edit this presentation");
	});
});

// ── What the profanity filter kept off the wall (REQ085) ──────
//
// The filtering is the server's; what this module owes is saying so. A count
// under the tally on every surface, in the surface's language, and — only where
// an editor's read carried them — the words, behind a disclosure that is closed
// until somebody opens it, so even the results page puts nothing on a wall by
// being loaded.

const cloudSlide = { id: "wc", type: "word-cloud", question: "One word" } as Slide;
const wallSlide = { id: "oe", type: "open-text", question: "Ideas?" } as Slide;
const typedSlide = {
	id: "qz",
	type: "quiz",
	question: "Capital?",
	quizAnswerMode: "type",
} as Slide;

/** A word cloud's payload, as the results endpoint shapes it. */
function cloudPayload(changes: Record<string, unknown> = {}) {
	return {
		type: "word-cloud",
		totalVotes: 3,
		words: [{ text: "pizza", count: 1 }],
		answers: null,
		filteredCount: 2,
		filteredAnswers: null,
		...changes,
	};
}

function rendered(slide: Slide, results: unknown, label?: string): string {
	return renderToStaticMarkup(
		createElement(ResultsDisplay, {
			slide,
			results,
			...(label ? { answerFilterLabel: label } : {}),
		}),
	);
}

describe("answerFilterReportOf (REQ085)", () => {
	test("reads a word cloud's and an open-ended slide's block beside the tally", () => {
		expect(answerFilterReportOf(cloudSlide, cloudPayload())).toEqual({
			count: 2,
			answers: null,
		});
		const withheld = [{ id: "v1", text: "rude", createdAt: "2026-10-21T00:00:00Z" }];
		expect(
			answerFilterReportOf(wallSlide, {
				type: "open-text",
				responses: [],
				filteredCount: 1,
				filteredAnswers: withheld,
			}),
		).toEqual({ count: 1, answers: withheld });
	});

	test("reads a typed quiz question's block inside its typed answers", () => {
		expect(
			answerFilterReportOf(typedSlide, {
				type: "quiz",
				typedAnswers: { entries: null, filteredCount: 3, filteredAnswers: null },
			}),
		).toEqual({ count: 3, answers: null });
	});

	test("is nothing where the deck filters nothing, or the payload never said", () => {
		expect(answerFilterReportOf(cloudSlide, cloudPayload({ filteredCount: null }))).toBeNull();
		// A payload from before the filter existed — or the editor's sample tally.
		expect(answerFilterReportOf(cloudSlide, { type: "word-cloud", words: [] })).toBeNull();
		expect(answerFilterReportOf(cloudSlide, null)).toBeNull();
		expect(
			answerFilterReportOf(
				{ ...typedSlide, quizAnswerMode: "select" } as Slide,
				{ type: "quiz", typedAnswers: null },
			),
		).toBeNull();
	});
});

describe("the filter's line under a tally (REQ085)", () => {
	test("the shared screen says how many answers it is not showing, in English", () => {
		const markup = rendered(cloudSlide, cloudPayload());
		expect(markup).toContain("pizza");
		expect(markup).toContain(`${ANSWER_FILTER_LABEL_EN}: 2`);
	});

	test("a phone says it in the deck's language", () => {
		const markup = rendered(
			cloudSlide,
			cloudPayload(),
			"Vom Schimpfwortfilter zurückgehaltene Antworten",
		);
		expect(markup).toContain("Vom Schimpfwortfilter zurückgehaltene Antworten: 2");
		expect(markup).not.toContain(ANSWER_FILTER_LABEL_EN);
	});

	test("nothing is said while nothing was withheld, or while the filter is off", () => {
		expect(rendered(cloudSlide, cloudPayload({ filteredCount: 0 }))).not.toContain(
			ANSWER_FILTER_LABEL_EN,
		);
		expect(
			rendered(cloudSlide, cloudPayload({ filteredCount: null })),
		).not.toContain(ANSWER_FILTER_LABEL_EN);
	});

	test("a wall the filter emptied is not drawn as one still waiting", () => {
		const markup = rendered(cloudSlide, cloudPayload({ words: [], filteredCount: 3 }));
		expect(markup).not.toContain("Waiting for responses");
		expect(markup).toContain(`${ANSWER_FILTER_LABEL_EN}: 3`);
		const wall = rendered(wallSlide, {
			type: "open-text",
			responses: [],
			filteredCount: 1,
			filteredAnswers: null,
		});
		expect(wall).not.toContain("Waiting for responses");
		const typed = rendered(typedSlide, {
			type: "quiz",
			totalVotes: 1,
			typedAnswers: {
				accepted: ["Paris"],
				entries: [],
				distinctCount: 0,
				filteredCount: 1,
				filteredAnswers: null,
			},
			scoring: null,
		});
		expect(typed).not.toContain("No answers yet");
		expect(typed).toContain(`${ANSWER_FILTER_LABEL_EN}: 1`);
	});

	test("the results surface holds the words behind a disclosure that starts closed", () => {
		const markup = rendered(
			cloudSlide,
			cloudPayload({
				filteredAnswers: [
					{ id: "v1", text: "first-withheld-word", createdAt: "2026-10-21T00:00:00Z" },
					{ id: "v2", text: "second-withheld-word", createdAt: "2026-10-21T00:00:01Z" },
				],
			}),
		);
		expect(markup).toContain(`${ANSWER_FILTER_LABEL_EN}: 2`);
		expect(markup).toContain('aria-expanded="false"');
		// Loading the page puts none of them on screen: they are drawn once opened.
		expect(markup).not.toContain("first-withheld-word");
		expect(markup).not.toContain("second-withheld-word");
	});

	// Review (REQ248 batch, finding 2): the owner opening /results under a
	// German interface met "Show", the owner-only sentence and "Filtered" in
	// English. Those words are the deck holder's, so they follow the wording's
	// presenter text, which /results and the shared screen hand in.
	test("the words only the deck holder reads follow the interface language", () => {
		const german = interfaceTextFor("de");
		const markup = renderToStaticMarkup(
			createElement(ResultsDisplay, {
				slide: cloudSlide,
				results: cloudPayload({
					filteredAnswers: [
						{ id: "v1", text: "withheld", createdAt: "2026-10-21T00:00:00Z" },
					],
				}),
				wording: { room: getDict("en"), presenter: german, presenterLanguage: "de" },
			}),
		);
		expect(markup).toContain(`${ANSWER_FILTER_LABEL_EN}: 2`);
		expect(markup).toMatch(/lang="de"[^>]*>Anzeigen/);
		expect(markup).not.toContain(">Show<");
		expect(german.slideView.answerFilterBadge).toBe("Gefiltert");
		expect(german.slideView.answerFilterOwnerOnly).not.toBe(
			ENGLISH_INTERFACE_TEXT.slideView.answerFilterOwnerOnly,
		);
	});
});

// ── Who reads a result's words (REQ248) ───────────────────────
//
// On the shared screen — the presenter's screen, which is also the projector —
// a result's captions are the room's, in the deck's language, and the few words
// meant for the presenter are in the interface language. Every other surface
// keeps the English it drew before, a participant's phone above all.

describe("a result's words follow who reads them (REQ248)", () => {
	const germanDeck: ResultsWording = {
		room: getDict("de"),
		presenter: ENGLISH_INTERFACE_TEXT,
		presenterLanguage: "en",
	};
	const emptyCloud = cloudPayload({ words: [], filteredCount: null });

	test("the English default is the line every other surface already drew", () => {
		expect(ENGLISH_RESULTS_WORDING.room.waitingForResponses).toBe(
			"Waiting for responses...",
		);
		expect(rendered(cloudSlide, emptyCloud)).toContain("Waiting for responses...");
	});

	test("the shared screen draws the room's caption in the deck's language", () => {
		const markup = renderToStaticMarkup(
			createElement(ResultsDisplay, {
				slide: cloudSlide,
				results: emptyCloud,
				wording: germanDeck,
			}),
		);
		expect(markup).toContain(getDict("de").waitingForResponses);
		expect(markup).not.toContain("Waiting for responses");
	});

	test("the response count reads in the deck's words, and English by default", () => {
		const tally = { totalVotes: 3 };
		expect(describeResponses(cloudSlide, tally)).toBe("3 responses");
		expect(describeResponses(cloudSlide, { totalVotes: 1 })).toBe("1 response");
		expect(
			describeResponses(cloudSlide, tally, resultLabelsFor(getDict("de"))),
		).toBe("3 Antworten");
	});

	test("the presenter's own words follow the interface language", () => {
		const german = interfaceTextFor("de");
		expect(
			answerModerationFor(
				{ slideType: "word-cloud", canControl: false, onDelete: () => {} },
				german,
			)?.disabledReason,
		).toBe(german.slideView.answerDeleteDenied);
		expect(mcValueDisplayOptions(german).map((option) => option.label)).toEqual([
			"Anzahl",
			"Prozent",
			"Beides",
		]);
		// The constant other surfaces read stays the English list.
		expect(MC_VALUE_DISPLAY_OPTIONS.map((option) => option.label)).toEqual([
			"Count",
			"Percent",
			"Both",
		]);
	});
});

describe("the shared screen's slide speaks to the room in the deck's language (REQ248)", () => {
	const questionSlide = {
		id: "mc",
		type: "multiple-choice",
		question: "Lunch?",
		options: [],
	} as unknown as Slide;

	function sharedScreen(changes: Record<string, unknown>): string {
		const pres = {
			id: "deck-1",
			code: "123456",
			title: "Workshop",
			status: "live",
			language: "de",
			resultsVisibility: "instant",
			revealedSlideIds: [],
			closedSlideIds: [],
			slides: [questionSlide],
			...changes,
		} as unknown as Presentation;
		return renderToStaticMarkup(
			createElement(PresenterSlideView, {
				slide: questionSlide,
				pres,
				results: null,
				serverClockOffsetMs: 0,
				controls: {
					canControl: true,
					onReveal: () => {},
					onRestartTimer: null,
					onSetParticipation: null,
					onSetCountdown: null,
					onDeleteAnswer: null,
					audioCue: null,
				},
				joinUrl: "https://omul.test/join/123456",
			}),
		);
	}

	test("a German deck's waiting line is German, marked as German", () => {
		const markup = sharedScreen({});
		expect(markup).toContain(`lang="de"`);
		expect(markup).toContain(getDict("de").waitingForResponses);
		expect(markup).not.toContain("Waiting for responses");
	});

	test("what the room may not see is said in the room's words alone", () => {
		// REQ225: the projector carries no presenter-only line under a private
		// tally, so the room's sentence is all there is, marked with its language.
		const markup = sharedScreen({ resultsVisibility: "private" });
		expect(markup).toContain(
			`<div lang="de" class="text-center text-text-dim py-16">${getDict("de").resultsPrivate}</div>`,
		);
		expect(markup).not.toContain("not shown on the shared screen");
	});

	test("an English deck reads exactly as the shared screen always did", () => {
		const markup = sharedScreen({ language: "en", resultsVisibility: "private" });
		expect(markup).toContain("Results are private");
	});

	test("a running quiz question's waiting line carries the deck's lang", () => {
		// Review: the line drawn while a quiz question runs had no lang, so a
		// German interface over an English deck announced it as German.
		const quiz = {
			id: "qz",
			type: "quiz",
			question: "Closest to the sun?",
			options: [{ id: "venus", text: "Venus" }],
			timeLimit: 30,
		} as unknown as Slide;
		const pres = {
			id: "deck-1",
			code: "123456",
			title: "Workshop",
			status: "live",
			language: "en",
			resultsVisibility: "instant",
			revealedSlideIds: [],
			closedSlideIds: [],
			activeSlideIndex: 0,
			slides: [quiz],
		} as unknown as Presentation;
		const markup = renderToStaticMarkup(
			createElement(PresenterSlideView, {
				slide: quiz,
				pres,
				results: null,
				serverClockOffsetMs: 0,
				controls: {
					canControl: true,
					onReveal: () => {},
					onRestartTimer: null,
					onSetParticipation: null,
					onSetCountdown: null,
					onDeleteAnswer: null,
					audioCue: null,
				},
				joinUrl: "https://omul.test/join/123456",
			}),
		);
		expect(markup).toContain(
			`<div lang="en" class="text-center text-text-dim py-16">${getDict("en").resultsAppearWhenTimeUp}</div>`,
		);
	});

	test("before the deck is live, the presenter is told in the interface language", () => {
		const markup = sharedScreen({ status: "draft" });
		// No provider here, so the interface is English.
		expect(markup).toContain(ENGLISH_INTERFACE_TEXT.slideView.startToCollect);
		expect(markup).not.toContain(getDict("de").waitingForResponses);
	});
});

// ── A quiz result the reader may not see yet (REQ215) ────────────

/** A select quiz question, as the client holds it. */
const SELECT_QUIZ = {
	id: "qz",
	type: "quiz",
	question: "Closest to the sun?",
	options: [
		{ id: "venus", text: "Venus" },
		{ id: "mercury", text: "Mercury" },
	],
	timeLimit: 30,
	mcDisplayStyle: "bars",
	mcValueDisplay: "both",
} as unknown as Slide;

/** The same question answered by typing (REQ055). */
const TYPED_QUIZ = {
	...SELECT_QUIZ,
	quizAnswerMode: "type",
	options: [],
} as unknown as Slide;

/** The window and the answered count — the half of the score that stays. */
function windowScoring(answeredCount: number) {
	return {
		correctPoints: 500,
		speedPoints: 500,
		maxPoints: 1000,
		timeLimit: 30,
		startedAt: "2026-01-01T12:00:00.000Z",
		deadline: "2026-01-01T12:00:30.000Z",
		closed: false,
		answeredCount,
	};
}

/** What the room is sent for a select quiz question that is not over. */
const WITHHELD_SELECT = {
	type: "quiz",
	answerMode: "select",
	totalVotes: 3,
	respondentCount: 3,
	maxSelections: 1,
	typedAnswers: null,
	scoring: {
		...windowScoring(3),
		correctCount: null,
		totalPoints: null,
		averagePoints: null,
		correctShare: null,
	},
	options: [
		{ id: "venus", text: "Venus", count: null, isCorrect: null },
		{ id: "mercury", text: "Mercury", count: null, isCorrect: null },
	],
};

function render(slide: Slide, results: unknown): string {
	return renderToStaticMarkup(createElement(ResultsDisplay, { slide, results }));
}

describe("a quiz result withheld from its reader (REQ215)", () => {
	test("a select question says how many answered and draws no chart", () => {
		const markup = render(SELECT_QUIZ, WITHHELD_SELECT);
		expect(markup).toContain("3 answers in");
		// No bar per option, so no option label and no count beside it: zeros
		// would report a room that answered nothing.
		expect(markup).not.toContain("Venus");
		expect(markup).not.toContain("Mercury");
		expect(markup).not.toContain("0%");
		expect(markup).not.toContain("null");
	});

	test("nobody having answered yet still reads as that", () => {
		const markup = render(SELECT_QUIZ, {
			...WITHHELD_SELECT,
			totalVotes: 0,
			respondentCount: 0,
			scoring: { ...WITHHELD_SELECT.scoring, answeredCount: 0 },
		});
		expect(markup).toContain("No answers yet");
	});

	test("a typed question draws no score line from the missing numbers", () => {
		const markup = render(TYPED_QUIZ, {
			...WITHHELD_SELECT,
			answerMode: "type",
			options: [],
			typedAnswers: { accepted: null, entries: null, distinctCount: null },
		});
		expect(markup).toContain("3 answers in");
		expect(markup).not.toContain("null");
		expect(markup).not.toContain("correct");
	});

	test("once published, the counts and the score are drawn", () => {
		const markup = render(SELECT_QUIZ, {
			...WITHHELD_SELECT,
			scoring: {
				...windowScoring(3),
				correctCount: 2,
				totalPoints: 1800,
				averagePoints: 600,
				correctShare: 66.67,
			},
			options: [
				{ id: "venus", text: "Venus", count: 1, isCorrect: false },
				{ id: "mercury", text: "Mercury", count: 2, isCorrect: true },
			],
		});
		expect(markup).toContain("Venus");
		expect(markup).toContain("Mercury");
		expect(markup).toContain("2 of 3");
		expect(markup).not.toContain("answers in");
	});
});
