/**
 * How this client stops, and what the shell around it reads off the exit code.
 *
 * Two of them, because a script driving omul has to tell two failures apart
 * without parsing English. `2` is "this invocation is wrong and would never
 * have worked" — an unknown command, a missing argument, a flag with no value.
 * `1` is "the invocation was fine and the attempt failed" — no credential, a
 * refusal from the server, a deck that is not there. Anything else escaping to
 * the top level is a defect in this client; it exits `1` with its raw message
 * rather than dressing itself up as either.
 *
 * **Neither carries a credential.** A message assembled here names what was
 * asked for and where a value came *from* — a path, a variable name, a header
 * name — never the value itself. The two secrets this client holds (the
 * personal API key and a deck's edit token) are exactly the strings a caller
 * pastes into a bug report along with the error that mentioned them, so the
 * rule is that an error never has one to mention.
 */

/** A wrong invocation — exit `2`, the shell's "usage" code. */
export class UsageError extends Error {
	readonly exitCode = 2;
}

/** A failed attempt — exit `1`. */
export class CliError extends Error {
	readonly exitCode = 1;
}

/** The exit code an error thrown anywhere in this client should produce. */
export function exitCodeFor(error: unknown): number {
	if (error instanceof UsageError) return error.exitCode;
	if (error instanceof CliError) return error.exitCode;
	return 1;
}
