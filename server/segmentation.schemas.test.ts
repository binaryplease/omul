/**
 * Unit tests for the vocabulary a segmented read is built from (REQ020, REQ116).
 *
 * Three questions, and no DB or network between them:
 *   - **Which slides may group another one?** `segmentSourceRefusalFor` /
 *     `segmentRefusalFor` / `segmentSourcesFor` — the one guard the endpoint
 *     enforces and the picker draws its entries from, so what is asserted here
 *     is that the two cannot disagree: every refusal carries the sentence a
 *     person reads.
 *   - **Who lands in which group?** `segmentBucketsFor` — the join on
 *     participant id, including everything the rows can be wrong about: an
 *     option the organizer has since deleted, a participant who answered twice,
 *     a row with no participant id at all.
 *   - **How few people may a published group stand on?**
 *     `segmentTallyVisible` — the floor, and which credential lifts it.
 *
 * The round trip over HTTP — what the numbers come to, and who is refused — is
 * `segmentation.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { SlideSchema } from "./schemas";
import {
	SEGMENT_MIN_RESPONDENTS,
	SEGMENT_REFUSAL_REASONS,
	SEGMENT_UNANSWERED_LABEL,
	segmentBucketsFor,
	segmentDisclosure,
	segmentedTallyIsAggregate,
	segmentRefusalFor,
	segmentSourceRefusalFor,
	segmentSourcesFor,
} from "./segmentation";

/** A slide as the deck holds it — parsed, so every default is in place. */
function slide(overrides: Record<string, unknown>) {
	return SlideSchema.parse({
		id: "s1",
		type: "multiple-choice",
		question: "Pick one",
		options: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
		],
		...overrides,
	});
}

/** A stored vote row, as the aggregation reads them: untyped, from the store. */
function row(participantId: string, value: string, skip = false) {
	return { participantId, value, skip };
}

describe("segmentSourceRefusalFor — which slides can group another (REQ020)", () => {
	test("a single-select choice slide can, and a quiz answered by picking can", () => {
		expect(segmentSourceRefusalFor(slide({}))).toBeNull();
		expect(
			segmentSourceRefusalFor(slide({ id: "q", type: "quiz" })),
		).toBeNull();
		// The legacy spelling of "one option only" reads the same way.
		expect(
			segmentSourceRefusalFor(slide({ allowMultiple: false })),
		).toBeNull();
	});

	test("a multi-select slide cannot — one person would be in several groups", () => {
		expect(segmentSourceRefusalFor(slide({ mcMaxSelections: 0 }))).toBe(
			"multi-select",
		);
		expect(segmentSourceRefusalFor(slide({ mcMaxSelections: 3 }))).toBe(
			"multi-select",
		);
		expect(segmentSourceRefusalFor(slide({ allowMultiple: true }))).toBe(
			"multi-select",
		);
	});

	test("a typed quiz question cannot — there is no authored set to divide by", () => {
		expect(
			segmentSourceRefusalFor(
				slide({ type: "quiz", quizAnswerMode: "type", options: [] }),
			),
		).toBe("typed-answers");
	});

	test("every other question type is refused for its shape, not offered half-working", () => {
		for (const type of [
			"word-cloud",
			"open-text",
			"scale",
			"ranking",
			"grid",
			"points",
			"guess-number",
			"pin-image",
			"form",
		] as const) {
			expect(segmentSourceRefusalFor(slide({ type, options: [] }))).toBe(
				"unsupported-type",
			);
		}
	});

	test("a slide that takes no answers of its own is refused as such", () => {
		// A leaderboard has a tally (REQ059) and collects nothing, so it is refused
		// for having no answers rather than for the shape of answers it has not got.
		expect(
			segmentSourceRefusalFor(slide({ type: "leaderboard", options: [] })),
		).toBe("no-answers");
		for (const type of ["text", "image", "video", "embed", "instruction"] as const) {
			expect(segmentSourceRefusalFor(slide({ type, options: [] }))).toBe(
				"no-answers",
			);
		}
	});

	test("every refusal has a sentence a person can read", () => {
		for (const [refusal, reason] of Object.entries(SEGMENT_REFUSAL_REASONS)) {
			expect(reason.length).toBeGreaterThan(0);
			expect(refusal.length).toBeGreaterThan(0);
		}
	});
});

describe("segmentRefusalFor — the pair, not either slide (REQ020)", () => {
	const deck = [
		slide({ id: "one" }),
		slide({ id: "two" }),
		slide({ id: "three", type: "word-cloud", options: [] }),
	];

	test("an earlier choice slide groups a later one", () => {
		expect(segmentRefusalFor(deck, "two", "one")).toBeNull();
	});

	test("a slide does not group itself", () => {
		expect(segmentRefusalFor(deck, "one", "one")).toBe("same-slide");
	});

	test("a breakdown reads backwards — a later slide is refused", () => {
		expect(segmentRefusalFor(deck, "one", "two")).toBe("not-earlier");
	});

	test("a slide this deck does not have is refused as unknown", () => {
		expect(segmentRefusalFor(deck, "two", "nope")).toBe("unknown-slide");
		expect(segmentRefusalFor(deck, "nope", "one")).toBe("unknown-slide");
	});

	test("a slide with no tally of its own has nothing to break down", () => {
		// The target end of the pair, which is checked too: a title card answered
		// with one empty group per option would be a 200 to a meaningless question.
		const withContent = [deck[0], slide({ id: "title", type: "text", options: [] })];
		expect(segmentRefusalFor(withContent, "title", "one")).toBe("no-tally");
	});

	test("an earlier slide of the wrong shape keeps its own refusal", () => {
		// `three` is a word cloud, and it is also *later* than `two`. The order is
		// checked first, so the reason a reader is given is the one that would still
		// be true if they moved the slide.
		expect(segmentRefusalFor(deck, "two", "three")).toBe("not-earlier");
		const reordered = [deck[2], deck[0], deck[1]];
		expect(segmentRefusalFor(reordered, "one", "three")).toBe(
			"unsupported-type",
		);
	});
});

describe("segmentSourcesFor — what a picker draws (REQ116)", () => {
	const deck = [
		slide({ id: "one", question: "Which team?" }),
		slide({ id: "two", type: "word-cloud", question: "One word?", options: [] }),
		slide({ id: "three", question: "Ready?" }),
		slide({ id: "four", question: "After" }),
	];

	test("every earlier slide with a tally is listed, in deck order and 1-indexed", () => {
		const sources = segmentSourcesFor(deck, "three");
		expect(sources.map((source) => source.slideId)).toEqual(["one", "two"]);
		expect(sources.map((source) => source.position)).toEqual([1, 2]);
		expect(sources[0].question).toBe("Which team?");
	});

	test("an ineligible slide is marked rather than dropped (ADR-0025)", () => {
		const sources = segmentSourcesFor(deck, "three");
		expect(sources[0].refusal).toBeNull();
		expect(sources[0].reason).toBeNull();
		expect(sources[1].refusal).toBe("unsupported-type");
		expect(sources[1].reason).toBe(
			SEGMENT_REFUSAL_REASONS["unsupported-type"],
		);
	});

	test("a content slide is not an entry at all — it was never a grouping", () => {
		const withContent = [slide({ id: "title", type: "text", options: [] }), ...deck];
		expect(
			segmentSourcesFor(withContent, "one").map((source) => source.slideId),
		).toEqual([]);
	});

	test("the first slide of a deck has nothing to be grouped by", () => {
		expect(segmentSourcesFor(deck, "one")).toEqual([]);
	});

	test("a target this deck does not have offers nothing", () => {
		expect(segmentSourcesFor(deck, "gone")).toEqual([]);
	});
});

describe("segmentBucketsFor — the join on participant id (REQ020)", () => {
	const source = slide({
		id: "team",
		options: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
			{ id: "c", text: "Gamma" },
		],
	});

	test("one group per authored option, in authored order, empty ones kept", () => {
		const buckets = segmentBucketsFor(
			source,
			[row("p1", "a"), row("p2", "b")],
			["p1", "p2"],
		);
		expect(buckets.map((bucket) => bucket.key)).toEqual(["a", "b", "c", null]);
		expect(buckets.map((bucket) => bucket.label)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
			SEGMENT_UNANSWERED_LABEL,
		]);
		expect(buckets[0].participantIds).toEqual(["p1"]);
		expect(buckets[2].participantIds).toEqual([]);
	});

	test("the people who answered the slide being broken down, and not this one, are their own group", () => {
		const buckets = segmentBucketsFor(source, [row("p1", "a")], [
			"p1",
			"p2",
			"p3",
		]);
		expect(buckets[3].key).toBeNull();
		expect(buckets[3].participantIds).toEqual(["p2", "p3"]);
	});

	test("somebody who answered neither slide is in no group", () => {
		const buckets = segmentBucketsFor(source, [row("p9", "a")], ["p1"]);
		expect(buckets[0].participantIds).toEqual(["p9"]);
		expect(buckets[3].participantIds).toEqual(["p1"]);
	});

	test("a participant counted once, however many rows they left", () => {
		// First standing answer wins — the rule `finalQuizAnswers` already applies
		// to the answer that scores, so a breakdown cannot disagree with the bars.
		const buckets = segmentBucketsFor(
			source,
			[row("p1", "a"), row("p1", "b")],
			["p1"],
		);
		expect(buckets[0].participantIds).toEqual(["p1"]);
		expect(buckets[1].participantIds).toEqual([]);
		expect(buckets[3].participantIds).toEqual([]);
	});

	test("an option the organizer has since deleted groups nobody", () => {
		const buckets = segmentBucketsFor(source, [row("p1", "gone")], ["p1"]);
		const named = buckets.slice(0, 3);
		expect(named.every((bucket) => bucket.participantIds.length === 0)).toBe(true);
		// They answered the slide being broken down, so they are still in the room —
		// just not in a group this slide can name.
		expect(buckets[3].participantIds).toEqual(["p1"]);
	});

	test("a skipped row and a row with no participant id group nobody", () => {
		const buckets = segmentBucketsFor(
			source,
			[row("p1", "a", true), row("", "b")],
			["p1"],
		);
		expect(buckets[0].participantIds).toEqual([]);
		expect(buckets[1].participantIds).toEqual([]);
		expect(buckets[3].participantIds).toEqual(["p1"]);
	});

	test("an option authored with no text is still a group a reader can tell apart", () => {
		const unnamed = slide({
			options: [
				{ id: "a", text: "" },
				{ id: "b", text: "Beta" },
			],
		});
		expect(segmentBucketsFor(unnamed, [], [])[0].label).toBe("Option 1");
	});

	test("a group is named by the option's text without its padding", () => {
		const padded = slide({
			options: [
				{ id: "a", text: "  Alpha  " },
				{ id: "b", text: "Beta" },
			],
		});
		expect(segmentBucketsFor(padded, [], [])[0].label).toBe("Alpha");
	});

	test("a quiz question groups by the option each competitor picked", () => {
		const quiz = slide({
			id: "quiz",
			type: "quiz",
			options: [
				{ id: "right", text: "1969", isCorrect: true },
				{ id: "wrong", text: "1972" },
			],
		});
		const buckets = segmentBucketsFor(
			quiz,
			[row("p1", "right"), row("p2", "wrong"), row("p3", "right")],
			["p1", "p2", "p3"],
		);
		expect(buckets[0].participantIds).toEqual(["p1", "p3"]);
		expect(buckets[1].participantIds).toEqual(["p2"]);
	});
});

describe("segmentDisclosure — which groups may be published (REQ020)", () => {
	/** How many groups holding people were held back — the number that matters. */
	function heldWithPeople(counts: number[], flags: boolean[]): number {
		return counts.filter((count, index) => count > 0 && !flags[index]).length;
	}

	test("a group too small to hide anybody in is not published", () => {
		const counts = [9, 8, 2];
		const flags = segmentDisclosure(counts, {});
		expect(flags).toEqual([true, false, false]);
		expect(counts[2]).toBeLessThan(SEGMENT_MIN_RESPONDENTS);
	});

	test("every group clearing the floor is published, and nothing is held back for nothing", () => {
		expect(segmentDisclosure([9, 8, 5], {})).toEqual([true, true, true]);
	});

	test("an empty group is published — it discloses nothing and hides nothing", () => {
		// And it must not count as the second group held back: a residual that mixes
		// a real group with an empty one is the real group, whole.
		const counts = [9, 7, 0];
		expect(segmentDisclosure(counts, {})).toEqual([true, true, true]);
	});

	test("ONE small group is never held back alone — the residual would be that group", () => {
		// The reviewer's repro, as arithmetic: six on Alpha, one on Beta, everyone
		// answering the slide being broken down. Publish Alpha and hold Beta and the
		// caller subtracts Alpha from the unsegmented tally, which the same caller
		// may read, and has the lone Beta participant's answers verbatim.
		const counts = [6, 1, 0];
		const flags = segmentDisclosure(counts, {});
		expect(flags[1]).toBe(false);
		expect(heldWithPeople(counts, flags)).toBeGreaterThanOrEqual(2);
		// The complement is the *smallest* group that clears the floor, so a reader
		// loses as little as possible.
		expect(segmentDisclosure([20, 6, 1], {})).toEqual([true, false, false]);
	});

	test("a complement is taken even when it clears the floor comfortably", () => {
		const counts = [40, 2];
		const flags = segmentDisclosure(counts, {});
		expect(flags).toEqual([false, false]);
		expect(heldWithPeople(counts, flags)).toBe(2);
	});

	test("two small groups already cover each other — no third is taken", () => {
		const counts = [9, 3, 2];
		const flags = segmentDisclosure(counts, {});
		expect(flags).toEqual([true, false, false]);
		expect(heldWithPeople(counts, flags)).toBe(2);
	});

	test("the one group that is the whole room is held back alone, and gives nothing away", () => {
		// Nobody to pair it with, and nothing gained by pairing: the residual is the
		// unsegmented tally, which this caller may already read.
		expect(segmentDisclosure([3, 0, 0], {})).toEqual([false, true, true]);
	});

	test("the same room always reads the same way", () => {
		const counts = [7, 7, 1];
		expect(segmentDisclosure(counts, {})).toEqual(segmentDisclosure(counts, {}));
		expect(segmentDisclosure(counts, {})).toEqual([false, true, false]);
	});

	test("the results link does not lift it — it delegates numbers, not people", () => {
		expect(segmentDisclosure([9, 1], { hasResultsLink: true })).toEqual([
			false,
			false,
		]);
		expect(segmentDisclosure([9, 8], { hasResultsLink: true })).toEqual([
			true,
			true,
		]);
	});

	test("whoever can edit the deck reads every group, whatever its size", () => {
		expect(segmentDisclosure([1, 0, 30], { canEdit: true })).toEqual([
			true,
			true,
			true,
		]);
	});
});

describe("segmentedTallyIsAggregate — what a breakdown may be published of (REQ020)", () => {
	test("a tally that is counts over an authored set may be broken down publicly", () => {
		for (const type of [
			"multiple-choice",
			"scale",
			"ranking",
			"points",
			"form",
		] as const) {
			expect(segmentedTallyIsAggregate(slide({ type, options: [] }))).toBe(true);
		}
		expect(segmentedTallyIsAggregate(slide({ type: "quiz" }))).toBe(true);
	});

	test("a tally that lists one entry per respondent may not — no group size fixes that", () => {
		// Two breakdowns of the same slide by different groupings carry the same
		// entries, so intersecting a group of five with a group of six can leave one
		// person — every group clearing the floor the whole way down.
		for (const type of [
			"open-text",
			"word-cloud",
			"pin-image",
			"grid",
			"guess-number",
			"leaderboard",
		] as const) {
			expect(segmentedTallyIsAggregate(slide({ type, options: [] }))).toBe(false);
		}
	});

	test("a typed quiz question publishes what the room wrote, so it is not an aggregate", () => {
		expect(
			segmentedTallyIsAggregate(
				slide({ type: "quiz", quizAnswerMode: "type", options: [] }),
			),
		).toBe(false);
	});
});
