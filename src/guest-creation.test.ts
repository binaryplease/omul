/**
 * The client's side of the operator's switch that closes creating
 * presentations without an account (REQ252): the rule every create surface
 * reads, the control that draws a refused create disabled with its reason,
 * and which surfaces compose it.
 *
 * This repo renders no DOM in tests, so the controls are rendered to static
 * markup — which is what decides whether the reason reaches a keyboard, a
 * touch screen and a screen reader — and the pages are held by reading their
 * source for what they pass, the way `src/instance-access.test.ts` holds the
 * sign-in dialog.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateControl } from "./components/CreateControl";
import { UseTemplateButton } from "./components/TemplateCard";
import { guestCreationRefused } from "./guest-creation";
import { interfaceTextFor } from "./interface-text";
import { OwnDeckCard } from "./pages/HomePage";
import type { Presentation } from "./types";

const REASON = interfaceTextFor("en").account.guestCreationClosed;

function source(relativePath: string): string {
	return readFileSync(join(import.meta.dir, relativePath), "utf8");
}

describe("guestCreationRefused — who is refused a create (REQ252)", () => {
	test("refused only while creation is closed and the visitor is known to be signed out", () => {
		expect(
			guestCreationRefused({
				guestCreationOpen: false,
				signedIn: false,
				sessionPending: false,
			}),
		).toBe(true);
	});

	test("a signed-in visitor creates while creation without an account is closed", () => {
		expect(
			guestCreationRefused({
				guestCreationOpen: false,
				signedIn: true,
				sessionPending: false,
			}),
		).toBe(false);
	});

	test("an open instance refuses nobody, signed in or not", () => {
		for (const signedIn of [true, false]) {
			expect(
				guestCreationRefused({
					guestCreationOpen: true,
					signedIn,
					sessionPending: false,
				}),
			).toBe(false);
		}
	});

	test("a session still loading is not drawn as a signed-out visitor", () => {
		expect(
			guestCreationRefused({
				guestCreationOpen: false,
				signedIn: false,
				sessionPending: true,
			}),
		).toBe(false);
	});
});

describe("the reason, in both interface languages", () => {
	test("English and German both say to sign in to create a presentation", () => {
		expect(REASON).toContain("Sign in to create a presentation");
		const german = interfaceTextFor("de").account.guestCreationClosed;
		expect(german).toContain("Melde dich an");
		expect(german).not.toBe(REASON);
	});
});

describe("CreateControl — a create drawn available or refused", () => {
	function render(refusal: string | null) {
		return renderToStaticMarkup(
			createElement(
				CreateControl,
				{
					refusal,
					label: "Create Presentation",
					className: "btn-primary",
					onClick: () => {},
				},
				"Create Presentation",
			),
		);
	}

	test("available, it is the page's plain button and nothing else", () => {
		expect(render(null)).toBe(
			'<button type="button" class="btn-primary">Create Presentation</button>',
		);
	});

	test("refused, it stays a focusable button, aria-disabled, described by its reason", () => {
		const markup = render(REASON);
		const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
		expect(tag).toContain('aria-disabled="true"');
		expect(tag).not.toMatch(/\sdisabled=""/);
		expect(tag).toContain('aria-label="Create Presentation"');
		const describedBy = tag.match(/aria-describedby="([^"]+)"/)?.[1];
		expect(describedBy).toBeTruthy();
		expect(markup).toContain(`id="${describedBy}"`);
		expect(markup).toContain(REASON);
	});
});

describe("the deck card's Duplicate (REQ252)", () => {
	function renderCard(duplicateRefusal: string | null) {
		const noop = () => {};
		return renderToStaticMarkup(
			createElement(OwnDeckCard, {
				pres: {
					id: "deck-1",
					title: "Deck",
					code: "ABC123",
					status: "draft",
					slides: [{ id: "slide-1" }],
					createdAt: "2026-10-11T09:00:00.000Z",
				} as Presentation,
				enterDelay: 1,
				owned: false,
				signedIn: false,
				duplicating: false,
				duplicateRefusal,
				onOpen: noop,
				onShare: noop,
				onFile: noop,
				onMove: noop,
				onExport: noop,
				onDuplicate: noop,
				onDelete: noop,
			}),
		);
	}

	test("refused, it is drawn disabled with the reason rather than dropped", () => {
		const markup = renderCard(REASON);
		const duplicate = markup.match(
			/<button[^>]*aria-label="Duplicate presentation"[^>]*>/,
		)?.[0];
		expect(duplicate).toBeDefined();
		expect(duplicate).toContain('aria-disabled="true"');
		expect(markup).toContain(REASON);
	});

	test("available, it is the card's own button as before", () => {
		const markup = renderCard(null);
		expect(markup).toContain('title="Duplicate presentation"');
		expect(markup).not.toContain("aria-disabled");
		expect(markup).not.toContain(REASON);
	});
});

describe("the template gallery's Use (REQ252)", () => {
	test("refused, it is drawn disabled with the reason as its title", () => {
		const markup = renderToStaticMarkup(
			createElement(UseTemplateButton, {
				label: "Use Retrospective",
				creating: false,
				busy: false,
				refusal: REASON,
				onUse: () => {},
			}),
		);
		expect(markup).toContain('disabled=""');
		expect(markup).toContain(`title="${REASON}"`);
	});
});

describe("every create surface reads the one refusal", () => {
	test("the home page draws Create, Use template, Generate, Import and the empty list's two starts through CreateControl, and Join with code not", () => {
		const home = source("pages/HomePage.tsx");
		expect(home).toContain("useGuestCreationRefusal()");
		const controls = home.match(/<CreateControl[\s\S]*?<\/CreateControl>/g) ?? [];
		const labels = controls.map(
			(control) => control.match(/label=\{words\.(\w+)\}/)?.[1],
		);
		expect(labels).toEqual([
			"createPresentation",
			"useTemplate",
			"generateDraft",
			"importDeck",
			"createFirst",
			"startFromTemplate",
		]);
		for (const control of controls) {
			expect(control).toContain("refusal={createRefusal}");
		}
		expect(controls.join("\n")).not.toContain("joinWithCode");
		expect(home).toContain("duplicateRefusal={createRefusal}");
	});

	test("the home page refuses an import and a duplicate in their handlers too", () => {
		const home = source("pages/HomePage.tsx");
		expect(home).toMatch(
			/handleImportFile = async \(file: File\) => \{\s*if \(createRefusal\) return;/,
		);
		expect(home).toMatch(/if \(duplicatingId \|\| createRefusal\) return;/);
	});

	test("the editor's Create is refused on /create and Save is not", () => {
		const editor = source("pages/CreatePage.tsx");
		expect(editor).toContain(
			"const createRefusal = isEdit ? null : guestCreationRefusal;",
		);
		expect(editor).toMatch(/<CreateControl\s+refusal=\{createRefusal\}/);
		expect(editor).toMatch(
			/const handleSubmit = async \(\) => \{\s*if \(createRefusal\) return;/,
		);
	});

	test("the template gallery passes the refusal to each entry's Use", () => {
		const gallery = source("pages/TemplatesPage.tsx");
		expect(gallery).toContain("const createRefusal = useGuestCreationRefusal();");
		expect(gallery).toContain("refusal={createRefusal}");
		expect(gallery).toContain("if (creatingId || createRefusal) return;");
	});

	test("the generate page states the same reason before its own sign-in reason", () => {
		const generate = source("pages/GeneratePage.tsx");
		expect(generate).toContain("const createRefusal = useGuestCreationRefusal();");
		const reasons = generate.slice(generate.indexOf("const blockedReason"));
		expect(reasons.indexOf("if (createRefusal) return createRefusal;")).toBeLessThan(
			reasons.indexOf("if (needsSignIn) return words.blockedSignIn;"),
		);
	});
});
