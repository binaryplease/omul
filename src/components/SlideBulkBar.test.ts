/**
 * An unavailable control in the editor's slide list says why, where a user can
 * see it (REQ127, ADR-0025).
 *
 * A tester ticked all five slides, found the bulk delete greyed out, and could
 * not find out why: the reason lived in the control's accessible name and a
 * `title`, on a `disabled` button that a keyboard cannot reach and a touch
 * screen never explains. Each control is now a `ReasonButton` — focusable,
 * `aria-disabled`, and described by a visible tip it shows on hover, focus or
 * tap. What the markup can prove without a browser is asserted here: the
 * control stays focusable, its description resolves to a tooltip carrying the
 * reason, and the tip, once shown, is drawn rather than hidden.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Slide } from "../types";
import { SLIDE_REMOVAL_FLOOR_REASON, SlideBulkBar } from "./SlideBulkBar";
import { SlideEditor } from "./SlideEditor";
import { ReasonTipBubble } from "./ui/ReasonTip";

const SLIDES = [1, 2, 3, 4, 5].map(
	(position) =>
		({
			id: `slide-${position}`,
			type: "word-cloud",
			question: `Slide ${position}`,
		}) as Slide,
);

const noop = () => {};

function bar(selection: readonly Slide[], canRemove: boolean): string {
	return renderToStaticMarkup(
		createElement(SlideBulkBar, {
			slides: SLIDES,
			selection,
			onSelectAll: noop,
			onClear: noop,
			onMove: noop,
			onSetSkipped: noop,
			onRemove: noop,
			onCopy: noop,
			canMoveUp: false,
			canMoveDown: true,
			canRemove,
			canCopy: true,
		}),
	);
}

/** The opening tag of the button named `label`. */
function buttonNamed(markup: string, label: string): string {
	const tag = markup
		.match(/<button[^>]*>/g)
		?.find((candidate) => candidate.includes(`aria-label="${label}"`));
	if (!tag) throw new Error(`no button named "${label}"`);
	return tag;
}

/** The text of the element `button` is described by. */
function describedReason(markup: string, button: string): string | null {
	const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1];
	if (!describedBy) return null;
	const tip = markup.match(
		new RegExp(`<span id="${describedBy}" role="tooltip"[^>]*>([^<]*)</span>`),
	);
	return tip?.[1] ?? null;
}

/** Unavailable, yet reachable by keyboard and pointer, and saying why. */
function expectExplained(markup: string, label: string, reason: string) {
	const button = buttonNamed(markup, label);
	expect(button).not.toContain(" disabled=");
	expect(button).toContain('aria-disabled="true"');
	expect(describedReason(markup, button)).toBe(reason);
}

describe("the slide list's unavailable controls show their reason", () => {
	test("deleting every selected slide says a deck needs one", () => {
		const markup = bar(SLIDES, false);
		expect(markup).toContain("5 selected");
		expectExplained(markup, "Delete 5 slides", SLIDE_REMOVAL_FLOOR_REASON);
		expect(SLIDE_REMOVAL_FLOOR_REASON).toBe(
			"A presentation needs at least one slide",
		);
	});

	test("every control of an empty selection says to select first", () => {
		const markup = bar([], true);
		for (const label of [
			"Move selected slides up",
			"Move selected slides down",
			"Skip selected slides",
			"Copy selected slides",
			"Delete selected slides",
		]) {
			expectExplained(markup, label, "Select slides first");
		}
	});

	test("a move the selection cannot make says why", () => {
		expectExplained(
			bar(SLIDES.slice(0, 2), true),
			"Move 2 slides up",
			"Already at the top",
		);
	});

	test("an available control carries no reason", () => {
		const markup = bar(SLIDES.slice(0, 2), true);
		const button = buttonNamed(markup, "Delete 2 slides");
		expect(button).toContain('aria-disabled="false"');
		expect(describedReason(markup, button)).toBeNull();
	});

	test("the editor's single-slide delete on a one-slide deck says why", () => {
		const markup = renderToStaticMarkup(
			createElement(SlideEditor, {
				slide: SLIDES[0],
				index: 0,
				total: 1,
				canRemove: false,
				onUpdate: noop,
				onMove: noop,
				onRemove: noop,
				onPreviewResults: noop,
				deckResultsVisibility: "instant",
				deckMode: "live",
				deckQuizCount: 0,
			}),
		);
		expectExplained(markup, "Delete slide", SLIDE_REMOVAL_FLOOR_REASON);
		expectExplained(markup, "Move slide up", "Already the first slide");
		expectExplained(markup, "Move slide down", "Already the last slide");
	});

	test("a shown tip is drawn, an idle one only waits as the description", () => {
		const shown = renderToStaticMarkup(
			createElement(ReasonTipBubble, {
				id: "tip",
				reason: SLIDE_REMOVAL_FLOOR_REASON,
				shown: true,
			}),
		);
		expect(shown).toContain(SLIDE_REMOVAL_FLOOR_REASON);
		expect(shown).toMatch(/class="fixed /);
		expect(shown).not.toMatch(/class="[^"]*\bhidden\b/);
		const idle = renderToStaticMarkup(
			createElement(ReasonTipBubble, {
				id: "tip",
				reason: SLIDE_REMOVAL_FLOOR_REASON,
				shown: false,
			}),
		);
		expect(idle).toContain('class="hidden"');
	});
});
