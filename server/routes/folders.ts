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
 */

import { Elysia } from "elysia";
import { resolveUserId } from "../accounts";
import {
	FileDeckSchema,
	type Folder,
	FolderNameSchema,
	FolderSchema,
} from "../schemas";
import {
	createFolder,
	deleteFolder,
	type FolderRecord,
	fileDeck,
	getFolder,
	listFolders,
	renameFolder,
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

const FOLDER_NOT_FOUND = "Folder not found";

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
			const folder = await createFolder(userId, body.name);
			set.status = 201;
			return readFolder(folder, []);
		},
		{
			body: FolderNameSchema,
			detail: {
				tags: ["Folders"],
				summary: "Create a folder",
				description:
					"Creates an empty folder owned by the caller (REQ126). `name` is required and trimmed; a blank one is `422`. Folders are flat — a folder never holds another. Requires an account; `401` otherwise.",
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
					"Deletes one of the caller's folders (REQ126). **Never deletes a deck**: the decks filed in it go back to unfiled and are otherwise untouched. `404` for a missing folder and for another account's alike; `401` without an account.",
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
					"Puts a deck the caller **owns** into one of the caller's folders (REQ126), moving it out of any folder it was in — a deck is in at most one — or, with `folderId: null`, takes it out of its folder. Answers `{ folderId }`. `403` for a deck the caller does not own: one shared with them, one a workspace owns, or one they hold only an edit token for. `404` for a missing deck, and for a `folderId` that does not exist or is another account's. Not an authored edit: the deck's `revision` does not move, and nothing is broadcast to the room.",
				security: [{ bearerAuth: [] }],
			},
		},
	);
