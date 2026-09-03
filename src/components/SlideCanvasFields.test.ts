/**
 * Unit tests for the canvas's authoring layer (REQ153).
 *
 * The components themselves are markup over the descriptors below, so the
 * descriptors are where the content is. Six claims, and the slice leans on all
 * six:
 *
 *   - **A heading stays one line.** The field is a textarea and every room
 *     surface draws the heading as a single inline run, so a break the canvas
 *     showed would be a break the projector collapses — the author would leave
 *     believing in a slide no screen will draw. Asserted on the reduction rather
 *     than on the keystroke, because a value also arrives by paste and by import.
 *   - **A placeholder does not invent a rule.** `handleSubmit` requires a
 *     question on non-content slides and on no content one; the ghost text on a
 *     heading or a caption has to say so, the way the field it replaced did.
 *   - **Every slide type has a name for its first authored string, and a
 *     placeholder for it.** The field is drawn on the slide, so a type nobody
 *     taught this module about would put an unnamed box in front of an author
 *     and an empty accessible name in front of a screen reader. Walking the
 *     schema's own slide-type enum is what turns "every type" into an assertion.
 *   - **An empty question is visibly untitled, and honest about it.** Where the
 *     room shows a default for a blank heading, the placeholder *is* that
 *     default — the canvas must not promise a blank projector where the audience
 *     will read "Join the presentation".
 *   - **Which slides have option rows to type in is asked once.** The column
 *     beside the canvas and the canvas itself both branch on it, and a quiz
 *     answered by typing has no options at all (REQ055) — two spellings of that
 *     is how one surface offers a row the other will not draw.
 *   - **The two-option floor is unchanged (REQ012), and it explains itself.** The
 *     control stays on screen either way, so the reason has to be a
 *     value rather than a rendering decision — it has to reach an accessible
 *     name, not just a tooltip.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import { newSlide } from "../store/editorDocument";
import type { Slide } from "../types";
import { LEADERBOARD_LABELS_EN } from "./Leaderboard";
import { parseSlideInline } from "./SlideText";
import {
	canvasOptionRemoval,
	correctOptionHint,
	INSTRUCTION_FALLBACK_HEADING,
	isChoiceShapedSlide,
	MIN_CHOICE_OPTIONS,
	singleLineQuestion,
	slideQuestionLabel,
	slideQuestionPlaceholder,
} from "./SlideCanvasFields";

const EVERY_SLIDE_TYPE = SlideTypeEnum.options;

describe("the field on the slide names itself (REQ153)", () => {
	test("every slide type has a name for its first authored string", () => {
		const named: Record<string, string> = {};
		for (const type of EVERY_SLIDE_TYPE) {
			named[type] = slideQuestionLabel(newSlide(type));
		}

		expect(named).toEqual({
			"multiple-choice": "Question",
			"word-cloud": "Question",
			"open-text": "Question",
			scale: "Question",
			ranking: "Question",
			grid: "Question",
			points: "Question",
			"guess-number": "Question",
			"pin-image": "Question",
			quiz: "Question",
			form: "Question",
			leaderboard: "Heading",
			text: "Heading",
			image: "Caption",
			video: "Caption",
			embed: "Caption",
			instruction: "Heading",
		});
	});

	test("no type is left with a nameless box", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect(slideQuestionLabel(newSlide(type)).length).toBeGreaterThan(0);
		}
	});
});

describe("an untitled slide is visibly untitled (REQ153)", () => {
	test("every slide type says something in an empty question", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			expect(slideQuestionPlaceholder(newSlide(type)).trim().length)
				.toBeGreaterThan(0);
		}
	});

	test("where the room has a default, the placeholder is that default", () => {
		// These two are the only headings an audience reads something in place of.
		// A placeholder inventing its own words here would show the author a blank
		// slide the room will not get.
		expect(slideQuestionPlaceholder(newSlide("instruction"))).toBe(
			INSTRUCTION_FALLBACK_HEADING,
		);
		expect(slideQuestionPlaceholder(newSlide("leaderboard"))).toBe(
			LEADERBOARD_LABELS_EN.title,
		);
	});

	test("a question slide is told what to write, not shown a fake heading", () => {
		expect(slideQuestionPlaceholder(newSlide("multiple-choice"))).toBe(
			"Type your question…",
		);
	});

	test("a heading or caption the deck can ship without says it is optional", () => {
		// `CreatePage.handleSubmit` refuses a blank question on every *non*-content
		// slide and on no content one, so these four are the types whose ghost text
		// must not read as a requirement.
		for (const type of ["text", "image", "video", "embed"] as const) {
			expect(slideQuestionPlaceholder(newSlide(type)).toLowerCase()).toContain(
				"optional",
			);
		}
	});
});

describe("a heading is one line, on the canvas as in the room (REQ153)", () => {
	test("a break becomes the space every screen would render it as", () => {
		expect(singleLineQuestion("Round 1\nWhich city?")).toBe(
			"Round 1 Which city?",
		);
		expect(singleLineQuestion("Round 1\r\nWhich city?")).toBe(
			"Round 1 Which city?",
		);
		expect(singleLineQuestion("Round 1\rWhich city?")).toBe(
			"Round 1 Which city?",
		);
	});

	test("a pasted block of lines still leaves one line", () => {
		const reduced = singleLineQuestion("one\ntwo\nthree\n");
		expect(reduced).toBe("one two three ");
		expect(reduced).not.toContain("\n");
	});

	test("a heading with no break is left exactly as authored", () => {
		// Including its spacing and its markup — this reduction is not a trim, and
		// a heading that lost a space would be a different heading.
		expect(singleLineQuestion("  **Q3** — see the report  ")).toBe(
			"  **Q3** — see the report  ",
		);
		expect(singleLineQuestion("")).toBe("");
	});

	test("what survives the reduction is what the room's parser reads as text", () => {
		// The reason the rule exists: a heading is parsed as one inline run, and
		// `parseSlideInline` keeps a break as literal text — which the room's
		// `<span>` then collapses. Reducing it here is what makes the canvas and
		// the projector agree instead of disagreeing silently.
		const authored = "Round 1\nWhich city?";
		const asTypedInARoom = parseSlideInline(authored)
			.map((node) => (node.kind === "text" ? node.text : ""))
			.join("");
		expect(asTypedInARoom).toContain("\n");
		expect(singleLineQuestion(authored)).not.toContain("\n");
	});
});

describe("marking an option correct explains itself (REQ013)", () => {
	test("a quiz says it scores, a choice slide says it reveals", () => {
		expect(correctOptionHint(newSlide("quiz")).toLowerCase()).toContain("score");
		expect(
			correctOptionHint(newSlide("multiple-choice")).toLowerCase(),
		).toContain("revealed");
	});

	test("every slide that carries option rows has something to say", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			const slide = newSlide(type);
			if (!isChoiceShapedSlide(slide)) continue;
			expect(correctOptionHint(slide).trim().length).toBeGreaterThan(0);
		}
	});
});

describe("which slides carry option rows is asked once (REQ153)", () => {
	test("a choice slide and a picked quiz have rows; a typed quiz does not", () => {
		expect(isChoiceShapedSlide(newSlide("multiple-choice"))).toBe(true);
		expect(isChoiceShapedSlide(newSlide("quiz"))).toBe(true);

		// REQ055 — the answer key of a typed quiz is a list of accepted strings,
		// not a set of visible rows, so it keeps its field group in the column.
		const typedQuiz: Slide = { ...newSlide("quiz"), quizAnswerMode: "type" };
		expect(isChoiceShapedSlide(typedQuiz)).toBe(false);
	});

	test("no other slide type grows an option list", () => {
		const withRows = EVERY_SLIDE_TYPE.filter((type) =>
			isChoiceShapedSlide(newSlide(type)),
		);
		expect(withRows.sort()).toEqual(["multiple-choice", "quiz"]);
	});
});

describe("the two-option floor, moved but unchanged (REQ012)", () => {
	test("a third option is what makes one removable", () => {
		expect(canvasOptionRemoval(MIN_CHOICE_OPTIONS + 1).enabled).toBe(true);
		expect(canvasOptionRemoval(MIN_CHOICE_OPTIONS).enabled).toBe(false);
		expect(canvasOptionRemoval(0).enabled).toBe(false);
	});

	test("a refusal carries its reason, so a disabled control can state it", () => {
		const atFloor = canvasOptionRemoval(MIN_CHOICE_OPTIONS);
		expect(atFloor.reason.length).toBeGreaterThan(0);
		expect(atFloor.reason).toContain(String(MIN_CHOICE_OPTIONS));
	});
});
