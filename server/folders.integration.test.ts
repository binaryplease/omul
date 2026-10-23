/**
 * Integration tests for deck folders (REQ126, slice 3).
 *
 * Drives the real routes over HTTP with real accounts, as
 * `workspaces.integration.test.ts` does: an account creates, renames and
 * deletes its folders and files the decks it owns; it is refused on a deck it
 * does not own and on another account's folder; deleting a folder leaves its
 * decks intact and unfiled.
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

const STRANGER_EMAIL = "folder-stranger@example.com";

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
});
