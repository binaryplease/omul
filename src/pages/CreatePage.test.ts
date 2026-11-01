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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DECK_THEME_APPEARANCE } from "../components/DeckTheme";
import {
	AUDIENCE_LANGUAGE_LABEL,
	AudienceLanguageField,
	editorColumnLabel,
} from "./CreatePage";

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
 * The accessible name of the one `<select>` in `markup`, by the three routes
 * static markup can carry: `aria-labelledby`, then `aria-label`, then a
 * `<label for>` naming its id. `null` is a combobox a screen reader announces
 * by its role alone.
 */
function selectAccessibleName(markup: string): string | null {
	const selects = markup.match(/<select\b[^>]*>/g) ?? [];
	expect(selects).toHaveLength(1);
	const select = selects[0] ?? "";
	const attribute = (name: string) =>
		select.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
	const textOfElementWithId = (id: string) =>
		markup
			.match(new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>([\\s\\S]*?)</\\1>`))?.[2]
			?.replace(/<[^>]*>/g, "")
			.trim() ?? "";
	const labelledBy = attribute("aria-labelledby");
	if (labelledBy) {
		return labelledBy.split(/\s+/).map(textOfElementWithId).join(" ").trim();
	}
	const ariaLabel = attribute("aria-label");
	if (ariaLabel) return ariaLabel;
	const id = attribute("id");
	if (id) {
		const labelFor = markup.match(
			new RegExp(`<label[^>]*\\sfor="${id}"[^>]*>([\\s\\S]*?)</label>`),
		)?.[1];
		if (labelFor) return labelFor.replace(/<[^>]*>/g, "").trim();
	}
	return null;
}

describe("the audience-language select is named by its caption (REQ239)", () => {
	// The failure this pins down (Re-Test D, D3): the caption was drawn but not
	// bound, so a screen reader announced an unnamed combobox.
	test("a screen reader hears the words the eye reads over it", () => {
		const markup = renderToStaticMarkup(
			createElement(AudienceLanguageField, {
				language: "de",
				onLanguageChange: () => {},
			}),
		);
		const caption = markup
			.match(/<label[^>]*>([\s\S]*?)<\/label>/)?.[1]
			?.trim();
		expect(caption).toBe("Audience language");
		expect(selectAccessibleName(markup)).toBe("Audience language");
	});

	test("the name does not depend on the language chosen", () => {
		const markup = renderToStaticMarkup(
			createElement(AudienceLanguageField, {
				language: "en",
				onLanguageChange: () => {},
			}),
		);
		expect(selectAccessibleName(markup)).toBe(AUDIENCE_LANGUAGE_LABEL);
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

/**
 * The repeat-passes switch (REQ083) is drawn only under Audience pace, with no
 * disabled control or reason line under Presenter pace. That deviates from
 * ADR-0025 rules 1 and 4 by the owner's decision, recorded in REQ083's Notes.
 * The Audience pace card names the option so it can be found from the other
 * pace. Read off the source because this repo renders no DOM in tests.
 */
describe("the repeat-passes switch appears only under Audience pace (REQ083)", () => {
	const source = readFileSync(
		join(import.meta.dir, "CreatePage.tsx"),
		"utf8",
	);
	const toggleLabel = "Let a device answer more than once";

	test("the toggle is drawn once, inside the Audience pace condition", () => {
		expect(source.split(`label="${toggleLabel}"`).length - 1).toBe(1);
		expect(source).toMatch(
			new RegExp(
				`\\{mode === "survey" && \\(\\s*<div[^>]*>\\s*<Toggle\\s+label="${toggleLabel}"`,
			),
		);
	});

	test("the presenter-paced banner is gone", () => {
		expect(source).not.toContain("Not in effect");
		expect(source).not.toContain('mode === "live"');
	});

	test("the Audience pace card's description names the option", () => {
		const card = source.slice(source.indexOf('label: "Audience pace"'));
		const description = card.match(/description:\s*"([^"]+)"/)?.[1];
		expect(description?.toLowerCase()).toContain(toggleLabel.toLowerCase());
	});
});
