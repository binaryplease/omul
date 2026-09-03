/**
 * Unit tests for the editor's authoring column (REQ152).
 *
 * Promoting the slide to the stage moved the page's *subject*, not its work:
 * every control an organizer operates — the type changer, the question and
 * option fields, the reorder and delete buttons, the whole deck-settings panel
 * — now lives in the column beside the canvas. That column is a named region,
 * and the name is what a reader arriving by landmark is told they are standing
 * in. Two things have to hold for that to be worth anything:
 *
 *   - **It is named at all.** An unnamed region announces as bare "region", and
 *     the caller who reaches it learns nothing about what it holds.
 *   - **The two panels are named apart.** One column, two surfaces, swapped by
 *     the rail — if both wore one name, the region would report the same thing
 *     whether it held the slide's form or the deck's settings, which is exactly
 *     the ambiguity naming it was supposed to remove.
 *
 * The other half of that fix — that the column is a labelled `<section>` inside
 * `<main>` rather than an `<aside>` — is markup, and this repo renders no DOM in
 * tests; it is asserted by reading `CreatePage.tsx`, not here.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DECK_THEME_APPEARANCE } from "../components/DeckTheme";
import { editorColumnLabel } from "./CreatePage";

describe("the authoring column names what it holds (REQ152)", () => {
	test("the deck's panel is called what the rail calls it", () => {
		expect(editorColumnLabel("settings")).toBe("Presentation settings");
	});

	test("a slide's form is named, whichever slide is selected", () => {
		for (const index of [0, 1, 7, 148]) {
			expect(editorColumnLabel(index)).toBe("Slide settings");
		}
	});

	test("the two panels are never announced as the same region", () => {
		expect(editorColumnLabel(0)).not.toBe(editorColumnLabel("settings"));
	});
});

/**
 * The deck-settings panel's three brand-colour fields state what a deck that
 * authored nothing currently *inherits* — `ColorField`'s `placeholder` is
 * documented as exactly that, and it is load-bearing twice: it paints the
 * collapsed swatch chip, and it seeds the native colour picker. A placeholder
 * that names some other colour makes the chip report a value the deck does not
 * have, and makes opening the picker and confirming without dragging
 * *write* that colour — silently re-branding a deck somebody meant to inspect.
 *
 * What is inherited is the house **deck theme**. REQ166 re-skinned the chrome
 * and left that theme on the retired tangerine, so for a while the two named
 * different colours; REQ168 moved the theme onto the chrome's values and they
 * name the same ones again. Which one this reads from still matters — they are
 * two catalogs and a later decision can part them again — so the expectation
 * stays anchored to the theme. Read off the source because this repo renders no
 * DOM in tests.
 */
describe("the deck's colour fields state the deck's own inherited colours", () => {
	const source = readFileSync(
		join(import.meta.dir, "CreatePage.tsx"),
		"utf8",
	);
	const inherited = DECK_THEME_APPEARANCE.signal.dark.tokens;

	function placeholderAfter(label: string): string | undefined {
		const at = source.indexOf(`label="${label}"`);
		if (at < 0) return undefined;
		return source.slice(at).match(/placeholder="([^"]+)"/)?.[1];
	}

	test("the brand colour offers the house theme's accent, not the chrome's", () => {
		expect(placeholderAfter("Brand colour")).toBe(inherited["--color-accent"]);
	});

	test("the canvas offers the house theme's surface", () => {
		expect(placeholderAfter("Canvas")).toBe(inherited["--color-surface"]);
	});

	test("the text colour offers the house theme's words", () => {
		expect(placeholderAfter("Text")).toBe(inherited["--color-text"]);
	});
});
