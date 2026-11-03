/**
 * Unit tests for src/i18n.ts — presentation language dictionary (REQ084).
 */

import { describe, expect, test } from "bun:test";
import { getDict, resolveLang } from "./i18n";
import { participantLanguageFor } from "./types";

describe("getDict", () => {
	test("returns English strings for 'en'", () => {
		const d = getDict("en");
		expect(d.live).toBe("LIVE");
		expect(d.submit).toBe("Submit");
	});

	test("returns localized strings for each supported language", () => {
		expect(getDict("de").submit).toBe("Absenden");
		expect(getDict("fr").submit).toBe("Envoyer");
		expect(getDict("es").submit).toBe("Enviar");
		expect(getDict("it").submit).toBe("Invia");
		expect(getDict("pt").submit).toBe("Enviar");
		expect(getDict("nl").submit).toBe("Verzenden");
	});

	test("falls back to English for an unknown language tag", () => {
		expect(getDict("klingon").submit).toBe("Submit");
		expect(getDict("zz").live).toBe("LIVE");
	});

	test("falls back to English when no argument is given", () => {
		expect(getDict().live).toBe("LIVE");
		expect(getDict(undefined).submit).toBe("Submit");
	});

	test("accepts BCP-47 tags with a region suffix ('en-US', 'de-CH')", () => {
		expect(getDict("en-US").submit).toBe("Submit");
		expect(getDict("de-CH").submit).toBe("Absenden");
		expect(getDict("pt-BR").submit).toBe("Enviar");
	});

	test("is case-insensitive on the primary subtag", () => {
		expect(getDict("DE").submit).toBe("Absenden");
		expect(getDict("Fr-CA").submit).toBe("Envoyer");
	});

	test("every dictionary has the full key set", () => {
		// Use English as the reference shape.
		const reference = Object.keys(getDict("en")).sort();
		for (const lang of ["de", "fr", "es", "it", "pt", "nl"]) {
			const keys = Object.keys(getDict(lang)).sort();
			expect(keys).toEqual(reference);
		}
	});
});

describe("the deck's language, read on both ends (REQ085)", () => {
	// The phone draws itself in `resolveLang`'s language and the server filters
	// with `participantLanguageFor`'s list. A tag the two read differently would
	// filter a German room against the English list.
	const TAGS = [
		"en",
		"de",
		"fr",
		"es",
		"it",
		"pt",
		"nl",
		"de-CH",
		"PT-br",
		"Fr-CA",
		"nl-BE",
		"ja",
		"zz",
		"klingon",
		"",
		"-de",
		"de-",
	];

	test("resolveLang and the server's participantLanguageFor agree on every tag", () => {
		for (const tag of TAGS) {
			expect([tag, resolveLang(tag)]).toEqual([tag, participantLanguageFor(tag)]);
		}
		expect(resolveLang(undefined)).toBe(participantLanguageFor(undefined));
	});

	test("the profanity filter's line is translated for every language", () => {
		const english = getDict("en").answersFiltered;
		for (const lang of ["de", "fr", "es", "it", "pt", "nl"]) {
			const line = getDict(lang).answersFiltered;
			expect([lang, line.length > 0, line === english]).toEqual([
				lang,
				true,
				false,
			]);
		}
	});
});
