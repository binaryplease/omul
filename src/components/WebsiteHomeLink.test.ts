/**
 * The ended screen's way onward (REQ200).
 *
 *   - **Worded in the deck's language**, in every dictionary, with the
 *     product's name filled in.
 *   - **Led where the deployment says.** A German deck goes to the German home,
 *     a deck in any other language to the English one, either falls back to the
 *     one that is set, and with neither set the control is the router button to
 *     the app's own home it always was.
 *   - **Only a link.** The address is drawn exactly as configured, nothing is
 *     appended, and the control is an `<a href>` the participant clicks — one
 *     that sends the website this origin and not the `/join/<CODE>` it leaves.
 *
 * Rendered to static markup with React's own server renderer, which needs no
 * DOM. Which screen mounts it is asserted by reading the page's source, the way
 * `LegalLinks.test.ts` asserts its placements.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lang } from "../i18n";
import type { WebsiteLinks } from "../types";
import {
	NO_WEBSITE_LINKS,
	WebsiteHomeLinkView,
	websiteHomeUrlFor,
} from "./WebsiteHomeLink";

const HOSTED: WebsiteLinks = {
	homeUrlEn: "https://omul.app/en",
	homeUrlDe: "https://omul.app/",
};

const LABELS: Record<Lang, string> = {
	en: "Go to the omul homepage",
	de: "Zur omul-Startseite",
	fr: "Aller à la page d&#x27;accueil de omul",
	es: "Ir a la página de inicio de omul",
	it: "Vai alla home page di omul",
	pt: "Ir para a página inicial de omul",
	nl: "Naar de startpagina van omul",
};

function render(links: WebsiteLinks, language?: string): string {
	return renderToStaticMarkup(
		createElement(WebsiteHomeLinkView, {
			links,
			language,
			onAppHome: () => {},
		}),
	);
}

describe("the ended screen's label (REQ200)", () => {
	for (const [language, label] of Object.entries(LABELS)) {
		test(`is in the deck's language: ${language}`, () => {
			expect(render(HOSTED, language)).toContain(`>${label}<`);
			expect(render(NO_WEBSITE_LINKS, language)).toContain(`>${label}<`);
		});
	}

	test("an unknown language reads in English", () => {
		expect(render(NO_WEBSITE_LINKS, "zz")).toContain(`>${LABELS.en}<`);
	});

	test("no dictionary leaves the brand placeholder unfilled", () => {
		for (const language of Object.keys(LABELS)) {
			expect(render(HOSTED, language)).not.toContain("{brand}");
		}
	});
});

describe("where the ended screen leads (REQ200)", () => {
	test("a German deck goes to the German home", () => {
		expect(websiteHomeUrlFor(HOSTED, "de")).toBe("https://omul.app/");
		expect(websiteHomeUrlFor(HOSTED, "de-CH")).toBe("https://omul.app/");
	});

	test("a deck in every other language goes to the English home", () => {
		for (const language of ["en", "fr", "es", "it", "pt", "nl", "zz"]) {
			expect(websiteHomeUrlFor(HOSTED, language)).toBe("https://omul.app/en");
		}
		expect(websiteHomeUrlFor(HOSTED, undefined)).toBe("https://omul.app/en");
	});

	test("with only one home set, every deck goes to it", () => {
		const englishOnly = { homeUrlEn: "https://example.com/", homeUrlDe: null };
		const germanOnly = { homeUrlEn: null, homeUrlDe: "https://example.de/" };
		expect(websiteHomeUrlFor(englishOnly, "de")).toBe("https://example.com/");
		expect(websiteHomeUrlFor(englishOnly, "fr")).toBe("https://example.com/");
		expect(websiteHomeUrlFor(germanOnly, "en")).toBe("https://example.de/");
		expect(websiteHomeUrlFor(germanOnly, "de")).toBe("https://example.de/");
	});

	test("with neither set there is no website to go to", () => {
		expect(websiteHomeUrlFor(NO_WEBSITE_LINKS, "de")).toBeNull();
		expect(websiteHomeUrlFor(NO_WEBSITE_LINKS, "en")).toBeNull();
	});

	test("configured, it is a plain link to exactly that address", () => {
		expect(render(HOSTED, "de")).toBe(
			`<a href="https://omul.app/" class="btn-secondary" referrerPolicy="origin">${LABELS.de}</a>`,
		);
		expect(render(HOSTED, "fr")).toBe(
			`<a href="https://omul.app/en" class="btn-secondary" referrerPolicy="origin">${LABELS.fr}</a>`,
		);
	});

	test("the link sends the website this origin, never the /join/<CODE> it leaves", () => {
		for (const language of Object.keys(LABELS)) {
			const markup = render(HOSTED, language);
			expect(markup).toContain('referrerPolicy="origin"');
			// Attribution kept: no rel that would drop the Referer or the follow.
			expect(markup).not.toContain("rel=");
		}
	});

	test("unset, it is the button to the app's own home", () => {
		const markup = render(NO_WEBSITE_LINKS, "de");
		expect(markup).toBe(
			`<button type="button" class="btn-secondary">${LABELS.de}</button>`,
		);
		expect(markup).not.toContain("href");
	});
});

describe("the participant page (REQ200)", () => {
	const source = readFileSync(
		join(import.meta.dir, "..", "pages", "ParticipantPage.tsx"),
		"utf8",
	);

	test("the ended screen mounts the control in the deck's language", () => {
		expect(source).toMatch(
			/<WebsiteHomeLink\s+language=\{pres\.language\}\s+onAppHome=\{\(\) => go\(\{ page: "home" \}\)\}/,
		);
		expect(source).not.toContain("Back to home");
	});

	test("nothing on the page or the control navigates without a click", () => {
		const control = readFileSync(
			join(import.meta.dir, "WebsiteHomeLink.tsx"),
			"utf8",
		);
		for (const text of [source, control]) {
			expect(text).not.toMatch(/location\.(replace|assign)\(|location\.href\s*=/);
			expect(text).not.toContain("navigator.language");
		}
	});
});
