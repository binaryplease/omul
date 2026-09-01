// ── The live reaction stream (REQ077) ─────────────────────────────────
//
// What a room's reactions are while they are on screen, and nothing else: a
// short bounded queue of things that arrived over the socket and will be gone
// again in a few seconds.
//
// It lives at the root rather than inside the session slice or inside
// `ReactionBar.tsx` because it belongs to neither and both compose it
// (ADR-0032): the store reduces `reaction.sent` frames through `addReaction`,
// the renderer draws whatever `pruneReactions` still says is alive, and this
// module depends on the DOM as little as it depends on zustand — which is to
// say not at all, which is what makes the rules below testable as arithmetic.
//
// **Nothing here persists.** A reaction is never stored on the server (see the
// participant-channels section of `server/schemas.ts`), and it is not stored
// here either: the queue is capped, self-expiring, and cleared with the session.
// A reaction that has aged out has not been archived anywhere — it is gone.

import type { ReactionKind } from "./types";
import { REACTION_KINDS } from "./types";

/** One reaction on its way across the screen. */
export type LiveReaction = {
	/** The server's id for this send — one flying icon per reaction, keyed by it. */
	id: string;
	kind: ReactionKind;
	/**
	 * When this browser received it, in local milliseconds — deliberately *not*
	 * the server's instant from the frame.
	 *
	 * The server's `at` says when the reaction happened, which is the right thing
	 * to reason with and the wrong thing to animate against: a device whose clock
	 * is two minutes fast would compute every arriving reaction as already
	 * expired and draw nothing at all. What the animation needs is "how long has
	 * this been on *my* screen", and that is a local measurement.
	 */
	at: number;
};

/**
 * How long one reaction stays on screen, in milliseconds.
 *
 * Long enough to be seen crossing a projected slide from the back of a room,
 * short enough that a burst clears before the presenter moves on. It is also the
 * expiry the queue prunes against, so the animation and the state agree by
 * construction rather than by two numbers that have to be kept in step.
 */
export const REACTION_LIFETIME_MS = 4000;

/**
 * The most reactions drawn at once.
 *
 * A ceiling on the *rendering*, not on the room: a hall of five hundred people
 * all tapping at once is a success, and the failure it would otherwise cause is
 * five hundred simultaneously animating elements on the machine driving the
 * projector. Past this the newest win — an overflowing burst already reads as
 * "lots", so what is dropped is the part nobody could distinguish anyway.
 */
export const REACTION_STREAM_LIMIT = 24;

/** Whether a value is one of the reactions this build knows (REQ077). */
export function isReactionKind(value: unknown): value is ReactionKind {
	return (
		typeof value === "string" &&
		(REACTION_KINDS as readonly string[]).includes(value)
	);
}

/**
 * Read a `reaction.sent` frame off the socket, or `null` when it is not one.
 *
 * The single read site, so no surface reaches for `??` around a kind. A frame
 * naming a reaction this build does not know is **dropped rather than
 * substituted**: a newer server sending a sixth kind means this client has no
 * icon for it, and drawing somebody's applause as a heart would be a worse
 * answer than drawing nothing.
 */
export function readReaction(
	payload: unknown,
	receivedAtMs: number,
): LiveReaction | null {
	if (!payload || typeof payload !== "object") return null;
	const frame = payload as { id?: unknown; kind?: unknown };
	if (!isReactionKind(frame.kind)) return null;
	const id = typeof frame.id === "string" && frame.id ? frame.id : "";
	if (!id) return null;
	return { id, kind: frame.kind, at: receivedAtMs };
}

/** The reactions still young enough to be on screen at `nowMs`. */
export function pruneReactions(
	stream: LiveReaction[],
	nowMs: number,
): LiveReaction[] {
	return stream.filter(
		(reaction) => nowMs - reaction.at < REACTION_LIFETIME_MS,
	);
}

/**
 * The stream with one more reaction in it: expired ones dropped, the newcomer
 * appended, and the oldest discarded if that puts it over the cap.
 *
 * Pruning on insert rather than on a timer is what keeps this module free of
 * scheduling: the queue is only ever wrong between two arrivals, and the
 * renderer prunes again as it draws.
 *
 * A reaction whose id is already in the stream is ignored. A room is broadcast
 * to by presentation and a socket can reconnect mid-burst, so the same frame can
 * arrive twice — and one tap has to stay one icon.
 */
export function addReaction(
	stream: LiveReaction[],
	reaction: LiveReaction,
	nowMs: number,
): LiveReaction[] {
	if (stream.some((existing) => existing.id === reaction.id)) return stream;
	const alive = pruneReactions(stream, nowMs);
	const next = [...alive, reaction];
	return next.length > REACTION_STREAM_LIMIT
		? next.slice(next.length - REACTION_STREAM_LIMIT)
		: next;
}
