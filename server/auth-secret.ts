/**
 * The secret Better Auth signs sessions with, and the one switch that lets a
 * developer run without one (REQ171).
 *
 * This lives apart from `server/accounts.ts` because it depends on nothing that
 * module does — only on this process's environment. That separation
 * is load-bearing rather than tidy: it is what lets the test suite bundle this
 * file with `bun build` and *execute* the artifact, which is the only way to
 * prove the property below still holds.
 *
 * **The property.** The decision must be made at runtime, from a value someone
 * set on purpose for this environment, and must fail closed when that value is
 * absent.
 *
 * The first shipped attempt at this gate read `process.env.NODE_ENV`, and that
 * is exactly the trap an inferred environment mode sets. `bun build`
 * constant-folds the dotted
 * `process.env.NODE_ENV` form at bundle time, so the emitted bundle contains a
 * frozen string and never consults the environment again. Built with `NODE_ENV`
 * unset — which is what `bun run build` does, `package.json` not having set it —
 * the gate froze *open*: `dist/server/index.js` would then sign every session
 * cookie with the literal below no matter what the running server's `NODE_ENV`
 * said. A build tool got to decide a security posture, and its default was the
 * permissive one.
 *
 * So the switch is purpose-named, it is read here and nowhere else, and
 * `NODE_ENV` is not consulted for this decision at all. Two further things keep
 * it honest, because "this variable happens not to be folded by this Bun" is not
 * a guarantee anyone should rest a signing key on:
 *
 *  - **Nothing that builds ever sets it.** `mise run build`, `bun run build` and
 *    the `Dockerfile` all run without it, so even a future bundler that folded
 *    it would bake the *restrictive* value. It is set only by the dev tasks in
 *    `.mise.toml` and by `server/test-preload.ts`, neither of which builds.
 *  - **A test builds this file and runs it** (`server/auth-secret.test.ts`), so
 *    a bundler that started folding the flag fails the suite rather than
 *    shipping an instance whose sessions a stranger can forge.
 */

/**
 * The development signing secret.
 *
 * This MUST be overridden with a real secret in any
 * non-local environment — and it cannot fail to be, because
 * {@link resolveAuthSecret} refuses to reach it unless the switch below is
 * explicitly on.
 */
const DEV_INSECURE_SECRET = "omul-dev-insecure-secret-change-in-production";

/**
 * The tail every secret this server ships as a placeholder has carried, and the
 * form it refuses whatever the environment says.
 *
 * {@link DEV_INSECURE_SECRET} ends in it, and so did the spelling that shipped
 * under the product's earlier name. A placeholder that stops being refused the
 * moment it is renamed is a hole opened by a naming change: the value an
 * operator could have copied out of an older clone into their environment is
 * exactly the one this check exists to catch, and it is no less public for
 * having been superseded.
 *
 * Matched as a suffix rather than against a list of literals, so the rule holds
 * for the spellings that have already shipped and for any later one without a
 * second name to maintain — and so this module does not have to carry a retired
 * product name to refuse it (AGENTS.md). Nothing an operator generates the way
 * the crash message asks can end in these forty-one characters.
 */
const PLACEHOLDER_SECRET_SUFFIX = "-dev-insecure-secret-change-in-production";

/**
 * The one switch that permits {@link DEV_INSECURE_SECRET}.
 *
 * Exactly `"true"` turns it on, matching the repo's other operator switches
 * (`OMUL_RATE_LIMITS_DISABLED`, `SEND_EMAILS`,
 * `OMUL_GENERATION_ALLOW_ANONYMOUS`). Anything else — a typo, `"1"`, `"yes"`,
 * or the far more common case of nothing at all — is off, because the default
 * when unset or unparseable is the restrictive posture.
 */
const INSECURE_DEV_SECRET_SWITCH = "OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET";

/**
 * The shortest secret this server will sign with. Matches Better Auth's own
 * stated bar — it warns below 32 characters — and is comfortably under the 44
 * characters `openssl rand -base64 32` produces, so a value generated the way
 * the crash message asks always clears it.
 */
const MINIMUM_SECRET_LENGTH = 32;

/**
 * Whether this process was explicitly told it may use the development secret.
 *
 * Read off `process.env` under a bracket, never as a dotted literal, for the
 * reason the module header gives: a dotted read is the form a bundler is
 * entitled to fold, and this is the one variable whose folded value would be a
 * security posture decided at build time.
 */
function insecureDevSecretAllowed(): boolean {
	return process.env[INSECURE_DEV_SECRET_SWITCH] === "true";
}

/**
 * Whether a configured value is one of this application's own placeholders —
 * the one it ships today, or one it has shipped before (see
 * {@link PLACEHOLDER_SECRET_SUFFIX}).
 */
function isShippedPlaceholder(configured: string): boolean {
	return configured.endsWith(PLACEHOLDER_SECRET_SUFFIX);
}

/** The fatal-startup text, naming the variable, the fault and the remedy. */
function unusableAuthSecretMessage(fault: string): string {
	return [
		`BETTER_AUTH_SECRET ${fault} — refusing to start.`,
		"It signs every session cookie. Starting without it would sign them with a value that ships in this application's own source, so anyone who has read the source could mint a session for any account, administrators included.",
		"Generate one and put it in this process's environment:",
		"    BETTER_AUTH_SECRET=$(openssl rand -base64 32)",
		`For local development only, ${INSECURE_DEV_SECRET_SWITCH}="true" permits the built-in development secret instead. The dev tasks in .mise.toml and the test run set it for you; no build, container or deployment does.`,
	].join("\n");
}

/**
 * The secret Better Auth signs sessions with.
 *
 * Without the development switch this is configuration the operator must
 * supply, and its absence is a fatal startup error on the same pattern a
 * malformed `OMUL_BASE_HOST` already uses
 * (`server/routes/discovery.ts`) — read at boot, crashing loudly, rather than
 * degrading into a working-looking server whose every session cookie is
 * forgeable by a stranger holding a clone.
 *
 * Three ways to be refused, all the same crash:
 *
 *  - **Unset or blank.** The case this requirement exists for.
 *  - **A shipped literal, supplied as a configured value.** Copying it out of
 *    the source into the environment is the one way an operator could otherwise
 *    still sign a real deployment with the placeholder. Every spelling the
 *    placeholder has carried counts ({@link PLACEHOLDER_SECRET_SUFFIX}), not
 *    only the current one.
 *  - **Shorter than {@link MINIMUM_SECRET_LENGTH}.** A known secret and a
 *    guessable one end the same way; the crash advertises `openssl rand -base64
 *    32`, so it enforces something like it rather than accepting `x`.
 *
 * Throws rather than returning a sentinel, so no caller can carry on with an
 * unusable secret.
 */
export function resolveAuthSecret(): string {
	const configured = (process.env.BETTER_AUTH_SECRET ?? "").trim();

	// Development keeps working with nothing set, and still honours a real
	// secret when one is exported (so a developer can reproduce prod signing).
	if (insecureDevSecretAllowed()) {
		return configured || DEV_INSECURE_SECRET;
	}

	if (!configured) {
		throw new Error(unusableAuthSecretMessage("is not set"));
	}
	if (isShippedPlaceholder(configured)) {
		throw new Error(
			unusableAuthSecretMessage(
				"is set to a development placeholder that ships, or has shipped, in this application's source",
			),
		);
	}
	if (configured.length < MINIMUM_SECRET_LENGTH) {
		throw new Error(
			unusableAuthSecretMessage(
				`is ${configured.length} characters long, below the ${MINIMUM_SECRET_LENGTH}-character minimum`,
			),
		);
	}
	return configured;
}
