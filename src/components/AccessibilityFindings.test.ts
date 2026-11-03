/**
 * Unit tests for the deck accessibility check in the editor (REQ132, slice 2).
 *
 * Four halves:
 *
 *   - **The per-slide list** — the check's findings, split by slide, are what
 *     the strip and the rail draw; a clean slide is absent rather than empty.
 *   - **Where a finding goes** — a slide field selects its slide, a theme field
 *     selects the deck's settings with the finding's slide kept on the canvas,
 *     and the heading also puts the canvas back on its question view.
 *   - **What is there to go to** — every slide field the check can name is
 *     marked on a control the editor draws, rendered to static markup with
 *     React's own server renderer, so a finding never points at nothing.
 *   - **Bringing the field up** — against a minimal element tree: a marked
 *     disclosure is opened and the innermost marked control is focused.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ACCESSIBILITY_FIELD_ATTRIBUTE,
	AccessibilityFindingsStrip,
	accessibilityFieldTarget,
	accessibilityFindingDestination,
	accessibilityFindingsBySlide,
	revealAccessibilityField,
} from "./AccessibilityFindings";
import type { SlideAccessibilityFinding } from "./DeckAccessibility";
import { deckAccessibilityFindings } from "./DeckAccessibility";
import { SlideQuestion } from "./SlideCanvasFields";
import { SlideEditor } from "./SlideEditor";
import type { Slide } from "../types";
import { CUSTOM_DECK_THEME_ID } from "../types";

const IMAGE_URL = "https://example.com/picture.jpg";

const CLEAN: Slide = { id: "clean", type: "text", question: "Welcome" };
const UNREADABLE: Slide = {
	id: "unreadable",
	type: "text",
	question: "",
	body: "Some words",
	backgroundColor: "#808080",
	textColor: "#777777",
	textSize: "small",
};
const UNDESCRIBED: Slide = {
	id: "undescribed",
	type: "multiple-choice",
	question: "Pick one",
	mediaUrl: IMAGE_URL,
	mediaAlt: "",
	options: [
		{ id: "first", text: "One" },
		{ id: "second", text: "Two" },
	],
};

function findingOf(
	slide: Slide,
	risk: SlideAccessibilityFinding["risk"],
	slides: Slide[] = [slide],
) {
	const finding = deckAccessibilityFindings(null, slides).find(
		(candidate) => candidate.slideId === slide.id && candidate.risk === risk,
	);
	if (!finding) throw new Error(`no ${risk} finding on ${slide.id}`);
	return finding;
}

describe("the per-slide list", () => {
	test("splits the check's findings by slide, in the check's order", () => {
		const findings = deckAccessibilityFindings(null, [CLEAN, UNREADABLE, UNDESCRIBED]);
		const bySlide = accessibilityFindingsBySlide(findings);
		expect(bySlide.has("clean")).toBe(false);
		expect(bySlide.get("unreadable")?.map((finding) => finding.risk)).toEqual([
			"low-contrast",
			"small-text",
			"missing-heading",
		]);
		expect(bySlide.get("undescribed")?.map((finding) => finding.risk)).toEqual([
			"missing-alt",
		]);
		// Nothing is added or dropped on the way: the list is the check's.
		const total = [...bySlide.values()].reduce((sum, list) => sum + list.length, 0);
		expect(total).toBe(findings.length);
	});

	test("the strip draws each finding's message with a control named for its field", () => {
		const findings = deckAccessibilityFindings(null, [UNREADABLE]);
		const markup = renderToStaticMarkup(
			createElement(AccessibilityFindingsStrip, {
				slide: UNREADABLE,
				findings,
				deckFindingCount: findings.length + 2,
				onGoToFinding: () => {},
			}),
		);
		for (const finding of findings) {
			expect(markup).toContain(finding.message.replaceAll("'", "&#x27;"));
		}
		expect(markup).toContain('aria-label="Go to text colour"');
		expect(markup).toContain('aria-label="Go to text size"');
		expect(markup).toContain('aria-label="Go to heading"');
		expect(markup).toContain("3 accessibility findings on this slide");
		expect(markup).toContain("2 on other slides");
	});

	test("a slide with no findings says so in one line", () => {
		const markup = renderToStaticMarkup(
			createElement(AccessibilityFindingsStrip, {
				slide: CLEAN,
				findings: [],
				deckFindingCount: 0,
				onGoToFinding: () => {},
			}),
		);
		expect(markup).toContain("No accessibility risks found on this slide.");
		expect(markup).toContain("None on other slides.");
		expect(markup).not.toContain("<button");
	});
});

describe("where a finding goes", () => {
	const slides = [CLEAN, UNREADABLE, UNDESCRIBED];

	test("a slide's own field selects that slide and targets the field", () => {
		expect(
			accessibilityFindingDestination(findingOf(UNREADABLE, "low-contrast", slides)),
		).toEqual({
			selection: 1,
			canvasSlideIndex: 1,
			target: "slide:textColor",
			showsQuestion: false,
		});
		expect(
			accessibilityFindingDestination(findingOf(UNDESCRIBED, "missing-alt", slides)),
		).toEqual({
			selection: 2,
			canvasSlideIndex: 2,
			target: "slide:mediaAlt",
			showsQuestion: false,
		});
	});

	test("a missing heading goes to the canvas, on its question view", () => {
		const destination = accessibilityFindingDestination(
			findingOf(UNREADABLE, "missing-heading", slides),
		);
		expect(destination.selection).toBe(1);
		expect(destination.target).toBe("slide:question");
		expect(destination.showsQuestion).toBe(true);
	});

	test("the deck's theme goes to the deck's settings, keeping the slide on the canvas", () => {
		const unreadableBrand = {
			theme: CUSTOM_DECK_THEME_ID,
			themeBrand: { canvas: "#808080", text: "#777777" },
		};
		const finding = deckAccessibilityFindings(unreadableBrand, [CLEAN, CLEAN]).find(
			(candidate) => candidate.slideIndex === 1,
		);
		expect(finding?.field).toEqual({ scope: "deck", name: "themeBrand" });
		expect(accessibilityFindingDestination(finding as SlideAccessibilityFinding)).toEqual({
			selection: "settings",
			canvasSlideIndex: 1,
			target: "deck:themeBrand",
			showsQuestion: false,
		});
	});
});

describe("what is there to go to", () => {
	function markerOf(target: string) {
		return `${ACCESSIBILITY_FIELD_ATTRIBUTE}="${target}"`;
	}

	function settingsColumnOf(slide: Slide) {
		return renderToStaticMarkup(
			createElement(SlideEditor, {
				slide,
				index: 0,
				total: 1,
				canRemove: false,
				onUpdate: () => {},
				onMove: () => {},
				onRemove: () => {},
				onPreviewResults: () => {},
				deckResultsVisibility: "instant",
				deckMode: "presenter",
				deckQuizCount: 0,
			}),
		);
	}

	test("the settings column marks every slide field a finding can name", () => {
		const column = settingsColumnOf(UNREADABLE);
		for (const name of ["textColor", "backgroundColor", "backgroundImage", "textSize"]) {
			expect(column).toContain(markerOf(`slide:${name}`));
		}
	});

	test("alt text is marked on every slide type that draws an image", () => {
		const imageSlides: Slide[] = [
			UNDESCRIBED,
			{ id: "text", type: "text", question: "Hi", mediaUrl: IMAGE_URL },
			{ id: "image", type: "image", question: "", mediaUrl: IMAGE_URL },
			{ id: "pin", type: "pin-image", question: "Where?", mediaUrl: IMAGE_URL },
		];
		for (const slide of imageSlides) {
			expect(findingOf(slide, "missing-alt").field).toEqual({
				scope: "slide",
				name: "mediaAlt",
			});
			expect(settingsColumnOf(slide)).toContain(markerOf("slide:mediaAlt"));
		}
	});

	test("the heading is marked on the canvas", () => {
		const finding = findingOf(UNREADABLE, "missing-heading");
		// The heading field the canvas draws for every slide type (REQ153).
		const canvas = renderToStaticMarkup(
			createElement(SlideQuestion, {
				slide: UNREADABLE,
				editing: {
					onUpdate: () => {},
					onAddOption: () => {},
					onUpdateOption: () => {},
					onRemoveOption: () => {},
				},
			}),
		);
		expect(canvas).toContain(
			markerOf(accessibilityFieldTarget(finding.field as NonNullable<typeof finding.field>)),
		);
	});
});

describe("bringing the field up", () => {
	type FakeElement = {
		attributes: Record<string, string>;
		children: FakeElement[];
		focusable: boolean;
		clicks: number;
		focused: boolean;
		onClick?: () => void;
	};

	function element(
		attributes: Record<string, string>,
		children: FakeElement[] = [],
		focusable = false,
	): FakeElement {
		return { attributes, children, focusable, clicks: 0, focused: false };
	}

	function descendants(node: FakeElement): FakeElement[] {
		return node.children.flatMap((child) => [child, ...descendants(child)]);
	}

	// Just enough of the DOM for the routine: attribute selectors, the focusable
	// selector, the first child, a click and a focus.
	function asDom(node: FakeElement): HTMLElement {
		const matches = (candidate: FakeElement, selector: string) => {
			const attribute = selector.match(/^\[([\w-]+)="([^"]+)"\]$/);
			if (attribute) return candidate.attributes[attribute[1]] === attribute[2];
			return candidate.focusable;
		};
		return {
			matches: (selector: string) => matches(node, selector),
			querySelector: (selector: string) => {
				const found = descendants(node).find((candidate) => matches(candidate, selector));
				return found ? asDom(found) : null;
			},
			querySelectorAll: (selector: string) =>
				descendants(node)
					.filter((candidate) => matches(candidate, selector))
					.map(asDom),
			get firstElementChild() {
				return node.children[0] ? asDom(node.children[0]) : null;
			},
			getAttribute: (name: string) => node.attributes[name] ?? null,
			click: () => {
				node.clicks += 1;
				node.onClick?.();
			},
			scrollIntoView: () => {},
			focus: () => {
				node.focused = true;
			},
		} as unknown as HTMLElement;
	}

	const marker = { [ACCESSIBILITY_FIELD_ATTRIBUTE]: "slide:mediaAlt" };

	test("opens the marked disclosure and focuses the marked field inside it", () => {
		const altInput = element({}, [], true);
		const toggle = element({ "aria-expanded": "false" }, [], true);
		const wrapper = element(marker, [toggle]);
		// Opening the disclosure draws the alt text field, itself marked.
		toggle.onClick = () => {
			toggle.attributes["aria-expanded"] = "true";
			wrapper.children.push(element(marker, [altInput]));
		};
		const root = element({}, [wrapper]);

		expect(revealAccessibilityField(asDom(root), "slide:mediaAlt", (run) => run())).toBe(
			true,
		);
		expect(toggle.clicks).toBe(1);
		expect(altInput.focused).toBe(true);
		expect(toggle.focused).toBe(false);
	});

	test("focuses an open field without clicking anything", () => {
		const input = element({}, [], true);
		const root = element({}, [element(marker, [element({}, [input])])]);
		revealAccessibilityField(asDom(root), "slide:mediaAlt", (run) => run());
		expect(input.focused).toBe(true);
		expect(input.clicks).toBe(0);
	});

	test("reports a field the editor is not drawing", () => {
		const root = element({}, [element({ [ACCESSIBILITY_FIELD_ATTRIBUTE]: "slide:textColor" })]);
		expect(revealAccessibilityField(asDom(root), "slide:mediaAlt", (run) => run())).toBe(
			false,
		);
	});
});
