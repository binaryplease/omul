/**
 * Unit tests for the deck's reveal mode — when a question slide's tally reaches
 * the audience.
 *
 * Covers the shared vocabulary and its resolvers (no DB, no network):
 *   - REQ015 — `instant` publishes a tally as each answer lands
 *   - REQ016 — `on-click` publishes only on the presenter's reveal
 *   - REQ017 — `private` never publishes one, whatever the deck's state
 *   - REQ018 — one mode set for the deck applies to every question slide
 *
 * The gate lives here rather than on a surface because every surface reads it:
 * the results endpoints, the `results.updated` broadcast, the preview's audience
 * pane, and both live views. These tests pin the rule itself; the round-trip
 * through the real app is in `reveal-mode.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	effectiveResultsVisibility,
	isWithheldTally,
	PresentationSchema,
	SlideSchema,
	StoredPresentationSchema,
	tallyVisibleToAudience,
	withheldTally,
	withInheritedResultsVisibility,
} from "./schemas";

/** A question slide, optionally carrying its own override of the deck mode. */
function questionSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "q1",
		type: "multiple-choice",
		question: "Pick",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		],
		...overrides,
	});
}

describe("tallyVisibleToAudience — the three reveal modes", () => {
	test("instant publishes the tally as answers land (REQ015)", () => {
		// Nothing to wait for and nothing to click: the room watches the count
		// move. Neither a reveal nor its absence changes the answer.
		const slide = questionSlide();
		expect(tallyVisibleToAudience(slide, { resultsVisibility: "instant" })).toBe(
			true,
		);
		expect(
			tallyVisibleToAudience(slide, {
				resultsVisibility: "instant",
				revealedSlideIds: [],
			}),
		).toBe(true);
	});

	test("a deck with no mode set publishes live (REQ015)", () => {
		// The schema's default, read the same way by a partial deck that never
		// carried the field at all.
		expect(StoredPresentationSchema.shape.resultsVisibility.parse(undefined)).toBe(
			"instant",
		);
		expect(tallyVisibleToAudience(questionSlide(), {})).toBe(true);
	});

	test("on-click collects silently and publishes on the reveal (REQ016)", () => {
		const slide = questionSlide();
		const deck = { resultsVisibility: "on-click" as const };
		expect(tallyVisibleToAudience(slide, deck)).toBe(false);
		expect(
			tallyVisibleToAudience(slide, { ...deck, revealedSlideIds: ["q1"] }),
		).toBe(true);
		// Revealing a *different* slide publishes nothing here: the reveal is per
		// slide, not a switch for the deck.
		expect(
			tallyVisibleToAudience(slide, { ...deck, revealedSlideIds: ["q2"] }),
		).toBe(false);
		// And taking the reveal back withholds it again (REQ102's hide).
		expect(
			tallyVisibleToAudience(slide, { ...deck, revealedSlideIds: [] }),
		).toBe(false);
	});

	test("private never publishes a tally (REQ017)", () => {
		const slide = questionSlide();
		const deck = { resultsVisibility: "private" as const };
		expect(tallyVisibleToAudience(slide, deck)).toBe(false);
		// Not even to a reveal — the presenter's control belongs to `on-click`,
		// and "never on screen" is the whole content of this setting.
		expect(
			tallyVisibleToAudience(slide, { ...deck, revealedSlideIds: ["q1"] }),
		).toBe(false);
	});

	test("a slide's own mode overrides the deck's, in both directions", () => {
		// The precedence is `effectiveResultsVisibility`, so the gate inherits it
		// rather than restating it — asserted here so the two cannot drift.
		expect(
			tallyVisibleToAudience(questionSlide({ resultsVisibility: "instant" }), {
				resultsVisibility: "private",
			}),
		).toBe(true);
		expect(
			tallyVisibleToAudience(questionSlide({ resultsVisibility: "private" }), {
				resultsVisibility: "instant",
			}),
		).toBe(false);
		expect(
			effectiveResultsVisibility("inherit", "on-click"),
		).toBe("on-click");
	});

	test("an ended deck does not publish what its mode withheld", () => {
		// Deliberately unlike a quiz answer key, which an ended deck does release:
		// a key has nothing left to game once the room is done, while "never" and
		// "only when I say" are decisions the organizer made about their own
		// numbers. Ending a session is not the organizer revealing them.
		const slide = questionSlide();
		expect(
			tallyVisibleToAudience(slide, {
				resultsVisibility: "private",
				revealedSlideIds: [],
			}),
		).toBe(false);
		expect(
			tallyVisibleToAudience(slide, {
				resultsVisibility: "on-click",
				revealedSlideIds: [],
			}),
		).toBe(false);
	});
});

describe("withheldTally — what the audience reads instead", () => {
	test("names the slide type and states the withholding, and nothing else", () => {
		const marker = withheldTally("multiple-choice");
		expect(marker).toEqual({ type: "multiple-choice", withheld: true });
		// No numbers of any kind — an emptied tally would be a lie a client draws
		// ("0 of 0 answered") under a question the room has answered.
		expect(Object.keys(marker).sort()).toEqual(["type", "withheld"]);
	});

	test("is recognisable, and a real tally is not mistaken for one", () => {
		expect(isWithheldTally(withheldTally("quiz"))).toBe(true);
		expect(isWithheldTally({ type: "quiz", totalVotes: 3 })).toBe(false);
		expect(isWithheldTally(null)).toBe(false);
		expect(isWithheldTally(undefined)).toBe(false);
		// A tally that happens to carry a falsy `withheld` is a tally.
		expect(isWithheldTally({ type: "quiz", withheld: false })).toBe(false);
	});
});

describe("withInheritedResultsVisibility — one mode for the whole deck (REQ018)", () => {
	test("clears the override on every question slide", () => {
		const applied = withInheritedResultsVisibility([
			questionSlide({ id: "a", resultsVisibility: "instant" }),
			questionSlide({ id: "b", resultsVisibility: "private" }),
			questionSlide({ id: "c" }),
		]);
		expect(applied.map((slide) => slide.resultsVisibility)).toEqual([
			"inherit",
			"inherit",
			"inherit",
		]);
	});

	test("every question slide then reads the deck's mode, and moves with it", () => {
		const applied = withInheritedResultsVisibility([
			questionSlide({ id: "a", resultsVisibility: "instant" }),
			questionSlide({ id: "b", resultsVisibility: "on-click" }),
		]);
		// The point of the operation: one setting, and the whole deck obeys it.
		for (const mode of ["instant", "on-click", "private"] as const) {
			for (const slide of applied) {
				expect(
					tallyVisibleToAudience(slide, { resultsVisibility: mode }),
				).toBe(mode === "instant");
			}
		}
	});

	test("leaves content slides alone — they have no tally to publish", () => {
		// A content slide carries the field only because every slide shares one
		// shape; a stray value on one is meaningless and is left exactly as found,
		// so this operation touches nothing it does not govern.
		const applied = withInheritedResultsVisibility([
			SlideSchema.parse({
				id: "t",
				type: "text",
				question: "Hello",
				resultsVisibility: "private",
			}),
			questionSlide({ id: "q", resultsVisibility: "private" }),
		]);
		expect(applied[0].resultsVisibility).toBe("private");
		expect(applied[1].resultsVisibility).toBe("inherit");
	});

	test("sweeps a leaderboard in — it asks nothing and still shows a result", () => {
		const applied = withInheritedResultsVisibility([
			SlideSchema.parse({
				id: "lb",
				type: "leaderboard",
				question: "Standings",
				resultsVisibility: "private",
			}),
		]);
		expect(applied[0].resultsVisibility).toBe("inherit");
	});

	test("loosens as readily as it tightens, and says so by doing it", () => {
		// A Pin on Image slide pinned to `on-click` because it carries a target
		// area (REQ053) follows the deck like every other question slide. This is
		// the operation REQ018 asks for, not an oversight — the editor states it
		// before the organizer runs it.
		const applied = withInheritedResultsVisibility([
			SlideSchema.parse({
				id: "pn",
				type: "pin-image",
				question: "Where?",
				mediaUrl: "https://example.test/map.png",
				pinArea: { x: 100, y: 100, width: 200, height: 200 },
				resultsVisibility: "on-click",
			}),
		]);
		expect(applied[0].resultsVisibility).toBe("inherit");
		expect(
			tallyVisibleToAudience(applied[0], { resultsVisibility: "instant" }),
		).toBe(true);
	});

	test("returns a fresh list — the input slides are not mutated", () => {
		const original = questionSlide({ resultsVisibility: "private" });
		const applied = withInheritedResultsVisibility([original]);
		expect(original.resultsVisibility).toBe("private");
		expect(applied[0]).not.toBe(original);
	});

	test("an empty deck applies cleanly", () => {
		expect(withInheritedResultsVisibility([])).toEqual([]);
	});
});

describe("the mode round-trips through the presentation schema", () => {
	test("every mode is accepted, and an unknown one is refused", () => {
		for (const mode of ["instant", "on-click", "private"]) {
			expect(
				PresentationSchema.parse({
					id: "p",
					code: "123456",
					title: "Deck",
					slides: [],
					createdAt: "2026-01-01T00:00:00.000Z",
					resultsVisibility: mode,
				}).resultsVisibility,
			).toBe(mode as never);
		}
		expect(
			PresentationSchema.safeParse({
				id: "p",
				code: "123456",
				title: "Deck",
				slides: [],
				createdAt: "2026-01-01T00:00:00.000Z",
				resultsVisibility: "sometimes",
			}).success,
		).toBe(false);
	});

	test("a slide may inherit, override, or say nothing at all", () => {
		expect(questionSlide().resultsVisibility).toBe("inherit");
		expect(questionSlide({ resultsVisibility: "private" }).resultsVisibility).toBe(
			"private",
		);
		expect(
			SlideSchema.safeParse({
				id: "q",
				type: "multiple-choice",
				question: "Q",
				resultsVisibility: "on-reveal",
			}).success,
		).toBe(false);
	});
});
