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
 * The deck's own collaborator list reports the accounts a folder grant reaches.
 * Deleting an account removes the folders, filings and grants that name it.
 * Creating a folder is limited per account, by a rate and by a count.
 * Listing an account's folders groups its filings in counted, linear work.
 * A `view` or `comment` grant is refused the countdown, the PDF export and the
 * answer-theme write routes, and an `edit` grant is let through on all of them.
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

/** A slide that holds answer themes (REQ114) and a slide with a clock (REQ107). */
const RESULTS_WORK_SLIDES = [
	{ id: "open", type: "open-text", question: "What should change?" },
	{ id: "clock", type: "countdown", question: "Break" },
];

function keyed(key: string): Record<string, string> {
	return { "Content-Type": "application/json", "x-api-key": key };
}

async function createDeck(
	key: string,
	title = "Deck",
	slides: Any[] = SLIDES,
): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ title, slides }),
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
		const { answerThemeRoutes } = await import("./routes/answer-themes");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.use(presentationRoutes)
			.use(answerThemeRoutes)
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

	describe("listing an account's folders", () => {
		type CountedRow = Record<string, unknown>;

		/** Wraps a row so that every field read adds one to `reads[field]`. */
		function countingRow(
			row: CountedRow,
			reads: Record<string, number>,
		): CountedRow {
			return new Proxy(row, {
				get(target, field, receiver) {
					const name = String(field);
					reads[name] = (reads[name] ?? 0) + 1;
					return Reflect.get(target, field, receiver);
				},
			});
		}

		/**
		 * Runs the real assembly over `folderCount` folders and `filingCount`
		 * filings dealt across them, and returns the reads on each kind of row.
		 */
		async function readsToAssemble(folderCount: number, filingCount: number) {
			const { assembleFolderListing } = await import("./services/folders");
			const folderReads: Record<string, number> = {};
			const filingReads: Record<string, number> = {};
			const folderRows = Array.from({ length: folderCount }, (_unused, index) =>
				countingRow(
					{
						id: `folder-${index}`,
						ownerId: "owner",
						name: `Folder ${index}`,
						createdAt: "2026-11-05T00:00:00.000Z",
						updatedAt: "2026-11-05T00:00:00.000Z",
					},
					folderReads,
				),
			);
			const filingRows = Array.from({ length: filingCount }, (_unused, index) =>
				countingRow(
					{
						folderId: `folder-${index % folderCount}`,
						presentationId: `deck-${index}`,
						ownerId: "owner",
						createdAt: new Date(index * 1000).toISOString(),
					},
					filingReads,
				),
			);
			const listing = assembleFolderListing(folderRows, filingRows);
			expect(
				listing.reduce(
					(filed, { presentationIds }) => filed + presentationIds.length,
					0,
				),
			).toBe(filingCount);
			return { folderReads, filingReads };
		}

		// Counted rather than timed, so the bound holds on any machine: a clock
		// limit under REQ133 passed on a laptop and failed on the CI runner. A scan
		// of every filing per folder reads `folderId` folders × filings times, which
		// is 10,000,000 reads at the largest size here.
		test.each([
			[1, 10_000],
			[1000, 1],
			[10, 100],
			[100, 1000],
			[1000, 10_000],
		])("%i folders and %i filings cost linear work to group", async (folderCount, filingCount) => {
			const { folderReads, filingReads } = await readsToAssemble(
				folderCount,
				filingCount,
			);
			expect(filingReads.folderId).toBe(filingCount);
			expect(filingReads.presentationId).toBe(filingCount);
			// `readFolder` reads each of a folder's five fields once.
			for (const field of ["id", "ownerId", "name", "createdAt", "updatedAt"]) {
				expect(folderReads[field]).toBe(folderCount);
			}
		});

		test("the filing sort is the only part above linear, by a logarithmic factor", async () => {
			const filingCount = 10_000;
			const { filingReads } = await readsToAssemble(100, filingCount);
			// Each comparison reads two rows' `createdAt`.
			expect(filingReads.createdAt).toBeLessThanOrEqual(
				2 * filingCount * Math.ceil(Math.log2(filingCount)),
			);
		});

		test("a filing whose folder is not listed appears in no list", async () => {
			const { assembleFolderListing } = await import("./services/folders");
			const listing = assembleFolderListing(
				[{ id: "listed", ownerId: "owner", name: "Listed" }],
				[
					{
						folderId: "gone",
						presentationId: "deck",
						createdAt: "2026-11-05T00:00:00.000Z",
					},
				],
			);
			expect(listing.map(({ presentationIds }) => presentationIds)).toEqual([
				[],
			]);
		});

		test("the routes order folders by name and filings newest first", async () => {
			const { auth } = await import("./accounts");
			const account = await auth.api.signUpEmail({
				body: {
					email: "folder-lister@example.com",
					password: "correct-horse-battery",
					name: "Lister",
				},
			});
			const { key } = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			const beta = await createFolder(key, "Beta");
			const alpha = await createFolder(key, "Alpha");
			await createFolder(key, "Gamma");
			const decks = [
				await createDeck(key),
				await createDeck(key),
				await createDeck(key),
			];
			for (const [deck, folder] of [
				[decks[0], alpha],
				[decks[1], beta],
				[decks[2], alpha],
			]) {
				// `createdAt` has millisecond resolution, and a tie keeps the store's order.
				await Bun.sleep(2);
				expect((await fileDeck(key, deck.id, folder.id)).status).toBe(200);
			}

			expect(
				(await foldersOf(key)).map(({ name, presentationIds }) => ({
					name,
					presentationIds,
				})),
			).toEqual([
				{ name: "Alpha", presentationIds: [decks[2].id, decks[0].id] },
				{ name: "Beta", presentationIds: [decks[1].id] },
				{ name: "Gamma", presentationIds: [] },
			]);

			const renamed = await fetch(`${baseUrl}/api/folders/${alpha.id}`, {
				method: "PATCH",
				headers: keyed(key),
				body: JSON.stringify({ name: "Alpha renamed" }),
			});
			expect(renamed.status).toBe(200);
			expect((await renamed.json()).presentationIds).toEqual([
				decks[2].id,
				decks[0].id,
			]);
		});
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

	describe("the countdown, the PDF export and the answer-theme writes", () => {
		/**
		 * A started deck filed in a folder shared at `level`, holding one submitted
		 * answer and one theme. Every id is real, so a route that let the grantee
		 * through would answer with success and never with a `404`.
		 */
		async function deckInSharedFolder(level: string) {
			const folder = await createFolder(ownerKey, `Results work ${level}`);
			const deck = await createDeck(
				ownerKey,
				"Results work",
				RESULTS_WORK_SLIDES,
			);
			expect((await fileDeck(ownerKey, deck.id, folder.id)).status).toBe(200);
			expect(
				(await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, level)).status,
			).toBe(201);

			const started = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/start`,
				{ method: "POST", headers: keyed(ownerKey) },
			);
			expect(started.status).toBe(200);
			const vote = await fetch(`${baseUrl}/api/presentations/${deck.id}/vote`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slideId: "open",
					value: "Ship faster",
					participantId: "alice",
				}),
			});
			expect(vote.status).toBe(200);
			const results = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}/results/open`, {
					headers: keyed(ownerKey),
				})
			).json();
			const answerId: string = results.responses[0].id;

			const created = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/slides/open/answer-themes`,
				{
					method: "POST",
					headers: keyed(ownerKey),
					body: JSON.stringify({ name: "Speed" }),
				},
			);
			expect(created.status).toBe(201);
			return { folder, deck, answerId, theme: await created.json() };
		}

		/**
		 * The routes under test, each paired with what an `edit` grant answers. The
		 * delete comes last, because the rename and the grouping need the theme.
		 */
		function resultsWorkRoutes(
			deckId: string,
			themeId: string,
			answerId: string,
		): { name: string; allowed: number; call: () => Promise<Response> }[] {
			const deckUrl = `${baseUrl}/api/presentations/${deckId}`;
			const themesUrl = `${deckUrl}/slides/open/answer-themes`;
			const headers = keyed(granteeKey);
			return [
				{
					name: "countdown",
					allowed: 200,
					call: () =>
						fetch(`${deckUrl}/countdown`, {
							method: "POST",
							headers,
							body: JSON.stringify({ slideId: "clock", action: "start" }),
						}),
				},
				{
					name: "deck.pdf",
					allowed: 200,
					call: () => fetch(`${deckUrl}/deck.pdf`, { headers }),
				},
				{
					name: "deck.pdf?results=false",
					allowed: 200,
					call: () => fetch(`${deckUrl}/deck.pdf?results=false`, { headers }),
				},
				{
					name: "create theme",
					allowed: 201,
					call: () =>
						fetch(themesUrl, {
							method: "POST",
							headers,
							body: JSON.stringify({ name: "From a grantee" }),
						}),
				},
				{
					name: "rename theme",
					allowed: 200,
					call: () =>
						fetch(`${themesUrl}/${themeId}`, {
							method: "PATCH",
							headers,
							body: JSON.stringify({ name: "Renamed by a grantee" }),
						}),
				},
				{
					name: "group answer",
					allowed: 200,
					call: () =>
						fetch(`${deckUrl}/answers/${answerId}/answer-theme`, {
							method: "PUT",
							headers,
							body: JSON.stringify({ themeId }),
						}),
				},
				{
					name: "delete theme",
					allowed: 200,
					call: () =>
						fetch(`${themesUrl}/${themeId}`, { method: "DELETE", headers }),
				},
			];
		}

		test.each(["view", "comment"])("a %s grant is refused on all of them and changes nothing", async (level) => {
			const { deck, answerId, theme } = await deckInSharedFolder(level);
			expect(await accessLevelOn(granteeKey, deck.id)).toBe(level);

			for (const { name, call } of resultsWorkRoutes(
				deck.id,
				theme.id,
				answerId,
			)) {
				const res = await call();
				expect(`${name}:${res.status}`).toBe(`${name}:403`);
			}

			const themes = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/slides/open/answer-themes`,
				{ headers: keyed(ownerKey) },
			);
			expect((await themes.json()).themes).toEqual([theme]);
			const read = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: keyed(ownerKey),
			});
			expect((await read.json()).countdownRuns).toEqual({});
		});

		test("the same requests pass once the owner raises the grant to edit", async () => {
			const { folder, deck, answerId, theme } =
				await deckInSharedFolder("comment");
			expect(
				(await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, "edit")).status,
			).toBe(200);

			for (const { name, allowed, call } of resultsWorkRoutes(
				deck.id,
				theme.id,
				answerId,
			)) {
				const res = await call();
				expect(`${name}:${res.status}`).toBe(`${name}:${allowed}`);
			}
		});
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

	describe("the deck's collaborator list reports folder access", () => {
		function shareDeck(key: string, deckId: string, level: string) {
			return fetch(`${baseUrl}/api/presentations/${deckId}/collaborators`, {
				method: "POST",
				headers: keyed(key),
				body: JSON.stringify({ email: GRANTEE_EMAIL, level }),
			});
		}

		async function deckList(deckId: string): Promise<Any[]> {
			const res = await fetch(
				`${baseUrl}/api/presentations/${deckId}/collaborators`,
				{ headers: keyed(ownerKey) },
			);
			expect(res.status).toBe(200);
			return res.json();
		}

		async function filedAndShared(level: string) {
			const folder = await createFolder(ownerKey, "Reported");
			const deck = await createDeck(ownerKey, "Reported deck");
			await fileDeck(ownerKey, deck.id, folder.id);
			const grant = await (
				await shareFolder(ownerKey, folder.id, GRANTEE_EMAIL, level)
			).json();
			return { folder, deck, grant };
		}

		test("an account keeps its row after its deck grant is revoked", async () => {
			const { folder, deck, grant } = await filedAndShared("comment");
			const deckGrant = await (await shareDeck(ownerKey, deck.id, "edit")).json();

			const both = await deckList(deck.id);
			expect(both.map((entry) => [entry.id, entry.level, entry.folder])).toEqual(
				[
					[deckGrant.id, "edit", null],
					[grant.id, "comment", { id: folder.id, name: "Reported" }],
				],
			);

			const revoked = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/collaborators/${deckGrant.id}`,
				{ method: "DELETE", headers: keyed(ownerKey) },
			);
			expect(revoked.status).toBe(200);

			expect(await deckList(deck.id)).toEqual([
				{
					id: grant.id,
					email: GRANTEE_EMAIL,
					name: "Grantee",
					level: "comment",
					createdAt: grant.createdAt,
					updatedAt: grant.updatedAt,
					folder: { id: folder.id, name: "Reported" },
				},
			]);
			expect(await accessLevelOn(granteeKey, deck.id)).toBe("comment");
		});

		test("the row follows a level change on the folder grant", async () => {
			const { folder, deck, grant } = await filedAndShared("view");
			await fetch(`${baseUrl}/api/folders/${folder.id}/collaborators/${grant.id}`, {
				method: "PATCH",
				headers: keyed(ownerKey),
				body: JSON.stringify({ level: "edit" }),
			});
			expect((await deckList(deck.id))[0].level).toBe("edit");
			expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");
		});

		test("no account identifier is in the payload", async () => {
			const { deck } = await filedAndShared("view");
			await shareDeck(ownerKey, deck.id, "view");
			const res = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/collaborators`,
				{ headers: keyed(ownerKey) },
			);
			const body = await res.text();
			expect(granteeId).not.toBe("");
			expect(body).not.toContain(granteeId);
			const entries: Any[] = JSON.parse(body);
			expect(entries).toHaveLength(2);
			for (const entry of entries) {
				expect(Object.keys(entry).sort()).toEqual(
					[
						"createdAt",
						"email",
						"folder",
						"id",
						"level",
						"name",
						"updatedAt",
					].sort(),
				);
			}
		});

		test("only who reads the deck's grants reads the folder access", async () => {
			const { deck } = await filedAndShared("edit");
			const url = `${baseUrl}/api/presentations/${deck.id}/collaborators`;
			expect((await fetch(url)).status).toBe(401);
			expect((await fetch(url, { headers: keyed(strangerKey) })).status).toBe(403);
			expect((await fetch(url, { headers: keyed(granteeKey) })).status).toBe(403);
			expect(
				(
					await fetch(url, {
						headers: { Authorization: `Bearer ${deck.creatorToken}` },
					})
				).status,
			).toBe(401);
		});

		test("the deck's routes cannot change or revoke a folder grant", async () => {
			const { deck, grant } = await filedAndShared("edit");
			const url = `${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`;
			const patched = await fetch(url, {
				method: "PATCH",
				headers: keyed(ownerKey),
				body: JSON.stringify({ level: "view" }),
			});
			expect(patched.status).toBe(404);
			const deleted = await fetch(url, {
				method: "DELETE",
				headers: keyed(ownerKey),
			});
			expect(deleted.status).toBe(404);
			expect(await accessLevelOn(granteeKey, deck.id)).toBe("edit");
			expect((await deckList(deck.id)).map((entry) => entry.id)).toEqual([
				grant.id,
			]);
		});

		test("the row ends when the folder grant no longer reaches the deck", async () => {
			const revokedCase = await filedAndShared("view");
			await fetch(
				`${baseUrl}/api/folders/${revokedCase.folder.id}/collaborators/${revokedCase.grant.id}`,
				{ method: "DELETE", headers: keyed(ownerKey) },
			);
			expect(await deckList(revokedCase.deck.id)).toEqual([]);

			const unfiledCase = await filedAndShared("view");
			await fileDeck(ownerKey, unfiledCase.deck.id, null);
			expect(await deckList(unfiledCase.deck.id)).toEqual([]);
			expect(await accessLevelOn(granteeKey, unfiledCase.deck.id)).toBeNull();
		});

		test("a stale filing under another owner reports no folder access", async () => {
			const { deck } = await filedAndShared("edit");
			const { createStore } = await import("./db");
			const { StoredPresentationSchema } = await import("./schemas");
			const { findUserByEmail } = await import("./accounts");
			const store = createStore("presentations", StoredPresentationSchema);
			await store.update(deck.id, {
				creatorId: findUserByEmail(STRANGER_EMAIL)?.id ?? null,
			});

			const res = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/collaborators`,
				{ headers: keyed(strangerKey) },
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual([]);
			expect(await accessLevelOn(granteeKey, deck.id)).toBeNull();
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

	describe("limits on creating a folder", () => {
		let limitedCounter = 0;

		/** A new account, so its window and its count start empty. */
		async function limitedAccount(): Promise<{ id: string; key: string }> {
			const { auth } = await import("./accounts");
			limitedCounter += 1;
			const account = await auth.api.signUpEmail({
				body: {
					email: `folder-limited-${limitedCounter}@example.com`,
					password: "correct-horse-battery",
					name: "Limited",
				},
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return { id: account.user.id, key: created.key };
		}

		function postFolder(key: string, name = "Limited"): Promise<Response> {
			return fetch(`${baseUrl}/api/folders`, {
				method: "POST",
				headers: keyed(key),
				body: JSON.stringify({ name }),
			});
		}

		/** Run `body` with the rate limits switched as named, then restore them. */
		async function withLimits(
			disabled: "true" | "false",
			body: () => Promise<void>,
		): Promise<void> {
			const { resetRateLimits } = await import("./rate-limit");
			const inherited = process.env.OMUL_RATE_LIMITS_DISABLED;
			process.env.OMUL_RATE_LIMITS_DISABLED = disabled;
			resetRateLimits();
			try {
				await body();
			} finally {
				if (inherited === undefined) {
					delete process.env.OMUL_RATE_LIMITS_DISABLED;
				} else {
					process.env.OMUL_RATE_LIMITS_DISABLED = inherited;
				}
				resetRateLimits();
			}
		}

		/** Give the account `count` folders past the route, spending no window. */
		async function seedFolders(accountId: string, count: number): Promise<void> {
			const { createFolder: insertFolder } = await import("./services/folders");
			for (let seeded = 0; seeded < count; seeded++) {
				await insertFolder(accountId, `Seeded ${seeded}`);
			}
		}

		test("past the window the route answers 429, whichever key the account uses", async () => {
			const { auth } = await import("./accounts");
			const { FOLDER_CREATE_RULE } = await import("./rate-limit");
			await withLimits("false", async () => {
				const account = await limitedAccount();
				const made: Any[] = [];
				for (let sent = 0; sent < FOLDER_CREATE_RULE.limit; sent++) {
					const response = await postFolder(account.key);
					expect(response.status).toBe(201);
					made.push(await response.json());
				}

				const refused = await postFolder(account.key);
				expect(refused.status).toBe(429);
				const retryAfter = Number(refused.headers.get("Retry-After"));
				expect(retryAfter).toBeGreaterThan(0);
				const body = await refused.json();
				expect(body.retryAfterSeconds).toBe(retryAfter);
				expect(body.error).toContain("folders");
				expect(body).not.toHaveProperty("id");
				expect(await foldersOf(account.key)).toHaveLength(
					FOLDER_CREATE_RULE.limit,
				);

				// A second personal API key is the same account, so the same count.
				const secondKey = await auth.api.createApiKey({
					body: { userId: account.id, name: "second" },
				});
				expect((await postFolder(secondKey.key)).status).toBe(429);

				// Deleting a folder frees no creation: delete-and-recreate would
				// otherwise mint a fresh share budget per round.
				const removed = await fetch(`${baseUrl}/api/folders/${made[0].id}`, {
					method: "DELETE",
					headers: keyed(account.key),
				});
				expect(removed.status).toBe(200);
				expect((await postFolder(account.key)).status).toBe(429);

				// Another account's window is its own.
				const other = await limitedAccount();
				expect((await postFolder(other.key)).status).toBe(201);
			});
		});

		test("the environment switch lifts the window without emptying it", async () => {
			const { FOLDER_CREATE_RULE } = await import("./rate-limit");
			await withLimits("false", async () => {
				const account = await limitedAccount();
				for (let sent = 0; sent < FOLDER_CREATE_RULE.limit; sent++) {
					expect((await postFolder(account.key)).status).toBe(201);
				}
				expect((await postFolder(account.key)).status).toBe(429);

				process.env.OMUL_RATE_LIMITS_DISABLED = "true";
				expect((await postFolder(account.key)).status).toBe(201);

				process.env.OMUL_RATE_LIMITS_DISABLED = "false";
				expect((await postFolder(account.key)).status).toBe(429);
			});
		});

		test("an account at the cap answers 409 until it deletes a folder", async () => {
			const { FOLDERS_PER_ACCOUNT_LIMIT } = await import("./services/folders");
			await withLimits("false", async () => {
				const account = await limitedAccount();
				await seedFolders(account.id, FOLDERS_PER_ACCOUNT_LIMIT);

				const refused = await postFolder(account.key);
				expect(refused.status).toBe(409);
				expect((await refused.json()).error).toContain(
					String(FOLDERS_PER_ACCOUNT_LIMIT),
				);
				const held = await foldersOf(account.key);
				expect(held).toHaveLength(FOLDERS_PER_ACCOUNT_LIMIT);

				// Another account's count is its own.
				const other = await limitedAccount();
				expect((await postFolder(other.key)).status).toBe(201);

				const removed = await fetch(`${baseUrl}/api/folders/${held[0].id}`, {
					method: "DELETE",
					headers: keyed(account.key),
				});
				expect(removed.status).toBe(200);
				expect((await postFolder(account.key)).status).toBe(201);
				expect(await foldersOf(account.key)).toHaveLength(
					FOLDERS_PER_ACCOUNT_LIMIT,
				);
			});
		});

		test("the environment switch does not lift the cap", async () => {
			const { FOLDERS_PER_ACCOUNT_LIMIT } = await import("./services/folders");
			await withLimits("true", async () => {
				const account = await limitedAccount();
				await seedFolders(account.id, FOLDERS_PER_ACCOUNT_LIMIT);
				expect((await postFolder(account.key)).status).toBe(409);
			});
		});

		test("creations in flight together cannot pass the cap", async () => {
			const { createFolder: insertFolder, FOLDERS_PER_ACCOUNT_LIMIT } =
				await import("./services/folders");
			const account = await limitedAccount();
			await seedFolders(account.id, FOLDERS_PER_ACCOUNT_LIMIT - 1);

			// One tick, at the service: the HTTP race rarely reaches the gap
			// between the count and the insert.
			const results = await Promise.all(
				Array.from({ length: 5 }, (_unused, attempt) =>
					insertFolder(account.id, `Racing ${attempt}`),
				),
			);
			expect(results.filter((created) => created !== null)).toHaveLength(1);
			expect(await foldersOf(account.key)).toHaveLength(
				FOLDERS_PER_ACCOUNT_LIMIT,
			);
		});
	});

	describe("deleting an account", () => {
		const PASSWORD = "correct-horse-battery";
		let accountCounter = 0;

		/** A new account with its own session, so deleting it costs no other test. */
		async function newAccount(): Promise<{
			id: string;
			email: string;
			key: string;
			cookie: string;
		}> {
			const { auth } = await import("./accounts");
			accountCounter += 1;
			const email = `folder-leaver-${accountCounter}@example.com`;
			const signedUp = await auth.api.signUpEmail({
				body: { email, password: PASSWORD, name: "Leaver" },
				asResponse: true,
			});
			expect(signedUp.ok).toBe(true);
			const id = ((await signedUp.json()) as Any).user.id as string;
			const created = await auth.api.createApiKey({
				body: { userId: id, name: "k" },
			});
			const cookie = signedUp.headers
				.getSetCookie()
				.map((setCookie) => setCookie.split(";")[0])
				.join("; ");
			return { id, email, key: created.key, cookie };
		}

		/** `POST /api/auth/delete-user`, the route the account screen calls. */
		async function postDeletion(
			cookie: string,
			body: { password?: string },
		): Promise<Response> {
			const { auth } = await import("./accounts");
			return auth.handler(
				new Request("http://localhost:3000/api/auth/delete-user", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						origin: "http://localhost:3000",
						cookie,
					},
					body: JSON.stringify(body),
				}),
			);
		}

		function deleteAccount(
			cookie: string,
			password: string = PASSWORD,
		): Promise<Response> {
			return postDeletion(cookie, { password });
		}

		/** An account with a filed deck in a folder another account reads at `view`. */
		async function accountWithSharedFolder() {
			const leaver = await newAccount();
			const grantee = await newAccount();
			const folder = await createFolder(leaver.key, "Shared");
			const deck = await createDeck(leaver.key, "Filed");
			expect((await fileDeck(leaver.key, deck.id, folder.id)).status).toBe(200);
			await shareFolder(leaver.key, folder.id, grantee.email, "view");
			return { leaver, grantee, deck };
		}

		/** The three collections read directly, past every function under test. */
		async function collections() {
			const { createStore } = await import("./db");
			const {
				StoredFolderEntrySchema,
				StoredFolderGrantSchema,
				StoredFolderSchema,
			} = await import("./schemas");
			return {
				folders: createStore("folders", StoredFolderSchema),
				entries: createStore("folderEntries", StoredFolderEntrySchema),
				grants: createStore("folderGrants", StoredFolderGrantSchema),
			};
		}

		async function rowsNaming(userId: string): Promise<unknown[]> {
			const { folders, entries, grants } = await collections();
			return [
				...(await folders.find({ ownerId: userId })),
				...(await entries.find({ ownerId: userId })),
				...(await grants.find({ userId })),
			];
		}

		test("deleting a folder's owner removes its rows and every grantee's access", async () => {
			const leaver = await newAccount();
			const grantee = await newAccount();
			const folder = await createFolder(leaver.key, "Leaving");
			const deck = await createDeck(leaver.key, "Filed");
			expect((await fileDeck(leaver.key, deck.id, folder.id)).status).toBe(200);
			await shareFolder(leaver.key, folder.id, grantee.email, "edit");
			expect(await accessLevelOn(grantee.key, deck.id)).toBe("edit");
			expect((await renameDeck(grantee.key, deck.id)).status).toBe(200);
			expect((await sharedWith(grantee.key)).map((entry) => entry.id)).toContain(
				deck.id,
			);

			expect((await deleteAccount(leaver.cookie)).status).toBe(200);

			expect(await rowsNaming(leaver.id)).toEqual([]);
			const { entries, folders, grants } = await collections();
			expect(await folders.findOne(folder.id)).toBeNull();
			expect(await entries.find({ folderId: folder.id })).toEqual([]);
			expect(await entries.find({ presentationId: deck.id })).toEqual([]);
			expect(await grants.find({ folderId: folder.id })).toEqual([]);

			expect(await accessLevelOn(grantee.key, deck.id)).toBeNull();
			expect((await renameDeck(grantee.key, deck.id)).status).toBe(403);
			expect((await sharedWith(grantee.key)).map((entry) => entry.id)).not.toContain(
				deck.id,
			);
		});

		test("deleting a grantee removes its grant and leaves the folder to its owner", async () => {
			const owner = await newAccount();
			const leaver = await newAccount();
			const remaining = await newAccount();
			const folder = await createFolder(owner.key, "Kept");
			const deck = await createDeck(owner.key, "Filed");
			expect((await fileDeck(owner.key, deck.id, folder.id)).status).toBe(200);
			await shareFolder(owner.key, folder.id, leaver.email, "edit");
			await shareFolder(owner.key, folder.id, remaining.email, "comment");
			const ownFolder = await createFolder(leaver.key, "Its own");
			expect(await accessLevelOn(leaver.key, deck.id)).toBe("edit");

			expect((await deleteAccount(leaver.cookie)).status).toBe(200);

			expect(await rowsNaming(leaver.id)).toEqual([]);
			const { folders } = await collections();
			expect(await folders.findOne(ownFolder.id)).toBeNull();

			// A key that outlives its account (REQ182) resolves to nobody.
			expect(await accessLevelOn(leaver.key, deck.id)).toBeNull();
			expect((await renameDeck(leaver.key, deck.id)).status).toBe(401);

			const { folderAccessLevelFor } = await import("./services/folders");
			expect(await folderAccessLevelFor(deck.id, owner.id, leaver.id)).toBeNull();

			// Everybody else's standing is unchanged.
			const listed = await fetch(
				`${baseUrl}/api/folders/${folder.id}/collaborators`,
				{ headers: keyed(owner.key) },
			);
			expect(((await listed.json()) as Any[]).map((grant) => grant.email)).toEqual(
				[remaining.email],
			);
			expect(await accessLevelOn(remaining.key, deck.id)).toBe("comment");
			expect((await foldersOf(owner.key)).map((entry) => entry.id)).toEqual([
				folder.id,
			]);
		});

		test("a refused deletion removes nothing", async () => {
			const leaver = await newAccount();
			const grantee = await newAccount();
			const folder = await createFolder(leaver.key, "Staying");
			const deck = await createDeck(leaver.key, "Filed");
			expect((await fileDeck(leaver.key, deck.id, folder.id)).status).toBe(200);
			await shareFolder(leaver.key, folder.id, grantee.email, "view");

			const refused = await deleteAccount(leaver.cookie, "not-the-password");
			expect(refused.status).toBe(400);

			expect(await rowsNaming(leaver.id)).toHaveLength(2);
			expect(await accessLevelOn(grantee.key, deck.id)).toBe("view");
		});

		// This table and the test after it record what Better Auth's `/delete-user`
		// does today. The table has to change if the server starts to require a
		// password.
		test.each([
			["no password", {}],
			["an empty password", { password: "" }],
		])("a session under a day old deletes with %s, and the sweep runs", async (_label, body) => {
			const { leaver, grantee, deck } = await accountWithSharedFolder();

			expect((await postDeletion(leaver.cookie, body)).status).toBe(200);

			expect(await rowsNaming(leaver.id)).toEqual([]);
			expect(await accessLevelOn(grantee.key, deck.id)).toBeNull();
		});

		test("a session over a day old needs the password, and a refusal removes nothing", async () => {
			const { auth } = await import("./accounts");
			const { leaver, grantee, deck } = await accountWithSharedFolder();
			const context = await auth.$context;
			await context.adapter.updateMany({
				model: "session",
				where: [{ field: "userId", value: leaver.id }],
				update: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
			});

			for (const body of [{}, { password: "" }]) {
				expect((await postDeletion(leaver.cookie, body)).status).toBe(400);
				expect(await rowsNaming(leaver.id)).toHaveLength(2);
				expect(await accessLevelOn(grantee.key, deck.id)).toBe("view");
			}

			expect((await deleteAccount(leaver.cookie)).status).toBe(200);
			expect(await rowsNaming(leaver.id)).toEqual([]);
		});

		test("a row written while the deletion runs goes with the account", async () => {
			const { auth } = await import("./accounts");
			const { createFolder: insertFolder, grantFolderAccess } = await import(
				"./services/folders"
			);
			const leaver = await newAccount();
			const owner = await newAccount();
			const folder = await createFolder(owner.key, "Shared late");

			const deletionOptions = (await auth.$context).options.user?.deleteUser;
			const firstSweep = deletionOptions?.beforeDelete;
			if (!deletionOptions || !firstSweep) {
				throw new Error("the deletion route has no beforeDelete sweep");
			}
			deletionOptions.beforeDelete = async (user) => {
				await firstSweep(user);
				await insertFolder(leaver.id, "Created in flight");
				await grantFolderAccess(folder.id, leaver.id, "edit");
				expect(await rowsNaming(leaver.id)).toHaveLength(2);
			};
			try {
				expect((await deleteAccount(leaver.cookie)).status).toBe(200);
			} finally {
				deletionOptions.beforeDelete = firstSweep;
			}

			expect(await rowsNaming(leaver.id)).toEqual([]);
		});
	});
});
