/**
 * Unit tests for deck sharing's client half (REQ075).
 *
 * Three pure pieces, no DOM and no server:
 *
 *   - the level descriptor — one entry per level the server accepts, in the same
 *     order, because a picker that offered a fourth or dropped one would be
 *     offering a grant the API has no word for;
 *   - `deckAccessLevelLabel` — composed by the dialog's picker *and* by the badge
 *     on a shared deck's card, which is the whole reason it is a function rather
 *     than two literals;
 *   - `collaboratorDisplayName` — how a row is named when the account behind the
 *     grant has no display name, and when it no longer exists at all.
 *
 * What a level actually *buys* is a claim about the server and is tested there,
 * over HTTP, in `server/collaborators.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	collaboratorDisplayName,
	DECK_ACCESS_LEVEL_DESCRIPTORS,
	deckAccessLevelLabel,
	deckAccessLevelSummary,
} from "./components/CollaboratorsDialog";
import { DECK_ACCESS_LEVELS } from "./types";

describe("the level descriptor", () => {
	test("offers exactly the levels the API accepts, in the same order", () => {
		expect(DECK_ACCESS_LEVEL_DESCRIPTORS.map((entry) => entry.level)).toEqual([
			...DECK_ACCESS_LEVELS,
		]);
	});

	test("every level is named and explained", () => {
		for (const level of DECK_ACCESS_LEVELS) {
			expect(deckAccessLevelLabel(level).length).toBeGreaterThan(0);
			expect(deckAccessLevelSummary(level).length).toBeGreaterThan(0);
		}
	});

	test("`comment` says it grants no more than `view` today", () => {
		// The level is carried faithfully through the model for the comment
		// feature to build on, and an owner granting it must not be told it does
		// something that is not there yet.
		expect(deckAccessLevelSummary("comment")).toContain("Can view");
	});

	test("no standing at all reads as no access, never as a blank", () => {
		expect(deckAccessLevelLabel(null)).toBe("No access");
		expect(deckAccessLevelSummary(null).length).toBeGreaterThan(0);
	});
});

describe("how a collaborator is named", () => {
	test("the display name wins, the address stands in for it", () => {
		expect(
			collaboratorDisplayName({ email: "a@example.com", name: "Ada" }),
		).toBe("Ada");
		expect(collaboratorDisplayName({ email: "a@example.com", name: null })).toBe(
			"a@example.com",
		);
		expect(collaboratorDisplayName({ email: "a@example.com", name: "  " })).toBe(
			"a@example.com",
		);
	});

	test("a grant that outlived its account is said so, not left blank", () => {
		// The row still has to be visible: it is a standing the owner may want to
		// revoke, and an empty row is one they cannot see to revoke.
		expect(collaboratorDisplayName({ email: "", name: null })).toBe(
			"Account no longer exists",
		);
	});
});
