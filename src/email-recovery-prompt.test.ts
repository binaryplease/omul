/**
 * Unit tests for the home page's offer to add an email (REQ194) — when it is
 * shown, how its close is remembered, and what it draws.
 *
 * What they are protecting: the notice appears for a browser that holds decks
 * and no account, disappears once that browser signs in, and stays closed once
 * closed — an offer, never a gate. `localStorage` is a stub, as in
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
import {
	dismissEmailRecoveryPrompt,
	emailRecoveryPromptDismissed,
	shouldOfferEmailRecovery,
} from "./email-recovery-prompt";
import { getDict } from "./i18n";
import { EMAIL_RECOVERY_PROMPT_DISMISSED_KEY } from "./storage";

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

/** A signed-out browser holding one deck that never closed the notice. */
const OFFERED = {
	sessionPending: false,
	signedIn: false,
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
