/**
 * The template gallery in the interface language (REQ248): a deck made from a
 * template starts with its participant language (REQ084) set to the interface
 * language, and the page itself is drawn in it.
 *
 * Picking a template is a click and an awaited create, which a static render
 * does not run, so the request is walked the way the page builds it: the body
 * `templateCreateRequest` returns, through the server's create schema. The
 * server keeping the request's language over the template's is held in
 * `server/templates.integration.test.ts`. The page's own wiring is read off
 * its source.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatePresentationSchema } from "../../server/schemas";
import { InterfaceLanguageProvider } from "../interface-language";
import { INTERFACE_LANGUAGES } from "../interface-text";
import { INTERFACE_LANGUAGE_KEY } from "../storage";
import { TemplatesPage, templateCreateRequest } from "./TemplatesPage";

/** The page as it first draws, under the stored interface choice. */
function pageMarkup(storedLanguage: string): string {
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) =>
			key === INTERFACE_LANGUAGE_KEY ? storedLanguage : null,
		setItem: () => {},
		removeItem: () => {},
	};
	return renderToStaticMarkup(
		createElement(
			InterfaceLanguageProvider,
			null,
			createElement(TemplatesPage, { go: () => {} }),
		),
	);
}

afterEach(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("a deck from a template starts in the interface language (REQ248)", () => {
	for (const interfaceLanguage of INTERFACE_LANGUAGES) {
		test(`a ${interfaceLanguage} interface creates the deck in ${interfaceLanguage}`, () => {
			const created = CreatePresentationSchema.parse(
				templateCreateRequest("retrospective", interfaceLanguage),
			);
			expect(created.templateId).toBe("retrospective");
			expect(created.language).toBe(interfaceLanguage);
		});
	}

	test("the page sends the interface language it reads", () => {
		const source = readFileSync(join(import.meta.dir, "TemplatesPage.tsx"), "utf8");
		expect(source).toContain("const { text, language } = useInterfaceText();");
		expect(source).toContain("templateCreateRequest(template.id, language)");
	});
});

describe("the gallery is drawn in the interface language (REQ248)", () => {
	test("German, with the catalog's own words left as they are", () => {
		const markup = pageMarkup("de");
		expect(markup).toContain("Starte mit einer");
		expect(markup).toContain('placeholder="Vorlagen durchsuchen"');
		expect(markup).toContain('aria-label="Vorlagen nach Kategorie filtern"');
		expect(markup).toContain(">Alle<");
		expect(markup).not.toContain("Search templates");
		expect(markup).not.toContain("prebuilt deck");
	});

	test("English as before", () => {
		const markup = pageMarkup("en");
		expect(markup).toContain("prebuilt deck");
		expect(markup).toContain('placeholder="Search templates"');
		expect(markup).toContain(">All<");
	});
});
