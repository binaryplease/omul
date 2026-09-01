/**
 * Unit tests for the Guess the Number question type (REQ039–REQ043).
 *
 * Covers the schema surface and the shared guess codec (no DB, no network):
 *   - REQ039 — the "guess-number" slide type is interactive, and the columns a
 *     distribution is drawn in follow from the authored frame alone
 *   - REQ040 — the permitted range, and what falls outside it
 *   - REQ041 — a reference is optional; its absence is "no notion of
 *     correctness", not "the correct answer is 0"
 *   - REQ042 — the tolerance window, inclusive at both ends
 *   - REQ043 — the step grid, counted from the range's low end
 *
 * The encode/decode pair and the bucket derivation are tested here rather than
 * through the API because they are the contract *both* ends share (ADR-0013):
 * the participant surface offers the numbers, the aggregation plots them, and
 * the editor previews the empty frame.
 */

import { describe, expect, test } from "bun:test";
import {
	correctGuessRangeFor,
	decodeGuess,
	encodeGuess,
	GUESS_BUCKET_LIMIT,
	type GuessRange,
	GuessRangeSchema,
	GuessReferenceSchema,
	guessBucketsFor,
	guessRangeFor,
	highestGuessValue,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	isReachableGuessReference,
	isUsableGuessRange,
	middleGuessValue,
	SlideSchema,
	SlideTypeEnum,
	snapGuessToGrid,
	StoredPresentationSchema,
	VoteSchema,
} from "./schemas";

/** A minimal Guess the Number slide over the range the schema defaults to. */
function guessSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "gn",
		type: "guess-number",
		question: "How many people work here?",
		...overrides,
	});
}

/** A frame that is easy to reason about: 0–10 in whole numbers. */
const TEN: GuessRange = { min: 0, max: 10, step: 1 };

describe("SlideTypeEnum — guess-number (REQ039)", () => {
	test("guess-number is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("guess-number").success).toBe(true);
	});

	test("guess-number is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("guess-number")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("guess-number");
	});
});

describe("GuessRangeSchema — the authored frame (REQ040, REQ043)", () => {
	test("defaults to the whole 0–100 range in steps of 1", () => {
		expect(GuessRangeSchema.parse({})).toEqual({ min: 0, max: 100, step: 1 });
	});

	test("a slide of any other type still carries the default frame (ADR-0029)", () => {
		const slide = SlideSchema.parse({
			id: "wc",
			type: "word-cloud",
			question: "Describe the session",
		});
		expect(slide.guessRange).toEqual({ min: 0, max: 100, step: 1 });
	});

	test("accepts an authored range and step", () => {
		const slide = guessSlide({ guessRange: { min: 1900, max: 2000, step: 5 } });
		expect(slide.guessRange).toEqual({ min: 1900, max: 2000, step: 5 });
	});

	test("a negative range is a range — estimates can go below zero", () => {
		expect(GuessRangeSchema.parse({ min: -50, max: 50 })).toEqual({
			min: -50,
			max: 50,
			step: 1,
		});
	});

	test("rejects a fractional endpoint or step — whole numbers only", () => {
		expect(GuessRangeSchema.safeParse({ min: 0.5, max: 10 }).success).toBe(
			false,
		);
		expect(GuessRangeSchema.safeParse({ min: 0, max: 10, step: 0.1 }).success)
			.toBe(false);
	});

	test("rejects a step below 1 — every number would be on and off the grid", () => {
		expect(GuessRangeSchema.safeParse({ step: 0 }).success).toBe(false);
		expect(GuessRangeSchema.safeParse({ step: -2 }).success).toBe(false);
	});

	test("a stored deck authored before Guess the Number existed re-parses forward", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [{ id: "s1", type: "scale", question: "Rate the venue" }],
		});
		expect(stored.slides[0].guessRange).toEqual({ min: 0, max: 100, step: 1 });
		expect(stored.slides[0].guessReference).toBe(null);
	});

	test("guessRangeFor fills in a half-built frame from the editor", () => {
		// The editor builds slides incrementally, so the range may be partial or
		// absent entirely; every read site still sees all three numbers.
		expect(guessRangeFor({})).toEqual({ min: 0, max: 100, step: 1 });
		expect(guessRangeFor({ guessRange: { min: 5, max: 25 } })).toEqual({
			min: 5,
			max: 25,
			step: 1,
		});
	});

	test("guessRangeFor falls back to the defaults rather than throwing on junk", () => {
		expect(guessRangeFor({ guessRange: "nonsense" })).toEqual({
			min: 0,
			max: 100,
			step: 1,
		});
	});
});

describe("isUsableGuessRange (REQ040, REQ043)", () => {
	test("a plain range with room to step through is usable", () => {
		expect(isUsableGuessRange(TEN)).toBe(true);
		expect(isUsableGuessRange({ min: -10, max: 10, step: 2 })).toBe(true);
	});

	test("a high end at or below the low end is not a range", () => {
		expect(isUsableGuessRange({ min: 10, max: 10, step: 1 })).toBe(false);
		expect(isUsableGuessRange({ min: 10, max: 0, step: 1 })).toBe(false);
	});

	test("a step wider than the span leaves one possible answer", () => {
		expect(isUsableGuessRange({ min: 0, max: 10, step: 11 })).toBe(false);
		// Exactly the span is still two selectable values — the two endpoints.
		expect(isUsableGuessRange({ min: 0, max: 10, step: 10 })).toBe(true);
	});

	test("fractional or zero components are never usable", () => {
		expect(isUsableGuessRange({ min: 0, max: 10, step: 0 })).toBe(false);
		expect(isUsableGuessRange({ min: 0.5, max: 10, step: 1 })).toBe(false);
	});
});

describe("encodeGuess / decodeGuess (REQ040, REQ043)", () => {
	test("a guess round-trips through a single vote value", () => {
		expect(encodeGuess(7)).toBe("7");
		expect(decodeGuess("7", TEN)).toBe(7);
		expect(VoteSchema.safeParse({ slideId: "gn", value: encodeGuess(7) }).success)
			.toBe(true);
	});

	test("both endpoints of the range are guessable (REQ040)", () => {
		expect(decodeGuess("0", TEN)).toBe(0);
		expect(decodeGuess("10", TEN)).toBe(10);
	});

	test("rejects a guess outside the authored range (REQ040)", () => {
		expect(decodeGuess("-1", TEN)).toBe(null);
		expect(decodeGuess("11", TEN)).toBe(null);
	});

	test("rejects a guess off the authored step grid (REQ043)", () => {
		const byTwo: GuessRange = { min: 0, max: 10, step: 2 };
		expect(decodeGuess("4", byTwo)).toBe(4);
		expect(decodeGuess("5", byTwo)).toBe(null);
	});

	test("the step grid is counted from the low end, not from zero (REQ043)", () => {
		// 1–10 in twos offers 1,3,5,7,9 — the organizer's range starts the grid.
		const oddNumbers: GuessRange = { min: 1, max: 10, step: 2 };
		expect(decodeGuess("1", oddNumbers)).toBe(1);
		expect(decodeGuess("9", oddNumbers)).toBe(9);
		expect(decodeGuess("2", oddNumbers)).toBe(null);
	});

	test("a range whose high end is off the grid still bounds the guesses", () => {
		// 0–10 in threes offers 0,3,6,9; 10 is the bound, not a selectable value.
		const byThree: GuessRange = { min: 0, max: 10, step: 3 };
		expect(decodeGuess("9", byThree)).toBe(9);
		expect(decodeGuess("10", byThree)).toBe(null);
	});

	test("rejects anything that is not a whole number", () => {
		expect(decodeGuess("3.5", TEN)).toBe(null);
		expect(decodeGuess("seven", TEN)).toBe(null);
		expect(decodeGuess("", TEN)).toBe(null);
		expect(decodeGuess("   ", TEN)).toBe(null);
		expect(decodeGuess("NaN", TEN)).toBe(null);
	});

	test("tolerates surrounding whitespace from a hand-built submission", () => {
		expect(decodeGuess("  4 ", TEN)).toBe(4);
	});

	test("an unusable frame accepts no guess at all — it fails closed", () => {
		expect(decodeGuess("5", { min: 10, max: 0, step: 1 })).toBe(null);
		expect(decodeGuess("5", { min: 0, max: 10, step: 0 })).toBe(null);
	});
});

describe("GuessReferenceSchema — the optional correct number (REQ041, REQ042)", () => {
	test("a slide has no reference until its author sets one", () => {
		// The stance REQ013 takes for a choice slide with no marked option: no
		// reference means the slide has no notion of correctness at all.
		expect(guessSlide().guessReference).toBe(null);
	});

	test("a reference defaults to the strictest tolerance (REQ042)", () => {
		expect(GuessReferenceSchema.parse({ value: 7 })).toEqual({
			value: 7,
			tolerance: 0,
		});
	});

	test("a reference cannot exist without a value (ADR-0018)", () => {
		// Defaultless on purpose: a defaulted 0 would assert a correct answer
		// nobody authored.
		expect(GuessReferenceSchema.safeParse({}).success).toBe(false);
		expect(GuessReferenceSchema.safeParse({ tolerance: 2 }).success).toBe(false);
	});

	test("rejects a negative or fractional tolerance", () => {
		expect(
			GuessReferenceSchema.safeParse({ value: 7, tolerance: -1 }).success,
		).toBe(false);
		expect(
			GuessReferenceSchema.safeParse({ value: 7, tolerance: 0.5 }).success,
		).toBe(false);
	});

	test("the slide carries the reference through the schema", () => {
		const slide = guessSlide({ guessReference: { value: 42, tolerance: 3 } });
		expect(slide.guessReference).toEqual({ value: 42, tolerance: 3 });
	});
});

describe("correctGuessRangeFor (REQ041, REQ042)", () => {
	test("no reference means no accepted window at all (REQ041)", () => {
		expect(correctGuessRangeFor(null)).toBe(null);
		expect(correctGuessRangeFor(undefined)).toBe(null);
	});

	test("tolerance 0 accepts only the reference itself (REQ042)", () => {
		expect(correctGuessRangeFor({ value: 7, tolerance: 0 })).toEqual({
			min: 7,
			max: 7,
		});
	});

	test("tolerance 1 accepts 6–8 for a reference of 7 (REQ042)", () => {
		expect(correctGuessRangeFor({ value: 7, tolerance: 1 })).toEqual({
			min: 6,
			max: 8,
		});
	});

	test("the window is not clipped to the slide's range", () => {
		// An organizer whose reference sits at the top of the range still means
		// "within two of it"; clipping would make the granted window asymmetric.
		expect(correctGuessRangeFor({ value: 100, tolerance: 2 })).toEqual({
			min: 98,
			max: 102,
		});
	});
});

describe("the selectable values a slide offers (REQ043)", () => {
	test("the high end of the grid is the last step, not the bound", () => {
		// 0–10 in threes offers 0, 3, 6, 9 — 10 is where the range stops, not a
		// number anyone can pick.
		expect(highestGuessValue({ min: 0, max: 10, step: 3 })).toBe(9);
		expect(highestGuessValue(TEN)).toBe(10);
	});

	test("snapping pulls a number onto the nearest value on offer", () => {
		const byFive: GuessRange = { min: 0, max: 20, step: 5 };
		expect(snapGuessToGrid(7, byFive)).toBe(5);
		expect(snapGuessToGrid(13, byFive)).toBe(15);
		// Exactly between two selectable values, the higher one wins — a tie has
		// to break somewhere, and it breaks the same way everywhere.
		expect(snapGuessToGrid(6, { min: 1, max: 10, step: 2 })).toBe(7);
	});

	test("snapping never leaves the board", () => {
		const byThree: GuessRange = { min: 0, max: 10, step: 3 };
		expect(snapGuessToGrid(-99, byThree)).toBe(0);
		// Clamped to the last *step* (9), not to the bound (10), so the snapped
		// value is always submittable.
		expect(snapGuessToGrid(99, byThree)).toBe(9);
	});

	test("the middle value a surface starts from is always submittable", () => {
		// The regression: the editor seeded a reference at the arithmetic midpoint
		// of the range, which on a 1–10 slide stepping in twos is 6 — a number
		// `decodeGuess` refuses, so the authored "correct answer" could never be
		// given by anybody. Both the editor's seed and the participant's ±
		// controls start here, so one check covers both.
		for (const range of [
			TEN,
			{ min: 1, max: 10, step: 2 },
			{ min: 0, max: 10, step: 3 },
			{ min: -50, max: 50, step: 7 },
			{ min: 1900, max: 2026, step: 5 },
			{ min: 0, max: 1000, step: 1 },
		] as GuessRange[]) {
			const middle = middleGuessValue(range);
			expect(decodeGuess(String(middle), range)).toBe(middle);
		}
	});
});

describe("isReachableGuessReference — can anybody be right? (REQ041, REQ042)", () => {
	test("a slide with no reference claims no correct answer, so nothing is unreachable", () => {
		expect(isReachableGuessReference(TEN, null)).toBe(true);
		expect(isReachableGuessReference(TEN, undefined)).toBe(true);
	});

	test("a reference on the step grid is reachable", () => {
		expect(
			isReachableGuessReference({ min: 1, max: 10, step: 2 }, {
				value: 7,
				tolerance: 0,
			}),
		).toBe(true);
	});

	test("a reference between two selectable values is not (the seeded-6 regression)", () => {
		// The reviewer's repro: range 1–10 step 2 offers 1, 3, 5, 7, 9. A
		// reference of 6 with no tolerance is a correct answer nobody can submit,
		// so `correctCount` would stay 0 for every participant forever.
		const oddNumbers: GuessRange = { min: 1, max: 10, step: 2 };
		expect(
			isReachableGuessReference(oddNumbers, { value: 6, tolerance: 0 }),
		).toBe(false);
		expect(decodeGuess("6", oddNumbers)).toBe(null);
	});

	test("a tolerance that reaches a selectable value makes it reachable again", () => {
		// The reference need not sit on the grid: it is the truth, while the step
		// is the input resolution. 6 ±1 accepts 5 and 7, both on offer.
		expect(
			isReachableGuessReference({ min: 1, max: 10, step: 2 }, {
				value: 6,
				tolerance: 1,
			}),
		).toBe(true);
		// The real-world shape: a true figure of 517 on a slide stepping in tens.
		// ±2 accepts 515–519, which holds no multiple of ten; ±10 accepts 507–527,
		// which holds 510 and 520. The off-grid reference is fine — the tolerance
		// is what decides whether anybody can reach it.
		const byTen: GuessRange = { min: 0, max: 1000, step: 10 };
		expect(isReachableGuessReference(byTen, { value: 517, tolerance: 2 })).toBe(
			false,
		);
		expect(isReachableGuessReference(byTen, { value: 517, tolerance: 10 })).toBe(
			true,
		);
	});

	test("a reference outside the range is not reachable", () => {
		// Accepted silently before: the caption asserted 500 as the correct
		// answer on a 0–100 slide while nobody could ever land on it.
		expect(isReachableGuessReference(TEN, { value: 500, tolerance: 0 })).toBe(
			false,
		);
		expect(isReachableGuessReference(TEN, { value: -5, tolerance: 0 })).toBe(
			false,
		);
	});

	test("a tolerance reaching back into the range rescues an outside reference", () => {
		// Window 8–12 over a 0–10 slide: 8, 9 and 10 are all correct.
		expect(isReachableGuessReference(TEN, { value: 12, tolerance: 4 })).toBe(
			true,
		);
	});

	test("a reference on an unusable frame is never reachable", () => {
		expect(
			isReachableGuessReference({ min: 10, max: 0, step: 1 }, {
				value: 5,
				tolerance: 5,
			}),
		).toBe(false);
	});

	test("reachability agrees with what the boundary would accept", () => {
		// The property behind the predicate: reachable exactly when some value the
		// codec accepts falls inside the accepted window.
		const range: GuessRange = { min: 0, max: 20, step: 4 };
		for (let value = -4; value <= 24; value++) {
			for (const tolerance of [0, 1, 2, 3]) {
				const window = correctGuessRangeFor({ value, tolerance });
				const anyAccepted = Array.from(
					{ length: 40 },
					(_, index) => index - 10,
				).some(
					(candidate) =>
						decodeGuess(String(candidate), range) !== null &&
						window !== null &&
						candidate >= window.min &&
						candidate <= window.max,
				);
				expect(isReachableGuessReference(range, { value, tolerance })).toBe(
					anyAccepted,
				);
			}
		}
	});
});

describe("guessBucketsFor — the distribution's columns (REQ039)", () => {
	test("a small range gets one column per selectable value", () => {
		const buckets = guessBucketsFor(TEN);
		expect(buckets).toHaveLength(11);
		expect(buckets[0]).toEqual({ from: 0, to: 0 });
		expect(buckets[10]).toEqual({ from: 10, to: 10 });
	});

	test("columns follow the step, not the integers between them (REQ043)", () => {
		const buckets = guessBucketsFor({ min: 0, max: 10, step: 2 });
		expect(buckets).toHaveLength(6);
		expect(buckets.map((bucket) => bucket.from)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	test(`a wide range is grouped into at most ${GUESS_BUCKET_LIMIT} columns`, () => {
		const buckets = guessBucketsFor({ min: 0, max: 1000, step: 1 });
		expect(buckets.length).toBeLessThanOrEqual(GUESS_BUCKET_LIMIT);
		// Every column spans the same count of steps, so heights stay comparable.
		expect(buckets[0]).toEqual({ from: 0, to: 41 });
		expect(buckets[1].from).toBe(42);
	});

	test("the columns cover the range and stop at its high end", () => {
		const buckets = guessBucketsFor({ min: 0, max: 1000, step: 1 });
		expect(buckets[0].from).toBe(0);
		expect(buckets[buckets.length - 1].to).toBe(1000);
	});

	test("columns never overlap and leave no selectable value uncovered", () => {
		for (const range of [
			TEN,
			{ min: 1, max: 10, step: 2 },
			{ min: -50, max: 50, step: 5 },
			{ min: 1900, max: 2026, step: 1 },
		] as GuessRange[]) {
			const buckets = guessBucketsFor(range);
			for (let guess = range.min; guess <= range.max; guess += range.step) {
				const owning = buckets.filter(
					(bucket) => guess >= bucket.from && guess <= bucket.to,
				);
				expect(owning).toHaveLength(1);
			}
		}
	});

	test("an unusable frame has no columns to draw", () => {
		expect(guessBucketsFor({ min: 10, max: 0, step: 1 })).toEqual([]);
	});
});
