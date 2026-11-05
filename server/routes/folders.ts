/**
 * Deck folders (REQ126) — `/api/folders/*` and the filing of one deck,
 * `PUT /api/presentations/:id/folder`.
 *
 * A route module of its own, beside `routes/workspaces.ts` and for its reason:
 * a folder is not a presentation, and the one place they meet — "does this
 * account own the deck it is filing?" — is a read of the presentation service.
 *
 * Every route answers to one account and one account only. No account is `401`;
 * a folder id that is another account's answers the same `404` as one that does
 * not exist, so a caller cannot probe for somebody else's folders. Filing is
 * the deck **owner's** alone: a deck shared with the caller, a workspace deck
 * and one held only by an edit token are all `403`.
 *
 * Sharing a folder (slice 4) is `/api/folders/:id/collaborators/*`, the deck
 * collaborator routes' shape and their terms: the folder's owner alone, the
 * list keyed by the grant's own id and never by an account id.
 *
 * Creating a folder is limited per account twice over, a rate and a count, so an
 * account cannot multiply the share route's per-folder lookup budget by holding
 * or minting more folders: `FOLDER_CREATE_RULE` and `FOLDERS_PER_ACCOUNT_LIMIT`.
 */

import { Elysia } from "elysia";
import { findUserByEmail, findUserById, resolveUserId } from "../accounts";
import { guardFolderCreate, guardSubmission } from "../rate-limit";
import {
	DeckAccessLevelBodySchema,
	type DeckCollaborator,
	DeckCollaboratorSchema,
	FileDeckSchema,
	type Folder,
	FolderNameSchema,
	FolderSchema,
	ShareDeckSchema,
} from "../schemas";
import {
	createFolder,
	deleteFolder,
	FOLDERS_PER_ACCOUNT_LIMIT,
	type FolderGrantRecord,
	type FolderRecord,
	fileDeck,
	getFolder,
	grantFolderAccess,
	listFolderGrants,
	listFolders,
	renameFolder,
	revokeFolderGrant,
	setFolderGrantLevel,
	unfileDeck,
} from "../services/folders";
import { getPresentation } from "../services/presentations";

/** A JSON error Response with the given status. */
function jsonError(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Project a stored folder into what its owner reads. Built key by key and
 * parsed through {@link FolderSchema}, so `ownerId` cannot travel.
 */
function readFolder(folder: FolderRecord, presentationIds: string[]): Folder {
	return FolderSchema.parse({
		id: folder.id,
		name: folder.name,
		presentationIds,
		createdAt: folder.createdAt,
		updatedAt: folder.updatedAt,
	});
}

/** The account behind the request, or a `401` Response. */
async function requireAccount(request: Request): Promise<string | Response> {
	const userId = await resolveUserId(request.headers);
	return userId ?? jsonError(401, "Sign in to use folders");
}

/**
 * Project a folder grant into what the folder's owner reads — the deck
 * collaborator shape, parsed through {@link DeckCollaboratorSchema} so the
 * grantee's account id cannot travel.
 */
function readFolderCollaborator(grant: FolderGrantRecord): DeckCollaborator {
	const account = findUserById(grant.userId);
	return DeckCollaboratorSchema.parse({
		id: grant.id,
		email: account?.email ?? "",
		name: account?.name ?? null,
		level: grant.level,
		createdAt: grant.createdAt,
		updatedAt: grant.updatedAt,
	});
}

const FOLDER_NOT_FOUND = "Folder not found";
const GRANT_NOT_FOUND = "No such collaborator on this folder";

export const folderRoutes = new Elysia({ prefix: "/api" })
	.get(
		"/folders",
		async ({ request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			const owned = await listFolders(userId);
			return owned.map(({ folder, presentationIds }) =>
				readFolder(folder, presentationIds),
			);
		},
		{
			detail: {
				tags: ["Folders"],
				summary: "List the signed-in account's folders",
				description:
					"Returns the caller's own folders (REQ126) by name, each with `presentationIds` — the decks filed in it, newest filing first. A deck in no folder is in none of these lists. Requires a cookie session or a personal API key; `401` otherwise. Scoped to the caller: no other account's folder, name or filing is ever returned.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.post(
		"/folders",
		async ({ body, request, set }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			const overLimit = guardFolderCreate(userId);
			if (overLimit) return overLimit;
			const folder = await createFolder(userId, body.name);
			if (!folder) {
				return jsonError(
					409,
					`This account already holds ${FOLDERS_PER_ACCOUNT_LIMIT} folders, the most it can have. Delete one to make another.`,
				);
			}
			set.status = 201;
			return readFolder(folder, []);
		},
		{
			body: FolderNameSchema,
			detail: {
				tags: ["Folders"],
				summary: "Create a folder",
				description:
					"Creates an empty folder owned by the caller (REQ126). `name` is required and trimmed; a blank one is `422`. Folders are flat — a folder never holds another. Requires an account; `401` otherwise. Limited per account: over 30 creations in an hour answers `429` with `Retry-After`, and an account already holding 100 folders answers `409` until it deletes one.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.patch(
		"/folders/:id",
		async ({ params, body, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			const folder = await renameFolder(params.id, userId, body.name);
			if (!folder) return jsonError(404, FOLDER_NOT_FOUND);
			const owned = await listFolders(userId);
			const filed = owned.find((entry) => entry.folder.id === folder.id);
			return readFolder(folder, filed?.presentationIds ?? []);
		},
		{
			body: FolderNameSchema,
			detail: {
				tags: ["Folders"],
				summary: "Rename a folder",
				description:
					"Renames one of the caller's folders (REQ126). `404` for a folder that does not exist **and** for another account's, so the route cannot be used to probe for one. `401` without an account.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/folders/:id",
		async ({ params, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			if (!(await deleteFolder(params.id, userId))) {
				return jsonError(404, FOLDER_NOT_FOUND);
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Folders"],
				summary: "Delete a folder",
				description:
					"Deletes one of the caller's folders (REQ126). **Never deletes a deck**: the decks filed in it go back to unfiled and are otherwise untouched. The folder's grants go with it, so nobody it was shared with is reached through it any longer. `404` for a missing folder and for another account's alike; `401` without an account.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.get(
		"/folders/:id/collaborators",
		async ({ params, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			if (!(await getFolder(params.id, userId))) {
				return jsonError(404, FOLDER_NOT_FOUND);
			}
			return (await listFolderGrants(params.id)).map(readFolderCollaborator);
		},
		{
			detail: {
				tags: ["Folders"],
				summary: "List who a folder is shared with",
				description:
					"Returns the accounts one of the caller's folders is shared with (REQ126), oldest grant first, with the fields of `GET /presentations/:id/collaborators` except its `folder`: the grant's own `id`, the account's `email` and `name`, the `level` and when it was made and last changed. **No account identifier is ever in this payload.** Owner-only: `401` without an account, `404` for another account's folder as for a missing one — a grantee cannot see who else a folder is shared with.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.post(
		"/folders/:id/collaborators",
		async ({ params, body, request, server, set }) => {
			// Budgeted before the lookup, as the deck share route is (REQ145): the
			// `404`/`201` split says whether an address has an account.
			const overLimit = guardSubmission(
				{ request, server },
				`folder-share:${params.id}`,
			);
			if (overLimit) return overLimit;
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			if (!(await getFolder(params.id, userId))) {
				return jsonError(404, FOLDER_NOT_FOUND);
			}
			const target = findUserByEmail(body.email);
			if (!target) {
				return jsonError(404, "No account is registered with that email");
			}
			if (target.id === userId) {
				return jsonError(400, "You already own this folder");
			}
			const { created, grant } = await grantFolderAccess(
				params.id,
				target.id,
				body.level,
			);
			set.status = created ? 201 : 200;
			return readFolderCollaborator(grant);
		},
		{
			body: ShareDeckSchema,
			detail: {
				tags: ["Folders"],
				summary: "Share a folder with an account",
				description:
					"Shares one of the caller's folders with a registered account at `view`, `comment` or `edit` (REQ126), defaulting to `view`. The grant reaches **every deck filed in the folder** at that level, enforced on every route exactly as a deck grant (REQ075) is, and only while the deck's owner is still the folder's owner — a deck that leaves the folder, or changes owner, is no longer reached. Where the account also has a standing on a deck (a deck grant, a workspace role), the strongest one stands. Idempotent per account: sharing again changes the level and answers `200` instead of `201`. `404` for an address with no account and for a folder that is missing or another account's, `400` for the caller's own address, `401` without an account. Rate-limited like the deck share route, `429` with `Retry-After` over the limit.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.patch(
		"/folders/:id/collaborators/:collaboratorId",
		async ({ params, body, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			if (!(await getFolder(params.id, userId))) {
				return jsonError(404, FOLDER_NOT_FOUND);
			}
			const grant = await setFolderGrantLevel(
				params.id,
				params.collaboratorId,
				body.level,
			);
			if (!grant) return jsonError(404, GRANT_NOT_FOUND);
			return readFolderCollaborator(grant);
		},
		{
			body: DeckAccessLevelBodySchema,
			detail: {
				tags: ["Folders"],
				summary: "Change a folder grant's access level",
				description:
					"Moves one grant on one of the caller's folders to another level (REQ126), named by the grant's own `id`. `level` is required (`422` without it). Takes effect on the grantee's next request, on every deck in the folder. A grant id from another folder answers `404`. Owner-only, on the terms of the list route.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/folders/:id/collaborators/:collaboratorId",
		async ({ params, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			if (!(await getFolder(params.id, userId))) {
				return jsonError(404, FOLDER_NOT_FOUND);
			}
			if (!(await revokeFolderGrant(params.id, params.collaboratorId))) {
				return jsonError(404, GRANT_NOT_FOUND);
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Folders"],
				summary: "Revoke a folder grant",
				description:
					"Removes one grant on one of the caller's folders (REQ126). Immediate: the grantee's next request on any deck in the folder is decided without it, and those decks leave their `GET /presentations/shared` unless another standing still reaches them. A grant id from another folder answers `404`. Owner-only, on the terms of the list route.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.put(
		"/presentations/:id/folder",
		async ({ params, body, request }) => {
			const userId = await requireAccount(request);
			if (userId instanceof Response) return userId;
			const deck = await getPresentation(params.id);
			if (!deck) return jsonError(404, "Presentation not found");
			if (deck.creatorId !== userId) {
				return jsonError(403, "Only the deck's owner can file it in a folder");
			}
			if (body.folderId === null) {
				await unfileDeck(params.id);
				return { folderId: null };
			}
			const folder = await getFolder(body.folderId, userId);
			if (!folder) return jsonError(404, FOLDER_NOT_FOUND);
			await fileDeck(params.id, folder);
			return { folderId: folder.id };
		},
		{
			body: FileDeckSchema,
			detail: {
				tags: ["Folders"],
				summary: "File a deck in a folder, or unfile it",
				description:
					"Puts a deck the caller **owns** into one of the caller's folders (REQ126), moving it out of any folder it was in — a deck is in at most one — or, with `folderId: null`, takes it out of its folder. Answers `{ folderId }`. `403` for a deck the caller does not own: one shared with them, one a workspace owns, or one they hold only an edit token for. `404` for a missing deck, and for a `folderId` that does not exist or is another account's. Filing a deck in a shared folder extends that folder's grants to it, and moving it out ends them (REQ126). Not an authored edit: the deck's `revision` does not move, and nothing is broadcast to the room.",
				security: [{ bearerAuth: [] }],
			},
		},
	);
