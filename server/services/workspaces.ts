/**
 * Workspaces — an owner of decks that is not an account, and the roles the
 * accounts in it hold (REQ128, REQ129).
 *
 * A module of its own rather than a section of `services/presentations.ts`,
 * on exactly the terms `services/collaborators.ts` beside it is: it
 * owns its two collections, its vocabulary and its failure set, and it would keep
 * working unchanged if the presentation service were rewritten around it. The
 * dependency runs one way on purpose — **nothing here imports the presentation
 * service** — so the presentation service is free to import this one and ask
 * "what may this account do with a deck this workspace owns?" without a cycle.
 * Which decks a workspace owns is a question about the `presentations`
 * collection, and it is answered there.
 *
 * Factory-free, like both of its neighbours: these are functions over two
 * module-level collections, not a service instance somebody constructs.
 *
 * What this module deliberately does not do: email an invitation, create an
 * account for an address that has none, or hold a workspace's settings, theme,
 * usage or seats. The first two are the same refusal
 * `services/collaborators.ts` makes — a membership names a registered account,
 * resolved by the route from the email its owner typed — and the rest are their
 * own pending requirements. The templates a workspace publishes (REQ004) are
 * `services/workspace-templates.ts`'s, a collection with its own module for the
 * reason this one has its own: the only thing it needs of a workspace is the id.
 * The single line of it that reaches in here is the sweep {@link deleteWorkspace}
 * owes — a deleted workspace takes its published templates with it, the way it
 * takes its memberships.
 */

import { createStore } from "../db";
import {
	canAdministerWorkspace,
	DEFAULT_WORKSPACE_ROLE,
	StoredWorkspaceMemberSchema,
	StoredWorkspaceSchema,
	WORKSPACE_ROLES,
	type WorkspaceRole,
} from "../schemas";
import { deleteWorkspaceTemplates } from "./workspace-templates";

const workspaces = createStore("workspaces", StoredWorkspaceSchema, {
	indexes: ["createdBy"],
});

// Indexed on both ends of the membership, because both are read — and the second
// is read constantly: "who is in this workspace?" is the roster screen, while
// "what is this account's role here?" runs on every request that touches one of
// the workspace's decks.
//
// The pair is **unique**, and that is a correctness constraint rather than a
// tuning one, for the reason the deck-grant index is: "one row per (workspace,
// account)" is this module's whole invariant, and a check-then-insert cannot hold
// it under a race. The loser of that race loses at the storage layer instead,
// where it can be turned into the role change it was always going to be (see
// {@link addWorkspaceMember}).
const members = createStore("workspaceMembers", StoredWorkspaceMemberSchema, {
	indexes: [
		"workspaceId",
		"userId",
		{ fields: ["workspaceId", "userId"], unique: true },
	],
});

/** One stored workspace, as every function here hands it back. */
export type WorkspaceRecord = {
	id: string;
	name: string;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
};

/** One stored membership, as every function here hands it back. */
export type WorkspaceMemberRecord = {
	id: string;
	workspaceId: string;
	userId: string;
	role: WorkspaceRole;
	invitedBy: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Project a stored workspace row into the record shape, every key present. */
function readWorkspace(row: Record<string, unknown>): WorkspaceRecord {
	return {
		id: row.id as string,
		name: (row.name as string | undefined) ?? "",
		createdBy: (row.createdBy as string | null) ?? null,
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/** Project a stored membership row into the record shape, every key present. */
function readMember(row: Record<string, unknown>): WorkspaceMemberRecord {
	return {
		id: row.id as string,
		workspaceId: row.workspaceId as string,
		userId: row.userId as string,
		role: (row.role as WorkspaceRole | undefined) ?? DEFAULT_WORKSPACE_ROLE,
		invitedBy: (row.invitedBy as string | null) ?? null,
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/**
 * The **weakest** of the roles given, or `null` when there are none.
 *
 * The same reading `weakestDeckAccessLevel` takes of duplicate grants, and it is
 * reached in the same place: where more than one row somehow names the same
 * (workspace, account) pair, which the unique index makes impossible going
 * forward but which a row written before it existed could still be. Weakest,
 * because those are the two ways this fails *open* — the harm a duplicate does is
 * that an admin demotes the row they can see while the member keeps the role on
 * the row they cannot.
 */
export function weakestWorkspaceRole(
	roles: readonly WorkspaceRole[],
): WorkspaceRole | null {
	let weakest: WorkspaceRole | null = null;
	for (const role of roles) {
		if (
			weakest === null ||
			WORKSPACE_ROLES.indexOf(role) < WORKSPACE_ROLES.indexOf(weakest)
		) {
			weakest = role;
		}
	}
	return weakest;
}

/**
 * Create a workspace and the membership that owns it, in that order.
 *
 * The two writes are one act: a workspace with no owner is a workspace nobody can
 * rename, add to or delete — an orphan the API has no route to reach. Ordered
 * this way because the failure is survivable in one direction only: a workspace
 * whose membership write never landed is invisible to `listWorkspacesForUser` and
 * costs one row, while a membership pointing at a workspace that was never
 * written would be a role in nothing.
 */
export async function createWorkspace(
	name: string,
	ownerUserId: string,
): Promise<WorkspaceRecord> {
	const now = new Date().toISOString();
	const workspace = await workspaces.insert({
		name,
		createdBy: ownerUserId,
		createdAt: now,
		updatedAt: now,
	});
	await members.insert({
		workspaceId: workspace.id as string,
		userId: ownerUserId,
		role: "owner",
		invitedBy: null,
		createdAt: now,
		updatedAt: now,
	});
	return readWorkspace(workspace);
}

/** One workspace by its id, or `null`. */
export async function getWorkspace(
	workspaceId: string,
): Promise<WorkspaceRecord | null> {
	if (!workspaceId) return null;
	const row = await workspaces.findOne(workspaceId);
	return row ? readWorkspace(row) : null;
}

/**
 * This account's role in this workspace, or `null` when it has none.
 *
 * The single read the authorization path makes, and the reason it
 * returns `null` rather than throwing on an unknown workspace: "not a member" and
 * "no such workspace" are the same answer to the only question being asked, and a
 * caller with no standing must not be able to tell them apart.
 */
export async function workspaceRoleFor(
	workspaceId: string,
	userId: string,
): Promise<WorkspaceRole | null> {
	if (!workspaceId || !userId) return null;
	const rows = await members.find({ workspaceId, userId });
	return weakestWorkspaceRole(rows.map((row) => readMember(row).role));
}

/**
 * Every workspace this account is in, with the role it holds there — newest
 * membership first, the order somebody meets an invitation in.
 *
 * A membership whose workspace has since been deleted is dropped rather than
 * reported as a hole, exactly as a grant on a deleted deck is: the delete sweeps
 * its memberships, so a dangling one means the two writes were interrupted, and
 * the honest reading of "which workspaces am I in?" is the ones that still exist.
 */
export async function listWorkspacesForUser(
	userId: string,
): Promise<{ workspace: WorkspaceRecord; role: WorkspaceRole }[]> {
	if (!userId) return [];
	const rows = (await members.find({ userId }))
		.map(readMember)
		.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
	const resolved = await Promise.all(
		rows.map(async (membership) => {
			const workspace = await getWorkspace(membership.workspaceId);
			return workspace ? { workspace, role: membership.role } : null;
		}),
	);
	return resolved.filter((entry) => entry !== null);
}

/** Every membership of one workspace, oldest first — the order it was built in. */
export async function listWorkspaceMembers(
	workspaceId: string,
): Promise<WorkspaceMemberRecord[]> {
	const rows = await members.find({ workspaceId });
	return rows
		.map(readMember)
		.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/** One membership by its own id, scoped to its workspace, or `null`. */
export async function getWorkspaceMember(
	workspaceId: string,
	memberId: string,
): Promise<WorkspaceMemberRecord | null> {
	const row = await members.findOne(memberId);
	if (!row || row.workspaceId !== workspaceId) return null;
	return readMember(row);
}

/** Rename a workspace. `null` when it is gone. */
export async function renameWorkspace(
	workspaceId: string,
	name: string,
): Promise<WorkspaceRecord | null> {
	const updated = await workspaces.update(workspaceId, {
		name,
		updatedAt: new Date().toISOString(),
	});
	return updated ? readWorkspace(updated) : null;
}

/**
 * Delete a workspace, every membership of it, and every template it published
 * (REQ004).
 *
 * The two dependent collections go **first**, on the reading `deletePresentation`
 * takes of the room's records: a row naming a workspace that no longer exists is
 * one no route resolves and no screen draws, and dying between the writes has to
 * leave the recoverable state rather than the permanent one. Whether the
 * workspace still owns decks is not asked here — that is a question about another
 * collection, and the route refuses the delete before reaching this. A published
 * template is *not* a deck and does not stand in the way of the delete: it is a
 * copy the workspace made of itself, and the decks made from it are ordinary
 * decks that outlive both.
 */
export async function deleteWorkspace(workspaceId: string): Promise<boolean> {
	await members.deleteMany({ workspaceId });
	await deleteWorkspaceTemplates(workspaceId);
	return workspaces.remove(workspaceId);
}

/**
 * Add an account to a workspace at a role, or change the role of a membership
 * that already exists — one row per (workspace, account) pair, so re-adding is a
 * change rather than a second standing beside the first.
 *
 * Idempotent by construction, and idempotent under a *race* too, which the read
 * below cannot give on its own: two adds of the same pair in flight together both
 * find no row, and the unique index is what makes the second insert fail rather
 * than succeed. The failure is handled here as the role change the losing call
 * was always going to be if it had arrived a moment later.
 *
 * Reports which of the two happened so the route can answer `201` for a
 * membership that did not exist and `200` for one that did.
 */
export async function addWorkspaceMember(
	workspaceId: string,
	userId: string,
	role: WorkspaceRole,
	invitedBy: string | null,
): Promise<{ created: boolean; member: WorkspaceMemberRecord }> {
	const now = new Date().toISOString();
	const existing = (await members.find({ workspaceId, userId }))[0];
	if (existing) return changeMemberRole(existing, role, now);
	try {
		const inserted = await members.insert({
			workspaceId,
			userId,
			role,
			invitedBy,
			createdAt: now,
			updatedAt: now,
		});
		return { created: true, member: readMember(inserted) };
	} catch (insertError) {
		// The lost race, and only the lost race: a refusal with no row behind it is
		// some other failure and is re-thrown rather than swallowed into a
		// membership this function did not make.
		const raced = (await members.find({ workspaceId, userId }))[0];
		if (!raced) throw insertError;
		return changeMemberRole(raced, role, now);
	}
}

/**
 * Move an existing membership to `role`. A row that vanished between being read
 * and being written is a **throw**, not a fallback: reporting the old role as
 * though the change had applied would tell an admin they demoted somebody who
 * still holds what they had (fail loudly rather than quietly wrong).
 */
async function changeMemberRole(
	existing: Record<string, unknown>,
	role: WorkspaceRole,
	updatedAt: string,
): Promise<{ created: false; member: WorkspaceMemberRecord }> {
	const id = existing.id as string;
	const updated = await members.update(id, { role, updatedAt });
	if (!updated) {
		throw new Error(`addWorkspaceMember: membership ${id} disappeared mid-change`);
	}
	return { created: false, member: readMember(updated) };
}

/**
 * What a change to the roster did, or why it did nothing — a stated vocabulary
 * rather than a boolean, because two of the four outcomes are refusals a caller
 * has to be able to tell apart and say out loud.
 */
export type RosterChange =
	| { status: "not-found" }
	/** The change would leave the workspace with no `owner` — see below. */
	| { status: "last-owner" }
	| { status: "changed"; member: WorkspaceMemberRecord }
	| { status: "removed"; member: WorkspaceMemberRecord };

/**
 * How many accounts hold the role that can administer this workspace.
 *
 * The count exists for one invariant: **a workspace always has at least one
 * owner**. Nothing else in the model can restore one — the routes that hand out
 * the role are themselves owner-gated — so a workspace that lost its last owner
 * could never be renamed, added to or deleted again, and its decks could never be
 * moved back out. Both writes that could break it ask this first.
 */
export async function countWorkspaceOwners(
	workspaceId: string,
): Promise<number> {
	const roster = await listWorkspaceMembers(workspaceId);
	return roster.filter((member) => canAdministerWorkspace(member.role)).length;
}

/**
 * Change one membership's role, named by the membership's own id and scoped to
 * its workspace — a membership id that belongs to another workspace is
 * `not-found` here rather than a cross-workspace write.
 *
 * Refuses to demote the last owner. Who may *make* an owner is the route's
 * question, not this one's: it is about the caller, and nothing about the caller
 * reaches this module.
 */
export async function setWorkspaceMemberRole(
	workspaceId: string,
	memberId: string,
	role: WorkspaceRole,
): Promise<RosterChange> {
	const existing = await getWorkspaceMember(workspaceId, memberId);
	if (!existing) return { status: "not-found" };
	if (
		canAdministerWorkspace(existing.role) &&
		!canAdministerWorkspace(role) &&
		(await countWorkspaceOwners(workspaceId)) <= 1
	) {
		return { status: "last-owner" };
	}
	const updated = await members.update(memberId, {
		role,
		updatedAt: new Date().toISOString(),
	});
	if (!updated) return { status: "not-found" };
	return { status: "changed", member: readMember(updated) };
}

/**
 * Remove one membership, named by its own id and scoped to its workspace for the
 * reason {@link setWorkspaceMemberRole} is.
 *
 * Immediate: the standing *is* the row, so removing it is the whole of the
 * removal — there is nothing cached, nothing issued and nothing to expire, and
 * the workspace's decks are untouched, which is REQ128's point. Refuses to remove
 * the last owner.
 */
export async function removeWorkspaceMember(
	workspaceId: string,
	memberId: string,
): Promise<RosterChange> {
	const existing = await getWorkspaceMember(workspaceId, memberId);
	if (!existing) return { status: "not-found" };
	if (
		canAdministerWorkspace(existing.role) &&
		(await countWorkspaceOwners(workspaceId)) <= 1
	) {
		return { status: "last-owner" };
	}
	const removed = await members.remove(memberId);
	if (!removed) return { status: "not-found" };
	return { status: "removed", member: existing };
}
