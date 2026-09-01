/**
 * Unit tests for the read side of a segmented result (REQ020, REQ116).
 *
 * Everything this surface decides on its own, and nothing it delegates:
 *
 *   - `segmentPickerOptions` — what a reader is offered, and what they are told
 *     about what they are not. The entries come from the server's own descriptor
 *     (`segmentSourcesFor`), so what is asserted here is that the picker carries
 *     that verdict faithfully: an ineligible slide is drawn and disabled with
 *     the server's sentence (ADR-0025), never dropped.
 *   - `readSegments` — the defensive read of a payload this page polls for. A
 *     deck edited underneath an open breakdown must degrade to "no groups", not
 *     to a crash inside a chart.
 *   - `segmentCountLabel` / `segmentSuppressedReason` /
 *     `segmentedWithheldReason` — the sentences a breakdown is drawn with, which
 *     are the whole of what a reader gets where the numbers are held back. Each
 *     has to be true of *both* cases it covers: a group too small to publish and
 *     the group held back beside it, a breakdown behind the reveal mode and one
 *     behind a tally that names people.
 *
 * What the groups actually come to is the server's claim and is tested there,
 * over HTTP, in `server/segmentation.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { Slide } from "../types";
import { SEGMENT_REFUSAL_REASONS } from "../types";
import {
	NO_SEGMENT,
	NO_SEGMENT_LABEL,
	NO_SOURCES_REASON,
	readSegments,
	segmentCountLabel,
	segmentedWithheldReason,
	segmentPickerOptions,
	segmentSuppressedReason,
} from "./SegmentedResults";

/** A slide as the browser holds one: built from the schema's input type. */
function slide(overrides: Record<string, unknown>): Slide {
	return {
		id: "s1",
		type: "multiple-choice",
		question: "Pick one",
		options: [
			{ id: "a", text: "Alpha" },
			{ id: "b", text: "Beta" },
		],
		...overrides,
	} as Slide;
}

const deck: Slide[] = [
	slide({ id: "team", question: "Which team?" }),
	slide({ id: "cloud", type: "word-cloud", question: "One word?", options: [] }),
	slide({ id: "topic", question: "Ready?" }),
];

describe("segmentPickerOptions — what a reader may group by (REQ116)", () => {
	test("the room whole comes first, then every earlier slide in deck order", () => {
		const options = segmentPickerOptions(deck, "topic");
		expect(options.map((option) => option.value)).toEqual([
			NO_SEGMENT,
			"team",
			"cloud",
		]);
		expect(options[0].label).toBe(NO_SEGMENT_LABEL);
		expect(options[1].label).toBe("1. Which team?");
	});

	test("an ineligible slide is disabled with the server's own reason (ADR-0025)", () => {
		const options = segmentPickerOptions(deck, "topic");
		expect(options[1].disabled).toBe(false);
		expect(options[2].disabled).toBe(true);
		expect(options[2].disabledReason).toBe(
			SEGMENT_REFUSAL_REASONS["unsupported-type"],
		);
	});

	test("a slide with nothing before it still draws the control, and says why it is inert", () => {
		const options = segmentPickerOptions(deck, "team");
		expect(options).toHaveLength(1);
		expect(options[0].disabled).toBe(true);
		expect(options[0].disabledReason).toBe(NO_SOURCES_REASON);
	});

	test("a slide whose question was left blank is named by its type", () => {
		const unnamed = [slide({ id: "one", question: "  " }), slide({ id: "two" })];
		expect(segmentPickerOptions(unnamed, "two")[1].label).toBe(
			"1. Multiple Choice",
		);
	});
});

describe("readSegments — reading a payload this page polls for (REQ116)", () => {
	test("reads the groups the server sent", () => {
		const view = readSegments({
			withheld: false,
			withheldReason: null,
			minRespondents: 5,
			segments: [
				{
					key: "a",
					label: "Alpha",
					respondentCount: 6,
					results: { type: "multiple-choice", totalVotes: 6 },
					suppressed: false,
				},
				{
					key: null,
					label: "Did not answer",
					respondentCount: null,
					results: null,
					suppressed: true,
				},
			],
		});
		expect(view.withheld).toBe(false);
		expect(view.minRespondents).toBe(5);
		expect(view.segments[0].results.totalVotes).toBe(6);
		expect(view.segments[1].key).toBeNull();
		expect(view.segments[1].suppressed).toBe(true);
	});

	test("a held-back group's missing head count stays missing, never a drawn zero", () => {
		const view = readSegments({
			withheld: false,
			withheldReason: null,
			minRespondents: 5,
			segments: [
				{ key: "a", label: "Alpha", results: null, suppressed: true },
			],
		});
		expect(view.segments[0].respondentCount).toBeNull();
	});

	test("a withheld breakdown reads as withheld and empty, never as a room nobody is in", () => {
		for (const reason of ["reveal-mode", "identifiable"] as const) {
			const view = readSegments({
				withheld: true,
				withheldReason: reason,
				minRespondents: 5,
				segments: [],
			});
			expect(view.withheld).toBe(true);
			expect(view.withheldReason).toBe(reason);
			expect(view.segments).toEqual([]);
		}
	});

	test("a payload missing everything degrades to no groups rather than throwing", () => {
		for (const payload of [null, undefined, {}, { segments: "nope" }]) {
			const view = readSegments(payload);
			expect(view.withheld).toBe(false);
			expect(view.withheldReason).toBeNull();
			expect(view.segments).toEqual([]);
		}
	});
});

describe("the sentences a group is drawn with (REQ116)", () => {
	test("the head count reads as words, singular and plural alike", () => {
		expect(segmentCountLabel(0)).toBe("0 answered");
		expect(segmentCountLabel(1)).toBe("1 answered");
		expect(segmentCountLabel(7)).toBe("7 answered");
	});

	test("a count that was not sent draws no chip at all", () => {
		expect(segmentCountLabel(null)).toBeNull();
	});

	test("a held-back group says why without claiming it is the small one", () => {
		// It covers two cases in one breath: the group too small to publish, and the
		// group held back beside it so the small one cannot be subtracted out. A
		// sentence that named only the first would tell a reader with a group of
		// nine that nine is fewer than five.
		const reason = segmentSuppressedReason(5);
		expect(reason).toContain("5");
		expect(reason).toContain("subtracting");
	});

	test("a whole withheld breakdown says which of the two reasons it is", () => {
		const revealMode = segmentedWithheldReason("reveal-mode");
		const identifiable = segmentedWithheldReason("identifiable");
		expect(revealMode).toContain("organizer has kept");
		expect(identifiable).not.toBe(revealMode);
		expect(identifiable).toContain("Only the organizer");
		// An unknown or absent reason still reads as something rather than blank.
		expect(segmentedWithheldReason(null).length).toBeGreaterThan(0);
	});
});
