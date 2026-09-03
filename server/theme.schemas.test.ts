/**
 * Unit tests for a deck's theming — the built-in set, the theme a deck authors
 * for itself, the face it is set in and the mark it carries.
 *
 * Covers the shared vocabulary and its resolvers (no DB, no network):
 *   - REQ079 — a deck carries a theme chosen from a built-in set, and nothing
 *     outside that set is storable
 *   - REQ080/REQ135 — a theme can be defined on the deck instead, stored on the
 *     same field and validated at the same boundary
 *   - REQ092 — a theme names the face its text renders in, from the closed set
 *     this build ships
 *   - REQ136 — a theme carries a logo image, resolved once for every surface
 *
 * The rules live here rather than on a surface because all three read them: the
 * presenter's screen, every participant's phone and the join screen ask the same
 * functions. These tests pin the rules themselves; the round-trip through the
 * real app is in `theme.integration.test.ts`, and what an authored theme *looks*
 * like is `src/components/DeckTheme.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	BUILT_IN_DECK_THEME_IDS,
	builtInDeckThemeIdFor,
	CreatePresentationSchema,
	CUSTOM_DECK_THEME_ID,
	DECK_FONT_IDS,
	DECK_THEME_IDS,
	DECK_TITLE_MAX_LENGTH,
	deckBrandColorFor,
	deckBrandFor,
	DEFAULT_DECK_FONT,
	DEFAULT_DECK_THEME,
	deckFontIdFor,
	deckLogoFor,
	deckThemeIdFor,
	EMPTY_DECK_BRAND,
	PresentationSchema,
	RETIRED_DECK_FONT_IDS,
	StoredPresentationSchema,
} from "./schemas";

/** The minimum a presentation document needs to parse. */
function deck(overrides: Record<string, unknown> = {}) {
	return {
		id: "p",
		code: "123456",
		title: "Deck",
		slides: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("the built-in set is closed (REQ079)", () => {
	test("every built-in theme round-trips through all three schemas", () => {
		for (const theme of DECK_THEME_IDS) {
			expect(PresentationSchema.parse(deck({ theme })).theme).toBe(theme);
			expect(
				StoredPresentationSchema.parse(deck({ theme, code: "1" })).theme,
			).toBe(theme);
			expect(
				CreatePresentationSchema.parse({
					title: "Deck",
					slides: [{ id: "s", type: "text", question: "Hi" }],
					theme,
				}).theme,
			).toBe(theme);
		}
	});

	test("a theme nobody designed is refused at the boundary, not rendered", () => {
		// The refusal is the whole content of "chosen from a built-in set": a
		// palette the surfaces have no colours for would be a deck the projector
		// cannot draw, so it never becomes a stored document in the first place.
		expect(PresentationSchema.safeParse(deck({ theme: "neon" })).success).toBe(
			false,
		);
		expect(
			StoredPresentationSchema.safeParse(deck({ theme: "neon" })).success,
		).toBe(false);
		expect(
			CreatePresentationSchema.safeParse({
				title: "Deck",
				slides: [{ id: "s", type: "text", question: "Hi" }],
				theme: "neon",
			}).success,
		).toBe(false);
	});

	test("an unstated theme is the house theme, on every write path", () => {
		// The default has to be the appearance existing decks already had — a
		// document written before this field existed re-parses forward onto it.
		expect(PresentationSchema.parse(deck()).theme).toBe(DEFAULT_DECK_THEME);
		expect(StoredPresentationSchema.parse({ id: "p" }).theme).toBe(
			DEFAULT_DECK_THEME,
		);
		expect(StoredPresentationSchema.shape.theme.parse(undefined)).toBe(
			DEFAULT_DECK_THEME,
		);
		expect(DEFAULT_DECK_THEME).toBe("signal");
	});

	test("the logo fields are always present, never absent", () => {
		const parsed = PresentationSchema.parse(deck());
		expect(parsed.themeLogoUrl).toBe("");
		expect(parsed.themeLogoAlt).toBe("");
		const stored = StoredPresentationSchema.parse({ id: "p" });
		expect(stored.themeLogoUrl).toBe("");
		expect(stored.themeLogoAlt).toBe("");
	});
});

describe("a theme the deck defines for itself (REQ080, REQ135)", () => {
	test("is stored on the same field, at the same boundary, as a built-in one", () => {
		// The whole of "exactly as a built-in one is": there is no second theming
		// endpoint and no second field to set — `custom` is a value of `theme`.
		expect(DECK_THEME_IDS).toContain(CUSTOM_DECK_THEME_ID);
		const authored = {
			theme: CUSTOM_DECK_THEME_ID,
			themeBrand: {
				name: "Acme",
				accent: "#0f62fe",
				canvas: "#0b1020",
				text: "#eef2ff",
				font: "serif",
			},
		} as const;
		for (const parsed of [
			PresentationSchema.parse(deck(authored)),
			StoredPresentationSchema.parse(deck(authored)),
			CreatePresentationSchema.parse({
				title: "Deck",
				slides: [{ id: "s", type: "text", question: "Hi" }],
				...authored,
			}),
		]) {
			expect(parsed.theme).toBe(CUSTOM_DECK_THEME_ID);
			expect(parsed.themeBrand).toEqual(authored.themeBrand);
		}
	});

	test("an unstated brand is present and empty, never absent", () => {
		// A deck written before this field existed re-parses forward onto it, and
		// the audience's view of a branded deck and an unbranded one are the same
		// complete shape — so no client reaches for `??`.
		expect(PresentationSchema.parse(deck()).themeBrand).toEqual(
			EMPTY_DECK_BRAND,
		);
		expect(StoredPresentationSchema.parse({ id: "p" }).themeBrand).toEqual(
			EMPTY_DECK_BRAND,
		);
		expect(EMPTY_DECK_BRAND).toEqual({
			name: "",
			accent: "",
			canvas: "",
			text: "",
			font: DEFAULT_DECK_FONT,
		});
	});

	test("a partly-authored brand is a brand", () => {
		// "Our orange" is a brand. Every field defaults, so naming one is enough
		// and the rest stays the house theme's.
		const parsed = PresentationSchema.parse(
			deck({ theme: CUSTOM_DECK_THEME_ID, themeBrand: { accent: "#0f62fe" } }),
		);
		expect(parsed.themeBrand).toEqual({
			...EMPTY_DECK_BRAND,
			accent: "#0f62fe",
		});
	});

	test("a colour that is not a colour never reaches storage", () => {
		// The narrow grammar is the point: these values are substituted into a
		// `background` and a `background-image`, so anything that could carry a
		// second declaration or a URL is refused where it is written.
		for (const accent of [
			"red",
			"rgb(255, 0, 0)",
			"var(--color-accent)",
			"#ff6b3",
			"#ff6b35 ",
			"#ff6b35; background: url(https://example.test/x)",
			"url(https://example.test/x)",
			"javascript:alert(1)",
		]) {
			const authored = {
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: { accent },
			};
			expect(PresentationSchema.safeParse(deck(authored)).success).toBe(false);
			expect(StoredPresentationSchema.safeParse(deck(authored)).success).toBe(
				false,
			);
			expect(
				CreatePresentationSchema.safeParse({
					title: "Deck",
					slides: [{ id: "s", type: "text", question: "Hi" }],
					...authored,
				}).success,
			).toBe(false);
		}
	});

	test("the theme's name is capped where the deck's title is", () => {
		// Authored display text on a document every phone in the room receives, so
		// it takes the same ceiling the deck's own title does rather than none.
		const name = "n".repeat(DECK_TITLE_MAX_LENGTH);
		expect(
			PresentationSchema.parse(
				deck({ theme: CUSTOM_DECK_THEME_ID, themeBrand: { name } }),
			).themeBrand.name,
		).toBe(name);
		for (const schema of [PresentationSchema, StoredPresentationSchema]) {
			expect(
				schema.safeParse(
					deck({
						theme: CUSTOM_DECK_THEME_ID,
						themeBrand: { name: `${name}n` },
					}),
				).success,
			).toBe(false);
		}
		expect(
			CreatePresentationSchema.safeParse({
				title: "Deck",
				slides: [{ id: "s", type: "text", question: "Hi" }],
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: { name: `${name}n` },
			}).success,
		).toBe(false);
	});

	test("a face this build does not ship never reaches storage (REQ092)", () => {
		// Nothing here is fetched from a third-party host at runtime, so a theme
		// may only name what the bundle carries — a family string would be a face
		// that resolves differently on every machine in the room.
		expect(
			PresentationSchema.safeParse(
				deck({
					theme: CUSTOM_DECK_THEME_ID,
					themeBrand: { font: "Comic Sans MS" },
				}),
			).success,
		).toBe(false);
		for (const font of DECK_FONT_IDS) {
			expect(
				PresentationSchema.parse(
					deck({ theme: CUSTOM_DECK_THEME_ID, themeBrand: { font } }),
				).themeBrand.font,
			).toBe(font);
		}
	});
});

describe("a retired face id folds forward, it does not lock a deck out (REQ178)", () => {
	// The set is closed and the docstore gate re-parses on every read, so an id
	// simply deleted from it would not degrade a deck's typography — it would stop
	// the deck opening. What is asserted here is the other outcome: the deck opens,
	// and it opens in the face that replaced the one it named.

	test("every retired id names a face this build still ships", () => {
		// A fold onto an id nobody ships would be the same lockout one indirection
		// later, so the map's own values are held to the closed set.
		for (const [retired, replacement] of Object.entries(RETIRED_DECK_FONT_IDS)) {
			expect([retired, DECK_FONT_IDS.includes(replacement)]).toEqual([
				retired,
				true,
			]);
			expect([retired, DECK_FONT_IDS as readonly string[]]).toEqual([
				retired,
				expect.not.arrayContaining([retired]),
			]);
		}
	});

	test("a document stored under `sora` parses, and reads back as the house face", () => {
		// Both schemas, because the two are different call sites: a deck written
		// before the face moved is read through the stored one and handed to a room
		// through the public one.
		for (const schema of [PresentationSchema, StoredPresentationSchema]) {
			expect(
				schema.parse(
					deck({
						code: "1",
						theme: CUSTOM_DECK_THEME_ID,
						themeBrand: { accent: "#0f62fe", font: "sora" },
					}),
				).themeBrand,
			).toEqual({
				name: "",
				accent: "#0f62fe",
				canvas: "",
				text: "",
				font: DEFAULT_DECK_FONT,
			});
		}
	});

	test("the resolvers agree with the gate", () => {
		// `deckFontIdFor` is what every surface reads through, so a fold the schema
		// performs and the resolver does not would put one face on the projector and
		// another on the phones.
		expect(deckFontIdFor("sora")).toBe(DEFAULT_DECK_FONT);
		expect(deckFontIdFor("  sora  ")).toBe(DEFAULT_DECK_FONT);
		expect(
			deckBrandFor({
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: { font: "sora" },
			})?.font,
		).toBe(DEFAULT_DECK_FONT);
	});

	test("a retired id is accepted at the door and never comes back out", () => {
		// Accepted, because a client built against the old vocabulary is not a
		// malformed client; folded, because nothing downstream should have to know
		// the old id ever existed.
		const created = CreatePresentationSchema.parse({
			title: "Deck",
			slides: [{ id: "s", type: "text", question: "Hi" }],
			theme: CUSTOM_DECK_THEME_ID,
			themeBrand: { font: "sora" },
		});
		expect(created.themeBrand.font).toBe(DEFAULT_DECK_FONT);
	});
});

describe("deckBrandFor — the one read of an authored theme (REQ080)", () => {
	test("reads back what the deck authored", () => {
		expect(
			deckBrandFor({
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: {
					name: "  Acme  ",
					accent: "#0F62FE",
					canvas: "#0b1020",
					text: "",
					font: "mono",
				},
			}),
		).toEqual({
			name: "Acme",
			// Normalized, so `#0F62FE` and `#0f62fe` are one colour rather than two.
			accent: "#0f62fe",
			canvas: "#0b1020",
			text: "",
			font: "mono",
		});
	});

	test("a deck wearing a built-in theme has no authored one", () => {
		// The id decides, so "is this deck branded?" is one question. The brand
		// stays stored while a built-in theme is tried on — trying `Ember` must not
		// throw away the colours somebody authored.
		expect(
			deckBrandFor({ theme: "ember", themeBrand: { accent: "#0f62fe" } }),
		).toBeNull();
		expect(deckBrandFor({})).toBeNull();
		expect(deckBrandFor({ theme: "neon" })).toBeNull();
	});

	test("a value outside the grammar reads as unauthored, not as itself", () => {
		// The same stance `deckLogoFor` takes: the safe answer is the default, so a
		// surface that asked the resolver cannot be handed a string that was never
		// a colour — whatever a hand-built document, or a build that later widened
		// the grammar, happens to hold.
		expect(
			deckBrandFor({
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: {
					accent: "url(https://example.test/x)",
					canvas: "rgb(0,0,0)",
					text: null,
					font: "Comic Sans MS",
				},
			}),
		).toEqual({
			name: "",
			accent: "",
			canvas: "",
			text: "",
			font: DEFAULT_DECK_FONT,
		});
	});

	test("the resolver reads a parsed presentation as-is", () => {
		// The shape a route hands to a client is the shape the surfaces resolve, so
		// the two cannot disagree about what this deck is drawn in.
		const parsed = PresentationSchema.parse(
			deck({
				theme: CUSTOM_DECK_THEME_ID,
				themeBrand: { accent: "#0f62fe", font: "serif" },
			}),
		);
		expect(deckBrandFor(parsed)).toEqual({
			name: "",
			accent: "#0f62fe",
			canvas: "",
			text: "",
			font: "serif",
		});
	});
});

describe("deckBrandColorFor / deckFontIdFor — the value resolvers", () => {
	test("both hex forms are colours; nothing else is", () => {
		expect(deckBrandColorFor("#f63")).toBe("#f63");
		expect(deckBrandColorFor("#FF6633")).toBe("#ff6633");
		expect(deckBrandColorFor("  #ff6633  ")).toBe("#ff6633");
		expect(deckBrandColorFor("")).toBe("");
		expect(deckBrandColorFor(null)).toBe("");
		expect(deckBrandColorFor("#ff663")).toBe("");
		expect(deckBrandColorFor("rebeccapurple")).toBe("");
	});

	test("a face outside the set is the house face, everywhere at once", () => {
		for (const font of DECK_FONT_IDS) {
			expect(deckFontIdFor(font)).toBe(font);
		}
		expect(deckFontIdFor("  serif  ")).toBe("serif");
		expect(deckFontIdFor("Comic Sans MS")).toBe(DEFAULT_DECK_FONT);
		expect(deckFontIdFor("")).toBe(DEFAULT_DECK_FONT);
		expect(deckFontIdFor(null)).toBe(DEFAULT_DECK_FONT);
	});
});

describe("deckThemeIdFor — one fallback, not one per surface (REQ079)", () => {
	test("reads back every built-in theme unchanged", () => {
		for (const theme of DECK_THEME_IDS) {
			expect(deckThemeIdFor({ theme })).toBe(theme);
		}
	});

	test("a theme this build does not know resolves to the house theme", () => {
		// Not a hypothetical: a document written by a later build, or a palette
		// that was renamed. The point is that all three surfaces land on the *same*
		// fallback, so a room is never half-repainted.
		expect(deckThemeIdFor({ theme: "neon" })).toBe(DEFAULT_DECK_THEME);
		expect(deckThemeIdFor({ theme: "" })).toBe(DEFAULT_DECK_THEME);
		expect(deckThemeIdFor({ theme: null })).toBe(DEFAULT_DECK_THEME);
		expect(deckThemeIdFor({})).toBe(DEFAULT_DECK_THEME);
	});

	test("surrounding whitespace is not a different theme", () => {
		expect(deckThemeIdFor({ theme: "  pulse  " })).toBe("pulse");
	});

	test("builtInDeckThemeIdFor answers which palette to index, always", () => {
		// The catalog of built-in palettes has no entry for a theme the deck
		// authored, so the question "which entry does this deck index?" needs an
		// answer for a deck that indexes none — and it is the house theme, the same
		// one every other unresolvable theme lands on.
		for (const theme of BUILT_IN_DECK_THEME_IDS) {
			expect(builtInDeckThemeIdFor({ theme })).toBe(theme);
		}
		expect(builtInDeckThemeIdFor({ theme: CUSTOM_DECK_THEME_ID })).toBe(
			DEFAULT_DECK_THEME,
		);
		expect(builtInDeckThemeIdFor({})).toBe(DEFAULT_DECK_THEME);
	});
});

describe("deckLogoFor — the mark, and the URLs it refuses (REQ136)", () => {
	test("an http(s) URL is the deck's mark", () => {
		expect(deckLogoFor({ themeLogoUrl: "https://example.test/logo.svg" })).toEqual(
			{ url: "https://example.test/logo.svg", alt: "" },
		);
		expect(deckLogoFor({ themeLogoUrl: "http://example.test/logo.png" })).toEqual(
			{ url: "http://example.test/logo.png", alt: "" },
		);
	});

	test("a root-relative path is a file this deployment already serves", () => {
		expect(deckLogoFor({ themeLogoUrl: "/brand/mark.svg" })).toEqual({
			url: "/brand/mark.svg",
			alt: "",
		});
	});

	test("a deck with no logo has no logo", () => {
		expect(deckLogoFor({})).toBeNull();
		expect(deckLogoFor({ themeLogoUrl: "" })).toBeNull();
		expect(deckLogoFor({ themeLogoUrl: "   " })).toBeNull();
		expect(deckLogoFor({ themeLogoUrl: null })).toBeNull();
	});

	test("a scheme no branding arrives over is refused, not repaired", () => {
		// The safe answer is the default (see the module header): every one of
		// these resolves to "no logo", and the surface falls back to the product's
		// own mark rather than putting the string into an attribute.
		expect(deckLogoFor({ themeLogoUrl: "javascript:alert(1)" })).toBeNull();
		expect(
			deckLogoFor({ themeLogoUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }),
		).toBeNull();
		expect(deckLogoFor({ themeLogoUrl: "file:///etc/passwd" })).toBeNull();
		expect(deckLogoFor({ themeLogoUrl: "not a url at all" })).toBeNull();
		// A protocol-relative URL names a scheme the checks above never get to
		// see, so it is refused rather than inheriting the page's.
		expect(deckLogoFor({ themeLogoUrl: "//evil.test/logo.svg" })).toBeNull();
	});

	test("the mark is named by its description, then by the deck, then not at all", () => {
		const url = "https://example.test/logo.svg";
		expect(
			deckLogoFor({ themeLogoUrl: url, themeLogoAlt: "Acme", title: "Q3 review" })
				?.alt,
		).toBe("Acme");
		// No description authored: the room calls this presentation by its title,
		// so that is what the mark announces itself as.
		expect(deckLogoFor({ themeLogoUrl: url, title: "Q3 review" })?.alt).toBe(
			"Q3 review",
		);
		expect(
			deckLogoFor({ themeLogoUrl: url, themeLogoAlt: "   ", title: "Q3 review" })
				?.alt,
		).toBe("Q3 review");
		// Neither: the mark is decorative and says so, rather than announcing a
		// filename or an empty heading.
		expect(deckLogoFor({ themeLogoUrl: url })?.alt).toBe("");
	});

	test("the resolver reads a parsed presentation as-is", () => {
		// The shape a route hands to a client is the shape the surfaces resolve, so
		// the two cannot disagree about which deck carries a mark.
		const parsed = PresentationSchema.parse(
			deck({
				theme: "editorial",
				themeLogoUrl: "https://example.test/logo.svg",
				themeLogoAlt: "Acme",
			}),
		);
		expect(deckThemeIdFor(parsed)).toBe("editorial");
		expect(deckLogoFor(parsed)).toEqual({
			url: "https://example.test/logo.svg",
			alt: "Acme",
		});
	});
});
