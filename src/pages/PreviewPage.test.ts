/**
 * Unit tests for preview mode's client half (REQ103, REQ104).
 *
 * Two things, and the second is the one the slice stands on:
 *
 *   - **REQ103 — both perspectives render every slide type.** The preview draws
 *     each slide twice, and each pane picks its rendering from a named
 *     descriptor (`presenterSlideKind` / `participantSlideKind`). Walking the
 *     schema's own slide-type enum through both is what makes "every slide type
 *     in the catalog renders in preview" an assertion: a slide type added later
 *     and never taught to the preview fails here rather than rendering blank.
 *   - **REQ104 — a preview cannot vote.** The participant pane answers through a
 *     transport, and the preview's transport is local by construction. That is
 *     tested the only way a claim about *absence* can be: with `fetch` replaced
 *     by something that throws.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import {
	participantSlideKind,
	type ParticipantSlideKind,
} from "../components/ParticipantSlideView";
import {
	presenterSlideKind,
	type PresenterSlideKind,
} from "../components/PresenterSlideView";
import { previewScorecard, previewVoteTransport } from "./PreviewPage";
import type { Slide } from "../types";
import { QUIZ_CORRECT_POINTS, QUIZ_MAX_POINTS } from "../types";

const EVERY_SLIDE_TYPE = SlideTypeEnum.options;

describe("both preview panes cover every slide type (REQ103)", () => {
	test("the shared screen has a rendering for each", () => {
		const covered: Record<string, PresenterSlideKind> = {};
		for (const type of EVERY_SLIDE_TYPE) covered[type] = presenterSlideKind(type);

		expect(covered).toEqual({
			"multiple-choice": "results",
			"word-cloud": "results",
			"open-text": "results",
			scale: "results",
			ranking: "results",
			grid: "results",
			points: "results",
			"guess-number": "results",
			"pin-image": "results",
			quiz: "results",
			form: "results",
			leaderboard: "standings",
			text: "content",
			image: "content",
			video: "content",
			embed: "content",
			instruction: "content",
		});
	});

	test("a participant's phone has a rendering for each", () => {
		const covered: Record<string, ParticipantSlideKind> = {};
		for (const type of EVERY_SLIDE_TYPE) covered[type] = participantSlideKind(type);

		expect(covered).toEqual({
			"multiple-choice": "answer",
			"word-cloud": "answer",
			"open-text": "answer",
			scale: "answer",
			ranking: "answer",
			grid: "answer",
			points: "answer",
			"guess-number": "answer",
			"pin-image": "answer",
			quiz: "answer",
			form: "answer",
			leaderboard: "standings",
			text: "content",
			image: "content",
			video: "content",
			embed: "content",
			instruction: "content",
		});
	});

	test("every slide type is drawn by both panes — none falls through", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect(presenterSlideKind(type)).toBeDefined();
			expect(participantSlideKind(type)).toBeDefined();
		}
		// The catalog's own list is the denominator, so a new type widens this
		// test the moment it is added to the schema.
		expect(EVERY_SLIDE_TYPE.length).toBe(17);
	});

	test("a slide that collects answers is a 'results' screen and an 'answer' phone", () => {
		// The two descriptors disagree on purpose: the same slide is a tally on the
		// projector and a control on the phone. That divergence is the whole reason
		// a preview shows both, so it is asserted rather than assumed.
		for (const type of EVERY_SLIDE_TYPE) {
			const onScreen: PresenterSlideKind = presenterSlideKind(type);
			const onPhone: ParticipantSlideKind = participantSlideKind(type);
			expect(onPhone).toBe(onScreen === "results" ? "answer" : onScreen);
		}
	});
});

// ── REQ104 — a preview cannot vote ────────────────────────────

const OPENED_AT = "2026-08-06T10:00:00.000Z";

const QUIZ_SLIDE: Slide = {
	id: "qz",
	type: "quiz",
	question: "Capital of France?",
	options: [
		{ id: "qz-a", text: "Paris", isCorrect: true },
		{ id: "qz-b", text: "Lyon" },
	],
	timeLimit: 30,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("previewVoteTransport (REQ104)", () => {
	test("answering makes no network call at all", async () => {
		globalThis.fetch = (() => {
			throw new Error("a preview must never reach the network");
		}) as unknown as typeof fetch;

		const answers = new Map();
		const transport = previewVoteTransport(
			[QUIZ_SLIDE],
			answers,
			OPENED_AT,
			() => {},
		);
		await transport.vote({ slideId: "qz", value: "qz-a" });
		await transport.upvoteResponse({ slideId: "qz", responseId: "r1" });
		await transport.scorecard();

		// The answer went into the browser's own map and nowhere else.
		expect(answers.get("qz")?.value).toBe("qz-a");
	});

	test("a sub-item answer is held per statement, as the real vote is", async () => {
		const answers = new Map();
		const transport = previewVoteTransport([], answers, OPENED_AT, () => {});
		await transport.vote({ slideId: "gr", value: "3,4", statementId: "item-1" });
		await transport.vote({ slideId: "gr", value: "0,0", statementId: "item-2", skip: true });

		expect(answers.get("gr:item-1")?.value).toBe("3,4");
		expect(answers.get("gr:item-2")?.skip).toBe(true);
		// The slide-level key stays free: a grid is answered item by item, and
		// folding the two onto one key would let one item's answer erase another's.
		expect(answers.has("gr")).toBe(false);
	});

	test("the caller is told an answer landed, so the verdict can re-read", async () => {
		let notified = 0;
		const transport = previewVoteTransport(
			[QUIZ_SLIDE],
			new Map(),
			OPENED_AT,
			() => notified++,
		);
		await transport.vote({ slideId: "qz", value: "qz-a" });
		expect(notified).toBe(1);
	});
});

describe("previewScorecard (REQ056 in a dry run)", () => {
	test("scores a correct answer with the same function the server uses", () => {
		const opened = Date.parse(OPENED_AT);
		const card = previewScorecard(
			[QUIZ_SLIDE],
			new Map([
				// Answered exactly at the buzzer: correct, with no speed bonus left.
				["qz", { value: "qz-a", skip: false, answeredAtMs: opened + 30_000 }],
			]),
			OPENED_AT,
		);
		expect(card.quizCount).toBe(1);
		expect(card.answeredCount).toBe(1);
		expect(card.correctCount).toBe(1);
		expect(card.totalPoints).toBe(QUIZ_CORRECT_POINTS);
		expect(card.maxPoints).toBe(QUIZ_MAX_POINTS);
		expect(card.slides[0].isCorrect).toBe(true);
		expect(card.slides[0].optionId).toBe("qz-a");
		expect(card.slides[0].answer).toBeNull();
	});

	test("an instant correct answer banks the whole question", () => {
		const opened = Date.parse(OPENED_AT);
		const card = previewScorecard(
			[QUIZ_SLIDE],
			new Map([["qz", { value: "qz-a", skip: false, answeredAtMs: opened }]]),
			OPENED_AT,
		);
		expect(card.slides[0].points).toBe(QUIZ_MAX_POINTS);
	});

	test("a wrong answer scores nothing, and is not reported as unanswered", () => {
		const opened = Date.parse(OPENED_AT);
		const card = previewScorecard(
			[QUIZ_SLIDE],
			new Map([
				["qz", { value: "qz-b", skip: false, answeredAtMs: opened + 1000 }],
			]),
			OPENED_AT,
		);
		expect(card.slides[0].answered).toBe(true);
		expect(card.slides[0].isCorrect).toBe(false);
		expect(card.slides[0].points).toBe(0);
		expect(card.correctCount).toBe(0);
	});

	test("an unanswered question reads as null, not as wrong", () => {
		const card = previewScorecard([QUIZ_SLIDE], new Map(), OPENED_AT);
		expect(card.slides[0].answered).toBe(false);
		expect(card.slides[0].isCorrect).toBeNull();
		expect(card.slides[0].optionId).toBeNull();
		expect(card.slides[0].elapsedMs).toBeNull();
		expect(card.slides[0].points).toBe(0);
	});

	test("a typed answer lands in `answer`, never in `optionId` (REQ055)", () => {
		const typed: Slide = {
			id: "qt",
			type: "quiz",
			question: "Name it",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "a1", text: "Paris" }],
			timeLimit: 0,
		};
		const card = previewScorecard(
			[typed],
			new Map([
				["qt", { value: "paris.", skip: false, answeredAtMs: Date.parse(OPENED_AT) }],
			]),
			OPENED_AT,
		);
		expect(card.slides[0].answer).toBe("paris.");
		expect(card.slides[0].optionId).toBeNull();
		// Normalization is the server's rule, read through the shared function —
		// so a preview grades a spelling exactly as the room would be graded.
		expect(card.slides[0].isCorrect).toBe(true);
		// Untimed: no window to be fast inside, so the question is worth its full
		// value at its best (REQ057).
		expect(card.slides[0].points).toBe(QUIZ_MAX_POINTS);
	});

	test("nobody previewing holds a place on the synthetic room's board (REQ059)", () => {
		const card = previewScorecard([QUIZ_SLIDE], new Map(), OPENED_AT);
		expect(card.rank).toBeNull();
		expect(card.rankedCount).toBe(0);
	});

	test("only quiz slides are on the card", () => {
		const card = previewScorecard(
			[
				QUIZ_SLIDE,
				{ id: "mc", type: "multiple-choice", question: "Pick", options: [] },
				{ id: "tx", type: "text", question: "Hello" },
			],
			new Map(),
			OPENED_AT,
		);
		expect(card.slides.map((entry) => entry.slideId)).toEqual(["qz"]);
	});
});
