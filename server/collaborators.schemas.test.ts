/**
 * Unit tests for deck sharing's shared vocabulary (REQ075).
 *
 * Six things, and no DB or network between them:
 *   - `canMutateDeck` / `canReadDeckAuthoring` — the two halves of what a level
 *     means. Every gated route is decided by the first; the second is why a
 *     `view` collaborator reads the deck rather than a redacted copy of it.
 *   - `callerCanEditDeck` — the client side of the first of those, and the one
 *     answer every client surface gates its controls on (REQ149).
 *   - The stored grant — its identity pair carries no default while
 *     everything else does, so a row written before a field existed
 *     re-parses forward instead of failing.
 *   - The wire shape — `DeckCollaboratorSchema` does not declare `userId`, so an
 *     account identifier cannot reach a client by being spread into a response,
 *     the same construction that keeps `creatorId` off `PresentationSchema`.
 *   - The two request bodies — the share body defaults to the *weakest* level,
 *     the level-change body refuses to default at all.
 *   - `weakestDeckAccessLevel` — how a pair that somehow carries two grants is
 *     read. The unique index makes that impossible going forward; this is the
 *     direction it fails in if a row predates the index.
 *
 * The round trip over HTTP — who is refused which mutation, and what a revoke
 * costs a collaborator mid-session — is `collaborators.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	callerCanEditDeck,
	canMutateDeck,
	canReadDeckAuthoring,
	DECK_ACCESS_LEVELS,
	DeckAccessLevelBodySchema,
	DeckCollaboratorSchema,
	ShareDeckSchema,
	StoredDeckCollaboratorSchema,
} from "./schemas";
import { weakestDeckAccessLevel } from "./services/collaborators";

describe("the access levels themselves (REQ075)", () => {
	test("there are exactly three, weakest first", () => {
		expect(DECK_ACCESS_LEVELS).toEqual(["view", "comment", "edit"]);
	});

	test("only `edit` authorizes a mutation — `comment` is not a weaker edit", () => {
		expect(canMutateDeck("edit")).toBe(true);
		expect(canMutateDeck("comment")).toBe(false);
		expect(canMutateDeck("view")).toBe(false);
	});

	test("no standing at all is the withholding answer", () => {
		// The value a caller with no grant resolves to. It must never pass the
		// mutation gate, and it must never read what the organizer authored.
		expect(canMutateDeck(null)).toBe(false);
		expect(canReadDeckAuthoring(null)).toBe(false);
	});

	test("every level reads the deck as its author wrote it", () => {
		for (const level of DECK_ACCESS_LEVELS) {
			expect(canReadDeckAuthoring(level)).toBe(true);
		}
	});
});

describe("callerCanEditDeck — what a client surface gates on (REQ149)", () => {
	test("the standing the server reported is enough on its own", () => {
		// The defect this exists for. The account owns the deck — it was created on
		// another machine, or through the API with `x-api-key`, which mints no edit
		// token at all — so no browser can hold a token for it, and asking the token
		// map alone hands the owner a read-only view of their own presentation.
		expect(
			callerCanEditDeck({ heldEditToken: false, accessLevel: "edit" }),
		).toBe(true);
	});

	test("the edit token is enough on its own", () => {
		// The browser that created the deck and never signed in: it holds the token,
		// and the deck read reports `edit` off that same token. Both halves say yes,
		// and either one alone would have.
		expect(callerCanEditDeck({ heldEditToken: true, accessLevel: "edit" })).toBe(
			true,
		);
		// The token also carries a browser through the moment before the fetch has
		// answered, so a reload does not flash a read-only screen at its owner.
		expect(
			callerCanEditDeck({ heldEditToken: true, accessLevel: undefined }),
		).toBe(true);
		expect(callerCanEditDeck({ heldEditToken: true, accessLevel: null })).toBe(
			true,
		);
	});

	test("a weaker grant draws no edit controls", () => {
		// A `view` or `comment` collaborator reads the deck as its author wrote it
		// (`canReadDeckAuthoring`) and may change none of it — the distinction this
		// predicate has to keep, since it is the one every button is drawn from.
		for (const accessLevel of ["view", "comment"] as const) {
			expect(callerCanEditDeck({ heldEditToken: false, accessLevel })).toBe(
				false,
			);
		}
	});

	test("no standing and no token is the withholding answer", () => {
		// Including the unanswered fetch: a page that asks before its read lands
		// must not draw live controls on the guess.
		for (const accessLevel of [null, undefined]) {
			expect(callerCanEditDeck({ heldEditToken: false, accessLevel })).toBe(
				false,
			);
		}
	});

	test("it is the client reading of `canMutateDeck`, not a second opinion", () => {
		// The two must not drift: what a surface enables is exactly what the route
		// behind it authorizes, so a level that stops mutating stops drawing.
		for (const accessLevel of [...DECK_ACCESS_LEVELS, null]) {
			expect(callerCanEditDeck({ heldEditToken: false, accessLevel })).toBe(
				canMutateDeck(accessLevel),
			);
		}
	});
});

describe("the stored grant", () => {
	test("the identity pair has no default and fails loudly", () => {
		expect(() =>
			StoredDeckCollaboratorSchema.parse({ id: "g1", userId: "u1" }),
		).toThrow();
		expect(() =>
			StoredDeckCollaboratorSchema.parse({ id: "g1", presentationId: "p1" }),
		).toThrow();
	});

	test("a grant written before a field existed re-parses forward", () => {
		// The shape as an older build could have written it: identity only.
		const grant = StoredDeckCollaboratorSchema.parse({
			id: "g1",
			presentationId: "p1",
			userId: "u1",
		});
		// The weakest level is what an unstated one means — a grant must not
		// acquire the strongest standing there is by being old.
		expect(grant.level).toBe("view");
		expect(grant.invitedBy).toBeNull();
		expect(grant.createdAt).toBe("");
		expect(grant.updatedAt).toBe("");
	});

	test("a level outside the vocabulary is refused, not coerced", () => {
		expect(() =>
			StoredDeckCollaboratorSchema.parse({
				id: "g1",
				presentationId: "p1",
				userId: "u1",
				level: "owner",
			}),
		).toThrow();
	});
});

describe("the wire shape a deck's owner reads", () => {
	test("the account id is dropped by construction, not by a list", () => {
		const wire = DeckCollaboratorSchema.parse({
			id: "g1",
			userId: "u1",
			presentationId: "p1",
			invitedBy: "u0",
			email: "other@example.com",
			name: "Other",
			level: "comment",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		// Zod strips what the schema does not declare — so the three server-side
		// identifiers cannot travel even when the whole stored row is handed in.
		expect(wire).not.toHaveProperty("userId");
		expect(wire).not.toHaveProperty("presentationId");
		expect(wire).not.toHaveProperty("invitedBy");
		expect(wire.email).toBe("other@example.com");
		expect(wire.level).toBe("comment");
	});

	test("a deleted account's grant keeps every key rather than losing them", () => {
		const wire = DeckCollaboratorSchema.parse({ id: "g1" });
		expect(wire.email).toBe("");
		expect(wire.name).toBeNull();
		expect(wire.level).toBe("view");
	});
});

describe("the two request bodies", () => {
	test("a share that states no level grants the weakest one", () => {
		expect(ShareDeckSchema.parse({ email: "other@example.com" }).level).toBe(
			"view",
		);
	});

	test("a share names an account by email, and only by a real one", () => {
		expect(ShareDeckSchema.parse({ email: " other@example.com " }).email).toBe(
			"other@example.com",
		);
		expect(() => ShareDeckSchema.parse({ email: "not-an-address" })).toThrow();
		expect(() => ShareDeckSchema.parse({})).toThrow();
	});

	test("a level change with no level is malformed, not a demotion to `view`", () => {
		expect(() => DeckAccessLevelBodySchema.parse({})).toThrow();
		expect(DeckAccessLevelBodySchema.parse({ level: "edit" }).level).toBe("edit");
	});
});

describe("weakestDeckAccessLevel — reading a pair that somehow has two grants", () => {
	test("no levels at all is no standing", () => {
		expect(weakestDeckAccessLevel([])).toBeNull();
	});

	test("one level reads as itself", () => {
		for (const level of DECK_ACCESS_LEVELS) {
			expect(weakestDeckAccessLevel([level])).toBe(level);
		}
	});

	test("a stale duplicate can only ever take access away", () => {
		// The failure this guards: the owner demotes the grant they can see, a
		// duplicate at `edit` survives, and the collaborator keeps what the owner
		// believes they removed. Reading the weakest makes the demotion count.
		expect(weakestDeckAccessLevel(["edit", "view"])).toBe("view");
		expect(weakestDeckAccessLevel(["view", "edit"])).toBe("view");
		expect(weakestDeckAccessLevel(["edit", "comment"])).toBe("comment");
		expect(weakestDeckAccessLevel(["edit", "edit"])).toBe("edit");
	});
});
