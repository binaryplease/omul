/**
 * Where this instance's SQLite files live — one answer, read once, shared by
 * every module that opens one.
 *
 * Three modules open a database and all three derive their path from the same
 * `DATABASE_PATH`: `server/db.ts` (the zodstore file itself),
 * `server/accounts.ts` (Better Auth, an `auth.sqlite` sibling) and
 * `server/admin-events.ts` (an `admin.sqlite` sibling). Each used to spell the
 * default out for itself, which is three copies of one descriptor and
 * three places for a change to land in two of.
 *
 * This module depends on nothing but the environment, which is what
 * lets `db.ts` compose it at module load, before any store exists.
 */

import { join } from "node:path";

/** The docstore filename this application creates when nothing is there yet. */
export const DOCSTORE_FILENAME = "omul.sqlite";

/** The path used when the environment names none. */
export const DEFAULT_DOCSTORE_PATH = join("data", DOCSTORE_FILENAME);

/** The docstore path every module in this process opens or hangs a sibling off. */
export function docstorePath(): string {
	return process.env.DATABASE_PATH || DEFAULT_DOCSTORE_PATH;
}
