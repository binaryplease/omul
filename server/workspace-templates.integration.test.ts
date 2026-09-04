/**
 * Integration tests for publishing a deck as a workspace template (REQ004).
 *
 * The requirement is two sentences, and this suite drives both of them over HTTP
 * with real accounts rather than checking that a control is drawn:
 *
 *   - **"published as a template within its workspace and instantiated by other
 *     members"** — an entry a workspace publishes is readable by every member of
 *     that workspace, by nobody outside it, and a *different* member can turn it
 *     into a deck the workspace owns. Who may publish is decided on the server,
 *     against the caller's role, on every request: a non-member and a member
 *     whose role may not publish are both refused, and a workspace that does not
 *     exist answers exactly what one the caller is not in answers.
 *   - **"The instance is an independent deck; later edits to the template do not
 *     reach it"** — the two are driven apart and then each is edited: the deck
 *     shares no slide id with the entry, editing the entry (by republishing its
 *     source deck) changes nothing about a deck already made, and editing that
 *     deck changes nothing about the entry. Independence is *shown*, not
 *     asserted in a comment.
 *
 * Stands up the real Elysia app (auth handler + presentation routes + workspace
 * routes) against a throw-away in-memory docstore and a temp auth DB, exactly as
 * `workspaces.integration.test.ts` does — it is the neighbour this extends.
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
	mkdtempSync(join(tmpdir(), "omul-workspace-templates-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Every account is driven through a personal API key, like the suite next door.
let ownerKey = "";
let adminKey = "";
let memberKey = "";
let strangerKey = "";

const OWNER_EMAIL = "wt-owner@example.com";
const ADMIN_EMAIL = "wt-admin@example.com";
const MEMBER_EMAIL = "wt-member@example.com";
const STRANGER_EMAIL = "wt-stranger@example.com";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "How did the sprint go?",
		options: [
			{ id: "a", text: "Well" },
			{ id: "b", text: "Less well" },
		],
	},
	{
		id: "s2",
		type: "word-cloud",
		question: "One word for it",
	},
];

function keyed(key: string): Record<string, string> {
	return { "Content-Type": "application/json", "x-api-key": key };
}

/** A workspace owned by `ownerKey`'s account, with the other two accounts in it. */
async function createStaffedWorkspace(name = "Team"): Promise<Any> {
	const created = await fetch(`${baseUrl}/api/workspaces`, {
		method: "POST",
		headers: keyed(ownerKey),
		body: JSON.stringify({ name }),
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

/** A deck the workspace owns, created by whoever holds `key`. */
async function createWorkspaceDeck(
	workspaceId: string,
	key: string,
	title = "Sprint retro",
): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ title, slides: SLIDES, workspaceId }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function publish(
	workspaceId: string,
	key: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/workspaces/${workspaceId}/templates`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ category: "meeting", ...body }),
	});
}

async function listTemplates(
	workspaceId: string,
	key: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/workspaces/${workspaceId}/templates`, {
		headers: { "x-api-key": key },
	});
}

/** A deck of the workspace's, started from one of its published templates. */
async function createFrom(
	workspaceId: string,
	templateId: string,
	key: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ workspaceId, workspaceTemplateId: templateId }),
	});
}

/** Every slide id on a deck or an entry, as a set for comparing. */
function slideIds(document: Any): string[] {
	return (document.slides as Any[]).map((slide) => slide.id as string).sort();
}

describe("publishing a deck as a workspace template (REQ004)", () => {
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

		const accountFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: "correct-horse-battery", name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return { userId: account.user.id, key: created.key };
		};
		ownerKey = (await accountFor(OWNER_EMAIL, "Owner")).key;
		adminKey = (await accountFor(ADMIN_EMAIL, "Admin")).key;
		memberKey = (await accountFor(MEMBER_EMAIL, "Member")).key;
		strangerKey = (await accountFor(STRANGER_EMAIL, "Stranger")).key;
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

	// ── Publishing ──────────────────────────────────────────

	test("a workspace's deck becomes a template every member of it can see", async () => {
		const workspace = await createStaffedWorkspace("Publishers");
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);

		const published = await publish(workspace.id, ownerKey, {
			presentationId: deck.id,
			description: "How the sprint went, and what to keep.",
			category: "meeting",
			tags: ["retro", "sprint"],
		});
		expect(published.status).toBe(201);
		const entry = await published.json();
		// The entry is the deck's title when the publish states none, and carries
		// the deck's slides — the catalog entry's own shape, so one gallery renders
		// both kinds of template.
		expect(entry.title).toBe("Sprint retro");
		expect(entry.category).toBe("meeting");
		expect(entry.tags).toEqual(["retro", "sprint"]);
		expect(entry.slides.length).toBe(SLIDES.length);
		expect(entry.sourcePresentationId).toBe(deck.id);
		expect(entry.publishedByName).toBe("Owner");
		// The two that must never reach a client, on a payload built from a row
		// holding one of them.
		expect(entry).not.toHaveProperty("publishedBy");
		expect(entry).not.toHaveProperty("workspaceId");

		for (const key of [ownerKey, adminKey, memberKey]) {
			const listed = await listTemplates(workspace.id, key);
			expect(listed.status).toBe(200);
			const gallery = await listed.json();
			expect(gallery.map((one: Any) => one.id)).toEqual([entry.id]);
		}
	});

	test("the published entry shares no slide id with the deck it came from", async () => {
		// The first half of the independence: a publish is a *snapshot*, so nothing
		// about the deck is reachable from the entry afterwards.
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();

		const deckIds = slideIds(deck);
		const entryIds = slideIds(entry);
		expect(entryIds.length).toBe(deckIds.length);
		expect(entryIds.some((id) => deckIds.includes(id))).toBe(false);
		// And one level down, where the ids that matter for a choice slide are.
		const deckOptionIds = (deck.slides[0].options as Any[]).map(
			(option) => option.id,
		);
		const entryOptionIds = (entry.slides[0].options as Any[]).map(
			(option: Any) => option.id,
		);
		expect(entryOptionIds.some((id: string) => deckOptionIds.includes(id))).toBe(
			false,
		);
	});

	test("publishing the same deck again refreshes its entry rather than adding a second", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const first = await (
			await publish(workspace.id, ownerKey, {
				presentationId: deck.id,
				title: "First name",
			})
		).json();

		const again = await publish(workspace.id, ownerKey, {
			presentationId: deck.id,
			title: "Second name",
			category: "workshop",
		});
		expect(again.status).toBe(200);
		const refreshed = await again.json();
		expect(refreshed.id).toBe(first.id);
		expect(refreshed.title).toBe("Second name");
		expect(refreshed.category).toBe("workshop");

		const gallery = await (await listTemplates(workspace.id, ownerKey)).json();
		expect(gallery.length).toBe(1);
	});

	test("only a deck this workspace owns can be published as its template", async () => {
		const workspace = await createStaffedWorkspace();
		const other = await createStaffedWorkspace("Somewhere else");
		const theirDeck = await createWorkspaceDeck(other.id, ownerKey);
		// A deck of the caller's own, outside any workspace: they can edit it, and
		// that is still not a reason for this workspace's gallery to hold it.
		const personal = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ title: "Mine", slides: SLIDES }),
			})
		).json();

		for (const presentationId of [theirDeck.id, personal.id, "no-such-deck"]) {
			const refused = await publish(workspace.id, ownerKey, { presentationId });
			expect(refused.status).toBe(404);
		}
		expect(
			(await (await listTemplates(workspace.id, ownerKey)).json()).length,
		).toBe(0);
	});

	// ── The refusals ────────────────────────────────────────

	test("an ordinary member may not publish, and is told which role can", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, memberKey);

		const refused = await publish(workspace.id, memberKey, {
			presentationId: deck.id,
		});
		expect(refused.status).toBe(403);
		expect((await refused.json()).error).toContain("admin");
		// The deck was theirs to make and is still theirs to run: the refusal is
		// about the gallery, not about the deck.
		expect(
			(await (await listTemplates(workspace.id, memberKey)).json()).length,
		).toBe(0);

		// An admin publishes the very same deck.
		const allowed = await publish(workspace.id, adminKey, {
			presentationId: deck.id,
		});
		expect(allowed.status).toBe(201);
	});

	test("a stranger cannot read, publish or unpublish — and cannot tell the workspace from a missing one", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();

		expect((await listTemplates(workspace.id, strangerKey)).status).toBe(403);
		expect(
			(await publish(workspace.id, strangerKey, { presentationId: deck.id }))
				.status,
		).toBe(403);
		const unpublished = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/templates/${entry.id}`,
			{ method: "DELETE", headers: keyed(strangerKey) },
		);
		expect(unpublished.status).toBe(403);

		// "Not yours" and "no such workspace" are the same answer, so an id cannot
		// be probed for — and neither can an entry's, because the refusal lands
		// before anything is looked up.
		const notThere = await listTemplates("does-not-exist", strangerKey);
		expect(notThere.status).toBe(403);
		expect(await notThere.text()).toBe(
			await (await listTemplates(workspace.id, strangerKey)).text(),
		);

		// And with no account at all.
		expect(
			(
				await fetch(`${baseUrl}/api/workspaces/${workspace.id}/templates`)
			).status,
		).toBe(401);
	});

	test("a stranger cannot create a deck from an entry, even holding its id", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();

		const refused = await createFrom(workspace.id, entry.id, strangerKey);
		expect(refused.status).toBe(403);
		// The refusal is the workspace's, not the entry's: it reads the same as one
		// for an id that names nothing, so the create route is no oracle either.
		const bogus = await createFrom(workspace.id, "no-such-entry", strangerKey);
		expect(bogus.status).toBe(403);
		expect(await refused.text()).toBe(await bogus.text());

		// Anonymous, with everything right but the account.
		const anonymous = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				workspaceId: workspace.id,
				workspaceTemplateId: entry.id,
			}),
		});
		expect(anonymous.status).toBe(401);
	});

	test("an entry belongs to the workspace that published it and to no other", async () => {
		const workspace = await createStaffedWorkspace();
		const other = await createStaffedWorkspace("Somewhere else");
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();

		// The owner is in both workspaces, so this is not a refusal about standing:
		// the entry is simply not one of the other workspace's.
		expect((await createFrom(other.id, entry.id, ownerKey)).status).toBe(400);
		const crossDelete = await fetch(
			`${baseUrl}/api/workspaces/${other.id}/templates/${entry.id}`,
			{ method: "DELETE", headers: keyed(ownerKey) },
		);
		expect(crossDelete.status).toBe(404);
		// Still there, which is the point of the refusal.
		expect(
			(await (await listTemplates(workspace.id, ownerKey)).json()).length,
		).toBe(1);
	});

	// ── Instantiating ───────────────────────────────────────

	test("another member turns the template into a deck the workspace owns", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, {
				presentationId: deck.id,
				title: "The retro we run",
			})
		).json();

		// A *different* account from the one that published — REQ004's "instantiated
		// by other members".
		const created = await createFrom(workspace.id, entry.id, memberKey);
		expect(created.status).toBe(201);
		const instance = await created.json();
		expect(instance.title).toBe("The retro we run");
		expect(instance.slides.length).toBe(SLIDES.length);
		// It is an ordinary deck the *workspace* owns (REQ128): no account owner and
		// no edit token, so its standing is the roster.
		expect(instance.workspaceId).toBe(workspace.id);
		expect(instance.creatorToken).toBeNull();
		expect(instance).not.toHaveProperty("creatorId");
		expect(instance).not.toHaveProperty("creatorTokenHash");
		expect(instance.status).toBe("draft");
		expect(typeof instance.code).toBe("string");

		// And every member sees it in the workspace's decks.
		const decks = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/presentations`, {
				headers: { "x-api-key": adminKey },
			})
		).json();
		expect(decks.some((one: Any) => one.id === instance.id)).toBe(true);
	});

	test("two decks made from one entry share nothing with it or with each other", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();

		const first = await (await createFrom(workspace.id, entry.id, memberKey))
			.json();
		const second = await (await createFrom(workspace.id, entry.id, adminKey))
			.json();

		expect(first.id).not.toBe(second.id);
		const entryIds = slideIds(entry);
		for (const instance of [first, second]) {
			const ids = slideIds(instance);
			expect(ids.length).toBe(entryIds.length);
			expect(ids.some((id) => entryIds.includes(id))).toBe(false);
		}
		expect(
			slideIds(first).some((id) => slideIds(second).includes(id)),
		).toBe(false);
	});

	// ── The requirement's second sentence ───────────────────

	test("later edits to the template do not reach a deck already made from it", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();
		const instance = await (
			await createFrom(workspace.id, entry.id, memberKey)
		).json();

		// Edit the *source deck* and republish: the entry now holds a third slide
		// and a different name. This is the only way a template's content changes.
		const edited = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({
				slides: [
					...SLIDES,
					{ id: "s3", type: "text", question: "Something new" },
				],
			}),
		});
		expect(edited.status).toBe(200);
		const republished = await (
			await publish(workspace.id, ownerKey, {
				presentationId: deck.id,
				title: "Renamed template",
				category: "feedback",
			})
		).json();
		expect(republished.id).toBe(entry.id);
		expect(republished.slides.length).toBe(SLIDES.length + 1);

		// The deck made earlier is untouched: same slides, same title, same count.
		const readBack = await (
			await fetch(`${baseUrl}/api/presentations/${instance.id}`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(readBack.slides.length).toBe(SLIDES.length);
		expect(readBack.title).toBe(instance.title);
		expect(slideIds(readBack)).toEqual(slideIds(instance));

		// The other direction of the same independence: editing the *deck* reaches
		// nothing in the gallery either.
		const renamed = await fetch(`${baseUrl}/api/presentations/${instance.id}`, {
			method: "PATCH",
			headers: keyed(memberKey),
			body: JSON.stringify({ title: "Ours, edited", slides: [SLIDES[0]] }),
		});
		expect(renamed.status).toBe(200);
		const gallery = await (await listTemplates(workspace.id, ownerKey)).json();
		expect(gallery[0].title).toBe("Renamed template");
		expect(gallery[0].slides.length).toBe(SLIDES.length + 1);
	});

	test("unpublishing takes the entry down and no deck with it", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();
		const instance = await (
			await createFrom(workspace.id, entry.id, memberKey)
		).json();

		// A member cannot, for the reason they could not publish.
		const refused = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/templates/${entry.id}`,
			{ method: "DELETE", headers: keyed(memberKey) },
		);
		expect(refused.status).toBe(403);

		const removed = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/templates/${entry.id}`,
			{ method: "DELETE", headers: keyed(adminKey) },
		);
		expect(removed.status).toBe(200);
		expect(
			(await (await listTemplates(workspace.id, ownerKey)).json()).length,
		).toBe(0);
		// Gone twice is a `404`, not a second success.
		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${workspace.id}/templates/${entry.id}`,
					{ method: "DELETE", headers: keyed(adminKey) },
				)
			).status,
		).toBe(404);

		// Both decks are exactly where they were: the one it was published from and
		// the one it produced.
		for (const id of [deck.id, instance.id]) {
			const readBack = await fetch(`${baseUrl}/api/presentations/${id}`, {
				headers: { "x-api-key": memberKey },
			});
			expect(readBack.status).toBe(200);
		}
		// And the entry is no longer usable, for a member who held its id.
		expect((await createFrom(workspace.id, entry.id, memberKey)).status).toBe(
			400,
		);
	});

	test("deleting the workspace takes its gallery with it and leaves the decks alone", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const entry = await (
			await publish(workspace.id, ownerKey, { presentationId: deck.id })
		).json();
		const instance = await (
			await createFrom(workspace.id, entry.id, memberKey)
		).json();

		// A published template is not a deck and does not stand in the way of the
		// delete; the decks themselves still do (REQ128).
		const refused = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(refused.status).toBe(409);
		expect((await refused.json()).deckCount).toBe(2);

		for (const id of [deck.id, instance.id]) {
			const moved = await fetch(
				`${baseUrl}/api/presentations/${id}/workspace`,
				{
					method: "POST",
					headers: keyed(ownerKey),
					body: JSON.stringify({ workspaceId: null }),
				},
			);
			expect(moved.status).toBe(200);
		}
		const deleted = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(deleted.status).toBe(200);

		// The gallery went with the workspace; both decks are still readable by the
		// account that now owns them.
		for (const id of [deck.id, instance.id]) {
			const readBack = await fetch(`${baseUrl}/api/presentations/${id}`, {
				headers: { "x-api-key": ownerKey },
			});
			expect(readBack.status).toBe(200);
		}
	});
});
