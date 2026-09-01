/**
 * Unit tests for the live room's two switches — what the presenter decides
 * about the room while it is in front of them.
 *
 * Covers the shared vocabulary and its resolvers (no DB, no network):
 *   - REQ111 — whether a slide accepts submissions is presenter-controlled
 *     state, and the closed set is what carries it
 *   - REQ109 — the shared screen can be blanked, and blanking is one boolean
 *     that says nothing about anything else
 *
 * The predicates live in `server/schemas.ts` rather than on a surface because
 * both ends read them: the vote boundary refuses on the first, the shared
 * screen and every phone draw from both, and the session store applies the same
 * set arithmetic the route writes with. These tests pin the rules themselves;
 * the round trip through the real app is in `live-room.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	audienceViewBlanked,
	PresentationSchema,
	slideAcceptsSubmissions,
	StoredPresentationSchema,
	UpdatePresentationSchema,
	withSlideParticipation,
} from "./schemas";

describe("slideAcceptsSubmissions — participation, per slide (REQ111)", () => {
	test("a deck that has closed nothing accepts every slide", () => {
		// The ordinary state of a running session, and the only default that does
		// not silently refuse a room.
		expect(slideAcceptsSubmissions({}, "q1")).toBe(true);
		expect(slideAcceptsSubmissions({ closedSlideIds: [] }, "q1")).toBe(true);
	});

	test("a closed slide is closed, and only that slide", () => {
		const deck = { closedSlideIds: ["q2"] };
		expect(slideAcceptsSubmissions(deck, "q2")).toBe(false);
		expect(slideAcceptsSubmissions(deck, "q1")).toBe(true);
		expect(slideAcceptsSubmissions(deck, "q3")).toBe(true);
	});

	test("closing is per slide, not per deck — several can be closed at once", () => {
		const deck = { closedSlideIds: ["q1", "q3"] };
		expect(slideAcceptsSubmissions(deck, "q1")).toBe(false);
		expect(slideAcceptsSubmissions(deck, "q2")).toBe(true);
		expect(slideAcceptsSubmissions(deck, "q3")).toBe(false);
	});

	test("blanking the screen says nothing about participation", () => {
		// The distinction REQ109 is written against: a blanked room is still a
		// room that can answer.
		expect(slideAcceptsSubmissions({ audienceBlanked: true }, "q1")).toBe(true);
	});
});

describe("withSlideParticipation — the closed set (REQ111)", () => {
	test("closing adds the slide; opening takes it back out", () => {
		expect(withSlideParticipation([], "q1", false)).toEqual(["q1"]);
		expect(withSlideParticipation(["q1"], "q1", true)).toEqual([]);
	});

	test("it is idempotent in both directions", () => {
		// A double-tap, and a broadcast that arrives twice, both land on the state
		// the presenter asked for rather than on a set with a duplicate in it.
		expect(withSlideParticipation(["q1"], "q1", false)).toEqual(["q1"]);
		expect(withSlideParticipation([], "q1", true)).toEqual([]);
	});

	test("it leaves every other slide exactly where it was", () => {
		expect(withSlideParticipation(["q1", "q2"], "q3", false)).toEqual([
			"q1",
			"q2",
			"q3",
		]);
		expect(withSlideParticipation(["q1", "q2", "q3"], "q2", true)).toEqual([
			"q1",
			"q3",
		]);
	});

	test("it does not mutate the set it was handed", () => {
		// Both callers hold the previous set — the route reads it off the stored
		// deck, the store off the presentation it is about to patch — so a
		// mutating helper would move state neither of them meant to move.
		const current = ["q1"];
		expect(withSlideParticipation(current, "q2", false)).toEqual(["q1", "q2"]);
		expect(current).toEqual(["q1"]);
	});
});

describe("audienceViewBlanked — the shared screen (REQ109)", () => {
	test("a deck nobody has blanked is showing its slide", () => {
		expect(audienceViewBlanked({})).toBe(false);
		expect(audienceViewBlanked({ audienceBlanked: false })).toBe(false);
	});

	test("a blanked deck reads as blanked", () => {
		expect(audienceViewBlanked({ audienceBlanked: true })).toBe(true);
	});

	test("closing a slide does not blank the screen", () => {
		// The other half of the same distinction: the room can be shown a question
		// it is no longer allowed to answer.
		expect(audienceViewBlanked({ closedSlideIds: ["q1"] })).toBe(false);
	});
});

describe("the stored and public shapes", () => {
	test("both fields default to the state a deck was already in (ADR-0029)", () => {
		// Every deck written before this slice re-parses forward onto a session
		// with nothing closed and nothing blanked, which is the only pair that
		// cannot refuse a room or darken a projector by omission.
		expect(StoredPresentationSchema.shape.closedSlideIds.parse(undefined)).toEqual(
			[],
		);
		expect(
			StoredPresentationSchema.shape.audienceBlanked.parse(undefined),
		).toBe(false);
		expect(PresentationSchema.shape.closedSlideIds.parse(undefined)).toEqual([]);
		expect(PresentationSchema.shape.audienceBlanked.parse(undefined)).toBe(
			false,
		);
	});

	test("both are public — they survive the projection every client reads", () => {
		// A phone that did not know a question was closed would offer a control the
		// boundary is refusing, and the screen being projected may be a second
		// browser rather than the presenter's own.
		const projected = PresentationSchema.parse({
			id: "deck",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: new Date().toISOString(),
			closedSlideIds: ["q1"],
			audienceBlanked: true,
		});
		expect(projected.closedSlideIds).toEqual(["q1"]);
		expect(projected.audienceBlanked).toBe(true);
	});

	test("neither can be written by the free-form deck PATCH", () => {
		// Server-managed live state, moved by its own routes — the same standing
		// `status`, `activeSlideIndex`, `revealedSlideIds` and `slideStartedAt`
		// have. Zod strips what the schema does not declare, so a save from the
		// editor cannot reopen a question the presenter has just closed.
		const patched = UpdatePresentationSchema.parse({
			title: "Renamed",
			closedSlideIds: [],
			audienceBlanked: false,
		});
		expect(patched).toEqual({ title: "Renamed" });
		expect("closedSlideIds" in patched).toBe(false);
		expect("audienceBlanked" in patched).toBe(false);
	});
});
