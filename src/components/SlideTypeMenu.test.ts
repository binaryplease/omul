/**
 * Unit tests for the slide-type descriptors (REQ155).
 *
 * The picker and the settings column are both markup over these three records,
 * and a type missing from any of them is a hole a reader only finds in front of
 * an author: an unnamed tile in the picker, or a column with nothing in it.
 *
 * Three claims:
 *
 *   - **Every slide type is named, hinted and sectioned.** Walked from the
 *     schema's own enum, so adding a type to the schema without teaching these
 *     records about it fails here rather than rendering blank.
 *   - **The section descriptor cannot disagree with the shared predicates.** The
 *     results group exists exactly where `slideHasResults` says a tally does; a
 *     column that offered a reveal setting for a slide that shows no result — or
 *     withheld one from a slide that does — would be authoring a rule the server
 *     does not enforce.
 *   - **Which groups a type owns is declared, not implied.** Scoring is a quiz's
 *     alone (REQ054/REQ057); the two types whose content is not authored in the
 *     column say so with a `null` rather than with an empty group.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import { isContentSlideType, slideHasResults } from "../types";
import {
	SLIDE_TYPE_HINTS,
	SLIDE_TYPE_LABELS,
	SLIDE_TYPE_SECTIONS,
} from "./SlideTypeMenu";

const EVERY_SLIDE_TYPE = SlideTypeEnum.options;

describe("every slide type is described", () => {
	test("each has a label, a hint and a set of sections", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect([type, typeof SLIDE_TYPE_LABELS[type]]).toEqual([type, "string"]);
			expect([type, typeof SLIDE_TYPE_HINTS[type]]).toEqual([type, "string"]);
			expect([type, typeof SLIDE_TYPE_SECTIONS[type]]).toEqual([type, "object"]);
		}
	});

	test("no record carries a type the schema does not know", () => {
		expect(Object.keys(SLIDE_TYPE_SECTIONS).sort()).toEqual(
			[...EVERY_SLIDE_TYPE].sort(),
		);
	});
});

describe("the column and the tally agree about what a slide produces (REQ155)", () => {
	test("a results group exists exactly where a tally does", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect([type, SLIDE_TYPE_SECTIONS[type].results !== null]).toEqual([
				type,
				slideHasResults(type),
			]);
		}
	});

	test("a content slide authors no answers and keeps no score", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			if (!isContentSlideType(type)) continue;
			expect([type, SLIDE_TYPE_SECTIONS[type].answers]).toEqual([type, null]);
			expect([type, SLIDE_TYPE_SECTIONS[type].scoring]).toEqual([type, null]);
		}
	});

	test("scoring and timing belong to the quiz alone", () => {
		const scored = EVERY_SLIDE_TYPE.filter(
			(type) => SLIDE_TYPE_SECTIONS[type].scoring !== null,
		);
		expect(scored).toEqual(["quiz"]);
	});

	test("the two types whose content is not authored in the column say so", () => {
		// A leaderboard shows the deck rather than anything of its own, and a pin
		// slide's picture *is* its question (REQ052), so it is authored under the
		// answers it makes possible.
		const withoutContent = EVERY_SLIDE_TYPE.filter(
			(type) => SLIDE_TYPE_SECTIONS[type].content === null,
		);
		expect(withoutContent.sort()).toEqual(["leaderboard", "pin-image"]);
	});

	test("only a structured answer shape is allowed to scroll", () => {
		// The common types must fit the column without scrolling (REQ155); the
		// types that may run long are the ones whose answers are a field set
		// rather than rows on the canvas.
		const scrolling = EVERY_SLIDE_TYPE.filter(
			(type) => SLIDE_TYPE_SECTIONS[type].scrolls,
		);
		expect([...scrolling].sort().join(" ")).toBe(
			"form grid guess-number pin-image points quiz ranking scale",
		);
		expect(scrolling).not.toContain("multiple-choice");
		expect(scrolling).not.toContain("word-cloud");
	});
});
