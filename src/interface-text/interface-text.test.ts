/**
 * The organizer's interface language (REQ248): which language a browser
 * gets, the English fallback per key, and the completeness of every slice
 * that is done.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DOCUMENT_LANGUAGE } from "../interface-language";
import {
	ENGLISH_INTERFACE_TEXT,
	formatNumber,
	germanGaps,
	INTERFACE_LANGUAGE_NAMES,
	INTERFACE_LANGUAGES,
	INTERFACE_SECTIONS,
	type InterfaceSection,
	interfaceTextFor,
	pluralText,
	readInterfaceLanguagePreference,
	resolveInterfaceLanguage,
} from ".";

describe("the stored choice", () => {
	test("a language or auto reads back as itself", () => {
		expect(readInterfaceLanguagePreference("auto")).toBe("auto");
		expect(readInterfaceLanguagePreference("en")).toBe("en");
		expect(readInterfaceLanguagePreference("de")).toBe("de");
	});

	test("a missing or unknown value reads as auto", () => {
		expect(readInterfaceLanguagePreference(null)).toBe("auto");
		expect(readInterfaceLanguagePreference("")).toBe("auto");
		expect(readInterfaceLanguagePreference("fr")).toBe("auto");
		expect(readInterfaceLanguagePreference("DE")).toBe("auto");
	});
});

describe("Automatic follows the browser's languages", () => {
	test("the first offered primary subtag wins", () => {
		expect(resolveInterfaceLanguage("auto", ["de-AT", "en"])).toBe("de");
		expect(resolveInterfaceLanguage("auto", ["de-DE"])).toBe("de");
		expect(resolveInterfaceLanguage("auto", ["en-US", "de"])).toBe("en");
	});

	test("a language not offered is passed over, not mapped", () => {
		expect(resolveInterfaceLanguage("auto", ["fr-FR", "en-GB"])).toBe("en");
		expect(resolveInterfaceLanguage("auto", ["fr-FR", "de"])).toBe("de");
	});

	test("English when no browser language is offered", () => {
		expect(resolveInterfaceLanguage("auto", ["fr-FR"])).toBe("en");
		expect(resolveInterfaceLanguage("auto", [])).toBe("en");
		expect(resolveInterfaceLanguage("auto", [""])).toBe("en");
	});

	test("an explicit choice ignores the browser", () => {
		expect(resolveInterfaceLanguage("de", ["en-US"])).toBe("de");
		expect(resolveInterfaceLanguage("en", ["de-DE"])).toBe("en");
	});

	test("the subtag is read case-insensitively", () => {
		expect(resolveInterfaceLanguage("auto", ["DE-ch"])).toBe("de");
	});
});

describe("the offered languages", () => {
	test("English and German, each named in itself", () => {
		expect([...INTERFACE_LANGUAGES]).toEqual(["en", "de"]);
		expect(INTERFACE_LANGUAGE_NAMES).toEqual({ en: "English", de: "Deutsch" });
	});
});

describe("text and its fallback", () => {
	test("German reads the German entry", () => {
		expect(interfaceTextFor("de").appMenu.language).toBe("Sprache");
		expect(interfaceTextFor("en").appMenu.language).toBe("Language");
	});

	test("every section reads every English key in every language, never blank", () => {
		for (const language of INTERFACE_LANGUAGES) {
			const text = interfaceTextFor(language);
			for (const section of INTERFACE_SECTIONS) {
				const entries: Record<string, unknown> = text[section];
				for (const key of Object.keys(ENGLISH_INTERFACE_TEXT[section])) {
					expect(entries[key]).toBeDefined();
					expect(entries[key]).not.toBe("");
				}
			}
		}
	});

	test("pluralText picks the form by the language's rules and formats the count", () => {
		const english = { one: "{count} vote", other: "{count} votes" };
		expect(pluralText("en", 1, english)).toBe("1 vote");
		expect(pluralText("en", 0, english)).toBe("0 votes");
		expect(pluralText("en", 1200, english)).toBe("1,200 votes");
		const german = { one: "{count} Stimme", other: "{count} Stimmen" };
		expect(pluralText("de", 1, german)).toBe("1 Stimme");
		expect(pluralText("de", 1200, german)).toBe("1.200 Stimmen");
	});

	test("pluralText fills the other slots and keeps the formatted count", () => {
		const forms = { one: "{count} in {room}", other: "{count} in {room}" };
		expect(pluralText("de", 2500, forms, { room: "Saal", count: 7 })).toBe(
			"2.500 in Saal",
		);
	});

	test("numbers take the interface language's format", () => {
		expect(formatNumber("en", 1234.5)).toBe("1,234.5");
		expect(formatNumber("de", 1234.5)).toBe("1.234,5");
	});
});

/**
 * REQ248's slices, by the sections that hold their surfaces' strings. A slice
 * marked done fails here when any of its keys has no German entry; a slice
 * still open may hold English-only keys, which read English by the fallback.
 * Each later slice adds its sections here as it is built.
 */
const SLICES: { slice: string; done: boolean; sections: InterfaceSection[] }[] =
	[
		{
			slice: "REQ248/1-mechanism",
			done: true,
			sections: ["appMenu"],
		},
	];

describe("each done slice is complete in German (REQ248)", () => {
	test("every section belongs to exactly one slice", () => {
		const assigned = SLICES.flatMap((slice) => slice.sections).sort();
		expect(assigned).toEqual([...INTERFACE_SECTIONS].sort());
	});

	for (const { slice, done, sections } of SLICES) {
		if (!done) continue;
		for (const section of sections) {
			test(`${slice}: every key of ${section} has a German entry`, () => {
				expect(germanGaps(section)).toEqual([]);
			});
		}
	}

	test("the app menu's section is not empty", () => {
		expect(Object.keys(ENGLISH_INTERFACE_TEXT.appMenu).length).toBeGreaterThan(
			0,
		);
	});

	test("the German app menu names its sections in German", () => {
		const german = interfaceTextFor("de").appMenu;
		expect(german.menuNameWithLanguage).toBe(
			"Darstellung, Sprache und Rechtliches",
		);
		expect(german.nameInList("Darstellung und Rechtliches")).toBe(
			"Darstellung und Rechtliches",
		);
		expect(ENGLISH_INTERFACE_TEXT.appMenu.nameInList("Appearance and legal")).toBe(
			"appearance and legal",
		);
	});
});

describe("<html lang> stays English until a screen declares its own", () => {
	const source = (...path: string[]) =>
		readFileSync(join(import.meta.dir, "..", ...path), "utf8");

	test("a screen that declares no language is English, as index.html is", () => {
		expect(DEFAULT_DOCUMENT_LANGUAGE).toBe("en");
		expect(source("index.html")).toContain('<html lang="en"');
		expect(source("interface-language.tsx")).toContain(
			"documentElement.lang =\n\t\t\tdocumentLanguage ?? DEFAULT_DOCUMENT_LANGUAGE;",
		);
	});

	// Slice 1 translates the app menu and nothing else, so no screen is in the
	// interface language yet: a German browser would otherwise get
	// <html lang="de"> over English pages, and a screen reader would read them
	// in German. A later slice adds its screen's call when it translates it.
	test("no page declares a language in slice 1", () => {
		const pages = readdirSync(join(import.meta.dir, "..", "pages")).filter(
			(file) => file.endsWith(".tsx"),
		);
		for (const page of pages) {
			expect(source("pages", page), page).not.toContain(
				"useDocumentLanguage(",
			);
		}
	});
});
