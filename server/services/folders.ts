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
 *
 * Since slice 4 a folder can be shared (`folderGrants`), at the REQ075 levels.
 * What a grant authorizes is decided in `resolveDeckAccess`, which asks
 * {@link folderAccessLevelFor} for it beside the deck's own grant; whether the
 * caller may manage a folder's grants is the owner check every function here
 * already makes.
 */

import { createStore } from "../db";
import {
	type DeckAccessLevel,
	StoredFolderEntrySchema,
	StoredFolderGrantSchema,
	StoredFolderSchema,
} from "../schemas";
import { weakestDeckAccessLevel } from "./collaborators";

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

// Unique on the pair for the reason `deckCollaborators` is: one row per
// (folder, account) is what every level change and revoke names, and a
// check-then-insert cannot hold it against two shares in flight together.
const grants = createStore("folderGrants", StoredFolderGrantSchema, {
	indexes: [
		"folderId",
		"userId",
		{ fields: ["folderId", "userId"], unique: true },
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
	await grants.deleteMany({ folderId });
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

// ── Sharing a folder (slice 4) ───────────────────────────────

/** One stored folder grant, as every function here hands it back. */
export type FolderGrantRecord = {
	id: string;
	folderId: string;
	userId: string;
	level: DeckAccessLevel;
	createdAt: string;
	updatedAt: string;
};

function readGrant(row: Record<string, unknown>): FolderGrantRecord {
	return {
		id: row.id as string,
		folderId: row.folderId as string,
		userId: row.userId as string,
		level: (row.level as DeckAccessLevel | undefined) ?? "view",
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/** Every grant on a folder, oldest first — the order its owner built the list in. */
export async function listFolderGrants(
	folderId: string,
): Promise<FolderGrantRecord[]> {
	const rows = await grants.find({ folderId });
	return rows
		.map(readGrant)
		.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/**
 * Share a folder with an account at a level, or change the level of the grant
 * it already has — idempotent per account, and under a race too, exactly as
 * `grantDeckAccess` is: the losing insert of two in flight becomes the level
 * change it would have been a moment later.
 */
export async function grantFolderAccess(
	folderId: string,
	userId: string,
	level: DeckAccessLevel,
): Promise<{ created: boolean; grant: FolderGrantRecord }> {
	const now = new Date().toISOString();
	const changeLevel = async (row: Record<string, unknown>) => {
		const updated = await grants.update(row.id as string, {
			level,
			updatedAt: now,
		});
		if (!updated) {
			throw new Error(
				`grantFolderAccess: grant ${row.id} disappeared mid-change`,
			);
		}
		return { created: false, grant: readGrant(updated) };
	};
	const existing = (await grants.find({ folderId, userId }))[0];
	if (existing) return changeLevel(existing);
	try {
		const inserted = await grants.insert({
			folderId,
			userId,
			level,
			createdAt: now,
			updatedAt: now,
		});
		return { created: true, grant: readGrant(inserted) };
	} catch (insertError) {
		const raced = (await grants.find({ folderId, userId }))[0];
		if (!raced) throw insertError;
		return changeLevel(raced);
	}
}

/**
 * Change one grant's level, named by its own id and scoped to its folder: a
 * grant id from another folder is `null`, never a cross-folder write.
 */
export async function setFolderGrantLevel(
	folderId: string,
	grantId: string,
	level: DeckAccessLevel,
): Promise<FolderGrantRecord | null> {
	const existing = await grants.findOne(grantId);
	if (!existing || existing.folderId !== folderId) return null;
	const updated = await grants.update(grantId, {
		level,
		updatedAt: new Date().toISOString(),
	});
	return updated ? readGrant(updated) : null;
}

/** Revoke one grant, scoped to its folder as {@link setFolderGrantLevel} is. */
export async function revokeFolderGrant(
	folderId: string,
	grantId: string,
): Promise<boolean> {
	const existing = await grants.findOne(grantId);
	if (!existing || existing.folderId !== folderId) return false;
	return grants.remove(grantId);
}

/**
 * The level a folder grant gives this account on this deck, or `null`.
 *
 * `deckOwnerId` is the deck's **current** `creatorId`, and the grant counts only
 * while it is the folder's owner — the filing row and the folder row must both
 * still name that account. The filing is cleared when a deck changes owner, but
 * a grant must not rest on every such path remembering to clear it: a deck that
 * is no longer the folder owner's is not reached, whatever row is left behind.
 */
export async function folderAccessLevelFor(
	presentationId: string,
	deckOwnerId: string | null,
	userId: string,
): Promise<DeckAccessLevel | null> {
	if (!presentationId || !deckOwnerId || !userId) return null;
	const entry = (await entries.find({ presentationId }))[0];
	if (!entry || entry.ownerId !== deckOwnerId) return null;
	const folder = await folders.findOne(entry.folderId as string);
	if (!folder || folder.ownerId !== deckOwnerId) return null;
	const rows = await grants.find({ folderId: folder.id as string, userId });
	return weakestDeckAccessLevel(rows.map((row) => readGrant(row).level));
}

/**
 * Every deck filed in a folder shared with this account, with the folder's
 * owner and the grant's level and date. The deck's own `creatorId` is not read
 * here — nothing here imports the presentation service — so the caller must
 * still hold each deck to `ownerId` before it counts (as
 * {@link folderAccessLevelFor} does).
 */
export async function listFolderDecksSharedWith(userId: string): Promise<
	{
		presentationId: string;
		ownerId: string;
		level: DeckAccessLevel;
		grantedAt: string;
	}[]
> {
	const held = (await grants.find({ userId })).map(readGrant);
	const reached = await Promise.all(
		held.map(async (grant) => {
			const folder = await folders.findOne(grant.folderId);
			if (!folder) return [];
			const ownerId = folder.ownerId as string;
			const filed = await entries.find({ folderId: grant.folderId });
			return filed
				.filter((entry) => entry.ownerId === ownerId)
				.map((entry) => ({
					presentationId: entry.presentationId as string,
					ownerId,
					level: grant.level,
					grantedAt: grant.createdAt,
				}));
		}),
	);
	return reached.flat();
}
