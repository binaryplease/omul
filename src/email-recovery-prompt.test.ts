/**
 * Unit tests for the home page's offer to keep this browser's decks (REQ194) —
 * when it is shown, which of its two offers it makes, how its close is
 * remembered, and what it draws.
 *
 * What they are protecting: the notice appears for a signed-out browser that
 * holds decks — offering to create an account, or to sign in when this browser
 * has had one, including for a deck made after signing out — disappears while
 * signed in, and stays closed once closed: an offer, never a gate.
 * `localStorage` is a stub, as in `src/feedback-prompt.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
	emailRecoveryOfferFor,
	rememberAccountInThisBrowser,
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

describe("emailRecoveryOfferFor", () => {
	test("offers a browser that never had an account to create one", () => {
		expect(emailRecoveryOfferFor(OFFERED)).toBe("signup");
		expect(emailRecoveryOfferFor({ ...OFFERED, localDeckCount: 7 })).toBe(
			"signup",
		);
	});

	test("asks a browser that had an account to sign in instead", () => {
		// The owner's case: an account made earlier, signed out, a new deck held
		// only here. Adopted decks are no longer listed, so this one is the only
		// thing the count can be — and "Create account" would refuse the address.
		expect(
			emailRecoveryOfferFor({
				...OFFERED,
				accountSeen: true,
				localDeckCount: 1,
			}),
		).toBe("signin");
	});

	test("offers nothing while signed in, whatever this browser had", () => {
		expect(emailRecoveryOfferFor({ ...OFFERED, signedIn: true })).toBeNull();
		expect(
			emailRecoveryOfferFor({ ...OFFERED, signedIn: true, accountSeen: true }),
		).toBeNull();
	});

	test("offers nothing to a browser holding no deck", () => {
		expect(emailRecoveryOfferFor({ ...OFFERED, localDeckCount: 0 })).toBeNull();
		expect(
			emailRecoveryOfferFor({
				...OFFERED,
				accountSeen: true,
				localDeckCount: 0,
			}),
		).toBeNull();
	});

	test("offers nothing once closed, in either variant", () => {
		expect(emailRecoveryOfferFor({ ...OFFERED, dismissed: true })).toBeNull();
		expect(
			emailRecoveryOfferFor({ ...OFFERED, dismissed: true, accountSeen: true }),
		).toBeNull();
	});

	test("waits for the session, so a signed-in visitor never sees it flash", () => {
		expect(
			emailRecoveryOfferFor({ ...OFFERED, sessionPending: true }),
		).toBeNull();
	});

	test("waits for the list, so a count still loading offers nothing", () => {
		expect(emailRecoveryOfferFor({ ...OFFERED, listLoading: true })).toBeNull();
	});
});

describe("the remembered account", () => {
	test("is not remembered in a fresh browser", () => {
		expect(accountSeenInThisBrowser()).toBe(false);
	});

	test("outlives the session it was seen in", () => {
		rememberAccountInThisBrowser();
		expect(storage.get(EMAIL_RECOVERY_ACCOUNT_SEEN_KEY)).toBe("true");
		// A later visit, signed out with a deck, reads it back and is asked to
		// sign in rather than to create an account.
		expect(
			emailRecoveryOfferFor({
				...OFFERED,
				accountSeen: accountSeenInThisBrowser(),
			}),
		).toBe("signin");
	});

	test("is recorded wherever a page with a header sees the session", () => {
		// No DOM in these tests, so the hook's effect cannot run here; what is held
		// is that the header every such page mounts, and the home page itself, are
		// the hook's call sites — a session that starts and ends on /workspaces
		// still turns the offer into "sign in".
		const read = (path: string) =>
			readFileSync(join(import.meta.dir, path), "utf8");
		const authControls = read("auth.tsx").split(
			"export function AuthControls()",
		)[1];
		expect(authControls?.split("\nfunction ")[0]).toContain(
			"useAccountSeenInThisBrowser(data?.user?.id ?? null);",
		);
		expect(read("pages/HomePage.tsx")).toContain(
			"useAccountSeenInThisBrowser(userId)",
		);
		for (const page of [
			"pages/WorkspacesPage.tsx",
			"pages/WorkspacePage.tsx",
			"pages/AdminFeedbackPage.tsx",
		]) {
			expect(read(page)).toContain("<AuthControls");
		}
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
				offer: "signup",
				onTakeOffer: () => {},
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

	test("draws the create-account offer, its action and a named close", () => {
		const markup = renderToStaticMarkup(
			createElement(EmailRecoveryPrompt, {
				offer: "signup",
				onTakeOffer: noop,
				onDismiss: noop,
			}),
		);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.text.signup);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.action.signup);
		expect(markup).not.toContain(EMAIL_RECOVERY_PROMPT_LABELS.text.signin);
		expect(markup).toContain(
			`aria-label="${EMAIL_RECOVERY_PROMPT_LABELS.dismiss}"`,
		);
		// Both controls are real buttons, so both are reachable by keyboard.
		expect(markup.match(/<button type="button"/g)?.length).toBe(2);
	});

	test("draws the sign-in offer for a browser that had an account", () => {
		const markup = renderToStaticMarkup(
			createElement(EmailRecoveryPrompt, {
				offer: "signin",
				onTakeOffer: noop,
				onDismiss: noop,
			}),
		);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.text.signin);
		expect(markup).toContain(EMAIL_RECOVERY_PROMPT_LABELS.action.signin);
		expect(markup).not.toContain(EMAIL_RECOVERY_PROMPT_LABELS.text.signup);
		expect(markup).toContain(
			`aria-label="${EMAIL_RECOVERY_PROMPT_LABELS.dismiss}"`,
		);
	});

	test("opens the dialog on the tab its offer names", () => {
		// No DOM to click through; the home page hands the offer it drew to the
		// dialog as its starting tab.
		const home = readFileSync(
			join(import.meta.dir, "pages/HomePage.tsx"),
			"utf8",
		);
		expect(home).toContain(
			"onTakeOffer={() => setRecoveryDialogTab(emailRecoveryOffer)}",
		);
		expect(home).toContain("initialMode={recoveryDialogTab}");
	});

	test("draws in English on the home page", () => {
		expect(EMAIL_RECOVERY_PROMPT_LABELS).toEqual(
			emailRecoveryPromptLabelsFor(getDict("en")),
		);
	});

	test("carries its words in every language the dictionary has", () => {
		for (const language of ["de", "fr", "es", "it", "pt", "nl"]) {
			const labels = emailRecoveryPromptLabelsFor(getDict(language));
			for (const offer of ["signup", "signin"] as const) {
				expect(labels.text[offer]).toBeTruthy();
				expect(labels.text[offer]).not.toBe(
					EMAIL_RECOVERY_PROMPT_LABELS.text[offer],
				);
				expect(labels.action[offer]).toBeTruthy();
				expect(labels.action[offer]).not.toBe(
					EMAIL_RECOVERY_PROMPT_LABELS.action[offer],
				);
			}
			expect(labels.text.signin).not.toBe(labels.text.signup);
			expect(labels.dismiss).not.toBe(EMAIL_RECOVERY_PROMPT_LABELS.dismiss);
		}
	});
});
