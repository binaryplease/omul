import type { WorkspaceMember, WorkspaceRole } from "../types";
import { WORKSPACE_ROLES } from "../types";

// ── What a workspace role means, in words (REQ129) ────────────
//
// One descriptor (ADR-0026), composed by the role picker on the roster, by the
// badge on a workspace card and by the line under the "Add somebody" control —
// three surfaces that would otherwise each acquire their own idea of what
// `admin` is allowed to do, and drift apart the first time the server's answer
// changed.
//
// Emphatically **not** where the roles are enforced. That is the server, on
// every workspace-scoped mutation, and it holds whether any of this was ever
// drawn (see `server/routes/workspaces.ts` and
// `server/workspaces.integration.test.ts`). What lives here is the promise a
// person is making when they pick one out of a `<select>`, which is why each
// summary says what the role can do *and* what it cannot.

/**
 * The roles as a person reads them, weakest first — the same order and the same
 * set the API accepts, because a picker that offered a fourth or dropped one
 * would be offering a role the server has no word for.
 */
export const WORKSPACE_ROLE_DESCRIPTORS: readonly {
	role: WorkspaceRole;
	label: string;
	summary: string;
}[] = [
	{
		role: "member",
		label: "Member",
		summary:
			"Opens, edits and presents every deck the workspace owns, and creates new ones in it. Cannot delete a deck, change who is in the workspace, or rename it.",
	},
	{
		role: "admin",
		label: "Admin",
		summary:
			"Everything a member can do, plus deleting the workspace's decks, deciding who else those decks are shared with, and adding or removing members.",
	},
	{
		role: "owner",
		label: "Owner",
		summary:
			"Everything an admin can do, plus renaming and deleting the workspace, making somebody else an owner, and moving a deck back out into a personal account.",
	},
];

/** How a role is named on screen. Falls back to the raw value, never to "". */
export function workspaceRoleLabel(role: WorkspaceRole | null): string {
	if (!role) return "No access";
	return (
		WORKSPACE_ROLE_DESCRIPTORS.find((descriptor) => descriptor.role === role)
			?.label ?? role
	);
}

/** What a role grants, in one sentence, for the picker's helper line. */
export function workspaceRoleSummary(role: WorkspaceRole | null): string {
	if (!role) return "You are not in this workspace.";
	return (
		WORKSPACE_ROLE_DESCRIPTORS.find((descriptor) => descriptor.role === role)
			?.summary ?? ""
	);
}

/**
 * How one member is named on the roster: their display name where the account
 * has one, otherwise the address they were added at — which a reader who cannot
 * manage the roster is not sent (the server withholds it, so it reads `null`).
 *
 * An account that has since been deleted comes back with neither and is said so
 * rather than rendered as a blank row, so an admin can see the membership they
 * still have to remove.
 */
export function workspaceMemberDisplayName(
	member: Pick<WorkspaceMember, "email" | "name">,
): string {
	if (member.name?.trim()) return member.name.trim();
	if (member.email?.trim()) return member.email.trim();
	return "Account no longer exists";
}

/**
 * The roles this caller may hand out, given their own.
 *
 * The server refuses an admin who tries to make somebody an owner (REQ129), so a
 * picker offering it would be drawing a choice that answers `403`. Not
 * hard-coded to "everything below mine": the set is derived from the same
 * ordered vocabulary the server validates against, so REQ131's reduced role
 * appears here the day it exists without this function being edited.
 */
export function assignableWorkspaceRoles(
	callerRole: WorkspaceRole | null,
): WorkspaceRole[] {
	if (!callerRole) return [];
	if (callerRole === "owner") return [...WORKSPACE_ROLES];
	return WORKSPACE_ROLES.filter((role) => role !== "owner");
}
