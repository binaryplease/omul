/**
 * Where `AppMenu` draws its panel (REQ183).
 *
 * Right-aligned under the trigger by default, but never off screen: in the
 * spike, the presenter toolbar wrapped at 390px and a right-anchored panel ran
 * off the left edge. The placement is a pure function of three boxes, so it is
 * asserted here without a browser.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDict } from "../../i18n";
import { type InterfaceLanguage, interfaceTextFor } from "../../interface-text";
import {
	type AppMenuLabels,
	type AppMenuLanguageChoice,
	AppMenuPanel,
	appMenuCloseLabel,
	appMenuLabelsFor,
	appMenuName,
	appMenuPlacement,
	appMenuTriggerLabel,
} from "./AppMenu";

const PANEL = { width: 248, height: 260 };
const PHONE = { width: 390, height: 844 };
const NARROW_PHONE = { width: 360, height: 640 };

/** A 34px trigger whose right edge is at `right` and top at `top`. */
function trigger(right: number, top = 16) {
	return { top, bottom: top + 34, right };
}

describe("app menu placement", () => {
	test("right-aligned under the trigger when there is room", () => {
		const placement = appMenuPlacement(trigger(1264), PANEL, {
			width: 1280,
			height: 800,
		});
		expect(placement).toEqual({ top: 58, left: 1264 - 248 });
	});

	test("a trigger near the left edge pulls the panel back on screen", () => {
		for (const viewport of [PHONE, NARROW_PHONE]) {
			const placement = appMenuPlacement(trigger(60), PANEL, viewport);
			expect(placement.left).toBe(8);
			expect(placement.left + PANEL.width).toBeLessThanOrEqual(
				viewport.width - 8,
			);
		}
	});

	test("a trigger scrolled past the right edge keeps the panel inside it", () => {
		const placement = appMenuPlacement(trigger(420), PANEL, NARROW_PHONE);
		expect(placement.left).toBe(360 - 248 - 8);
	});

	test("flips above the trigger when it would run off the bottom", () => {
		const placement = appMenuPlacement(trigger(300, 560), PANEL, NARROW_PHONE);
		expect(placement.top).toBe(560 - 8 - PANEL.height);
	});

	test("stays below when there is no room above either", () => {
		const placement = appMenuPlacement(trigger(300, 200), PANEL, {
			width: 360,
			height: 400,
		});
		expect(placement.top).toBe(242);
	});
});

describe("app menu trigger name (REQ199)", () => {
	test("without a leading section it is the menu's own name", () => {
		expect(appMenuTriggerLabel(false)).toBe("Appearance and legal");
		expect(appMenuTriggerLabel(true)).toBe("Appearance, feedback and legal");
	});

	test("a leading section's name is followed by what the menu holds, feedback included where it is on", () => {
		expect(appMenuTriggerLabel(false, "More — preview, export")).toBe(
			"More — preview, export, appearance and legal",
		);
		expect(appMenuTriggerLabel(true, "More — preview, export")).toBe(
			"More — preview, export, appearance, feedback and legal",
		);
	});
});

describe("the app menu in the screen's language (REQ225)", () => {
	const ALL_LINKS = {
		imprintUrl: "https://example.com/imprint",
		privacyUrl: "https://example.com/privacy",
		termsUrl: "/terms",
	};

	function panel(labels?: AppMenuLabels): string {
		return renderToStaticMarkup(
			createElement(AppMenuPanel, {
				id: "app-menu",
				links: ALL_LINKS,
				theme: "dark",
				onThemeChange: () => {},
				feedbackEnabled: true,
				labels,
			}),
		).replace(/<[^>]+>/g, " ");
	}

	test("the trigger is named in the deck's language on a participant's screen", () => {
		const german = appMenuLabelsFor(getDict("de"));
		expect(appMenuName(true, german)).toBe(
			"Darstellung, Feedback und Rechtliches",
		);
		expect(appMenuName(false, german)).toBe("Darstellung und Rechtliches");
	});

	test("and in English on the app's own screens, as before", () => {
		expect(appMenuName(true)).toBe("Appearance, feedback and legal");
		expect(appMenuName(false)).toBe("Appearance and legal");
	});

	test("everything the panel says follows the labels it is given", () => {
		const text = panel(appMenuLabelsFor(getDict("de")));
		for (const word of [
			"Darstellung",
			"Hell",
			"Dunkel",
			"Feedback senden",
			"Rechtliches",
			"Impressum",
			"Datenschutzerklärung",
			"Nutzungsbedingungen",
			"(öffnet in einem neuen Tab)",
		]) {
			expect(text).toContain(word);
		}
		for (const word of ["Appearance", "Light", "Send feedback", "Imprint"]) {
			expect(text).not.toContain(word);
		}
	});

	test("every language words every part of the menu", () => {
		for (const language of ["en", "de", "fr", "es", "it", "pt", "nl"]) {
			const labels = appMenuLabelsFor(getDict(language));
			const words = [
				labels.name,
				labels.nameWithFeedback,
				labels.close,
				labels.closeWithFeedback,
				labels.appearance,
				...Object.values(labels.themes),
				labels.sendFeedback,
				labels.legal,
				...Object.values(labels.legalTexts),
				labels.opensInNewTab,
				labels.closeFeedback,
			];
			for (const word of words) expect(word, language).toBeTruthy();
		}
	});
});

describe("the Language section (REQ248)", () => {
	function choice(
		language: InterfaceLanguage,
		preference: AppMenuLanguageChoice["preference"] = "auto",
		automaticLanguage: InterfaceLanguage = "de",
	): AppMenuLanguageChoice {
		return {
			preference,
			automaticLanguage,
			onChange: () => {},
			language,
			text: interfaceTextFor(language).appMenu,
		};
	}

	function markup(
		languageChoice?: AppMenuLanguageChoice,
		labels?: AppMenuLabels,
	): string {
		return renderToStaticMarkup(
			createElement(AppMenuPanel, {
				id: "app-menu",
				links: { imprintUrl: "https://example.com/imprint" },
				theme: "dark",
				onThemeChange: () => {},
				feedbackEnabled: true,
				labels,
				languageChoice,
				lang: languageChoice?.language,
			}),
		);
	}

	const words = (html: string) => html.replace(/<[^>]+>/g, " ");

	test("sits directly below Appearance and above Send feedback", () => {
		const text = words(markup(choice("en")));
		const appearance = text.indexOf("Appearance");
		const language = text.indexOf("Language");
		const feedback = text.indexOf("Send feedback");
		expect(appearance).toBeGreaterThanOrEqual(0);
		expect(language).toBeGreaterThan(appearance);
		expect(feedback).toBeGreaterThan(language);
	});

	test("Automatic names what it resolves to, then each language in itself", () => {
		const text = words(markup(choice("en", "auto", "de"))).replace(/\s+/g, " ");
		expect(text).toContain("Automatic ( Deutsch )");
		expect(text).toContain("English");
		expect(text.indexOf("Automatic")).toBeLessThan(text.indexOf("English"));
		expect(text.lastIndexOf("Deutsch")).toBeGreaterThan(text.indexOf("English"));
	});

	test("one row is checked, and it is the group's one tab stop", () => {
		const html = markup(choice("de", "de"));
		const rows = [...html.matchAll(/<button[^>]*data-language-option="(\w+)"[^>]*>/g)];
		expect(rows.map((row) => row[1])).toEqual(["auto", "en", "de"]);
		for (const [row, option] of rows) {
			const chosen = option === "de";
			expect(row).toContain(`aria-checked="${chosen}"`);
			expect(row).toContain(`tabindex="${chosen ? 0 : -1}"`);
		}
	});

	test("each language row carries its own lang, and the panel the menu's", () => {
		const html = markup(choice("de", "de"));
		expect(html).toMatch(/<button[^>]*lang="en"[^>]*data-language-option="en"|<button[^>]*data-language-option="en"[^>]*lang="en"/);
		expect(html).toMatch(/<button[^>]*data-language-option="de"[^>]*lang="de"/);
		expect(html).toMatch(/^<div[^>]*lang="de"/);
	});

	test("a German heading keeps the English word after it", () => {
		expect(words(markup(choice("de")))).toContain("Sprache · Language");
		expect(words(markup(choice("en")))).not.toContain("·");
	});

	test("an organizer's German menu is German throughout", () => {
		const text = words(
			markup(choice("de", "de"), appMenuLabelsFor(getDict("de"))),
		);
		for (const word of [
			"Darstellung",
			"Hell",
			"Dunkel",
			"Sprache",
			"Automatisch",
			"Feedback senden",
			"Rechtliches",
			"Impressum",
		]) {
			expect(text).toContain(word);
		}
		for (const word of ["Appearance", "Light", "Automatic", "Send feedback"]) {
			expect(text).not.toContain(word);
		}
	});

	test("absent without a language choice, as on the participant screen and the preview", () => {
		const text = words(markup());
		expect(text).not.toContain("Language");
		expect(text).not.toContain("Deutsch");
		expect(markup()).not.toContain("data-language-option");
	});

	test("the trigger's and the backdrop's names gain the Language section where it is drawn", () => {
		const english = interfaceTextFor("en").appMenu;
		expect(appMenuName(false, undefined, english)).toBe(
			"Appearance, language and legal",
		);
		expect(appMenuName(true, undefined, english)).toBe(
			"Appearance, language, feedback and legal",
		);
		expect(appMenuCloseLabel(true, undefined, english)).toBe(
			"Close appearance, language, feedback and legal menu",
		);
		expect(appMenuCloseLabel(true)).toBe(
			"Close appearance, feedback and legal menu",
		);
		const german = interfaceTextFor("de").appMenu;
		const germanLabels = appMenuLabelsFor(getDict("de"));
		expect(appMenuName(true, germanLabels, german)).toBe(
			"Darstellung, Sprache, Feedback und Rechtliches",
		);
		expect(appMenuCloseLabel(false, germanLabels, german)).toBe(
			"Menü „Darstellung, Sprache und Rechtliches“ schließen",
		);
	});

	test("after a leading section English lowercases the menu's name and German does not", () => {
		expect(
			appMenuTriggerLabel(
				false,
				"More — preview",
				undefined,
				interfaceTextFor("en").appMenu,
			),
		).toBe("More — preview, appearance, language and legal");
		expect(
			appMenuTriggerLabel(
				false,
				"More — preview",
				appMenuLabelsFor(getDict("de")),
				interfaceTextFor("de").appMenu,
			),
		).toBe("More — preview, Darstellung, Sprache und Rechtliches");
	});
});

describe("which screens offer the Language section (REQ248)", () => {
	const source = (page: string) =>
		readFileSync(join(import.meta.dir, "..", "..", "pages", page), "utf8");

	test("every menu on the participant screen and the preview speaks the deck's language", () => {
		for (const page of ["ParticipantPage.tsx", "PreviewPage.tsx"]) {
			const menus = source(page).match(/<AppMenu\b[^>]*>/g) ?? [];
			expect(menus.length, page).toBeGreaterThan(0);
			for (const menu of menus) expect(menu, page).toContain("speaksDeckLanguage");
		}
	});

	test("no organizer screen passes speaksDeckLanguage", () => {
		for (const page of ["HomePage.tsx", "PresenterPage.tsx", "CreatePage.tsx"]) {
			expect(source(page), page).not.toContain("speaksDeckLanguage");
		}
	});
});
