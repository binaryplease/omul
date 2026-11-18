/**
 * Whether this visitor may create a presentation here (REQ252), read the same
 * way by every create surface: the home page's Create Presentation, Use
 * template, Generate a draft, Import and Duplicate controls, the editor's
 * Create on `/create`, the template gallery's Use, and the generate page.
 *
 * The operator closes creating without an account with
 * `OMUL_GUEST_CREATION_DISABLED=true`; `GET /api/instance-access` reports it
 * as `guestCreationOpen` ({@link useInstanceAccess}). While it is closed and
 * nobody is signed in, each of those controls stays drawn and is disabled with
 * one reason — sign in to create a presentation — the way `docs/frontend.md`
 * describes an unavailable control (REQ127).
 *
 * What this module decides governs only what is drawn. The server refuses a
 * create without an account on its own routes, so a page drawn before the
 * instance access or the session arrived — both are read as open until then —
 * still meets the server's `401` with the same reason.
 */

import { useSession } from "./auth-client";
import { useInstanceAccess } from "./instance-access";
import { useInterfaceText } from "./interface-language";

/**
 * Whether a create is refused to this visitor. A session still being read is
 * not yet a signed-out visitor, so the controls are not drawn disabled for an
 * account holder while the session loads.
 */
export function guestCreationRefused({
	guestCreationOpen,
	signedIn,
	sessionPending,
}: {
	guestCreationOpen: boolean;
	signedIn: boolean;
	sessionPending: boolean;
}): boolean {
	return !guestCreationOpen && !signedIn && !sessionPending;
}

/**
 * Why this visitor may not create a presentation, in the interface language,
 * or `null` when they may.
 */
export function useGuestCreationRefusal(): string | null {
	const { guestCreationOpen } = useInstanceAccess();
	const { data: session, isPending } = useSession();
	const { text } = useInterfaceText();
	return guestCreationRefused({
		guestCreationOpen,
		signedIn: Boolean(session?.user),
		sessionPending: isPending,
	})
		? text.account.guestCreationClosed
		: null;
}
