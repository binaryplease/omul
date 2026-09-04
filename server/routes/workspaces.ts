/**
 * The workspace surface (REQ128, REQ129, REQ004) — `/api/workspaces/*`.
 *
 * A route module of its own rather than a section of `routes/presentations.ts`:
 * a workspace is not a presentation, it would still make sense if
 * decks were rewritten around it, and the two places the two meet — the decks a
 * workspace owns, and the deck a template is published from — are reads of the
 * presentation service through the projection that file already exports.
 *
 * The templates a workspace publishes (REQ004) live here rather than beside the
 * built-in catalog in `routes/templates.ts` for the same reason, and a sharper
 * one: the catalog's two routes are public and have nothing to authorize, while
 * every one of these is decided against the caller's role in *this* workspace.
 * Using a published entry is the exception and is a **create**, so it lives with
 * the other presentation routes where its rate limit already is — exactly where
 * starting from a built-in entry lives.
 *
 * Every route here answers one of two questions, and they are deliberately never
 * mixed: *is this caller in this workspace at all* (which decides `401` vs `403`
 * and leaks no existence), and *does their role authorize this* (REQ129, decided
 * by the predicates in `schemas.ts` and never by comparing role strings here).
 * {@link requireWorkspaceRole} is where both are asked, so a route added later
 * cannot answer the first and forget the second.
 */

import { Elysia } from "elysia";
import { findUserByEmail, findUserById, resolveUserId } from "../accounts";
import { guardSubmission } from "../rate-limit";
import {
	AddWorkspaceMemberSchema,
	canAdministerWorkspace,
	canCreateWorkspaceDecks,
	canManageWorkspaceMembers,
	canPublishWorkspaceTemplates,
	canReadDeckAuthoring,
	canReadWorkspace,
	CreateWorkspaceSchema,
	PublishWorkspaceTemplateSchema,
	RenameWorkspaceSchema,
	type Slide,
	type Workspace,
	type WorkspaceMember,
	WorkspaceMemberSchema,
	WorkspaceRoleBodySchema,
	type WorkspaceRole,
	WorkspaceSchema,
	type WorkspaceTemplate,
	WorkspaceTemplateSchema,
	workspaceDeckAccessLevel,
} from "../schemas";
import {
	getPresentation,
	listWorkspacePresentations,
} from "../services/presentations";
import {
	listWorkspaceTemplates,
	publishWorkspaceTemplate,
	unpublishWorkspaceTemplate,
	type WorkspaceTemplateRecord,
} from "../services/workspace-templates";
import {
	addWorkspaceMember,
	createWorkspace,
	deleteWorkspace,
	getWorkspace,
	getWorkspaceMember,
	listWorkspaceMembers,
	listWorkspacesForUser,
	removeWorkspaceMember,
	renameWorkspace,
	setWorkspaceMemberRole,
	type WorkspaceMemberRecord,
	type WorkspaceRecord,
	workspaceRoleFor,
} from "../services/workspaces";
import { sanitize } from "./presentations";

// ── Helpers ──────────────────────────────────────────────────

/** A JSON error Response with the given status. */
function jsonError(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Project one stored workspace into the shape a member reads, with the caller's
 * own role on it.
 *
 * Built key by key and parsed through {@link WorkspaceSchema}, the construction
 * that keeps `creatorId` off a deck: `createdBy` is an account identifier, the
 * schema does not declare it, and Zod strips what a schema does not declare — so
 * it cannot reach a client by being spread into an object here.
 */
function readWorkspace(
	workspace: WorkspaceRecord,
	role: WorkspaceRole | null,
): Workspace {
	return WorkspaceSchema.parse({
		id: workspace.id,
		name: workspace.name,
		role,
		createdAt: workspace.createdAt,
		updatedAt: workspace.updatedAt,
	});
}

/**
 * Project one membership into the shape the roster shows.
 *
 * The account id it is stored under is turned into a contact and goes no further
 * — {@link WorkspaceMemberSchema} declares neither `userId` nor `workspaceId`.
 * The **email is withheld from a reader who cannot manage the roster**: a member
 * sees who they are working with by name, while the address somebody was invited
 * at is management data, and the narrower default is the one that ships (it is
 * emitted as an explicit `null` either way rather than dropped, so no client
 * learns a
 * second shape). An account that has since been deleted reads as a `null` name
 * rather than vanishing, so the membership stays visible to be removed.
 */
function readMember(
	member: WorkspaceMemberRecord,
	{ viewerId, canManage }: { viewerId: string; canManage: boolean },
): WorkspaceMember {
	const account = findUserById(member.userId);
	return WorkspaceMemberSchema.parse({
		id: member.id,
		email: canManage ? (account?.email ?? null) : null,
		name: account?.name ?? null,
		role: member.role,
		mine: member.userId === viewerId,
		createdAt: member.createdAt,
		updatedAt: member.updatedAt,
	});
}

/**
 * Project one published template into the shape a member reads (REQ004).
 *
 * Built key by key and parsed through {@link WorkspaceTemplateSchema}, the
 * construction that keeps `creatorId` off a deck and `userId` off a membership:
 * the account that published is stored as an id, the schema does not declare
 * one, and what a client is handed is a display name — `null` for an account
 * that has since been deleted, so the entry stays in the gallery to be used and
 * taken down rather than disappearing with the person who put it there.
 *
 * `workspaceId` is not declared either: a caller reading this list named the
 * workspace to get it.
 */
function readTemplate(template: WorkspaceTemplateRecord): WorkspaceTemplate {
	const account = template.publishedBy
		? findUserById(template.publishedBy)
		: null;
	return WorkspaceTemplateSchema.parse({
		id: template.id,
		title: template.title,
		description: template.description,
		category: template.category,
		tags: template.tags,
		slides: template.slides,
		sourcePresentationId: template.sourcePresentationId,
		publishedByName: account?.name ?? null,
		createdAt: template.createdAt,
		updatedAt: template.updatedAt,
	});
}

/** What a workspace route has proved about its caller before it runs. */
type WorkspaceStanding = {
	workspaceId: string;
	userId: string;
	role: WorkspaceRole;
};

/**
 * Require that the caller holds a role in this workspace that satisfies
 * `authorizes` — the one gate every route below runs.
 *
 * `401` when there is no account behind the request at all, `403` when there is
 * one whose role does not open this door. A workspace that **does not exist**
 * answers the same `403` as one the caller is not in, deliberately: "no such
 * workspace" and "not yours" are the same answer to the only question being
 * asked, and a caller with no standing must not be able to tell them apart by
 * probing ids.
 */
async function requireWorkspaceRole(
	request: Request,
	workspaceId: string,
	authorizes: (role: WorkspaceRole | null) => boolean,
	refusal: string,
): Promise<WorkspaceStanding | Response> {
	const userId = await resolveUserId(request.headers);
	if (!userId) return jsonError(401, "Sign in to use workspaces");
	const role = await workspaceRoleFor(workspaceId, userId);
	if (!authorizes(role) || role === null) return jsonError(403, refusal);
	return { workspaceId, userId, role };
}

/**
 * The workspace behind an id whose caller has already been authorized, or a
 * `404` Response.
 *
 * Reached only when a membership resolved and the workspace itself did not,
 * which is the interrupted-delete state `listWorkspacesForUser` drops silently.
 * Here the caller named this one, so it is answered rather than hidden.
 */
async function requireWorkspace(
	workspaceId: string,
): Promise<WorkspaceRecord | Response> {
	const workspace = await getWorkspace(workspaceId);
	if (!workspace) return jsonError(404, "Not found");
	return workspace;
}

// ── Routes ──────────────────────────────────────────────────

export const workspaceRoutes = new Elysia({ prefix: "/api" })
	// ── The workspaces this account is in ──────────────────
	.get(
		"/workspaces",
		async ({ request, set }) => {
			const userId = await resolveUserId(request.headers);
			if (!userId) {
				set.status = 401;
				return { error: "Sign in to list your workspaces" };
			}
			const memberships = await listWorkspacesForUser(userId);
			return memberships.map(({ workspace, role }) =>
				readWorkspace(workspace, role),
			);
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "List the workspaces the signed-in account is in",
				description:
					"Returns the workspaces the caller is a member of (REQ128), newest membership first, each carrying the `role` they hold there (REQ129) — `member`, `admin` or `owner`. Requires a cookie session or a personal API key (`x-api-key`); returns 401 otherwise. Scoped to the caller: it cannot enumerate workspaces they are not in, and it never reports who else is in one (that is `GET /workspaces/:id/members`). No account identifier is in this payload.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Create one ─────────────────────────────────────────
	.post(
		"/workspaces",
		async ({ body, request, set }) => {
			const userId = await resolveUserId(request.headers);
			if (!userId) {
				set.status = 401;
				return { error: "Sign in to create a workspace" };
			}
			const workspace = await createWorkspace(body.name, userId);
			set.status = 201;
			return readWorkspace(workspace, "owner");
		},
		{
			body: CreateWorkspaceSchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Create a workspace",
				description:
					"Creates a workspace and makes the caller its `owner` in the same act (REQ128/REQ129) — a workspace with no owner is one nobody could rename, add to or delete. Requires an account: a workspace is a shared owner of decks, and there is nothing anonymous for the founding membership to name. The workspace owns no decks yet; create them with `POST /api/presentations` naming `workspaceId`, or move an existing deck in with `POST /api/presentations/:id/workspace`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Read one ───────────────────────────────────────────
	.get(
		"/workspaces/:id",
		async ({ params, request }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canReadWorkspace,
				"You are not a member of this workspace",
			);
			if (standing instanceof Response) return standing;
			const workspace = await requireWorkspace(params.id);
			if (workspace instanceof Response) return workspace;
			return readWorkspace(workspace, standing.role);
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "Get one workspace",
				description:
					"Returns one workspace and the caller's own `role` in it (REQ129). Any member reads it. `401` without an account and `403` for an account that is not a member — which is also what a workspace id that does not exist answers, so the route cannot be used to probe for one.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Rename one ─────────────────────────────────────────
	.patch(
		"/workspaces/:id",
		async ({ params, body, request, set }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canAdministerWorkspace,
				"Only a workspace owner can rename it",
			);
			if (standing instanceof Response) return standing;
			const workspace = await renameWorkspace(params.id, body.name);
			if (!workspace) {
				set.status = 404;
				return { error: "Not found" };
			}
			return readWorkspace(workspace, standing.role);
		},
		{
			body: RenameWorkspaceSchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Rename a workspace",
				description:
					"Changes a workspace's name (REQ129 — authorized against the caller's role on the server, not in the UI). The `owner` role only: `403` for an admin and for an ordinary member alike. `name` is required and trimmed; a request that carries none is `422` rather than a workspace called nothing.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Delete one ─────────────────────────────────────────
	.delete(
		"/workspaces/:id",
		async ({ params, request, set }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canAdministerWorkspace,
				"Only a workspace owner can delete it",
			);
			if (standing instanceof Response) return standing;
			// A workspace is the *owner* of its decks (REQ128), so deleting one while
			// it still holds any would either take them with it or leave every one of
			// them owned by nothing — unreachable by every route and every screen, and
			// unclaimable by design. Refused instead: move the decks out or delete
			// them, then delete the workspace. Stated with the count, so the refusal
			// says what has to happen rather than only that something does.
			const decks = await listWorkspacePresentations(params.id);
			if (decks.length > 0) {
				set.status = 409;
				return {
					error: `This workspace still owns ${decks.length} deck${decks.length === 1 ? "" : "s"} — move or delete them first`,
					deckCount: decks.length,
				};
			}
			const removed = await deleteWorkspace(params.id);
			if (!removed) {
				set.status = 404;
				return { error: "Not found" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "Delete a workspace",
				description:
					"Deletes a workspace and every membership of it. The `owner` role only. Refused with `409` — and the count — while the workspace still owns decks (REQ128): it is their owner, so deleting it would leave each of them owned by nothing and reachable by nobody. Move them out (`POST /api/presentations/:id/workspace` with `workspaceId: null`) or delete them first. Deleting a workspace never deletes a deck.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── The roster ─────────────────────────────────────────
	.get(
		"/workspaces/:id/members",
		async ({ params, request }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canReadWorkspace,
				"You are not a member of this workspace",
			);
			if (standing instanceof Response) return standing;
			const roster = await listWorkspaceMembers(params.id);
			const canManage = canManageWorkspaceMembers(standing.role);
			return roster.map((member) =>
				readMember(member, { viewerId: standing.userId, canManage }),
			);
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "List a workspace's members",
				description:
					"Returns the accounts in the workspace (REQ129), oldest membership first: each entry's `id` (the membership's own handle, used to change or remove it), the member's display `name`, their `role`, whether the row is the caller's own (`mine`), and when the membership was made and last changed. **No account identifier is ever in this payload.** `email` is carried only for a reader whose role may manage the roster and is an explicit `null` otherwise — a member sees who they work with, while the address somebody was invited at is management data. Any member reads the list; `403` for an account that is not one.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Add somebody ───────────────────────────────────────
	.post(
		"/workspaces/:id/members",
		async ({ params, body, request, server, set }) => {
			// Budgeted before the lookup, because the lookup is the oracle: a `404`
			// here and a `201` there tell a caller whether an address has an omul
			// account. Exactly the reasoning `POST …/collaborators` is limited under
			// (REQ145), keyed by the workspace rather than by a participant, so
			// probing faster than that budget means holding more workspaces — and
			// still meets the per-client-address ceiling.
			const overLimit = guardSubmission(
				{ request, server },
				`workspace-members:${params.id}`,
			);
			if (overLimit) return overLimit;
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canManageWorkspaceMembers,
				"Only a workspace admin can add members",
			);
			if (standing instanceof Response) return standing;
			// Handing out the role that can delete the workspace, hand out that role
			// again, and take a deck back out of it is the owner's own act. An admin
			// who could do it could promote themselves through a second account.
			if (
				canAdministerWorkspace(body.role) &&
				!canAdministerWorkspace(standing.role)
			) {
				set.status = 403;
				return { error: "Only a workspace owner can add another owner" };
			}
			// A membership names a **registered account**, so an address with none is
			// a refusal rather than a pending invitation this slice cannot deliver.
			const target = findUserByEmail(body.email);
			if (!target) {
				set.status = 404;
				return { error: "No account is registered with that email" };
			}
			const { created, member } = await addWorkspaceMember(
				params.id,
				target.id,
				body.role,
				standing.userId,
			);
			set.status = created ? 201 : 200;
			return readMember(member, { viewerId: standing.userId, canManage: true });
		},
		{
			body: AddWorkspaceMemberSchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Add an account to the workspace",
				description:
					"Adds a registered account at a stated role (REQ129): `member`, `admin` or `owner`, defaulting to `member` when the body omits it — a request that does not say what it is granting must not grant the strongest thing there is. Idempotent per account: adding an address that is already a member **changes their role** rather than adding a second membership, and answers `200` instead of the `201` a new one gets. The account is named by its login email and never by an id, because a caller is never handed one. `404` when no account is registered with that address (this endpoint sends no invitations and creates no accounts). Requires `admin` or `owner`; granting `owner` requires `owner`. Rate-limited (REQ145) on the same two budgets the deck-sharing endpoint spends, and for the same reason: the `404`/`201` distinction reports whether an address has an account.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Change somebody's role ─────────────────────────────
	.patch(
		"/workspaces/:id/members/:memberId",
		async ({ params, body, request, set }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canManageWorkspaceMembers,
				"Only a workspace admin can change roles",
			);
			if (standing instanceof Response) return standing;
			const target = await getWorkspaceMember(params.id, params.memberId);
			if (!target) {
				set.status = 404;
				return { error: "No such member of this workspace" };
			}
			// Both ends of the change are the owner's: handing the role out, and
			// taking it off somebody who has it. An admin who could do the second
			// could remove every owner's authority and keep the workspace.
			if (
				(canAdministerWorkspace(body.role) ||
					canAdministerWorkspace(target.role)) &&
				!canAdministerWorkspace(standing.role)
			) {
				set.status = 403;
				return { error: "Only a workspace owner can change an owner's role" };
			}
			const outcome = await setWorkspaceMemberRole(
				params.id,
				params.memberId,
				body.role,
			);
			if (outcome.status === "not-found") {
				set.status = 404;
				return { error: "No such member of this workspace" };
			}
			if (outcome.status === "last-owner") {
				set.status = 409;
				return {
					error:
						"This is the workspace's last owner — make somebody else an owner first",
				};
			}
			return readMember(outcome.member, {
				viewerId: standing.userId,
				canManage: true,
			});
		},
		{
			body: WorkspaceRoleBodySchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Change a member's role",
				description:
					"Moves one membership to another role (REQ129), named by the membership's own `id` from the roster. `role` is required — this request exists only to state one, so an absent role is `422` rather than a silent demotion. Takes effect on that member's very next request; nothing is cached and nothing was issued to them that could outlive the change. Requires `admin` or `owner`, and *either end* touching `owner` requires `owner`. `409` when the change would leave the workspace with no owner: nothing else in the model could restore one, so the workspace would be un-renameable, un-addable-to and un-deletable for good. A membership id belonging to another workspace answers `404`, so an id learned elsewhere cannot be used to write across workspaces.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Remove somebody, or leave ──────────────────────────
	.delete(
		"/workspaces/:id/members/:memberId",
		async ({ params, request, set }) => {
			// The read-level gate, because this route authorizes two different acts:
			// an admin removing somebody, and a member removing *themselves*. The
			// second is not a management power — leaving a room you were invited into
			// never was — so it is decided against the stored row below rather than by
			// refusing every ordinary member up here.
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canReadWorkspace,
				"You are not a member of this workspace",
			);
			if (standing instanceof Response) return standing;
			const target = await getWorkspaceMember(params.id, params.memberId);
			if (!target) {
				set.status = 404;
				return { error: "No such member of this workspace" };
			}
			const leaving = target.userId === standing.userId;
			if (!leaving && !canManageWorkspaceMembers(standing.role)) {
				set.status = 403;
				return { error: "Only a workspace admin can remove members" };
			}
			// Taking the owner role off somebody is the owner's own act (see the role
			// change above), and removing them takes it off just as thoroughly.
			// Leaving is the one exception, and it needs none: the last-owner refusal
			// below already stands in the way of the only case that would matter.
			if (
				!leaving &&
				canAdministerWorkspace(target.role) &&
				!canAdministerWorkspace(standing.role)
			) {
				set.status = 403;
				return { error: "Only a workspace owner can remove an owner" };
			}
			const outcome = await removeWorkspaceMember(params.id, params.memberId);
			if (outcome.status === "not-found") {
				set.status = 404;
				return { error: "No such member of this workspace" };
			}
			if (outcome.status === "last-owner") {
				set.status = 409;
				return {
					error: leaving
						? "You are the workspace's last owner — make somebody else an owner first"
						: "This is the workspace's last owner — make somebody else an owner first",
				};
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "Remove a member, or leave the workspace",
				description:
					"Removes one membership (REQ129), named by its own `id`. Immediate and total: the standing **is** the stored row, so there is nothing to expire and nothing the member was handed that keeps working — their next request on the workspace's decks is refused exactly as a stranger's is. **The workspace's decks are untouched** (REQ128): that is the whole point of a workspace owning them. Requires `admin` or `owner` to remove somebody else, and removing an `owner` requires `owner`; any member may remove **themselves** whatever their role, which is how leaving works. `409` when the removal would take the workspace's last owner with it.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── The workspace's decks ──────────────────────────────
	.get(
		"/workspaces/:id/presentations",
		async ({ params, request }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canReadWorkspace,
				"You are not a member of this workspace",
			);
			if (standing instanceof Response) return standing;
			const decks = await listWorkspacePresentations(params.id);
			// A member reads the workspace's decks as their authors wrote them, on the
			// reading a collaborator reads a shared deck (REQ075): what a role governs
			// is what its holder may change, not a redacted copy of a deck their own
			// workspace owns. Resolved through the same bridge every gated route uses,
			// so the day REQ131's reduced role arrives this needs no edit.
			const level = workspaceDeckAccessLevel(standing.role);
			return decks.map((deck) =>
				sanitize(deck, { canEdit: canReadDeckAuthoring(level) }),
			);
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "List the decks a workspace owns",
				description:
					"Returns the decks this workspace owns (REQ128), newest first — the workspace's own half of `GET /api/presentations/mine`. Any member reads it, and reads each deck as its author wrote it: quiz answer keys (REQ056) and presenter notes (REQ090) are carried, because what a role governs is what its holder may change rather than a redacted copy of a deck their own workspace owns. `403` for an account that is not a member. A deck listed here has no account owner and no edit token — its standing is this roster, which is why removing any one member leaves every deck exactly where it was.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── The templates the workspace publishes (REQ004) ─────
	.get(
		"/workspaces/:id/templates",
		async ({ params, request }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canReadWorkspace,
				"You are not a member of this workspace",
			);
			if (standing instanceof Response) return standing;
			const published = await listWorkspaceTemplates(params.id);
			return published.map(readTemplate);
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "List the templates a workspace publishes",
				description:
					"Returns the templates this workspace has published out of its own decks (REQ004), newest first — the same shape `GET /api/templates` answers with (`id`, `title`, `description`, `category`, `tags`, `slides`), plus the deck each was taken from (`sourcePresentationId`), who published it by display name, and when. Any member reads the list and can create from an entry; publishing and unpublishing need `admin` or `owner`. `403` for an account that is not a member — which is also what a workspace id that does not exist answers, so the route cannot be used to probe for one. An entry's id is what `POST /api/presentations` takes as `workspaceTemplateId`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Publish one of its decks as a template (REQ004) ────
	.post(
		"/workspaces/:id/templates",
		async ({ params, body, request, set }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canPublishWorkspaceTemplates,
				"Only a workspace admin can publish a template",
			);
			if (standing instanceof Response) return standing;
			// **The deck has to be this workspace's own.** Not merely one the caller
			// can edit: a template is published into a gallery every member reads, and
			// a deck from anywhere else would be one account's work handed to a roster
			// that was never its owner. Refused for a deck that does not exist and for
			// one this workspace does not own with the same answer, on the reading the
			// route's own `403` takes — the caller has standing in the workspace, not
			// in whatever else that id might name.
			const deck = await getPresentation(body.presentationId);
			if (!deck || deck.workspaceId !== params.id) {
				set.status = 404;
				return { error: "No such deck in this workspace" };
			}
			const { created, template } = await publishWorkspaceTemplate(
				params.id,
				body.presentationId,
				standing.userId,
				{
					// The entry's own name, or the deck's when the request states none —
					// the same inheritance a create that names a template performs
					// (REQ006), in the other direction.
					title: body.title || ((deck.title as string | undefined) ?? ""),
					description: body.description,
					category: body.category,
					tags: body.tags,
					// The snapshot's source. `publishWorkspaceTemplate` copies them under
					// fresh ids, which is what makes this a snapshot rather than a live
					// mirror of the deck.
					slides: (deck.slides as Slide[] | undefined) ?? [],
				},
			);
			set.status = created ? 201 : 200;
			return readTemplate(template);
		},
		{
			body: PublishWorkspaceTemplateSchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Publish one of the workspace's decks as a template",
				description:
					"Publishes a deck the **workspace owns** as a template every member can start from (REQ004). The entry stores a **copy** of that deck's slides under fresh ids, so editing the deck afterwards does not change the template — republishing it does, and that is what publishing the same deck again is: idempotent per deck, answering `200` where a new entry gets `201`. `presentationId` is required and must name a deck this workspace owns; anything else — a deck that does not exist, one the caller owns personally, one belonging to another workspace — is `404`. `category` is required, one of `meeting`, `workshop`, `education`, `feedback`, `engagement`; `title` defaults to the deck's own, `description` to empty and `tags` to none. Requires `admin` or `owner`: publishing writes to a surface every member reads. A workspace the caller is not in and one that does not exist answer the same `403`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Take one back down (REQ004) ────────────────────────
	.delete(
		"/workspaces/:id/templates/:templateId",
		async ({ params, request, set }) => {
			const standing = await requireWorkspaceRole(
				request,
				params.id,
				canPublishWorkspaceTemplates,
				"Only a workspace admin can unpublish a template",
			);
			if (standing instanceof Response) return standing;
			const removed = await unpublishWorkspaceTemplate(
				params.id,
				params.templateId,
			);
			if (!removed) {
				set.status = 404;
				return { error: "No such template in this workspace" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Workspaces"],
				summary: "Unpublish one of the workspace's templates",
				description:
					"Removes one published entry from the workspace's gallery (REQ004), named by its own `id`. **No deck is touched**: every deck made from the entry is an ordinary deck of the workspace's that shares no identity with it, and the deck it was published from was only ever the snapshot's source. Requires `admin` or `owner`, like publishing. A template id belonging to another workspace answers `404`, so an id learned elsewhere cannot be used to write across workspaces.",
				security: [{ bearerAuth: [] }],
			},
		},
	);
