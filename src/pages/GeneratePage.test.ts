/**
 * Drafting a deck from a prompt in the interface language (REQ248): the deck
 * it drafts starts with its participant language (REQ084) set to the interface
 * language — which is also the language the generator is asked to write in —
 * and the page itself is drawn in it.
 *
 * Generating is a click and an awaited call, which a static render does not
 * run, so the request is walked the way the page builds it: the body
 * `deckGenerationRequest` returns, through the server's generation schema. The
 * server storing that language on the deck and handing it to the generator is
 * held in `server/deck-generation.integration.test.ts`. The page's own wiring
 * is read off its source.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerateDeckSchema } from "../../server/schemas";
import { InterfaceLanguageProvider } from "../interface-language";
import { INTERFACE_LANGUAGES } from "../interface-text";
import { INTERFACE_LANGUAGE_KEY } from "../storage";
import { deckGenerationRequest, GeneratePage } from "./GeneratePage";

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
			createElement(GeneratePage, { go: () => {} }),
		),
	);
}

afterEach(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("a generated deck starts in the interface language (REQ248)", () => {
	for (const interfaceLanguage of INTERFACE_LANGUAGES) {
		test(`a ${interfaceLanguage} interface drafts the deck in ${interfaceLanguage}`, () => {
			const request = GenerateDeckSchema.parse(
				deckGenerationRequest("a retro", interfaceLanguage),
			);
			expect(request).toEqual({ prompt: "a retro", language: interfaceLanguage });
		});
	}

	test("the page sends the interface language it reads", () => {
		const source = readFileSync(join(import.meta.dir, "GeneratePage.tsx"), "utf8");
		expect(source).toContain("const { text, language } = useInterfaceText();");
		expect(source).toContain("deckGenerationRequest(trimmed, language)");
	});
});

describe("the page is drawn in the interface language (REQ248)", () => {
	test("German", () => {
		const markup = pageMarkup("de");
		expect(markup).toContain("Beschreibe die Sitzung, erhalte einen");
		expect(markup).toContain(">Entwurf<");
		expect(markup).not.toContain("Describe the session");
	});

	test("English as before", () => {
		const markup = pageMarkup("en");
		expect(markup).toContain("Describe the session, get a");
		expect(markup).toContain("draft deck");
	});
});
