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
 *     grant has no display name, and when it no longer exists at all;
 *   - the folder standing helpers — how the deck's list splits, and what a revoke
 *     says about the access the account keeps through a folder (REQ126).
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
	type FolderStanding,
	folderStandingOf,
	noGrantsSentence,
	revokedGrantNotice,
	revokeTitle,
	splitDeckCollaborators,
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

describe("access through a shared folder (REQ126)", () => {
	const row = {
		email: "a@example.com",
		name: "Ada",
		level: "view" as const,
		createdAt: "",
		updatedAt: "",
	};
	const standing: FolderStanding = {
		...row,
		id: "folder-grant",
		level: "edit",
		folder: { id: "folder", name: "Talks" },
	};

	test("the list splits into the deck's grants and the folder's", () => {
		const grant = { ...row, id: "deck-grant", folder: null };
		expect(splitDeckCollaborators([grant, standing])).toEqual({
			grants: [grant],
			folderStanding: [standing],
		});
	});

	test("a revoke says what the account keeps through the folder", () => {
		expect(revokedGrantNotice(row, [standing])).toBe(
			"Ada no longer has a grant on this deck, but keeps “Can edit” through the folder “Talks”",
		);
		expect(revokeTitle(row, [standing])).toContain("they keep “Can edit”");
	});

	test("a revoke says access ended when no folder grant remains", () => {
		expect(revokedGrantNotice(row, [])).toBe("Ada no longer has access");
		expect(
			revokedGrantNotice({ ...row, email: "b@example.com", name: "Bo" }, [
				standing,
			]),
		).toBe("Bo no longer has access");
		expect(revokeTitle(row, [])).toContain("it stops at their next request");
	});

	test("two deleted accounts are not matched by their empty emails", () => {
		expect(
			folderStandingOf({ email: "" }, [{ ...standing, email: "" }]),
		).toBeUndefined();
	});

	test("the empty list does not call a deck unshared while a folder reaches it", () => {
		expect(noGrantsSentence("Shared with nobody.", [standing])).toBe(
			"No account has a grant on this deck itself.",
		);
		expect(noGrantsSentence("Shared with nobody.", [])).toBe(
			"Shared with nobody.",
		);
	});
});
