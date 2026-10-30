/**
 * The editor's save rules (REQ220, REQ219).
 *
 * Three claims:
 *
 *   - **A slide that poses no question is not asked for one.** A leaderboard
 *     added from the menu saved as nothing until it was given a heading the room
 *     draws on its own — "All slides need a question" on a slide that asks
 *     nothing. Content slides were already exempt, and still are.
 *   - **A refusal names its slide.** The message carries the rail number and
 *     the refusal carries the index, so the page can select the slide it means.
 *   - **A quiz with no answer key is not a refusal.** It is warned about, not
 *     blocked: a draft must stay saveable.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../server/schemas";
import { DECK_TEMPLATES } from "../server/templates";
import { slideSaveRefusalFor } from "./slide-save-refusal";
import { newSlide } from "./store/editorDocument";
import type { Slide } from "./types";
import { slideRequiresQuestion } from "./types";

/** A fresh slide with its question, and every option row it shows, filled in. */
function questioned(type: Slide["type"]): Slide {
	const slide = { ...newSlide(type), question: "Which city?" };
	slide.options = slide.options?.map((option, optionIndex) => ({
		...option,
		text: `Option ${optionIndex + 1}`,
	}));
	return slide;
}

describe("which slides need a question (REQ220)", () => {
	test("a freshly added leaderboard saves as it is", () => {
		expect(slideSaveRefusalFor([newSlide("leaderboard")])).toBeNull();
		expect(
			slideSaveRefusalFor([questioned("quiz"), newSlide("leaderboard")]),
		).toBeNull();
	});

	test("a How to Join or a text slide saves without a heading", () => {
		expect(slideSaveRefusalFor([newSlide("instruction")])).toBeNull();
		expect(slideSaveRefusalFor([newSlide("text")])).toBeNull();
	});

	test("every slide that collects answers is refused without one", () => {
		for (const type of SlideTypeEnum.options) {
			if (!slideRequiresQuestion(type)) continue;
			const refusal = slideSaveRefusalFor([
				newSlide("text"),
				{ ...newSlide(type), question: "  " },
			]);
			expect(refusal).toEqual({
				slideIndex: 1,
				message: "Slide 2: Slides that collect answers need a question",
			});
		}
	});

	test("only those: no other type is refused for a blank question", () => {
		for (const type of SlideTypeEnum.options) {
			if (slideRequiresQuestion(type)) continue;
			const refusal = slideSaveRefusalFor([newSlide(type)]);
			expect(refusal?.message ?? "").not.toContain("question");
		}
	});
});

describe("a refusal names the slide it means (REQ220)", () => {
	test("by rail number in the words, by index for selecting it", () => {
		const imageWithoutUrl = { ...newSlide("image"), mediaUrl: "" };
		expect(
			slideSaveRefusalFor([
				questioned("quiz"),
				newSlide("leaderboard"),
				imageWithoutUrl,
			]),
		).toEqual({ slideIndex: 2, message: "Slide 3: Image slides need an image URL" });
	});

	test("the first failing slide is the one named", () => {
		const refusal = slideSaveRefusalFor([
			questioned("multiple-choice"),
			{ ...newSlide("quiz"), question: "" },
			{ ...newSlide("open-text"), question: "" },
		]);
		expect(refusal?.slideIndex).toBe(1);
	});
});

describe("a quiz with no answer key is a draft, not a refusal (REQ219)", () => {
	test("a select-answer quiz with nothing marked saves", () => {
		const slide = questioned("quiz");
		slide.options = [
			{ id: "a", text: "Wien", isCorrect: false },
			{ id: "b", text: "Graz", isCorrect: false },
		];
		expect(slideSaveRefusalFor([slide])).toBeNull();
	});

	test("a typed quiz with no accepted answer saves", () => {
		const slide = {
			...questioned("quiz"),
			quizAnswerMode: "type" as const,
			quizAnswers: [],
		};
		expect(slideSaveRefusalFor([slide])).toBeNull();
	});

	test("a typed quiz is not refused over the option rows it never shows", () => {
		// A fresh quiz opens with two blank options; switching it to typed
		// answers keeps them, out of sight, where nobody could fill them in.
		const slide = {
			...newSlide("quiz"),
			question: "Capital of Austria?",
			quizAnswerMode: "type" as const,
			quizAnswers: [{ id: "w", text: "Wien" }],
		};
		expect(slide.options?.every((option) => option.text === "")).toBe(true);
		expect(slideSaveRefusalFor([slide])).toBeNull();
	});
});

test("every catalog template saves as it is (REQ005, REQ220)", () => {
	for (const template of DECK_TEMPLATES) {
		expect(slideSaveRefusalFor(template.slides)).toBeNull();
	}
});
