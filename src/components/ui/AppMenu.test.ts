/**
 * Where `AppMenu` draws its panel (REQ183).
 *
 * Right-aligned under the trigger by default, but never off screen: in the
 * spike, the presenter toolbar wrapped at 390px and a right-anchored panel ran
 * off the left edge. The placement is a pure function of three boxes, so it is
 * asserted here without a browser.
 */

import { describe, expect, test } from "bun:test";
import { appMenuPlacement } from "./AppMenu";

const PANEL = { width: 248, height: 260 };
const PHONE = { width: 390, height: 844 };
const NARROW_PHONE = { width: 360, height: 640 };

/** A 34px trigger whose right edge is at `right` and top at `top`. */
function trigger(right: number, top = 16) {
	return { top, bottom: top + 34, right };
}

describe("app menu placement", () => {
	test("right-aligned under the trigger when there is room", () => {
		const placement = appMenuPlacement(trigger(1264), PANEL, {
			width: 1280,
			height: 800,
		});
		expect(placement).toEqual({ top: 58, left: 1264 - 248 });
	});

	test("a trigger near the left edge pulls the panel back on screen", () => {
		for (const viewport of [PHONE, NARROW_PHONE]) {
			const placement = appMenuPlacement(trigger(60), PANEL, viewport);
			expect(placement.left).toBe(8);
			expect(placement.left + PANEL.width).toBeLessThanOrEqual(
				viewport.width - 8,
			);
		}
	});

	test("a trigger scrolled past the right edge keeps the panel inside it", () => {
		const placement = appMenuPlacement(trigger(420), PANEL, NARROW_PHONE);
		expect(placement.left).toBe(360 - 248 - 8);
	});

	test("flips above the trigger when it would run off the bottom", () => {
		const placement = appMenuPlacement(trigger(300, 560), PANEL, NARROW_PHONE);
		expect(placement.top).toBe(560 - 8 - PANEL.height);
	});

	test("stays below when there is no room above either", () => {
		const placement = appMenuPlacement(trigger(300, 200), PANEL, {
			width: 360,
			height: 400,
		});
		expect(placement.top).toBe(242);
	});
});
