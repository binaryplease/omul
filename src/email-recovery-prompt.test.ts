/**
 * Unit tests for the home page's offer to add an email (REQ194) — when it is
 * shown, how its close is remembered, and what it draws.
 *
 * What they are protecting: the notice appears for a browser that holds decks
 * and no account, disappears once that browser signs in — and stays gone after
 * a sign-out, when the claimed decks are still listed but its words would be
 * false — and stays closed once closed: an offer, never a gate. `localStorage` is a stub, as in
 * `src/feedback-prompt.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	EMAIL_RECOVERY_PROMPT_LABELS,
	EmailRecoveryPrompt,
	emailRecoveryPromptLabelsFor,
} from "./components/EmailRecoveryPrompt";
import { NoticeFrame } from "./components/ui/NoticeFrame";
import {
	accountSeenInThisBrowser,
	dismissEmailRecoveryPrompt,
	emailRecoveryPromptDismissed,
	rememberAccountInThisBrowser,
	shouldOfferEmailRecovery,
} from "./email-recovery-prompt";
import { getDict } from "./i18n";
import {
	EMAIL_RECOVERY_ACCOUNT_SEEN_KEY,
	EMAIL_RECOVERY_PROMPT_DISMISSED_KEY,
} from "./storage";

/** The smallest thing that behaves like `localStorage` for these reads. */
function installStorageStub(): Map<string, string> {
	const entries = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
	return entries;
}

// Installed per test and put back after, so another suite's stub in the same
// process is left as it found it.
let storage = new Map<string, string>();
let previousStorage: unknown;

beforeEach(() => {
	previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
	storage = installStorageStub();
});

afterEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = previousStorage;
});

/**
 * A browser that was never signed in, holding one deck, that never closed the
 * notice, with the session and the list both loaded.
 */
const OFFERED = {
	sessionPending: false,
	listLoading: false,
	signedIn: false,
	accountSeen: false,
	localDeckCount: 1,
	dismissed: false,
};

describe("shouldOfferEmailRecovery", () => {
	test("offers it to a signed-out browser holding a deck", () => {
		expect(shouldOfferEmailRecovery(OFFERED)).toBe(true);
		expect(shouldOfferEmailRecovery({ ...OFFERED, localDeckCount: 7 })).toBe(
			true,
		);
	});

	test("does not offer it once signed in", () => {
		expect(shouldOfferEmailRecovery({ ...OFFERED, signedIn: true })).toBe(
			false,
		);
	});

	test("does not offer it to a browser holding no deck", () => {
		expect(shouldOfferEmailRecovery({ ...OFFERED, localDeckCount: 0 })).toBe(
			false,
		);
	});

	test("does not offer it once closed", () => {
		expect(shouldOfferEmailRecovery({ ...OFFERED, dismissed: true })).toBe(
			false,
		);
	});

	test("waits for the session, so a signed-in visitor never sees it flash", () => {
		expect(shouldOfferEmailRecovery({ ...OFFERED, sessionPending: true })).toBe(
			false,
		);
	});

	test("waits for the list, so a count still loading offers nothing", () => {
		expect(shouldOfferEmailRecovery({ ...OFFERED, listLoading: true })).toBe(
			false,
		);
	});

	test("stays gone after signing out of an account this browser held", () => {
		// Sign-out keeps the edit tokens, so the claimed decks are still listed —
		// but "saved only in this browser" and "Create account" would both be false.
		expect(
			shouldOfferEmailRecovery({
				...OFFERED,
				signedIn: false,
				accountSeen: true,
				localDeckCount: 2,
			}),
		).toBe(false);
	});
});

describe("the remembered account", () => {
	test("is not remembered in a fresh browser", () => {
		expect(accountSeenInThisBrowser()).toBe(false);
	});

	test("outlives the session it was seen in", () => {
		rememberAccountInThisBrowser();
		expect(storage.get(EMAIL_RECOVERY_ACCOUNT_SEEN_KEY)).toBe("true");
		// A later visit, signed out, reads it back and is not offered the notice.
		expect(
			shouldOfferEmailRecovery({
				...OFFERED,
				accountSeen: accountSeenInThisBrowser(),
			}),
		).toBe(false);
	});

	test("reads a value this browser did not write as never signed in", () => {
		storage.set(EMAIL_RECOVERY_ACCOUNT_SEEN_KEY, "1");
		expect(accountSeenInThisBrowser()).toBe(false);
	});
});

describe("the remembered close", () => {
	test("is not closed in a fresh browser", () => {
		expect(emailRecoveryPromptDismissed()).toBe(false);
	});

	test("stays closed after closing", () => {
		dismissEmailRecoveryPrompt();
		expect(storage.get(EMAIL_RECOVERY_PROMPT_DISMISSED_KEY)).toBe("true");
		expect(emailRecoveryPromptDismissed()).toBe(true);
	});

	test("reads a value this browser did not write as not closed", () => {
		storage.set(EMAIL_RECOVERY_PROMPT_DISMISSED_KEY, "yes please");
		expect(emailRecoveryPromptDismissed()).toBe(false);
	});

	test("survives storage that refuses every call", () => {
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		};
		expect(emailRecoveryPromptDismissed()).toBe(false);
		expect(() => dismissEmailRecoveryPrompt()).not.toThrow();
		expect(accountSeenInThisBrowser()).toBe(false);
		expect(() => rememberAccountInThisBrowser()).not.toThrow();
	});
});

describe("NoticeFrame", () => {
	test("draws the verify-email banner's frame unchanged in the warning tone", () => {
		expect(
			renderToStaticMarkup(
				createElement(NoticeFrame, { tone: "warning", children: "x" }),
			),
		).toBe(
			'<div class="flex flex-col gap-3 rounded-xl border border-warning bg-surface px-4 py-3 text-left sm:flex-row sm:items-center">x</div>',
		);
	});

	test("differs from it only in the border in the neutral tone", () => {
		const markup = renderToStaticMarkup(
			createElement(EmailRecoveryPrompt, {
				onAddEmail: () => {},
				onDismiss: () => {},
			}),
		);
		expect(markup).toStartWith(
			'<div role="note" class="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left sm:flex-row sm:items-center">',
		);
	});
});

describe("EmailRecoveryPrompt", () => {
	const noop = () => {};

	test("draws the text, the action and a named close control", () => {
		const markup = renderToStaticMarkup(
			createElement(EmailRecoveryPrompt, {
				onAddEmail: noop,
				onDismiss: noop,
			}),
		);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.text);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.action);
		expect(markup).toContain(
			`aria-label="${EMAIL_RECOVERY_PROMPT_LABELS.dismiss}"`,
		);
		// Both controls are real buttons, so both are reachable by keyboard.
		expect(markup.match(/<button type="button"/g)?.length).toBe(2);
	});

	test("draws in English on the home page", () => {
		expect(EMAIL_RECOVERY_PROMPT_LABELS).toEqual(
			emailRecoveryPromptLabelsFor(getDict("en")),
		);
	});

	test("carries its words in every language the dictionary has", () => {
		for (const language of ["de", "fr", "es", "it", "pt", "nl"]) {
			const labels = emailRecoveryPromptLabelsFor(getDict(language));
			expect(labels.text).not.toBe(EMAIL_RECOVERY_PROMPT_LABELS.text);
			expect(labels.action).not.toBe(EMAIL_RECOVERY_PROMPT_LABELS.action);
			expect(labels.dismiss).not.toBe(EMAIL_RECOVERY_PROMPT_LABELS.dismiss);
		}
	});
});
