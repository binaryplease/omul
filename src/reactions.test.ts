/**
 * Unit tests for the live reaction stream (REQ077) — the pure rules the store
 * reduces through and the overlay draws from, with no React and no socket.
 *
 * What they are protecting: a reaction is transient by construction, so the
 * things that could go wrong are all about the queue — one that never emptied
 * would leave a frozen heart on a projector, one that grew without bound would
 * put five hundred animating elements on the machine driving it, and one that
 * accepted whatever arrived would draw an unknown reaction as somebody else's.
 */

import { describe, expect, test } from "bun:test";
import {
	addReaction,
	isReactionKind,
	type LiveReaction,
	pruneReactions,
	REACTION_LIFETIME_MS,
	REACTION_STREAM_LIMIT,
	readReaction,
} from "./reactions";

function reaction(id: string, at: number): LiveReaction {
	return { id, kind: "like", at };
}

describe("isReactionKind", () => {
	test("accepts the five the schema declares and nothing else", () => {
		for (const kind of ["like", "love", "celebrate", "laugh", "insight"]) {
			expect(isReactionKind(kind)).toBe(true);
		}
		expect(isReactionKind("shrug")).toBe(false);
		expect(isReactionKind("")).toBe(false);
		expect(isReactionKind(null)).toBe(false);
		expect(isReactionKind(7)).toBe(false);
	});
});

describe("readReaction", () => {
	test("reads a frame with its local arrival time, not the server's", () => {
		// The server's `at` says when the reaction happened; the animation needs to
		// know how long it has been on *this* screen, so a device with a skewed
		// clock still draws it.
		const parsed = readReaction(
			{ id: "r1", kind: "love", at: "1999-01-01T00:00:00.000Z" },
			5_000,
		);
		expect(parsed).toEqual({ id: "r1", kind: "love", at: 5_000 });
	});

	test("drops a kind this build has no icon for rather than substituting one", () => {
		expect(readReaction({ id: "r1", kind: "shrug" }, 0)).toBeNull();
	});

	test("drops a frame with no id — one tap has to be one keyable icon", () => {
		expect(readReaction({ kind: "like" }, 0)).toBeNull();
		expect(readReaction({ id: "", kind: "like" }, 0)).toBeNull();
	});

	test("drops anything that is not a frame at all", () => {
		expect(readReaction(null, 0)).toBeNull();
		expect(readReaction("reaction.sent", 0)).toBeNull();
		expect(readReaction(undefined, 0)).toBeNull();
	});
});

describe("pruneReactions", () => {
	test("keeps what is still young enough to be on screen", () => {
		const stream = [reaction("old", 0), reaction("new", 3_000)];
		expect(
			pruneReactions(stream, REACTION_LIFETIME_MS).map((entry) => entry.id),
		).toEqual(["new"]);
	});

	test("a reaction exactly at its lifetime is over", () => {
		expect(pruneReactions([reaction("a", 0)], REACTION_LIFETIME_MS)).toEqual([]);
		expect(
			pruneReactions([reaction("a", 0)], REACTION_LIFETIME_MS - 1),
		).toHaveLength(1);
	});

	test("an empty stream stays empty", () => {
		expect(pruneReactions([], 10_000)).toEqual([]);
	});
});

describe("addReaction", () => {
	test("appends, keeping the order they arrived in", () => {
		const first = addReaction([], reaction("a", 100), 100);
		const second = addReaction(first, reaction("b", 200), 200);
		expect(second.map((entry) => entry.id)).toEqual(["a", "b"]);
	});

	test("expired reactions go on the way in", () => {
		const stale = [reaction("old", 0)];
		const next = addReaction(
			stale,
			reaction("new", REACTION_LIFETIME_MS + 1),
			REACTION_LIFETIME_MS + 1,
		);
		expect(next.map((entry) => entry.id)).toEqual(["new"]);
	});

	test("the same frame arriving twice stays one icon", () => {
		// A socket can reconnect mid-burst and replay, and one tap is one reaction.
		const once = addReaction([], reaction("a", 100), 100);
		expect(addReaction(once, reaction("a", 150), 150)).toBe(once);
	});

	test("a flood is capped, and it is the newest that survive", () => {
		let stream: LiveReaction[] = [];
		for (let index = 0; index < REACTION_STREAM_LIMIT + 10; index++) {
			stream = addReaction(stream, reaction(`r${index}`, 1_000), 1_000);
		}
		expect(stream).toHaveLength(REACTION_STREAM_LIMIT);
		expect(stream[stream.length - 1].id).toBe(
			`r${REACTION_STREAM_LIMIT + 9}`,
		);
		// An overflowing burst already reads as "lots", so what is dropped is the
		// part nobody could have told apart.
		expect(stream[0].id).toBe("r10");
	});

	test("the input array is not mutated", () => {
		const stream = [reaction("a", 100)];
		addReaction(stream, reaction("b", 200), 200);
		expect(stream).toHaveLength(1);
	});
});
