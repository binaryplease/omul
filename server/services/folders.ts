/**
 * Deck folders (REQ126) — an account groups the decks it owns.
 *
 * A module of its own on the terms `services/collaborators.ts` is: it owns its
 * two collections and would keep working if the presentation service were
 * rewritten. The dependency runs one way — **nothing here imports the
 * presentation service** — so that service can call {@link unfileDeck} when a
 * deck is deleted or changes owner, and whether the caller owns a deck is the
 * route's question, asked of the presentation service before it gets here.
 *
 * Every function takes the owning account and answers only for it: a folder id
 * belonging to another account reads exactly as one that does not exist.
 */

import { createStore } from "../db";
import { StoredFolderEntrySchema, StoredFolderSchema } from "../schemas";

const folders = createStore("folders", StoredFolderSchema, {
	indexes: ["ownerId"],
});

// Unique on the deck, so "a deck is in at most one folder" holds at the storage
// layer rather than by a check-then-insert.
const entries = createStore("folderEntries", StoredFolderEntrySchema, {
	indexes: [
		"folderId",
		"ownerId",
		{ fields: ["presentationId"], unique: true },
	],
});

/** One stored folder, as every function here hands it back. */
export type FolderRecord = {
	id: string;
	ownerId: string;
	name: string;
	createdAt: string;
	updatedAt: string;
};

function readFolder(row: Record<string, unknown>): FolderRecord {
	return {
		id: row.id as string,
		ownerId: row.ownerId as string,
		name: (row.name as string | undefined) ?? "",
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/** The account's folder with this id, or `null` — another account's is `null` too. */
export async function getFolder(
	folderId: string,
	ownerId: string,
): Promise<FolderRecord | null> {
	const row = await folders.findOne(folderId);
	if (!row || row.ownerId !== ownerId) return null;
	return readFolder(row);
}

/**
 * The account's folders by name, each with the ids of the decks filed in it,
 * newest filing first.
 */
export async function listFolders(
	ownerId: string,
): Promise<{ folder: FolderRecord; presentationIds: string[] }[]> {
	const [rows, filed] = await Promise.all([
		folders.find({ ownerId }),
		entries.find({ ownerId }),
	]);
	const newestFirst = filed.sort((first, second) =>
		(second.createdAt as string).localeCompare(first.createdAt as string),
	);
	return rows
		.map(readFolder)
		.sort((first, second) => first.name.localeCompare(second.name))
		.map((folder) => ({
			folder,
			presentationIds: newestFirst
				.filter((entry) => entry.folderId === folder.id)
				.map((entry) => entry.presentationId as string),
		}));
}

export async function createFolder(
	ownerId: string,
	name: string,
): Promise<FolderRecord> {
	const now = new Date().toISOString();
	return readFolder(
		await folders.insert({ ownerId, name, createdAt: now, updatedAt: now }),
	);
}

/** Rename the account's folder; `null` when it has no folder with this id. */
export async function renameFolder(
	folderId: string,
	ownerId: string,
	name: string,
): Promise<FolderRecord | null> {
	if (!(await getFolder(folderId, ownerId))) return null;
	const row = await folders.update(folderId, {
		name,
		updatedAt: new Date().toISOString(),
	});
	return row ? readFolder(row) : null;
}

/**
 * Delete the account's folder. Its decks are only unfiled — the filings go,
 * the decks are not touched. `false` when it has no folder with this id.
 */
export async function deleteFolder(
	folderId: string,
	ownerId: string,
): Promise<boolean> {
	if (!(await getFolder(folderId, ownerId))) return false;
	await entries.deleteMany({ folderId });
	return folders.remove(folderId);
}

/**
 * File a deck in a folder of `folderId`'s owner, replacing whatever filing the
 * deck had — the caller has already proved that account owns the deck, so any
 * earlier filing (made under a previous owner, say) is stale by definition.
 */
export async function fileDeck(
	presentationId: string,
	folder: FolderRecord,
): Promise<void> {
	await entries.deleteMany({ presentationId });
	await entries.insert({
		folderId: folder.id,
		presentationId,
		ownerId: folder.ownerId,
		createdAt: new Date().toISOString(),
	});
}

/**
 * Take a deck out of whichever folder holds it. Called when the deck is
 * unfiled, deleted, or stops being owned by the account whose folder it was
 * in, so a filing never outlives the ownership it was made under.
 */
export async function unfileDeck(presentationId: string): Promise<void> {
	await entries.deleteMany({ presentationId });
}
