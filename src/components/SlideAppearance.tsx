import type { CSSProperties, ReactNode } from "react";
import type { Rgb } from "./color";
import {
	BLACK,
	contrastRatio,
	formatHexColor,
	hslToRgb,
	mixColors,
	parseHexColor,
	relativeLuminance,
	rgbaColor,
	rgbToHsl,
	schemeOfCanvas,
	WHITE,
} from "./color";
import {
	deckThemeAppearance,
	derivedTextOn,
	surfaceRampTokens,
	textRampTokens,
} from "./DeckTheme";
import type { ChoiceOption } from "./EditorControls";
import { useTheme } from "./ui/Theme";
import type {
	DeckThemeSettings,
	SlideAppearanceSettings,
	SlideLayout,
	SlidePlacement,
} from "../types";
import { slideAppearanceFor } from "../types";

// ── A slide's own appearance, over the deck's theme ───────────────────
//     (REQ087, REQ070, REQ071, REQ019)
//
// The deck's theme (`DeckTheme.tsx`) decides what the room is looking at. This
// module is the layer on top of it: what *one slide* says about its own
// placement, its canvas, its picture and its colours. The schema half — what may
// be stored and what an unauthored field means — is the per-slide appearance
// block in `server/schemas.ts`; everything here is the arithmetic that turns
// those four fields into pixels.
//
// One descriptor, one wrapper, one guard (ADR-0026):
//
//   - `SLIDE_PLACEMENT_CLASSES` is the single catalog of what a placement means
//     in layout terms, so a heading, its media and the answers under it move
//     together and every surface moves them the same way.
//   - `<SlideAppearanceScope deck= slide=>` is the one place a slide's colours
//     reach the DOM. Like `<DeckThemeScope/>` it writes the *existing* token
//     vocabulary — `--color-surface`, `--color-text`, `--color-poll-n` — so a
//     result bar, a card border and a muted caption repaint themselves with no
//     per-surface work, and it is `display: contents`, so wrapping a screen in
//     it cannot move anything.
//   - `slideAppearanceFor()` (in the schema, beside the fields) is the guard:
//     every value arrives resolved, and a colour that was not a colour or a URL
//     no browser should be pointed at has already become "the theme's".
//
// Three things worth stating, because they are what make this a *layer*:
//
// **Unauthored writes nothing.** A slide that overrode nothing produces exactly
// the deck theme's own tokens, because it produces no tokens at all. That is not
// an optimization: it is what "layered over the theme's defaults rather than
// replacing them" means, and it is why a deck re-themed tomorrow re-themes every
// slide that did not disagree.
//
// **What a colour implies is derived, not authored — and only what it implies.**
// An organizer who darkens one slide's canvas has not also authored that slide's
// borders, its raised cards or its words; those follow from the canvas, through
// the very functions the deck's own brand derivation uses (`surfaceRampTokens`,
// `textRampTokens`), so the two layers cannot come to disagree about what a
// raised surface is. The converse binds just as hard: a slide that recoloured
// only its *words* writes only the words, because the surfaces follow from a
// canvas it never touched — and a built-in theme's neutrals are hand-authored,
// so re-deriving them would swap a tuned value for an approximation of itself.
//
// **A derived caption is never quieter than it can be read.** The muted and dim
// steps are walked back towards the words until they clear
// `SLIDE_TEXT_MIN_CONTRAST` against the canvas they sit on: the mix weights are
// calibrated for a canvas and its words being far apart, which is true of a deck
// brand by construction and is exactly what a slide may break.
//
// **The picture never wins over the words.** A background image is under a
// scrim whose tone is chosen *against the text that sits on it*, and the
// contrast is checked against the worst backdrop that translucent scrim can
// produce over an unknown picture rather than against the tone itself (REQ071).
// An authored text colour is honoured on top of an image only when it passes
// that check; when it does not, legibility wins and the scrim's own pairing
// stands.

/** How a placement reads as layout, on the three axes a surface composes. */
export type SlidePlacementClasses = {
	/** Text alignment for the slide's authored words. */
	text: string;
	/** Cross-axis alignment for the column the slide is stacked in. */
	items: string;
	/** Which margin a centred-by-default media block gives up. */
	media: string;
};

/**
 * What each placement means in layout terms (REQ087) — the single catalog, so a
 * placement added to the schema's enum reaches every surface by being here
 * rather than by being remembered in five files.
 */
export const SLIDE_PLACEMENT_CLASSES: Record<
	SlidePlacement,
	SlidePlacementClasses
> = {
	center: { text: "text-center", items: "items-center", media: "mx-auto" },
	left: { text: "text-left", items: "items-start", media: "mr-auto" },
	right: { text: "text-right", items: "items-end", media: "ml-auto" },
};

/**
 * How this slide is laid out, as classes a surface composes (REQ087).
 *
 * The read site every renderer uses, so "which way does this slide read?" is
 * answered once — off the resolver, never off the field.
 */
export function slidePlacementClasses(
	slide: SlideAppearanceSettings,
): SlidePlacementClasses {
	return SLIDE_PLACEMENT_CLASSES[slideAppearanceFor(slide).placement];
}

/** The layouts as the editor offers them (REQ087) — one descriptor, as above. */
export function slideLayoutOptions(): ChoiceOption<SlideLayout>[] {
	return [
		{
			value: "inherit",
			label: "Theme default",
			description: "Lay this slide out the way the deck's theme does.",
		},
		{
			value: "center",
			label: "Centred",
			description: "Heading, media and answers stacked down the middle.",
		},
		{
			value: "left",
			label: "Left",
			description: "Everything aligned to the leading edge.",
		},
		{
			value: "right",
			label: "Right",
			description: "Everything aligned to the trailing edge.",
		},
	];
}

/** How many series a chart is drawn from — the poll ramp `index.css` declares. */
const SLIDE_CHART_SERIES = 8;

/** Where a derived series is held, so eight bars stay eight readable bars. */
const CHART_MIN_SATURATION = 0.45;
const CHART_LIGHTNESS_RANGE = { low: 0.42, high: 0.72 } as const;

/**
 * The eight colours a slide's charts are drawn from, from the one colour the
 * organizer authored (REQ019).
 *
 * The seed is series one, verbatim — a slide asked to be "the green one" is
 * green where it matters most. The other seven step round the hue wheel at the
 * seed's own saturation and lightness (held inside a band, so a seed that is
 * nearly black or nearly white still yields a chart), because a categorical
 * scale has to be *told apart* first and be on-brand second: eight tints of one
 * hue is a chart nobody can read a legend against.
 */
export function slideChartRamp(seed: Rgb): string[] {
	const base = rgbToHsl(seed);
	const saturation = Math.max(base.saturation, CHART_MIN_SATURATION);
	const lightness = Math.min(
		CHART_LIGHTNESS_RANGE.high,
		Math.max(CHART_LIGHTNESS_RANGE.low, base.lightness),
	);
	return Array.from({ length: SLIDE_CHART_SERIES }, (_unused, series) =>
		series === 0
			? formatHexColor(seed)
			: formatHexColor(
					hslToRgb({
						hue: (base.hue + series / SLIDE_CHART_SERIES) % 1,
						saturation,
						lightness,
					}),
				),
	);
}

/**
 * The floor the two quieter text steps are held to against the canvas they sit
 * on (REQ019).
 *
 * A muted caption is body copy, so it is held to WCAG AA's 4.5; a dim label is
 * the quietest thing on a slide — a counter, a placeholder, a slide number — and
 * is held to 3, AA's threshold for large text and UI. Both are floors on *this
 * layer's derivation* and say nothing about the built-in themes' own ramps,
 * which are hand-authored and not produced by this function.
 */
export const SLIDE_TEXT_MIN_CONTRAST = { muted: 4.5, dim: 3 } as const;

/** The scrim over a background image, and the words that sit on it (REQ071). */
export type SlideScrim = {
	/** The `background` of the layer painted over the picture. */
	scrim: string;
	/** The colour the slide's heading is drawn in while it sits on that layer. */
	text: string;
	/** The shadow that lifts those words off whatever the picture is doing. */
	shadow: string;
};

/**
 * How strong the scrim is where it is *weakest* — the top of its gradient — and
 * where it is strongest. The alphas the app has always drawn; named because the
 * top one is what the legibility check below has to reason about.
 */
const SCRIM_TOP_ALPHA = 0.7;
const SCRIM_BOTTOM_ALPHA = { dark: 0.78, light: 0.82 } as const;

function scrimGradient(tone: Rgb, bottomAlpha: number): string {
	return `linear-gradient(180deg, ${rgbaColor(tone, SCRIM_TOP_ALPHA)} 0%, ${rgbaColor(tone, bottomAlpha)} 100%)`;
}

/**
 * The two words-on-a-picture pairings, and they are the ones this app has always
 * drawn: a darkening scrim under light words, a whitening one under dark words.
 * The gradients are composed from the alphas above rather than written out, so
 * the number the check reasons about and the number the browser paints cannot
 * drift apart.
 *
 * `against` is **the worst backdrop this tone can produce**, not the tone itself:
 * the scrim is translucent, so what a word actually sits on is the scrim
 * composited over an unknown picture. At its weakest point that is
 * `SCRIM_TOP_ALPHA` of the tone over the most hostile image there is — a white
 * one under the darkening scrim, a black one under the whitening scrim. Checking
 * against the pure tone would compute a contrast no reader is ever guaranteed.
 */
export const SCRIM_TONES = {
	dark: {
		scrim: scrimGradient(BLACK, SCRIM_BOTTOM_ALPHA.dark),
		text: "#ffffff",
		shadow: "0 1px 3px rgba(0, 0, 0, 0.65)",
		against: mixColors(WHITE, BLACK, SCRIM_TOP_ALPHA),
	},
	light: {
		scrim: scrimGradient(WHITE, SCRIM_BOTTOM_ALPHA.light),
		text: "#09090b",
		shadow: "0 1px 3px rgba(255, 255, 255, 0.65)",
		against: mixColors(BLACK, WHITE, SCRIM_TOP_ALPHA),
	},
} as const;

/** The contrast a word on a picture is held to — WCAG AA for body text. */
export const SCRIM_MIN_CONTRAST = 4.5;

/** Above this luminance a colour is "light words", which want a dark scrim. */
const LIGHT_TEXT_LUMINANCE = 0.4;

/**
 * How a slide's background image is made safe to read on top of (REQ071).
 *
 * The scrim's tone follows the *words*, not the viewer's colour scheme: light
 * words need something dark behind them whichever mode the phone is in, and a
 * slide that authored its text colour has changed which of the two it needs. A
 * slide that authored none falls back to the reader's own scheme, which is what
 * this app already did.
 *
 * The authored colour is then honoured only if it survives the check — contrast
 * against the worst backdrop that scrim can produce over an unknown picture, so
 * the answer is a floor rather than a best case. It is the one place in this
 * layer where the organizer does not get the last word, and deliberately: an
 * unreadable slide is not a design decision the room can opt out of, and the
 * requirement asks for legibility rather than for obedience.
 *
 * The fallback pairings clear the same check by a wide margin (8.4 and 7.0), so
 * the value this returns always does — which is what makes the guarantee one
 * rather than an approximation.
 */
export function slideScrimFor(
	textColor: string,
	scheme: "light" | "dark",
): SlideScrim {
	const authored = parseHexColor(textColor);
	const toneName = authored
		? relativeLuminance(authored) > LIGHT_TEXT_LUMINANCE
			? "dark"
			: "light"
		: scheme;
	const tone = SCRIM_TONES[toneName];
	const legible =
		authored !== null &&
		contrastRatio(authored, tone.against) >= SCRIM_MIN_CONTRAST;
	return {
		scrim: tone.scrim,
		text: legible && authored ? formatHexColor(authored) : tone.text,
		shadow: tone.shadow,
	};
}

/**
 * The tokens this slide writes over the deck's theme — the layering, as one
 * object (REQ087).
 *
 * Separated from the component because it is also what a test asserts on: "does
 * a slide that authored nothing write nothing?" and "does an authored canvas
 * move the borders with it?" are questions with answers that need no DOM.
 *
 * `deck` is the layer underneath and is read for exactly two values — the canvas
 * and the words this slide would otherwise have had — because a slide that
 * authored only one of the two still needs the other to derive against.
 */
export function slideAppearanceStyle(
	deck: DeckThemeSettings | null,
	slide: SlideAppearanceSettings,
	scheme: "light" | "dark",
): CSSProperties {
	const appearance = slideAppearanceFor(slide);
	const themeTokens = deckThemeAppearance(deck)[scheme].tokens;
	const themeCanvas =
		parseHexColor(themeTokens["--color-surface"] ?? "") ?? BLACK;
	const themeText = parseHexColor(themeTokens["--color-text"] ?? "") ?? WHITE;

	const canvas = parseHexColor(appearance.backgroundColor);
	const authoredText = parseHexColor(appearance.textColor);
	// A slide that recoloured its canvas and left its words alone gets the words
	// that canvas implies — otherwise a light slide in a dark deck would be the
	// theme's near-white text on near-white paper.
	const text = authoredText ?? (canvas ? derivedTextOn(canvas) : themeText);

	const tokens: Record<string, string> = {};
	// The surfaces follow from the *canvas* and from nothing else. A slide that
	// recoloured only its words has said nothing about the room behind it, its
	// raised cards or its borders — and the built-in themes' neutrals are
	// hand-authored, so re-deriving them from a colour nobody authored would
	// replace a tuned value with an approximation of itself.
	if (canvas) {
		Object.assign(
			tokens,
			surfaceRampTokens(canvas, text, schemeOfCanvas(canvas)),
		);
	}
	// The words, whenever either half was authored: an authored text colour is the
	// words, and an authored canvas needs words that can be read on it. Held to
	// {@link SLIDE_TEXT_MIN_CONTRAST} against whichever canvas this slide ended up
	// with, which is the deck's own when the slide recoloured only its words.
	if (canvas || authoredText) {
		Object.assign(
			tokens,
			textRampTokens(text, canvas ?? themeCanvas, SLIDE_TEXT_MIN_CONTRAST),
		);
	}
	const chart = parseHexColor(appearance.chartColor);
	if (chart) {
		slideChartRamp(chart).forEach((color, series) => {
			tokens[`--color-poll-${series + 1}`] = color;
		});
	}
	// The scrim is written whether or not this slide carries a picture: it costs
	// three inert custom properties, and the alternative is a second branch that
	// has to agree with `SlideBackground` about when a picture is a picture.
	const overlay = slideScrimFor(appearance.textColor, scheme);
	return {
		display: "contents",
		// The scope re-declares the text colour rather than only re-pointing the
		// token, and this is load-bearing — the same thing `deckThemeStyle` does for
		// the display face. `index.css` resolves `--color-text` into a computed
		// `color` high up the tree, so a heading with no colour class of its own
		// inherits *that* value and would go on wearing the deck's words however the
		// token was rewritten underneath it. Declared only when this slide actually
		// moved the words, so a slide that recoloured nothing — or only its chart —
		// changes no inherited value at all.
		...(tokens["--color-text"] ? { color: "var(--color-text)" } : {}),
		...tokens,
		"--slide-scrim": overlay.scrim,
		"--slide-overlay-text": overlay.text,
		"--slide-overlay-shadow": overlay.shadow,
	} as CSSProperties;
}

/**
 * Paint a subtree in one slide's own appearance (REQ087), over the deck theme it
 * is already wearing.
 *
 * Wraps the slide *and what is drawn behind it*, so `SlideBackground`'s scrim and
 * the words above it are inside the same scope and cannot be given two different
 * answers about which colours this slide is in.
 */
export function SlideAppearanceScope({
	deck,
	slide,
	children,
}: {
	deck: DeckThemeSettings | null;
	slide: SlideAppearanceSettings;
	children: ReactNode;
}) {
	const { resolvedTheme } = useTheme();
	return (
		<div
			className="slide-appearance"
			style={slideAppearanceStyle(deck, slide, resolvedTheme)}
		>
			{children}
		</div>
	);
}
