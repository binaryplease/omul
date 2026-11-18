/**
 * What this instance lets a visitor do without an operator's help (REQ251,
 * REQ252): whether a visitor may open an account, and whether a visitor
 * without one may create a presentation.
 *
 * Each is an operator switch read by the closing-switch rule
 * (`server/closing-switch.ts`), and first read at boot: unset or `"false"` leaves the instance open as
 * it always was, `"true"` closes it, and any other value stops the boot naming
 * the variable.
 *
 * - `OMUL_SIGNUP_DISABLED` (REQ251) closes account sign-up. Better Auth
 *   enforces it (`emailAndPassword.disableSignUp` in `server/accounts.ts`);
 *   existing accounts keep signing in.
 * - `OMUL_GUEST_CREATION_DISABLED` (REQ252) closes presentation creation
 *   without an account. The two routes that write a new deck enforce it on
 *   every request (`POST /api/presentations`, `POST /api/deck-generation`):
 *   a caller with no account is refused `401` before the create budget is
 *   spent, and a caller with a cookie session or an API key creates as before.
 *
 * The two switches are independent; either may be set without the other.
 *
 * `GET /api/instance-access` (`server/routes/instance-access.ts`) reports both,
 * so the client can draw a closed action disabled with its reason instead of
 * offering an action the server refuses.
 */

import { readClosingSwitch } from "./closing-switch";
import type { InstanceAccess } from "./schemas";

/** The variable that closes account sign-up (REQ251). */
export const SIGNUP_DISABLED_ENV = "OMUL_SIGNUP_DISABLED";

/** The variable that closes presentation creation without an account (REQ252). */
export const GUEST_CREATION_DISABLED_ENV = "OMUL_GUEST_CREATION_DISABLED";

/**
 * What a create without an account is refused with while
 * {@link GUEST_CREATION_DISABLED_ENV} is on, on both create routes.
 */
export const GUEST_CREATION_CLOSED_MESSAGE =
	"This instance creates presentations for signed-in accounts only — sign in to create a presentation";

/** Whether the operator closed account sign-up. Throws on a malformed value. */
export function signUpDisabled(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	return readClosingSwitch(SIGNUP_DISABLED_ENV, environment);
}

/**
 * Whether the operator closed presentation creation without an account.
 * Throws on a malformed value.
 *
 * The create routes call this on every request rather than holding a value
 * read at import, the way `deckGenerationAllowsAnonymous()` and
 * `rateLimitsEnabled()` are read, so a test can set the switch per case. A
 * malformed value never reaches a request: `server/index.ts` resolves
 * {@link resolveInstanceAccess} at boot, and that throw stops the server.
 */
export function guestCreationDisabled(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	return readClosingSwitch(GUEST_CREATION_DISABLED_ENV, environment);
}

/** What `GET /api/instance-access` reports for this environment. */
export function resolveInstanceAccess(
	environment: Record<string, string | undefined> = process.env,
): InstanceAccess {
	return {
		signUpOpen: !signUpDisabled(environment),
		guestCreationOpen: !guestCreationDisabled(environment),
	};
}

/**
 * What the boot log says about account sign-up and about creating without an
 * account. A closed switch looks, from outside, like a form that fails, so the
 * process states which posture it is in.
 */
export function instanceAccessStartupReport(access: InstanceAccess): string[] {
	return [
		access.signUpOpen
			? `[accounts] Sign-up is open — set ${SIGNUP_DISABLED_ENV}="true" to close it.`
			: `[accounts] Sign-up is closed — ${SIGNUP_DISABLED_ENV}="true". Existing accounts still sign in.`,
		access.guestCreationOpen
			? `[accounts] Creating presentations without an account is open — set ${GUEST_CREATION_DISABLED_ENV}="true" to close it.`
			: `[accounts] Creating presentations without an account is closed — ${GUEST_CREATION_DISABLED_ENV}="true". Signed-in accounts and API keys still create; joining by code and existing edit tokens still work.`,
	];
}
