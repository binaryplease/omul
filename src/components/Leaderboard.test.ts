/**
 * Unit tests for the leaderboard's client-side reading of the board (REQ059).
 *
 * `readLeaderboard` is the one place the shared screen and the participant's
 * phone turn the results payload into rows, and `leaderboardBarWidth` /
 * `leaderboardRankSurface` are what the rows are drawn from. What they have to
 * get right is everything the payload can be missing — a board is rendered
 * before anybody has answered, and from a broadcast a client may hold before it
 * has ever polled.
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "../i18n";
import { LEADERBOARD_DEFAULT_SIZE } from "../types";
import {
	LEADERBOARD_LABELS_EN,
	leaderboardBarWidth,
	leaderboardLabelsFor,
	leaderboardRankSurface,
	readLeaderboard,
} from "./Leaderboard";

function row(entryId: string, rank: number, totalPoints: number) {
	return { entryId, rank, totalPoints, correctCount: 1, answeredCount: 2 };
}

describe("readLeaderboard (REQ059)", () => {
	test("reads the rows the server placed", () => {
		const board = readLeaderboard({
			quizCount: 3,
			maxPoints: 3000,
			rankedCount: 12,
			size: 5,
			entries: [
				{ ...row("aaaa", 1, 2400), label: "Player AAAA" },
				{ ...row("bbbb", 2, 900), label: "Player BBBB" },
			],
		});
		expect(board.quizCount).toBe(3);
		expect(board.rankedCount).toBe(12);
		expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2]);
		expect(board.entries[0].label).toBe("Player AAAA");
	});

	test("keeps the server's places rather than numbering the rows it drew", () => {
		// Level scores share a place (1, 2, 2, 4). A board that numbered its own
		// rows would break the one tie the server took care to keep.
		const board = readLeaderboard({
			entries: [row("aaaa", 1, 900), row("bbbb", 2, 400), row("cccc", 2, 400)],
		});
		expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2, 2]);
	});

	test("an empty board is a board, not a crash", () => {
		const board = readLeaderboard(null);
		expect(board.entries).toEqual([]);
		expect(board.rankedCount).toBe(0);
		expect(board.quizCount).toBe(0);
		expect(board.size).toBe(LEADERBOARD_DEFAULT_SIZE);
	});

	test("a payload with rows but no total never claims a field smaller than the one on screen", () => {
		const board = readLeaderboard({
			entries: [row("aaaa", 1, 900), row("bbbb", 2, 400)],
		});
		expect(board.rankedCount).toBe(2);
	});

	test("a row that arrived without a name is still called something", () => {
		const board = readLeaderboard({ entries: [row("3f9a2c7b", 1, 900)] });
		expect(board.entries[0].label).toBe("Player 3F9A2C");
	});
});

describe("leaderboardBarWidth (REQ059)", () => {
	test("draws the leader full and the rest against them", () => {
		expect(leaderboardBarWidth(1000, 1000)).toBe(100);
		expect(leaderboardBarWidth(500, 1000)).toBe(50);
	});

	test("a score of nothing draws nothing", () => {
		// A minimum sliver would claim a row scored something when it did not.
		expect(leaderboardBarWidth(0, 1000)).toBe(0);
	});

	test("a room where nobody scored draws no bars at all", () => {
		expect(leaderboardBarWidth(0, 0)).toBe(0);
	});

	test("a tiny score is still visible as a mark rather than a hairline", () => {
		expect(leaderboardBarWidth(1, 100_000)).toBe(6);
	});
});

describe("leaderboardRankSurface (REQ059)", () => {
	test("the podium's three places are each their own", () => {
		const podium = [1, 2, 3].map(leaderboardRankSurface);
		expect(new Set(podium).size).toBe(3);
	});

	test("fourth place down wears the plain surface — a podium that included everybody would mark nothing", () => {
		expect(leaderboardRankSurface(4)).toBe(leaderboardRankSurface(19));
		expect(leaderboardRankSurface(4)).not.toBe(leaderboardRankSurface(3));
	});
});

describe("leaderboardLabelsFor (REQ059/REQ084)", () => {
	test("dresses the board in the deck's language", () => {
		const labels = leaderboardLabelsFor(getDict("de"));
		expect(labels.title).toBe("Bestenliste");
		expect(labels.you).toBe("Du");
		// The unit under a place is the one a quiz answer is already scored in.
		expect(labels.points).toBe(getDict("de").quizPoints);
	});

	test("every word a row draws is translated, including its hit rate", () => {
		// A row reads "3 / 5 correct" beside "Punkte" if any part of it is reached
		// for directly instead of arriving as a label.
		expect(leaderboardLabelsFor(getDict("de")).correct).toBe("richtig");
		expect(leaderboardLabelsFor(getDict("nl")).correct).toBe("goed");
		expect(leaderboardLabelsFor(getDict("en")).correct).toBe(
			LEADERBOARD_LABELS_EN.correct,
		);
	});

	test("every label the board draws has a translation to draw", () => {
		for (const language of ["en", "de", "fr", "es", "it", "pt", "nl"]) {
			const labels = leaderboardLabelsFor(getDict(language));
			for (const key of Object.keys(LEADERBOARD_LABELS_EN)) {
				expect(labels[key as keyof typeof labels]).toBeTruthy();
			}
		}
	});
});
