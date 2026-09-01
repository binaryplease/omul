/**
 * Unit tests for the leaderboard rules in server/schemas.ts (REQ059).
 *
 * The board's ordering is the whole requirement — "the scores of the top
 * participants", visible across several questions — so it is tested here in
 * isolation from the store and the HTTP surface:
 *   - the order, and what happens to two people who scored the same
 *   - how many places a slide shows, and what a deck outside those bounds means
 *   - what a row is called, given that nobody is asked for a name
 */

import { describe, expect, test } from "bun:test";
import {
	isInteractiveSlideType,
	LEADERBOARD_DEFAULT_SIZE,
	LEADERBOARD_SIZE_LIMIT,
	leaderboardEntryLabel,
	leaderboardSizeFor,
	rankLeaderboardEntries,
	SlideSchema,
	slideHasResults,
} from "./schemas";

/** One participant's deck total, named by the handle the server would derive. */
function totals(entryId: string, totalPoints: number, correctCount = 0) {
	return { entryId, totalPoints, correctCount, answeredCount: 2 };
}

describe("rankLeaderboardEntries (REQ059)", () => {
	test("orders by points, highest first", () => {
		const ranked = rankLeaderboardEntries([
			totals("bbbb", 400),
			totals("aaaa", 1800),
			totals("cccc", 900),
		]);
		expect(ranked.map((entry) => entry.entryId)).toEqual([
			"aaaa",
			"cccc",
			"bbbb",
		]);
		expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
	});

	test("level scores share a place, and the next takes the one its position implies", () => {
		// Standard competition ranking: 1, 2, 2, 4. Two people who scored the same
		// thing are equal — the board must not invent a winner between them.
		const ranked = rankLeaderboardEntries([
			totals("aaaa", 1800),
			totals("bbbb", 900),
			totals("cccc", 900),
			totals("dddd", 100),
		]);
		expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
	});

	test("everyone level is level, however many of them there are", () => {
		const ranked = rankLeaderboardEntries([
			totals("aaaa", 500),
			totals("bbbb", 500),
			totals("cccc", 500),
		]);
		expect(ranked.map((entry) => entry.rank)).toEqual([1, 1, 1]);
	});

	test("a tie is drawn the same way every time it is drawn", () => {
		// The board is re-rendered every few seconds on a screen the whole room is
		// watching, so equal rows have to keep their order between renders — a
		// board that reshuffled level scores would look like a race that is moving
		// when nothing has happened.
		const first = rankLeaderboardEntries([
			totals("cccc", 900),
			totals("aaaa", 900),
			totals("bbbb", 900),
		]);
		const again = rankLeaderboardEntries([
			totals("bbbb", 900),
			totals("cccc", 900),
			totals("aaaa", 900),
		]);
		expect(first.map((entry) => entry.entryId)).toEqual(
			again.map((entry) => entry.entryId),
		);
	});

	test("a participant who answered and scored nothing is still ranked", () => {
		// A competition that dropped everyone who guessed wrong would report a
		// smaller, luckier room than the one that played.
		const ranked = rankLeaderboardEntries([
			totals("aaaa", 900, 1),
			totals("bbbb", 0, 0),
		]);
		expect(ranked).toHaveLength(2);
		expect(ranked[1]).toMatchObject({ entryId: "bbbb", rank: 2, totalPoints: 0 });
	});

	test("carries each row's tallies through untouched", () => {
		const ranked = rankLeaderboardEntries([
			{ entryId: "aaaa", totalPoints: 1700, correctCount: 2, answeredCount: 3 },
		]);
		expect(ranked[0]).toEqual({
			entryId: "aaaa",
			totalPoints: 1700,
			correctCount: 2,
			answeredCount: 3,
			rank: 1,
			label: leaderboardEntryLabel("aaaa"),
		});
	});

	test("an empty room is an empty board, not an error", () => {
		expect(rankLeaderboardEntries([])).toEqual([]);
	});

	test("leaves the caller's array alone", () => {
		const given = [totals("bbbb", 100), totals("aaaa", 900)];
		rankLeaderboardEntries(given);
		expect(given.map((entry) => entry.entryId)).toEqual(["bbbb", "aaaa"]);
	});
});

describe("leaderboardEntryLabel (REQ059)", () => {
	test("names a row from its own handle, and only from that", () => {
		expect(leaderboardEntryLabel("3f9a2c7b1d4e6f08")).toBe("Player 3F9A2C");
	});

	test("the same handle is always the same name", () => {
		expect(leaderboardEntryLabel("abcdef123456")).toBe(
			leaderboardEntryLabel("abcdef123456"),
		);
	});

	test("different handles are different names", () => {
		expect(leaderboardEntryLabel("abcdef123456")).not.toBe(
			leaderboardEntryLabel("abcdee123456"),
		);
	});

	test("a handle that never arrived still reads as a row, not as a blank", () => {
		expect(leaderboardEntryLabel("")).toBe("Player");
	});
});

describe("leaderboardSizeFor (REQ059)", () => {
	test("reads the authored number of places", () => {
		expect(leaderboardSizeFor({ leaderboardSize: 8 })).toBe(8);
	});

	test("a slide that never carried one shows the default top five", () => {
		expect(leaderboardSizeFor({})).toBe(LEADERBOARD_DEFAULT_SIZE);
		expect(leaderboardSizeFor({ leaderboardSize: undefined })).toBe(
			LEADERBOARD_DEFAULT_SIZE,
		);
	});

	test("a hand-built deck outside the board's bounds is brought back inside", () => {
		expect(leaderboardSizeFor({ leaderboardSize: 0 })).toBe(1);
		expect(leaderboardSizeFor({ leaderboardSize: -3 })).toBe(1);
		expect(leaderboardSizeFor({ leaderboardSize: 500 })).toBe(
			LEADERBOARD_SIZE_LIMIT,
		);
	});

	test("a size that is not a number at all falls back to the default", () => {
		expect(leaderboardSizeFor({ leaderboardSize: Number.NaN })).toBe(
			LEADERBOARD_DEFAULT_SIZE,
		);
		expect(
			leaderboardSizeFor({ leaderboardSize: Number.POSITIVE_INFINITY }),
		).toBe(LEADERBOARD_DEFAULT_SIZE);
	});

	test("a fractional size lands on a whole number of rows", () => {
		expect(leaderboardSizeFor({ leaderboardSize: 4.6 })).toBe(5);
	});
});

describe("the leaderboard slide type (REQ059)", () => {
	test("collects nothing — it reports on the quiz questions around it", () => {
		expect(isInteractiveSlideType("leaderboard")).toBe(false);
	});

	test("still has an aggregate to fetch, which is why the two gates differ", () => {
		expect(slideHasResults("leaderboard")).toBe(true);
		expect(slideHasResults("quiz")).toBe(true);
		expect(slideHasResults("text")).toBe(false);
		expect(slideHasResults("instruction")).toBe(false);
	});

	test("a slide parses with the default board size (ADR-0029)", () => {
		const parsed = SlideSchema.parse({
			id: "board",
			type: "leaderboard",
			question: "",
		});
		expect(parsed.leaderboardSize).toBe(LEADERBOARD_DEFAULT_SIZE);
	});

	test("the boundary refuses a board size the slide could not show", () => {
		const tooMany = SlideSchema.safeParse({
			id: "board",
			type: "leaderboard",
			question: "",
			leaderboardSize: LEADERBOARD_SIZE_LIMIT + 1,
		});
		expect(tooMany.success).toBe(false);
		const none = SlideSchema.safeParse({
			id: "board",
			type: "leaderboard",
			question: "",
			leaderboardSize: 0,
		});
		expect(none.success).toBe(false);
	});
});
