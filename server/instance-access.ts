/**
 * What this instance lets a visitor do without an operator's help (REQ251,
 * REQ252): whether a visitor may open an account, and whether a visitor
 * without one may create a presentation.
 *
 * Each is an operator switch read once at boot by the closing-switch rule
 * (`server/closing-switch.ts`): unset or `"false"` leaves the instance open as
 * it always was, `"true"` closes it, and any other value stops the boot naming
 * the variable.
 *
 * - `OMUL_SIGNUP_DISABLED` (REQ251) closes account sign-up. Better Auth
 *   enforces it (`emailAndPassword.disableSignUp` in `server/accounts.ts`);
 *   existing accounts keep signing in.
 * - Presentation creation without an account is REQ252's switch. Until it is
 *   built, `guestCreationOpen` is always `true`.
 *
 * `GET /api/instance-access` (`server/routes/instance-access.ts`) reports both,
 * so the client can draw a closed action disabled with its reason instead of
 * offering an action the server refuses.
 */

import { readClosingSwitch } from "./closing-switch";
import type { InstanceAccess } from "./schemas";

/** The variable that closes account sign-up (REQ251). */
export const SIGNUP_DISABLED_ENV = "OMUL_SIGNUP_DISABLED";

/** Whether the operator closed account sign-up. Throws on a malformed value. */
export function signUpDisabled(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	return readClosingSwitch(SIGNUP_DISABLED_ENV, environment);
}

/** What `GET /api/instance-access` reports for this environment. */
export function resolveInstanceAccess(
	environment: Record<string, string | undefined> = process.env,
): InstanceAccess {
	return {
		signUpOpen: !signUpDisabled(environment),
		guestCreationOpen: true,
	};
}

/**
 * What the boot log says about account sign-up. A closed sign-up looks, from
 * outside, like a sign-up form that fails, so the process states which one it
 * is.
 */
export function instanceAccessStartupReport(access: InstanceAccess): string[] {
	return [
		access.signUpOpen
			? `[accounts] Sign-up is open — set ${SIGNUP_DISABLED_ENV}="true" to close it.`
			: `[accounts] Sign-up is closed — ${SIGNUP_DISABLED_ENV}="true". Existing accounts still sign in.`,
	];
}
