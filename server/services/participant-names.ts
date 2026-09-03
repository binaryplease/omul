/**
 * The names participants state on joining a deck (REQ076).
 *
 * A module of its own for the reason `services/slide-comments.ts` beside it is
 * one: it owns its collection, its one-row-per-participant rule and
 * its normalisation, and it would keep working unchanged if the presentation
 * service were rewritten around it. The dependency runs one way — **nothing here
 * imports the presentation service** — so the presentation service is free to
 * import this one and sweep a deck's names without a cycle.
 *
 * Factory-free, like both its neighbours: functions over one module-level
 * collection, not a service instance somebody constructs.
 *
 * What this module deliberately does not decide:
 *
 *  - **Whether the deck asks for a name at all.** That is a fact about the deck
 *    (`requireParticipantName`), it is answered where the deck is fetched, and a
 *    second copy of the question here would be a second answer to drift from the
 *    first.
 *  - **Who may read the list.** Also a question about the caller's standing on
 *    the deck, also answered at the route layer. What this module enforces is
 *    the one rule that is about a *name* rather than about a deck: one
 *    participant holds one of them, and stating a second corrects the first.
 */

import { createStore } from "../db";
import { createKeyedLock } from "../keyed-lock";
import {
	normalizeParticipantName,
	StoredParticipantNameSchema,
} from "../schemas";

// Indexed on the two fields every read here filters by: the deck (the roster,
// and the sweep a reset or a delete runs) and the participant (the one row a
// join writes into).
const participantNames = createStore(
	"participantNames",
	StoredParticipantNameSchema,
	{ indexes: ["presentationId", "participantId"] },
);

/**
 * The queue the one read-modify-write in this module runs in — see
 * {@link setParticipantName}. Keyed by (deck, participant), which is the
 * narrowest key that still covers "one participant holds one row".
 */
const nameWriteLock = createKeyedLock();

/** One stored name, as every function here hands it back. */
export type ParticipantNameRecord = {
	presentationId: string;
	participantId: string;
	name: string;
	createdAt: string;
	updatedAt: string;
};

/** Project a stored row into the record shape, with every key present. */
function readName(row: Record<string, unknown>): ParticipantNameRecord {
	return {
		presentationId: row.presentationId as string,
		participantId: row.participantId as string,
		name: (row.name as string | undefined) ?? "",
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/**
 * Record what one participant is called on one deck, or correct what they are
 * already called.
 *
 * A read-modify-write, so it is serialised per (deck, participant) the way every
 * other one in this codebase is — two joins racing from the same reloaded phone
 * would otherwise both read "no row yet" and both insert, and the roster would
 * carry one person twice under one name. The key is the pair itself, which is
 * the narrowest one that covers the invariant: a whole room states its names in
 * the same ten seconds, and keying on the deck would queue all of them behind
 * each other to protect something that is per participant.
 *
 * The name is normalised here rather than at the boundary alone
 * ({@link normalizeParticipantName}), so a row written through any future caller
 * is a single trimmed line whatever it was handed.
 */
export async function setParticipantName(
	presentationId: string,
	participantId: string,
	name: string,
): Promise<ParticipantNameRecord | null> {
	const normalized = normalizeParticipantName(name);
	// A name of nothing is not a correction, it is an erasure by another route —
	// and this endpoint has none. Refused rather than stored blank, so the roster
	// never carries a row that says somebody was here and nothing else.
	if (!normalized) return null;

	return nameWriteLock.run(`${presentationId}:${participantId}`, async () => {
		const now = new Date().toISOString();
		const existing = await participantNames.find({
			presentationId,
			participantId,
		});
		if (existing.length > 0) {
			const updated = await participantNames.update(existing[0].id as string, {
				name: normalized,
				updatedAt: now,
			});
			// One row per pair by construction; collapse whatever a deck written
			// before this queue existed is still carrying, so a roster cannot list
			// one person twice.
			for (const extra of existing.slice(1)) {
				await participantNames.remove(extra.id as string);
			}
			return updated ? readName(updated) : null;
		}
		const inserted = await participantNames.insert({
			presentationId,
			participantId,
			name: normalized,
			createdAt: now,
			updatedAt: now,
		});
		return readName(inserted);
	});
}

/**
 * What one participant is called on one deck, or `null` when they have not said.
 *
 * `null` rather than `""`, because "this person never stated a name" and "this
 * person is called nothing" are different facts and only one of them can happen.
 */
export async function getParticipantName(
	presentationId: string,
	participantId: string,
): Promise<ParticipantNameRecord | null> {
	if (!participantId) return null;
	const rows = await participantNames.find({ presentationId, participantId });
	return rows.length > 0 ? readName(rows[0]) : null;
}

/**
 * Every name stated on one deck — the whole roster in one read.
 *
 * Deck-wide rather than per participant for the reason the comment threads are
 * read deck-wide: the surfaces that consume it (the organizer's roster, the two
 * exports) each want all of them at once, and a per-participant endpoint would
 * make an export one request per row.
 */
export async function listParticipantNames(
	presentationId: string,
): Promise<ParticipantNameRecord[]> {
	const rows = await participantNames.find({ presentationId });
	return rows.map(readName);
}

/**
 * The deck's names as a lookup, `participantId` → name.
 *
 * The shape both exports consume: they walk stored rows and ask "who cast this?"
 * once per row, which over a linear scan of the roster would be quadratic in a
 * long session.
 */
export async function participantNameLookup(
	presentationId: string,
): Promise<Record<string, string>> {
	const lookup: Record<string, string> = {};
	for (const record of await listParticipantNames(presentationId)) {
		lookup[record.participantId] = record.name;
	}
	return lookup;
}

/**
 * Drop every name stated on a deck. Returns how many were removed.
 *
 * Swept **inside** `eraseParticipantRecords` rather than beside it, which puts
 * it on both callers: a delete takes it because the deck it belongs to is going
 * away (REQ146), and a **reset** takes it because a re-run is a different room
 * (REQ101). That is the opposite of the comment threads next door, and the line
 * between them is who wrote the thing: the room stated these names, and the room
 * in front of you at the second run is not the room that stated them.
 */
export async function deleteDeckParticipantNames(
	presentationId: string,
): Promise<number> {
	return participantNames.deleteMany({ presentationId });
}
