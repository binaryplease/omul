/**
 * Unit tests for the two readings the editor's shared controls are built on.
 *
 *   - **What an authored colour is called** (REQ155). The settings column rests
 *     three colours on a chip each, and the chip is all an author reads without
 *     opening one — so "inherited" has to be a *word*. A chip showing the hex
 *     the theme currently resolves to would make an unauthored colour
 *     indistinguishable from one typed by hand, and only one of the two follows
 *     the deck when it is re-themed.
 *   - **What an unavailable choice is called**. A picker keeps the
 *     option it cannot offer, so the reason has to be a *value* — one that
 *     reaches an accessible name, not only a hover tooltip nothing but a mouse
 *     ever finds.
 */

import { describe, expect, test } from "bun:test";
import { authoredColorLabel, choiceOptionName } from "./EditorControls";

describe("an inherited colour reads as a word (REQ155)", () => {
	test("nothing authored is the theme's, and says so", () => {
		expect(authoredColorLabel("")).toBe("Theme");
		expect(authoredColorLabel("   ")).toBe("Theme");
	});

	test("an authored colour reads as the colour, normalized", () => {
		expect(authoredColorLabel("#FF6B35")).toBe("#ff6b35");
		expect(authoredColorLabel("#f63")).toBe("#f63");
	});

	test("a half-typed colour reads as the refusal it is", () => {
		// The resolver leaves the layer underneath standing, so a chip echoing the
		// typed string would claim a colour that is not on the slide.
		expect(authoredColorLabel("#zzz")).toBe("Not a colour");
		expect(authoredColorLabel("rebeccapurple")).toBe("Not a colour");
	});
});

describe("an unavailable choice carries its reason", () => {
	test("a pickable option needs no name of its own", () => {
		expect(choiceOptionName({ value: "results", label: "Results" })).toBe(
			undefined,
		);
	});

	test("an inert one names itself and why it is inert", () => {
		expect(
			choiceOptionName({
				value: "results",
				label: "Results",
				disabled: true,
				disabledReason: "This slide collects nothing.",
			}),
		).toBe("Results — This slide collects nothing.");
	});

	test("an inert option with no reason still announces itself", () => {
		expect(
			choiceOptionName({ value: "results", label: "Results", disabled: true }),
		).toBe("Results");
	});
});
