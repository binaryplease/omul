/**
 * Unit tests for a slide's appearance over the deck's theme — the client half
 * of REQ087/REQ070/REQ071/REQ019.
 *
 * Three claims, and the layer stands on all three:
 *
 *   - **Unauthored writes nothing.** A slide that overrode nothing must produce
 *     no colour tokens at all, because that is what "layered over the theme's
 *     defaults rather than replacing them" means: the deck's own scope is left
 *     to answer, and a deck re-themed tomorrow re-themes this slide with it.
 *   - **An authored colour brings its consequences with it.** A canvas moves the
 *     borders, the raised surfaces and — unless the slide authored them too —
 *     the words, through the same derivation a deck brand uses. A slide that
 *     recoloured its canvas and nothing else must never end up with the theme's
 *     light words on its own light paper.
 *   - **The picture never wins over the words.** The scrim over a background
 *     image is paired with the text that sits on it and the pairing is checked,
 *     not assumed — including when the slide authored a text colour the scrim
 *     cannot carry.
 *
 * `SlideAppearanceScope` itself is not exercised: it writes
 * `slideAppearanceStyle()` onto a div and does nothing else, so the style object
 * is where the content is.
 */

import { describe, expect, test } from "bun:test";
import { contrastRatio, parseHexColor, relativeLuminance } from "./color";
import { DECK_THEME_APPEARANCE, deckThemeAppearance } from "./DeckTheme";
import {
	SCRIM_MIN_CONTRAST,
	SCRIM_TONES,
	SLIDE_PLACEMENT_CLASSES,
	SLIDE_TEXT_MIN_CONTRAST,
	slideAppearanceStyle,
	slideChartRamp,
	slideLayoutOptions,
	slidePlacementClasses,
	slideScrimFor,
} from "./SlideAppearance";
import {
	BUILT_IN_DECK_THEME_IDS,
	DEFAULT_DECK_THEME,
	SLIDE_LAYOUTS,
} from "../types";

const SCHEMES = ["dark", "light"] as const;

/** The style object as a plain record — it is custom properties, not CSS. */
function tokensOf(
	slide: Record<string, unknown>,
	scheme: "dark" | "light" = "dark",
	deck: Record<string, unknown> | null = null,
): Record<string, string> {
	const style = slideAppearanceStyle(deck, slide, scheme) as Record<
		string,
		string
	>;
	const tokens: Record<string, string> = {};
	for (const [property, value] of Object.entries(style)) {
		if (property.startsWith("--color-")) tokens[property] = value;
	}
	return tokens;
}

describe("a slide that authored nothing (REQ087)", () => {
	test("writes no colour token at all, in either scheme", () => {
		for (const scheme of SCHEMES) {
			expect(tokensOf({}, scheme)).toEqual({});
			expect(tokensOf({ layout: "inherit" }, scheme)).toEqual({});
		}
	});

	test("occupies no space and paints the scheme's own scrim", () => {
		const style = slideAppearanceStyle(null, {}, "dark") as Record<
			string,
			string
		>;
		expect(style.display).toBe("contents");
		// The scheme's own words, unauthored: a deck that overrode nothing takes
		// the pairing `index.css` states for a surface outside any scope, and the
		// two have to be the same pair — the light one is the ink the neutral
		// direction sets `--color-text` to (REQ166).
		expect(style["--slide-overlay-text"]).toBe("#ffffff");
		expect(style["--slide-scrim"]).toContain("rgba(0, 0, 0, 0.7)");
		const light = slideAppearanceStyle(null, {}, "light") as Record<
			string,
			string
		>;
		expect(light["--slide-overlay-text"]).toBe("#09090b");
		expect(light["--slide-scrim"]).toContain("rgba(255, 255, 255, 0.7)");
	});

	test("a colour the resolver refused is not an override", () => {
		expect(tokensOf({ backgroundColor: "rebeccapurple" })).toEqual({});
		expect(tokensOf({ chartColor: "#ff66" })).toEqual({});
	});
});

describe("an authored background colour (REQ070)", () => {
	test("moves the whole neutral ramp with it, and nothing else", () => {
		const tokens = tokensOf({ backgroundColor: "#102030" });
		expect(tokens["--color-surface"]).toBe("#102030");
		// The surfaces and borders a canvas implies — derived, not authored.
		for (const token of [
			"--color-void",
			"--color-surface-raised",
			"--color-surface-hover",
			"--color-border",
			"--color-border-subtle",
			"--color-text",
			"--color-text-muted",
			"--color-text-dim",
		]) {
			expect(tokens[token]).toMatch(/^#[0-9a-f]{6}$/);
		}
		// The accent and the chart are a different question and were not asked.
		expect(tokens["--color-accent"]).toBeUndefined();
		expect(tokens["--color-poll-1"]).toBeUndefined();
	});

	test("brings words that can be read on it, whatever the deck's are", () => {
		// The failure this prevents: a light slide in a dark deck keeping the
		// theme's near-white text, i.e. white on white.
		const onLight = tokensOf({ backgroundColor: "#fdfdfd" }, "dark");
		const words = parseHexColor(onLight["--color-text"] ?? "");
		const canvas = parseHexColor(onLight["--color-surface"] ?? "");
		expect(words).not.toBeNull();
		expect(canvas).not.toBeNull();
		if (words && canvas) {
			expect(contrastRatio(words, canvas)).toBeGreaterThan(7);
		}
	});

	test("the deck's own theme is what an unauthored canvas mixes against", () => {
		// A slide that authored only its text still needs a canvas to derive the
		// muted and dim steps against, and it is the deck's — so re-theming the
		// deck moves this slide's quieter steps too.
		const onHouse = tokensOf({ textColor: "#ff0000" }, "dark");
		const onBrand = tokensOf({ textColor: "#ff0000" }, "dark", {
			theme: "custom",
			themeBrand: { canvas: "#0b1120", accent: "#22d3ee" },
		});
		expect(onHouse["--color-text"]).toBe("#ff0000");
		expect(onBrand["--color-text"]).toBe("#ff0000");
		expect(onBrand["--color-text-dim"]).not.toBe(onHouse["--color-text-dim"]);
	});

	test("an authored text colour stands, canvas or no canvas", () => {
		expect(
			tokensOf({ backgroundColor: "#fdfdfd", textColor: "#123456" })[
				"--color-text"
			],
		).toBe("#123456");
	});
});

describe("an authored text colour, and nothing else (REQ019)", () => {
	test("writes the words and only the words", () => {
		// The failure this prevents: a text-only override re-deriving the theme's
		// hand-authored surfaces from a canvas the slide never touched. On the
		// participant surface the scope wraps `.participant-view bg-void`, so a
		// stray `--color-void` here would repaint the whole phone screen.
		const tokens = tokensOf({ textColor: "#1e293b" }, "light");
		expect(Object.keys(tokens).sort()).toEqual([
			"--color-text",
			"--color-text-dim",
			"--color-text-muted",
		]);
	});

	test("a text colour identical to the theme's leaves the theme alone", () => {
		// The strongest form of the same claim: authoring exactly what is already
		// there must not move anything the author did not name.
		const theme = DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME].light.tokens;
		const tokens = tokensOf({ textColor: theme["--color-text"] }, "light");
		expect(tokens["--color-text"]).toBe(theme["--color-text"]);
		for (const token of [
			"--color-void",
			"--color-surface",
			"--color-surface-raised",
			"--color-surface-hover",
			"--color-border",
			"--color-border-subtle",
		]) {
			expect(tokens[token]).toBeUndefined();
		}
	});

	test("the quieter steps stay readable on every built-in theme", () => {
		// The mix weights are calibrated for a canvas and its words being far
		// apart, which a slide may break: 0.4 of the way towards a canvas that is
		// nearly the same colour is a caption nobody can read. Walked across every
		// theme, both schemes, so a palette added later is checked too.
		const gaps: string[] = [];
		for (const themeId of BUILT_IN_DECK_THEME_IDS) {
			for (const scheme of SCHEMES) {
				const themeTokens = DECK_THEME_APPEARANCE[themeId][scheme].tokens;
				const canvas = parseHexColor(themeTokens["--color-surface"] ?? "");
				const tokens = tokensOf(
					{ textColor: themeTokens["--color-text"] },
					scheme,
					{ theme: themeId },
				);
				for (const [token, floor] of [
					["--color-text-muted", SLIDE_TEXT_MIN_CONTRAST.muted],
					["--color-text-dim", SLIDE_TEXT_MIN_CONTRAST.dim],
				] as const) {
					const step = parseHexColor(tokens[token] ?? "");
					if (!canvas || !step) {
						gaps.push(`${themeId}/${scheme} ${token} unparseable`);
						continue;
					}
					const ratio = contrastRatio(step, canvas);
					if (ratio < floor) {
						gaps.push(
							`${themeId}/${scheme} ${token} ${ratio.toFixed(2)} < ${floor}`,
						);
					}
				}
			}
		}
		expect(gaps).toEqual([]);
	});

	test("a canvas the author's own words vanish into is left as authored", () => {
		// The floor is on *this layer's derivation*, not on the organizer: text
		// they chose against a canvas that swallows it is their decision (REQ132's
		// job to report), so the quieter steps collapse onto the words rather than
		// being invented brighter than what they came from.
		const tokens = tokensOf({ backgroundColor: "#f1f5f9", textColor: "#eef2f6" });
		expect(tokens["--color-text"]).toBe("#eef2f6");
		expect(tokens["--color-text-muted"]).toBe("#eef2f6");
		expect(tokens["--color-text-dim"]).toBe("#eef2f6");
	});
});

describe("an authored chart colour (REQ019)", () => {
	test("seeds all eight series, the first of them verbatim", () => {
		const tokens = tokensOf({ chartColor: "#10b981" });
		expect(tokens["--color-poll-1"]).toBe("#10b981");
		for (let series = 1; series <= 8; series += 1) {
			expect(tokens[`--color-poll-${series}`]).toMatch(/^#[0-9a-f]{6}$/);
		}
		// A chart colour is a chart colour: it says nothing about the canvas.
		expect(tokens["--color-surface"]).toBeUndefined();
	});

	test("the eight are eight, so a legend can still be read", () => {
		// The point of a categorical scale: a ramp that collapsed to one colour
		// would be on-brand and unreadable.
		for (const seed of ["#10b981", "#ff6b35", "#000000", "#ffffff"]) {
			const ramp = slideChartRamp(parseHexColor(seed) ?? { red: 0, green: 0, blue: 0 });
			expect(new Set(ramp).size).toBe(8);
		}
	});

	test("a nearly-black or nearly-white seed still yields a chart", () => {
		// Held inside a lightness band: the seed is series one as authored, and
		// the derived seven stay somewhere a bar is visible.
		for (const seed of ["#000000", "#ffffff"]) {
			const ramp = slideChartRamp(parseHexColor(seed) ?? { red: 0, green: 0, blue: 0 });
			expect(ramp[0]).toBe(seed);
			for (const color of ramp.slice(1)) {
				const parsed = parseHexColor(color);
				expect(parsed).not.toBeNull();
				if (parsed) {
					expect(relativeLuminance(parsed)).toBeGreaterThan(0.05);
					expect(relativeLuminance(parsed)).toBeLessThan(0.95);
				}
			}
		}
	});
});

describe("words on a picture (REQ071)", () => {
	test("light words get a dark scrim and dark words a light one", () => {
		expect(slideScrimFor("#ffffff", "light").scrim).toContain("rgba(0, 0, 0");
		expect(slideScrimFor("#111111", "dark").scrim).toContain(
			"rgba(255, 255, 255",
		);
	});

	test("an authored colour is honoured only while it stays legible", () => {
		// Honoured: white on the darkening scrim it asked for.
		expect(slideScrimFor("#ffffff", "dark").text).toBe("#ffffff");
		// Refused: a mid grey has neither tone behind it at AA, so legibility
		// wins and the scrim's own pairing stands. An unreadable slide is not a
		// design decision the room can opt out of.
		const grey = slideScrimFor("#808080", "dark");
		expect(grey.text).not.toBe("#808080");
		const chosen = parseHexColor(grey.text);
		expect(chosen).not.toBeNull();
	});

	test("whatever colour is chosen clears AA against the worst backdrop", () => {
		// Against the *worst* backdrop, not the tone: the scrim is translucent, so
		// a check against pure black or pure white would compute a contrast no
		// reader is ever guaranteed over an actual photograph.
		for (const authored of ["", "#ffffff", "#111111", "#808080", "#10b981"]) {
			for (const scheme of SCHEMES) {
				const overlay = slideScrimFor(authored, scheme);
				const tone =
					overlay.scrim === SCRIM_TONES.dark.scrim
						? SCRIM_TONES.dark
						: SCRIM_TONES.light;
				const words = parseHexColor(overlay.text);
				expect(words).not.toBeNull();
				if (words) {
					expect(contrastRatio(words, tone.against)).toBeGreaterThanOrEqual(
						SCRIM_MIN_CONTRAST,
					);
				}
			}
		}
	});

	test("the fallback pairings are what makes that a guarantee", () => {
		// Every refused colour falls back to its tone's own words, so those two
		// pairings are the floor under the whole check — asserted here rather than
		// assumed, because a scrim tuned darker or lighter later would move them.
		for (const tone of [SCRIM_TONES.dark, SCRIM_TONES.light]) {
			const words = parseHexColor(tone.text);
			expect(words).not.toBeNull();
			if (words) {
				expect(contrastRatio(words, tone.against)).toBeGreaterThanOrEqual(
					SCRIM_MIN_CONTRAST,
				);
			}
		}
	});

	test("the shadow lifts the words the way the scrim runs", () => {
		expect(slideScrimFor("#ffffff", "dark").shadow).toContain("rgba(0, 0, 0");
		expect(slideScrimFor("#111111", "dark").shadow).toContain(
			"rgba(255, 255, 255",
		);
	});
});

describe("where the elements sit (REQ087)", () => {
	test("every placement the schema resolves to has classes", () => {
		// Walked through the schema's enum: a placement added there and never
		// given a layout fails here rather than rendering a slide unaligned.
		for (const layout of SLIDE_LAYOUTS) {
			const classes = slidePlacementClasses({ layout });
			expect(classes.text.length).toBeGreaterThan(0);
			expect(classes.items.length).toBeGreaterThan(0);
			expect(classes.media.length).toBeGreaterThan(0);
		}
		expect(Object.keys(SLIDE_PLACEMENT_CLASSES).sort()).toEqual([
			"center",
			"left",
			"right",
		]);
	});

	test("the three read as three different layouts", () => {
		const seen = new Set(
			Object.values(SLIDE_PLACEMENT_CLASSES).map(
				(classes) => `${classes.text}|${classes.items}|${classes.media}`,
			),
		);
		expect(seen.size).toBe(3);
	});

	test("a slide that defers is laid out the way the theme lays it out", () => {
		expect(slidePlacementClasses({})).toBe(SLIDE_PLACEMENT_CLASSES.center);
		expect(slidePlacementClasses({ layout: "inherit" })).toBe(
			SLIDE_PLACEMENT_CLASSES.center,
		);
	});

	test("the editor offers every layout the schema will store", () => {
		expect(slideLayoutOptions().map((option) => option.value).sort()).toEqual(
			[...SLIDE_LAYOUTS].sort(),
		);
		for (const option of slideLayoutOptions()) {
			expect(option.label.length).toBeGreaterThan(0);
			expect(option.description?.length ?? 0).toBeGreaterThan(0);
		}
	});
});

describe("the two layers together", () => {
	test("a slide's canvas replaces the theme's, and only for that slide", () => {
		// REQ070's "without changing the theme itself": the deck's appearance is a
		// pure function of the deck, so a slide cannot reach it.
		const deck = { theme: "ember" };
		const before = deckThemeAppearance(deck).dark.tokens["--color-surface"];
		const tokens = tokensOf({ backgroundColor: "#102030" }, "dark", deck);
		expect(tokens["--color-surface"]).toBe("#102030");
		expect(deckThemeAppearance(deck).dark.tokens["--color-surface"]).toBe(
			before,
		);
		// And the next slide, which authored nothing, is still the theme's.
		expect(tokensOf({}, "dark", deck)).toEqual({});
	});
});
