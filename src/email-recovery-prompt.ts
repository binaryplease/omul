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
 *   1. **The session is known.** While it is still loading, nothing is offered,
 *      so a signed-in visitor never sees the notice flash past.
 *   2. **Nobody is signed in.** Signing in is what the offer asks for, so it
 *      takes the notice away.
 *   3. **This browser holds at least one deck.** With nothing to lose, there is
 *      nothing to offer.
 *   4. **This browser has not closed it.** It is an offer, never a gate, so the
 *      close control is always there and is remembered here
 *      (`dismissEmailRecoveryPrompt()`). A browser that loses its storage loses
 *      that memory too — and with it the decks, so there is nothing to offer.
 */

import { EMAIL_RECOVERY_PROMPT_DISMISSED_KEY } from "./storage";

export function shouldOfferEmailRecovery(state: {
	sessionPending: boolean;
	signedIn: boolean;
	localDeckCount: number;
	dismissed: boolean;
}): boolean {
	return (
		!state.sessionPending &&
		!state.signedIn &&
		state.localDeckCount > 0 &&
		!state.dismissed
	);
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
