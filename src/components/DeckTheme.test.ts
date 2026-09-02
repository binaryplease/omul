/**
 * Unit tests for the theme catalog — the client half of REQ079/REQ080/REQ092/
 * REQ135/REQ136.
 *
 * Two claims, and the slice stands on both:
 *
 *   - **Every theme the schema will store has an appearance on every surface.**
 *     For the built-in set that is the enum walked through the catalog: a theme
 *     added to one and never given a palette fails here instead of rendering a
 *     room in half a design system. For a theme the deck authored, there is no
 *     catalog to walk, so what is asserted instead is that the derivation
 *     produces the *same complete shape* from any brand — including one that
 *     authored nothing.
 *   - **The viewer's light/dark preference survives either kind.** A built-in
 *     theme ships both schemes; an authored one names one canvas and has the
 *     other derived, and both have to be genuinely different palettes or the
 *     scope out-cascades `index.css` and pins the subtree to one scheme.
 *
 * `DeckThemeScope` itself is not exercised: it writes `deckThemeStyle()` onto a
 * div and does nothing else, so the style object is where the content is.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandMarkForm } from "./BrandMark";
import {
	DECK_FONT_STACKS,
	DECK_MARK_SIGNET_PX,
	DECK_THEME_APPEARANCE,
	deckBrandAppearance,
	deckFontOptions,
	deckThemeAppearance,
	deckThemeClassName,
	deckThemeOptions,
	deckThemeStyle,
} from "./DeckTheme";
import {
	authoredColorInputValue,
	contrastRatio,
	formatHexColor,
	parseHexColor,
} from "./color";
import type { DeckBrand } from "../types";
import {
	BUILT_IN_DECK_THEME_IDS,
	CUSTOM_DECK_THEME_ID,
	DECK_FONT_IDS,
	DEFAULT_DECK_FONT,
	DEFAULT_DECK_THEME,
	EMPTY_DECK_BRAND,
} from "../types";

/**
 * The colour tokens a theme must write. Every one of them is declared on `:root`
 * in `index.css`, so a theme that left one out would inherit the house value and
 * paint a two-palette screen — the accent from one theme over the canvas of
 * another.
 *
 * The two `--font-*` tokens are deliberately not here: a face is a property of
 * the theme rather than of one of its colour schemes (REQ092), so it is written
 * once by `deckThemeStyle` from `DECK_FONT_STACKS` and asserted on there.
 */
const REQUIRED_TOKENS = [
	"--color-void",
	"--color-surface",
	"--color-surface-raised",
	"--color-surface-hover",
	"--color-border",
	"--color-border-subtle",
	"--color-text",
	"--color-text-muted",
	"--color-text-dim",
	"--color-accent",
	"--color-accent-hover",
	"--color-accent-dim",
	"--color-accent-glow",
	"--color-poll-1",
];

const SCHEMES = ["dark", "light"] as const;

/**
 * What WCAG 2.1 asks of body text, and what REQ157's accent-as-text seam exists
 * to reach. Icons and bars keep the raw accent at the 3:1 graphics floor, which
 * is why this is asserted only where the accent is drawn as *words*.
 */
const ACCENT_TEXT_MIN_CONTRAST = 4.5;

/** A brand with only the fields a test cares about; the rest unauthored. */
function brand(overrides: Partial<DeckBrand> = {}): DeckBrand {
	return { ...EMPTY_DECK_BRAND, ...overrides };
}

/** A deck wearing the theme it authored — what a surface actually holds. */
function brandedDeck(overrides: Partial<DeckBrand> = {}) {
	return { theme: CUSTOM_DECK_THEME_ID, themeBrand: brand(overrides) };
}

/**
 * The chrome's own colour tokens, read out of `src/index.css`: the dark scheme
 * as the `@theme` block declares it, and the light one as `:root.light` writes
 * over that, with `var(--…)` references resolved inside the scheme doing the
 * referencing.
 *
 * Parsed rather than transcribed, and that is the point. REQ168 makes the house
 * deck theme *equal* to that file, so a list of expected hexes here would be a
 * third copy of the palette — one more place to forget the next time a colour
 * moves, and the failure it would miss is precisely the one this asserts.
 */
function chromeTokens(): Record<"dark" | "light", Record<string, string>> {
	const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8")
		// Comments first: the file's prose quotes token names, and a ratio table
		// inside one reads enough like a declaration to be picked up as one.
		.replace(/\/\*[\s\S]*?\*\//g, "");
	const dark = declarationsIn(css, "@theme {");
	const light = {
		...dark,
		...declarationsIn(css, ":root.light,\n:root.auto {"),
	};
	return { dark: resolvedValues(dark), light: resolvedValues(light) };
}

/**
 * Every family this build actually ships, read the long way round: the
 * `@fontsource*` packages `src/index.css` imports, each one asked what
 * `font-family` its own `@font-face` blocks declare.
 *
 * Two hops rather than one because both can drift independently. An `@import`
 * that was never added ships no file; a family name spelled from memory —
 * `"Figtree"` where the package declares `"Figtree Variable"` — ships the file
 * and resolves past it to the fallback anyway, which looks like working software
 * on a machine that happens to have the face installed.
 */
function bundledFamilies(): Set<string> {
	const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
	const families = new Set<string>();
	for (const [, specifier] of css.matchAll(
		/@import\s+"(@fontsource[^"]+)";/g,
	)) {
		const faceCss = readFileSync(
			join(import.meta.dir, "..", "..", "node_modules", specifier, "index.css"),
			"utf8",
		);
		for (const [, family] of faceCss.matchAll(/font-family:\s*'([^']+)'/g)) {
			families.add(family);
		}
	}
	return families;
}

/**
 * The family a stack leads with, when that is a *name* — `null` when it leads
 * with a generic (`system-ui`, `ui-serif`, `ui-monospace`), which every system
 * resolves and no build has to ship.
 */
function leadingNamedFamily(families: string): string | null {
	const lead = families.split(",")[0].trim();
	const quoted = lead.match(/^"(.+)"$/);
	return quoted ? quoted[1] : null;
}

/** The `--property: value;` pairs of the block a marker opens. */
function declarationsIn(css: string, marker: string): Record<string, string> {
	const opensAt = css.indexOf(marker);
	if (opensAt < 0) {
		throw new Error(`index.css has no \`${marker.trim()}\` block`);
	}
	const block = css.slice(opensAt, css.indexOf("\n}", opensAt));
	const declarations: Record<string, string> = {};
	for (const [, property, value] of block.matchAll(
		/^\s*(--[a-z\d-]+):\s*([^;]+);/gm,
	)) {
		declarations[property] = value.trim();
	}
	return declarations;
}

/** `var(--x)` stands for whatever `--x` is in the same scheme. */
function resolvedValues(
	declarations: Record<string, string>,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	for (const [property, declared] of Object.entries(declarations)) {
		let value = declared;
		// Bounded rather than recursive: a chain this long is a mistake in the
		// stylesheet, and looping forever on a cycle would report it as a hang.
		for (let hop = 0; hop < 4; hop++) {
			const reference = value.match(/^var\((--[a-z\d-]+)\)$/)?.[1];
			if (!reference) break;
			value = declarations[reference] ?? value;
		}
		resolved[property] = value;
	}
	return resolved;
}

describe("every built-in theme has an appearance (REQ079)", () => {
	test("the catalog covers the schema's built-in enum exactly", () => {
		expect(Object.keys(DECK_THEME_APPEARANCE).sort()).toEqual(
			[...BUILT_IN_DECK_THEME_IDS].sort(),
		);
	});

	test("each one names itself and describes itself", () => {
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			const appearance = DECK_THEME_APPEARANCE[theme];
			expect(appearance.label.length).toBeGreaterThan(0);
			expect(appearance.description.length).toBeGreaterThan(0);
			expect(appearance.swatch.canvas).toMatch(/^#[0-9a-f]{6}$/);
			expect(appearance.swatch.accent).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	test("each one is set in a face this build ships (REQ092)", () => {
		// The id is the whole of "loaded so every surface resolves the same face":
		// a theme that named a family directly could name one nobody has.
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			expect(DECK_FONT_IDS).toContain(DECK_THEME_APPEARANCE[theme].font);
		}
	});

	test("each one paints every token, in both colour schemes", () => {
		// Collected rather than asserted one at a time so a failure names every
		// gap at once — "this theme is missing these tokens" is the useful report,
		// not the first missing token in enum order.
		const gaps: string[] = [];
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			for (const scheme of SCHEMES) {
				const { tokens, slideBackground } = DECK_THEME_APPEARANCE[theme][scheme];
				for (const token of REQUIRED_TOKENS) {
					if (!tokens[token]) gaps.push(`${theme}/${scheme} ${token}`);
				}
				// The wash behind a slide is part of the theme, not a per-surface
				// decision — a theme with none would leave `SlideBackground` painting
				// whatever the previous scope left behind.
				if (!slideBackground) gaps.push(`${theme}/${scheme} slideBackground`);
			}
		}
		expect(gaps).toEqual([]);
	});

	test("a theme writes nothing beyond the tokens it declares", () => {
		// The scope is a subtree override of a shared vocabulary. A stray property
		// here would leak into every surface wrapped by it, so the set is closed on
		// purpose and checked as one.
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			for (const scheme of SCHEMES) {
				expect(
					Object.keys(DECK_THEME_APPEARANCE[theme][scheme].tokens).sort(),
				).toEqual([...REQUIRED_TOKENS].sort());
			}
		}
	});

	test("the house theme is what an unthemed surface gets", () => {
		expect(deckThemeAppearance(null)).toBe(
			DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME],
		);
		expect(deckThemeAppearance({})).toBe(
			DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME],
		);
		// An id this build has no palette for resolves through the schema's own
		// fallback, so the catalog is never indexed by something it does not hold.
		expect(deckThemeAppearance({ theme: "neon" })).toBe(
			DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME],
		);
	});
});

/**
 * The chrome's palette, read once. Two claims below need it: that the house
 * theme equals it, and that a scope which inherits it still draws legible words.
 */
const CHROME = chromeTokens();

describe("the house theme is the chrome, to the digit (REQ168)", () => {
	// The claim REQ168 makes is an equality between two files, so this is the one
	// test that reads the other one. `index.css` is parsed rather than
	// transcribed: a transcription is a third copy of the palette and would go
	// stale in exactly the way this is here to prevent.
	const chrome = CHROME;
	const house = DECK_THEME_APPEARANCE.signal;

	test("every role the theme writes holds the chrome's value, per scheme", () => {
		const drift: string[] = [];
		for (const scheme of SCHEMES) {
			for (const token of REQUIRED_TOKENS) {
				const wanted = chrome[scheme][token];
				const held = house[scheme].tokens[token];
				if (!wanted) {
					drift.push(`${scheme} ${token} is declared nowhere in index.css`);
				} else if (held !== wanted) {
					drift.push(`${scheme} ${token}: ${held} ≠ ${wanted}`);
				}
			}
		}
		expect(drift).toEqual([]);
	});

	test("nothing it paints is the retired tangerine or the warm slate", () => {
		// Stated as its own claim because it is REQ168's done-when in the form the
		// requirement writes it, and because it also covers the two places the
		// equality above does not reach: the swatch and the wash behind a slide.
		const retired = [
			"#ff6b35",
			"#ff8555",
			"255, 107, 53",
			"#0a0a0b",
			"#111114",
			"#1a1a1f",
			"#222228",
			"#2a2a32",
			"#1e1e25",
			"#e8e6e3",
			"#8a8690",
			"#5a5660",
			"#f1f5f9",
			"#e2e8f0",
			"#cbd5e1",
			"#94a3b8",
			"#1e293b",
			"#475569",
			"#64748b",
		];
		const painted = SCHEMES.flatMap((scheme) => [
			...Object.values(house[scheme].tokens),
			house[scheme].slideBackground,
		])
			.concat(house.swatch.canvas, house.swatch.accent)
			.join(" ")
			.toLowerCase();
		expect(retired.filter((value) => painted.includes(value))).toEqual([]);
	});

	test("the swatch and the description name the palette it actually has", () => {
		// The picker's card is the only place an organizer is told what the house
		// look *is* before choosing it, so it is held to the theme rather than to
		// whatever it once said.
		expect(house.swatch.canvas).toBe(house.dark.tokens["--color-surface"]);
		expect(house.swatch.accent).toBe(house.dark.tokens["--color-accent"]);
		expect(house.description).not.toMatch(/tangerine|orange|warm slate/i);
	});

	test("what does not move, does not move", () => {
		// REQ168 re-skins the palette and nothing else: the theme keeps its name,
		// its face and its place as what an absent or unknown id resolves to. The
		// last of those is asserted above; these two are the rest of it.
		expect(house.label).toBe("Signal");
		expect(house.font).toBe(DEFAULT_DECK_FONT);
	});
});

/**
 * Every deck that ends up wearing the *house* accent without having asked for
 * it — the population REQ168's contrast obligation is about.
 *
 * The `custom` rows are the ones that bite, and none of them is exotic: a
 * `custom` id is not by itself a palette. `deckBrandFor()` answers a brand for
 * any deck carrying that id — including one where every field is empty — and
 * `deckBrandAppearance()` then hands an unauthored accent the house one. So
 * picking the "Custom" card, or pressing "Use this theme" with an empty brand,
 * puts the house blue inside a scope, one click deep.
 */
const HOUSE_ACCENT_DECKS = [
	null,
	{},
	{ theme: "signal" },
	{ theme: "neon" },
	{ theme: CUSTOM_DECK_THEME_ID },
	brandedDeck(),
	brandedDeck({ name: "Acme" }),
	brandedDeck({ font: "mono" }),
	brandedDeck({ canvas: "#0b1020", text: "#eef2ff" }),
	brandedDeck({ canvas: "#fbfaff" }),
	// A colour the resolver refused is not an authored colour: it comes back as
	// `""` and the house accent stands in its place.
	brandedDeck({ accent: "red" }),
	brandedDeck({ accent: "#ff6b3" }),
];

describe("deckThemeClassName — who the chrome's guard rule reaches (REQ168)", () => {
	test("a deck wearing the house accent goes without it", () => {
		// Nothing to protect: the accent under these scopes *is* `:root`'s, so
		// `.deck-theme` would re-point the accent-as-text seam at a raw accent that
		// measures 3.61:1 as words on Card. A scope that opted out inherits the
		// measured per-scheme value instead.
		for (const deck of HOUSE_ACCENT_DECKS) {
			expect(deckThemeClassName(deck)).toBe("");
		}
	});

	test("a deck that supplied an accent keeps it", () => {
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			if (theme === DEFAULT_DECK_THEME) continue;
			expect(deckThemeClassName({ theme })).toBe("deck-theme");
		}
		// Authored, so the organizer's colour is what those surfaces draw — the
		// exemption follows the accent, not the theme id.
		expect(deckThemeClassName(brandedDeck({ accent: "#0f62fe" }))).toBe(
			"deck-theme",
		);
		expect(
			deckThemeClassName(brandedDeck({ accent: "#0f62fe", canvas: "#0b1020" })),
		).toBe("deck-theme");
	});

	test("no deck inheriting the house accent draws it as words (REQ168)", () => {
		// REQ168's done-when, measured over that whole population rather than over
		// the catalog entry alone: *accent-coloured text inside a deck scope
		// measures at least 4.5:1 against the surface behind it in both schemes*.
		//
		// What a scope resolves `--color-accent-text` to is decided by the class,
		// exactly as `index.css` decides it — `:root`'s per-scheme seam when the
		// scope is exempt, the deck's own raw accent when `.deck-theme` re-points
		// it — so this reads the class the same way the stylesheet does.
		const failures: string[] = [];
		for (const deck of HOUSE_ACCENT_DECKS) {
			for (const scheme of SCHEMES) {
				const variant = deckThemeAppearance(deck)[scheme];
				const drawn =
					deckThemeClassName(deck) === "deck-theme"
						? variant.tokens["--color-accent"]
						: CHROME[scheme]["--color-accent-text"];
				const words = parseHexColor(drawn ?? "");
				for (const surface of ["--color-surface", "--color-surface-raised"]) {
					const behind = parseHexColor(variant.tokens[surface] ?? "");
					if (!words || !behind) {
						failures.push(`${scheme} ${surface} unparseable`);
						continue;
					}
					const ratio = contrastRatio(words, behind);
					if (ratio < ACCENT_TEXT_MIN_CONTRAST) {
						failures.push(
							`${JSON.stringify(deck)} ${scheme} ${drawn} on ` +
								`${variant.tokens[surface]}: ${ratio.toFixed(2)}:1`,
						);
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

describe("the product's fallback mark is the ring signet (REQ169)", () => {
	test("every size a mark is drawn at resolves to the ring, not the wordmark", () => {
		// `DeckMark` asks `BrandMark` for a height and takes the form that height
		// gets (REQ167), so the sizes are the whole of "the participant sees the
		// ring". One raised past the wordmark's floor would quietly draw four
		// letters in a box built for a dot.
		for (const size of ["sm", "md", "lg"] as const) {
			expect(brandMarkForm(DECK_MARK_SIGNET_PX[size])).toBe("signet");
		}
	});
});

describe("every face is a face this build ships (REQ092)", () => {
	test("the stack catalog covers the schema's enum exactly", () => {
		expect(Object.keys(DECK_FONT_STACKS).sort()).toEqual([
			...DECK_FONT_IDS,
		].sort());
	});

	test("each one names a display and a mono family, and describes itself", () => {
		for (const font of DECK_FONT_IDS) {
			const stack = DECK_FONT_STACKS[font];
			expect(stack.label.length).toBeGreaterThan(0);
			expect(stack.description.length).toBeGreaterThan(0);
			// A stack, not a family: every entry ends in a generic the browser is
			// guaranteed to resolve, so no surface falls back to nothing.
			expect(stack.display).toMatch(
				/(sans-serif|serif|monospace|system-ui)\s*$/,
			);
			expect(stack.mono).toMatch(/monospace\s*$/);
		}
	});

	test("the editor offers every face, in the catalog's order", () => {
		expect(deckFontOptions().map((option) => option.value)).toEqual([
			...DECK_FONT_IDS,
		]);
	});

	test("a stack that leads with a named family leads with a bundled one", () => {
		// The claim REQ092 actually makes — "loaded so every surface resolves the
		// same face" — is about what the *first* entry of a stack resolves to. A
		// generic lead (`system-ui`, `ui-serif`) promises nothing and is exempt;
		// a quoted family name is a promise, and it is only true if this build
		// ships the file. Read out of `index.css` and the packages it imports
		// rather than listed here, so retiring a face without retiring its `@import`
		// — or the other way round, which is how REQ178 could have gone wrong —
		// fails here instead of on somebody's projector.
		const bundled = bundledFamilies();
		expect(bundled.size).toBeGreaterThan(0);
		for (const font of DECK_FONT_IDS) {
			const stack = DECK_FONT_STACKS[font];
			for (const families of [stack.display, stack.mono]) {
				const lead = leadingNamedFamily(families);
				if (lead === null) continue;
				expect([font, families, lead, bundled.has(lead)]).toEqual([
					font,
					families,
					lead,
					true,
				]);
			}
		}
	});

	test("the chrome and the house face are one decision (REQ178)", () => {
		// `index.css` resolves `--font-display` on `<html>` and the house deck
		// theme re-declares it inside every scope, so the two are the same face
		// spelled in two files. Held equal for the same reason REQ168 holds the
		// house palette equal to that file: a swap applied to one and not the
		// other is a deck that changes typeface the moment it is wrapped.
		const chrome = chromeTokens().dark;
		const house = DECK_FONT_STACKS[DEFAULT_DECK_FONT];
		expect(chrome["--font-display"]).toBe(house.display);
		expect(chrome["--font-mono"]).toBe(house.mono);
	});
});

describe("a theme the deck authored (REQ080, REQ135)", () => {
	test("paints every token in both schemes, from any brand", () => {
		// Including a brand that authored nothing: "custom" is a place a palette
		// comes from, not a promise that one was supplied, and a half-filled brand
		// must still produce a whole appearance.
		const brands = [
			brand(),
			brand({ accent: "#0f62fe" }),
			brand({ canvas: "#fdfdfd" }),
			brand({ accent: "#e11d48", canvas: "#1b0d12", text: "#fff1f2" }),
			brand({ accent: "#fff", canvas: "#000", text: "#fff" }),
		];
		const gaps: string[] = [];
		for (const authored of brands) {
			const appearance = deckBrandAppearance(authored);
			for (const scheme of SCHEMES) {
				const { tokens, slideBackground } = appearance[scheme];
				for (const token of REQUIRED_TOKENS) {
					if (!tokens[token]) gaps.push(`${authored.accent}/${scheme} ${token}`);
				}
				if (!slideBackground) {
					gaps.push(`${authored.accent}/${scheme} slideBackground`);
				}
				expect(Object.keys(tokens).sort()).toEqual([...REQUIRED_TOKENS].sort());
			}
		}
		expect(gaps).toEqual([]);
	});

	test("the authored colours are the ones on screen", () => {
		const appearance = deckBrandAppearance(
			brand({ accent: "#0f62fe", canvas: "#0b1020", text: "#eef2ff" }),
		);
		// The canvas is dark, so that is the scheme it was authored for, and the
		// three colours reach their tokens untouched.
		expect(appearance.dark.tokens["--color-accent"]).toBe("#0f62fe");
		expect(appearance.dark.tokens["--color-surface"]).toBe("#0b1020");
		expect(appearance.dark.tokens["--color-text"]).toBe("#eef2ff");
		expect(appearance.dark.tokens["--color-poll-1"]).toBe("#0f62fe");
		expect(appearance.dark.slideBackground).toContain("rgba(15, 98, 254");
	});

	test("a light canvas is a light theme, not an inverted dark one", () => {
		// Which scheme a brand was authored for is read off the canvas, because
		// that is the only thing that can say it: an organization whose deck is
		// white paper is authoring the light scheme.
		const appearance = deckBrandAppearance(
			brand({ accent: "#7c3aed", canvas: "#fbfaff", text: "#1a1523" }),
		);
		expect(appearance.light.tokens["--color-surface"]).toBe("#fbfaff");
		expect(appearance.light.tokens["--color-text"]).toBe("#1a1523");
		// And the scheme nobody authored is still a whole palette on the other
		// side of the axis.
		expect(appearance.dark.tokens["--color-surface"]).not.toBe("#fbfaff");
	});

	test("the reader's own light/dark preference stays theirs", () => {
		// The point of deriving the counterpart scheme at all: a deck branded in
		// one is still legible in the other, rather than pinning every phone in
		// the room to the organizer's preference.
		for (const canvas of ["#0b1020", "#fbfaff", "#7f7f7f"]) {
			const appearance = deckBrandAppearance(brand({ canvas }));
			expect(appearance.dark.tokens["--color-surface"]).not.toBe(
				appearance.light.tokens["--color-surface"],
			);
			expect(appearance.dark.tokens["--color-text"]).not.toBe(
				appearance.light.tokens["--color-text"],
			);
		}
	});

	test("an accent invisible on the derived canvas is moved until it is not", () => {
		// A brand authored for a dark room names an accent against a dark canvas.
		// The light scheme is *ours*, not theirs, so an accent that vanished on it
		// would be this module's defect rather than the organizer's choice.
		const appearance = deckBrandAppearance(
			brand({ accent: "#fef08a", canvas: "#111114" }),
		);
		expect(appearance.dark.tokens["--color-accent"]).toBe("#fef08a");
		expect(appearance.light.tokens["--color-accent"]).not.toBe("#fef08a");
	});

	test("what the brand did not name falls back to the house theme", () => {
		const house = DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME];
		const appearance = deckBrandAppearance(brand());
		expect(appearance.dark.tokens["--color-accent"]).toBe(
			house.dark.tokens["--color-accent"],
		);
		expect(appearance.dark.tokens["--color-surface"]).toBe(
			house.dark.tokens["--color-surface"],
		);
		expect(appearance.font).toBe(DEFAULT_DECK_FONT);
	});

	test("the theme is named by the organizer, or called Custom", () => {
		expect(deckBrandAppearance(brand({ name: "Acme" })).label).toBe("Acme");
		expect(deckBrandAppearance(brand({ name: "  " })).label).toBe("Custom");
		expect(deckBrandAppearance(brand()).label).toBe("Custom");
	});

	test("a deck wearing it is drawn in it, and one that is not is not", () => {
		// The id decides. A brand stays stored while a built-in theme is being
		// tried on, and simply is not what the room is drawn in until the deck says
		// so — which is what lets the editor offer both without discarding either.
		const settings = { accent: "#0f62fe", canvas: "#0b1020" };
		expect(
			deckThemeAppearance(brandedDeck(settings)).dark.tokens["--color-accent"],
		).toBe("#0f62fe");
		expect(
			deckThemeAppearance({ theme: "ember", themeBrand: brand(settings) }),
		).toBe(DECK_THEME_APPEARANCE.ember);
	});

	test("a colour outside the grammar leaves the house value standing", () => {
		// Resolved through the schema's own reader, so a surface cannot be handed
		// a string that was never a colour — the refusal is the same one the
		// boundary makes, not a second opinion about it.
		const house = DECK_THEME_APPEARANCE[DEFAULT_DECK_THEME];
		for (const accent of [
			"red",
			"rgb(255,0,0)",
			"var(--color-accent)",
			"#ff6b3",
			"#ff6b35; background: url(https://example.test/x)",
			"url(https://example.test/x)",
		]) {
			const appearance = deckThemeAppearance(brandedDeck({ accent }));
			expect(appearance.dark.tokens["--color-accent"]).toBe(
				house.dark.tokens["--color-accent"],
			);
		}
	});

	test("every colour it writes is a plain hex colour or an rgba()", () => {
		// The tokens are substituted into `background` and `background-image`, so
		// what they are allowed to contain is the narrow thing a colour is —
		// nothing that could carry a second declaration or a URL.
		const appearance = deckBrandAppearance(
			brand({ accent: "#0f62fe", canvas: "#0b1020", text: "#eef2ff" }),
		);
		for (const scheme of SCHEMES) {
			for (const value of Object.values(appearance[scheme].tokens)) {
				expect(value).toMatch(
					/^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [0-9.]+\))$/,
				);
			}
			expect(appearance[scheme].slideBackground).toMatch(
				/^radial-gradient\(125% 85% at 50% 0%, rgba\(\d+, \d+, \d+, [0-9.]+\) 0%, transparent 64%\)$/,
			);
		}
	});
});

describe("deckThemeStyle — what reaches the DOM", () => {
	test("carries the chosen scheme's tokens plus the slide wash", () => {
		const style = deckThemeStyle({ theme: "pulse" }, "dark") as Record<
			string,
			string
		>;
		const variant = DECK_THEME_APPEARANCE.pulse.dark;
		for (const token of REQUIRED_TOKENS) {
			expect(style[token]).toBe(variant.tokens[token]);
		}
		expect(style["--deck-slide-background"]).toBe(variant.slideBackground);
	});

	test("carries the theme's face, built-in or authored (REQ092)", () => {
		// Both `--font-*` tokens *and* the computed family: `index.css` resolves the
		// display face on `<html>`, so a subtree that only re-pointed the token
		// would go on wearing the house face.
		const editorial = deckThemeStyle({ theme: "editorial" }, "dark") as Record<
			string,
			string
		>;
		expect(editorial["--font-display"]).toBe(DECK_FONT_STACKS.serif.display);
		expect(editorial["--font-mono"]).toBe(DECK_FONT_STACKS.serif.mono);
		expect(editorial.fontFamily).toBe("var(--font-display)");

		const authored = deckThemeStyle(
			brandedDeck({ font: "mono" }),
			"dark",
		) as Record<string, string>;
		expect(authored["--font-display"]).toBe(DECK_FONT_STACKS.mono.display);
		expect(authored["--font-mono"]).toBe(DECK_FONT_STACKS.mono.mono);
	});

	test("the two colour schemes are genuinely different palettes", () => {
		// The viewer's light/dark preference stays theirs: a theme that answered
		// the same tokens for both would out-cascade `index.css`'s `:root.light`
		// overrides and pin the whole subtree to one scheme.
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			const dark = deckThemeStyle({ theme }, "dark") as Record<string, string>;
			const light = deckThemeStyle({ theme }, "light") as Record<string, string>;
			expect(dark["--color-void"]).not.toBe(light["--color-void"]);
			expect(dark["--color-text"]).not.toBe(light["--color-text"]);
		}
	});

	test("generates no box of its own", () => {
		// `display: contents` is why wrapping a page in the scope cannot move,
		// size or reflow anything below it.
		expect(
			(deckThemeStyle(null, "dark") as Record<string, string>).display,
		).toBe("contents");
	});
});

describe("deckThemeOptions — the editor's picker (ADR-0026)", () => {
	test("offers every built-in theme in the catalog's order, then the deck's own", () => {
		expect(deckThemeOptions(null).map((option) => option.value)).toEqual([
			...BUILT_IN_DECK_THEME_IDS,
			CUSTOM_DECK_THEME_ID,
		]);
	});

	test("each built-in choice carries the label and description of its theme", () => {
		for (const option of deckThemeOptions(null)) {
			if (option.value === CUSTOM_DECK_THEME_ID) continue;
			const appearance = DECK_THEME_APPEARANCE[option.value];
			expect(option.label).toBe(appearance.label);
			expect(option.description).toBe(appearance.description);
		}
	});

	test("the deck's own choice wears the brand it currently carries", () => {
		// An organizer picking it sees the colours they authored on the card,
		// rather than a placeholder for them.
		const authored = brand({ name: "Acme", accent: "#0f62fe" });
		const option = deckThemeOptions(authored).at(-1);
		expect(option?.value).toBe(CUSTOM_DECK_THEME_ID);
		expect(option?.label).toBe("Acme");
		// And the picker still draws it before a deck has been loaded.
		expect(deckThemeOptions(null).at(-1)?.label).toBe("Custom");
	});
});

describe("colour helpers", () => {
	test("reads both hex forms and writes only the long one", () => {
		expect(parseHexColor("#f63")).toEqual({ red: 255, green: 102, blue: 51 });
		expect(parseHexColor("#FF6633")).toEqual({ red: 255, green: 102, blue: 51 });
		expect(formatHexColor({ red: 255, green: 102, blue: 51 })).toBe("#ff6633");
		expect(parseHexColor("#ff663")).toBeNull();
		expect(parseHexColor("rebeccapurple")).toBeNull();
		expect(parseHexColor("")).toBeNull();
	});

	test("a native colour input shows the fallback until a colour is typed", () => {
		// `<input type="color">` has no "unset" — it always reports something — so
		// the two controls that author one field need one answer to what it shows.
		expect(authoredColorInputValue("#f63", "#111114")).toBe("#ff6633");
		expect(authoredColorInputValue("", "#111114")).toBe("#111114");
		expect(authoredColorInputValue("#ff", "#111114")).toBe("#111114");
	});
});
