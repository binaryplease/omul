/**
 * The shared dialog shell is a dialog to assistive technology too (REQ241).
 *
 * "Share the results" and the other sharing, export and account dialogs are
 * drawn by this shell, so each of them has to reach a screen reader as a modal
 * dialog named by its title, as the "Clear the results" prompt does (REQ219).
 * Where focus goes and that Escape closes it from anywhere is behaviour a static
 * render cannot show, and is checked in the browser.
 *
 * Its close control is named in the interface language (REQ248), and the QR
 * code's image is described to a screen reader in the deck's language wherever
 * the shared screen draws it. The QR image itself is drawn after an effect,
 * which a static render does not run, so what is held here is the deck's
 * wording and that both shared-screen callers hand it in.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Link2 } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDict } from "../../i18n";
import { InterfaceLanguageProvider } from "../../interface-language";
import { fillText, interfaceTextFor } from "../../interface-text";
import { INTERFACE_LANGUAGE_KEY } from "../../storage";
import { Modal } from "./Modal";

describe("Modal (REQ241)", () => {
	test("the panel is a modal dialog named by its title", () => {
		const markup = renderToStaticMarkup(
			createElement(
				Modal,
				{ title: "Share the results", icon: Link2, onClose: () => {} },
				"Body",
			),
		);
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
		expect(labelledBy).toBeTruthy();
		expect(markup).toContain(
			`<h3 id="${labelledBy}" class="flex-1 text-lg font-semibold">Share the results</h3>`,
		);
	});

	test("the panel can take focus from script but is not a Tab stop", () => {
		const markup = renderToStaticMarkup(
			createElement(Modal, { title: "Export this session", onClose: () => {} }),
		);
		expect(markup).toMatch(/role="dialog"[^>]*tabindex="-1"/);
	});
});

/** A dialog with nothing in it, rendered under the stored interface choice. */
function modalMarkup(storedLanguage: string | null): string {
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
			createElement(Modal, { title: "Export", onClose: () => {}, children: null }),
		),
	);
}

afterEach(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("Modal's close control (REQ248)", () => {
	test("is named Close with the interface in English, as it always was", () => {
		const markup = modalMarkup("en");
		expect(markup).toContain('aria-label="Close"');
		expect(markup).toContain('title="Close"');
	});

	test("is named in German, and marked German, with the interface in German", () => {
		const markup = modalMarkup("de");
		const close = interfaceTextFor("de").ui.close;
		expect(close).toBe("Schließen");
		expect(markup).toContain(`aria-label="${close}"`);
		expect(markup).toContain(`title="${close}"`);
		expect(markup).toContain('lang="de"');
		expect(markup).not.toContain('"Close"');
	});

	test("outside any provider it is English", () => {
		const markup = renderToStaticMarkup(
			createElement(Modal, { title: "Export", onClose: () => {}, children: null }),
		);
		expect(markup).toContain('aria-label="Close"');
	});
});

describe("the join code's image is described in the deck's language (REQ248)", () => {
	const url = "https://omul.test/join/123456";

	test("each deck language words it, with the address filled in", () => {
		expect(fillText(getDict("en").roomQrAlt, { url })).toBe(
			`QR code to join at ${url}`,
		);
		expect(fillText(getDict("de").roomQrAlt, { url })).toBe(
			`QR-Code zum Mitmachen unter ${url}`,
		);
		for (const language of ["fr", "es", "it", "pt", "nl"]) {
			expect([language, getDict(language).roomQrAlt.includes("{url}")]).toEqual([
				language,
				true,
			]);
		}
	});

	test("both shared-screen surfaces that draw the code hand the deck's words in", () => {
		const source = (...path: string[]) =>
			readFileSync(join(import.meta.dir, "..", "..", ...path), "utf8");
		expect(source("pages", "PresenterPage.tsx")).toContain(
			"alt={fillText(roomText.roomQrAlt, { url: joinUrl })}",
		);
		expect(source("components", "ContentSlideView.tsx")).toContain(
			"alt={fillText(room.roomQrAlt, {",
		);
	});
});
