import type { Rgb } from "./color";
import { BLACK, contrastRatio, parseHexColor, WHITE } from "./color";
import { deckThemeAppearance } from "./DeckTheme";
import { SCRIM_TONES, slideAppearanceStyle } from "./SlideAppearance";
import type { DeckThemeSettings, Slide } from "../types";
import {
	deckBrandFor,
	isContentSlideType,
	slideAppearanceFor,
	slideTextSizeFor,
} from "../types";

// ── A deck's accessibility risks, slide by slide (REQ132) ─────────────
//
// A pure check over a deck: what on each slide a reader may not be able to
// read or follow, as plain findings an editor can act on. No DOM, no React and
// no store, so the same deck always yields the same findings and a test can
// assert on them.
//
// Three categories, as the requirement names them:
//
//   - **contrast** — the slide's words against what they are actually drawn
//     on, in both colour schemes. The colours are the ones the slide renders
//     with: the deck theme's tokens under whatever `slideAppearanceStyle` writes
//     over them, and — on a content slide with a background image — the worst
//     backdrop that image's scrim can produce (`SCRIM_TONES[…].against`). The
//     thresholds are WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text.
//   - **text-size** — authored text set at the `small` step.
//   - **structure** — an image with no alt text, a slide with no heading.
//
// The floors `DeckTheme.tsx` and `SlideAppearance.tsx` apply when they render
// are not changed here; this module reports what they leave standing, which is
// mostly a colour an organizer authored.

/** The WCAG 2.2 AA contrast minimums, for body text and for large text. */
export const ACCESSIBILITY_MIN_CONTRAST = { body: 4.5, large: 3 } as const;

export type SlideAccessibilityCategory = "contrast" | "text-size" | "structure";

export type SlideAccessibilityRisk =
	| "low-contrast"
	| "small-text"
	| "missing-alt"
	| "missing-heading";

/** The authored field an editor would change to clear a finding. */
export type SlideAccessibilityField =
	| {
			scope: "slide";
			name:
				| "textColor"
				| "backgroundColor"
				| "backgroundImage"
				| "textSize"
				| "mediaAlt"
				| "question";
	  }
	| { scope: "deck"; name: "theme" | "themeBrand" };

export type SlideContrastMeasure = {
	/** The lowest ratio the words reach, rounded down to two decimals. */
	ratio: number;
	/** The minimum they are held to — body or large text. */
	required: number;
	/** The colour schemes the words fall short in. */
	schemes: ("dark" | "light")[];
};

export type SlideAccessibilityFinding = {
	slideId: string;
	/** Zero-based position in the deck. */
	slideIndex: number;
	category: SlideAccessibilityCategory;
	risk: SlideAccessibilityRisk;
	/** What is at risk, in the organizer's words. */
	message: string;
	field: SlideAccessibilityField | null;
	/** The measurement behind a contrast finding; `null` for every other risk. */
	contrast: SlideContrastMeasure | null;
};

const SCHEMES = ["dark", "light"] as const;

/** Every slide's findings, in deck order. */
export function deckAccessibilityFindings(
	deck: DeckThemeSettings | null,
	slides: readonly Slide[],
): SlideAccessibilityFinding[] {
	return slides.flatMap((slide, slideIndex) =>
		slideAccessibilityFindings(deck, slide, slideIndex),
	);
}

/** One slide's findings. A slide with nothing to report returns `[]`. */
export function slideAccessibilityFindings(
	deck: DeckThemeSettings | null,
	slide: Slide,
	slideIndex: number,
): SlideAccessibilityFinding[] {
	const finding = (
		fields: Omit<SlideAccessibilityFinding, "slideId" | "slideIndex" | "contrast"> &
			Partial<Pick<SlideAccessibilityFinding, "contrast">>,
	): SlideAccessibilityFinding => ({
		slideId: slide.id,
		slideIndex,
		contrast: null,
		...fields,
	});
	const findings: SlideAccessibilityFinding[] = [];

	const contrast = slideContrastMeasure(deck, slide);
	if (contrast) {
		findings.push(
			finding({
				category: "contrast",
				risk: "low-contrast",
				message: `The words on this slide reach ${contrast.ratio.toFixed(2)}:1 against what is behind them in ${contrast.schemes.join(" and ")} mode; ${contrast.required === ACCESSIBILITY_MIN_CONTRAST.body ? "body" : "large"} text needs ${contrast.required}:1.`,
				field: contrastField(deck, slide),
				contrast,
			}),
		);
	}

	if (slideTextSizeFor(slide) === "small" && slideDrawsText(slide)) {
		findings.push(
			finding({
				category: "text-size",
				risk: "small-text",
				message:
					"This slide's text is set Small, which is hard to read on a phone at arm's length or from the back of the room.",
				field: { scope: "slide", name: "textSize" },
			}),
		);
	}

	if (slideShowsImage(slide) && (slide.mediaAlt ?? "").trim() === "") {
		findings.push(
			finding({
				category: "structure",
				risk: "missing-alt",
				message:
					"This slide's image has no alt text, so a screen reader announces nothing for it.",
				field: { scope: "slide", name: "mediaAlt" },
			}),
		);
	}

	if (!slideHasDefaultHeading(slide) && (slide.question ?? "").trim() === "") {
		findings.push(
			finding({
				category: "structure",
				risk: "missing-heading",
				message:
					"This slide has no heading, so nothing tells a screen-reader user what it is about.",
				field: { scope: "slide", name: "question" },
			}),
		);
	}

	return findings;
}

/**
 * The words' contrast against what they sit on, when it falls short in either
 * scheme — `null` when it clears the minimum in both.
 *
 * Without a picture the words sit on the slide's canvas. With one, a content
 * slide or a leaderboard draws its words straight onto the scrim, so they are
 * judged against the worst backdrop that scrim can produce. A question slide's
 * heading wears the scrim's own paired colour (`slide-title-overlay`), which
 * `slideScrimFor` already holds to AA, and its answers sit on cards in the
 * canvas colours — so it is judged against the canvas either way.
 */
export function slideContrastMeasure(
	deck: DeckThemeSettings | null,
	slide: Slide,
): SlideContrastMeasure | null {
	const required = slideContrastMinimum(slide);
	const onScrim =
		slideWordsSitOnScrim(slide) &&
		slideAppearanceFor(slide).backgroundImage !== "";
	let lowest = Number.POSITIVE_INFINITY;
	const schemes: ("dark" | "light")[] = [];
	for (const scheme of SCHEMES) {
		const rendered = renderedSlideColors(deck, slide, scheme);
		const ratio = contrastRatio(
			rendered.text,
			onScrim ? rendered.scrimBackdrop : rendered.canvas,
		);
		if (ratio < required) {
			schemes.push(scheme);
			lowest = Math.min(lowest, ratio);
		}
	}
	if (schemes.length === 0) return null;
	return { ratio: Math.floor(lowest * 100) / 100, required, schemes };
}

/** The colours one slide is drawn in, in one scheme. */
export function renderedSlideColors(
	deck: DeckThemeSettings | null,
	slide: Slide,
	scheme: "dark" | "light",
): { canvas: Rgb; text: Rgb; scrimBackdrop: Rgb } {
	const tokens: Record<string, unknown> = {
		...deckThemeAppearance(deck)[scheme].tokens,
		...slideAppearanceStyle(deck, slide, scheme),
	};
	const token = (name: string, fallback: Rgb) =>
		parseHexColor(String(tokens[name] ?? "")) ?? fallback;
	const scrim =
		tokens["--slide-scrim"] === SCRIM_TONES.dark.scrim
			? SCRIM_TONES.dark
			: SCRIM_TONES.light;
	return {
		canvas: token("--color-surface", BLACK),
		text: token("--color-text", WHITE),
		scrimBackdrop: scrim.against,
	};
}

/**
 * Body text's minimum whenever the slide draws words at body size in its text
 * colour — answers, names, a body — and large text's when its heading is all it
 * carries. A heading set Small is no longer large on a phone, so it is held to
 * the body minimum too.
 */
function slideContrastMinimum(slide: Slide): number {
	const carriesBody =
		!isContentSlideType(slide.type) ||
		slide.type === "instruction" ||
		(slide.body ?? "").trim() !== "";
	return carriesBody || slideTextSizeFor(slide) === "small"
		? ACCESSIBILITY_MIN_CONTRAST.body
		: ACCESSIBILITY_MIN_CONTRAST.large;
}

/**
 * Which authored colour decides the words: the slide's own text colour, then
 * its canvas (which derives the words), then the picture they sit on, and
 * otherwise the deck's theme.
 */
function contrastField(
	deck: DeckThemeSettings | null,
	slide: Slide,
): SlideAccessibilityField {
	const appearance = slideAppearanceFor(slide);
	if (appearance.textColor !== "") return { scope: "slide", name: "textColor" };
	if (appearance.backgroundColor !== "") {
		return { scope: "slide", name: "backgroundColor" };
	}
	if (appearance.backgroundImage !== "" && slideWordsSitOnScrim(slide)) {
		return { scope: "slide", name: "backgroundImage" };
	}
	return deckBrandFor(deck ?? {})
		? { scope: "deck", name: "themeBrand" }
		: { scope: "deck", name: "theme" };
}

/**
 * Whether a slide's words sit on a background image's scrim rather than in the
 * scrim's paired colour: every content slide, and a leaderboard, whose heading
 * and translucent rows are drawn in the theme's colours over the picture.
 */
function slideWordsSitOnScrim(slide: Slide): boolean {
	return isContentSlideType(slide.type) || slide.type === "leaderboard";
}

/** Whether the slide draws any text at its size step, authored or default. */
function slideDrawsText(slide: Slide): boolean {
	return (
		slideHasDefaultHeading(slide) ||
		(slide.question ?? "").trim() !== "" ||
		(slide.body ?? "").trim() !== ""
	);
}

/**
 * Whether `mediaUrl` is drawn as an image: the illustration every question
 * carries, a pin slide's canvas, and a text or image slide's picture. A video
 * or embed slide's URL is a player, and the other content slides draw none.
 */
function slideShowsImage(slide: Slide): boolean {
	if ((slide.mediaUrl ?? "").trim() === "") return false;
	return (
		!isContentSlideType(slide.type) ||
		slide.type === "text" ||
		slide.type === "image"
	);
}

/**
 * The join slide and the leaderboard draw a default heading when none was
 * written ("Join the presentation", "Leaderboard"), so a blank one is no gap.
 */
function slideHasDefaultHeading(slide: Slide): boolean {
	return slide.type === "instruction" || slide.type === "leaderboard";
}
