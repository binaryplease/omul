/**
 * Unit tests for the stand-in room the canvas draws results from (REQ154).
 *
 * The rendering itself is the room's own (`Results.tsx`), so what is worth
 * asserting is the *payload* those renderers are handed. Five claims, and the
 * whole view rests on them:
 *
 *   - **It holds still.** Seeded on the slide's own id, so the same slide draws
 *     the same room on every render and in every session. A preview that
 *     reshuffled itself is one an author cannot compare two chart styles with —
 *     which is the only reason this view exists.
 *   - **Two slides are two rooms.** Folding the id in is what stops a deck of
 *     eight questions drawing the same eight bars.
 *   - **Every slide type that draws a tally gets one, and no other type does.**
 *     Asked of the schema's own enum, so a slide type nobody taught this module
 *     about fails here rather than drawing an empty frame on the stage.
 *   - **The answer key is the author's.** A marked option is marked in the
 *     tally, and a slide with nothing marked reports no notion of correctness at
 *     all rather than "all wrong" (ADR-0024) — the reveal draws those two
 *     differently, so the preview must not collapse them.
 *   - **It stands in for the room, never for the deck.** A leaderboard in a deck
 *     with no quiz questions draws the empty board it will really draw, and a
 *     slide with nothing authored yet says what to write instead of charting
 *     invented options.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import { newSlide } from "../store/editorDocument";
import type { Slide } from "../types";
import { slideHasResults } from "../types";
import {
	sampleTallyFor,
	sampleTallyHasContent,
	sampleTallyNote,
	sampleTallySeed,
} from "./SampleTally";

const EVERY_SLIDE_TYPE = SlideTypeEnum.options;

/** A choice slide with three options, one of them the marked solution. */
function choiceSlide(id: string, marked = true): Slide {
	return {
		id,
		type: "multiple-choice",
		question: "Which one?",
		options: [
			{ id: "a", text: "Alpha", isCorrect: marked },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		],
	};
}

describe("the stand-in room holds still (REQ154)", () => {
	test("the same slide draws the same tally, every time", () => {
		const slide = choiceSlide("slide-1");
		expect(sampleTallyFor(slide)).toEqual(sampleTallyFor(slide));
	});

	test("two slides draw two different rooms", () => {
		const first = sampleTallyFor(choiceSlide("slide-1")) as {
			options: { count: number }[];
		};
		const second = sampleTallyFor(choiceSlide("slide-2")) as {
			options: { count: number }[];
		};
		expect(first.options.map((option) => option.count)).not.toEqual(
			second.options.map((option) => option.count),
		);
	});

	test("the seed folds the whole id, not its first characters", () => {
		expect(sampleTallySeed("slide-aaaa")).not.toBe(sampleTallySeed("slide-aaab"));
	});

	test("an id nobody assigned still seeds something", () => {
		expect(sampleTallySeed("")).toBeGreaterThan(0);
	});
});

describe("every slide type is either charted or explicitly not (REQ154)", () => {
	test("a tally exists exactly for the types that draw one", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			const slide = newSlide(type);
			const tally = sampleTallyFor(slide);
			expect([type, tally !== null]).toEqual([type, slideHasResults(type)]);
		}
	});

	test("a content slide's note says it collects nothing", () => {
		expect(sampleTallyNote(newSlide("text"))).toContain("collects nothing");
	});

	test("every type gets a note rather than an empty frame", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect(sampleTallyNote(newSlide(type)).length).toBeGreaterThan(0);
		}
	});
});

describe("the answer key drawn is the author's (REQ013/REQ154)", () => {
	test("a marked option is marked in the tally", () => {
		const tally = sampleTallyFor(choiceSlide("slide-1")) as {
			options: { id: string; isCorrect: boolean | null }[];
		};
		expect(tally.options.map((option) => option.isCorrect)).toEqual([
			true,
			false,
			false,
		]);
	});

	test("a slide with nothing marked has no notion of correctness", () => {
		const tally = sampleTallyFor(choiceSlide("slide-1", false)) as {
			options: { isCorrect: boolean | null }[];
		};
		expect(tally.options.every((option) => option.isCorrect === null)).toBe(true);
	});

	test("a quiz reports a score, a plain choice slide reports none", () => {
		const quiz = sampleTallyFor({
			...choiceSlide("slide-q"),
			type: "quiz",
		}) as { scoring: unknown };
		expect(quiz.scoring).not.toBeNull();
		expect((sampleTallyFor(choiceSlide("slide-1")) as { scoring: unknown }).scoring).toBeNull();
	});

	test("a typed quiz shows the spellings the author said it accepts", () => {
		const tally = sampleTallyFor({
			id: "slide-typed",
			type: "quiz",
			question: "Capital of France?",
			quizAnswerMode: "type",
			quizAnswers: [
				{ id: "1", text: "Paris" },
				{ id: "2", text: "paris" },
			],
		}) as { typedAnswers: { accepted: string[]; entries: { text: string }[] } };
		expect(tally.typedAnswers.accepted).toEqual(["Paris", "paris"]);
		expect(tally.typedAnswers.entries.map((entry) => entry.text).sort()).toEqual([
			"Paris",
			"paris",
		]);
	});
});

describe("counts add up to the room they claim (REQ011/REQ014)", () => {
	test("a single-select slide's head count is its selections", () => {
		const tally = sampleTallyFor(choiceSlide("slide-1")) as {
			options: { count: number }[];
			totalVotes: number;
			respondentCount: number;
		};
		const cast = tally.options.reduce((sum, option) => sum + option.count, 0);
		expect(tally.totalVotes).toBe(cast);
		expect(tally.respondentCount).toBe(cast);
	});

	test("a multi-select slide has fewer people than selections, and no option beats the people", () => {
		const tally = sampleTallyFor({
			...choiceSlide("slide-multi"),
			mcMaxSelections: 0,
		}) as {
			options: { count: number }[];
			totalVotes: number;
			respondentCount: number;
		};
		expect(tally.respondentCount).toBeLessThan(tally.totalVotes);
		for (const option of tally.options) {
			expect(option.count).toBeLessThanOrEqual(tally.respondentCount);
		}
	});
});

describe("it stands in for the room, not for the deck (REQ059/REQ154)", () => {
	test("a leaderboard in a deck with no quiz questions draws an empty board", () => {
		const board = sampleTallyFor(newSlide("leaderboard"), 0) as {
			entries: unknown[];
			quizCount: number;
		};
		expect(board.quizCount).toBe(0);
		expect(board.entries).toEqual([]);
	});

	test("a leaderboard ranks the quiz questions the deck actually holds", () => {
		const board = sampleTallyFor(newSlide("leaderboard"), 3) as {
			entries: { rank: number; totalPoints: number }[];
			quizCount: number;
		};
		expect(board.quizCount).toBe(3);
		expect(board.entries.length).toBeGreaterThan(0);
		// Places descend, and so do the scores behind them — a board whose second
		// row outscored its first would be previewing an ordering the server
		// cannot produce.
		for (let row = 1; row < board.entries.length; row++) {
			expect(board.entries[row].rank).toBe(row + 1);
			expect(board.entries[row].totalPoints).toBeLessThanOrEqual(
				board.entries[row - 1].totalPoints,
			);
		}
	});

	test("a slide with no answers yet says what to write instead of charting one", () => {
		const empty: Slide = {
			id: "slide-empty",
			type: "multiple-choice",
			question: "",
			options: [],
		};
		expect(sampleTallyHasContent(empty)).toBe(false);
		expect(sampleTallyNote(empty)).toContain("Nothing to chart yet");
	});

	test("a slide the author has filled in is charted rather than nagged about", () => {
		const slide = choiceSlide("slide-1");
		expect(sampleTallyHasContent(slide)).toBe(true);
		expect(sampleTallyNote(slide)).toContain("Sample results");
	});

	test("a pin slide with no picture has nothing to point at", () => {
		expect(sampleTallyHasContent(newSlide("pin-image"))).toBe(false);
		const tally = sampleTallyFor(newSlide("pin-image")) as { pins: unknown[] };
		expect(tally.pins).toEqual([]);
	});

	test("pins land inside the picture, and mostly inside the target", () => {
		const tally = sampleTallyFor({
			id: "slide-pin",
			type: "pin-image",
			question: "Where is it?",
			mediaUrl: "https://example.com/map.png",
			pinArea: { x: 200, y: 200, width: 300, height: 300 },
		}) as {
			pins: { x: number; y: number }[];
			pinCount: number;
			correctCount: number | null;
		};
		expect(tally.pins.length).toBeGreaterThan(0);
		for (const pin of tally.pins) {
			expect(pin.x).toBeGreaterThanOrEqual(0);
			expect(pin.x).toBeLessThanOrEqual(1000);
			expect(pin.y).toBeGreaterThanOrEqual(0);
			expect(pin.y).toBeLessThanOrEqual(1000);
		}
		expect(tally.correctCount).toBeGreaterThan(0);
		expect(tally.correctCount).toBeLessThanOrEqual(tally.pinCount);
	});
});

describe("the payload is the wire's shape, not a convenient one (REQ154)", () => {
	test("a typed question offers no options — emptied, not withheld", () => {
		// `aggregateSlideResults` empties the list on a typed question rather than
		// dropping the key: a shortlist containing the answer is the one thing that
		// question type must not carry.
		const tally = sampleTallyFor({
			id: "slide-typed",
			type: "quiz",
			question: "Capital of France?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "1", text: "Paris" }],
		}) as { options: unknown };
		expect(tally.options).toEqual([]);
	});

	test("a form carries the submissions key, withheld", () => {
		// The rows themselves are the one thing this module will not invent — they
		// are somebody's name and address — so it emits the shape the aggregation
		// emits when it withholds them.
		const tally = sampleTallyFor(newSlide("form")) as {
			submissions: unknown;
			submissionCount: number;
		};
		expect(tally.submissions).toBeNull();
		expect(tally.submissionCount).toBeGreaterThan(0);
	});

	test("a scale's distribution is a real bucket map that adds up", () => {
		const tally = sampleTallyFor({
			id: "slide-scale",
			type: "scale",
			question: "Rate it",
			scaleMin: 1,
			scaleMax: 5,
		}) as {
			average: number;
			skipped: number;
			distribution: Record<string, number>;
		};
		const values = Object.keys(tally.distribution).map(Number).sort();
		expect(values).toEqual([1, 2, 3, 4, 5]);
		const counted = Object.values(tally.distribution).reduce(
			(sum, count) => sum + count,
			0,
		);
		// It adds up to the answers it claims, and clusters on the mean it reports
		// — a distribution disagreeing with its own average is two rooms.
		expect(counted).toBe(24 - tally.skipped);
		const peak = values.reduce((best, value) =>
			tally.distribution[value] > tally.distribution[best] ? value : best,
		);
		expect(Math.abs(peak - tally.average)).toBeLessThanOrEqual(1);
	});

	test("an inverted scale range degrades instead of crashing the canvas", () => {
		// An author mid-edit can hold min > max — typing 9 into Min while Max
		// still says 5 re-renders the results preview on that keystroke. The
		// distribution must degrade into the range those bounds span rather than
		// build zero buckets and throw on an empty reduce.
		const tally = sampleTallyFor({
			id: "slide-scale-inverted",
			type: "scale",
			question: "Rate it",
			scaleMin: 9,
			scaleMax: 5,
		}) as { distribution: Record<string, number>; skipped: number };
		const values = Object.keys(tally.distribution).map(Number).sort();
		expect(values).toEqual([5, 6, 7, 8, 9]);
		const counted = Object.values(tally.distribution).reduce(
			(sum, count) => sum + count,
			0,
		);
		expect(counted).toBe(24 - tally.skipped);
	});
});

describe("the ranking preview cannot contradict itself (REQ034/REQ154)", () => {
	test("the mean position never disagrees with the place it is printed beside", () => {
		// `RankingResults` prints the place and the average position side by side,
		// so a row placed second with a better mean than the row above it is an
		// ordering arguing with itself. Walked over several decks' worth of ids,
		// because the failure was a draw that happened to overtake its neighbour.
		for (let deck = 0; deck < 12; deck++) {
			const tally = sampleTallyFor({
				id: `slide-ranking-${deck}`,
				type: "ranking",
				question: "Order these",
				rankingItems: [
					{ id: "a", text: "Alpha" },
					{ id: "b", text: "Beta" },
					{ id: "c", text: "Gamma" },
					{ id: "d", text: "Delta" },
					{ id: "e", text: "Epsilon" },
				],
			}) as { items: { rank: number; points: number; averageRank: number }[] };
			for (let row = 1; row < tally.items.length; row++) {
				expect([deck, row, tally.items[row].rank]).toEqual([deck, row, row + 1]);
				// Points fall down the board, and the mean position rises with them.
				expect(tally.items[row].points).toBeLessThanOrEqual(
					tally.items[row - 1].points,
				);
				expect(tally.items[row].averageRank).toBeGreaterThan(
					tally.items[row - 1].averageRank,
				);
			}
		}
	});
});
