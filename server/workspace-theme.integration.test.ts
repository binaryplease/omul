/**
 * Integration tests for a workspace's default deck theme (REQ086).
 *
 * The requirement is one claim with two halves, and both are claims about the
 * server, so this suite drives them over HTTP with real accounts:
 *
 *   - **a workspace carries a default theme applied to every deck created in
 *     it** — set by the workspace's owner alone, read by every member, and
 *     applied by the create path to a deck that names no theme of its own;
 *   - **overridable per deck** — a create that names a theme keeps it, and a
 *     deck can change its own theme afterwards.
 *
 * Around those, what the default must *not* do: reach a personal deck, re-theme
 * a deck that already exists, or re-theme a deck moved in later. And the stored
 * shape — a workspace written before the field existed still parses, onto the
 * house theme.
 *
 * Stands up the real Elysia app against a throw-away in-memory docstore and a
 * temp auth DB, exactly as `workspaces.integration.test.ts` does.
 */

// Env must be set before importing ./db and ./accounts (both read it at module
// load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CreatePresentationSchema,
	DEFAULT_DECK_THEME,
	StoredWorkspaceSchema,
	WorkspaceDefaultThemeSchema,
	WorkspaceSchema,
} from "./schemas";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-workspace-theme-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

let ownerKey = "";
let adminKey = "";
let memberKey = "";
let strangerKey = "";

const OWNER_EMAIL = "theme-owner@example.com";
const ADMIN_EMAIL = "theme-admin@example.com";
const MEMBER_EMAIL = "theme-member@example.com";
const STRANGER_EMAIL = "theme-stranger@example.com";

const SLIDES = [{ id: "s1", type: "text", question: "Hello" }];

function keyed(key: string): Record<string, string> {
	return { "Content-Type": "application/json", "x-api-key": key };
}

/** A workspace owned by `ownerKey`'s account, with an admin and a member in it. */
async function createStaffedWorkspace(): Promise<Any> {
	const created = await fetch(`${baseUrl}/api/workspaces`, {
		method: "POST",
		headers: keyed(ownerKey),
		body: JSON.stringify({ name: "Themed" }),
	});
	expect(created.status).toBe(201);
	const workspace = await created.json();
	for (const [email, role] of [
		[ADMIN_EMAIL, "admin"],
		[MEMBER_EMAIL, "member"],
	] as const) {
		const added = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ email, role }),
			},
		);
		expect(added.status).toBe(201);
	}
	return workspace;
}

function setDefaultTheme(
	workspaceId: string,
	headers: Record<string, string>,
	body: unknown,
): Promise<Response> {
	return fetch(`${baseUrl}/api/workspaces/${workspaceId}/default-theme`, {
		method: "PUT",
		headers,
		body: JSON.stringify(body),
	});
}

/** Create a deck with `key`, merging `fields` into an otherwise ordinary body. */
async function createDeck(
	key: string,
	fields: Record<string, unknown> = {},
): Promise<Any> {
	const created = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ title: "Deck", slides: SLIDES, ...fields }),
	});
	expect(created.status).toBe(201);
	return created.json();
}

async function readDeck(deckId: string, key: string): Promise<Any> {
	const read = await fetch(`${baseUrl}/api/presentations/${deckId}`, {
		headers: { "x-api-key": key },
	});
	expect(read.status).toBe(200);
	return read.json();
}

describe("the stored and wire shapes (REQ086)", () => {
	test("a workspace written before the field existed parses onto the house theme", () => {
		const stored = StoredWorkspaceSchema.parse({
			id: "w1",
			name: "Old",
			createdBy: "u1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(stored.defaultTheme).toBe(DEFAULT_DECK_THEME);
		expect(WorkspaceSchema.parse({ id: "w1" }).defaultTheme).toBe(
			DEFAULT_DECK_THEME,
		);
	});

	test("the default is a built-in theme — never `custom`, never a made-up one", () => {
		expect(
			WorkspaceDefaultThemeSchema.safeParse({ defaultTheme: "ember" }).success,
		).toBe(true);
		for (const defaultTheme of ["custom", "neon", undefined]) {
			expect(
				WorkspaceDefaultThemeSchema.safeParse({ defaultTheme }).success,
			).toBe(false);
		}
		expect(
			StoredWorkspaceSchema.safeParse({ id: "w1", defaultTheme: "custom" })
				.success,
		).toBe(false);
	});

	test("a create that names no theme says so, rather than naming the house theme", () => {
		// The two are different requests now: the first takes the workspace's
		// default, the second keeps `signal` whatever the workspace says.
		const unstated = CreatePresentationSchema.parse({
			title: "Deck",
			slides: SLIDES,
		});
		expect(unstated.theme).toBeNull();
		const stated = CreatePresentationSchema.parse({
			title: "Deck",
			slides: SLIDES,
			theme: DEFAULT_DECK_THEME,
		});
		expect(stated.theme).toBe(DEFAULT_DECK_THEME);
	});
});

describe("a workspace's default deck theme (REQ086)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { workspaceRoutes } = await import("./routes/workspaces");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.use(workspaceRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		const keyFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: "correct-horse-battery", name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return created.key;
		};
		ownerKey = await keyFor(OWNER_EMAIL, "Owner");
		adminKey = await keyFor(ADMIN_EMAIL, "Admin");
		memberKey = await keyFor(MEMBER_EMAIL, "Member");
		strangerKey = await keyFor(STRANGER_EMAIL, "Stranger");
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

	test("a new workspace starts on the house theme", async () => {
		const workspace = await createStaffedWorkspace();
		expect(workspace.defaultTheme).toBe(DEFAULT_DECK_THEME);
	});

	test("the owner sets it, every member reads it, and nobody else may change it", async () => {
		const workspace = await createStaffedWorkspace();

		// Renaming's role check, so an admin is refused as firmly as a member.
		for (const key of [adminKey, memberKey, strangerKey]) {
			const refused = await setDefaultTheme(workspace.id, keyed(key), {
				defaultTheme: "ember",
			});
			expect(refused.status).toBe(403);
		}
		const anonymous = await setDefaultTheme(
			workspace.id,
			{ "Content-Type": "application/json" },
			{ defaultTheme: "ember" },
		);
		expect(anonymous.status).toBe(401);

		const set = await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "ember",
		});
		expect(set.status).toBe(200);
		const updated = await set.json();
		expect(updated.defaultTheme).toBe("ember");
		expect(updated.role).toBe("owner");

		const asMember = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(asMember.defaultTheme).toBe("ember");
	});

	test("a theme outside the built-in set is refused, and so is no theme at all", async () => {
		const workspace = await createStaffedWorkspace();
		for (const body of [
			{ defaultTheme: "custom" },
			{ defaultTheme: "neon" },
			{},
		]) {
			const refused = await setDefaultTheme(
				workspace.id,
				keyed(ownerKey),
				body,
			);
			expect(refused.status).toBe(422);
		}
		const unchanged = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(unchanged.defaultTheme).toBe(DEFAULT_DECK_THEME);
	});

	test("a deck created in the workspace without a theme starts in its default", async () => {
		const workspace = await createStaffedWorkspace();
		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "pulse",
		});
		// Any member creating, not only the owner who chose it.
		const deck = await createDeck(memberKey, { workspaceId: workspace.id });
		expect(deck.theme).toBe("pulse");
		expect((await readDeck(deck.id, memberKey)).theme).toBe("pulse");
	});

	test("a deck created with a theme keeps it — the house theme included", async () => {
		const workspace = await createStaffedWorkspace();
		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "pulse",
		});
		const editorial = await createDeck(memberKey, {
			workspaceId: workspace.id,
			theme: "editorial",
		});
		expect(editorial.theme).toBe("editorial");
		// Naming the house theme is a choice, not an absence.
		const signal = await createDeck(memberKey, {
			workspaceId: workspace.id,
			theme: DEFAULT_DECK_THEME,
		});
		expect(signal.theme).toBe(DEFAULT_DECK_THEME);
	});

	test("a personal deck still gets the house theme", async () => {
		const workspace = await createStaffedWorkspace();
		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "broadcast",
		});
		// The same account that set the workspace's default, creating for itself.
		const personal = await createDeck(ownerKey);
		expect(personal.workspaceId).toBeNull();
		expect(personal.theme).toBe(DEFAULT_DECK_THEME);
	});

	test("changing the default re-themes no deck, and a deck moved in keeps its own", async () => {
		const workspace = await createStaffedWorkspace();
		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "pulse",
		});
		const existing = await createDeck(memberKey, { workspaceId: workspace.id });
		expect(existing.theme).toBe("pulse");

		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "ember",
		});
		expect((await readDeck(existing.id, memberKey)).theme).toBe("pulse");

		const personal = await createDeck(ownerKey);
		expect(personal.theme).toBe(DEFAULT_DECK_THEME);
		const moved = await fetch(
			`${baseUrl}/api/presentations/${personal.id}/workspace`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ workspaceId: workspace.id }),
			},
		);
		expect(moved.status).toBe(200);
		expect((await moved.json()).theme).toBe(DEFAULT_DECK_THEME);
	});

	test("a deck that took the default can still choose its own", async () => {
		const workspace = await createStaffedWorkspace();
		await setDefaultTheme(workspace.id, keyed(ownerKey), {
			defaultTheme: "pulse",
		});
		const deck = await createDeck(memberKey, { workspaceId: workspace.id });
		const patched = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers: keyed(memberKey),
			body: JSON.stringify({ theme: "editorial" }),
		});
		expect(patched.status).toBe(200);
		expect((await readDeck(deck.id, memberKey)).theme).toBe("editorial");
	});
});
