/**
 * Unit tests for the editor document reducer — the CRDT-ready seam. These cover
 * the pure `applyEditorOperation` function directly (no store, no React), and
 * in particular the property that justifies addressing by stable id rather than
 * index: an operation stays correct even when the slide list has been reordered
 * or grown underneath it, which is exactly what concurrent edits do.
 */

import { describe, expect, test } from "bun:test";
import type { PinArea, Slide } from "../types";
import { isUsablePinArea, SLIDE_LIMIT } from "../types";
import {
	applyEditorOperation,
	blankDocument,
	canCopySlides,
	canRemoveSlides,
	copySlidesOperation,
	type EditorDocument,
	type EditorOperation,
	moveSlideBlock,
	withPinAreaEnabled,
} from "./editorDocument";

function docOf(...slides: Slide[]): EditorDocument {
	return {
		title: "",
		language: "en",
		mode: "live",
		allowRepeatPasses: false,
		resultsVisibility: "instant",
		qaEnabled: false,
		qaVisibility: "presenter",
		reactionsEnabled: false,
		chatEnabled: false,
		requireParticipantName: false,
		requireParticipantSignIn: false,
		profanityFilterEnabled: false,
		profanityFilterLanguage: null,
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

describe("applyEditorOperation — bulk slide operations (REQ127)", () => {
	const slideD: Slide = { id: "d", type: "word-cloud", question: "D" };
	const slideE: Slide = { id: "e", type: "word-cloud", question: "E" };
	const idsOf = (document: EditorDocument) =>
		document.slides.map((slide) => slide.id);

	test("move-slides moves a contiguous selection one step as a block", () => {
		const document = docOf(slideA, slideB, slideC, slideD);
		const down = applyEditorOperation(document, {
			type: "move-slides",
			slideIds: ["b", "c"],
			direction: 1,
		});
		expect(idsOf(down)).toEqual(["a", "d", "b", "c"]);
		const up = applyEditorOperation(document, {
			type: "move-slides",
			slideIds: ["b", "c"],
			direction: -1,
		});
		expect(idsOf(up)).toEqual(["b", "c", "a", "d"]);
	});

	test("move-slides keeps the deck order of the selection, not the order it was picked in", () => {
		const next = applyEditorOperation(docOf(slideA, slideB, slideC, slideD), {
			type: "move-slides",
			slideIds: ["c", "b"],
			direction: 1,
		});
		expect(idsOf(next)).toEqual(["a", "d", "b", "c"]);
	});

	test("move-slides gathers a selection with gaps behind its first slide", () => {
		const document = docOf(slideA, slideB, slideC, slideD, slideE);
		const down = applyEditorOperation(document, {
			type: "move-slides",
			slideIds: ["b", "d"],
			direction: 1,
		});
		expect(idsOf(down)).toEqual(["a", "c", "b", "d", "e"]);
		const up = applyEditorOperation(document, {
			type: "move-slides",
			slideIds: ["b", "d"],
			direction: -1,
		});
		expect(idsOf(up)).toEqual(["b", "d", "a", "c", "e"]);
	});

	test("move-slides at an end of the deck is a no-op returning the same document", () => {
		const document = docOf(slideA, slideB, slideC);
		expect(
			applyEditorOperation(document, {
				type: "move-slides",
				slideIds: ["a", "b"],
				direction: -1,
			}),
		).toBe(document);
		expect(
			applyEditorOperation(document, {
				type: "move-slides",
				slideIds: ["c"],
				direction: 1,
			}),
		).toBe(document);
		expect(
			applyEditorOperation(document, {
				type: "move-slides",
				slideIds: ["missing"],
				direction: 1,
			}),
		).toBe(document);
	});

	test("moveSlideBlock answers whether a move is possible by identity", () => {
		const slides = [slideA, slideB, slideC];
		expect(moveSlideBlock(slides, ["a"], -1)).toBe(slides);
		expect(moveSlideBlock(slides, ["a"], 1)).not.toBe(slides);
		// A gapped selection at the top still moves "up": it closes its gap.
		expect(moveSlideBlock(slides, ["a", "c"], -1).map((slide) => slide.id)).toEqual(
			["a", "c", "b"],
		);
	});

	test("set-slides-skipped sets every selected slide to the one state, mixed or not", () => {
		const document = docOf({ ...slideA, skipped: true }, slideB, slideC);
		const skipped = applyEditorOperation(document, {
			type: "set-slides-skipped",
			slideIds: ["a", "b"],
			skipped: true,
		});
		expect(skipped.slides.map((slide) => slide.skipped ?? false)).toEqual([
			true,
			true,
			false,
		]);
		const included = applyEditorOperation(skipped, {
			type: "set-slides-skipped",
			slideIds: ["a", "b"],
			skipped: false,
		});
		expect(included.slides.map((slide) => slide.skipped ?? false)).toEqual([
			false,
			false,
			false,
		]);
		// Nothing else on a slide moves.
		expect(included.slides[0].question).toBe("A");
	});

	test("remove-slides deletes the whole selection in one operation", () => {
		const next = applyEditorOperation(docOf(slideA, slideB, slideC, slideD), {
			type: "remove-slides",
			slideIds: ["a", "c"],
		});
		expect(idsOf(next)).toEqual(["b", "d"]);
	});

	test("remove-slides refuses, whole, a selection covering every slide", () => {
		const document = docOf(slideA, slideB, slideC);
		const next = applyEditorOperation(document, {
			type: "remove-slides",
			slideIds: ["a", "b", "c"],
		});
		// Not trimmed to leave one: nothing at all is removed.
		expect(next).toBe(document);
		expect(canRemoveSlides(document.slides, ["a", "b", "c"])).toBe(false);
		expect(canRemoveSlides(document.slides, ["a", "b"])).toBe(true);
		expect(canRemoveSlides(document.slides, [])).toBe(false);
		expect(canRemoveSlides(document.slides, ["missing"])).toBe(false);
	});

	test("remove-slides never empties a one-slide deck", () => {
		const document = docOf(slideA);
		expect(
			applyEditorOperation(document, { type: "remove-slides", slideIds: ["a"] }),
		).toBe(document);
	});
});

describe("applyEditorOperation — copy-slides (REQ127)", () => {
	const slideD: Slide = { id: "d", type: "word-cloud", question: "D" };
	const choice: Slide = {
		id: "choice",
		type: "multiple-choice",
		question: "Pick",
		skipped: true,
		options: [
			{ id: "opt-1", text: "One", isCorrect: true },
			{ id: "opt-2", text: "Two", isCorrect: false },
		],
	};
	const form: Slide = {
		id: "form",
		type: "form",
		question: "Tell us",
		formFields: [
			{
				id: "field-1",
				label: "Colour",
				type: "choice",
				required: false,
				options: [
					{ id: "field-opt-1", text: "Red" },
					{ id: "field-opt-2", text: "Blue" },
				],
			},
		],
	} as Slide;
	const idsOf = (document: EditorDocument) =>
		document.slides.map((slide) => slide.id);

	/** Build the operation for `slideIds` and apply it, as the store does. */
	function copy(document: EditorDocument, slideIds: string[]) {
		const operation = copySlidesOperation(document.slides, slideIds);
		if (!operation) throw new Error("expected something to copy");
		return {
			operation,
			next: applyEditorOperation(document, operation),
		};
	}

	/** Every id a slide carries: its own, its rows', and a form field's options. */
	function idsWithin(slide: Slide): string[] {
		const rows = [
			...(slide.options ?? []),
			...(slide.formFields ?? []),
		] as { id: string; options?: { id: string }[] }[];
		return [
			slide.id,
			...rows.flatMap((row) => [
				row.id,
				...(row.options ?? []).map((option) => option.id),
			]),
		];
	}

	test("a contiguous selection is copied as one block right after its last slide", () => {
		const document = docOf(slideA, slideB, slideC, slideD);
		const { operation, next } = copy(document, ["c", "b"]);
		const [copyOfB, copyOfC] = operation.copies.map((slide) => slide.id);
		expect(idsOf(next)).toEqual(["a", "b", "c", copyOfB, copyOfC, "d"]);
		expect(next.slides[3].question).toBe("B");
		expect(next.slides[4].question).toBe("C");
	});

	test("a selection with gaps keeps its deck order and lands after its last slide", () => {
		const document = docOf(slideA, slideB, slideC, slideD);
		const { operation, next } = copy(document, ["c", "a"]);
		const [copyOfA, copyOfC] = operation.copies.map((slide) => slide.id);
		expect(idsOf(next)).toEqual(["a", "b", "c", copyOfA, copyOfC, "d"]);
		expect(next.slides.slice(3, 5).map((slide) => slide.question)).toEqual([
			"A",
			"C",
		]);
	});

	test("every copy and every nested row gets an id no other part of the deck has", () => {
		const document = docOf(slideA, choice, form);
		const { next } = copy(document, ["choice", "form"]);
		const everyId = next.slides.flatMap(idsWithin);
		expect(new Set(everyId).size).toBe(everyId.length);
		// The copies carry as many identities as their sources — each one re-minted.
		expect(everyId.length).toBe(
			idsWithin(slideA).length +
				2 * (idsWithin(choice).length + idsWithin(form).length),
		);
	});

	test("nothing but the ids changes on a copy — a skipped slide's copy stays skipped", () => {
		const { next } = copy(docOf(slideA, choice), ["choice"]);
		const duplicate = next.slides[2];
		expect(duplicate.skipped).toBe(true);
		expect(duplicate.question).toBe("Pick");
		expect(
			duplicate.options?.map(({ text, isCorrect }) => ({ text, isCorrect })),
		).toEqual([
			{ text: "One", isCorrect: true },
			{ text: "Two", isCorrect: false },
		]);
	});

	test("the source slides are left untouched", () => {
		const document = docOf(slideA, choice, form);
		const { next } = copy(document, ["choice", "form"]);
		expect(next.slides[1]).toBe(choice);
		expect(next.slides[2]).toBe(form);
		expect(choice.options?.map((option) => option.id)).toEqual([
			"opt-1",
			"opt-2",
		]);
		expect(document.slides).toEqual([slideA, choice, form]);
	});

	test("an empty or unknown-id selection copies nothing", () => {
		const document = docOf(slideA, slideB);
		expect(copySlidesOperation(document.slides, [])).toBeNull();
		expect(copySlidesOperation(document.slides, ["missing"])).toBeNull();
		const emptyCopy: EditorOperation = {
			type: "copy-slides",
			afterSlideId: "a",
			copies: [],
		};
		expect(applyEditorOperation(document, emptyCopy)).toBe(document);
		const strayAnchor: EditorOperation = {
			type: "copy-slides",
			afterSlideId: "missing",
			copies: [{ ...slideC, id: "fresh" }],
		};
		expect(applyEditorOperation(document, strayAnchor)).toBe(document);
	});

	test("canCopySlides holds the deck's slide cap", () => {
		const nearlyFull = Array.from(
			{ length: SLIDE_LIMIT - 1 },
			(_, index): Slide => ({ ...slideA, id: `slide-${index}` }),
		);
		expect(canCopySlides(nearlyFull, ["slide-0"])).toBe(true);
		expect(canCopySlides(nearlyFull, ["slide-0", "slide-1"])).toBe(false);
		expect(canCopySlides(nearlyFull, [])).toBe(false);
		expect(canCopySlides(nearlyFull, ["missing"])).toBe(false);
	});
});
