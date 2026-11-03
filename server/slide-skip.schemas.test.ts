/**
 * Unit tests for skipping a slide (REQ110) — the stored field and the one rule
 * every surface pages by (no DB, no network).
 *
 *   - a slide that never carried `skipped` reads as not skipped, so a deck
 *     authored before the field existed pages exactly as it did;
 *   - `steppedSlideIndex()` lands Next and Previous on the nearest slide that is
 *     not skipped, over a run of several, and shuts a direction — never wraps —
 *     when only skipped slides lie that way.
 *
 * Which surfaces page by it is `src/pages/PresenterPage.test.ts` and
 * `src/pages/ParticipantPage.test.ts`; the round-trip through the real app,
 * answers and all, is `slide-skip.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	SlideInputSchema,
	SlideSchema,
	StoredPresentationSchema,
	steppedSlideIndex,
	UpdatePresentationSchema,
} from "./schemas";

/** A deck of slides, `true` where the slide is skipped. */
function deck(...skipped: boolean[]) {
	return skipped.map((isSkipped) => ({ skipped: isSkipped }));
}

describe("the skipped field (REQ110)", () => {
	test("a stored slide with no skipped state reads as not skipped", () => {
		const slide = SlideSchema.parse({
			id: "s1",
			type: "multiple-choice",
			question: "Which?",
		});
		expect(slide.skipped).toBe(false);
	});

	test("a stored deck written before the field reads every slide as not skipped", () => {
		const stored = StoredPresentationSchema.safeParse({
			id: "p1",
			title: "Before REQ110",
			code: "123456",
			creatorTokenHash: "hash",
			slides: [
				{ id: "a", type: "word-cloud", question: "One word" },
				{ id: "b", type: "text", question: "Hello" },
			],
		});
		if (!stored.success) throw stored.error;
		expect(stored.data.slides.map((slide) => slide.skipped)).toEqual([
			false,
			false,
		]);
	});

	test("the deck update accepts and keeps it", () => {
		const update = UpdatePresentationSchema.parse({
			slides: [
				{ id: "a", type: "word-cloud", question: "One word", skipped: true },
				{ id: "b", type: "text", question: "Hello" },
			],
		});
		expect(update.slides?.map((slide) => slide.skipped)).toEqual([true, false]);
	});

	test("anything but a boolean is refused", () => {
		const parsed = SlideInputSchema.safeParse({
			id: "a",
			type: "text",
			question: "Hello",
			skipped: "yes",
		});
		expect(parsed.success).toBe(false);
	});
});

describe("steppedSlideIndex (REQ110)", () => {
	test("with nothing skipped it is plain plus and minus one", () => {
		const slides = deck(false, false, false);
		expect(steppedSlideIndex(slides, 0, 1)).toBe(1);
		expect(steppedSlideIndex(slides, 1, 1)).toBe(2);
		expect(steppedSlideIndex(slides, 2, -1)).toBe(1);
	});

	test("the deck's ends shut their direction rather than wrapping", () => {
		const slides = deck(false, false, false);
		expect(steppedSlideIndex(slides, 0, -1)).toBeNull();
		expect(steppedSlideIndex(slides, 2, 1)).toBeNull();
	});

	test("a single skipped slide is stepped over both ways", () => {
		const slides = deck(false, true, false);
		expect(steppedSlideIndex(slides, 0, 1)).toBe(2);
		expect(steppedSlideIndex(slides, 2, -1)).toBe(0);
	});

	test("a run of several skipped slides is stepped over in one press", () => {
		const slides = deck(false, true, true, true, false);
		expect(steppedSlideIndex(slides, 0, 1)).toBe(4);
		expect(steppedSlideIndex(slides, 4, -1)).toBe(0);
	});

	test("a skipped last slide shuts Next on the one before it", () => {
		const slides = deck(false, false, true);
		expect(steppedSlideIndex(slides, 1, 1)).toBeNull();
		expect(steppedSlideIndex(slides, 0, 1)).toBe(1);
	});

	test("a skipped first slide shuts Previous on the one after it", () => {
		const slides = deck(true, false, false);
		expect(steppedSlideIndex(slides, 1, -1)).toBeNull();
	});

	test("standing on a skipped slide, opened directly, steps off it either way", () => {
		const slides = deck(false, true, false);
		expect(steppedSlideIndex(slides, 1, 1)).toBe(2);
		expect(steppedSlideIndex(slides, 1, -1)).toBe(0);
	});

	test("from -1 it names the first slide that is not skipped", () => {
		expect(steppedSlideIndex(deck(true, true, false), -1, 1)).toBe(2);
		expect(steppedSlideIndex(deck(false), -1, 1)).toBe(0);
		expect(steppedSlideIndex(deck(true, true), -1, 1)).toBeNull();
	});

	test("a slide missing the field is not skipped", () => {
		expect(steppedSlideIndex([{}, {}, {}], 0, 1)).toBe(1);
	});
});
