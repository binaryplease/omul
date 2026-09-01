/**
 * Unit tests for P1 slide-type-settings additions in
 * task/0005-slide-type-settings.
 *
 * Covers the Zod schema extensions (no DB, no network):
 *   - REQ022 / REQ026 — maxResponses on word-cloud / open-text
 *   - REQ024        — openTextLayout enum
 *   - REQ025        — allowResponseVotes + ResponseVoteSchema
 *   - REQ029        — scaleStatements[]
 *   - REQ031        — scaleAllowSkip, Vote.skip
 *   - REQ032        — scaleLabels[]
 *   - Vote.statementId passthrough
 */

import { describe, expect, test } from "bun:test";
import { ResponseVoteSchema, SlideSchema, VoteSchema } from "./schemas";

describe("SlideSchema — P1 Word Cloud / Open Ended settings", () => {
	test("word-cloud: applies sensible defaults (maxResponses undefined, layout default irrelevant)", () => {
		const slide = SlideSchema.parse({
			id: "wc",
			type: "word-cloud",
			question: "Q",
		});
		expect(slide.maxResponses).toBeUndefined();
		expect(slide.allowResponseVotes).toBe(false);
	});

	test("word-cloud: accepts maxResponses 0 (unlimited) through 50", () => {
		for (const n of [0, 1, 3, 5, 50]) {
			const slide = SlideSchema.parse({
				id: "wc",
				type: "word-cloud",
				question: "Q",
				maxResponses: n,
			});
			expect(slide.maxResponses).toBe(n);
		}
	});

	test("word-cloud: rejects negative or non-integer maxResponses", () => {
		expect(
			SlideSchema.safeParse({
				id: "wc",
				type: "word-cloud",
				question: "Q",
				maxResponses: -1,
			}).success,
		).toBe(false);
		expect(
			SlideSchema.safeParse({
				id: "wc",
				type: "word-cloud",
				question: "Q",
				maxResponses: 1.5,
			}).success,
		).toBe(false);
	});

	test("word-cloud: rejects maxResponses above the cap (50)", () => {
		expect(
			SlideSchema.safeParse({
				id: "wc",
				type: "word-cloud",
				question: "Q",
				maxResponses: 51,
			}).success,
		).toBe(false);
	});

	test("open-text: openTextLayout defaults to 'speech-bubbles' (REQ024)", () => {
		const slide = SlideSchema.parse({
			id: "oe",
			type: "open-text",
			question: "Q",
		});
		expect(slide.openTextLayout).toBe("speech-bubbles");
	});

	test("open-text: accepts 'grid' layout and rejects unknown (REQ024)", () => {
		const grid = SlideSchema.parse({
			id: "oe",
			type: "open-text",
			question: "Q",
			openTextLayout: "grid",
		});
		expect(grid.openTextLayout).toBe("grid");

		expect(
			SlideSchema.safeParse({
				id: "oe",
				type: "open-text",
				question: "Q",
				openTextLayout: "masonry",
			}).success,
		).toBe(false);
	});

	test("open-text: allowResponseVotes can be enabled (REQ025)", () => {
		const slide = SlideSchema.parse({
			id: "oe",
			type: "open-text",
			question: "Q",
			allowResponseVotes: true,
		});
		expect(slide.allowResponseVotes).toBe(true);
	});
});

describe("SlideSchema — P1 Scales settings", () => {
	test("scaleStatements defaults to an empty array (backwards-compatible single statement)", () => {
		const slide = SlideSchema.parse({
			id: "sc",
			type: "scale",
			question: "Rate this",
		});
		// ADR-0029: collections default to `[]`, never `undefined`. An empty
		// list still selects the legacy single-statement aggregation path.
		expect(slide.scaleStatements).toEqual([]);
		expect(slide.scaleAllowSkip).toBe(false);
	});

	test("accepts scaleStatements[] (REQ029)", () => {
		const slide = SlideSchema.parse({
			id: "sc",
			type: "scale",
			question: "Rate each statement",
			scaleStatements: [
				{ id: "st1", text: "Docs are clear" },
				{ id: "st2", text: "UX is smooth" },
			],
		});
		expect(slide.scaleStatements).toHaveLength(2);
		expect(slide.scaleStatements?.[0]).toEqual({
			id: "st1",
			text: "Docs are clear",
		});
	});

	test("accepts scaleLabels[] for intermediate axis labels (REQ032)", () => {
		const slide = SlideSchema.parse({
			id: "sc",
			type: "scale",
			question: "Rate",
			scaleLabels: [
				{ value: 2, label: "Disagree" },
				{ value: 4, label: "Agree" },
			],
		});
		expect(slide.scaleLabels).toHaveLength(2);
		expect(slide.scaleLabels?.[1].label).toBe("Agree");
	});

	test("scaleAllowSkip can be enabled (REQ031)", () => {
		const slide = SlideSchema.parse({
			id: "sc",
			type: "scale",
			question: "Rate",
			scaleAllowSkip: true,
		});
		expect(slide.scaleAllowSkip).toBe(true);
	});

	test("rejects malformed scaleStatement entries (missing id)", () => {
		expect(
			SlideSchema.safeParse({
				id: "sc",
				type: "scale",
				question: "Rate",
				scaleStatements: [{ text: "Missing id" }],
			}).success,
		).toBe(false);
	});

	test("rejects more than 5 scaleStatements (task/0007 cap)", () => {
		const result = SlideSchema.safeParse({
			id: "sc",
			type: "scale",
			question: "Rate",
			scaleStatements: Array.from({ length: 6 }, (_, i) => ({
				id: `st${i}`,
				text: `s${i}`,
			})),
		});
		expect(result.success).toBe(false);
	});

	test("accepts up to 5 scaleStatements (task/0007 cap)", () => {
		const slide = SlideSchema.parse({
			id: "sc",
			type: "scale",
			question: "Rate",
			scaleStatements: Array.from({ length: 5 }, (_, i) => ({
				id: `st${i}`,
				text: `s${i}`,
			})),
		});
		expect(slide.scaleStatements).toHaveLength(5);
	});
});

describe("SlideSchema — task/0007 backgroundImage", () => {
	test("backgroundImage is optional and round-trips", () => {
		const slide = SlideSchema.parse({
			id: "s1",
			type: "text",
			question: "Hi",
			backgroundImage: "https://example.com/bg.jpg",
		});
		expect(slide.backgroundImage).toBe("https://example.com/bg.jpg");
	});

	test("backgroundImage defaults to an empty string", () => {
		const slide = SlideSchema.parse({
			id: "s1",
			type: "text",
			question: "Hi",
		});
		// ADR-0029: string fields default to "" so read sites never see undefined.
		expect(slide.backgroundImage).toBe("");
	});
});

describe("VoteSchema — P1 statementId + skip", () => {
	test("accepts a vote with statementId and skip (REQ029/REQ031)", () => {
		const vote = VoteSchema.parse({
			slideId: "sc",
			value: "3",
			participantId: "p1",
			statementId: "st1",
			skip: false,
		});
		expect(vote.statementId).toBe("st1");
		expect(vote.skip).toBe(false);
	});

	test("statementId and skip carry explicit defaults when omitted", () => {
		const vote = VoteSchema.parse({
			slideId: "wc",
			value: "hello",
			participantId: "p1",
		});
		// ADR-0029: a genuinely-absent statement is an explicit `null`; skip
		// defaults to a concrete `false` rather than a missing key.
		expect(vote.statementId).toBeNull();
		expect(vote.skip).toBe(false);
	});

	test("rejects empty value string", () => {
		expect(
			VoteSchema.safeParse({
				slideId: "s",
				value: "",
				participantId: "p1",
			}).success,
		).toBe(false);
	});
});

describe("ResponseVoteSchema — P1 upvotes (REQ025)", () => {
	test("accepts a well-formed upvote payload", () => {
		const v = ResponseVoteSchema.parse({
			slideId: "oe",
			responseId: "resp-abc",
			participantId: "p1",
		});
		expect(v.slideId).toBe("oe");
		expect(v.responseId).toBe("resp-abc");
		expect(v.participantId).toBe("p1");
	});

	test("participantId is optional", () => {
		const v = ResponseVoteSchema.parse({
			slideId: "oe",
			responseId: "resp-abc",
		});
		expect(v.participantId).toBeUndefined();
	});

	test("rejects missing responseId", () => {
		expect(
			ResponseVoteSchema.safeParse({
				slideId: "oe",
				participantId: "p1",
			}).success,
		).toBe(false);
	});
});
