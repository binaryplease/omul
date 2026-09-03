/**
 * Unit tests for the 100 Points question type (REQ044, REQ045).
 *
 * Covers the schema surface and the shared allocation codec (no DB, no network):
 *   - REQ044 — the "points" slide type is interactive, and a ballot spends the
 *     whole 100-point budget or it is not a ballot at all
 *   - REQ045 — pointsItems[] and the POINTS_ITEM_LIMIT cap
 *
 * The encode/decode pair is tested here rather than through the API because it
 * is the contract *both* ends share: the participant surface writes
 * the allocation and the aggregation reads it back.
 */

import { describe, expect, test } from "bun:test";
import {
	decodePoints,
	encodePoints,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	POINTS_BUDGET,
	POINTS_ITEM_LIMIT,
	SlideSchema,
	SlideTypeEnum,
	StoredPresentationSchema,
	VoteSchema,
} from "./schemas";

/** A minimal 100 Points slide with three items to spread a budget over. */
function pointsSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "pt",
		type: "points",
		question: "Where should the budget go?",
		pointsItems: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		],
		...overrides,
	});
}

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("SlideTypeEnum — points (REQ044)", () => {
	test("points is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("points").success).toBe(true);
	});

	test("points is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("points")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("points");
	});
});

describe("SlideSchema — points items (REQ045)", () => {
	test("pointsItems defaults to an empty array on every other slide type", () => {
		const slide = SlideSchema.parse({
			id: "mc",
			type: "multiple-choice",
			question: "Pick",
			options: [{ id: "a", text: "A" }],
		});
		expect(slide.pointsItems).toEqual([]);
	});

	test("accepts an authored item list", () => {
		const slide = pointsSlide();
		expect(slide.pointsItems).toHaveLength(3);
		expect(slide.pointsItems[0]).toEqual({ id: "a", text: "Alpha" });
	});

	test("rejects malformed items (missing id)", () => {
		expect(
			SlideSchema.safeParse({
				id: "pt",
				type: "points",
				question: "Where should the budget go?",
				pointsItems: [{ text: "No id" }],
			}).success,
		).toBe(false);
	});

	test(`accepts exactly ${POINTS_ITEM_LIMIT} items`, () => {
		const slide = pointsSlide({
			pointsItems: Array.from({ length: POINTS_ITEM_LIMIT }, (_, index) => ({
				id: `i${index}`,
				text: `Item ${index}`,
			})),
		});
		expect(slide.pointsItems).toHaveLength(POINTS_ITEM_LIMIT);
	});

	test(`rejects more than ${POINTS_ITEM_LIMIT} items`, () => {
		expect(
			SlideSchema.safeParse({
				id: "pt",
				type: "points",
				question: "Where should the budget go?",
				pointsItems: Array.from(
					{ length: POINTS_ITEM_LIMIT + 1 },
					(_, index) => ({ id: `i${index}`, text: `Item ${index}` }),
				),
			}).success,
		).toBe(false);
	});

	test("a stored deck authored before 100 Points existed re-parses forward", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [
				{ id: "s1", type: "word-cloud", question: "Describe the session" },
			],
		});
		expect(stored.slides[0].pointsItems).toEqual([]);
	});
});

describe("encodePoints / decodePoints (REQ044)", () => {
	test("an allocation round-trips through a single vote value", () => {
		const value = encodePoints({ a: 50, b: 30, c: 20 });
		expect(value).toBe("a:50,b:30,c:20");
		expect(decodePoints(value, ITEMS)).toEqual({ a: 50, b: 30, c: 20 });
	});

	test("an unfunded item is dropped from the wire but read back as an explicit 0", () => {
		const value = encodePoints({ a: 100, b: 0, c: 0 });
		expect(value).toBe("a:100");
		// The defaults rule in spirit: every item comes back present, so no read
		// site has to reach for `??` to find out an item got nothing.
		expect(decodePoints(value, ITEMS)).toEqual({ a: 100, b: 0, c: 0 });
	});

	test("an explicit zero on the wire is accepted and normalizes away", () => {
		const decoded = decodePoints("a:60,b:40,c:0", ITEMS);
		expect(decoded).toEqual({ a: 60, b: 40, c: 0 });
		expect(encodePoints(decoded as Record<string, number>)).toBe("a:60,b:40");
	});

	test("re-encoding a decoded allocation is canonical, in authored item order", () => {
		const decoded = decodePoints("c:20,a:50,b:30", ITEMS);
		expect(encodePoints(decoded as Record<string, number>)).toBe(
			"a:50,b:30,c:20",
		);
	});

	test("tolerates surrounding whitespace from a hand-built submission", () => {
		expect(decodePoints(" a : 70 , b : 30 ", ITEMS)).toEqual({
			a: 70,
			b: 30,
			c: 0,
		});
	});

	// ── The forced trade-off: exactly 100, never less, never more ──

	test(`accepts a ballot that spends exactly ${POINTS_BUDGET}`, () => {
		expect(decodePoints("a:34,b:33,c:33", ITEMS)).toEqual({
			a: 34,
			b: 33,
			c: 33,
		});
	});

	test("rejects an under-spent ballot", () => {
		expect(decodePoints("a:30,b:30", ITEMS)).toBe(null);
		expect(decodePoints("a:99", ITEMS)).toBe(null);
	});

	test("rejects an over-spent ballot", () => {
		expect(decodePoints("a:60,b:60", ITEMS)).toBe(null);
		expect(decodePoints("a:101", ITEMS)).toBe(null);
	});

	test("rejects an empty submission", () => {
		expect(decodePoints("", ITEMS)).toBe(null);
		expect(decodePoints(" , ", ITEMS)).toBe(null);
	});

	test("rejects anything that is not a whole, non-negative amount", () => {
		expect(decodePoints("a:50.5,b:49.5", ITEMS)).toBe(null);
		expect(decodePoints("a:120,b:-20", ITEMS)).toBe(null);
		expect(decodePoints("a:lots,b:50", ITEMS)).toBe(null);
		expect(decodePoints("a:,b:100", ITEMS)).toBe(null);
	});

	test("rejects a malformed pair", () => {
		expect(decodePoints("a", ITEMS)).toBe(null);
		expect(decodePoints("a:50:1,b:50", ITEMS)).toBe(null);
	});

	test("rejects an item the slide does not have", () => {
		expect(decodePoints("a:50,zz:50", ITEMS)).toBe(null);
	});

	test("rejects the same item funded twice — one budget, spent once", () => {
		expect(decodePoints("a:60,a:40", ITEMS)).toBe(null);
	});

	test("a slide with no items has no spendable budget at all", () => {
		expect(decodePoints("a:100", [])).toBe(null);
	});

	test("an inherited property name is not an item this slide declares", () => {
		expect(decodePoints("toString:100", ITEMS)).toBe(null);
	});

	test(`a full ${POINTS_ITEM_LIMIT}-item allocation fits VoteSchema.value`, () => {
		// The reason the item limit is what it is: UUID ids at the ceiling still
		// leave room inside `value`'s 500 characters.
		const uuidItems = Array.from({ length: POINTS_ITEM_LIMIT }, () => ({
			id: crypto.randomUUID(),
		}));
		const allocation = Object.fromEntries(
			uuidItems.map((item, index) => [
				item.id,
				index === 0
					? POINTS_BUDGET - (POINTS_ITEM_LIMIT - 1) * 10
					: /* every other item gets a two-digit share */ 10,
			]),
		);
		const value = encodePoints(allocation);
		expect(value.length).toBeLessThanOrEqual(500);
		expect(VoteSchema.safeParse({ slideId: "pt", value }).success).toBe(true);
		expect(decodePoints(value, uuidItems)).toEqual(allocation);
	});
});
