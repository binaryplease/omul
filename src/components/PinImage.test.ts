/**
 * Unit tests for the pin canvas's geometry and answer-reading helpers
 * (REQ051, REQ053).
 *
 * These are the two places a pin slide can quietly go wrong, and both are pure
 * functions so they can be pinned down without a DOM:
 *
 *   - **The tap → coordinate conversion.** It is the only place device pixels
 *     appear at all, so a mistake here is a room whose pins do not mean the same
 *     thing on a phone and on a projector.
 *   - **What the participant is shown about their own answer.** Read from the
 *     value the server accepted, never from wherever they last touched — the
 *     same discipline `GridPlot.test.ts` holds the grid's dots to.
 */

import { describe, expect, test } from "bun:test";
import type { PinArea } from "../types";
import {
	encodePinPoint,
	isPinInArea,
	isUsablePinArea,
	PIN_COORDINATE_MAX,
} from "../types";
import {
	acceptedPin,
	pinAreaBetween,
	pinAreaBox,
	pinCoordinateLabel,
	pinOffsetPercent,
	pinPointFromPointer,
	pinVerdict,
} from "./PinImage";

/** A 400×200 picture as some screen happened to lay it out. */
const box = { left: 100, top: 50, width: 400, height: 200 };

describe("pinPointFromPointer — a tap becomes a point on the image (REQ051)", () => {
	test("the centre of the box is the centre of the image", () => {
		expect(pinPointFromPointer({ clientX: 300, clientY: 150 }, box)).toEqual({
			x: 500,
			y: 500,
		});
	});

	test("the top-left corner is the origin, whatever the box's own offset", () => {
		expect(pinPointFromPointer({ clientX: 100, clientY: 50 }, box)).toEqual({
			x: 0,
			y: 0,
		});
	});

	test("the bottom-right corner is the far end of both edges", () => {
		expect(pinPointFromPointer({ clientX: 500, clientY: 250 }, box)).toEqual({
			x: PIN_COORDINATE_MAX,
			y: PIN_COORDINATE_MAX,
		});
	});

	test("the same spot on a bigger rendering is the same answer", () => {
		// The whole reason coordinates are per-mille of the image rather than
		// pixels: a phone and a projector must agree about where somebody pointed.
		const phone = pinPointFromPointer(
			{ clientX: 100 + 400 * 0.25, clientY: 50 + 200 * 0.75 },
			box,
		);
		const projector = pinPointFromPointer(
			{ clientX: 2000 * 0.25, clientY: 1000 * 0.75 },
			{ left: 0, top: 0, width: 2000, height: 1000 },
		);
		expect(phone).toEqual(projector);
	});

	test("a tap outside the box lands on the nearest edge, never off the image", () => {
		// The picture is the control, so a pointer that slid past it while being
		// released still names a point the boundary accepts.
		expect(pinPointFromPointer({ clientX: 0, clientY: 0 }, box)).toEqual({
			x: 0,
			y: 0,
		});
		expect(pinPointFromPointer({ clientX: 9999, clientY: 9999 }, box)).toEqual({
			x: PIN_COORDINATE_MAX,
			y: PIN_COORDINATE_MAX,
		});
	});

	test("a box that has not laid out yet yields the origin, not NaN", () => {
		expect(
			pinPointFromPointer(
				{ clientX: 10, clientY: 10 },
				{ left: 0, top: 0, width: 0, height: 0 },
			),
		).toEqual({ x: 0, y: 0 });
	});
});

describe("pinAreaBetween — the box a drag drew (REQ053)", () => {
	test("a drag down-right is the rectangle between the corners", () => {
		expect(pinAreaBetween({ x: 100, y: 200 }, { x: 400, y: 500 })).toEqual({
			x: 100,
			y: 200,
			width: 300,
			height: 300,
		});
	});

	test("a drag up-left names the same target", () => {
		expect(pinAreaBetween({ x: 400, y: 500 }, { x: 100, y: 200 })).toEqual({
			x: 100,
			y: 200,
			width: 300,
			height: 300,
		});
	});

	test("a click that never moved is still a target, not a zero-width one", () => {
		// The schema refuses a zero-area rectangle, so an organizer who clicks once
		// must get the smallest real target rather than an unsaveable slide.
		expect(pinAreaBetween({ x: 500, y: 500 }, { x: 500, y: 500 })).toEqual({
			x: 500,
			y: 500,
			width: 1,
			height: 1,
		});
	});

	test("a drag to the far corner stays inside the image", () => {
		const area = pinAreaBetween(
			{ x: 900, y: 900 },
			{ x: PIN_COORDINATE_MAX, y: PIN_COORDINATE_MAX },
		);
		expect(area.x + area.width).toBeLessThanOrEqual(PIN_COORDINATE_MAX);
		expect(area.y + area.height).toBeLessThanOrEqual(PIN_COORDINATE_MAX);
	});

	test("a click on the far right or bottom edge is still a saveable target", () => {
		// The regression: the top-left corner used to be taken as clicked, so a
		// click at x = 1000 gave {x: 1000, width: 1} — one per-mille off the image,
		// which isUsablePinArea refuses and pinAreaFor reads as no area at all. The
		// picker would have authored a state its own validator rejects, and the
		// author met "this area runs off the image" for a click that looked fine.
		for (const corner of [
			{ x: PIN_COORDINATE_MAX, y: 500 },
			{ x: 500, y: PIN_COORDINATE_MAX },
			{ x: PIN_COORDINATE_MAX, y: PIN_COORDINATE_MAX },
		]) {
			expect(isUsablePinArea(pinAreaBetween(corner, corner))).toBe(true);
		}
	});

	test("every rectangle a drag can draw is one the validator accepts", () => {
		// The picker and its validator must not be able to disagree at all, so the
		// property is asserted over the whole lattice rather than at a few points.
		const edges = [0, 1, 250, 499, 500, 501, 750, 999, PIN_COORDINATE_MAX];
		for (const fromX of edges) {
			for (const fromY of edges) {
				for (const toX of edges) {
					for (const toY of edges) {
						const area = pinAreaBetween(
							{ x: fromX, y: fromY },
							{ x: toX, y: toY },
						);
						expect(isUsablePinArea(area)).toBe(true);
					}
				}
			}
		}
	});
});

describe("pinAreaBox — the drawn target matches the hit test (REQ053)", () => {
	test("the drawn box reaches the last coordinate counted as inside", () => {
		// The regression: the overlay drew `width` units while isPinInArea counts
		// `[x, x+width]` inclusive, so a pin at exactly x+width was reported inside
		// while rendering on or just outside the border the organizer drew.
		const area: PinArea = { x: 100, y: 200, width: 300, height: 100 };
		const box = pinAreaBox(area);
		const rightEdge =
			pinOffsetPercent(area.x) + pinOffsetPercent(area.width + 1);
		expect(box.left).toBe(`${pinOffsetPercent(area.x)}%`);
		expect(box.width).toBe(`${pinOffsetPercent(area.width + 1)}%`);
		// The far edge of the drawn box is the far edge of the inclusive range.
		expect(rightEdge).toBeCloseTo(pinOffsetPercent(area.x + area.width + 1), 10);
	});

	test("the last pin inside the target renders within the drawn box", () => {
		const area: PinArea = { x: 100, y: 200, width: 300, height: 100 };
		const farCorner = { x: area.x + area.width, y: area.y + area.height };
		expect(isPinInArea(farCorner, area)).toBe(true);
		const box = pinAreaBox(area);
		const left = Number.parseFloat(box.left);
		const width = Number.parseFloat(box.width);
		const top = Number.parseFloat(box.top);
		const height = Number.parseFloat(box.height);
		// Drawn strictly inside, so the mark sits on the border rather than past it.
		expect(pinOffsetPercent(farCorner.x)).toBeLessThanOrEqual(left + width);
		expect(pinOffsetPercent(farCorner.y)).toBeLessThanOrEqual(top + height);
	});

	test("a one-per-mille target is still drawn with a visible span", () => {
		const box = pinAreaBox({ x: 500, y: 500, width: 1, height: 1 });
		expect(Number.parseFloat(box.width)).toBeGreaterThan(0);
		expect(Number.parseFloat(box.height)).toBeGreaterThan(0);
	});
});

describe("pinOffsetPercent / pinCoordinateLabel — a coordinate on screen", () => {
	test("a coordinate reads as its share of the edge", () => {
		expect(pinOffsetPercent(0)).toBe(0);
		expect(pinOffsetPercent(250)).toBe(25);
		expect(pinOffsetPercent(PIN_COORDINATE_MAX)).toBe(100);
	});

	test("a stale coordinate is clamped rather than floated over the page", () => {
		expect(pinOffsetPercent(-50)).toBe(0);
		expect(pinOffsetPercent(PIN_COORDINATE_MAX + 500)).toBe(100);
	});

	test("a label is a whole percentage of the picture", () => {
		expect(pinCoordinateLabel(437)).toBe("44%");
		expect(pinCoordinateLabel(0)).toBe("0%");
	});
});

describe("acceptedPin — the answer the server took", () => {
	test("reads back the coordinates the pin was submitted with", () => {
		expect(acceptedPin(encodePinPoint({ x: 120, y: 880 }))).toEqual({
			x: 120,
			y: 880,
		});
	});

	test("an unanswered slide has no accepted pin", () => {
		expect(acceptedPin(undefined)).toBe(null);
		expect(acceptedPin("")).toBe(null);
	});

	test("a value that is not a pin is not an answer", () => {
		// The confirmation and the marker both hang off this, so a refused or
		// hand-built value must not wear a placed pin.
		expect(acceptedPin("middle")).toBe(null);
		expect(acceptedPin("1001,20")).toBe(null);
	});
});

describe("pinVerdict — what this participant's pin did (REQ053)", () => {
	const area: PinArea = { x: 400, y: 300, width: 200, height: 150 };

	test("a pin in the target says so", () => {
		expect(pinVerdict({ x: 500, y: 380 }, area)).toBe("inside");
	});

	test("a pin outside the target says so too", () => {
		expect(pinVerdict({ x: 100, y: 100 }, area)).toBe("outside");
	});

	test("no pin yet is silence, not a miss", () => {
		expect(pinVerdict(null, area)).toBe(null);
	});

	test("a withheld or unauthored target is silence as well", () => {
		// A withheld area arrives as `null` on the slide, so "not revealed yet" and
		// "no correct answer at all" collapse into the same silence here — which is
		// exactly what the withholding is for.
		expect(pinVerdict({ x: 100, y: 100 }, null)).toBe(null);
	});
});
