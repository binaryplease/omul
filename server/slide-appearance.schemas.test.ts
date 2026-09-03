/**
 * Unit tests for a slide's own appearance — the layer over the deck's theme.
 *
 * Covers the shared vocabulary and its resolver (no DB, no network):
 *   - REQ087 — a slide carries its own layout: placement, background, colours,
 *     layered over the theme's defaults
 *   - REQ070 — a background colour that overrides the theme's without changing
 *     the theme itself
 *   - REQ071 — a background image, and the URLs a browser must never be handed
 *     for one
 *   - REQ019 — text and chart colours overridden per slide
 *
 * The claim these pin is the one the whole slice stands on: **unauthored means
 * the theme's.** Every field has an empty value, the resolver answers with it,
 * and a value that is not a colour or not a loadable URL lands on the same
 * empty rather than on a repaired guess. What those resolved values *look* like
 * is `src/components/SlideAppearance.test.ts`; the round-trip through the real
 * app is `slide-appearance.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	AUTHORED_COLOR_PATTERN,
	authoredColorFor,
	browserSafeAssetUrl,
	DEFAULT_SLIDE_PLACEMENT,
	SLIDE_LAYOUTS,
	SlideSchema,
	slideAppearanceFor,
} from "./schemas";

/** The minimum a slide needs to parse. */
function slide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "s1",
		type: "multiple-choice",
		question: "Which?",
		...overrides,
	});
}

describe("the appearance fields a slide stores (REQ087)", () => {
	test("a slide that authored nothing carries every field, empty", () => {
		// The fields exist on every slide, so no read site
		// reaches for `??` and no surface has to tell "unset" from "absent".
		const parsed = slide();
		expect(parsed.layout).toBe("inherit");
		expect(parsed.backgroundColor).toBe("");
		expect(parsed.backgroundImage).toBe("");
		expect(parsed.textColor).toBe("");
		expect(parsed.chartColor).toBe("");
	});

	test("an authored appearance round-trips exactly as written", () => {
		const parsed = slide({
			layout: "left",
			backgroundColor: "#102030",
			backgroundImage: "https://example.com/bg.jpg",
			textColor: "#ffffff",
			chartColor: "#10b981",
		});
		expect(parsed.layout).toBe("left");
		expect(parsed.backgroundColor).toBe("#102030");
		expect(parsed.backgroundImage).toBe("https://example.com/bg.jpg");
		expect(parsed.textColor).toBe("#ffffff");
		expect(parsed.chartColor).toBe("#10b981");
	});

	test("every layout the enum names is storable", () => {
		// Walked rather than sampled: a placement added to the enum and forgotten
		// on the boundary fails here rather than on somebody's projector.
		for (const layout of SLIDE_LAYOUTS) {
			expect(slide({ layout }).layout).toBe(layout);
		}
	});

	test("a layout nobody defined is refused before it is stored", () => {
		expect(
			SlideSchema.safeParse({ id: "s1", type: "text", question: "", layout: "diagonal" })
				.success,
		).toBe(false);
	});

	test("a colour outside the grammar is refused before it is stored", () => {
		// The narrow grammar is the whole reason these values may be written into
		// a `background`: a hand-built request cannot put anything but a colour
		// into a colour.
		for (const field of ["backgroundColor", "textColor", "chartColor"]) {
			for (const value of ["rebeccapurple", "rgb(1,2,3)", "#ff663", "var(--x)"]) {
				expect(
					SlideSchema.safeParse({
						id: "s1",
						type: "text",
						question: "",
						[field]: value,
					}).success,
				).toBe(false);
			}
			expect(
				SlideSchema.safeParse({
					id: "s1",
					type: "text",
					question: "",
					[field]: "#f63",
				}).success,
			).toBe(true);
		}
	});

	test("the grammar is both hex forms and the empty string, and nothing else", () => {
		expect(AUTHORED_COLOR_PATTERN.test("")).toBe(true);
		expect(AUTHORED_COLOR_PATTERN.test("#fff")).toBe(true);
		expect(AUTHORED_COLOR_PATTERN.test("#FF6633")).toBe(true);
		expect(AUTHORED_COLOR_PATTERN.test("#ff66")).toBe(false);
		expect(AUTHORED_COLOR_PATTERN.test("white")).toBe(false);
	});
});

describe("authoredColorFor — one colour, one answer", () => {
	test("keeps a colour, normalizes its case, and empties anything else", () => {
		expect(authoredColorFor("#f63")).toBe("#f63");
		expect(authoredColorFor("#FF6633")).toBe("#ff6633");
		expect(authoredColorFor("  #ff6633  ")).toBe("#ff6633");
		expect(authoredColorFor("")).toBe("");
		expect(authoredColorFor(null)).toBe("");
		expect(authoredColorFor(undefined)).toBe("");
		expect(authoredColorFor("rebeccapurple")).toBe("");
		expect(authoredColorFor("#ff663")).toBe("");
	});
});

describe("browserSafeAssetUrl — the URLs artwork may arrive over (REQ071)", () => {
	test("http(s) and root-relative addresses are served as they were written", () => {
		expect(browserSafeAssetUrl("https://example.com/bg.jpg")).toBe(
			"https://example.com/bg.jpg",
		);
		expect(browserSafeAssetUrl("http://example.com/bg.jpg")).toBe(
			"http://example.com/bg.jpg",
		);
		expect(browserSafeAssetUrl("/uploads/bg.jpg")).toBe("/uploads/bg.jpg");
		expect(browserSafeAssetUrl("  https://example.com/bg.jpg  ")).toBe(
			"https://example.com/bg.jpg",
		);
	});

	test("anything a browser must not be handed comes back empty", () => {
		// Refused rather than repaired: this value reaches a `background-image`,
		// and the safe answer is no picture at all.
		expect(browserSafeAssetUrl("javascript:alert(1)")).toBe("");
		expect(browserSafeAssetUrl("data:image/svg+xml;base64,AAA")).toBe("");
		expect(browserSafeAssetUrl("//evil.example/bg.jpg")).toBe("");
		expect(browserSafeAssetUrl("not a url")).toBe("");
		expect(browserSafeAssetUrl("")).toBe("");
		expect(browserSafeAssetUrl(null)).toBe("");
	});
});

describe("slideAppearanceFor — the one read site (REQ087)", () => {
	test("a slide that authored nothing resolves to the theme's, everywhere", () => {
		const appearance = slideAppearanceFor(slide());
		expect(appearance.placement).toBe(DEFAULT_SLIDE_PLACEMENT);
		expect(appearance.backgroundColor).toBe("");
		expect(appearance.backgroundImage).toBe("");
		expect(appearance.textColor).toBe("");
		expect(appearance.chartColor).toBe("");
	});

	test("`inherit` resolves to the theme's placement, not to a fourth value", () => {
		expect(slideAppearanceFor({ layout: "inherit" }).placement).toBe(
			DEFAULT_SLIDE_PLACEMENT,
		);
		// And so does a layout this build has never heard of — a hand-built deck,
		// or a placement added and later renamed, lands on one fallback rather
		// than on whichever each surface picked.
		expect(slideAppearanceFor({ layout: "diagonal" }).placement).toBe(
			DEFAULT_SLIDE_PLACEMENT,
		);
		expect(slideAppearanceFor({}).placement).toBe(DEFAULT_SLIDE_PLACEMENT);
	});

	test("each authored placement is the placement that comes back", () => {
		expect(slideAppearanceFor({ layout: "left" }).placement).toBe("left");
		expect(slideAppearanceFor({ layout: "right" }).placement).toBe("right");
		expect(slideAppearanceFor({ layout: "center" }).placement).toBe("center");
	});

	test("a half-built editor slide resolves exactly as a stored one does", () => {
		// The editor holds slides whose defaults have not been applied; the
		// resolver takes both, or the preview would disagree with the projector.
		expect(slideAppearanceFor({ backgroundColor: "#FFF" })).toEqual({
			placement: "center",
			backgroundColor: "#fff",
			backgroundImage: "",
			textColor: "",
			chartColor: "",
		});
	});

	test("a value that slipped past a boundary still resolves to the theme's", () => {
		// The resolver is the guard as well as the read site: a document written
		// before the field was validated, or a value patched in around the schema,
		// must not reach a stylesheet.
		const appearance = slideAppearanceFor({
			layout: "  center  ",
			backgroundColor: "red; background: url(x)",
			backgroundImage: "javascript:alert(1)",
			textColor: "#nope",
			chartColor: "",
		});
		expect(appearance).toEqual({
			placement: "center",
			backgroundColor: "",
			backgroundImage: "",
			textColor: "",
			chartColor: "",
		});
	});

	test("overriding one thing overrides one thing (REQ070/REQ019)", () => {
		// The layering, stated as a test: a slide that recoloured its canvas has
		// said nothing about its words or its bars, and the theme still answers
		// for those.
		const appearance = slideAppearanceFor(slide({ backgroundColor: "#102030" }));
		expect(appearance.backgroundColor).toBe("#102030");
		expect(appearance.textColor).toBe("");
		expect(appearance.chartColor).toBe("");
		expect(appearance.placement).toBe(DEFAULT_SLIDE_PLACEMENT);
	});
});
