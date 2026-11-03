/**
 * Which account each participant id belongs to on a deck that requires signing
 * in (REQ134).
 *
 * A module of its own for the reason `services/participant-names.ts` beside it
 * is one: it owns its collection and its one rule — a participant id, once used
 * on a deck by an account, stays that account's — and it would keep working
 * unchanged if the presentation service were rewritten around it. Nothing here
 * imports the presentation service or the auth layer: whether the deck asks for
 * a sign-in, and which account a request resolves to, are answered by the caller
 * and handed in.
 *
 * The binding is stored for attribution only. Nothing here reads it back to a
 * caller, so there is no projection for a public read site to forget.
 */

import { createStore } from "../db";
import { createKeyedLock } from "../keyed-lock";
import { StoredParticipantAccountSchema } from "../schemas";

// Indexed on the two fields every read here filters by: the deck (the sweep a
// reset or a delete runs) and the participant (the one row a write checks).
const participantAccounts = createStore(
	"participantAccounts",
	StoredParticipantAccountSchema,
	{ indexes: ["presentationId", "participantId"] },
);

/**
 * The queue the one read-then-insert here runs in, keyed by (deck, participant):
 * two first writes racing under one id from two accounts must not both read "no
 * binding yet" and both insert.
 */
const bindingLock = createKeyedLock();

/**
 * Bind a participant id on one deck to the account writing under it, or confirm
 * it is already bound to that account.
 *
 * `"bound"` when the id is now — or already was — this account's; `"mismatch"`
 * when another account used it first, which the caller refuses rather than
 * rebinding: rebinding would hand every answer already given under the id to
 * whoever wrote last. Idempotent for the same account, so a retried write
 * changes nothing.
 */
export async function bindParticipantAccount(
	presentationId: string,
	participantId: string,
	userId: string,
): Promise<"bound" | "mismatch"> {
	return bindingLock.run(`${presentationId}:${participantId}`, async () => {
		const existing = await participantAccounts.find({
			presentationId,
			participantId,
		});
		if (existing.length > 0) {
			return existing[0].userId === userId ? "bound" : "mismatch";
		}
		await participantAccounts.insert({
			presentationId,
			participantId,
			userId,
			createdAt: new Date().toISOString(),
		});
		return "bound";
	});
}

/**
 * Drop every binding on a deck. Returns how many were removed.
 *
 * Swept inside `eraseParticipantRecords`, so both a delete (REQ146) and a reset
 * (REQ101) take it: once the room's answers are gone a binding attributes
 * nothing, and the room at a re-run is not the room that was bound.
 */
export async function deleteDeckParticipantAccounts(
	presentationId: string,
): Promise<number> {
	return participantAccounts.deleteMany({ presentationId });
}
