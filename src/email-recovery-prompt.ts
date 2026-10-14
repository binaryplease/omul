/**
 * Whether, and how, the home page offers to keep this browser's decks (REQ194).
 *
 * A deck made without an account is held by one thing: its edit token, in this
 * browser's storage (`TOKEN_KEY` in `src/storage.ts`). Clear that storage and
 * every such deck is gone for good — the server keeps only the token's hash.
 * An account is the way out, and it already exists: signing in adopts every
 * deck this browser holds (`claimLocalPresentations()` in `src/api.ts`), which
 * also drops the local token, so a deck the account owns is not listed here
 * once signed out. What a signed-out home page lists is therefore exactly what
 * is held only by this browser. `emailRecoveryOfferFor()` is the one place the
 * conditions are combined, and it answers with the offer to make — `"signup"`
 * or `"signin"`, the tab the sign-in dialog opens on — or `null` for none:
 *
 *   1. **The session and the list are known.** While either is still loading,
 *      nothing is offered, so a signed-in visitor never sees the notice flash
 *      past.
 *   2. **Nobody is signed in.** Signing in is what the offer asks for, and it
 *      adopts the decks, so it takes the notice away.
 *   3. **This browser holds at least one deck.** With nothing to lose, there is
 *      nothing to offer. A deck made after signing out of an account counts:
 *      it is held only here, like any other.
 *   4. **This browser has not closed it.** It is an offer, never a gate, so the
 *      close control is always there and is remembered here
 *      (`dismissEmailRecoveryPrompt()`). A browser that loses its storage loses
 *      that memory too — and with it the decks, so there is nothing to offer.
 *
 * Which offer is made depends on whether this browser has had an account
 * (`useAccountSeenInThisBrowser()`, worn by `AuthControls` on every page with a
 * header and by the home page): a browser that never had one is offered to
 * create one, and one that had is asked to sign in, since "Create account"
 * would refuse the address it already registered. That record covers sessions
 * this client has observed; a browser signed in before it existed, and signed
 * out before a page with a header saw that session, is offered "Create
 * account" — a signed-out client is never told who owns a deck, by design, and
 * the dialog's Sign in tab is one click away.
 */

import { useEffect, useState } from "react";
import {
	EMAIL_RECOVERY_ACCOUNT_SEEN_KEY,
	EMAIL_RECOVERY_PROMPT_DISMISSED_KEY,
} from "./storage";

/** The tab the sign-in dialog opens on when the offer is taken. */
export type EmailRecoveryOffer = "signup" | "signin";

export function emailRecoveryOfferFor(state: {
	sessionPending: boolean;
	listLoading: boolean;
	signedIn: boolean;
	accountSeen: boolean;
	localDeckCount: number;
	dismissed: boolean;
}): EmailRecoveryOffer | null {
	const offered =
		!state.sessionPending &&
		!state.listLoading &&
		!state.signedIn &&
		state.localDeckCount > 0 &&
		!state.dismissed;
	if (!offered) return null;
	return state.accountSeen ? "signin" : "signup";
}

/**
 * Whether this browser has been signed in to an account — `false` where
 * storage is denied.
 */
export function accountSeenInThisBrowser(): boolean {
	try {
		return localStorage.getItem(EMAIL_RECOVERY_ACCOUNT_SEEN_KEY) === "true";
	} catch {
		return false;
	}
}

/** Remember that this browser has been signed in to an account. */
export function rememberAccountInThisBrowser(): void {
	try {
		localStorage.setItem(EMAIL_RECOVERY_ACCOUNT_SEEN_KEY, "true");
	} catch {
		// Storage denied. A later sign-out is then offered "Create account", and
		// the dialog's Sign in tab is one click from it.
	}
}

/**
 * Record a session wherever one is observed, and say whether this browser has
 * ever been signed in. `userId` is the signed-in account's id, `null` while
 * signed out; the record is written the first render that sees one.
 */
export function useAccountSeenInThisBrowser(userId: string | null): boolean {
	const [accountSeen, setAccountSeen] = useState(accountSeenInThisBrowser);
	useEffect(() => {
		if (!userId) return;
		rememberAccountInThisBrowser();
		setAccountSeen(true);
	}, [userId]);
	return accountSeen;
}

/** Whether this browser closed the offer — `false` where storage is denied. */
export function emailRecoveryPromptDismissed(): boolean {
	try {
		return localStorage.getItem(EMAIL_RECOVERY_PROMPT_DISMISSED_KEY) === "true";
	} catch {
		return false;
	}
}

/** Remember that this browser closed the offer. */
export function dismissEmailRecoveryPrompt(): void {
	try {
		localStorage.setItem(EMAIL_RECOVERY_PROMPT_DISMISSED_KEY, "true");
	} catch {
		// Storage denied. The notice the visitor just closed stays closed until
		// the page is reloaded, which is all a browser that keeps nothing allows.
	}
}
