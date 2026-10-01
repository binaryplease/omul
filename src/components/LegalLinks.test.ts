/**
 * The operator's legal texts in the app (REQ183).
 *
 * Two halves, matching what the requirement asks for:
 *
 *   - **The footer under every route.** Each of the three links is drawn when
 *     its address is configured and absent when it is not, and a footer with
 *     nothing to link is no footer at all — so an instance that configured none
 *     renders exactly as before. `App` mounts it once, beside the route switch,
 *     which is what puts it under every page.
 *   - **The sentence at each contract-conclusion point.** It names the terms and
 *     the privacy policy with links to them when configured, and is absent when
 *     neither is. Signing up, creating a deck and joining with a code each mount
 *     it ahead of the control that submits — and unconditionally, not behind a
 *     state the visitor reaches only by submitting.
 *
 * The two components are rendered to static markup with React's own server
 * renderer, which needs no DOM. Where each page *places* the notice is markup
 * in a page this repo does not render in tests, so it is asserted by reading the
 * sources, the way `CreatePage.test.ts` asserts its own.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegalLinks } from "../types";
import {
	configuredLegalLinks,
	LegalFooterLinks,
	LegalNoticeText,
	NO_LEGAL_LINKS,
} from "./LegalLinks";

const ALL_LINKS: LegalLinks = {
	imprintUrl: "https://example.com/imprint",
	privacyUrl: "https://example.com/privacy",
	termsUrl: "/terms",
};

function footer(links: LegalLinks): string {
	return renderToStaticMarkup(createElement(LegalFooterLinks, { links }));
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

describe("the footer under every route (REQ183)", () => {
	test("all three configured: three links, in footer order", () => {
		const markup = footer(ALL_LINKS);
		expect(markup).toContain('href="https://example.com/imprint"');
		expect(markup).toContain('href="https://example.com/privacy"');
		expect(markup).toContain('href="/terms"');
		expect(textOf(markup)).toBe("ImprintPrivacy PolicyTerms of Service");
	});

	for (const [field, label] of [
		["imprintUrl", "Imprint"],
		["privacyUrl", "Privacy Policy"],
		["termsUrl", "Terms of Service"],
	] as const) {
		test(`${label} is drawn alone when it is the only one configured`, () => {
			const links = { ...NO_LEGAL_LINKS, [field]: ALL_LINKS[field] };
			const markup = footer(links);
			expect(markup).toContain(`href="${ALL_LINKS[field]}"`);
			expect(textOf(markup)).toBe(label);
		});

		test(`${label} is absent when it is not configured`, () => {
			const links = { ...ALL_LINKS, [field]: null };
			const markup = footer(links);
			expect(markup).not.toContain(`href="${ALL_LINKS[field]}"`);
			expect(textOf(markup)).not.toContain(label);
			expect(configuredLegalLinks(links)).toHaveLength(2);
		});
	}

	test("nothing configured: no footer at all", () => {
		expect(footer(NO_LEGAL_LINKS)).toBe("");
		expect(configuredLegalLinks(NO_LEGAL_LINKS)).toEqual([]);
	});

	test("a link opens in a new tab and hands the opener nothing", () => {
		const markup = footer(ALL_LINKS);
		expect(markup.match(/target="_blank"/g)).toHaveLength(3);
		expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
	});

	test("App mounts the footer beside the route switch, so every route has it", () => {
		const app = readSource("App.tsx");
		expect(app).toMatch(/\{content\}\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<LegalFooter \/>/);
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
