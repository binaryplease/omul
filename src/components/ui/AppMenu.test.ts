/**
 * Where `AppMenu` draws its panel (REQ183).
 *
 * Right-aligned under the trigger by default, but never off screen: in the
 * spike, the presenter toolbar wrapped at 390px and a right-anchored panel ran
 * off the left edge. The placement is a pure function of three boxes, so it is
 * asserted here without a browser.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDict } from "../../i18n";
import {
	type AppMenuLabels,
	AppMenuPanel,
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
