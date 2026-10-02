/**
 * The operator's legal texts in the app (REQ183).
 *
 * Two halves, matching what the requirement asks for:
 *
 *   - **The texts reachable from every route.** `AppMenu` — the small menu that
 *     took the theme switch's place on every non-loading screen — lists each of
 *     the three under a Legal section when its address is configured and leaves
 *     it out when it is not; with nothing configured there is no Legal section
 *     at all, and the menu holds Appearance alone. Every page `App` routes to
 *     mounts it, which is what puts the texts under every route now that the
 *     app-wide footer is gone.
 *   - **The sentence at each contract-conclusion point.** It names the terms and
 *     the privacy policy with links to them when configured, and is absent when
 *     neither is. Signing up, creating a deck and joining with a code each mount
 *     it ahead of the control that submits — and unconditionally, not behind a
 *     state the visitor reaches only by submitting.
 *
 * The menu's panel and the notice are rendered to static markup with React's
 * own server renderer, which needs no DOM. Where each page *places* them is
 * markup in a page this repo does not render in tests, so it is asserted by
 * reading the sources, the way `CreatePage.test.ts` asserts its own.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegalLinks } from "../types";
import {
	configuredLegalLinks,
	LegalNoticeText,
	NO_LEGAL_LINKS,
} from "./LegalLinks";
import { AppMenuPanel } from "./ui/AppMenu";

const ALL_LINKS: LegalLinks = {
	imprintUrl: "https://example.com/imprint",
	privacyUrl: "https://example.com/privacy",
	termsUrl: "/terms",
};

function menuPanel(links: LegalLinks): string {
	return renderToStaticMarkup(
		createElement(AppMenuPanel, {
			id: "app-menu",
			links,
			theme: "dark",
			onThemeChange: () => {},
		}),
	);
}

/** The menu's legal links, by their visible label, in the order drawn. */
function legalLinkLabels(markup: string): string[] {
	return [...markup.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((match) =>
		textOf(match[1]).replace(" (opens in a new tab)", ""),
	);
}

function notice(links: LegalLinks, action = "joining"): string {
	return renderToStaticMarkup(createElement(LegalNoticeText, { links, action }));
}

/** The visible text of rendered markup, tags dropped. */
function textOf(markup: string): string {
	return markup.replace(/<[^>]+>/g, "");
}

const SRC = join(import.meta.dir, "..");

function readSource(relativePath: string): string {
	return readFileSync(join(SRC, relativePath), "utf8");
}

describe("the legal texts in the app menu, on every route (REQ183)", () => {
	test("all three configured: three links, in descriptor order", () => {
		const markup = menuPanel(ALL_LINKS);
		expect(markup).toContain('href="https://example.com/imprint"');
		expect(markup).toContain('href="https://example.com/privacy"');
		expect(markup).toContain('href="/terms"');
		expect(legalLinkLabels(markup)).toEqual([
			"Imprint",
			"Privacy Policy",
			"Terms of Service",
		]);
		expect(markup).toContain(">Legal</p>");
	});

	for (const [field, label] of [
		["imprintUrl", "Imprint"],
		["privacyUrl", "Privacy Policy"],
		["termsUrl", "Terms of Service"],
	] as const) {
		test(`${label} is listed alone when it is the only one configured`, () => {
			const links = { ...NO_LEGAL_LINKS, [field]: ALL_LINKS[field] };
			const markup = menuPanel(links);
			expect(markup).toContain(`href="${ALL_LINKS[field]}"`);
			expect(legalLinkLabels(markup)).toEqual([label]);
		});

		test(`${label} is absent when it is not configured`, () => {
			const links = { ...ALL_LINKS, [field]: null };
			const markup = menuPanel(links);
			expect(markup).not.toContain(`href="${ALL_LINKS[field]}"`);
			expect(legalLinkLabels(markup)).not.toContain(label);
			expect(legalLinkLabels(markup)).toHaveLength(2);
			expect(configuredLegalLinks(links)).toHaveLength(2);
		});
	}

	test("nothing configured: no Legal section, Appearance alone", () => {
		const markup = menuPanel(NO_LEGAL_LINKS);
		expect(markup).not.toContain("<a");
		expect(markup).not.toContain("<nav");
		expect(textOf(markup)).not.toContain("Legal");
		expect(textOf(markup)).toContain("Appearance");
		expect(configuredLegalLinks(NO_LEGAL_LINKS)).toEqual([]);
	});

	test("Appearance offers the three themes as a radio group, the chosen one checked", () => {
		const markup = menuPanel(NO_LEGAL_LINKS);
		expect(markup).toContain('role="radiogroup"');
		expect(markup.match(/role="radio"/g)).toHaveLength(3);
		expect(textOf(markup)).toContain("LightDarkAuto");
		expect(markup).toMatch(/aria-checked="true"[^>]*data-theme-option="dark"/);
		expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
		expect(markup).not.toContain('role="menu"');
	});

	test("a link opens in a new tab and hands the opener nothing", () => {
		const markup = menuPanel(ALL_LINKS);
		expect(markup.match(/target="_blank"/g)).toHaveLength(3);
		expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
	});

	/** Every page component `App`'s route switch renders. */
	function routedPages(): string[] {
		const app = readSource("App.tsx");
		return [
			...new Set(
				[...app.matchAll(/return <(\w+Page)\b/g)].map((match) => match[1]),
			),
		];
	}

	test("App routes to the pages this test reads", () => {
		expect(routedPages().length).toBeGreaterThanOrEqual(11);
	});

	test("every routed page mounts the menu, and none the old theme toggle", () => {
		for (const page of routedPages()) {
			const source = readSource(`pages/${page}.tsx`);
			expect(source).toContain(
				'import { AppMenu } from "../components/ui/AppMenu";',
			);
			expect(source).toContain("<AppMenu />");
			expect(source).not.toContain("ThemeToggle");
		}
	});

	/**
	 * Pages with more than one screen mount the menu on each one but a loading
	 * spinner: the footer used to sit under every render branch, so a branch
	 * without the menu is a screen the texts cannot be reached from.
	 */
	const SCREENS_PER_PAGE = {
		PresenterPage: ["error", "blanked screen", "live"],
		PreviewPage: ["error", "dry run"],
		ParticipantPage: ["error", "ended", "name gate", "waiting", "slide"],
		SharedResultsPage: ["unavailable link", "results"],
	} as const;

	for (const [page, screens] of Object.entries(SCREENS_PER_PAGE)) {
		test(`${page} mounts the menu on each of its screens: ${screens.join(", ")}`, () => {
			const source = readSource(`pages/${page}.tsx`);
			expect(source.match(/<AppMenu \/>/g)).toHaveLength(screens.length);
		});
	}

	/**
	 * A page-level `return null` draws a screen with no menu on it, and so no
	 * way to the legal texts — the footer used to cover it, nothing does now.
	 * Each one left is listed with why it cannot be a screen a visitor stays on.
	 */
	const NULL_RETURNS_ALLOWED: Record<string, string[]> = {
		// After the loading and error branches: one of `pres` or `error` is set.
		PresenterPage: ["if (!pres) return null;"],
		ParticipantPage: [
			"if (!pres) return null;",
			// A survey deck with no active slide. Not shown reachable; kept as the
			// open question the REQ183 review left rather than silently endorsed.
			"if (!activeSlide) return null;",
		],
	};

	test("no routed page renders nothing outside the listed unreachable cases", () => {
		for (const page of routedPages()) {
			const source = readSource(`pages/${page}.tsx`);
			const nullReturns = [
				...source.matchAll(/^\t((?:if \(.*\) )?return null;)/gm),
			].map((match) => match[1]);
			expect(nullReturns).toEqual(NULL_RETURNS_ALLOWED[page] ?? []);
		}
	});

	test("a preview whose run cannot be read shows the error screen, menu and all", () => {
		// The review's case: a visitor without edit rights reads the deck, gets a
		// 401 for `/preview`, and used to fall through to `return null`.
		const source = readSource("pages/PreviewPage.tsx");
		expect(source).toContain("const runMissing = !pres || !preview;");
		const errorBranch = source.indexOf("if (error && runMissing) {");
		const menu = source.indexOf("<AppMenu />", errorBranch);
		const nextBranch = source.indexOf("if (loading ||", errorBranch);
		expect(errorBranch).toBeGreaterThan(-1);
		expect(menu).toBeGreaterThan(errorBranch);
		expect(menu).toBeLessThan(nextBranch);
	});

	test("the presenter's blanked screen carries the menu inside its early return", () => {
		const source = readSource("pages/PresenterPage.tsx");
		const blank = source.indexOf('if (sharedScreenView(pres) === "blank")');
		const curtain = source.indexOf("<AudienceBlankCurtain", blank);
		const menu = source.indexOf("<AppMenu />", blank);
		expect(blank).toBeGreaterThan(-1);
		expect(menu).toBeGreaterThan(blank);
		expect(menu).toBeLessThan(curtain);
	});

	test("App no longer mounts a legal footer", () => {
		const app = readSource("App.tsx");
		expect(app).not.toContain("LegalFooter");
		expect(app).not.toContain("<footer");
		expect(app).toMatch(/\{content\}\s*<\/StoreProvider>/);
	});
});

describe("the notice where a contract is concluded (REQ183)", () => {
	test("terms and privacy configured: one notice naming and linking both", () => {
		const markup = notice(ALL_LINKS, "creating an account");
		expect(textOf(markup)).toBe(
			"By creating an account, you agree to the Terms of Service. The Privacy Policy explains how your data is processed.",
		);
		expect(markup).toContain('href="/terms"');
		expect(markup).toContain('href="https://example.com/privacy"');
	});

	test("only the terms configured: names the terms alone", () => {
		const markup = notice({ ...NO_LEGAL_LINKS, termsUrl: "/terms" });
		expect(textOf(markup)).toBe("By joining, you agree to the Terms of Service.");
	});

	test("only the privacy policy configured: names the privacy policy alone", () => {
		const markup = notice({ ...NO_LEGAL_LINKS, privacyUrl: "/privacy" });
		expect(textOf(markup)).toBe(
			"The Privacy Policy explains how your data is processed.",
		);
	});

	test("neither configured: no notice, even with an imprint", () => {
		expect(notice(NO_LEGAL_LINKS)).toBe("");
		expect(notice({ ...NO_LEGAL_LINKS, imprintUrl: "/imprint" })).toBe("");
	});

	/** Each point, the file it lives in and how it mounts the notice. */
	const CONTRACT_POINTS = [
		{
			name: "account sign-up",
			file: "auth.tsx",
			mount: '{mode === "signup" && <LegalNotice action="creating an account" />}',
		},
		{
			name: "creating a presentation",
			file: "pages/CreatePage.tsx",
			mount: 'action="creating this presentation"',
		},
		{
			name: "joining with a six-digit code",
			file: "pages/JoinPage.tsx",
			mount: '<LegalNotice action="joining"',
		},
	] as const;

	for (const point of CONTRACT_POINTS) {
		test(`${point.name} mounts the notice`, () => {
			const source = readSource(point.file);
			expect(source).toContain(point.mount);
			expect(source).toMatch(
				/import \{ LegalNotice \} from "\.\.?\/components\/LegalLinks";/,
			);
		});
	}

	test("sign-up names the terms inside the form, above the button that submits it", () => {
		const source = readSource("auth.tsx");
		const form = source.indexOf("<form");
		const mount = source.indexOf(CONTRACT_POINTS[0].mount);
		const submit = source.indexOf(
			'<button type="submit" disabled={busy} className={BTN_PRIMARY}>',
		);
		expect(form).toBeGreaterThan(-1);
		expect(mount).toBeGreaterThan(form);
		expect(submit).toBeGreaterThan(mount);
	});

	test("creating a presentation names the terms in the bar that holds Create, for a new deck only", () => {
		const source = readSource("pages/CreatePage.tsx");
		const submit = source.indexOf("onClick={handleSubmit}");
		const mount = source.search(
			/\{!isEdit && \(\s*<LegalNotice\s+action="creating this presentation"/,
		);
		const headerEnd = source.indexOf("</header>", submit);
		expect(submit).toBeGreaterThan(-1);
		expect(mount).toBeGreaterThan(submit);
		expect(headerEnd).toBeGreaterThan(mount);
	});

	test("joining names the terms below both ways in, typed and scanned", () => {
		const source = readSource("pages/JoinPage.tsx");
		const mount = source.indexOf(CONTRACT_POINTS[2].mount);
		// The scan view and the code-entry view are the two branches of one
		// toggle; the notice sits after both, so neither hides it.
		expect(mount).toBeGreaterThan(source.indexOf("Cancel scan"));
		expect(mount).toBeGreaterThan(source.indexOf("Scan QR Code"));
		expect(mount).toBeLessThan(source.indexOf("Back to home"));
	});

	/**
	 * The way most of a room arrives: the projected QR code and the
	 * `/join/<code>` link open `ParticipantPage` directly, past `JoinPage` and
	 * its notice, and the join lookup runs on arrival. So the participant page
	 * names the terms itself, on every screen a participant can submit from.
	 */
	test("a /join/<code> link lands on a page that names the terms wherever it takes input", () => {
		const router = readSource("router.ts");
		expect(router).toContain('return { page: "participate", code:');

		const source = readSource("pages/ParticipantPage.tsx");
		expect(source).toMatch(
			/import \{ LegalNotice \} from "\.\.\/components\/LegalLinks";/,
		);
		expect(source).toContain('<LegalNotice action="taking part"');

		const uses = [...source.matchAll(/\{legalNotice\}/g)].map(
			(match) => match.index ?? -1,
		);
		expect(uses).toHaveLength(3);
		const [afterNameForm, onWaitingScreen, underAnswers] = uses;

		// Under the name form — the first thing a deck that asks for one submits —
		// and still inside that screen's early return.
		const nameGate = source.indexOf("<ParticipantNameGate");
		expect(afterNameForm).toBeGreaterThan(nameGate);
		expect(afterNameForm).toBeLessThan(source.indexOf("const nameBadge"));

		// On the screen a participant waits on before the deck starts, inside that
		// screen's early return too.
		const waiting = source.indexOf("{t.waitingPresenter}");
		expect(onWaitingScreen).toBeGreaterThan(waiting);
		expect(onWaitingScreen).toBeLessThan(
			source.indexOf("if (!activeSlide) return null;"),
		);

		// Directly under the live slide's answer controls, ahead of everything
		// else on that screen.
		const answers = source.indexOf("<ParticipantSlideView");
		expect(underAnswers).toBeGreaterThan(answers);
		expect(underAnswers).toBeLessThan(
			source.indexOf("Survey-mode navigation"),
		);
	});
});
