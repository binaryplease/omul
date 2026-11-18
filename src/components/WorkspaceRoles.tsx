import { ENGLISH_INTERFACE_TEXT, type InterfaceText } from "../interface-text";
import type { WorkspaceMember, WorkspaceRole } from "../types";
import { WORKSPACE_ROLES } from "../types";

// ── What a workspace role means, in words (REQ129) ────────────
//
// One descriptor, composed by the role picker on the roster, by the
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
 * would be offering a role the server has no word for. Their words are the
 * interface language's (REQ248), in `src/interface-text/workspaces.ts`.
 */
export const WORKSPACE_ROLE_DESCRIPTORS: readonly { role: WorkspaceRole }[] =
	WORKSPACE_ROLES.map((role) => ({ role }));

/** How a role is named on screen. Falls back to the raw value, never to "". */
export function workspaceRoleLabel(
	role: WorkspaceRole | null,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	if (!role) return text.workspaces.noAccess;
	return text.workspaces.roles[role]?.label ?? role;
}

/** How a role is named inside a sentence: "You are member here." */
export function workspaceRoleInSentence(
	role: WorkspaceRole | null,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	if (!role) return text.workspaces.noAccess;
	return text.workspaces.roles[role]?.inSentence ?? role;
}

/** What a role grants, in one sentence, for the picker's helper line. */
export function workspaceRoleSummary(
	role: WorkspaceRole | null,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	if (!role) return text.workspaces.notInWorkspace;
	return text.workspaces.roles[role]?.summary ?? "";
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
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	if (member.name?.trim()) return member.name.trim();
	if (member.email?.trim()) return member.email.trim();
	return text.workspaces.accountGone;
}

/**
 * The roles this caller may hand out, given their own.
 *
 * The server refuses an admin who tries to make somebody an owner (REQ129), so a
 * picker offering it would be drawing a choice that answers `403`. Not
 * hard-coded to "everything below mine": the set is derived from the same
 * ordered vocabulary the server validates against, which is how REQ131's
 * `commenter` appeared here without this function being edited.
 */
export function assignableWorkspaceRoles(
	callerRole: WorkspaceRole | null,
): WorkspaceRole[] {
	if (!callerRole) return [];
	if (callerRole === "owner") return [...WORKSPACE_ROLES];
	return WORKSPACE_ROLES.filter((role) => role !== "owner");
}
