/**
 * Unit tests for the 2x2 Grid field's answer-reading helpers (REQ046, REQ050).
 *
 * These cover the three ways the participant's own field went wrong in review,
 * each written as the reviewer's failure scenario:
 *   - a skipped item renumbered every dot after it
 *   - an untouched slide drew a dot per item at the axis midpoint
 *   - a dot (and its confirmation badge) reported the slider's position rather
 *     than the placement the server had accepted
 *
 * They are pure: `ownGridMarks` / `acceptedGridPoint` take the submitted values
 * and return what belongs on the field, so the field and the numbered list
 * beside it cannot disagree without one of these failing.
 */

import { describe, expect, test } from "bun:test";
import { encodeGridPoint, type GridAxis, type GridItem } from "../types";
import { acceptedGridPoint, ownGridMarks } from "./GridPlot";

const xAxis: GridAxis = {
	title: "Effort",
	min: 0,
	max: 10,
	minLabel: "Low",
	maxLabel: "High",
};
const yAxis: GridAxis = { ...xAxis, title: "Impact" };

const items: GridItem[] = [
	{ id: "a", text: "Alpha" },
	{ id: "b", text: "Beta" },
	{ id: "c", text: "Gamma" },
];

/** The sentinel ParticipantPage stores for an item marked not assessable. */
const SKIPPED = "__skip__";

/** Build the "what was this item last accepted with" lookup the marks read. */
function submittedValues(values: Record<string, string>) {
	return (itemId: string) => values[itemId];
}

describe("acceptedGridPoint", () => {
	test("reads back the coordinates a placement was submitted with", () => {
		expect(acceptedGridPoint(encodeGridPoint({ x: 3, y: 7 }), xAxis, yAxis)).toEqual(
			{ x: 3, y: 7 },
		);
	});

	test("an unanswered item has no accepted placement", () => {
		expect(acceptedGridPoint(undefined, xAxis, yAxis)).toBe(null);
	});

	test("a skipped item has no accepted placement (REQ050)", () => {
		expect(acceptedGridPoint(SKIPPED, xAxis, yAxis)).toBe(null);
	});

	test("a placement no longer on the grid is not a placement", () => {
		// The organizer narrowed the axes under a stored 9,9 — the aggregation
		// drops that vote, and so must the participant's own field.
		const narrow: GridAxis = { ...xAxis, max: 5 };
		expect(acceptedGridPoint("9,9", narrow, narrow)).toBe(null);
	});
});

describe("ownGridMarks — which dots the participant's answers put on the field", () => {
	test("an untouched slide draws nothing, however the sliders are seeded", () => {
		// The sliders start at the axis midpoint; that is an input default, not
		// an answer, so the field stays empty until something is placed.
		expect(
			ownGridMarks({
				items,
				submittedValueFor: submittedValues({}),
				xAxis,
				yAxis,
			}),
		).toEqual([]);
	});

	test("only placed items are drawn", () => {
		const marks = ownGridMarks({
			items,
			submittedValueFor: submittedValues({ b: encodeGridPoint({ x: 2, y: 8 }) }),
			xAxis,
			yAxis,
		});
		expect(marks).toHaveLength(1);
		expect(marks[0].key).toBe("b");
		expect(marks[0].x).toBe(2);
		expect(marks[0].y).toBe(8);
	});

	test("skipping an item does not renumber the items after it (REQ050)", () => {
		// The reviewer's scenario: A is marked not assessable, B and C placed.
		// The numbered list still reads 1 Alpha / 2 Beta / 3 Gamma, so the dots
		// must be labelled 2 and 3 — not 1 and 2.
		const marks = ownGridMarks({
			items,
			submittedValueFor: submittedValues({
				a: SKIPPED,
				b: encodeGridPoint({ x: 1, y: 1 }),
				c: encodeGridPoint({ x: 9, y: 9 }),
			}),
			xAxis,
			yAxis,
		});
		expect(marks.map((mark) => mark.key)).toEqual(["b", "c"]);
		expect(marks.map((mark) => mark.label)).toEqual(["2", "3"]);
	});

	test("a label is the item's place in the authored list, not among the drawn", () => {
		const marks = ownGridMarks({
			items,
			submittedValueFor: submittedValues({ c: encodeGridPoint({ x: 4, y: 4 }) }),
			xAxis,
			yAxis,
		});
		expect(marks.map((mark) => mark.label)).toEqual(["3"]);
	});

	test("a dot shows the accepted placement, never the slider's position", () => {
		// The reviewer's scenario: the item is accepted at 3,4 and the
		// participant has since dragged to 8,9 without that landing. The field
		// keeps reporting what the server holds.
		const marks = ownGridMarks({
			items,
			submittedValueFor: submittedValues({ a: encodeGridPoint({ x: 3, y: 4 }) }),
			xAxis,
			yAxis,
		});
		expect(marks).toHaveLength(1);
		expect(marks[0].x).toBe(3);
		expect(marks[0].y).toBe(4);
	});

	test("hover text describes the item at its accepted coordinates", () => {
		const marks = ownGridMarks({
			items,
			submittedValueFor: submittedValues({ a: encodeGridPoint({ x: 3, y: 4 }) }),
			xAxis,
			yAxis,
			titleFor: (item, point) =>
				`${item.text} — ${xAxis.title} ${point.x}, ${yAxis.title} ${point.y}`,
		});
		expect(marks[0].title).toBe("Alpha — Effort 3, Impact 4");
	});
});
