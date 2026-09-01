/**
 * Unit tests for the Guess the Number histogram's pure helpers
 * (REQ039, REQ041, REQ042).
 *
 * The plot is shared by the editor preview and the shared screen, so the three
 * derivations behind it — how tall a column is drawn, what it is called, and
 * whether it falls inside the accepted window — are pure functions the two
 * surfaces cannot disagree about.
 */

import { describe, expect, test } from "bun:test";
import {
	guessColumnCenter,
	guessColumnHeight,
	guessColumnIndex,
	guessColumnLabel,
	guessColumnSpan,
	isColumnCorrect,
} from "./GuessDistribution";

/** A 0–20 frame in twos, as `guessBucketsFor` produces it: 11 columns. */
const COLUMNS = Array.from({ length: 11 }, (_, index) => ({
	from: index * 2,
	to: index * 2,
}));

describe("guessColumnLabel", () => {
	test("a single-value column reads as that value", () => {
		expect(guessColumnLabel({ from: 7, to: 7 })).toBe("7");
	});

	test("a grouped column reads as the span it covers", () => {
		expect(guessColumnLabel({ from: 42, to: 83 })).toBe("42–83");
	});
});

describe("guessColumnHeight — the shape, not the head count", () => {
	test("the busiest column fills the plot", () => {
		expect(guessColumnHeight(8, 8)).toBe(100);
	});

	test("columns are scaled against the busiest, not the total", () => {
		// Four of eight guesses is half the tallest bar's height — and stays half
		// however many more people guess elsewhere.
		expect(guessColumnHeight(4, 8)).toBe(50);
	});

	test("an empty column is drawn at nothing at all", () => {
		// Distinct from a single guess below: "nobody guessed here" must not look
		// like "one person did".
		expect(guessColumnHeight(0, 8)).toBe(0);
	});

	test("a lone guess in a busy room still shows as a mark", () => {
		expect(guessColumnHeight(1, 200)).toBe(4);
	});

	test("no guesses at all draws no columns", () => {
		expect(guessColumnHeight(0, 0)).toBe(0);
	});
});

describe("isColumnCorrect (REQ041, REQ042)", () => {
	test("no reference highlights nothing", () => {
		// REQ041: a slide with no correct number must not paint one column as the
		// right answer.
		expect(isColumnCorrect({ from: 7, to: 7 }, null)).toBe(false);
	});

	test("a column holding the accepted window is correct", () => {
		expect(isColumnCorrect({ from: 7, to: 7 }, { min: 6, max: 8 })).toBe(true);
	});

	test("a column touching either edge of the window is correct (REQ042)", () => {
		expect(isColumnCorrect({ from: 0, to: 6 }, { min: 6, max: 8 })).toBe(true);
		expect(isColumnCorrect({ from: 8, to: 12 }, { min: 6, max: 8 })).toBe(true);
	});

	test("a column beside the window is not", () => {
		expect(isColumnCorrect({ from: 0, to: 5 }, { min: 6, max: 8 })).toBe(false);
		expect(isColumnCorrect({ from: 9, to: 12 }, { min: 6, max: 8 })).toBe(false);
	});
});

describe("guessColumnIndex — the reference marks a column, not a fraction", () => {
	test("a value lands in the column that holds it", () => {
		expect(guessColumnIndex(14, COLUMNS)).toBe(7);
	});

	test("a value inside a grouped column lands in that column", () => {
		const grouped = [
			{ from: 0, to: 41 },
			{ from: 42, to: 83 },
		];
		expect(guessColumnIndex(30, grouped)).toBe(0);
		expect(guessColumnIndex(42, grouped)).toBe(1);
	});

	test("a reference outside every column has none", () => {
		// Nothing forbids an organizer putting the correct number outside the
		// range they offered; there is simply no bar for it to mark.
		expect(guessColumnIndex(99, COLUMNS)).toBe(-1);
		expect(guessColumnIndex(-4, COLUMNS)).toBe(-1);
	});
});

describe("guessColumnCenter — a marker sits on its bar, not between two", () => {
	test("the first column's marker sits inside the first bar", () => {
		// The regression this exists for: positioning by share-of-range would put
		// the lowest value's marker at 0% — the plot's edge, half a bar to the
		// left of the bar it names.
		expect(guessColumnCenter(0, 4)).toBe(12.5);
	});

	test("each marker sits in the middle of its own column", () => {
		expect(guessColumnCenter(1, 4)).toBe(37.5);
		expect(guessColumnCenter(3, 4)).toBe(87.5);
	});

	test("a plot with no columns places nothing", () => {
		expect(guessColumnCenter(0, 0)).toBe(0);
	});
});

describe("guessColumnSpan — the tolerance band covers whole bars", () => {
	test("a run of columns spans from the first bar's edge to the last's", () => {
		expect(guessColumnSpan(6, 8, 11)).toEqual({
			left: (6 / 11) * 100,
			width: (3 / 11) * 100,
		});
	});

	test("a single accepted column spans exactly that bar", () => {
		expect(guessColumnSpan(2, 2, 4)).toEqual({ left: 50, width: 25 });
	});

	test("no accepted columns draws no band at all", () => {
		expect(guessColumnSpan(-1, -1, 11)).toEqual({ left: 0, width: 0 });
	});
});
