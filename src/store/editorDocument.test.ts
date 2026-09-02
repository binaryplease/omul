/**
 * Unit tests for the editor document reducer — the CRDT-ready seam. These cover
 * the pure `applyEditorOperation` function directly (no store, no React), and
 * in particular the property that justifies addressing by stable id rather than
 * index: an operation stays correct even when the slide list has been reordered
 * or grown underneath it, which is exactly what concurrent edits do.
 */

import { describe, expect, test } from "bun:test";
import type { PinArea, Slide } from "../types";
import { isUsablePinArea } from "../types";
import {
	applyEditorOperation,
	blankDocument,
	type EditorDocument,
	withPinAreaEnabled,
} from "./editorDocument";

function docOf(...slides: Slide[]): EditorDocument {
	return {
		title: "",
		language: "en",
		mode: "live",
		resultsVisibility: "instant",
		qaEnabled: false,
		qaVisibility: "presenter",
		reactionsEnabled: false,
		chatEnabled: false,
		requireParticipantName: false,
		theme: "signal",
		themeBrand: { name: "", accent: "", canvas: "", text: "", font: "figtree" },
		themeLogoUrl: "",
		themeLogoAlt: "",
		slides,
	};
}

const slideA: Slide = { id: "a", type: "word-cloud", question: "A" };
const slideB: Slide = { id: "b", type: "word-cloud", question: "B" };
const slideC: Slide = { id: "c", type: "word-cloud", question: "C" };

describe("applyEditorOperation — purity & meta", () => {
	test("does not mutate the input document", () => {
		const document = docOf(slideA);
		const next = applyEditorOperation(document, {
			type: "update-slide",
			slideId: "a",
			changes: { question: "edited" },
		});
		expect(document.slides[0].question).toBe("A");
		expect(next).not.toBe(document);
		expect(next.slides[0].question).toBe("edited");
	});

	test("set-meta merges only the given fields", () => {
		const next = applyEditorOperation(docOf(slideA), {
			type: "set-meta",
			changes: { title: "Renamed", mode: "survey" },
		});
		expect(next.title).toBe("Renamed");
		expect(next.mode).toBe("survey");
		expect(next.language).toBe("en");
	});
});

describe("applyEditorOperation — apply-results-visibility (REQ018)", () => {
	/** A deck whose question slides each stand on their own reveal mode. */
	function overriddenDoc(): EditorDocument {
		return docOf(
			{ ...slideA, resultsVisibility: "private" },
			{ ...slideB, resultsVisibility: "on-click" },
			{ id: "t", type: "text", question: "An interlude" },
		);
	}

	test("sets the deck mode and clears every question slide's override", () => {
		const next = applyEditorOperation(overriddenDoc(), {
			type: "apply-results-visibility",
			resultsVisibility: "on-click",
		});
		expect(next.resultsVisibility).toBe("on-click");
		// Cleared, not overwritten with the mode: the deck already carries it, and
		// inheriting is what keeps the slides moving with the next deck-level
		// change instead of freezing at today's value.
		expect(next.slides[0].resultsVisibility).toBe("inherit");
		expect(next.slides[1].resultsVisibility).toBe("inherit");
	});

	test("leaves a content slide alone — it has no tally to publish", () => {
		const next = applyEditorOperation(overriddenDoc(), {
			type: "apply-results-visibility",
			resultsVisibility: "private",
		});
		expect(next.slides[2].resultsVisibility).toBeUndefined();
		expect(next.slides[2].type).toBe("text");
	});

	test("does not mutate the input document", () => {
		const document = overriddenDoc();
		const next = applyEditorOperation(document, {
			type: "apply-results-visibility",
			resultsVisibility: "instant",
		});
		expect(document.resultsVisibility).toBe("instant");
		expect(document.slides[0].resultsVisibility).toBe("private");
		expect(next).not.toBe(document);
		expect(next.slides[0].resultsVisibility).toBe("inherit");
	});

	test("is idempotent — applying the same mode twice changes nothing more", () => {
		const once = applyEditorOperation(overriddenDoc(), {
			type: "apply-results-visibility",
			resultsVisibility: "private",
		});
		const twice = applyEditorOperation(once, {
			type: "apply-results-visibility",
			resultsVisibility: "private",
		});
		expect(twice).toEqual(once);
	});

	test("takes back a pin slide's authored reveal, like every other override", () => {
		// A Pin on Image slide is pinned to `on-click` when it gains a target area
		// (REQ053). The deck-wide apply loosens as readily as it tightens — that
		// is the operation REQ018 asks for, and the editor states the consequence
		// beside the button that runs it.
		const document = docOf({
			id: "pn",
			type: "pin-image",
			question: "Where?",
			resultsVisibility: "on-click",
		});
		const next = applyEditorOperation(document, {
			type: "apply-results-visibility",
			resultsVisibility: "instant",
		});
		expect(next.slides[0].resultsVisibility).toBe("inherit");
		expect(next.resultsVisibility).toBe("instant");
	});
});

describe("applyEditorOperation — stable-id addressing survives reordering", () => {
	test("update-slide targets the right slide after the list is reordered", () => {
		// An editor reads slide "c" at index 2, then a concurrent move reorders the
		// list so "c" is now at index 0. An index-2 update would corrupt the wrong
		// slide; an id-addressed update still lands on "c".
		const reordered = docOf(slideC, slideA, slideB); // "c" moved to the front
		const next = applyEditorOperation(reordered, {
			type: "update-slide",
			slideId: "c",
			changes: { question: "C edited" },
		});
		expect(next.slides.find((slide) => slide.id === "c")?.question).toBe(
			"C edited",
		);
		expect(next.slides.find((slide) => slide.id === "a")?.question).toBe("A");
	});

	test("remove-slide drops by id regardless of position", () => {
		const next = applyEditorOperation(docOf(slideA, slideB, slideC), {
			type: "remove-slide",
			slideId: "b",
		});
		expect(next.slides.map((slide) => slide.id)).toEqual(["a", "c"]);
	});

	test("remove-slide keeps the last remaining slide", () => {
		const next = applyEditorOperation(docOf(slideA), {
			type: "remove-slide",
			slideId: "a",
		});
		expect(next.slides).toHaveLength(1);
	});

	test("move-slide swaps with a neighbour and clamps at the ends", () => {
		const downward = applyEditorOperation(docOf(slideA, slideB, slideC), {
			type: "move-slide",
			slideId: "a",
			direction: 1,
		});
		expect(downward.slides.map((slide) => slide.id)).toEqual(["b", "a", "c"]);

		const clamped = applyEditorOperation(docOf(slideA, slideB), {
			type: "move-slide",
			slideId: "a",
			direction: -1,
		});
		expect(clamped.slides.map((slide) => slide.id)).toEqual(["a", "b"]);
	});

	test("unknown ids are no-ops", () => {
		const document = docOf(slideA, slideB);
		expect(
			applyEditorOperation(document, {
				type: "update-slide",
				slideId: "missing",
				changes: { question: "x" },
			}).slides,
		).toEqual(document.slides);
		expect(
			applyEditorOperation(document, {
				type: "move-slide",
				slideId: "missing",
				direction: 1,
			}).slides,
		).toEqual(document.slides);
	});
});

describe("applyEditorOperation — options", () => {
	const choiceSlide: Slide = {
		id: "mc",
		type: "multiple-choice",
		question: "Pick",
		options: [
			{ id: "o1", text: "One" },
			{ id: "o2", text: "Two" },
			{ id: "o3", text: "Three" },
		],
	};

	test("add-option appends the supplied option", () => {
		const next = applyEditorOperation(docOf(choiceSlide), {
			type: "add-option",
			slideId: "mc",
			option: { id: "o4", text: "Four" },
		});
		expect(next.slides[0].options).toHaveLength(4);
		expect(next.slides[0].options?.at(-1)?.id).toBe("o4");
	});

	test("update-option edits by id, leaving siblings untouched", () => {
		const next = applyEditorOperation(docOf(choiceSlide), {
			type: "update-option",
			slideId: "mc",
			optionId: "o2",
			changes: { text: "Second" },
		});
		expect(next.slides[0].options?.map((option) => option.text)).toEqual([
			"One",
			"Second",
			"Three",
		]);
	});

	test("remove-option drops by id but keeps at least two options", () => {
		const trimmed = applyEditorOperation(docOf(choiceSlide), {
			type: "remove-option",
			slideId: "mc",
			optionId: "o3",
		});
		expect(trimmed.slides[0].options?.map((option) => option.id)).toEqual([
			"o1",
			"o2",
		]);

		// already at two — further removal is refused
		const floored = applyEditorOperation(trimmed, {
			type: "remove-option",
			slideId: "mc",
			optionId: "o1",
		});
		expect(floored.slides[0].options).toHaveLength(2);
	});

	test("option operations on a slide without options are no-ops", () => {
		const document = blankDocument();
		const textSlide: Slide = { id: "t", type: "text", question: "" };
		const withText = { ...document, slides: [textSlide] };
		const next = applyEditorOperation(withText, {
			type: "add-option",
			slideId: "t",
			option: { id: "x", text: "x" },
		});
		expect(next.slides[0].options).toBeUndefined();
	});
});

// ── The authoring default a correct area brings with it (REQ053) ───────
//
// A target area is an answer key drawn on the picture participants are aiming at.
// The regression these cover: an organizer who marks one and changes nothing else
// used to ship a slide that showed the room the answer while they aimed, because
// the deck's own default is "Instant". Enabling the target now authors the reveal
// it needs — and only ever tightens, never the reverse.

describe("withPinAreaEnabled (REQ053)", () => {
	test("turning a target on pins the slide to reveal-on-click", () => {
		const changes = withPinAreaEnabled({ resultsVisibility: "inherit" }, "instant");
		expect(changes.resultsVisibility).toBe("on-click");
		expect(changes.pinArea).not.toBe(null);
	});

	test("a slide with no visibility set yet is treated as inheriting", () => {
		// `resultsVisibility` is a defaulted field, so a half-built editor slide
		// carries no value at all — which is the case an organizer actually hits.
		expect(withPinAreaEnabled({}, "instant").resultsVisibility).toBe("on-click");
	});

	test("a deck already defaulting to on-click is inherited unchanged", () => {
		// Nothing to tighten: the slide is already revealed deliberately, and
		// writing an override would only pin it against a later deck-level change.
		const changes = withPinAreaEnabled({ resultsVisibility: "inherit" }, "on-click");
		expect(changes.resultsVisibility).toBeUndefined();
		expect(changes.pinArea).not.toBe(null);
	});

	test("a private deck is never loosened into something revealable", () => {
		// The failure this guards: "default to on-click" applied blindly would turn
		// a slide inheriting a private deck into one the room eventually sees.
		const changes = withPinAreaEnabled({ resultsVisibility: "inherit" }, "private");
		expect(changes.resultsVisibility).toBeUndefined();
	});

	test("an explicit choice by the author is left alone", () => {
		// Including an explicit "Instant": showing the answer up front stays
		// available, it just has to be asked for.
		for (const chosen of ["instant", "on-click", "private"] as const) {
			expect(
				withPinAreaEnabled({ resultsVisibility: chosen }, "instant")
					.resultsVisibility,
			).toBeUndefined();
		}
	});

	test("the seeded target is a usable area the schema accepts", () => {
		// It is authored, saved and hit-tested immediately, so it has to be a real
		// rectangle rather than a placeholder the validator would refuse.
		const area = withPinAreaEnabled({}, "instant").pinArea;
		expect(isUsablePinArea(area as PinArea)).toBe(true);
	});
});
