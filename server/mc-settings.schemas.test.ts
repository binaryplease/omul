/**
 * Unit tests for the Multiple Choice question-type settings added in
 * task/0012-multiple-choice-settings.
 *
 * Covers the schema surface and the shared resolvers (no DB, no network):
 *   - REQ010 — mcDisplayStyle enum (bars / donut / pie / dots)
 *   - REQ011 — mcValueDisplay enum (count / percentage / both)
 *   - REQ013 — isCorrect on choice options + slideHasCorrectAnswers()
 *   - REQ014 — mcMaxSelections + maxSelectionsFor() / isMultiSelect(),
 *              including the legacy `allowMultiple` fallback that keeps
 *              slides authored before this slice behaving as they did.
 */

import { describe, expect, test } from "bun:test";
import {
	isMultiSelect,
	maxSelectionsFor,
	SlideSchema,
	StoredPresentationSchema,
	slideHasCorrectAnswers,
} from "./schemas";

/** A minimal multiple-choice slide with two options. */
function choiceSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "mc",
		type: "multiple-choice",
		question: "Pick",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		],
		...overrides,
	});
}

describe("SlideSchema — multiple-choice settings defaults", () => {
	test("a slide authored before this slice keeps its old behaviour", () => {
		const slide = choiceSlide();
		// REQ010/REQ011: the previous rendering was a bar chart printing
		// "count (percentage)", so those are the defaults.
		expect(slide.mcDisplayStyle).toBe("bars");
		expect(slide.mcValueDisplay).toBe("both");
		// REQ014: unconfigured, so the legacy `allowMultiple` flag still decides.
		expect(slide.mcMaxSelections).toBe(null);
		expect(maxSelectionsFor(slide)).toBe(1);
		expect(isMultiSelect(slide)).toBe(false);
	});

	test("accepts every visualization type and rejects unknown ones (REQ010)", () => {
		for (const style of ["bars", "donut", "pie", "dots"]) {
			expect(choiceSlide({ mcDisplayStyle: style }).mcDisplayStyle).toBe(
				style as never,
			);
		}
		expect(
			SlideSchema.safeParse({
				id: "mc",
				type: "multiple-choice",
				question: "Q",
				mcDisplayStyle: "sunburst",
			}).success,
		).toBe(false);
	});

	test("accepts every value display and rejects unknown ones (REQ011)", () => {
		for (const display of ["count", "percentage", "both"]) {
			expect(choiceSlide({ mcValueDisplay: display }).mcValueDisplay).toBe(
				display as never,
			);
		}
		expect(
			SlideSchema.safeParse({
				id: "mc",
				type: "multiple-choice",
				question: "Q",
				mcValueDisplay: "ratio",
			}).success,
		).toBe(false);
	});

	test("mcMaxSelections accepts 0 (unlimited) through 20 (REQ014)", () => {
		for (const limit of [0, 1, 2, 5, 20]) {
			expect(choiceSlide({ mcMaxSelections: limit }).mcMaxSelections).toBe(
				limit,
			);
		}
	});

	test("mcMaxSelections rejects negatives, fractions and over-the-cap (REQ014)", () => {
		for (const bad of [-1, 1.5, 21]) {
			expect(
				SlideSchema.safeParse({
					id: "mc",
					type: "multiple-choice",
					question: "Q",
					mcMaxSelections: bad,
				}).success,
			).toBe(false);
		}
	});
});

describe("maxSelectionsFor / isMultiSelect (REQ014)", () => {
	test("an explicit limit wins over the legacy allowMultiple flag", () => {
		expect(
			maxSelectionsFor(
				choiceSlide({ mcMaxSelections: 3, allowMultiple: false }),
			),
		).toBe(3);
		expect(
			maxSelectionsFor(
				choiceSlide({ mcMaxSelections: 1, allowMultiple: true }),
			),
		).toBe(1);
	});

	test("an unconfigured slide falls back to allowMultiple", () => {
		expect(maxSelectionsFor(choiceSlide({ allowMultiple: true }))).toBe(0);
		expect(maxSelectionsFor(choiceSlide({ allowMultiple: false }))).toBe(1);
	});

	test("0 (unlimited) and n > 1 both count as multi-select", () => {
		expect(isMultiSelect(choiceSlide({ mcMaxSelections: 0 }))).toBe(true);
		expect(isMultiSelect(choiceSlide({ mcMaxSelections: 2 }))).toBe(true);
		expect(isMultiSelect(choiceSlide({ mcMaxSelections: 1 }))).toBe(false);
	});
});

describe("slideHasCorrectAnswers (REQ013)", () => {
	test("false until an option is actually marked correct", () => {
		expect(slideHasCorrectAnswers(choiceSlide())).toBe(false);
		expect(
			slideHasCorrectAnswers(
				choiceSlide({
					options: [
						{ id: "a", text: "A", isCorrect: false },
						{ id: "b", text: "B", isCorrect: false },
					],
				}),
			),
		).toBe(false);
	});

	test("true for one or several marked options on a plain choice slide", () => {
		expect(
			slideHasCorrectAnswers(
				choiceSlide({
					options: [
						{ id: "a", text: "A", isCorrect: true },
						{ id: "b", text: "B" },
					],
				}),
			),
		).toBe(true);
		expect(
			slideHasCorrectAnswers(
				choiceSlide({
					options: [
						{ id: "a", text: "A", isCorrect: true },
						{ id: "b", text: "B", isCorrect: true },
					],
				}),
			),
		).toBe(true);
	});
});

describe("StoredPresentationSchema — forward compatibility (ADR-0029)", () => {
	test("a document persisted before this slice re-parses with the new fields", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "Legacy deck",
			slides: [
				{
					id: "mc",
					type: "multiple-choice",
					question: "Pick",
					options: [{ id: "a", text: "A" }],
				},
			],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const slide = stored.slides[0];
		expect(slide.mcDisplayStyle).toBe("bars");
		expect(slide.mcValueDisplay).toBe("both");
		expect(slide.mcMaxSelections).toBe(null);
	});
});
