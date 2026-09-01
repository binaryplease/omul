/**
 * Unit tests for the editor slice — the authoring document and its structural
 * mutations. The slice addresses slides and options by **stable id** (the
 * CRDT-ready seam); each test uses a fresh store from the factory, so state is
 * fully isolated between cases.
 */

import { describe, expect, test } from "bun:test";
import {
	isMultiSelect,
	LEADERBOARD_DEFAULT_SIZE,
	maxSelectionsFor,
} from "../types";
import { createAppStore } from "./store";

describe("editor slice — defaults & loading", () => {
	test("resetEditor seeds a single blank multiple-choice slide", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const { title, language, mode, slides } = store.getState();
		expect(title).toBe("");
		expect(language).toBe("en");
		expect(mode).toBe("live");
		expect(slides).toHaveLength(1);
		expect(slides[0].type).toBe("multiple-choice");
		expect(slides[0].options).toHaveLength(2);
	});

	test("loadEditor populates the document and defaults language/mode", () => {
		const store = createAppStore();
		store.getState().loadEditor({
			title: "Loaded",
			slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
		});
		expect(store.getState().title).toBe("Loaded");
		expect(store.getState().language).toBe("en");
		expect(store.getState().mode).toBe("live");
		expect(store.getState().slides).toHaveLength(1);
	});
});

describe("editor slice — slide mutations", () => {
	test("addSlide appends type-specific defaults", () => {
		const store = createAppStore();
		store.getState().resetEditor();

		store.getState().addSlide("quiz");
		const quiz = store.getState().slides.at(-1);
		expect(quiz?.type).toBe("quiz");
		expect(quiz?.timeLimit).toBe(30);
		expect(quiz?.options?.every((option) => option.isCorrect === false)).toBe(
			true,
		);

		store.getState().addSlide("scale");
		const scale = store.getState().slides.at(-1);
		expect(scale?.scaleMin).toBe(1);
		expect(scale?.scaleMax).toBe(5);

		// REQ034: a ranking slide starts with two blank items — one item is not
		// an ordering, so the editor never opens on an unusable slide.
		store.getState().addSlide("ranking");
		const ranking = store.getState().slides.at(-1);
		expect(ranking?.type).toBe("ranking");
		expect(ranking?.rankingItems).toHaveLength(2);
		expect(
			ranking?.rankingItems?.every((item) => item.text === ""),
		).toBe(true);
		// Item ids are minted up front so every replica addresses the same item.
		expect(new Set(ranking?.rankingItems?.map((item) => item.id)).size).toBe(2);

		// REQ047/REQ049: a 2x2 grid slide opens with two blank items and both
		// axes on the 0–10 range, so the number fields never start empty.
		store.getState().addSlide("grid");
		const grid = store.getState().slides.at(-1);
		expect(grid?.type).toBe("grid");
		expect(grid?.gridItems).toHaveLength(2);
		expect(new Set(grid?.gridItems?.map((item) => item.id)).size).toBe(2);
		expect(grid?.gridXAxis).toEqual({
			title: "",
			min: 0,
			max: 10,
			minLabel: "",
			maxLabel: "",
		});
		expect(grid?.gridYAxis?.max).toBe(10);

		// REQ045: a 100 Points slide opens with two blank items — one item is no
		// trade-off, so the editor never opens on an unusable slide.
		store.getState().addSlide("points");
		const points = store.getState().slides.at(-1);
		expect(points?.type).toBe("points");
		expect(points?.pointsItems).toHaveLength(2);
		expect(points?.pointsItems?.every((item) => item.text === "")).toBe(true);
		// Item ids are minted up front so every replica addresses the same item.
		expect(new Set(points?.pointsItems?.map((item) => item.id)).size).toBe(2);

		// REQ040/REQ043: a Guess the Number slide opens on the 0–100 range in
		// steps of 1, so the frame fields never start empty — and with no
		// reference number (REQ041), because a correct answer is a decision the
		// organizer makes, not one the editor makes for them.
		store.getState().addSlide("guess-number");
		const guess = store.getState().slides.at(-1);
		expect(guess?.type).toBe("guess-number");
		expect(guess?.guessRange).toEqual({ min: 0, max: 100, step: 1 });
		expect(guess?.guessReference).toBe(null);

		// REQ059: a leaderboard opens on the default top five, so the places field
		// starts on the number the slide actually shows. Nothing else to seed — the
		// board's content is the deck's quiz questions, not anything authored here.
		store.getState().addSlide("leaderboard");
		const board = store.getState().slides.at(-1);
		expect(board?.type).toBe("leaderboard");
		expect(board?.leaderboardSize).toBe(LEADERBOARD_DEFAULT_SIZE);
	});

	test("updateSlide shallow-merges changes at a slide id", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;
		store.getState().updateSlide(slideId, { question: "Edited" });
		expect(store.getState().slides[0].question).toBe("Edited");
		// other fields preserved
		expect(store.getState().slides[0].options).toHaveLength(2);
	});

	test("updateSlide for an unknown id is a no-op", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		store.getState().updateSlide("does-not-exist", { question: "ghost" });
		expect(store.getState().slides[0].question).toBe("");
	});

	test("removeSlide refuses to remove the last slide", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		store.getState().removeSlide(store.getState().slides[0].id);
		expect(store.getState().slides).toHaveLength(1);
	});

	test("removeSlide drops the slide with the given id when more than one", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const firstId = store.getState().slides[0].id;
		store.getState().updateSlide(firstId, { question: "keep" });
		store.getState().addSlide("word-cloud");
		const secondId = store.getState().slides[1].id;
		store.getState().removeSlide(secondId);
		expect(store.getState().slides).toHaveLength(1);
		expect(store.getState().slides[0].question).toBe("keep");
	});

	test("moveSlide swaps adjacent slides and clamps at the ends", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const firstId = store.getState().slides[0].id;
		store.getState().updateSlide(firstId, { question: "first" });
		store.getState().addSlide("word-cloud");
		const secondId = store.getState().slides[1].id;
		store.getState().updateSlide(secondId, { question: "second" });

		store.getState().moveSlide(firstId, 1);
		expect(store.getState().slides.map((slide) => slide.question)).toEqual([
			"second",
			"first",
		]);

		// out of bounds is a no-op (first slide is now at index 1, cannot go down)
		store.getState().moveSlide(firstId, 1);
		expect(store.getState().slides.map((slide) => slide.question)).toEqual([
			"second",
			"first",
		]);
	});

	test("reorderSlide lifts a slide by id and drops it at an absolute index", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const firstId = store.getState().slides[0].id;
		store.getState().updateSlide(firstId, { question: "a" });
		store.getState().addSlide("word-cloud");
		store
			.getState()
			.updateSlide(store.getState().slides[1].id, { question: "b" });
		store.getState().addSlide("open-text");
		store
			.getState()
			.updateSlide(store.getState().slides[2].id, { question: "c" });

		// Move the first slide to the end.
		store.getState().reorderSlide(firstId, 2);
		expect(store.getState().slides.map((slide) => slide.question)).toEqual([
			"b",
			"c",
			"a",
		]);

		// Out-of-range target clamps into the list; same-position move is a no-op.
		store.getState().reorderSlide(firstId, 99);
		expect(store.getState().slides.map((slide) => slide.question)).toEqual([
			"b",
			"c",
			"a",
		]);

		// Unknown id leaves the order untouched.
		store.getState().reorderSlide("missing", 0);
		expect(store.getState().slides.map((slide) => slide.question)).toEqual([
			"b",
			"c",
			"a",
		]);
	});
});

describe("editor slice — option mutations", () => {
	test("addOption / updateOption / removeOption operate on the slide by id", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;

		store.getState().addOption(slideId);
		expect(store.getState().slides[0].options).toHaveLength(3);

		const firstOptionId = store.getState().slides[0].options?.[0].id as string;
		store.getState().updateOption(slideId, firstOptionId, { text: "First" });
		expect(store.getState().slides[0].options?.[0].text).toBe("First");

		const lastOptionId = store.getState().slides[0].options?.at(-1)
			?.id as string;
		store.getState().removeOption(slideId, lastOptionId);
		expect(store.getState().slides[0].options).toHaveLength(2);
	});

	test("removeOption refuses to drop below two options", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;
		const optionId = store.getState().slides[0].options?.[0].id as string;
		store.getState().removeOption(slideId, optionId);
		expect(store.getState().slides[0].options).toHaveLength(2);
	});

	test("choice options carry a correctness flag on multiple-choice too (REQ013)", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;

		// A blank multiple-choice slide starts with markable — but unmarked — options.
		expect(
			store
				.getState()
				.slides[0].options?.every((option) => option.isCorrect === false),
		).toBe(true);

		store.getState().addOption(slideId);
		expect(store.getState().slides[0].options?.at(-1)?.isCorrect).toBe(false);

		const firstOptionId = store.getState().slides[0].options?.[0].id as string;
		store.getState().updateOption(slideId, firstOptionId, { isCorrect: true });
		expect(store.getState().slides[0].options?.[0].isCorrect).toBe(true);
	});
});

describe("editor slice — multiple-choice settings", () => {
	test("the selection limit is stored on the slide with the legacy flag in sync (REQ014)", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;

		// Unconfigured out of the box — the resolver treats that as single choice.
		expect(store.getState().slides[0].mcMaxSelections).toBeUndefined();
		expect(maxSelectionsFor(store.getState().slides[0])).toBe(1);

		store
			.getState()
			.updateSlide(slideId, { mcMaxSelections: 3, allowMultiple: true });
		expect(maxSelectionsFor(store.getState().slides[0])).toBe(3);
		expect(isMultiSelect(store.getState().slides[0])).toBe(true);

		store
			.getState()
			.updateSlide(slideId, { mcMaxSelections: 1, allowMultiple: false });
		expect(isMultiSelect(store.getState().slides[0])).toBe(false);
	});

	test("visualization and value display are plain slide settings (REQ010, REQ011)", () => {
		const store = createAppStore();
		store.getState().resetEditor();
		const slideId = store.getState().slides[0].id;

		store.getState().updateSlide(slideId, {
			mcDisplayStyle: "pie",
			mcValueDisplay: "percentage",
		});
		expect(store.getState().slides[0].mcDisplayStyle).toBe("pie");
		expect(store.getState().slides[0].mcValueDisplay).toBe("percentage");
	});
});
