/**
 * An operator switch that closes something this instance otherwise offers
 * (REQ251, and REQ252 after it).
 *
 * The repository's other boolean switches read `=== "true"` and treat every
 * other value as off (`server/auth-secret.ts`, `server/rate-limit.ts`). That
 * rule is right for a switch that *opens* something: a typo leaves it closed.
 * For a switch that *closes* something it is wrong, because a typo such as
 * `"1"` or `"yes"` would leave the instance open while the operator believes it
 * closed. So a closing switch accepts exactly two spellings and refuses every
 * other one at boot:
 *
 *  - unset, or set to the empty string: off, the instance behaves as before;
 *  - `"false"`: off;
 *  - `"true"`: on;
 *  - anything else: a thrown `Error` naming the variable and both accepted
 *    values. Read at boot, that is a fatal startup error.
 *
 * The value is read under a bracket off the environment object, never as a
 * dotted `process.env.NAME` literal, which is the form a bundler is entitled to
 * constant-fold (see `server/auth-secret.ts`).
 */

export function readClosingSwitch(
	variable: string,
	environment: Record<string, string | undefined> = process.env,
): boolean {
	const configured = environment[variable];
	if (configured === undefined || configured === "" || configured === "false") {
		return false;
	}
	if (configured === "true") return true;
	throw new Error(
		`${variable} is set to ${JSON.stringify(configured)} — refusing to start. It accepts "true" (closed) or "false" (open), or leave it unset (open).`,
	);
}
