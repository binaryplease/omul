/**
 * Deck sharing — who else has standing on a deck, and at what level (REQ075).
 *
 * A module of its own rather than a section of `services/presentations.ts`:
 * it owns its collection, its vocabulary and its failure set, and it
 * would keep working unchanged if the presentation service were rewritten around
 * it. The dependency runs one way on purpose — **nothing here imports the
 * presentation service**, so the presentation service is free to import this one
 * and ask a deck's access question without a cycle. Whether the caller is
 * allowed to *manage* grants is a question about the deck's owner, and it is
 * answered where the deck is fetched (the route layer), not here.
 *
 * Factory-free, like `services/presentations.ts` beside it: these are functions
 * over one module-level collection, not a service instance somebody constructs.
 *
 * What this module deliberately does not do: send anybody an email, invite an
 * address that has no account, or grant standing to a credential rather than an
 * account. A grant names a registered account, resolved by the route from the
 * email its owner typed, and it is the account that carries it — not a link, not
 * a token, and nothing a recipient could forward.
 */

import { createStore } from "../db";
import {
	DECK_ACCESS_LEVELS,
	type DeckAccessLevel,
	StoredDeckCollaboratorSchema,
} from "../schemas";

// Indexed on both ends of the grant, because both are read: a deck's own list
// filters on `presentationId`, and "which decks am I on?" filters on `userId`.
//
// The pair is **unique**, and that is a correctness constraint rather than a
// tuning one. "One row per (deck, account)" is this module's whole invariant —
// every read of a level, every demotion and every revoke names one row — and a
// check-then-insert cannot hold it: two shares of the same deck with the same
// account in flight together both see no row and both insert. The loser of that
// race then loses at the storage layer instead, where it can be caught and
// turned into the level change it was always going to be (see
// {@link grantDeckAccess}).
const collaborators = createStore(
	"deckCollaborators",
	StoredDeckCollaboratorSchema,
	{
		indexes: [
			"presentationId",
			"userId",
			{ fields: ["presentationId", "userId"], unique: true },
		],
	},
);

/** One stored grant, as every function here hands it back. */
export type DeckCollaboratorRecord = {
	id: string;
	presentationId: string;
	userId: string;
	level: DeckAccessLevel;
	invitedBy: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Project a stored row into the record shape, with every key present. */
function readGrant(row: Record<string, unknown>): DeckCollaboratorRecord {
	return {
		id: row.id as string,
		presentationId: row.presentationId as string,
		userId: row.userId as string,
		level: (row.level as DeckAccessLevel | undefined) ?? "view",
		invitedBy: (row.invitedBy as string | null) ?? null,
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/**
 * Every account this deck is shared with, oldest grant first — the order the
 * owner built the list in, which is the only order it has a reason to be in.
 */
export async function listDeckCollaborators(
	presentationId: string,
): Promise<DeckCollaboratorRecord[]> {
	const rows = await collaborators.find({ presentationId });
	return rows
		.map(readGrant)
		.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/**
 * Every deck shared with this account, newest grant first — the account's own
 * side of the same relation, and what `GET /api/presentations/shared` walks.
 */
export async function listGrantsForUser(
	userId: string,
): Promise<DeckCollaboratorRecord[]> {
	const rows = await collaborators.find({ userId });
	return rows
		.map(readGrant)
		.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/**
 * The **weakest** of the levels given, or `null` when there are none.
 *
 * Reached only where more than one grant somehow names the same pair, which the
 * unique index makes impossible going forward but which a row written before it
 * existed could still be. Weakest rather than strongest, and rather than
 * whichever row the store happened to return first, because those are the two
 * ways this fails *open*: the harm a duplicate does is that the owner demotes
 * the row they can see and the collaborator keeps the level on the row they
 * cannot. Reading the weakest means the demotion the owner performed is the one
 * that counts, and a grant they cannot see can only ever take access away.
 */
export function weakestDeckAccessLevel(
	levels: readonly DeckAccessLevel[],
): DeckAccessLevel | null {
	let weakest: DeckAccessLevel | null = null;
	for (const level of levels) {
		if (
			weakest === null ||
			DECK_ACCESS_LEVELS.indexOf(level) < DECK_ACCESS_LEVELS.indexOf(weakest)
		) {
			weakest = level;
		}
	}
	return weakest;
}

/**
 * This account's stated level on this deck, or `null` when it has no grant.
 *
 * The single read the authorization path makes, and the reason it
 * returns `null` rather than throwing on an unknown deck: "no grant" and "no
 * such deck" are the same answer to the only question being asked, and a caller
 * with no standing must not be able to tell them apart.
 */
export async function deckAccessLevelFor(
	presentationId: string,
	userId: string,
): Promise<DeckAccessLevel | null> {
	if (!presentationId || !userId) return null;
	const rows = await collaborators.find({ presentationId, userId });
	return weakestDeckAccessLevel(rows.map((row) => readGrant(row).level));
}

/**
 * Share a deck with an account at a level, or change the level of a grant that
 * already exists — one row per (deck, account) pair, so re-sharing is a change
 * rather than a second standing beside the first.
 *
 * Idempotent by construction, which is what makes "invite" a safe button to
 * press twice — and idempotent under a *race* too, which the read below cannot
 * give on its own. Two shares of the same pair in flight together both find no
 * row; the unique index is what makes the second insert fail rather than
 * succeed, and the failure is handled here as the level change the losing call
 * was always going to be if it had arrived a moment later.
 *
 * Reports which of the two happened so the route can answer `201` for a grant
 * that did not exist and `200` for one that did.
 */
export async function grantDeckAccess(
	presentationId: string,
	userId: string,
	level: DeckAccessLevel,
	invitedBy: string | null,
): Promise<{ created: boolean; grant: DeckCollaboratorRecord }> {
	const now = new Date().toISOString();
	const existing = (await collaborators.find({ presentationId, userId }))[0];
	if (existing) return changeGrantLevel(existing, level, now);
	try {
		const inserted = await collaborators.insert({
			presentationId,
			userId,
			level,
			invitedBy,
			createdAt: now,
			updatedAt: now,
		});
		return { created: true, grant: readGrant(inserted) };
	} catch (insertError) {
		// The lost race, and only the lost race: a refusal with no row behind it is
		// some other failure and is re-thrown rather than swallowed into a grant
		// this function did not make.
		const raced = (await collaborators.find({ presentationId, userId }))[0];
		if (!raced) throw insertError;
		return changeGrantLevel(raced, level, now);
	}
}

/**
 * Move an existing grant to `level`. A row that vanished between being read and
 * being written is a **throw**, not a fallback: reporting the old level as
 * though the change had applied would tell an owner they demoted somebody who
 * still holds what they had (fail loudly rather than quietly wrong).
 */
async function changeGrantLevel(
	existing: Record<string, unknown>,
	level: DeckAccessLevel,
	updatedAt: string,
): Promise<{ created: false; grant: DeckCollaboratorRecord }> {
	const id = existing.id as string;
	const updated = await collaborators.update(id, { level, updatedAt });
	if (!updated) {
		throw new Error(`grantDeckAccess: grant ${id} disappeared mid-change`);
	}
	return { created: false, grant: readGrant(updated) };
}

/**
 * Change one grant's level, named by the grant's own id.
 *
 * Scoped to the deck as well as to the id: a grant id that belongs to another
 * deck is `null` here rather than a cross-deck write, so a deck's owner can only
 * ever move a level on their own deck even if they learn an id from elsewhere.
 */
export async function setCollaboratorLevel(
	presentationId: string,
	collaboratorId: string,
	level: DeckAccessLevel,
): Promise<DeckCollaboratorRecord | null> {
	const existing = await collaborators.findOne(collaboratorId);
	if (!existing || existing.presentationId !== presentationId) return null;
	const updated = await collaborators.update(collaboratorId, {
		level,
		updatedAt: new Date().toISOString(),
	});
	return updated ? readGrant(updated) : null;
}

/**
 * Revoke one grant, named by its own id and scoped to its deck for the reason
 * {@link setCollaboratorLevel} is. Immediate: the standing is the row, so
 * removing it is the whole of the revoke — there is nothing cached, nothing
 * issued and nothing to expire. Reports whether there was a grant to remove.
 */
export async function revokeCollaborator(
	presentationId: string,
	collaboratorId: string,
): Promise<boolean> {
	const existing = await collaborators.findOne(collaboratorId);
	if (!existing || existing.presentationId !== presentationId) return false;
	return collaborators.remove(collaboratorId);
}

/**
 * Drop every grant on a deck — what a deck's deletion leaves behind otherwise.
 *
 * A grant outliving its deck is a row naming an account that no route can reach
 * and no screen can show, exactly the way REQ146 reasons about the rows a room
 * writes. Returns how many were removed.
 */
export async function revokeAllDeckAccess(
	presentationId: string,
): Promise<number> {
	return collaborators.deleteMany({ presentationId });
}
