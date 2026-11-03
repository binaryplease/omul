/**
 * Unit tests for the deck accessibility check (REQ132, slice 1).
 *
 * Every risk is asserted both ways — the slide that should be flagged is, and
 * the slide one field away from it is not — and contrast is asserted against the
 * colours a slide renders with rather than against its authored fields alone:
 * the same authored canvas passes on its own and fails under a picture's scrim.
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import {
	ACCESSIBILITY_MIN_CONTRAST,
	deckAccessibilityFindings,
	slideAccessibilityFindings,
} from "./DeckAccessibility";
import { newSlide } from "../store/editorDocument";
import type { DeckThemeSettings, Slide } from "../types";
import { BUILT_IN_DECK_THEME_IDS, CUSTOM_DECK_THEME_ID } from "../types";

const IMAGE_URL = "https://example.com/picture.jpg";

function slideOf(fields: Partial<Slide> = {}): Slide {
	return { id: "slide-1", type: "text", question: "Welcome", ...fields };
}

function risksOf(slide: Slide, deck: DeckThemeSettings | null = null) {
	return slideAccessibilityFindings(deck, slide, 0).map((finding) => finding.risk);
}

function contrastFindingOf(slide: Slide, deck: DeckThemeSettings | null = null) {
	return slideAccessibilityFindings(deck, slide, 0).find(
		(finding) => finding.category === "contrast",
	);
}

describe("contrast", () => {
	test("an untouched slide passes in every built-in theme, in both schemes", () => {
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			for (const type of ["text", "multiple-choice"] as const) {
				expect(contrastFindingOf(slideOf({ type }), { theme })).toBeUndefined();
			}
		}
	});

	test("authored words the slide's own canvas swallows are flagged on the text colour", () => {
		const finding = contrastFindingOf(
			slideOf({ backgroundColor: "#808080", textColor: "#777777", body: "Some words" }),
		);
		expect(finding?.risk).toBe("low-contrast");
		expect(finding?.field).toEqual({ scope: "slide", name: "textColor" });
		expect(finding?.contrast?.required).toBe(ACCESSIBILITY_MIN_CONTRAST.body);
		expect(finding?.contrast?.ratio).toBeLessThan(1.2);
		// A slide's own colours are the same in both schemes, so both fall short.
		expect(finding?.contrast?.schemes).toEqual(["dark", "light"]);
	});

	test("authored words far enough from their canvas pass", () => {
		expect(
			contrastFindingOf(slideOf({ backgroundColor: "#ffffff", textColor: "#111111" })),
		).toBeUndefined();
	});

	test("a content slide on a picture is judged against the scrim, not its canvas", () => {
		// A light canvas derives dark words, which read on the canvas itself…
		const onCanvas = slideOf({ backgroundColor: "#f5f5f5" });
		expect(contrastFindingOf(onCanvas)).toBeUndefined();
		// …but over a picture, in dark mode, the scrim is a darkening one.
		const finding = contrastFindingOf({ ...onCanvas, backgroundImage: IMAGE_URL });
		expect(finding?.contrast?.schemes).toContain("dark");
		expect(finding?.field).toEqual({ scope: "slide", name: "backgroundColor" });
	});

	test("an interactive slide on a picture keeps its answers on the canvas colours", () => {
		expect(
			contrastFindingOf(
				slideOf({
					type: "multiple-choice",
					backgroundColor: "#f5f5f5",
					backgroundImage: IMAGE_URL,
				}),
			),
		).toBeUndefined();
	});

	test("a leaderboard on a picture draws its words on the scrim, like a content slide", () => {
		const onCanvas = slideOf({
			type: "leaderboard",
			question: "Standings",
			backgroundColor: "#f5f5f5",
		});
		expect(contrastFindingOf(onCanvas)).toBeUndefined();
		const finding = contrastFindingOf({ ...onCanvas, backgroundImage: IMAGE_URL });
		expect(finding?.contrast?.schemes).toContain("dark");
		expect(finding?.field).toEqual({ scope: "slide", name: "backgroundColor" });
	});

	test("a heading-only slide is large text at 3:1, and body text or a Small heading lifts it to 4.5:1", () => {
		// #888888 on white is about 3.5:1 — large text passes, body text does not.
		const headingOnly = slideOf({
			type: "image",
			backgroundColor: "#ffffff",
			textColor: "#888888",
		});
		expect(contrastFindingOf(headingOnly)).toBeUndefined();
		expect(contrastFindingOf({ ...headingOnly, body: "A caption" })?.contrast?.required).toBe(
			ACCESSIBILITY_MIN_CONTRAST.body,
		);
		expect(contrastFindingOf({ ...headingOnly, textSize: "small" })?.contrast?.required).toBe(
			ACCESSIBILITY_MIN_CONTRAST.body,
		);
	});

	test("a deck brand's own words are flagged on the brand, in the scheme it authored", () => {
		const deck = {
			theme: CUSTOM_DECK_THEME_ID,
			themeBrand: { canvas: "#202020", text: "#404040" },
		};
		const finding = contrastFindingOf(slideOf(), deck);
		expect(finding?.field).toEqual({ scope: "deck", name: "themeBrand" });
		// The light variant's words are derived, so only the authored scheme fails.
		expect(finding?.contrast?.schemes).toEqual(["dark"]);
	});
});

describe("text size", () => {
	test("authored text set Small is flagged on textSize", () => {
		const [finding] = slideAccessibilityFindings(null, slideOf({ textSize: "small" }), 0);
		expect(finding).toMatchObject({
			category: "text-size",
			risk: "small-text",
			field: { scope: "slide", name: "textSize" },
		});
	});

	test("a blank join slide or leaderboard set Small still draws its default heading small", () => {
		for (const type of ["instruction", "leaderboard"] as const) {
			expect(risksOf(slideOf({ type, question: "", textSize: "small" }))).toEqual([
				"small-text",
			]);
		}
	});

	test("every other step passes, and so does Small with no text to draw", () => {
		for (const textSize of ["medium", "large", "x-large"] as const) {
			expect(risksOf(slideOf({ textSize }))).toEqual([]);
		}
		expect(risksOf(slideOf({ question: "", textSize: "small" }))).toEqual([
			"missing-heading",
		]);
	});
});

describe("structure", () => {
	test("an image with empty alt text is flagged on mediaAlt", () => {
		for (const type of ["image", "multiple-choice", "pin-image"] as const) {
			const finding = slideAccessibilityFindings(
				null,
				slideOf({ type, mediaUrl: IMAGE_URL, mediaAlt: "  " }),
				0,
			).find((candidate) => candidate.risk === "missing-alt");
			expect(finding?.category).toBe("structure");
			expect(finding?.field).toEqual({ scope: "slide", name: "mediaAlt" });
		}
	});

	test("an image with alt text, and a video or embed URL, pass", () => {
		expect(risksOf(slideOf({ type: "image", mediaUrl: IMAGE_URL, mediaAlt: "A map" }))).toEqual(
			[],
		);
		for (const type of ["video", "embed"] as const) {
			expect(risksOf(slideOf({ type, mediaUrl: IMAGE_URL }))).toEqual([]);
		}
	});

	test("a slide with no heading is flagged on question, but the join slide and the leaderboard have a default", () => {
		expect(risksOf(slideOf({ question: "   " }))).toEqual(["missing-heading"]);
		// The editor creates both with a blank heading; the room sees the default.
		expect(risksOf(newSlide("instruction"))).toEqual([]);
		expect(risksOf(newSlide("leaderboard"))).toEqual([]);
	});
});

describe("the deck", () => {
	test("every slide type is checked without throwing, and a tidy one reports nothing", () => {
		for (const type of SlideTypeEnum.options) {
			expect(risksOf({ id: "bare", type, question: "" })).toBeArray();
			expect(risksOf(slideOf({ type }))).toEqual([]);
		}
	});

	test("findings name their slide and come back in deck order", () => {
		const findings = deckAccessibilityFindings(null, [
			slideOf({ id: "first" }),
			slideOf({ id: "second", question: "" }),
			slideOf({ id: "third", textSize: "small", mediaUrl: IMAGE_URL }),
		]);
		expect(
			findings.map((finding) => [finding.slideIndex, finding.slideId, finding.risk]),
		).toEqual([
			[1, "second", "missing-heading"],
			[2, "third", "small-text"],
			[2, "third", "missing-alt"],
		]);
	});
});
