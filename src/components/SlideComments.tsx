import { MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
	canWriteDeckComments,
	type DeckAccessLevel,
	SLIDE_COMMENT_MAX_LENGTH,
	type SlideComment,
} from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";

// ── Comment threads on slides (REQ074) ────────────────────────────────
//
// The deck's authoring conversation, anchored to one slide at a time: what the
// accounts a deck is shared with say to each other about the slide in front of
// them. One reading of a thread, one composer, one place a comment is removed —
// worn by the editor's strip under the canvas, and available to any other
// surface that draws a single slide (the invariant is *the
// conversation on this slide*, not a list and a box that two surfaces could
// re-assemble into two different dialects of it).
//
// **Nothing here is a privacy boundary, and that matters more here than it does
// next door on the presenter's notes.** A comment reaches no client without an
// account holding standing on the deck — it is refused at the route, on its own
// collection, and no participant-facing payload carries one at all (see
// `server/schemas.ts`, `StoredSlideCommentSchema`). So this module is only ever
// handed comments its reader was already entitled to, and what it draws when
// they are not entitled is the server's own refusal, in words, in place of the
// thread.

/** What one comment's author is called, as every row here reads it. */
export function slideCommentAuthorLabel(comment: SlideComment): string {
	if (comment.mine) return "You";
	// A deleted account leaves its comments standing — a reply answering nothing
	// is worse than an unnamed line — so the missing name is said rather than
	// papered over with somebody else's.
	return comment.authorName?.trim() || "Deleted account";
}

/**
 * When a comment was written, in the reader's own locale — `""` for a row with
 * no stamp, which is what an older document re-parses forward onto
 * and which the row then simply does not draw.
 */
export function slideCommentTimeLabel(createdAt: string): string {
	if (!createdAt) return "";
	const written = new Date(createdAt);
	if (Number.isNaN(written.getTime())) return "";
	return written.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/**
 * The thread on one slide, out of the deck's whole conversation.
 *
 * The single read: the server hands back every comment on the deck in
 * one payload, because the surface consuming it draws one slide's thread *and* a
 * count on the rest, and two call sites splitting that list their own way is how
 * a badge comes to disagree with the panel under it.
 */
export function slideCommentsFor(
	comments: SlideComment[],
	slideId: string | null,
): SlideComment[] {
	if (!slideId) return [];
	return comments.filter((comment) => comment.slideId === slideId);
}

/**
 * Every half-written comment a composer is holding, by the slide it was typed
 * on.
 *
 * A draft belongs to the slide it is about, exactly as the posted comment it
 * becomes does. One loose string instead is how a line typed about slide 3
 * lands on slide 4's thread: the author pages on before pressing Comment, the
 * words stay, the slide under them changes, and nothing on screen says so.
 *
 * **Parked under its slide rather than discarded on the way out**, because the
 * two silent outcomes are not equally bad. Dropping the draft would trade one
 * wrong result for another — a stray click on the rail destroys a sentence
 * somebody was still writing, with no warning and no way back. Keying it loses
 * nothing: the words cannot follow their author anywhere, and they are put back
 * — with their own thread around them for context — the moment that slide is
 * selected again. It lives exactly as long as the composer does, so closing the
 * strip or the presenter's panel drops every draft with it, which is a
 * deliberate dismissal rather than a slip.
 */
export type SlideCommentDrafts = Readonly<Record<string, string>>;

/**
 * What the composer holds for the slide on screen — `""` for a slide nothing
 * has been typed about, and for the no-slide case the editor is in while its
 * deck-settings panel has the rail.
 */
export function slideCommentDraftFor(
	drafts: SlideCommentDrafts,
	slideId: string | null,
): string {
	if (!slideId) return "";
	return drafts[slideId] ?? "";
}

/**
 * The drafts after a keystroke on one slide — and, with `""`, after that
 * slide's comment has been posted.
 *
 * An emptied draft is dropped rather than parked, so what the map holds is only
 * ever what is actually half-written.
 */
export function withSlideCommentDraft(
	drafts: SlideCommentDrafts,
	slideId: string | null,
	body: string,
): SlideCommentDrafts {
	if (!slideId) return drafts;
	const next = { ...drafts };
	if (body === "") {
		delete next[slideId];
	} else {
		next[slideId] = body;
	}
	return next;
}

/**
 * What the closed strip says: how many comments this slide carries, or the
 * invitation that stands in the same place when it carries none (the
 * affordance does not disappear with its content).
 */
export function slideCommentStripLabel(count: number): string {
	if (count === 0) return "No comments on this slide yet";
	return count === 1 ? "1 comment" : `${count} comments`;
}

/**
 * Whether this reader may write on the thread, and — when they may not — the
 * one sentence saying why (the composer is disabled with its reason,
 * never dropped).
 *
 * A *report*, exactly like the `accessLevel` it reads: the route re-decides the
 * same question from the request's own credentials, so getting this wrong
 * mis-draws a box and nothing more. The `error` the load came back with wins
 * when there is one, because it is the server's own words about this very
 * caller — an editor open on a browser that holds the deck's edit link but no
 * account is told to sign in, which is the honest answer rather than a guess
 * made from a level that was never resolved.
 */
export function slideCommentComposerState({
	accessLevel,
	error,
}: {
	accessLevel: DeckAccessLevel | null | undefined;
	error: string | null;
}): { enabled: boolean; reason: string } {
	if (error) return { enabled: false, reason: error };
	if (canWriteDeckComments(accessLevel ?? null)) {
		return { enabled: true, reason: "" };
	}
	return {
		enabled: false,
		reason:
			"You can read this deck's comments. Ask its owner for comment access to write on them.",
	};
}

/**
 * The deck's conversation, loaded once and kept in step with what this browser
 * writes to it (REQ074).
 *
 * Deck-wide rather than per slide, for the reason the endpoint is: paging
 * through a deck must not be one request per slide. There is no socket behind
 * this and deliberately so — a comment is written between authoring sessions,
 * not into a running room, and the live surfaces the WebSocket feeds are exactly
 * the ones a comment must never reach.
 *
 * `load` is exposed so a surface can refresh on a gesture of its own; the state
 * is otherwise moved by the two writes, which patch it locally rather than
 * re-reading the deck — the server's answer to a write *is* the row it wrote.
 */
export function useSlideComments(presentationId: string | null): {
	comments: SlideComment[];
	loading: boolean;
	error: string | null;
	load: () => void;
	addComment: (slideId: string, body: string) => Promise<void>;
	removeComment: (commentId: string) => Promise<void>;
} {
	const [comments, setComments] = useState<SlideComment[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		if (!presentationId) {
			setComments([]);
			setError(null);
			return;
		}
		setLoading(true);
		api
			.listComments(presentationId)
			.then((loaded) => {
				setComments(loaded);
				setError(null);
			})
			.catch((loadError: Error) => {
				// The thread is emptied along with the reason: a list left on screen
				// under a refusal would be a thread this reader can no longer read.
				setComments([]);
				setError(loadError.message);
			})
			.finally(() => setLoading(false));
	}, [presentationId]);

	useEffect(load, [load]);

	const addComment = useCallback(
		async (slideId: string, body: string) => {
			if (!presentationId) return;
			const written = await api.addComment(presentationId, slideId, body);
			setComments((current) => [...current, written]);
		},
		[presentationId],
	);

	const removeComment = useCallback(
		async (commentId: string) => {
			if (!presentationId) return;
			await api.deleteComment(presentationId, commentId);
			setComments((current) =>
				current.filter((comment) => comment.id !== commentId),
			);
		},
		[presentationId],
	);

	return { comments, loading, error, load, addComment, removeComment };
}

/**
 * One slide's thread: what has been said, and the box the next line is written
 * in. The one rendering of a conversation about a slide, worn by every surface
 * that draws one.
 *
 * The delete is offered on the reader's **own** comments only, because taking
 * back what you said is part of writing while removing what somebody else said
 * is moderation — which this slice does not implement for anybody, the deck's
 * owner included. `mine` is the server's answer to that question, decided per
 * request from the credentials the request carried, and the route asks it again
 * of the stored row before removing anything.
 *
 * **A comment lands on the slide it was written about, and on no other.** Two
 * things hold that, and both are needed: the draft is held per slide
 * ({@link SlideCommentDrafts}), so the words cannot travel to the next slide in
 * the first place, and the post is *addressed* — `onSubmit` is handed the slide
 * id this panel is drawing rather than reading one out of a closure the caller
 * built, so a call site cannot re-introduce the same drift from outside.
 */
export function SlideCommentsPanel({
	comments,
	slideId,
	accessLevel,
	error,
	loading,
	onSubmit,
	onDelete,
}: {
	/** The deck's whole conversation; this panel draws one slide's share of it. */
	comments: SlideComment[];
	slideId: string | null;
	accessLevel: DeckAccessLevel | null | undefined;
	error: string | null;
	loading: boolean;
	/** Writes one body onto the slide it was written about, named explicitly. */
	onSubmit: (slideId: string, body: string) => Promise<void>;
	onDelete: (commentId: string) => Promise<void>;
}) {
	const [drafts, setDrafts] = useState<SlideCommentDrafts>({});
	const [busy, setBusy] = useState(false);
	const [writeError, setWriteError] = useState<{
		slideId: string | null;
		message: string;
	} | null>(null);
	const thread = slideCommentsFor(comments, slideId);
	const composer = slideCommentComposerState({ accessLevel, error });
	const draft = slideCommentDraftFor(drafts, slideId);
	// A refusal is about the write that drew it, so it is held against that
	// write's slide too: left standing under the next slide's composer it would
	// be the draft bug over again, in words rather than in somebody's sentence.
	const failure =
		writeError && writeError.slideId === slideId ? writeError.message : "";

	const submit = async () => {
		// The slide this body was typed on, read once here rather than after the
		// await: the post is addressed with it, and the draft cleared on the way
		// out is its own — however far the author has paged in the meantime.
		const target = slideId;
		const body = slideCommentDraftFor(drafts, target).trim();
		if (!target || !body || busy || !composer.enabled) return;
		setBusy(true);
		setWriteError(null);
		try {
			await onSubmit(target, body);
			setDrafts((current) => withSlideCommentDraft(current, target, ""));
		} catch (submitError) {
			setWriteError({
				slideId: target,
				message: (submitError as Error).message,
			});
		} finally {
			setBusy(false);
		}
	};

	const remove = async (commentId: string) => {
		setWriteError(null);
		try {
			await onDelete(commentId);
		} catch (deleteError) {
			setWriteError({ slideId, message: (deleteError as Error).message });
		}
	};

	return (
		<div className="space-y-3">
			{loading && thread.length === 0 && !error ? (
				<p className="text-xs text-text-dim">Loading comments…</p>
			) : null}
			{thread.length > 0 ? (
				<ul className="space-y-2">
					{thread.map((comment) => (
						<li
							key={comment.id}
							className="rounded-lg border border-border bg-surface/40 px-3 py-2"
						>
							<div className="flex items-baseline gap-2">
								<span className="min-w-0 truncate text-xs font-medium text-text">
									{slideCommentAuthorLabel(comment)}
								</span>
								<span className="flex-1 truncate text-xs text-text-dim">
									{slideCommentTimeLabel(comment.createdAt)}
								</span>
								{comment.mine && (
									<button
										type="button"
										className={`flex-shrink-0 ${ICON_BUTTON_HOVER}`}
										title="Delete this comment"
										aria-label="Delete this comment"
										onClick={() => remove(comment.id)}
									>
										<Trash2 size={13} />
									</button>
								)}
							</div>
							{/* Stored verbatim and rendered as text: the body is somebody's
							    words, never markup this surface resolves. */}
							<p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-muted">
								{comment.body}
							</p>
						</li>
					))}
				</ul>
			) : null}
			{!loading && thread.length === 0 && !error ? (
				<p className="text-xs text-text-dim">
					Nothing here yet. Comments stay between the accounts this deck is
					shared with — the room never sees them.
				</p>
			) : null}
			<div className="space-y-2">
				<textarea
					className="input"
					rows={2}
					maxLength={SLIDE_COMMENT_MAX_LENGTH}
					value={draft}
					disabled={!composer.enabled || !slideId}
					placeholder="Comment on this slide…"
					aria-label="Write a comment on this slide"
					onChange={(event) =>
						setDrafts((current) =>
							withSlideCommentDraft(current, slideId, event.target.value),
						)
					}
				/>
				<div className="flex items-center justify-between gap-3">
					{/* The control is present in every state and says why it is idle;
					    `reason` is the server's own words when the load came
					    back with one. */}
					<p className="min-w-0 text-xs text-text-dim">
						{failure || composer.reason}
					</p>
					<button
						type="button"
						className="btn-primary flex-shrink-0 text-xs"
						disabled={!composer.enabled || busy || draft.trim() === ""}
						onClick={submit}
					>
						{busy ? "Posting…" : "Comment"}
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * The slide's comments, written where the slide is (REQ074).
 *
 * A strip under the canvas, beside the presenter-notes one it deliberately
 * mirrors: a comment is made while looking at the slide it is about, so it
 * belongs with the slide rather than filed under a settings group two columns
 * away. Closed it is one line — how many comments this slide carries, or the
 * invitation that stands in the same place when it carries none. Open it is the
 * thread and its composer, in place, with nothing moved.
 *
 * The two states are the same affordance, which is why the count is on the
 * closed line: a thread nobody can see the size of is one nobody opens.
 *
 * The strip itself is not keyed on the slide and deliberately: paging the rail
 * with it open is how it is used, and collapsing it under the author on every
 * click would cost them the thread they were reading. What must not survive a
 * slide change is the *draft*, and the composer holds that per slide already.
 */
export function SlideCommentsStrip({
	comments,
	slideId,
	accessLevel,
	error,
	loading,
	onSubmit,
	onDelete,
}: {
	comments: SlideComment[];
	slideId: string | null;
	accessLevel: DeckAccessLevel | null | undefined;
	error: string | null;
	loading: boolean;
	onSubmit: (slideId: string, body: string) => Promise<void>;
	onDelete: (commentId: string) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const count = slideCommentsFor(comments, slideId).length;

	return (
		<div className="mx-auto w-full max-w-3xl space-y-2 rounded-xl border border-border bg-surface/40 px-3 py-2">
			<div className="flex items-center gap-2">
				<MessageSquare size={14} className="flex-shrink-0 text-text-muted" />
				<button
					type="button"
					aria-expanded={open}
					aria-label={
						open
							? "Hide comments on this slide"
							: "Show comments on this slide"
					}
					onClick={() => setOpen((wasOpen) => !wasOpen)}
					className="min-w-0 flex-1 truncate text-left text-sm text-text-muted transition-colors hover:text-text"
				>
					{open ? "Comments on this slide" : slideCommentStripLabel(count)}
				</button>
				<span className="flex-shrink-0 whitespace-nowrap text-xs text-text-muted">
					Only the accounts this deck is shared with
				</span>
			</div>
			{open && (
				<SlideCommentsPanel
					comments={comments}
					slideId={slideId}
					accessLevel={accessLevel}
					error={error}
					loading={loading}
					onSubmit={onSubmit}
					onDelete={onDelete}
				/>
			)}
		</div>
	);
}
