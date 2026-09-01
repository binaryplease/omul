import type { CSSProperties, ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import type { Hsl, Rgb } from "./color";
import {
	BLACK,
	clampUnit,
	contrastRatio,
	formatHexColor,
	hslToRgb,
	mixColors,
	parseHexColor,
	rgbaColor,
	rgbToHsl,
	schemeOfCanvas,
	WHITE,
} from "./color";
import type { ChoiceOption } from "./EditorControls";
import { useTheme } from "./ui/Theme";
import type {
	BuiltInDeckThemeId,
	DeckBrand,
	DeckFontId,
	DeckThemeId,
	DeckThemeSettings,
} from "../types";
import {
	BUILT_IN_DECK_THEME_IDS,
	builtInDeckThemeIdFor,
	CUSTOM_DECK_THEME_ID,
	DECK_FONT_IDS,
	deckBrandFor,
	deckLogoFor,
	DEFAULT_DECK_THEME,
	EMPTY_DECK_BRAND,
} from "../types";

// ── The deck's theme, as every surface wears it ───────────────────────
//     (REQ079, REQ080, REQ092, REQ135, REQ136)
//
// One descriptor, one wrapper, one mark (ADR-0026):
//
//   - `DECK_THEME_APPEARANCE` is the single catalog of what each built-in theme
//     *looks* like — its palette in both colour schemes and the wash painted
//     behind a slide — and `deckBrandAppearance()` builds the same shape for a
//     theme the deck authored for itself (REQ080). Nothing else in the app
//     declares a theme colour; the schema stores a built-in theme's id and an
//     authored theme's three colours (see the deck-theme section of
//     `server/schemas.ts` for why the two are stored differently).
//   - `DECK_FONT_STACKS` is the single catalog of the faces a theme may be set
//     in (REQ092). Ids cross the wire, stacks live here: a face this build ships
//     resolves to the same glyphs on the projector and on every phone, which a
//     family name each machine looked up in its own font book would not.
//   - `<DeckThemeScope deck=…>` is the one place both catalogs reach the DOM.
//     It writes the palette onto the existing token vocabulary — the same
//     `--color-*` / `--font-*` custom properties `src/index.css` declares — so
//     every Tailwind utility and every hand-written rule already in the tree
//     repaints itself with no per-surface work. A surface is themed by being
//     wrapped, not by being rewritten.
//   - `<DeckMark deck=…>` is the mark a participant-facing surface shows: the
//     organizer's own logo when the deck carries one (REQ136), and the product's
//     own closed-ring signet when it does not (REQ169) — `BrandMark`'s drawing
//     of it, not a second one.
//
// Three things worth stating, because they are what keep this small:
//
// **The viewer's light/dark preference stays theirs.** A deck's theme and a
// reader's colour scheme are different questions — the projector is in a bright
// room, the phone is in someone's hand — so every theme ships both variants and
// the scope picks the one the viewer already asked for (`useTheme()`). This is
// also a correctness requirement, not a courtesy: the light-mode overrides in
// `index.css` live on `:root`, and a scope that wrote one palette unconditionally
// would out-cascade them and pin the whole subtree to dark.
//
// **An authored theme names one canvas, and the other scheme is derived from
// it.** The rule above is why: an organizer authors the brand they have, and
// what it looks like in the scheme they did not author is ours to work out, not
// theirs to supply twice. `deckBrandAppearance()` does that derivation, and it
// is a pure function of the brand, so the question "what does this brand look
// like in light mode?" is answerable in a test without a DOM.
//
// **The scope generates no box.** It is `display: contents`, so wrapping a page
// in it cannot move, size or reflow anything: custom properties inherit through
// it, and the layout below is exactly the layout that was there before.

/** The custom properties a theme writes. Values are plain CSS colours. */
export type DeckThemeTokens = Record<string, string>;

/** One theme in one colour scheme: its token overrides and its slide wash. */
export type DeckThemeVariant = {
	tokens: DeckThemeTokens;
	/**
	 * The `background-image` painted full-bleed behind every slide — the theme's
	 * own light, under whatever the slide itself carries. Read by
	 * `SlideBackground` through the `--deck-slide-background` token.
	 */
	slideBackground: string;
};

export type DeckThemeAppearance = {
	label: string;
	/** One line, shown beside the choice in the editor. */
	description: string;
	/** The accent the swatch samples — the theme's identity in one colour. */
	swatch: { canvas: string; accent: string };
	/** The face this theme's text is set in (REQ092). */
	font: DeckFontId;
	dark: DeckThemeVariant;
	light: DeckThemeVariant;
};

/** One face, as the two `--font-*` tokens and as the editor offers it. */
export type DeckFontStack = {
	label: string;
	description: string;
	/** What headings, questions and body text resolve to. */
	display: string;
	/** What code, counters and the join code resolve to. */
	mono: string;
};

/**
 * The faces a theme may name (REQ092), and the only place their stacks are
 * spelled out.
 *
 * Every entry resolves to something this build already carries or the reader's
 * own system already has: `Sora Variable` and `DM Mono` are bundled by
 * `src/index.css` through `@fontsource*`, and the rest are generic families no
 * download can fail. A theme that named Satoshi would be a theme that renders as
 * the fallback on every machine but the designer's — which is exactly what "so
 * every surface resolves the same face" rules out, and what ADR-0016 forbids
 * fixing with a runtime fetch.
 */
export const DECK_FONT_STACKS: Record<DeckFontId, DeckFontStack> = {
	sora: {
		label: "Sora",
		description: "The house face — bundled with the app.",
		display: '"Sora Variable", system-ui, sans-serif',
		mono: '"DM Mono", "Menlo", monospace',
	},
	system: {
		label: "System sans",
		description: "Whatever this device sets its own interface in.",
		display:
			'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
		mono: 'ui-monospace, "SFMono-Regular", "Menlo", monospace',
	},
	serif: {
		label: "Serif",
		description: "A typeset look for text-heavy decks.",
		display: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif',
		mono: 'ui-monospace, "SFMono-Regular", "Menlo", monospace',
	},
	mono: {
		label: "Mono",
		description: "Control-room monospace — bundled with the app.",
		display: '"DM Mono", ui-monospace, "Menlo", monospace',
		mono: '"DM Mono", ui-monospace, "Menlo", monospace',
	},
};

/**
 * The built-in themes' palettes (REQ079), derived from the product's own
 * design system rather than invented: its Signal / Warmth / Data Spectrum rows
 * supply the accents, its surface layers the canvas ramps, and its type scale
 * the direction.
 *
 * Typography is a family swap rather than a type-scale swap, and deliberately:
 * a theme names one of `DECK_FONT_STACKS` above (REQ092), which is the same
 * closed set an authored theme picks from — so the two kinds of theme cannot
 * disagree about what "the serif one" is.
 */
export const DECK_THEME_APPEARANCE: Record<
	BuiltInDeckThemeId,
	DeckThemeAppearance
> = {
	// The house theme: the design system the app already wears ("Signal", see the
	// header of `src/index.css`). Its values are that file's, to the digit and
	// role for role — the room a deck gets when it chose nothing is the app it
	// was opened in (REQ168), so this palette and the chrome's are one decision
	// held in two places, and `DeckTheme.test.ts` reads `index.css` and holds the
	// two equal rather than trusting anybody to copy the next change across.
	//
	// This entry used to be held to that file for the opposite reason — *a deck
	// that never chose a theme must look exactly as it looked before themes
	// existed* — and REQ168 retired that invariant on purpose: a deck built
	// before the decision now re-skins for its audience, and so does one that
	// picked `Signal` deliberately because it wanted the tangerine. Both carry
	// the same stored id, the store cannot tell them apart, and that consequence
	// is the decision rather than a side effect of it.
	signal: {
		label: "Signal",
		description:
			"The house look — signal blue on a neutral canvas, set in Sora.",
		swatch: { canvas: "#131316", accent: "#2e5cff" },
		font: "sora",
		dark: {
			tokens: {
				"--color-void": "#09090b",
				"--color-surface": "#131316",
				"--color-surface-raised": "#1c1c20",
				"--color-surface-hover": "#26262c",
				"--color-border": "#2a2a30",
				"--color-border-subtle": "#1c1c20",
				"--color-text": "#f4f4f5",
				"--color-text-muted": "#a1a1aa",
				"--color-text-dim": "#71717a",
				"--color-accent": "#2e5cff",
				"--color-accent-hover": "#4b74ff",
				"--color-accent-glow": "rgba(46, 92, 255, 0.3)",
				"--color-accent-dim": "rgba(46, 92, 255, 0.12)",
				"--color-poll-1": "#2e5cff",
			},
			slideBackground:
				"radial-gradient(120% 80% at 50% 0%, rgba(46, 92, 255, 0.1) 0%, transparent 62%)",
		},
		light: {
			// Elevation runs *toward white* here, as it now does in the chrome: Card
			// is lighter than the Ground it sits on. Glow is `transparent` for the
			// same reason `index.css` makes it so — it is a dark-scheme device, and
			// the light scheme carries depth with a hairline instead.
			tokens: {
				"--color-void": "#fafafa",
				"--color-surface": "#ffffff",
				"--color-surface-raised": "#f4f4f5",
				"--color-surface-hover": "#eaeaed",
				"--color-border": "#e7e7ea",
				"--color-border-subtle": "#efeff1",
				"--color-text": "#09090b",
				"--color-text-muted": "#4e4e57",
				"--color-text-dim": "#8a8a93",
				"--color-accent": "#1f3bff",
				"--color-accent-hover": "#0a25d6",
				"--color-accent-glow": "transparent",
				"--color-accent-dim": "#eceaff",
				"--color-poll-1": "#1f3bff",
			},
			slideBackground:
				"radial-gradient(120% 80% at 50% 0%, rgba(31, 59, 255, 0.08) 0%, transparent 62%)",
		},
	},

	// The design system's canonical palette, verbatim: Pulse Blue on the Deep
	// Ink / Charcoal / Slate canvas, with the standard text ramp above it.
	pulse: {
		label: "Pulse",
		description: "The house palette — Pulse Blue on a Deep Ink canvas.",
		swatch: { canvas: "#141820", accent: "#3b82f6" },
		font: "sora",
		dark: {
			tokens: {
				"--color-void": "#0c0f14",
				"--color-surface": "#141820",
				"--color-surface-raised": "#1c2029",
				"--color-surface-hover": "#262b36",
				"--color-border": "#2e3440",
				"--color-border-subtle": "#1e232c",
				"--color-text": "#f8fafc",
				"--color-text-muted": "#94a3b8",
				"--color-text-dim": "#64748b",
				"--color-accent": "#3b82f6",
				"--color-accent-hover": "#60a5fa",
				"--color-accent-glow": "rgba(59, 130, 246, 0.32)",
				"--color-accent-dim": "rgba(59, 130, 246, 0.12)",
				"--color-poll-1": "#3b82f6",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(59, 130, 246, 0.14) 0%, transparent 64%)",
		},
		light: {
			tokens: {
				"--color-void": "#ffffff",
				"--color-surface": "#f1f5f9",
				"--color-surface-raised": "#e2e8f0",
				"--color-surface-hover": "#cbd5e1",
				"--color-border": "#94a3b8",
				"--color-border-subtle": "#cbd5e1",
				"--color-text": "#0c0f14",
				"--color-text-muted": "#475569",
				"--color-text-dim": "#64748b",
				"--color-accent": "#2563eb",
				"--color-accent-hover": "#3b82f6",
				"--color-accent-glow": "rgba(37, 99, 235, 0.16)",
				"--color-accent-dim": "rgba(37, 99, 235, 0.07)",
				"--color-poll-1": "#2563eb",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(37, 99, 235, 0.09) 0%, transparent 64%)",
		},
	},

	// The Warmth row — Amber into Tangerine — over a canvas warmed to match,
	// so the accent reads as the room's light rather than as a sticker on grey.
	ember: {
		label: "Ember",
		description: "Amber into tangerine over a warm canvas — the Warmth row.",
		swatch: { canvas: "#1a160f", accent: "#f59e0b" },
		font: "sora",
		dark: {
			tokens: {
				"--color-void": "#12100c",
				"--color-surface": "#1a160f",
				"--color-surface-raised": "#241e15",
				"--color-surface-hover": "#2e271b",
				"--color-border": "#3a3124",
				"--color-border-subtle": "#241e15",
				"--color-text": "#faf6ee",
				"--color-text-muted": "#b3a692",
				"--color-text-dim": "#7a6f5c",
				"--color-accent": "#f59e0b",
				"--color-accent-hover": "#f97316",
				"--color-accent-glow": "rgba(245, 158, 11, 0.3)",
				"--color-accent-dim": "rgba(245, 158, 11, 0.1)",
				"--color-poll-1": "#f59e0b",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(245, 158, 11, 0.13) 0%, transparent 64%)",
		},
		light: {
			tokens: {
				"--color-void": "#fffdf8",
				"--color-surface": "#faf3e6",
				"--color-surface-raised": "#f2e7d3",
				"--color-surface-hover": "#e8d9be",
				"--color-border": "#c4b292",
				"--color-border-subtle": "#e8dcc5",
				"--color-text": "#2a2318",
				"--color-text-muted": "#6b5d45",
				"--color-text-dim": "#8c7c60",
				"--color-accent": "#b45309",
				"--color-accent-hover": "#d97706",
				"--color-accent-glow": "rgba(180, 83, 9, 0.16)",
				"--color-accent-dim": "rgba(180, 83, 9, 0.07)",
				"--color-poll-1": "#b45309",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(180, 83, 9, 0.09) 0%, transparent 64%)",
		},
	},

	// The "editorial precision" direction of §16, taken literally: a serif face
	// for the words on the slide, the Data Spectrum's violet for everything that
	// is live, and a paper canvas in light mode.
	editorial: {
		label: "Editorial",
		description: "A serif face and Data Spectrum violet — quiet and typeset.",
		swatch: { canvas: "#16111f", accent: "#8b5cf6" },
		font: "serif",
		dark: {
			tokens: {
				"--color-void": "#0e0b14",
				"--color-surface": "#16111f",
				"--color-surface-raised": "#201829",
				"--color-surface-hover": "#2a2135",
				"--color-border": "#352b44",
				"--color-border-subtle": "#201829",
				"--color-text": "#f4f1f8",
				"--color-text-muted": "#a79fb8",
				"--color-text-dim": "#6e6580",
				"--color-accent": "#8b5cf6",
				"--color-accent-hover": "#a78bfa",
				"--color-accent-glow": "rgba(139, 92, 246, 0.3)",
				"--color-accent-dim": "rgba(139, 92, 246, 0.1)",
				"--color-poll-1": "#8b5cf6",
			},
			slideBackground:
				"radial-gradient(125% 85% at 50% 0%, rgba(139, 92, 246, 0.13) 0%, transparent 64%)",
		},
		light: {
			tokens: {
				"--color-void": "#fdfcfa",
				"--color-surface": "#f5f2ec",
				"--color-surface-raised": "#eae5dc",
				"--color-surface-hover": "#ddd6c9",
				"--color-border": "#b3aa9b",
				"--color-border-subtle": "#e2dcd1",
				"--color-text": "#1c1720",
				"--color-text-muted": "#574f60",
				"--color-text-dim": "#7a7185",
				"--color-accent": "#7c3aed",
				"--color-accent-hover": "#8b5cf6",
				"--color-accent-glow": "rgba(124, 58, 237, 0.16)",
				"--color-accent-dim": "rgba(124, 58, 237, 0.07)",
				"--color-poll-1": "#7c3aed",
			},
			slideBackground:
				"radial-gradient(125% 85% at 50% 0%, rgba(124, 58, 237, 0.08) 0%, transparent 64%)",
		},
	},

	// §3.1's stated inspiration — "live broadcast control rooms" — as its own
	// theme: everything set in the bundled mono, the Data Spectrum's emerald for
	// the signal, and a near-black green canvas.
	broadcast: {
		label: "Broadcast",
		description: "Control-room monospace and emerald signal on near-black.",
		swatch: { canvas: "#0d1714", accent: "#10b981" },
		font: "mono",
		dark: {
			tokens: {
				"--color-void": "#07100d",
				"--color-surface": "#0d1714",
				"--color-surface-raised": "#13211d",
				"--color-surface-hover": "#1a2c26",
				"--color-border": "#22392f",
				"--color-border-subtle": "#13211d",
				"--color-text": "#e6f4ef",
				"--color-text-muted": "#8fb0a5",
				"--color-text-dim": "#5b7970",
				"--color-accent": "#10b981",
				"--color-accent-hover": "#34d399",
				"--color-accent-glow": "rgba(16, 185, 129, 0.3)",
				"--color-accent-dim": "rgba(16, 185, 129, 0.1)",
				"--color-poll-1": "#10b981",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(16, 185, 129, 0.12) 0%, transparent 64%)",
		},
		light: {
			tokens: {
				"--color-void": "#ffffff",
				"--color-surface": "#f0f5f3",
				"--color-surface-raised": "#e1ebe7",
				"--color-surface-hover": "#cfddd8",
				"--color-border": "#93a9a2",
				"--color-border-subtle": "#dce7e3",
				"--color-text": "#0b1512",
				"--color-text-muted": "#40544d",
				"--color-text-dim": "#61776f",
				"--color-accent": "#047857",
				"--color-accent-hover": "#059669",
				"--color-accent-glow": "rgba(4, 120, 87, 0.16)",
				"--color-accent-dim": "rgba(4, 120, 87, 0.07)",
				"--color-poll-1": "#047857",
			},
			slideBackground:
				"radial-gradient(130% 85% at 50% 0%, rgba(4, 120, 87, 0.08) 0%, transparent 64%)",
		},
	},
};

// ── An authored theme, as a palette (REQ080, REQ135) ──────────────────
//
// Three authored colours become the same sixteen-token appearance a built-in
// theme is, in both colour schemes. Everything below is a pure function of them:
// no DOM, no React, no `Math.random`, so the whole derivation is assertable.
//
// The shape of the derivation, in one paragraph. The canvas is the anchor: its
// own lightness says which colour scheme the brand was authored for, that scheme
// gets the authored colours verbatim, and the *other* scheme is rebuilt from the
// canvas's hue at a banded lightness — a brand names the room it has, and the
// room it does not have is ours to work out. Every remaining token is a mix
// along the canvas → text axis, which is what makes a raised surface raised and
// a dim label dim whichever direction that axis runs in.

/**
 * Where a derived scheme puts its canvas and its words on the lightness axis.
 *
 * Banded rather than inverted from the authored value: inverting a mid-tone
 * canvas produces another mid-tone, and two mid-tones are not a colour scheme.
 */
const DERIVED_BANDS = {
	dark: { canvas: 0.08, text: 0.94 },
	light: { canvas: 0.96, text: 0.13 },
} as const;

/** How much of the canvas's own colour a derived canvas and its text keep. */
const DERIVED_CANVAS_SATURATION = 0.12;
const DERIVED_TEXT_SATURATION = 0.06;

/** The contrast a derived scheme's accent is held to against its canvas. */
const DERIVED_ACCENT_MIN_CONTRAST = 3;

/**
 * The accent, moved only far enough to be legible on a canvas nobody authored it
 * against.
 *
 * Applied to the **derived** scheme and to nothing else. An authored colour is
 * used as authored — an organizer who picks an accent their own canvas swallows
 * has made a decision this module has no business overruling, and telling them
 * about it is REQ132's job, not this one's. The scheme they did not author is a
 * different matter: it is ours, and a brand that vanished in light mode would be
 * our defect rather than their choice.
 */
function legibleAccent(
	accent: Rgb,
	canvas: Rgb,
	scheme: "dark" | "light",
): Rgb {
	if (contrastRatio(accent, canvas) >= DERIVED_ACCENT_MIN_CONTRAST) {
		return accent;
	}
	const authored = rgbToHsl(accent);
	const step = scheme === "light" ? -0.02 : 0.02;
	let lightness = authored.lightness;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const next = clampUnit(lightness + step);
		if (next === lightness) break;
		lightness = next;
		const candidate = hslToRgb({ ...authored, lightness });
		if (contrastRatio(candidate, canvas) >= DERIVED_ACCENT_MIN_CONTRAST) {
			return candidate;
		}
	}
	return hslToRgb({ ...authored, lightness });
}

/**
 * How far the two quieter steps sit along the words → canvas axis. Named because
 * both theming layers walk the same axis and must agree on where a caption is.
 */
export const TEXT_RAMP_WEIGHTS = { muted: 0.4, dim: 0.62 } as const;

/**
 * The surfaces a canvas implies: the room behind it, the raised cards on it and
 * the lines between them.
 *
 * Every one is a point on the canvas → text axis, so the ramp runs the right way
 * round for a dark canvas and a light one without a branch: a raised surface is a
 * step from the canvas *towards the words*. `--color-void` is the exception and
 * steps the other way — away from the text, into the room behind the slide.
 *
 * Exported because a **slide that authored its own canvas** derives exactly these
 * from it (REQ070, `SlideAppearance.tsx`). One derivation, both layers
 * (ADR-0026). Split from the text ramp below because the two are implied by
 * different things: these follow from the *canvas*, and a slide that recoloured
 * only its words has said nothing about them.
 */
export function surfaceRampTokens(
	canvas: Rgb,
	text: Rgb,
	scheme: "dark" | "light",
): DeckThemeTokens {
	const away = scheme === "dark" ? BLACK : WHITE;
	return {
		"--color-void": formatHexColor(mixColors(canvas, away, 0.34)),
		"--color-surface": formatHexColor(canvas),
		"--color-surface-raised": formatHexColor(mixColors(canvas, text, 0.07)),
		"--color-surface-hover": formatHexColor(mixColors(canvas, text, 0.13)),
		"--color-border": formatHexColor(mixColors(canvas, text, 0.2)),
		"--color-border-subtle": formatHexColor(mixColors(canvas, text, 0.09)),
	};
}

/**
 * The words, and the two quieter steps under them: a muted caption and a dim
 * label are the words walked back towards the canvas they sit on.
 *
 * `minContrast` is the floor each quieter step is held to against that canvas,
 * and it is **opt-in** rather than always on. A deck brand names one canvas and
 * has its words derived for it, so the two are already far apart by construction
 * and this layer passes `null` — its output is unchanged by the parameter
 * existing. A *slide* is the case that needs it: it may recolour its words
 * against a canvas somebody else authored, and 0.4 of the way towards a canvas
 * that is nearly the same colour is a caption nobody can read
 * (`SlideAppearance.tsx`). The floor is on this derivation only; it says nothing
 * about the built-in themes' own ramps, which are hand-authored.
 */
export function textRampTokens(
	text: Rgb,
	canvas: Rgb,
	minContrast: { muted: number; dim: number } | null = null,
): DeckThemeTokens {
	const step = (weight: number, floor: number | null) =>
		formatHexColor(
			floor === null
				? mixColors(text, canvas, weight)
				: legibleStepToward(text, canvas, weight, floor),
		);
	return {
		"--color-text": formatHexColor(text),
		"--color-text-muted": step(TEXT_RAMP_WEIGHTS.muted, minContrast?.muted ?? null),
		"--color-text-dim": step(TEXT_RAMP_WEIGHTS.dim, minContrast?.dim ?? null),
	};
}

/**
 * The quietest this step may be and still clear `minContrast` against the canvas
 * — walked back towards the words until it does, exactly as
 * {@link legibleAccent} walks an accent's lightness.
 *
 * Falls back to the words themselves when even they do not clear the floor: an
 * organizer who wrote their text in a colour their own canvas swallows has made a
 * decision this module has no business overruling (that is REQ132's job), and
 * this function's only promise is that a step *it derived* is never quieter than
 * the value it derived it from.
 */
function legibleStepToward(
	text: Rgb,
	canvas: Rgb,
	weight: number,
	minContrast: number,
): Rgb {
	const start = clampUnit(weight);
	for (let at = start; at > 0; at -= 0.02) {
		const step = mixColors(text, canvas, at);
		if (contrastRatio(step, canvas) >= minContrast) return step;
	}
	return text;
}

/**
 * One scheme's whole palette, from the three colours it comes down to — the two
 * neutral ramps above, plus everything the accent decides.
 */
function brandVariant(
	canvas: Rgb,
	text: Rgb,
	accent: Rgb,
	scheme: "dark" | "light",
): DeckThemeVariant {
	const glow = scheme === "dark" ? 0.3 : 0.16;
	const dim = scheme === "dark" ? 0.1 : 0.07;
	const wash = scheme === "dark" ? 0.13 : 0.09;
	return {
		tokens: {
			...surfaceRampTokens(canvas, text, scheme),
			...textRampTokens(text, canvas),
			"--color-accent": formatHexColor(accent),
			"--color-accent-hover": formatHexColor(mixColors(accent, text, 0.26)),
			"--color-accent-glow": rgbaColor(accent, glow),
			"--color-accent-dim": rgbaColor(accent, dim),
			"--color-poll-1": formatHexColor(accent),
		},
		slideBackground: `radial-gradient(125% 85% at 50% 0%, ${rgbaColor(accent, wash)} 0%, transparent 64%)`,
	};
}

/**
 * The words a canvas nobody wrote words for gets: the lightness band this module
 * would have put them at, keeping a trace of the canvas's own hue.
 *
 * Exported for the same reason {@link surfaceRampTokens} is — a slide that
 * authored a background colour and no text colour needs the words that canvas
 * implies (REQ070), and it must be the same answer a deck brand gets, or a slide
 * could end up with the theme's light words on its own light canvas.
 */
export function derivedTextOn(canvas: Rgb): Rgb {
	return derivedCanvasAndText(rgbToHsl(canvas), schemeOfCanvas(canvas)).text;
}

/** The canvas and words a scheme gets when nobody authored them for it. */
function derivedCanvasAndText(
	canvasHue: Hsl,
	scheme: "dark" | "light",
): { canvas: Rgb; text: Rgb } {
	const band = DERIVED_BANDS[scheme];
	return {
		canvas: hslToRgb({
			hue: canvasHue.hue,
			saturation: Math.min(canvasHue.saturation, DERIVED_CANVAS_SATURATION),
			lightness: band.canvas,
		}),
		text: hslToRgb({
			hue: canvasHue.hue,
			saturation: Math.min(canvasHue.saturation, DERIVED_TEXT_SATURATION),
			lightness: band.text,
		}),
	};
}

/** What the picker calls a theme the organizer has not named. */
const UNNAMED_BRAND_LABEL = "Custom";

/**
 * What a theme authored on the deck looks like (REQ080, REQ135) — the same shape
 * `DECK_THEME_APPEARANCE` holds for a built-in one, so every consumer below is
 * blind to which kind it was handed.
 *
 * Unauthored is not the same as invalid and both land here as `""`: whatever the
 * brand did not name falls back to the house theme's own value, so a brand that
 * is nothing but "our orange" is a brand, and a colour the resolver refused
 * leaves the deck looking like the house rather than like nothing.
 */
export function deckBrandAppearance(brand: DeckBrand): DeckThemeAppearance {
	const house = DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME];
	const houseAccent =
		parseHexColor(house.dark.tokens["--color-accent"]) ?? WHITE;
	const houseCanvas =
		parseHexColor(house.dark.tokens["--color-surface"]) ?? BLACK;

	const accent = parseHexColor(brand.accent) ?? houseAccent;
	const canvas = parseHexColor(brand.canvas) ?? houseCanvas;
	const authoredScheme = schemeOfCanvas(canvas);
	const derivedScheme = authoredScheme === "dark" ? "light" : "dark";
	const canvasHue = rgbToHsl(canvas);

	// The words on the authored canvas: the organizer's, or the band this module
	// would have picked for that canvas anyway.
	const text =
		parseHexColor(brand.text) ??
		derivedCanvasAndText(canvasHue, authoredScheme).text;
	const derived = derivedCanvasAndText(canvasHue, derivedScheme);

	const variants = {
		[authoredScheme]: brandVariant(canvas, text, accent, authoredScheme),
		[derivedScheme]: brandVariant(
			derived.canvas,
			derived.text,
			legibleAccent(accent, derived.canvas, derivedScheme),
			derivedScheme,
		),
	} as Record<"dark" | "light", DeckThemeVariant>;

	return {
		label: brand.name.trim() || UNNAMED_BRAND_LABEL,
		description: "This deck's own colours and typeface, authored below.",
		swatch: { canvas: formatHexColor(canvas), accent: formatHexColor(accent) },
		font: brand.font,
		dark: variants.dark,
		light: variants.light,
	};
}

/**
 * What a deck looks like — the one read site, so an unknown theme id resolves to
 * the house theme here and nowhere else (see {@link deckThemeIdFor}), and an
 * authored theme is built from the brand exactly once (see {@link deckBrandFor}).
 */
export function deckThemeAppearance(
	deck: DeckThemeSettings | null,
): DeckThemeAppearance {
	const settings = deck ?? {};
	const brand = deckBrandFor(settings);
	if (brand) return deckBrandAppearance(brand);
	return DECK_THEME_APPEARANCE[builtInDeckThemeIdFor(settings)];
}

/**
 * The style object a scope carries: the chosen variant's tokens, the theme's
 * face and the slide wash, and `display: contents` so the wrapper occupies no
 * space of its own.
 *
 * Separated from the component because it is also what a test asserts on: the
 * question "does every theme, built-in or authored, paint every token?" has an
 * answer that does not need a DOM.
 */
export function deckThemeStyle(
	deck: DeckThemeSettings | null,
	scheme: "light" | "dark",
): CSSProperties {
	const appearance = deckThemeAppearance(deck);
	const variant = appearance[scheme];
	const font = DECK_FONT_STACKS[appearance.font];
	return {
		display: "contents",
		// The scope re-declares the display face rather than only re-pointing the
		// token, and this is load-bearing: `index.css` resolves `--font-display` on
		// `<html>`, so everything below inherits the *computed* family and would go
		// on wearing the house face however the token was rewritten underneath it.
		// Declaring it here makes the subtree resolve the theme's own value — which
		// is what makes typography something a theme actually drives (REQ092).
		fontFamily: "var(--font-display)",
		"--font-display": font.display,
		"--font-mono": font.mono,
		...variant.tokens,
		"--deck-slide-background": variant.slideBackground,
	} as CSSProperties;
}

/**
 * The class a scope carries, which is one question — and it is a narrower one
 * than "did this deck pick a theme?": *is the accent under this scope one the
 * deck supplied, or the house one?*
 *
 * `.deck-theme` (`src/index.css`) exists to keep the chrome's REQ166 token
 * families — heavy emphasis, accent-as-text, the label on an accent surface,
 * the soft halo, the light scheme's shadow — off a deck that supplied an accent
 * of its own, by re-pointing each of them at that accent. Re-pointing
 * accent-as-text is the load-bearing one and the one with a floor under it: it
 * draws words in the *raw* accent, which is only legible because an accent
 * somebody authored, or hand-tuned into the catalog, is legible on the canvas
 * beside it. The house accent is not — as words it reads 3.61:1 on Card and
 * 3.31:1 on Raised in the dark scheme, which is why `index.css` carries a
 * separate per-scheme value for it (REQ157) and why a scope wearing it must
 * inherit that value rather than have it re-pointed away.
 *
 * So the exemption follows the accent, not the theme id, and two populations
 * carry the house accent:
 *
 *   - a deck that indexes the catalog at the house entry — absent, unknown or
 *     explicitly `signal`;
 *   - a deck whose id is `custom` but whose brand **authored no accent**, for
 *     which {@link deckBrandAppearance} substitutes the house one. A `custom`
 *     id is not by itself a palette: `deckBrandFor()` answers a brand for any
 *     deck carrying that id, including one where every field is empty, so this
 *     is one click away — pick the "Custom" card, author nothing.
 *
 * Separated from the component for the same reason {@link deckThemeStyle} is:
 * "which decks are exempt?" is answerable without a DOM.
 */
export function deckThemeClassName(deck: DeckThemeSettings | null): string {
	return deckWearsHouseAccent(deck) ? "" : "deck-theme";
}

/** Whether the accent under this deck's scope is the house one. */
function deckWearsHouseAccent(deck: DeckThemeSettings | null): boolean {
	const settings = deck ?? {};
	const brand = deckBrandFor(settings);
	if (!brand) return builtInDeckThemeIdFor(settings) === DEFAULT_DECK_THEME;
	// Only the accent is asked about. A brand may author a canvas, words or a
	// face and still be handed the house accent, and it is the accent that the
	// rule would draw as text.
	return brand.accent === "";
}

/**
 * Paint a subtree in the deck's theme (REQ079, REQ080).
 *
 * `deck` is nullable on purpose: a surface reached before any deck is known —
 * the join screen where a code is still being typed — wears the built-in default
 * through this same wrapper rather than through a second code path, so "which
 * theme is this screen in?" has one answer everywhere.
 */
export function DeckThemeScope({
	deck,
	children,
}: {
	deck: DeckThemeSettings | null;
	children: ReactNode;
}) {
	const { resolvedTheme } = useTheme();
	return (
		<div
			className={deckThemeClassName(deck)}
			style={deckThemeStyle(deck, resolvedTheme)}
		>
			{children}
		</div>
	);
}

/**
 * How big a mark is drawn — the signet's and the waiting dot's diameter, and
 * the logo's cap height.
 */
export type DeckMarkSize = "sm" | "md" | "lg";

const DECK_MARK_DOT: Record<DeckMarkSize, string> = {
	sm: "w-3 h-3",
	md: "w-4 h-4",
	lg: "w-5 h-5",
};

/**
 * The same three diameters as pixels, because the signet is asked for by the
 * room it has rather than by name (see {@link brandMarkForm}) and `w-4` is not
 * a number.
 *
 * Every one of them has to be small enough that the form rule answers *signet*
 * — REQ169 puts the ring here, not the wordmark — which `DeckTheme.test.ts`
 * holds, so raising one past the wordmark's floor fails there rather than
 * silently drawing four letters in a 20px box.
 */
export const DECK_MARK_SIGNET_PX: Record<DeckMarkSize, number> = {
	sm: 12,
	md: 16,
	lg: 20,
};

const DECK_MARK_LOGO: Record<DeckMarkSize, string> = {
	sm: "max-h-6",
	md: "max-h-10",
	lg: "max-h-16",
};

/**
 * The mark a participant-facing surface shows (REQ136): the organizer's own
 * logo when the deck carries a usable one, and the product's own signet when it
 * does not (REQ169).
 *
 * The URL is resolved by {@link deckLogoFor}, never read off the field — a
 * scheme no `<img>` should be pointed at resolves to "no logo" and this falls
 * back to the default mark, which is the whole reason the fallback exists.
 *
 * `fallback` distinguishes the two situations REQ136 names. On a screen that
 * already carries a mark — the join screen's, the waiting screen's amber one —
 * the logo goes *in place of* it, so the default is `"mark"`. On a screen that
 * carries none, `"none"` puts the logo *beside* what is there without inventing
 * a mark for every deck that has no logo.
 *
 * `tone` is what splits the two marks apart, and they are two different claims.
 * The default is the *product* identifying itself where the organizer has not,
 * so it is `BrandMark`'s closed ring — the drawn mark REQ167 settled on for
 * icon, tile and avatar, in the mark's own ink and paper, never in the accent,
 * which belongs to the interface. `"warning"` is not a mark at all but a state:
 * the run has not started. It keeps the pulsing amber dot it always was.
 */
export function DeckMark({
	deck,
	size = "md",
	tone = "accent",
	fallback = "mark",
	className = "",
}: {
	deck: DeckThemeSettings | null;
	size?: DeckMarkSize;
	/** The product's own mark, or a waiting signal. */
	tone?: "accent" | "warning";
	fallback?: "mark" | "none";
	className?: string;
}) {
	const logo = deck ? deckLogoFor(deck) : null;
	if (logo) {
		return (
			<img
				src={logo.url}
				alt={logo.alt}
				className={`${DECK_MARK_LOGO[size]} w-auto object-contain ${className}`}
			/>
		);
	}
	if (fallback === "none") return null;
	if (tone === "warning") {
		return (
			<span
				aria-hidden
				className={`block rounded-full glow-pulse bg-warning ${DECK_MARK_DOT[size]} ${className}`}
			/>
		);
	}
	return (
		<BrandMark heightPx={DECK_MARK_SIGNET_PX[size]} className={className} />
	);
}

/** A theme's identity as one small sample: its canvas with its accent on it. */
export function DeckThemeSwatch({
	appearance,
}: {
	appearance: DeckThemeAppearance;
}) {
	const { canvas, accent } = appearance.swatch;
	return (
		<span
			aria-hidden
			className="flex h-6 w-6 items-center justify-center rounded-lg border border-border-subtle"
			style={{ background: canvas }}
		>
			<span
				className="block h-2.5 w-2.5 rounded-full"
				style={{ background: accent }}
			/>
		</span>
	);
}

/**
 * The themes as the editor offers them (ADR-0026) — one descriptor, so a theme
 * added to the schema's enum reaches the picker by being in the catalog rather
 * than by being remembered.
 *
 * The deck's own theme is offered as a choice beside the built-in five (REQ080),
 * and wears the brand it currently carries: an organizer picking it sees the
 * colours they authored on the card, not a placeholder for them.
 */
export function deckThemeOptions(
	brand: DeckBrand | null,
): ChoiceOption<DeckThemeId>[] {
	const authored = deckBrandAppearance(brand ?? EMPTY_DECK_BRAND);
	return [
		...BUILT_IN_DECK_THEME_IDS.map((theme) => ({
			value: theme as DeckThemeId,
			label: DECK_THEME_APPEARANCE[theme].label,
			description: DECK_THEME_APPEARANCE[theme].description,
			icon: <DeckThemeSwatch appearance={DECK_THEME_APPEARANCE[theme]} />,
		})),
		{
			value: CUSTOM_DECK_THEME_ID as DeckThemeId,
			label: authored.label,
			description: authored.description,
			icon: <DeckThemeSwatch appearance={authored} />,
		},
	];
}

/** The faces as the editor offers them (REQ092) — one descriptor, as above. */
export function deckFontOptions(): ChoiceOption<DeckFontId>[] {
	return DECK_FONT_IDS.map((font) => ({
		value: font,
		label: DECK_FONT_STACKS[font].label,
		description: DECK_FONT_STACKS[font].description,
	}));
}
