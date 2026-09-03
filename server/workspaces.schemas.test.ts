/**
 * Unit tests for the workspace vocabulary (REQ128, REQ129).
 *
 * Everything a route is decided by, with no DB and no network between them:
 *
 *   - the role set — three of them, weakest first, and open at the weak end so
 *     REQ131's reduced role can arrive without renumbering anything;
 *   - the five capability predicates — what each role may do, stated once so no
 *     route re-derives it by comparing role strings;
 *   - `workspaceDeckAccessLevel` — the one bridge from a role to the deck access
 *     model every gated route already reads, which is what makes a workspace
 *     deck authorized by the same two predicates a shared deck is;
 *   - `canGrandfatherLegacyDeck` — the sharpest line in the slice: a workspace
 *     deck has no owner and no token hash, and reading it as a pre-auth deck
 *     would hand `edit` to every anonymous caller who could type its id;
 *   - `strongestDeckAccessLevel` — how two *independent* standings on one deck
 *     combine, and why that is the opposite of how two duplicate rows do;
 *   - the stored shapes — identity fields carry no default while
 *     everything else does, so a row written before a field existed
 *     re-parses forward instead of failing;
 *   - the wire shapes — no account identifier can reach a client, by the same
 *     construction that keeps `creatorId` off a deck;
 *   - the request bodies — the add defaults to the *weakest* role, the role
 *     change refuses to default at all.
 *
 * What a role actually *buys* is a claim about the server and is tested there,
 * over HTTP, in `workspaces.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	AddWorkspaceMemberSchema,
	canAdministerWorkspace,
	canAdministerWorkspaceDecks,
	canCreateWorkspaceDecks,
	canGrandfatherLegacyDeck,
	canManageWorkspaceMembers,
	canMutateDeck,
	canReadDeckAuthoring,
	canReadWorkspace,
	CreateWorkspaceSchema,
	DECK_ACCESS_LEVELS,
	DEFAULT_WORKSPACE_ROLE,
	DeckWorkspaceSchema,
	PresentationSchema,
	RenameWorkspaceSchema,
	StoredPresentationSchema,
	StoredWorkspaceMemberSchema,
	StoredWorkspaceSchema,
	strongestDeckAccessLevel,
	UNWRITABLE_PRESENTATION_FIELDS,
	WORKSPACE_NAME_MAX_LENGTH,
	WORKSPACE_ROLES,
	WorkspaceMemberSchema,
	WorkspaceRoleBodySchema,
	WorkspaceSchema,
	workspaceDeckAccessLevel,
} from "./schemas";
import { weakestDeckAccessLevel } from "./services/collaborators";
import { weakestWorkspaceRole } from "./services/workspaces";

describe("the roles themselves (REQ129)", () => {
	test("there are exactly three, weakest first", () => {
		expect(WORKSPACE_ROLES).toEqual(["member", "admin", "owner"]);
	});

	test("an unstated role is the weakest one there is", () => {
		expect(DEFAULT_WORKSPACE_ROLE).toBe(WORKSPACE_ROLES[0]);
	});

	test("every role reads the workspace; none of them is no role", () => {
		for (const role of WORKSPACE_ROLES) {
			expect(canReadWorkspace(role)).toBe(true);
		}
		expect(canReadWorkspace(null)).toBe(false);
	});

	test("every role creates decks — REQ131's reduced role is the one that will not", () => {
		// Stated as a fact about today rather than as a tautology: when the reduced
		// role lands it goes at the front of WORKSPACE_ROLES and answers `false`
		// here, and this test is what will have to be edited to say so.
		for (const role of WORKSPACE_ROLES) {
			expect(canCreateWorkspaceDecks(role)).toBe(true);
		}
	});

	test("administering the workspace's decks is admin and owner", () => {
		expect(canAdministerWorkspaceDecks("member")).toBe(false);
		expect(canAdministerWorkspaceDecks("admin")).toBe(true);
		expect(canAdministerWorkspaceDecks("owner")).toBe(true);
	});

	test("managing who is in it is admin and owner", () => {
		expect(canManageWorkspaceMembers("member")).toBe(false);
		expect(canManageWorkspaceMembers("admin")).toBe(true);
		expect(canManageWorkspaceMembers("owner")).toBe(true);
	});

	test("administering the workspace itself is the owner alone", () => {
		expect(canAdministerWorkspace("member")).toBe(false);
		expect(canAdministerWorkspace("admin")).toBe(false);
		expect(canAdministerWorkspace("owner")).toBe(true);
	});

	test("no membership is the withholding answer to every one of them", () => {
		// The value every stranger, every participant and every anonymous caller
		// resolves to. Not one of the five may pass on it.
		for (const predicate of [
			canReadWorkspace,
			canCreateWorkspaceDecks,
			canAdministerWorkspaceDecks,
			canManageWorkspaceMembers,
			canAdministerWorkspace,
		]) {
			expect(predicate(null)).toBe(false);
		}
	});
});

describe("workspaceDeckAccessLevel — the bridge to the deck model (REQ128)", () => {
	test("every role reads and runs the workspace's decks", () => {
		for (const role of WORKSPACE_ROLES) {
			const level = workspaceDeckAccessLevel(role);
			expect(level).toBe("edit");
			// The point of the bridge: a workspace deck is decided by the same two
			// predicates a shared deck is, rather than by a second gate that could
			// disagree with them.
			expect(canMutateDeck(level)).toBe(true);
			expect(canReadDeckAuthoring(level)).toBe(true);
		}
	});

	test("no membership resolves to no standing at all", () => {
		expect(workspaceDeckAccessLevel(null)).toBeNull();
		expect(canMutateDeck(workspaceDeckAccessLevel(null))).toBe(false);
		expect(canReadDeckAuthoring(workspaceDeckAccessLevel(null))).toBe(false);
	});

	test("whatever it answers is a level the deck model has a word for", () => {
		for (const role of WORKSPACE_ROLES) {
			const level = workspaceDeckAccessLevel(role);
			expect(level === null || DECK_ACCESS_LEVELS.includes(level)).toBe(true);
		}
	});
});

describe("canGrandfatherLegacyDeck — a workspace deck is not a pre-auth deck", () => {
	test("a deck with no owner and no token hash is grandfathered", () => {
		expect(
			canGrandfatherLegacyDeck({
				creatorId: null,
				creatorTokenHash: null,
				workspaceId: null,
			}),
		).toBe(true);
	});

	test("a workspace deck is not, and that is the whole point", () => {
		// It has neither credential *by construction* (REQ128), so without this the
		// legacy path would hand `edit` to anyone who could type the deck's id.
		expect(
			canGrandfatherLegacyDeck({
				creatorId: null,
				creatorTokenHash: null,
				workspaceId: "w1",
			}),
		).toBe(false);
	});

	test("an owned deck and a tokened deck are never grandfathered either", () => {
		expect(
			canGrandfatherLegacyDeck({
				creatorId: "u1",
				creatorTokenHash: null,
				workspaceId: null,
			}),
		).toBe(false);
		expect(
			canGrandfatherLegacyDeck({
				creatorId: null,
				creatorTokenHash: "hash",
				workspaceId: null,
			}),
		).toBe(false);
	});
});

describe("strongestDeckAccessLevel — two standings on one deck", () => {
	test("nothing at all is no standing", () => {
		expect(strongestDeckAccessLevel([])).toBeNull();
		expect(strongestDeckAccessLevel([null, null])).toBeNull();
	});

	test("one standing reads as itself", () => {
		for (const level of DECK_ACCESS_LEVELS) {
			expect(strongestDeckAccessLevel([level, null])).toBe(level);
			expect(strongestDeckAccessLevel([null, level])).toBe(level);
		}
	});

	test("a weaker standing never takes a stronger one away", () => {
		// The failure it exists to prevent: a workspace member who was *also* given
		// a `view` grant on one of the workspace's decks is not thereby demoted on a
		// deck their own workspace owns.
		expect(strongestDeckAccessLevel(["view", "edit"])).toBe("edit");
		expect(strongestDeckAccessLevel(["edit", "comment"])).toBe("edit");
		expect(strongestDeckAccessLevel(["view", "comment"])).toBe("comment");
	});

	test("it is the opposite of how duplicate rows of one standing are read", () => {
		// `weakestDeckAccessLevel` folds two rows of the *same* standing, where a
		// row the owner cannot see must only ever take access away; this folds two
		// *different* standings, where each is a reason to be on the deck in its own
		// right. Different questions, answered in opposite directions on purpose.
		expect(strongestDeckAccessLevel(["view", "edit"])).toBe("edit");
		expect(weakestDeckAccessLevel(["view", "edit"])).toBe("view");
	});
});

describe("weakestWorkspaceRole — reading a pair that somehow has two memberships", () => {
	test("no roles at all is no membership", () => {
		expect(weakestWorkspaceRole([])).toBeNull();
	});

	test("one role reads as itself", () => {
		for (const role of WORKSPACE_ROLES) {
			expect(weakestWorkspaceRole([role])).toBe(role);
		}
	});

	test("a stale duplicate can only ever take authority away", () => {
		expect(weakestWorkspaceRole(["owner", "member"])).toBe("member");
		expect(weakestWorkspaceRole(["member", "owner"])).toBe("member");
		expect(weakestWorkspaceRole(["owner", "admin"])).toBe("admin");
		expect(weakestWorkspaceRole(["owner", "owner"])).toBe("owner");
	});
});

describe("the stored shapes", () => {
	test("a membership's identity pair has no default and fails loudly", () => {
		expect(() =>
			StoredWorkspaceMemberSchema.parse({ id: "m1", userId: "u1" }),
		).toThrow();
		expect(() =>
			StoredWorkspaceMemberSchema.parse({ id: "m1", workspaceId: "w1" }),
		).toThrow();
	});

	test("a membership written before a field existed re-parses forward", () => {
		const member = StoredWorkspaceMemberSchema.parse({
			id: "m1",
			workspaceId: "w1",
			userId: "u1",
		});
		// The weakest role is what an unstated one means — a membership must not
		// acquire the authority to delete the workspace by being old.
		expect(member.role).toBe("member");
		expect(member.invitedBy).toBeNull();
		expect(member.createdAt).toBe("");
		expect(member.updatedAt).toBe("");
	});

	test("a role outside the vocabulary is refused, not coerced", () => {
		expect(() =>
			StoredWorkspaceMemberSchema.parse({
				id: "m1",
				workspaceId: "w1",
				userId: "u1",
				role: "superuser",
			}),
		).toThrow();
	});

	test("a workspace needs an id and nothing else", () => {
		const workspace = StoredWorkspaceSchema.parse({ id: "w1" });
		expect(workspace.name).toBe("");
		expect(workspace.createdBy).toBeNull();
		expect(() => StoredWorkspaceSchema.parse({})).toThrow();
	});

	test("a deck written before workspaces existed re-parses as an account's", () => {
		const deck = StoredPresentationSchema.parse({ id: "p1" });
		expect(deck.workspaceId).toBeNull();
	});

	test("the workspace a deck belongs to is unwritable by a request body", () => {
		// It names no secret, and it is a credential all the same: the caller's own
		// standing on a workspace deck is resolved from their role in the workspace
		// it names, so writing it is writing the question their authorization is the
		// answer to.
		expect(UNWRITABLE_PRESENTATION_FIELDS).toContain("workspaceId");
	});
});

describe("the wire shapes", () => {
	test("a workspace carries the caller's role and no account identifier", () => {
		const wire = WorkspaceSchema.parse({
			id: "w1",
			name: "Team",
			createdBy: "u0",
			role: "admin",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(wire).not.toHaveProperty("createdBy");
		expect(wire.role).toBe("admin");
	});

	test("a workspace read with no standing says so rather than dropping the key", () => {
		const wire = WorkspaceSchema.parse({ id: "w1" });
		expect(wire.role).toBeNull();
		expect(wire.name).toBe("");
	});

	test("a member carries no account identifier, by construction", () => {
		const wire = WorkspaceMemberSchema.parse({
			id: "m1",
			workspaceId: "w1",
			userId: "u1",
			invitedBy: "u0",
			email: "other@example.com",
			name: "Other",
			role: "owner",
			mine: false,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(wire).not.toHaveProperty("userId");
		expect(wire).not.toHaveProperty("workspaceId");
		expect(wire).not.toHaveProperty("invitedBy");
		expect(wire.email).toBe("other@example.com");
	});

	test("a member whose email is withheld keeps the key", () => {
		const wire = WorkspaceMemberSchema.parse({ id: "m1", name: "Other" });
		expect(wire.email).toBeNull();
		expect(wire.role).toBe("member");
		expect(wire.mine).toBe(false);
	});

	test("a deck reports the workspace that owns it, and never its owner", () => {
		const wire = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: "2026-01-01T00:00:00.000Z",
			creatorId: null,
			creatorTokenHash: "hash",
			workspaceId: "w1",
		});
		expect(wire.workspaceId).toBe("w1");
		expect(wire).not.toHaveProperty("creatorId");
		expect(wire).not.toHaveProperty("creatorTokenHash");
	});
});

describe("the request bodies", () => {
	test("an add that states no role grants the weakest one", () => {
		expect(
			AddWorkspaceMemberSchema.parse({ email: "other@example.com" }).role,
		).toBe("member");
	});

	test("an add names an account by email, and only by a real one", () => {
		expect(
			AddWorkspaceMemberSchema.parse({ email: " other@example.com " }).email,
		).toBe("other@example.com");
		expect(() =>
			AddWorkspaceMemberSchema.parse({ email: "not-an-address" }),
		).toThrow();
		expect(() => AddWorkspaceMemberSchema.parse({})).toThrow();
	});

	test("a role change with no role is malformed, not a demotion", () => {
		expect(() => WorkspaceRoleBodySchema.parse({})).toThrow();
		expect(WorkspaceRoleBodySchema.parse({ role: "admin" }).role).toBe("admin");
	});

	test("a workspace needs a name, trimmed and bounded", () => {
		expect(CreateWorkspaceSchema.parse({ name: "  Team  " }).name).toBe("Team");
		expect(() => CreateWorkspaceSchema.parse({ name: "   " })).toThrow();
		expect(() =>
			CreateWorkspaceSchema.parse({
				name: "x".repeat(WORKSPACE_NAME_MAX_LENGTH + 1),
			}),
		).toThrow();
		expect(() => RenameWorkspaceSchema.parse({})).toThrow();
	});

	test("a move states where the deck goes, `null` included", () => {
		// `null` is a real value here — "out of the workspace, into my account" —
		// so it is nullable rather than optional, and a body that omits the key is
		// a request that did not say.
		expect(DeckWorkspaceSchema.parse({ workspaceId: null }).workspaceId).toBeNull();
		expect(DeckWorkspaceSchema.parse({ workspaceId: "w1" }).workspaceId).toBe("w1");
		expect(() => DeckWorkspaceSchema.parse({})).toThrow();
	});
});
