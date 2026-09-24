/**
 * The command line itself — the boundary a terminal crosses into this program,
 * and the one place a malformed invocation is refused.
 *
 * Deliberately small: positional words and `--flag` options, nothing else. No
 * single-letter aliases, no flag clustering, no implicit type coercion. What a
 * caller typed is what the commands read, and a word this parser does not
 * understand is an error rather than something quietly ignored — a flag typo
 * that silently does nothing is how a caller ends up believing a deck was
 * created with a title it never got.
 *
 * **No flag in this client ever carries a secret**, and that is a property of
 * the surface rather than of the parser: argv is world-readable on a running
 * process and lands verbatim in shell history, so the personal API key and a
 * deck's edit token are read from a file, an environment variable or a prompt
 * (`cli/config.ts`, `cli/secret-input.ts`) and there is no `--api-key` to type.
 */

import { UsageError } from "./errors";

/** A parsed command line: the words, then the options. */
export interface ParsedArguments {
	/** Positional words in the order they were typed — `["results", "<id>"]`. */
	words: string[];
	/** `--flag value` / `--flag=value` as strings, bare `--flag` as `true`. */
	flags: Record<string, string | true>;
}

/**
 * Parse an argv tail (everything after the program name).
 *
 * A value that begins with `--` has to be written `--flag=value`: the bare
 * `--flag value` form stops at the next flag rather than swallowing it, so a
 * forgotten value reads as a boolean flag and is caught by {@link flagValue}
 * instead of eating the option behind it.
 *
 * A flag given twice is refused rather than resolved last-wins — two values for
 * one option is a caller who did not decide, and picking one of them silently
 * is how the other one goes missing without a word.
 */
export function parseArguments(argv: readonly string[]): ParsedArguments {
	const words: string[] = [];
	const flags: Record<string, string | true> = {};

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index] as string;
		if (!argument.startsWith("--")) {
			words.push(argument);
			continue;
		}
		const body = argument.slice(2);
		if (body === "") {
			throw new UsageError('"--" on its own is not an option.');
		}
		const equals = body.indexOf("=");
		const name = equals === -1 ? body : body.slice(0, equals);
		if (name in flags) {
			throw new UsageError(`--${name} was given twice.`);
		}
		if (equals !== -1) {
			flags[name] = body.slice(equals + 1);
			continue;
		}
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags[name] = next;
			index++;
			continue;
		}
		flags[name] = true;
	}

	return { words, flags };
}

/**
 * Refuse any flag this command does not know, naming it and listing what it
 * does take. The alternative — ignoring it — is the failure mode this whole
 * module exists to prevent.
 */
export function requireKnownFlags(
	parsed: ParsedArguments,
	allowed: readonly string[],
	command: string,
): void {
	for (const name of Object.keys(parsed.flags)) {
		if (allowed.includes(name)) continue;
		const known = allowed.map((flag) => `--${flag}`).join(", ");
		throw new UsageError(
			`\`omul ${command}\` does not take --${name}. It takes: ${known}.`,
		);
	}
}

/**
 * The string value of a flag, or `null` when it was not given. A flag written
 * without a value is a mistake rather than an empty string: `--title` with
 * nothing after it means the title went missing, not that the deck is called
 * "".
 */
export function flagValue(
	parsed: ParsedArguments,
	name: string,
): string | null {
	const value = parsed.flags[name];
	if (value === undefined) return null;
	if (value === true) {
		throw new UsageError(`--${name} needs a value (--${name}=<value>).`);
	}
	return value;
}

/** Whether a bare boolean flag such as `--json` was given. */
export function flagPresent(parsed: ParsedArguments, name: string): boolean {
	const value = parsed.flags[name];
	if (value === undefined) return false;
	if (value === true) return true;
	throw new UsageError(`--${name} takes no value.`);
}

/**
 * The one positional argument a command requires, named in the error when it
 * is missing so the caller is told what to type rather than that something was
 * absent.
 */
export function requiredWord(
	parsed: ParsedArguments,
	index: number,
	command: string,
	placeholder: string,
): string {
	const word = parsed.words[index];
	if (word === undefined || word === "") {
		throw new UsageError(`\`omul ${command}\` needs ${placeholder}.`);
	}
	return word;
}
