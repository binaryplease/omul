/**
 * The path of a SQLite file that sits beside the docstore unless its own
 * environment variable names another — the one rule `server/accounts.ts`
 * (`OMUL_AUTH_DB`) and `server/admin-events.ts` (`OMUL_ADMIN_DB`) share.
 *
 * `:memory:` is passed through rather than resolved, whether it comes from the
 * variable or from the docstore: `resolve(":memory:")` is `<cwd>/:memory:`, and
 * bun:sqlite would open a real file by that name (REQ187).
 */

import { dirname, join, resolve } from "node:path";
import { docstorePath } from "./store-path";

export function siblingDbPath(
	configured: string | undefined,
	filename: string,
): string {
	if (configured === ":memory:") return ":memory:";
	if (configured) return resolve(configured);
	const docstore = docstorePath();
	if (docstore === ":memory:") return ":memory:";
	return resolve(join(dirname(docstore), filename));
}
