/**
 * Whether the home page offers to add an email address (REQ194).
 *
 * A deck made without an account is held by one thing: its edit token, in this
 * browser's storage (`TOKEN_KEY` in `src/storage.ts`). Clear that storage and
 * every such deck is gone for good — the server keeps only the token's hash.
 * An account is the way out, and it already exists: signing in claims every
 * deck this browser holds (`claimLocalPresentations()` in `src/api.ts`). This
 * module decides when the home page says so, and `shouldOfferEmailRecovery()`
 * is the one place the conditions are combined:
 *
 *   1. **The session and the list are known.** While either is still loading,
 *      nothing is offered, so a signed-in visitor never sees the notice flash
 *      past.
 *   2. **This browser has never been signed in.** Signing in is what the offer
 *      asks for, so it takes the notice away — for good, not only while the
 *      session lasts. Neither the claim nor signing out removes the local edit
 *      tokens, so after a sign-out (or an expired session) the claimed decks are
 *      still listed here; telling that browser they are "saved only in this
 *      browser" and opening "Create account" for an address that already has
 *      one would be false twice over. So the first session this browser sees is
 *      remembered (`rememberAccountInThisBrowser()`), and from then on the
 *      header's Sign in button is the way back, not this notice.
 *   3. **This browser holds at least one deck.** With nothing to lose, there is
 *      nothing to offer.
 *   4. **This browser has not closed it.** It is an offer, never a gate, so the
 *      close control is always there and is remembered here
 *      (`dismissEmailRecoveryPrompt()`). A browser that loses its storage loses
 *      both memories too — and with them the decks, so there is nothing to
 *      offer.
 */

import {
	EMAIL_RECOVERY_ACCOUNT_SEEN_KEY,
	EMAIL_RECOVERY_PROMPT_DISMISSED_KEY,
} from "./storage";

export function shouldOfferEmailRecovery(state: {
	sessionPending: boolean;
	listLoading: boolean;
	signedIn: boolean;
	accountSeen: boolean;
	localDeckCount: number;
	dismissed: boolean;
}): boolean {
	return (
		!state.sessionPending &&
		!state.listLoading &&
		!state.signedIn &&
		!state.accountSeen &&
		state.localDeckCount > 0 &&
		!state.dismissed
	);
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
		// Storage denied. The notice stays away while the session lasts, which is
		// all a browser that keeps nothing allows.
	}
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
