/**
 * Integration tests for deck folders (REQ126, slices 3 and 4).
 *
 * Drives the real routes over HTTP with real accounts, as
 * `workspaces.integration.test.ts` does: an account creates, renames and
 * deletes its folders and files the decks it owns; it is refused on a deck it
 * does not own and on another account's folder; deleting a folder leaves its
 * decks intact and unfiled. Slice 4: a grant on a folder reaches the decks
 * filed in it at its level, only while they are filed there and still the
 * folder owner's, and only the owner sees or changes who it is shared with.
 */

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-folders-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;
let ownerKey = "";
let strangerKey = "";
let granteeKey = "";
let granteeId = "";

const STRANGER_EMAIL = "folder-stranger@example.com";
const GRANTEE_EMAIL = "folder-grantee@example.com";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
	},
];

function keyed(key: string): Record<string, string> {
	return { "Content-Type": "application/json", "x-api-key": key };
}

async function createDeck(key: string, title = "Deck"): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ title, slides: SLIDES }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function createFolder(key: string, name = "Talks"): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/folders`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ name }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

function fileDeck(key: string, deckId: string, folderId: string | null) {
	return fetch(`${baseUrl}/api/presentations/${deckId}/folder`, {
		method: "PUT",
		headers: keyed(key),
		body: JSON.stringify({ folderId }),
	});
}

function shareFolder(
	key: string,
	folderId: string,
	email: string,
	level: string,
) {
	return fetch(`${baseUrl}/api/folders/${folderId}/collaborators`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ email, level }),
	});
}

/** The level a deck read reports for this caller — `null` for no standing. */
async function accessLevelOn(key: string, deckId: string): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations/${deckId}`, {
		headers: keyed(key),
	});
	expect(res.status).toBe(200);
	return (await res.json()).accessLevel;
}

async function sharedWith(key: string): Promise<Any[]> {
	const res = await fetch(`${baseUrl}/api/presentations/shared`, {
		headers: keyed(key),
	});
	expect(res.status).toBe(200);
	return res.json();
}

function renameDeck(key: string, deckId: string) {
	return fetch(`${baseUrl}/api/presentations/${deckId}`, {
		method: "PATCH",
		headers: keyed(key),
		body: JSON.stringify({ title: "Renamed by a grantee" }),
	});
}

async function foldersOf(key: string): Promise<Any[]> {
	const res = await fetch(`${baseUrl}/api/folders`, { headers: keyed(key) });
	expect(res.status).toBe(200);
	return res.json();
}

describe("Deck folders (REQ126)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { folderRoutes } = await import("./routes/folders");
		const { workspaceRoutes } = await import("./routes/workspaces");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.use(presentationRoutes)
			.use(folderRoutes)
			.use(workspaceRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		const accountFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: "correct-horse-battery", name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return created.key;
		};
		ownerKey = await accountFor("folder-owner@example.com", "Owner");
		strangerKey = await accountFor(STRANGER_EMAIL, "Stranger");
		granteeKey = await accountFor(GRANTEE_EMAIL, "Grantee");
		const { findUserByEmail } = await import("./accounts");
		granteeId = findUserByEmail(GRANTEE_EMAIL)?.id ?? "";
	});

	afterAll(async () => {
		await server?.stop();
		if (process.env.OMUL_AUTH_DB) {
			rmSync(join(process.env.OMUL_AUTH_DB, ".."), {
				recursive: true,
				force: true,
			});
		}
	});

	test("an account creates, renames and deletes a folder, and nobody else sees it", async () => {
		const folder = await createFolder(ownerKey, "  Conference  ");
		expect(folder).toEqual({
			id: folder.id,
			name: "Conference",
			presentationIds: [],
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});
		expect(folder).not.toHaveProperty("ownerId");

		const renamed = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({ name: "Keynotes" }),
		});
		expect(renamed.status).toBe(200);
		expect((await renamed.json()).name).toBe("Keynotes");
		expect(
			(await foldersOf(ownerKey)).find((entry) => entry.id === folder.id).name,
		).toBe("Keynotes");
		expect(await foldersOf(strangerKey)).toEqual([]);

		const blank = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({ name: "   " }),
		});
		expect(blank.status).toBe(422);

		const deleted = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(deleted.status).toBe(200);
		expect(
			(await foldersOf(ownerKey)).some((entry) => entry.id === folder.id),
		).toBe(false);
	});

	test("folders need an account", async () => {
		expect((await fetch(`${baseUrl}/api/folders`)).status).toBe(401);
		const created = await fetch(`${baseUrl}/api/folders`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Anonymous" }),
		});
		expect(created.status).toBe(401);
	});

	test("an account files and unfiles a deck it owns, one folder at a time", async () => {
		const deck = await createDeck(ownerKey);
		const first = await createFolder(ownerKey, "First");
		const second = await createFolder(ownerKey, "Second");

		const filed = await fileDeck(ownerKey, deck.id, first.id);
		expect(filed.status).toBe(200);
		expect(await filed.json()).toEqual({ folderId: first.id });

		// Filing elsewhere moves it: a deck is in at most one folder.
		expect((await fileDeck(ownerKey, deck.id, second.id)).status).toBe(200);
		const moved = await foldersOf(ownerKey);
		expect(moved.find((entry) => entry.id === first.id).presentationIds).toEqual(
			[],
		);
		expect(
			moved.find((entry) => entry.id === second.id).presentationIds,
		).toEqual([deck.id]);

		const unfiled = await fileDeck(ownerKey, deck.id, null);
		expect(await unfiled.json()).toEqual({ folderId: null });
		const after = await foldersOf(ownerKey);
		expect(after.flatMap((entry) => entry.presentationIds)).not.toContain(
			deck.id,
		);

		// Filing is not an authored edit: the editor's revision does not move.
		const read = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			headers: keyed(ownerKey),
		});
		const body = await read.json();
		expect(body.revision).toBe(deck.revision);
		expect(body).not.toHaveProperty("folderId");
	});

	test("a deck the account does not own cannot be filed", async () => {
		const theirs = await createDeck(strangerKey, "Not yours");
		const folder = await createFolder(ownerKey);
		const refused = await fileDeck(ownerKey, theirs.id, folder.id);
		expect(refused.status).toBe(403);
		expect((await fileDeck(ownerKey, theirs.id, null)).status).toBe(403);

		// A deck shared at `edit` is still not the caller's to file.
		const shared = await fetch(
			`${baseUrl}/api/presentations/${theirs.id}/collaborators`,
			{
				method: "POST",
				headers: keyed(strangerKey),
				body: JSON.stringify({
					email: "folder-owner@example.com",
					level: "edit",
				}),
			},
		);
		expect(shared.status).toBe(201);
		expect((await fileDeck(ownerKey, theirs.id, folder.id)).status).toBe(403);

		// Neither is an anonymous deck held by its edit token.
		const anonymous = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Anon", slides: SLIDES }),
		});
		const anonymousDeck = await anonymous.json();
		const byToken = await fetch(
			`${baseUrl}/api/presentations/${anonymousDeck.id}/folder`,
			{
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${anonymousDeck.creatorToken}`,
				},
				body: JSON.stringify({ folderId: folder.id }),
			},
		);
		expect(byToken.status).toBe(401);

		expect(
			(await foldersOf(ownerKey)).find((entry) => entry.id === folder.id)
				.presentationIds,
		).toEqual([]);
	});

	test("another account's folder answers as one that does not exist", async () => {
		const folder = await createFolder(ownerKey, "Private");
		const strangersDeck = await createDeck(strangerKey);

		const rename = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "PATCH",
			headers: keyed(strangerKey),
			body: JSON.stringify({ name: "Taken" }),
		});
		expect(rename.status).toBe(404);
		const remove = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "DELETE",
			headers: keyed(strangerKey),
		});
		expect(remove.status).toBe(404);
		const fileInto = await fileDeck(strangerKey, strangersDeck.id, folder.id);
		expect(fileInto.status).toBe(404);

		const intact = (await foldersOf(ownerKey)).find(
			(entry) => entry.id === folder.id,
		);
		expect(intact.name).toBe("Private");
		expect(intact.presentationIds).toEqual([]);
	});

	test("deleting a folder leaves its decks intact and unfiled", async () => {
		const deck = await createDeck(ownerKey, "Survivor");
		const folder = await createFolder(ownerKey, "Doomed");
		await fileDeck(ownerKey, deck.id, folder.id);

		const deleted = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(deleted.status).toBe(200);

		const read = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			headers: keyed(ownerKey),
		});
		expect(read.status).toBe(200);
		expect((await read.json()).title).toBe("Survivor");
		expect(
			(await foldersOf(ownerKey)).flatMap((entry) => entry.presentationIds),
		).not.toContain(deck.id);
	});

	test("a deck that stops being the account's leaves its folder", async () => {
		const folder = await createFolder(ownerKey, "Handed on");
		const moved = await createDeck(ownerKey, "Moved");
		const removed = await createDeck(ownerKey, "Removed");
		await fileDeck(ownerKey, moved.id, folder.id);
		await fileDeck(ownerKey, removed.id, folder.id);

		const workspace = await (
			await fetch(`${baseUrl}/api/workspaces`, {
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ name: "Team" }),
			})
		).json();
		const handed = await fetch(
			`${baseUrl}/api/presentations/${moved.id}/workspace`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ workspaceId: workspace.id }),
			},
		);
		expect(handed.status).toBe(200);
		const gone = await fetch(`${baseUrl}/api/presentations/${removed.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(gone.status).toBe(200);

		expect(
			(await foldersOf(ownerKey)).find((entry) => entry.id === folder.id)
				.presentationIds,
		).toEqual([]);
	});

	test("a folder grant reaches every filed deck at its level, and is enforced", async () => {
		for (const level of ["view", "comment", "edit"]) {
			const folder = await createFolder(ownerKey, `Shared ${level}`);
			const filed = await createDeck(ownerKey, `Filed ${level}`);
			const unfiled = await createDeck(ownerKey, `Unfiled ${level}`);
			await fileDeck(ownerKey, filed.id, folder.id);
			const shared = await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, level);
			expect(shared.status).toBe(201);

			expect(await accessLevelOn(granteeKey, filed.id)).toBe(level);
			expect(await accessLevelOn(granteeKey, unfiled.id)).toBeNull();
			expect(await accessLevelOn(strangerKey, filed.id)).toBeNull();
			expect((await renameDeck(granteeKey, filed.id)).status).toBe(
				level === "edit" ? 200 : 403,
			);
			const listed = (await sharedWith(granteeKey)).find(
				(entry) => entry.id === filed.id,
			);
			expect(listed?.accessLevel).toBe(level);
			expect(
				(await sharedWith(granteeKey)).some((entry) => entry.id === unfiled.id),
			).toBe(false);
		}
	});

	test("an edit grant on a folder is delegated: it cannot delete a deck", async () => {
		const folder = await createFolder(ownerKey, "Delegated");
		const deck = await createDeck(ownerKey, "Kept");
		await fileDeck(ownerKey, deck.id, folder.id);
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit");
		const refused = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "DELETE",
			headers: keyed(granteeKey),
		});
		expect(refused.status).toBe(403);
	});

	test("filing and sharing a folder do not move the deck revision", async () => {
		const folder = await createFolder(ownerKey, "Revision");
		const deck = await createDeck(ownerKey, "Still");
		const before = (
			await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: keyed(ownerKey),
				})
			).json()
		).revision;
		await fileDeck(ownerKey, deck.id, folder.id);
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit");
		const after = (
			await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: keyed(ownerKey),
				})
			).json()
		).revision;
		expect(after).toBe(before);
	});

	test("the owner changes and revokes a folder grant, and the deck follows", async () => {
		const folder = await createFolder(ownerKey, "Changing");
		const deck = await createDeck(ownerKey, "Followed");
		await fileDeck(ownerKey, deck.id, folder.id);
		const grant = await (
			await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "view")
		).json();

		const again = await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "comment");
		expect(again.status).toBe(200);
		expect((await again.json()).id).toBe(grant.id);
		expect(await accessLevelOn(granteeKey, deck.id)).toBe("comment");

		const changed = await fetch(
			`${baseUrl}/api/folders/${folder.id}/collaborators/${grant.id}`,
			{
				method: "PATCH",
				headers: keyed(ownerKey),
				body: JSON.stringify({ level: "edit" }),
			},
		);
		expect(changed.status).toBe(200);
		expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");

		const revoked = await fetch(
			`${baseUrl}/api/folders/${folder.id}/collaborators/${grant.id}`,
			{ method: "DELETE", headers: keyed(ownerKey) },
		);
		expect(revoked.status).toBe(200);
		expect(await accessLevelOn(granteeKey, deck.id)).toBeNull();
		expect(
			(await sharedWith(granteeKey)).some((entry) => entry.id === deck.id),
		).toBe(false);
	});

	test("a deck that leaves the folder is no longer reached by its grants", async () => {
		const folder = await createFolder(ownerKey, "Leaving");
		const elsewhere = await createFolder(ownerKey, "Elsewhere");
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit");
		const unfiled = await createDeck(ownerKey, "Unfiled later");
		const moved = await createDeck(ownerKey, "Moved later");
		const deleted = await createDeck(ownerKey, "Deleted later");
		const handed = await createDeck(ownerKey, "Handed to a workspace");
		for (const deck of [unfiled, moved, deleted, handed]) {
			await fileDeck(ownerKey, deck.id, folder.id);
			expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");
		}

		await fileDeck(ownerKey, unfiled.id, null);
		await fileDeck(ownerKey, moved.id, elsewhere.id);
		await fetch(`${baseUrl}/api/presentations/${deleted.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		const workspace = await (
			await fetch(`${baseUrl}/api/workspaces`, {
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ name: "Elsewhere team" }),
			})
		).json();
		await fetch(`${baseUrl}/api/presentations/${handed.id}/workspace`, {
			method: "POST",
			headers: keyed(ownerKey),
			body: JSON.stringify({ workspaceId: workspace.id }),
		});

		expect(await accessLevelOn(granteeKey, unfiled.id)).toBeNull();
		expect(await accessLevelOn(granteeKey, moved.id)).toBeNull();
		expect(await accessLevelOn(granteeKey, handed.id)).toBeNull();
		const listed = (await sharedWith(granteeKey)).map((entry) => entry.id);
		for (const deck of [unfiled, moved, deleted, handed]) {
			expect(listed).not.toContain(deck.id);
		}
		// Deleting a deck never touches the folder's grants.
		const grants = await (
			await fetch(`${baseUrl}/api/folders/${folder.id}/collaborators`, {
				headers: keyed(ownerKey),
			})
		).json();
		expect(grants.map((grant: Any) => grant.email)).toEqual([GRANTEE_EMAIL]);
	});

	test("a folder grant counts only while the deck's owner is the folder's owner", async () => {
		const folder = await createFolder(ownerKey, "Owner changed");
		const deck = await createDeck(ownerKey, "Reowned");
		await fileDeck(ownerKey, deck.id, folder.id);
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit");
		expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");

		// Change the owner underneath the filing, past every path that unfiles,
		// so the stale entry is all that is left to trust.
		const { createStore } = await import("./db");
		const { StoredPresentationSchema } = await import("./schemas");
		const { findUserByEmail } = await import("./accounts");
		const store = createStore("presentations", StoredPresentationSchema);
		await store.update(deck.id, {
			creatorId: findUserByEmail(STRANGER_EMAIL)?.id ?? null,
		});

		expect(await accessLevelOn(granteeKey, deck.id)).toBeNull();
		expect((await renameDeck(granteeKey, deck.id)).status).toBe(403);
		expect(
			(await sharedWith(granteeKey)).some((entry) => entry.id === deck.id),
		).toBe(false);
	});

	test("the strongest of a folder grant and a deck grant stands", async () => {
		const folder = await createFolder(ownerKey, "Strongest");
		const deck = await createDeck(ownerKey, "Both");
		await fileDeck(ownerKey, deck.id, folder.id);
		const deckGrant = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ email: GRANTEE_EMAIL, level: "view" }),
			})
		).json();
		const folderGrant = await (
			await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit")
		).json();
		expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");

		await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators/${deckGrant.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({ level: "edit" }),
		});
		await fetch(`${baseUrl}/api/folders/${folder.id}/collaborators/${folderGrant.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({ level: "view" }),
		});
		expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");
		const listed = (await sharedWith(granteeKey)).filter(
			(entry) => entry.id === deck.id,
		);
		expect(listed.map((entry) => entry.accessLevel)).toEqual(["edit"]);
	});

	test("only the folder's owner sees or changes who it is shared with", async () => {
		const folder = await createFolder(ownerKey, "Private list");
		const grant = await (
			await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit")
		).json();
		const base = `${baseUrl}/api/folders/${folder.id}/collaborators`;

		expect((await fetch(base)).status).toBe(401);
		expect(
			(
				await fetch(base, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email: STRANGER_EMAIL }),
				})
			).status,
		).toBe(401);
		for (const key of [granteeKey, strangerKey]) {
			expect((await fetch(base, { headers: keyed(key) })).status).toBe(404);
			expect(
				(await shareFolder(key, folder.id, STRANGER_EMAIL, "edit")).status,
			).toBe(404);
			expect(
				(
					await fetch(`${base}/${grant.id}`, {
						method: "PATCH",
						headers: keyed(key),
						body: JSON.stringify({ level: "view" }),
					})
				).status,
			).toBe(404);
			expect(
				(
					await fetch(`${base}/${grant.id}`, {
						method: "DELETE",
						headers: keyed(key),
					})
				).status,
			).toBe(404);
		}
		expect(
			(await shareFolder(ownerKey, folder.id, "folder-owner@example.com", "edit"))
				.status,
		).toBe(400);
		expect(
			(await shareFolder(ownerKey, folder.id, "nobody@example.com", "edit"))
				.status,
		).toBe(404);
		// A grant id from another folder names nothing in this one.
		const other = await createFolder(ownerKey, "Other list");
		expect(
			(
				await fetch(`${baseUrl}/api/folders/${other.id}/collaborators/${grant.id}`, {
					method: "DELETE",
					headers: keyed(ownerKey),
				})
			).status,
		).toBe(404);
		expect(
			(await (await fetch(base, { headers: keyed(ownerKey) })).json()).length,
		).toBe(1);
	});

	test("a folder's grant list never carries an account id", async () => {
		const folder = await createFolder(ownerKey, "No ids");
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "comment");
		const res = await fetch(`${baseUrl}/api/folders/${folder.id}/collaborators`, {
			headers: keyed(ownerKey),
		});
		const body = await res.text();
		expect(granteeId).not.toBe("");
		expect(body).not.toContain(granteeId);
		const [entry] = JSON.parse(body);
		expect(Object.keys(entry).sort()).toEqual(
			["createdAt", "email", "id", "level", "name", "updatedAt"].sort(),
		);
		expect(entry).toMatchObject({
			email: GRANTEE_EMAIL,
			name: "Grantee",
			level: "comment",
		});
	});

	test("deleting a folder removes its grants", async () => {
		const folder = await createFolder(ownerKey, "Going");
		const deck = await createDeck(ownerKey, "Survives");
		await fileDeck(ownerKey, deck.id, folder.id);
		await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit");
		const deleted = await fetch(`${baseUrl}/api/folders/${folder.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(deleted.status).toBe(200);

		const { listFolderGrants } = await import("./services/folders");
		expect(await listFolderGrants(folder.id)).toEqual([]);
		expect(await accessLevelOn(granteeKey, deck.id)).toBeNull();
		expect(
			(await sharedWith(granteeKey)).some((entry) => entry.id === deck.id),
		).toBe(false);
	});
});
