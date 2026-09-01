/**
 * Unit tests for src/i18n.ts — presentation language dictionary (REQ084).
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "./i18n";

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
