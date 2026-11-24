/**
 * Integration tests for `GET /api/presentations`, the signed-in account's own
 * deck list projected as an audience sees it.
 *
 * The fixture holds one deck of each kind of owner: an account's, an anonymous
 * create's and a workspace's, and one more of the account's filed in its private
 * folder (REQ126). The route has to return the account's two decks to their
 * owner and nothing to anybody else, whatever `?creatorId=` says.
 *
 * Runs the real Elysia app against a throw-away in-memory zodstore and a temp
 * auth DB, like the harnesses beside it.
 */

// Env must be set before importing ./db and ./accounts (both read it at module
// load). :memory: for the domain store; a temp file for the auth DB so the
// Better Auth `user` table persists across the suite.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-deck-list-")),
	"auth.sqlite",
);

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

const NOTE = "Private cue for the presenter";
const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
		notes: NOTE,
	},
];
const PASSWORD = "correct-horse-battery";
const OWNER_EMAIL = "deck-list-owner@example.com";
const COLLABORATOR_EMAIL = "deck-list-collaborator@example.com";
const STRANGER_EMAIL = "deck-list-stranger@example.com";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

let ownerId = "";
let ownerKey = "";
let ownerCookie = "";
let collaboratorKey = "";
let strangerKey = "";
let strangerCookie = "";

let ownedDeck: AnyJson;
let folderDeck: AnyJson;
let anonymousDeck: AnyJson;
let workspaceDeck: AnyJson;

async function createDeck(
	headers: Record<string, string>,
	extra: Record<string, unknown> = {},
): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ title: "Deck", slides: SLIDES, ...extra }),
	});
	expect(response.status).toBe(201);
	return response.json();
}

async function signInCookie(email: string): Promise<string> {
	const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", origin: baseUrl },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(response.ok).toBe(true);
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

function list(
	query = "",
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations${query}`, { headers });
}

/**
 * The owner's decks, sorted by id. Two creates can share a millisecond, so the
 * tests compare the set rather than the route's newest-first order.
 */
function ownDeckIds(): string[] {
	return [folderDeck.id, ownedDeck.id].sort();
}

/** Asserts a response body names none of the fixture's decks. */
function expectNoFixtureDeck(body: string): void {
	for (const deck of [ownedDeck, folderDeck, anonymousDeck, workspaceDeck]) {
		expect(body).not.toContain(deck.id);
		expect(body).not.toContain(deck.code);
	}
}

describe("GET /api/presentations", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { workspaceRoutes } = await import("./routes/workspaces");
		const { folderRoutes } = await import("./routes/folders");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.use(workspaceRoutes)
			.use(folderRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		const accountFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: PASSWORD, name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return { userId: account.user.id, key: created.key };
		};
		const owner = await accountFor(OWNER_EMAIL, "Owner");
		ownerId = owner.userId;
		ownerKey = owner.key;
		ownerCookie = await signInCookie(OWNER_EMAIL);
		collaboratorKey = (await accountFor(COLLABORATOR_EMAIL, "Collaborator")).key;
		strangerKey = (await accountFor(STRANGER_EMAIL, "Stranger")).key;
		strangerCookie = await signInCookie(STRANGER_EMAIL);

		ownedDeck = await createDeck({ "x-api-key": ownerKey });
		anonymousDeck = await createDeck({});

		const folderResponse = await fetch(`${baseUrl}/api/folders`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ name: "Private" }),
		});
		expect(folderResponse.status).toBe(201);
		const folder = await folderResponse.json();
		folderDeck = await createDeck({ "x-api-key": ownerKey });
		const filed = await fetch(
			`${baseUrl}/api/presentations/${folderDeck.id}/folder`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ folderId: folder.id }),
			},
		);
		expect(filed.status).toBe(200);

		const shared = await fetch(
			`${baseUrl}/api/presentations/${ownedDeck.id}/collaborators`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "view" }),
			},
		);
		expect(shared.status).toBe(201);

		const workspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ name: "Team" }),
		});
		expect(workspaceResponse.status).toBe(201);
		const workspace = await workspaceResponse.json();
		workspaceDeck = await createDeck(
			{ "x-api-key": ownerKey },
			{ workspaceId: workspace.id },
		);
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

	describe("without an account", () => {
		test("answers 401 and names no deck", async () => {
			const response = await list();
			expect(response.status).toBe(401);
			expectNoFixtureDeck(await response.text());
		});

		test("answers 401 when ?creatorId= names the owner", async () => {
			const response = await list(`?creatorId=${ownerId}`);
			expect(response.status).toBe(401);
			expectNoFixtureDeck(await response.text());
		});

		test("answers 401 to an empty ?creatorId=", async () => {
			const response = await list("?creatorId=");
			expect(response.status).toBe(401);
			expectNoFixtureDeck(await response.text());
		});

		test("answers 401 to a deck's edit token, which names no account", async () => {
			const response = await list("", {
				Authorization: `Bearer ${anonymousDeck.creatorToken}`,
			});
			expect(response.status).toBe(401);
			expectNoFixtureDeck(await response.text());
		});
	});

	describe("as an account with no standing on the decks", () => {
		for (const [credential, headers] of [
			["an API key", () => ({ "x-api-key": strangerKey })],
			["a cookie session", () => ({ cookie: strangerCookie })],
		] as const) {
			test(`answers an empty list to ${credential}`, async () => {
				const response = await list("", headers());
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual([]);
			});

			test(`answers an empty list to ${credential} whose ?creatorId= names the owner`, async () => {
				const response = await list(`?creatorId=${ownerId}`, headers());
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual([]);
			});
		}

		test("answers an empty list to an empty ?creatorId=", async () => {
			const response = await list("?creatorId=", {
				"x-api-key": strangerKey,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual([]);
		});
	});

	describe("as the owner", () => {
		for (const [credential, headers] of [
			["an API key", () => ({ "x-api-key": ownerKey })],
			["a cookie session", () => ({ cookie: ownerCookie })],
		] as const) {
			test(`${credential} lists the account's own decks and no other`, async () => {
				const response = await list("", headers());
				expect(response.status).toBe(200);
				const decks = (await response.json()) as AnyJson[];
				expect(decks.map((deck) => deck.id).sort()).toEqual(ownDeckIds());
			});
		}

		test("?creatorId= with the caller's own id lists the same decks", async () => {
			const response = await list(`?creatorId=${ownerId}`, {
				"x-api-key": ownerKey,
			});
			expect(response.status).toBe(200);
			const decks = (await response.json()) as AnyJson[];
			expect(decks.map((deck) => deck.id).sort()).toEqual(ownDeckIds());
		});

		test("?creatorId= with any other id lists nothing", async () => {
			const response = await list("?creatorId=somebody-else", {
				"x-api-key": ownerKey,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual([]);
		});

		test("each entry is the audience projection, with no owner field", async () => {
			const response = await list("", { "x-api-key": ownerKey });
			const decks = (await response.json()) as AnyJson[];
			expect(decks.length).toBe(2);
			for (const deck of decks) {
				expect(deck.slides[0].notes).toBe("");
				expect(deck).not.toHaveProperty("creatorId");
				expect(deck).not.toHaveProperty("creatorTokenHash");
			}
		});
	});

	test("a collaborator reads a shared deck from /shared and not from this list", async () => {
		const response = await list("", { "x-api-key": collaboratorKey });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);

		const shared = await fetch(`${baseUrl}/api/presentations/shared`, {
			headers: { "x-api-key": collaboratorKey },
		});
		const decks = (await shared.json()) as AnyJson[];
		expect(decks.map((deck) => deck.id)).toEqual([ownedDeck.id]);
	});
});
