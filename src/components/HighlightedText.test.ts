/**
 * Unit tests for search-match highlighting.
 *
 * The split is the whole of it — `<HighlightedText/>` only wraps the matched
 * runs in a `<mark>` — so pinning `highlightSegments` pins what a reader is
 * shown as the reason a result is in their list. Two properties matter more
 * than the marking itself:
 *
 *   - **Nothing is lost or invented.** Re-joining the segments has to give back
 *     the original string, character for character. A highlighter that dropped
 *     a character, or re-cased one to match the query, would quietly rewrite the
 *     content it is supposed to be pointing at.
 *   - **It marks what the filter matched.** The catalog's search is a plain
 *     case-insensitive substring (`deckTemplateMatchesSearch`), so this marks
 *     every occurrence of exactly that — not a fuzzy run, and not only the first
 *     one.
 */

import { describe, expect, test } from "bun:test";
import { highlightSegments } from "./HighlightedText";

/** The segments re-joined — must always equal the input. */
function rejoin(text: string, search: string): string {
	return highlightSegments(text, search)
		.map((segment) => segment.text)
		.join("");
}

/** Only the marked runs, in order. */
function marked(text: string, search: string): string[] {
	return highlightSegments(text, search)
		.filter((segment) => segment.matched)
		.map((segment) => segment.text);
}

describe("highlightSegments", () => {
	test("no search leaves the string whole and unmarked", () => {
		expect(highlightSegments("Team check-in", "")).toEqual([
			{ text: "Team check-in", matched: false },
		]);
		expect(highlightSegments("Team check-in", "   ")).toEqual([
			{ text: "Team check-in", matched: false },
		]);
	});

	test("a match is split out where it sits", () => {
		expect(highlightSegments("Team check-in", "check")).toEqual([
			{ text: "Team ", matched: false },
			{ text: "check", matched: true },
			{ text: "-in", matched: false },
		]);
	});

	test("every occurrence is marked, not only the first", () => {
		expect(marked("retro, and the retro after it", "retro")).toEqual([
			"retro",
			"retro",
		]);
	});

	test("a match at either end produces no empty segment", () => {
		expect(highlightSegments("Quiz round", "quiz")).toEqual([
			{ text: "Quiz", matched: true },
			{ text: " round", matched: false },
		]);
		expect(highlightSegments("Quiz round", "round")).toEqual([
			{ text: "Quiz ", matched: false },
			{ text: "round", matched: true },
		]);
		expect(highlightSegments("quiz", "quiz")).toEqual([
			{ text: "quiz", matched: true },
		]);
	});

	test("case is ignored for matching and kept for display", () => {
		// The marked run is the text as authored — the reader sees their own
		// content, not their query echoed back at them in the wrong case.
		expect(marked("Prioritization Workshop", "workshop")).toEqual(["Workshop"]);
		expect(marked("prioritization workshop", "WORKSHOP")).toEqual(["workshop"]);
	});

	test("the query's surrounding space is not part of the match", () => {
		expect(marked("Team check-in", "  team  ")).toEqual(["Team"]);
	});

	test("a search nothing answers marks nothing and keeps the string", () => {
		expect(highlightSegments("Team check-in", "zzz")).toEqual([
			{ text: "Team check-in", matched: false },
		]);
	});

	test("an empty string stays one empty segment", () => {
		// The card renders a description unconditionally, so an entry without one
		// must not produce zero segments and an empty render tree.
		expect(highlightSegments("", "anything")).toEqual([
			{ text: "", matched: false },
		]);
	});

	test("the segments always re-join to the original", () => {
		const cases: [string, string][] = [
			["Team check-in", "e"],
			["aaaa", "aa"],
			["Quiz round", ""],
			["Retrospective", "retrospective"],
			["  spaced  out  ", " "],
			["", ""],
		];
		for (const [text, search] of cases) {
			expect(rejoin(text, search)).toBe(text);
		}
	});

	test("overlapping runs are consumed, not re-scanned into each other", () => {
		// "aa" in "aaaa" is two runs, not three: a scanner that stepped one
		// character at a time would mark overlapping segments and emit the middle
		// characters twice, which is how a highlighter starts duplicating text.
		expect(marked("aaaa", "aa")).toEqual(["aa", "aa"]);
	});
});
