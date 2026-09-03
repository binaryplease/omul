/**
 * Unit tests for the workspace surface's client half (REQ128, REQ129).
 *
 * Four pure pieces, no DOM and no server:
 *
 *   - the role descriptor — one entry per role the API accepts, in the same
 *     order, because a picker that offered a fourth or dropped one would be
 *     offering a role the server has no word for;
 *   - `workspaceRoleLabel` / `workspaceRoleSummary` — composed by the roster's
 *     picker, by the badge on a workspace card and by the line under the "Add
 *     somebody" control, which is the whole reason they are functions rather
 *     than three literals;
 *   - `assignableWorkspaceRoles` — which roles a caller may hand out, so the
 *     picker never draws a choice the server answers `403` to;
 *   - `workspaceMemberDisplayName` — how a row is named when the account behind
 *     the membership has no display name, when its address is withheld from this
 *     reader, and when it no longer exists at all.
 *
 * What a role actually *buys* is a claim about the server and is tested there,
 * over HTTP, in `server/workspaces.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	assignableWorkspaceRoles,
	workspaceMemberDisplayName,
	workspaceRoleLabel,
	workspaceRoleSummary,
	WORKSPACE_ROLE_DESCRIPTORS,
} from "./components/WorkspaceRoles";
import { canCreateWorkspaceDecks, WORKSPACE_ROLES } from "./types";

describe("the role descriptor", () => {
	test("offers exactly the roles the API accepts, in the same order", () => {
		expect(WORKSPACE_ROLE_DESCRIPTORS.map((entry) => entry.role)).toEqual([
			...WORKSPACE_ROLES,
		]);
	});

	test("every role is named and explained", () => {
		for (const role of WORKSPACE_ROLES) {
			expect(workspaceRoleLabel(role).length).toBeGreaterThan(0);
			expect(workspaceRoleSummary(role).length).toBeGreaterThan(0);
		}
	});

	test("each summary says what the role cannot do, not only what it can", () => {
		// A role is a promise to somebody, so the two limits that actually bite —
		// a member cannot delete a deck, an admin cannot rename the workspace — are
		// stated where the role is chosen rather than discovered from a refusal.
		expect(workspaceRoleSummary("member")).toContain("Cannot");
		expect(workspaceRoleSummary("admin")).toContain("members");
		expect(workspaceRoleSummary("owner")).toContain("delet");
	});

	test("no membership at all reads as no access, never as a blank", () => {
		expect(workspaceRoleLabel(null)).toBe("No access");
		expect(workspaceRoleSummary(null).length).toBeGreaterThan(0);
	});
});

describe("which roles a caller may hand out", () => {
	test("an owner may hand out every role there is", () => {
		expect(assignableWorkspaceRoles("owner")).toEqual([...WORKSPACE_ROLES]);
	});

	test("an admin may hand out everything but the owner role", () => {
		// The server refuses an admin who tries (REQ129), so offering it here would
		// draw a choice guaranteed to answer 403.
		expect(assignableWorkspaceRoles("admin")).not.toContain("owner");
		expect(assignableWorkspaceRoles("admin")).toContain("member");
	});

	test("somebody who cannot manage the roster hands out nothing", () => {
		expect(assignableWorkspaceRoles("member")).not.toContain("owner");
		expect(assignableWorkspaceRoles(null)).toEqual([]);
	});

	test("every role it offers is one the vocabulary has", () => {
		for (const callerRole of [...WORKSPACE_ROLES, null]) {
			for (const role of assignableWorkspaceRoles(callerRole)) {
				expect(WORKSPACE_ROLES).toContain(role);
			}
		}
	});
});

describe("how a member is named", () => {
	test("the display name wins, the address stands in for it", () => {
		expect(
			workspaceMemberDisplayName({ email: "a@example.com", name: "Ada" }),
		).toBe("Ada");
		expect(
			workspaceMemberDisplayName({ email: "a@example.com", name: null }),
		).toBe("a@example.com");
		expect(
			workspaceMemberDisplayName({ email: "a@example.com", name: "  " }),
		).toBe("a@example.com");
	});

	test("a withheld address still leaves a name to draw", () => {
		// What an ordinary member is sent: the roster names people, and only a
		// reader who may manage it is told their addresses.
		expect(workspaceMemberDisplayName({ email: null, name: "Ada" })).toBe("Ada");
	});

	test("a membership that outlived its account is said so, not left blank", () => {
		// The row still has to be visible: it is a standing an admin may want to
		// remove, and an empty row is one they cannot see to remove.
		expect(workspaceMemberDisplayName({ email: null, name: null })).toBe(
			"Account no longer exists",
		);
	});
});

describe("what the client gates its controls on", () => {
	test("the capability predicates are the server's own, not a second opinion", () => {
		// Composed rather than restated: what a surface enables is
		// exactly what the route behind it authorizes, so a role that stops being
		// allowed to create decks stops drawing the button on the same day.
		for (const role of WORKSPACE_ROLES) {
			expect(canCreateWorkspaceDecks(role)).toBe(true);
		}
		expect(canCreateWorkspaceDecks(null)).toBe(false);
	});
});
