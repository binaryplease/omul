/**
 * Comment threads anchored to a deck's slides (REQ074).
 *
 * A module of its own for the reason `services/collaborators.ts` beside it is
 * one (ADR-0032): it owns its collection, its ordering and its failure set, and
 * it would keep working unchanged if the presentation service were rewritten
 * around it. The dependency runs one way — **nothing here imports the
 * presentation service** — so the presentation service is free to import this one
 * and sweep a deleted deck's threads without a cycle.
 *
 * Factory-free, like both its neighbours: these are functions over one
 * module-level collection, not a service instance somebody constructs.
 *
 * What this module deliberately does not decide: **who** may read or write a
 * thread. That is a question about the caller's standing on the deck, it is
 * answered where the deck is fetched (the route layer) through
 * `canReadDeckComments` / `canWriteDeckComments`, and a second copy of it here
 * would be a second answer to drift from the first. What this module *does*
 * enforce is the one rule that is about a comment rather than about a deck: only
 * the account that wrote one can remove it (see {@link deleteSlideComment}).
 */

import { createStore } from "../db";
import { StoredSlideCommentSchema } from "../schemas";

// Indexed on the deck, which is the only filter any read here uses: a thread is
// always fetched as part of its deck's whole conversation (one request per
// editor session, not one per slide), and `authorId` is compared against a row
// already in hand rather than searched for.
const comments = createStore("slideComments", StoredSlideCommentSchema, {
	indexes: ["presentationId", "slideId"],
});

/** One stored comment, as every function here hands it back. */
export type SlideCommentRecord = {
	id: string;
	presentationId: string;
	slideId: string;
	authorId: string;
	body: string;
	createdAt: string;
};

/** Project a stored row into the record shape, with every key present. */
function readComment(row: Record<string, unknown>): SlideCommentRecord {
	return {
		id: row.id as string,
		presentationId: row.presentationId as string,
		slideId: row.slideId as string,
		authorId: row.authorId as string,
		body: (row.body as string | undefined) ?? "",
		createdAt: (row.createdAt as string | undefined) ?? "",
	};
}

/**
 * Every comment on a deck, oldest first — the whole conversation in one read.
 *
 * Deck-wide rather than per-slide because that is the shape the screen consuming
 * it needs: an editor draws the thread for the slide in front of the author *and*
 * a count on every other slide in the rail, and a per-slide endpoint would make
 * the second of those one request per slide in the deck.
 *
 * Oldest first, and that is the only order a conversation has: a thread read
 * newest-first is a reply above the thing it replies to.
 */
export async function listDeckComments(
	presentationId: string,
): Promise<SlideCommentRecord[]> {
	const rows = await comments.find({ presentationId });
	return rows
		.map(readComment)
		.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/**
 * Write one comment onto one slide. The body is stored **verbatim** — trimmed
 * and length-bounded at the boundary (`PostSlideCommentSchema`) and otherwise
 * untouched, the same stance authored slide text takes (REQ088): nothing here
 * escapes, resolves or rewrites what somebody typed, because nothing downstream
 * turns it into HTML.
 */
export async function addSlideComment(
	presentationId: string,
	slideId: string,
	authorId: string,
	body: string,
): Promise<SlideCommentRecord> {
	const inserted = await comments.insert({
		presentationId,
		slideId,
		authorId,
		body,
		createdAt: new Date().toISOString(),
	});
	return readComment(inserted);
}

/**
 * Remove one comment — **only** the one its own author wrote.
 *
 * Scoped to the deck as well as to the id, for the reason `setCollaboratorLevel`
 * is: a comment id belonging to another deck is a `false` here rather than a
 * cross-deck delete, so an id learned elsewhere reaches nothing.
 *
 * Author-scoped rather than owner-scoped, and the two are different powers:
 * taking back what you said is part of writing, while removing what somebody
 * else said is moderation — a decision about a conversation the deck's owner
 * would need a workflow for (whose comment, on what grounds, and what the author
 * is told), and none of that is what REQ074 asks for. Reports whether there was
 * a comment this account could remove; a comment that exists but belongs to
 * another account and one that does not exist are the same answer, so nobody can
 * probe for the second through the first.
 */
export async function deleteSlideComment(
	presentationId: string,
	commentId: string,
	authorId: string,
): Promise<boolean> {
	const existing = await comments.findOne(commentId);
	if (!existing) return false;
	if (existing.presentationId !== presentationId) return false;
	if (existing.authorId !== authorId) return false;
	return comments.remove(commentId);
}

/**
 * Drop every comment on a deck — what a deck's deletion leaves behind otherwise.
 *
 * The same reasoning the grants are swept under (REQ146): once the deck a thread
 * is anchored to is gone, no route resolves it, no screen draws it and no control
 * reaches it — and unlike a grant it is *text people wrote*, which is the last
 * thing that should outlive the thing it was about. Swept beside the grants
 * rather than inside `eraseParticipantRecords`, because a **reset** must not
 * touch it: re-running a session clears the room's answers, and the deck's
 * authors did not say any of this to the room. Returns how many were removed.
 */
export async function deleteDeckComments(
	presentationId: string,
): Promise<number> {
	return comments.deleteMany({ presentationId });
}
