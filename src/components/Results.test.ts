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
import type { Slide, SlideType } from "../types";
import { SLIDE_TYPE_LABELS } from "../types";
import {
	ANSWER_FILTER_LABEL_EN,
	ANSWER_MODERATION_DENIED,
	answerFilterReportOf,
	answerModerationFor,
	ResultsDisplay,
} from "./Results";

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
});
