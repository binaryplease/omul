/**
 * Unit tests for the editor's stage — its caption (REQ152) and its two views
 * (REQ154).
 *
 * The canvas is a picture of one specific screen, and the caption is where it
 * says so. Two things are worth an assertion:
 *
 *   - **It names that screen with the shared label**, the same one the dry run's
 *     presenter pane wears. Composed rather than re-spelled, because
 *     two literals is how one surface comes to call the projector something the
 *     other one does not.
 *   - **It counts slides the way a human does.** The index it is handed is the
 *     array's, and the number on the caption is the organizer's — an off-by-one
 *     here points the caption at the wrong slide of the deck.
 *
 * And two more about the switch on the frame:
 *
 *   - **The results view is offered on every slide, and refused with a reason
 *     where there is nothing to draw**. A switch that vanished on a
 *     text slide would teach an author it does not exist.
 *   - **A view outlives the slide it was chosen on.** The rail selects slides
 *     and the type picker converts them, so the stage has to resolve a results
 *     view of a slide that produces none back to its question rather than
 *     drawing an empty frame.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import { newSlide } from "../store/editorDocument";
import { slideHasResults } from "../types";
import { SHARED_SCREEN_LABEL } from "./PresenterSlideView";
import {
	NO_RESULTS_REASON,
	slideCanvasCaption,
	slideCanvasViewFor,
	slideCanvasViewOptions,
} from "./SlideCanvas";

describe("the canvas names the screen it is a picture of (REQ152)", () => {
	test("it leads with the shared screen's one label", () => {
		expect(slideCanvasCaption(0, 8).startsWith(SHARED_SCREEN_LABEL)).toBe(true);
	});

	test("a zero-based index reads as a one-based slide number", () => {
		expect(slideCanvasCaption(0, 8)).toBe(`${SHARED_SCREEN_LABEL} · Slide 1 of 8`);
		expect(slideCanvasCaption(7, 8)).toBe(`${SHARED_SCREEN_LABEL} · Slide 8 of 8`);
	});

	test("a one-slide deck says so rather than hiding the count", () => {
		expect(slideCanvasCaption(0, 1)).toBe(`${SHARED_SCREEN_LABEL} · Slide 1 of 1`);
	});
});

describe("the stage offers both views, always (REQ154)", () => {
	test("every slide type is offered the same two views", () => {
		for (const type of SlideTypeEnum.options) {
			const options = slideCanvasViewOptions(newSlide(type));
			expect([type, options.map((option) => option.value)]).toEqual([
				type,
				["question", "results"],
			]);
		}
	});

	test("a slide that draws no tally refuses the results view, and says why", () => {
		for (const type of SlideTypeEnum.options) {
			const results = slideCanvasViewOptions(newSlide(type))[1];
			expect([type, results.disabled === true]).toEqual([
				type,
				!slideHasResults(type),
			]);
			// The reason travels on the option so it can reach an accessible name,
			// not only a tooltip.
			expect([type, results.disabledReason]).toEqual([
				type,
				slideHasResults(type) ? undefined : NO_RESULTS_REASON,
			]);
		}
	});
});

describe("a view outlives the slide it was chosen on (REQ154)", () => {
	test("a results view of a slide with results is drawn", () => {
		expect(slideCanvasViewFor(newSlide("multiple-choice"), "results")).toBe(
			"results",
		);
	});

	test("a results view of a content slide falls back to its question", () => {
		expect(slideCanvasViewFor(newSlide("text"), "results")).toBe("question");
		expect(slideCanvasViewFor(newSlide("image"), "results")).toBe("question");
	});

	test("the question view is never overridden", () => {
		for (const type of SlideTypeEnum.options) {
			expect([type, slideCanvasViewFor(newSlide(type), "question")]).toEqual([
				type,
				"question",
			]);
		}
	});
});
