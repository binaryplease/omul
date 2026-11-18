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

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	CreatePresentationSchema,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	slideWriteRefusalFor,
} from "../../server/schemas";
import { DECK_THEME_APPEARANCE } from "../components/DeckTheme";
import { InterfaceLanguageProvider } from "../interface-language";
import {
	ENGLISH_INTERFACE_TEXT,
	INTERFACE_LANGUAGES,
	interfaceTextFor,
} from "../interface-text";
import { INTERFACE_LANGUAGE_KEY } from "../storage";
import { blankDocument } from "../store/editorDocument";
import { createAppStore } from "../store/store";
import { DEFAULT_DECK_THEME, EMPTY_DECK_BRAND } from "../types";
import {
	AUDIENCE_LANGUAGE_LABEL,
	AudienceLanguageField,
	DeckSettings,
	editorColumnLabel,
	slideWriteRefusalMessage,
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

	test("a German interface names both panels in German, still apart (REQ248)", () => {
		const german = interfaceTextFor("de");
		expect(editorColumnLabel("settings", german)).toBe("Präsentationseinstellungen");
		expect(editorColumnLabel(3, german)).toBe("Folieneinstellungen");
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

	/**
	 * The fields are labelled from the interface text (REQ248), so a field is
	 * found by the key its label reads, and that key is held to its English.
	 */
	function placeholderAfter(
		key: "brandColorLabel" | "canvasLabel" | "textColorLabel",
	): string | undefined {
		const at = source.indexOf(`label={themeText.${key}}`);
		if (at < 0) return undefined;
		return source.slice(at).match(/placeholder="([^"]+)"/)?.[1];
	}

	test("the brand colour offers the house theme's accent, not the chrome's", () => {
		expect(interfaceTextFor("en").deckTheme.brandColorLabel).toBe("Brand colour");
		expect(placeholderAfter("brandColorLabel")).toBe(inherited["--color-accent"]);
	});

	test("the canvas offers the house theme's surface", () => {
		expect(interfaceTextFor("en").deckTheme.canvasLabel).toBe("Canvas");
		expect(placeholderAfter("canvasLabel")).toBe(inherited["--color-surface"]);
	});

	test("the text colour offers the house theme's words", () => {
		expect(interfaceTextFor("en").deckTheme.textColorLabel).toBe("Text");
		expect(placeholderAfter("textColorLabel")).toBe(inherited["--color-text"]);
	});
});

/**
 * A deck created in the editor starts its participant language (REQ084) in the
 * interface language the presenter is working in (REQ248) — German for a German
 * interface, English for an English one. It is only the picker's starting value;
 * the presenter changes it in the deck's settings like any other.
 *
 * The page seeds the draft in an effect, which a static render does not run, so
 * the path is walked the way the page walks it: the store's reset with the
 * interface language, the create body read off the store as the page builds it,
 * and that body through the server's create schema. The page's own wiring is
 * read off its source.
 */
describe("a new deck starts in the interface language (REQ248)", () => {
	for (const interfaceLanguage of INTERFACE_LANGUAGES) {
		test(`a ${interfaceLanguage} interface creates a deck in ${interfaceLanguage}`, () => {
			const store = createAppStore();
			store.getState().resetEditor(interfaceLanguage);
			const draft = store.getState();
			draft.setTitle("Deck");
			draft.updateSlide(draft.slides[0].id, { question: "Question?" });
			const { title, slides, language, mode } = store.getState();
			const created = CreatePresentationSchema.parse({
				title,
				slides,
				language,
				mode,
			});
			expect(created.language).toBe(interfaceLanguage);
		});
	}

	test("the starting language is the only thing the interface changes in a draft", () => {
		const store = createAppStore();
		store.getState().resetEditor("de");
		const { language, slides: germanSlides, ...german } = blankDocument("de");
		const { slides: englishSlides, ...english } = blankDocument();
		expect(language).toBe("de");
		expect(english.language).toBe("en");
		expect({ ...german, language: "en" }).toEqual(english);
		expect(store.getState().language).toBe("de");
	});

	test("the page seeds a new draft with the interface language, read once", () => {
		const source = readFileSync(join(import.meta.dir, "CreatePage.tsx"), "utf8");
		expect(source).toContain(
			"const { text, language: interfaceLanguage } = useInterfaceText();",
		);
		expect(source).toContain(
			"const startingDeckLanguage = useRef(interfaceLanguage);",
		);
		expect(source).toContain("resetEditor(startingDeckLanguage.current);");
		// Switching the interface while a draft is open must not reset the draft.
		expect(source).toContain("}, [editId, go, resetEditor, loadEditor]);");
	});
});

/**
 * Slice 2c of REQ248: the deck-settings panel and the save refusal for an
 * oversized field, in the interface language. The review of the batch found
 * the panel's own header and its Language, Pace, Results visibility, Profanity
 * filter, Q&A, Audience channels and Participants groups English under a
 * German interface; these hold that they are not.
 */
describe("the deck-settings panel in the interface language (REQ248 slice 7)", () => {
	afterEach(() => {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	function panelMarkup(storedLanguage: string, changes: Record<string, unknown> = {}) {
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (key: string) =>
				key === INTERFACE_LANGUAGE_KEY ? storedLanguage : null,
			setItem: () => {},
			removeItem: () => {},
		};
		const ignore = () => {};
		return renderToStaticMarkup(
			createElement(
				InterfaceLanguageProvider,
				null,
				createElement(DeckSettings, {
					language: "en",
					mode: "live",
					allowRepeatPasses: false,
					resultsVisibility: "instant",
					overriddenSlideCount: 2,
					qaEnabled: false,
					qaVisibility: "presenter",
					reactionsEnabled: false,
					chatEnabled: false,
					requireParticipantName: false,
					requireParticipantSignIn: false,
					profanityFilterEnabled: true,
					profanityFilterLanguage: null,
					theme: DEFAULT_DECK_THEME,
					themeBrand: EMPTY_DECK_BRAND,
					authoredBrand: null,
					themeLogoUrl: "",
					themeLogoAlt: "",
					deckTitle: "Deck",
					onLanguageChange: ignore,
					onModeChange: ignore,
					onAllowRepeatPassesChange: ignore,
					onResultsVisibilityChange: ignore,
					onApplyResultsVisibilityToDeck: ignore,
					onQAEnabledChange: ignore,
					onQAVisibilityChange: ignore,
					onReactionsEnabledChange: ignore,
					onChatEnabledChange: ignore,
					onRequireParticipantNameChange: ignore,
					onRequireParticipantSignInChange: ignore,
					onProfanityFilterEnabledChange: ignore,
					onProfanityFilterLanguageChange: ignore,
					onThemeChange: ignore,
					onThemeBrandChange: ignore,
					onThemeLogoUrlChange: ignore,
					onThemeLogoAltChange: ignore,
					...changes,
				}),
			),
		);
	}

	test("German throughout, from its header to its last switch", () => {
		const markup = panelMarkup("de");
		for (const german of [
			"Präsentationseinstellungen",
			"Sprache des Publikums",
			"Tempo der Vortragenden",
			"Sichtbarkeit der Ergebnisse",
			"2 Folien weichen davon ab",
			"Schimpfwortfilter",
			"Wie die Sprache des Publikums (English)",
			"Fragen aus dem Publikum",
			"Kanäle des Publikums",
			"Beim Beitreten nach einem Namen fragen",
		]) {
			expect(markup).toContain(german);
		}
		for (const english of [
			"Presentation settings",
			"Audience language",
			"Presenter pace",
			"Results visibility",
			"Profanity filter",
			"Questions from the audience",
			"Audience channels",
			"Ask for a name on joining",
			"Apply to every question slide",
		]) {
			expect(markup).not.toContain(english);
		}
	});

	test("English as before", () => {
		const markup = panelMarkup("en", { overriddenSlideCount: 1 });
		expect(markup).toContain("Presentation settings");
		expect(markup).toContain("1 slide overrides it.");
		expect(markup).toContain("Same as the audience language (English)");
	});

	test("an oversized field's refusal names slide, field and ceiling in German", () => {
		const refusal = slideWriteRefusalFor([
			{
				id: "s1",
				type: "multiple-choice",
				question: "Pick one",
				options: [{ id: "o1", text: "W".repeat(SLIDE_ITEM_TEXT_MAX_LENGTH + 1) }],
			},
		]);
		expect(refusal).not.toBeNull();
		if (!refusal) return;
		expect(slideWriteRefusalMessage(refusal, interfaceTextFor("de"))).toBe(
			`Folie 1, options.0.text: höchstens ${SLIDE_ITEM_TEXT_MAX_LENGTH} Zeichen.`,
		);
		// English is the shared check's own sentence, as before REQ248 (review:
		// the English interface had swapped Zod's wording for a template).
		expect(slideWriteRefusalMessage(refusal)).toBe(refusal.message);
		expect(refusal.message).toStartWith("Slide 1, options.0.text: ");
	});

	test("in English a refusal that is not a ceiling keeps its detail", () => {
		const refusal = slideWriteRefusalFor([
			{ id: "s1", type: "multiple-choice", question: 42 },
		]);
		expect(refusal).not.toBeNull();
		if (!refusal) return;
		expect(refusal.limit).toBeNull();
		expect(slideWriteRefusalMessage(refusal)).toBe(refusal.message);
		expect(slideWriteRefusalMessage(refusal)).not.toContain(
			"this value cannot be saved",
		);
	});

	test("the editor words a field's refusal through the interface text and declares its language", () => {
		const source = readFileSync(join(import.meta.dir, "CreatePage.tsx"), "utf8");
		expect(source).toContain("setError(slideWriteRefusalMessage(writeRefusal, text));");
		expect(source).toContain("useDocumentLanguage(interfaceLanguage);");
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
	// The words are the interface text's (REQ248); English is the source.
	const english = ENGLISH_INTERFACE_TEXT.deckSettings;

	test("the toggle is drawn once, inside the Audience pace condition", () => {
		expect(english.repeatPasses).toBe(toggleLabel);
		expect(source.split("label={words.repeatPasses}").length - 1).toBe(1);
		expect(source).toMatch(
			/\{mode === "survey" && \(\s*<div[^>]*>\s*<Toggle\s+label=\{words\.repeatPasses\}/,
		);
	});

	test("the presenter-paced banner is gone", () => {
		expect(source).not.toContain("Not in effect");
		expect(source).not.toContain('mode === "live"');
	});

	test("the Audience pace card's description names the option", () => {
		expect(source).toContain("description: words.paceAudienceDescription,");
		expect(english.paceAudienceDescription.toLowerCase()).toContain(
			toggleLabel.toLowerCase(),
		);
	});
});
