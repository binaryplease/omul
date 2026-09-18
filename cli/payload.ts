/**
 * Reading the fields this client actually uses out of a JSON response, and
 * saying so when they are not there.
 *
 * **Why this is hand-written rather than Zod.** Everywhere else in this
 * repository a shape that crosses a boundary is a Zod schema, and it should
 * stay that way; `cli/` is the one exception and it is bought, not free.
 * The executable has to build from the source tree alone, offline, with nothing
 * but Bun — that is what makes it installable through the flake without a
 * vendored `node_modules` and a lockfile hash to keep in step — so this
 * directory imports no package at all (`cli/protocol.ts` carries the same
 * note). The trade is only defensible because of what is being read: this
 * client consumes a handful of named fields off responses whose shape the
 * server already validated on the way out, and it never persists one. The
 * readers below are the whole of that reading, in one file, and each one names
 * the field and what was expected when it refuses.
 *
 * What is *written* — the config file and the edit-token store — is validated
 * in the module that owns it, on the way in, on the same terms.
 */

import { CliError } from "./errors";

/** A JSON object, or a stated refusal naming what was being read. */
export function asRecord(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CliError(`${what}: expected a JSON object from the server.`);
	}
	return value as Record<string, unknown>;
}

/** A JSON array, likewise. */
export function asArray(value: unknown, what: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new CliError(`${what}: expected a JSON array from the server.`);
	}
	return value;
}

/**
 * A string field, or `null` when it is absent or null. A field present as
 * something else is a refusal: it means this is not the response it claims.
 */
export function optionalString(
	record: Record<string, unknown>,
	field: string,
): string | null {
	const value = record[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new CliError(`Expected "${field}" to be a string.`);
	}
	return value;
}

/** A string field that has to be there — an id, a join code. */
export function requiredString(
	record: Record<string, unknown>,
	field: string,
	what: string,
): string {
	const value = optionalString(record, field);
	if (value === null) {
		throw new CliError(`${what}: the response carries no "${field}".`);
	}
	return value;
}

/** A number field, or `null` when absent. */
export function optionalNumber(
	record: Record<string, unknown>,
	field: string,
): number | null {
	const value = record[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== "number") {
		throw new CliError(`Expected "${field}" to be a number.`);
	}
	return value;
}

/** A boolean field, absent reading as `false`. */
export function optionalBoolean(
	record: Record<string, unknown>,
	field: string,
): boolean {
	const value = record[field];
	if (value === undefined || value === null) return false;
	if (typeof value !== "boolean") {
		throw new CliError(`Expected "${field}" to be a boolean.`);
	}
	return value;
}
