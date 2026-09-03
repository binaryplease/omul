/**
 * Unit tests for the participant-name surfaces (REQ076) — the pure half.
 *
 * The two predicates below were extracted out of the pages precisely so they
 * could be asked about without rendering one, and this is the file that asks.
 * Between them they decide the whole of what a participant sees at a deck's
 * door, and the one property that carries the slice here is the one the
 * module's own docstring promises and nothing else enforced:
 *
 *   **The deck decides, not the browser's memory.** A deck that has stopped
 *   asking owes nothing, whatever this browser happens to have stored — so
 *   turning the switch off mid-session returns the room to the deck rather than
 *   leaving it holding a question nobody is asking, and turning it on reaches
 *   everybody already in the room.
 *
 * The labels are checked as a mapping rather than for their wording: what
 * matters is that every key a surface reads is filled from the deck's own
 * dictionary (REQ084) rather than falling back to English on one of them.
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "../i18n";
import {
	PARTICIPANT_NAME_LABELS_EN,
	participantNameLabelsFor,
	participantNameOutstanding,
	participantRosterHeading,
} from "./ParticipantName";
import type { ParticipantRosterEntry } from "../types";

// ── Does this browser still owe the deck a name? ─────────────

describe("participantNameOutstanding (REQ076)", () => {
	test("a deck that does not ask owes nothing", () => {
		expect(participantNameOutstanding({ requireParticipantName: false }, "")).toBe(
			false,
		);
	});

	test("a deck that asks, and a browser that has not answered, owes one", () => {
		expect(participantNameOutstanding({ requireParticipantName: true }, "")).toBe(
			true,
		);
	});

	test("a stated name settles it", () => {
		expect(
			participantNameOutstanding({ requireParticipantName: true }, "Ada"),
		).toBe(false);
	});

	test("whitespace is not an answer", () => {
		expect(
			participantNameOutstanding({ requireParticipantName: true }, "   "),
		).toBe(true);
	});

	test("a deck that has stopped asking releases a participant at the gate", () => {
		// The mid-session-off case, and the reason the gate is computed from the
		// deck rather than from local state: the boundary starts refusing the
		// write, and somebody still standing at the door has to be let through
		// rather than left on a screen whose only control the server now rejects.
		expect(
			participantNameOutstanding({ requireParticipantName: false }, ""),
		).toBe(false);
	});

	test("a deck that starts asking mid-session asks a browser already in the room", () => {
		// The other half: nothing about this browser changed, only the deck it
		// holds — which is what the `presentation.participant-name` broadcast
		// replaces. Without that frame this predicate is never re-evaluated
		// against a switch that moved.
		const before = { requireParticipantName: false };
		const after = { requireParticipantName: true };
		expect(participantNameOutstanding(before, "")).toBe(false);
		expect(participantNameOutstanding(after, "")).toBe(true);
	});

	test("no deck at all owes nothing", () => {
		expect(participantNameOutstanding(null, "")).toBe(false);
	});

	test("a deck written before the field existed owes nothing", () => {
		// `requireParticipantName` is absent on a deck an older build persisted;
		// the schema defaults it, and this predicate must agree rather than read
		// `undefined` as "ask".
		expect(participantNameOutstanding({}, "")).toBe(false);
	});
});

// ── The organizer's roster heading ───────────────────────────

describe("participantRosterHeading (REQ076)", () => {
	const entry = (participantId: string, name: string): ParticipantRosterEntry => ({
		participantId,
		name,
		answeredSlides: 0,
		statedAt: "",
	});

	test("a roster not read yet claims no count", () => {
		// An unknown count reads as an explicit absence, which is the rule the
		// chip's own comment states: a `0` would claim an empty room on a deck this
		// browser has not asked about.
		expect(participantRosterHeading(null)).toBe("Participants");
	});

	test("an empty roster is a real, read count", () => {
		expect(participantRosterHeading([])).toBe("Participants (0)");
	});

	test("a populated roster counts what it holds", () => {
		expect(participantRosterHeading([entry("p1", "Ada"), entry("p2", "Bob")])).toBe(
			"Participants (2)",
		);
	});
});

// ── The deck's own wording ───────────────────────────────────

describe("participantNameLabelsFor (REQ076/REQ084)", () => {
	test("every key a surface reads is filled from the dictionary", () => {
		const labels = participantNameLabelsFor(getDict("de"));
		expect(Object.keys(labels).sort()).toEqual(
			Object.keys(PARTICIPANT_NAME_LABELS_EN).sort(),
		);
		for (const value of Object.values(labels)) {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});

	test("a translated deck wears its own words, not the organizer's", () => {
		const german = participantNameLabelsFor(getDict("de"));
		expect(german.title).not.toBe(PARTICIPANT_NAME_LABELS_EN.title);
		expect(german.submit).not.toBe(PARTICIPANT_NAME_LABELS_EN.submit);
	});

	test("an unknown language tag falls back rather than emptying the gate", () => {
		const unknown = participantNameLabelsFor(getDict("xx"));
		expect(unknown.title).toBe(PARTICIPANT_NAME_LABELS_EN.title);
	});
});
