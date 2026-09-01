/**
 * Unit tests for the 2x2 Grid question type (REQ046–REQ050).
 *
 * Covers the schema surface and the shared placement codec (no DB, no network):
 *   - REQ046 — the "grid" slide type is interactive
 *   - REQ047 — gridItems[] and the GRID_ITEM_LIMIT cap
 *   - REQ048 — axis titles and endpoint labels round-trip
 *   - REQ049 — numeric endpoints, and what counts as a point on the grid
 *   - REQ050 — the skip setting defaults off
 *
 * The encode/decode pair is tested here rather than through the API because it
 * is the contract *both* ends share (ADR-0013): the participant surface writes
 * the coordinates and the aggregation reads them back.
 */

import { describe, expect, test } from "bun:test";
import {
	decodeGridPoint,
	encodeGridPoint,
	GRID_ITEM_LIMIT,
	GridAxisSchema,
	gridAxesFor,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	SlideSchema,
	SlideTypeEnum,
	StoredPresentationSchema,
} from "./schemas";

/** A minimal grid slide with two items and an authored pair of axes. */
function gridSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "gd",
		type: "grid",
		question: "Position these",
		gridItems: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
		],
		gridXAxis: {
			title: "Effort",
			min: 0,
			max: 10,
			minLabel: "Low",
			maxLabel: "High",
		},
		gridYAxis: {
			title: "Impact",
			min: 0,
			max: 10,
			minLabel: "Low",
			maxLabel: "High",
		},
		...overrides,
	});
}

describe("SlideTypeEnum — grid (REQ046)", () => {
	test("grid is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("grid").success).toBe(true);
	});

	test("grid is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("grid")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("grid");
	});
});

describe("SlideSchema — grid items (REQ047)", () => {
	test("gridItems defaults to an empty array on every other slide type", () => {
		const slide = SlideSchema.parse({
			id: "mc",
			type: "multiple-choice",
			question: "Pick",
			options: [{ id: "a", text: "A" }],
		});
		expect(slide.gridItems).toEqual([]);
	});

	test("accepts an authored item list", () => {
		const slide = gridSlide();
		expect(slide.gridItems).toHaveLength(2);
		expect(slide.gridItems[0]).toEqual({ id: "a", text: "Alpha" });
	});

	test("rejects malformed items (missing id)", () => {
		expect(
			SlideSchema.safeParse({
				id: "gd",
				type: "grid",
				question: "Position these",
				gridItems: [{ text: "No id" }],
			}).success,
		).toBe(false);
	});

	test(`accepts exactly ${GRID_ITEM_LIMIT} items`, () => {
		const slide = gridSlide({
			gridItems: Array.from({ length: GRID_ITEM_LIMIT }, (_, index) => ({
				id: `i${index}`,
				text: `Item ${index}`,
			})),
		});
		expect(slide.gridItems).toHaveLength(GRID_ITEM_LIMIT);
	});

	test(`rejects more than ${GRID_ITEM_LIMIT} items`, () => {
		expect(
			SlideSchema.safeParse({
				id: "gd",
				type: "grid",
				question: "Position these",
				gridItems: Array.from({ length: GRID_ITEM_LIMIT + 1 }, (_, index) => ({
					id: `i${index}`,
					text: `Item ${index}`,
				})),
			}).success,
		).toBe(false);
	});
});

describe("GridAxisSchema — naming and endpoints (REQ048, REQ049)", () => {
	test("an unauthored axis reads as an unnamed 0–10 range", () => {
		const axis = GridAxisSchema.parse({});
		expect(axis).toEqual({
			title: "",
			min: 0,
			max: 10,
			minLabel: "",
			maxLabel: "",
		});
	});

	test("titles and endpoint labels round-trip on both axes (REQ048)", () => {
		const slide = gridSlide();
		expect(slide.gridXAxis.title).toBe("Effort");
		expect(slide.gridYAxis.title).toBe("Impact");
		expect(slide.gridXAxis.minLabel).toBe("Low");
		expect(slide.gridYAxis.maxLabel).toBe("High");
	});

	test("endpoints may be any integer range, not just 0–10 (REQ049)", () => {
		const slide = gridSlide({
			gridXAxis: { title: "Cost", min: 1, max: 5 },
			gridYAxis: { title: "Value", min: -3, max: 3 },
		});
		expect(slide.gridXAxis.min).toBe(1);
		expect(slide.gridXAxis.max).toBe(5);
		expect(slide.gridYAxis.min).toBe(-3);
		// An axis authored without labels still reads — as its numbers.
		expect(slide.gridYAxis.minLabel).toBe("");
	});

	test("gridAxesFor fills both axes for a half-built editor slide", () => {
		const { xAxis, yAxis } = gridAxesFor({ gridXAxis: { title: "Effort" } });
		expect(xAxis.title).toBe("Effort");
		expect(xAxis.max).toBe(10);
		expect(yAxis.title).toBe("");
		expect(yAxis.min).toBe(0);
	});

	test("a stored deck authored before grid existed re-parses forward (ADR-0029)", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [
				{ id: "s1", type: "word-cloud", question: "Describe the session" },
			],
		});
		expect(stored.slides[0].gridItems).toEqual([]);
		expect(stored.slides[0].gridXAxis.max).toBe(10);
		expect(stored.slides[0].gridAllowSkip).toBe(false);
	});
});

describe("SlideSchema — skippable items (REQ050)", () => {
	test("skipping is off until the organizer turns it on", () => {
		expect(gridSlide().gridAllowSkip).toBe(false);
		expect(gridSlide({ gridAllowSkip: true }).gridAllowSkip).toBe(true);
	});
});

describe("encodeGridPoint / decodeGridPoint (REQ046, REQ049)", () => {
	const { xAxis, yAxis } = gridAxesFor(gridSlide());

	test("a placement round-trips through a single vote value", () => {
		const value = encodeGridPoint({ x: 3, y: 7 });
		expect(value).toBe("3,7");
		expect(decodeGridPoint(value, xAxis, yAxis)).toEqual({ x: 3, y: 7 });
	});

	test("both endpoints of both axes are on the grid", () => {
		expect(decodeGridPoint("0,0", xAxis, yAxis)).toEqual({ x: 0, y: 0 });
		expect(decodeGridPoint("10,10", xAxis, yAxis)).toEqual({ x: 10, y: 10 });
	});

	test("tolerates surrounding whitespace from a hand-built submission", () => {
		expect(decodeGridPoint(" 4 , 6 ", xAxis, yAxis)).toEqual({ x: 4, y: 6 });
	});

	test("rejects a coordinate off the authored axes", () => {
		expect(decodeGridPoint("11,5", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("5,-1", xAxis, yAxis)).toBe(null);
	});

	test("rejects anything that is not two whole numbers", () => {
		expect(decodeGridPoint("", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("5", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("5,6,7", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("2.5,3", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("left,3", xAxis, yAxis)).toBe(null);
		expect(decodeGridPoint("5,", xAxis, yAxis)).toBe(null);
	});

	test("each axis bounds its own coordinate", () => {
		// A slide whose axes have different ranges: 4 is on x but off y.
		const narrow = gridAxesFor(
			gridSlide({
				gridXAxis: { title: "X", min: 0, max: 5 },
				gridYAxis: { title: "Y", min: 0, max: 3 },
			}),
		);
		expect(decodeGridPoint("4,3", narrow.xAxis, narrow.yAxis)).toEqual({
			x: 4,
			y: 3,
		});
		expect(decodeGridPoint("3,4", narrow.xAxis, narrow.yAxis)).toBe(null);
	});
});
