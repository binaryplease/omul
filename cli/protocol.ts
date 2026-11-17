/**
 * The wire vocabulary this client shares with the server, restated here.
 *
 * It is restated rather than imported, and that is the one deliberate
 * duplication in this directory. `cli/` imports **nothing outside itself** —
 * not `server/schemas.ts`, not a package from `node_modules` — so that the
 * flake can build the executable from the source tree alone, offline, with
 * nothing but Bun (see `flake.nix`). Importing the server's copy of this
 * constant would pull the whole schema module, and with it Zod, into a bundle
 * that has to build in a sandbox with no `node_modules` in it.
 *
 * The price of that is a value in two places, and the price is paid by
 * `cli/protocol.test.ts`: it imports the server's own constant and asserts the
 * two agree, so a rename on the server side is a failing test here rather than
 * a client that silently stops authorizing anything.
 */

/**
 * The dedicated header a per-presentation edit token rides in — the server's
 * `EDIT_TOKEN_HEADER` (`server/schemas.ts`). The token is also accepted in the
 * `Authorization: Bearer` slot, but that slot is a compatibility path the web
 * client has always used rather than the intended one, and the server assigns
 * no account meaning to `Authorization` at all.
 */
export const EDIT_TOKEN_HEADER = "x-omul-edit-token";

/**
 * Whether a slide's tally is a quiz question's result withheld from this
 * reader (REQ215) — the server's `quizResultWithheld` (`server/schemas.ts`),
 * restated for the reason above. While a quiz question is not over, a reader
 * who cannot edit the deck is sent how many answered and an explicit `null`
 * for every option's `count` and for the correctness half of `scoring`; a quiz
 * tally that is not withheld always carries `scoring.correctCount` as a
 * number, so that one field is the whole reading.
 */
export function quizResultWithheld(results: unknown): boolean {
	if (typeof results !== "object" || results === null) return false;
	const tally = results as { type?: unknown; scoring?: unknown };
	if (tally.type !== "quiz") return false;
	if (typeof tally.scoring !== "object" || tally.scoring === null) return false;
	return (tally.scoring as { correctCount?: unknown }).correctCount === null;
}
