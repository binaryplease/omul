/**
 * Unit tests for src/i18n.ts — presentation language dictionary (REQ084).
 */

import { describe, expect, test } from "bun:test";
import {
	countPhrase,
	fillTemplate,
	getDict,
	type PluralForms,
	resolveLang,
} from "./i18n";
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

describe("counted phrases (REQ225)", () => {
	const LANGUAGES = ["en", "de", "fr", "es", "it", "pt", "nl"] as const;

	test("every dictionary names its own language, the one its plurals are read by", () => {
		for (const language of LANGUAGES) {
			expect(getDict(language).locale).toBe(language);
		}
	});

	test("every counted phrase has both forms in every language, each carrying the count", () => {
		for (const language of LANGUAGES) {
			for (const [key, value] of Object.entries(getDict(language))) {
				// The slide types' names (REQ248) are a table by type, not a phrase.
				if (typeof value !== "object" || key === "slideTypeNames") continue;
				const forms = value as Partial<PluralForms>;
				expect(Object.keys(forms).sort(), `${language}.${key}`).toEqual([
					"one",
					"other",
				]);
				expect(forms.one, `${language}.${key}.one`).toBeTruthy();
				expect(forms.other, `${language}.${key}.other`).toBeTruthy();
			}
		}
	});

	test("one and many take their own form", () => {
		const de = getDict("de");
		expect(countPhrase(de, de.resultsResponseCount, 1)).toBe("1 Antwort");
		expect(countPhrase(de, de.resultsResponseCount, 2)).toBe("2 Antworten");
		expect(countPhrase(de, de.resultsResponseCount, 0)).toBe("0 Antworten");
	});

	test("the language's own rules pick the form, not count === 1", () => {
		// French reads zero as singular: "0 réponse", not "0 réponses".
		const fr = getDict("fr");
		expect(countPhrase(fr, fr.resultsResponseCount, 0)).toBe("0 réponse");
		expect(countPhrase(fr, fr.resultsResponseCount, 2)).toBe("2 réponses");
		// And the "many" French uses for round millions is worded as "other".
		expect(countPhrase(fr, fr.resultsResponseCount, 1_000_000)).toBe(
			"1000000 réponses",
		);
	});

	test("a verb that agrees with the count agrees", () => {
		const it = getDict("it");
		expect(countPhrase(it, it.quizScoreAnsweredCorrectly, 1)).toBe(
			"ha risposto correttamente",
		);
		expect(countPhrase(it, it.quizScoreAnsweredCorrectly, 3)).toBe(
			"hanno risposto correttamente",
		);
	});

	test("other slots are filled alongside the count", () => {
		const en = getDict("en");
		expect(countPhrase(en, en.leaderboardTopAcross, 1, { shown: 1 })).toBe(
			"Top 1 across 1 quiz question",
		);
		expect(countPhrase(en, en.leaderboardTopAcross, 3, { shown: 5 })).toBe(
			"Top 5 across 3 quiz questions",
		);
	});
});

describe("fillTemplate", () => {
	test("fills every named slot, however often it appears", () => {
		expect(fillTemplate("{a} and {b} and {a}", { a: 1, b: "two" })).toBe(
			"1 and two and 1",
		);
	});

	test("leaves a slot with no value as written, so it shows rather than vanishes", () => {
		expect(fillTemplate("Hello {name}", {})).toBe("Hello {name}");
	});
});
