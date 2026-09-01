/**
 * Unit tests for the Ranking question type added in task/ranking-question-type.
 *
 * Covers the schema surface and the shared submission codec (no DB, no network):
 *   - REQ033 — the "ranking" slide type is interactive, and a participant's
 *              ordering encodes to / decodes from a single vote `value`
 *   - REQ034 — rankingItems[] and the RANKING_ITEM_LIMIT cap
 *
 * The encode/decode pair is tested here rather than through the API because it
 * is the contract *both* ends share (ADR-0013): the participant surface writes
 * the value and the aggregation reads it back.
 */

import { describe, expect, test } from "bun:test";
import {
	decodeRanking,
	encodeRanking,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	RANKING_ITEM_LIMIT,
	SlideSchema,
	SlideTypeEnum,
	StoredPresentationSchema,
} from "./schemas";

/** A minimal ranking slide with three items. */
function rankingSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "rk",
		type: "ranking",
		question: "Order these",
		rankingItems: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
			{ id: "c", text: "C" },
		],
		...overrides,
	});
}

describe("SlideTypeEnum — ranking (REQ033)", () => {
	test("ranking is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("ranking").success).toBe(true);
	});

	test("ranking is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("ranking")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("ranking");
	});
});

describe("SlideSchema — ranking items (REQ034)", () => {
	test("rankingItems defaults to an empty array on every other slide type", () => {
		const slide = SlideSchema.parse({
			id: "mc",
			type: "multiple-choice",
			question: "Pick",
			options: [{ id: "a", text: "A" }],
		});
		expect(slide.rankingItems).toEqual([]);
	});

	test("accepts an authored item list", () => {
		const slide = rankingSlide();
		expect(slide.rankingItems).toHaveLength(3);
		expect(slide.rankingItems[0]).toEqual({ id: "a", text: "A" });
	});

	test("rejects malformed items (missing id)", () => {
		expect(
			SlideSchema.safeParse({
				id: "rk",
				type: "ranking",
				question: "Order these",
				rankingItems: [{ text: "No id" }],
			}).success,
		).toBe(false);
	});

	test(`accepts exactly ${RANKING_ITEM_LIMIT} items`, () => {
		const slide = rankingSlide({
			rankingItems: Array.from({ length: RANKING_ITEM_LIMIT }, (_, index) => ({
				id: `i${index}`,
				text: `Item ${index}`,
			})),
		});
		expect(slide.rankingItems).toHaveLength(RANKING_ITEM_LIMIT);
	});

	test(`rejects more than ${RANKING_ITEM_LIMIT} items`, () => {
		expect(
			SlideSchema.safeParse({
				id: "rk",
				type: "ranking",
				question: "Order these",
				rankingItems: Array.from(
					{ length: RANKING_ITEM_LIMIT + 1 },
					(_, index) => ({ id: `i${index}`, text: `Item ${index}` }),
				),
			}).success,
		).toBe(false);
	});

	test("a stored deck authored before ranking existed re-parses forward (ADR-0029)", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [
				{ id: "s1", type: "word-cloud", question: "Describe the session" },
			],
		});
		expect(stored.slides[0].rankingItems).toEqual([]);
	});
});

describe("encodeRanking / decodeRanking (REQ033)", () => {
	const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

	test("an ordering round-trips through a single vote value", () => {
		const value = encodeRanking(["c", "a", "b"]);
		expect(decodeRanking(value, items)).toEqual(["c", "a", "b"]);
	});

	test("an encoded full ordering fits VoteSchema's 500-character budget", () => {
		// The worst realistic case: a full slide of UUID-ided items.
		const uuidItems = Array.from({ length: RANKING_ITEM_LIMIT }, () => ({
			id: crypto.randomUUID(),
		}));
		const value = encodeRanking(uuidItems.map((item) => item.id));
		expect(value.length).toBeLessThanOrEqual(500);
		expect(decodeRanking(value, uuidItems)).toHaveLength(RANKING_ITEM_LIMIT);
	});

	test("accepts a partial ordering — REQ034 lets participants rank only some", () => {
		expect(decodeRanking(encodeRanking(["b"]), items)).toEqual(["b"]);
		expect(decodeRanking(encodeRanking(["c", "a"]), items)).toEqual(["c", "a"]);
	});

	test("tolerates surrounding whitespace from a hand-built submission", () => {
		expect(decodeRanking(" c , a ", items)).toEqual(["c", "a"]);
	});

	test("rejects an empty submission", () => {
		expect(decodeRanking("", items)).toBe(null);
		expect(decodeRanking("  ,  ", items)).toBe(null);
	});

	test("rejects an item the slide does not have", () => {
		expect(decodeRanking("a,zzz", items)).toBe(null);
	});

	test("rejects a repeated item — one participant, one position per item", () => {
		expect(decodeRanking("a,b,a", items)).toBe(null);
	});
});
