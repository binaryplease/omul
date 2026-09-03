/**
 * Integration tests for workspaces and the roles in them (REQ128, REQ129).
 *
 * The two requirements meet in one claim, so this suite drives it over HTTP with
 * real accounts rather than checking that a control is drawn:
 *
 *   - a workspace **owns** decks — a member reads and presents every one of
 *     them, and a deck survives the removal of any single member, the one who
 *     created it included;
 *   - the deck has **no account owner and no edit token**, and is therefore not
 *     a pre-auth deck: an anonymous caller is refused, and nobody can claim it;
 *   - every workspace-scoped mutation is authorized **against the role**, on the
 *     server — every mutation route on a workspace deck, not a sample, plus the
 *     roster and the workspace itself.
 *
 * Stands up the real Elysia app (auth handler + presentation routes + workspace
 * routes) against a throw-away in-memory docstore and a temp auth DB, exactly as
 * `collaborators.integration.test.ts` does — it is the neighbour this extends.
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
	mkdtempSync(join(tmpdir(), "omul-workspaces-")),
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

const OWNER_EMAIL = "ws-owner@example.com";
const ADMIN_EMAIL = "ws-admin@example.com";
const MEMBER_EMAIL = "ws-member@example.com";
const STRANGER_EMAIL = "ws-stranger@example.com";

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
	title = "Workspace deck",
): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: keyed(key),
		body: JSON.stringify({ title, slides: SLIDES, workspaceId }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

/**
 * Every mutation route on a deck, as one callable each — the same sweep
 * `collaborators.integration.test.ts` runs, and hand-written for the same
 * reason and with the same caveat: **nothing derives it from the router**, so a
 * mutation route added without a gate passes this suite in silence. Adding one
 * to the router means adding it here.
 */
function mutations(deckId: string, slideId: string) {
	return {
		patch: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ title: "Renamed by a member" }),
			}),
		start: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/start`, {
				method: "POST",
				headers,
			}),
		end: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/end`, {
				method: "POST",
				headers,
			}),
		reset: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/reset`, {
				method: "POST",
				headers,
			}),
		slide: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/slide`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ index: 0 }),
			}),
		reveal: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/reveal`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ slideId, reveal: true }),
			}),
		resultsVisibility: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/results-visibility`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ resultsVisibility: "private" }),
			}),
		participation: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/participation`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ slideId, open: false }),
			}),
		blank: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/blank`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ blanked: true }),
			}),
		timer: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/timer`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ slideId }),
			}),
		qaSettings: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/qa/settings`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ enabled: true }),
			}),
		channels: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/channels`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ chatEnabled: true }),
			}),
		mintResultsLink: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}/results-link`, {
				method: "POST",
				headers,
			}),
	};
}

describe("workspaces and the roles in them (REQ128, REQ129)", () => {
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

	// ── The workspace itself ────────────────────────────────

	test("creating one makes the creator its owner, and nobody else sees it", async () => {
		const workspace = await createStaffedWorkspace("Founding");
		expect(workspace.role).toBe("owner");
		// The one thing that must never reach a client, on a payload built from a
		// row holding it.
		expect(workspace).not.toHaveProperty("createdBy");

		const mine = await (
			await fetch(`${baseUrl}/api/workspaces`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.find((entry: Any) => entry.id === workspace.id).role).toBe(
			"owner",
		);

		const theirs = await (
			await fetch(`${baseUrl}/api/workspaces`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(theirs.some((entry: Any) => entry.id === workspace.id)).toBe(false);
	});

	test("a workspace needs an account, and a stranger cannot tell it from a missing one", async () => {
		const workspace = await createStaffedWorkspace();
		expect((await fetch(`${baseUrl}/api/workspaces`)).status).toBe(401);
		expect(
			(await fetch(`${baseUrl}/api/workspaces/${workspace.id}`)).status,
		).toBe(401);

		// "Not yours" and "no such workspace" are the same answer, so an id cannot
		// be probed for.
		const notMine = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
			headers: { "x-api-key": strangerKey },
		});
		const notThere = await fetch(`${baseUrl}/api/workspaces/does-not-exist`, {
			headers: { "x-api-key": strangerKey },
		});
		expect(notMine.status).toBe(403);
		expect(notThere.status).toBe(403);
	});

	test("renaming and deleting are the owner's alone, and every role is told which", async () => {
		const workspace = await createStaffedWorkspace();
		for (const key of [adminKey, memberKey, strangerKey]) {
			const renamed = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
				method: "PATCH",
				headers: keyed(key),
				body: JSON.stringify({ name: "Taken over" }),
			});
			expect(renamed.status).toBe(403);
			const deleted = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
				method: "DELETE",
				headers: keyed(key),
			});
			expect(deleted.status).toBe(403);
		}

		const renamed = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
			method: "PATCH",
			headers: keyed(ownerKey),
			body: JSON.stringify({ name: "Renamed" }),
		});
		expect(renamed.status).toBe(200);
		expect((await renamed.json()).name).toBe("Renamed");
	});

	test("a workspace that still owns decks is not deleted out from under them", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);

		const refused = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
			method: "DELETE",
			headers: keyed(ownerKey),
		});
		expect(refused.status).toBe(409);
		expect((await refused.json()).deckCount).toBe(1);
		// And the deck is still there, which is the point of the refusal.
		expect((await fetch(`${baseUrl}/api/presentations/${deck.id}`)).status).toBe(
			200,
		);

		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: keyed(ownerKey),
				})
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
					method: "DELETE",
					headers: keyed(ownerKey),
				})
			).status,
		).toBe(200);
		// The memberships went with it: the workspace leaves every member's list.
		const theirs = await (
			await fetch(`${baseUrl}/api/workspaces`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(theirs.some((entry: Any) => entry.id === workspace.id)).toBe(false);
	});

	// ── The roster (REQ129) ─────────────────────────────────

	test("who may add somebody, and at what role", async () => {
		const workspace = await createStaffedWorkspace();

		// A plain member cannot widen the workspace, and a stranger cannot see it.
		for (const key of [memberKey, strangerKey]) {
			const refused = await fetch(
				`${baseUrl}/api/workspaces/${workspace.id}/members`,
				{
					method: "POST",
					headers: keyed(key),
					body: JSON.stringify({ email: STRANGER_EMAIL, role: "admin" }),
				},
			);
			expect(refused.status).toBe(403);
		}

		// An admin may add — but not another owner: handing out the role that can
		// delete the workspace stays with the role that has it.
		const asOwner = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members`,
			{
				method: "POST",
				headers: keyed(adminKey),
				body: JSON.stringify({ email: STRANGER_EMAIL, role: "owner" }),
			},
		);
		expect(asOwner.status).toBe(403);

		const added = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members`,
			{
				method: "POST",
				headers: keyed(adminKey),
				body: JSON.stringify({ email: STRANGER_EMAIL }),
			},
		);
		expect(added.status).toBe(201);
		// The default is the weakest role, not the one that was refused above.
		expect((await added.json()).role).toBe("member");
	});

	test("adding the same account again changes the role rather than stacking", async () => {
		const workspace = await createStaffedWorkspace();
		const second = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ email: MEMBER_EMAIL, role: "admin" }),
			},
		);
		expect(second.status).toBe(200);
		expect((await second.json()).role).toBe("admin");

		const roster = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(roster).toHaveLength(3);
		expect(
			roster.filter((entry: Any) => entry.email === MEMBER_EMAIL),
		).toHaveLength(1);
	});

	test("an unregistered address is a refusal, not an invitation", async () => {
		const workspace = await createStaffedWorkspace();
		const unknown = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ email: "nobody@example.com" }),
			},
		);
		expect(unknown.status).toBe(404);
	});

	test("the roster names people, and only an admin is told their addresses", async () => {
		const workspace = await createStaffedWorkspace();

		const asMember = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(asMember).toHaveLength(3);
		for (const entry of asMember) {
			// No account identifier reaches a client, at any role.
			expect(entry).not.toHaveProperty("userId");
			expect(entry).not.toHaveProperty("workspaceId");
			// The key is emitted rather than dropped, and it is empty.
			expect(entry).toHaveProperty("email");
			expect(entry.email).toBeNull();
			expect(typeof entry.name).toBe("string");
		}
		expect(asMember.filter((entry: Any) => entry.mine)).toHaveLength(1);

		const asAdmin = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": adminKey },
			})
		).json();
		expect(asAdmin.map((entry: Any) => entry.email).sort()).toEqual(
			[ADMIN_EMAIL, MEMBER_EMAIL, OWNER_EMAIL].sort(),
		);

		// And a stranger reads nothing at all.
		expect(
			(
				await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
					headers: { "x-api-key": strangerKey },
				})
			).status,
		).toBe(403);
	});

	test("a role change lands on the member's next request", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const roster = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		const memberRow = roster.find((entry: Any) => entry.email === MEMBER_EMAIL);

		// A plain member cannot delete the workspace's decks…
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: keyed(memberKey),
				})
			).status,
		).toBe(403);

		const promoted = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members/${memberRow.id}`,
			{
				method: "PATCH",
				headers: keyed(ownerKey),
				body: JSON.stringify({ role: "admin" }),
			},
		);
		expect(promoted.status).toBe(200);
		expect((await promoted.json()).role).toBe("admin");

		// …and as an admin, the very next request goes through. No cache, no issued
		// credential, nothing to wait out.
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: keyed(memberKey),
				})
			).status,
		).toBe(200);
	});

	test("an admin cannot demote an owner, and the last owner cannot be removed at all", async () => {
		const workspace = await createStaffedWorkspace();
		const roster = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		const ownerRow = roster.find((entry: Any) => entry.email === OWNER_EMAIL);

		const demoted = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members/${ownerRow.id}`,
			{
				method: "PATCH",
				headers: keyed(adminKey),
				body: JSON.stringify({ role: "member" }),
			},
		);
		expect(demoted.status).toBe(403);
		const removed = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members/${ownerRow.id}`,
			{ method: "DELETE", headers: keyed(adminKey) },
		);
		expect(removed.status).toBe(403);

		// Not even the owner can leave the workspace ownerless: nothing in the model
		// could restore an owner, so it would be un-renameable and un-deletable for
		// good.
		const selfDemoted = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members/${ownerRow.id}`,
			{
				method: "PATCH",
				headers: keyed(ownerKey),
				body: JSON.stringify({ role: "member" }),
			},
		);
		expect(selfDemoted.status).toBe(409);
		const selfRemoved = await fetch(
			`${baseUrl}/api/workspaces/${workspace.id}/members/${ownerRow.id}`,
			{ method: "DELETE", headers: keyed(ownerKey) },
		);
		expect(selfRemoved.status).toBe(409);

		// With a second owner in place, the first may go.
		const adminRow = roster.find((entry: Any) => entry.email === ADMIN_EMAIL);
		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${workspace.id}/members/${adminRow.id}`,
					{
						method: "PATCH",
						headers: keyed(ownerKey),
						body: JSON.stringify({ role: "owner" }),
					},
				)
			).status,
		).toBe(200);
		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${workspace.id}/members/${ownerRow.id}`,
					{ method: "DELETE", headers: keyed(ownerKey) },
				)
			).status,
		).toBe(200);
	});

	test("a member may leave, and a membership id from another workspace writes nothing", async () => {
		const workspace = await createStaffedWorkspace();
		const other = await createStaffedWorkspace("Other");
		const roster = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		const memberRow = roster.find((entry: Any) => entry.email === MEMBER_EMAIL);

		// The id belongs to this workspace's roster, so the other workspace answers
		// 404 rather than writing across.
		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${other.id}/members/${memberRow.id}`,
					{ method: "DELETE", headers: keyed(ownerKey) },
				)
			).status,
		).toBe(404);

		// Leaving is not a management power: an ordinary member removes themselves.
		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${workspace.id}/members/${memberRow.id}`,
					{ method: "DELETE", headers: keyed(memberKey) },
				)
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
					headers: { "x-api-key": memberKey },
				})
			).status,
		).toBe(403);
	});

	// ── The decks a workspace owns (REQ128) ─────────────────

	test("a deck created in a workspace has no account owner and no edit token", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, memberKey);
		expect(deck.workspaceId).toBe(workspace.id);
		// No forwardable capability is minted for a deck whose standing is a roster
		// nobody could revoke it from.
		expect(deck.creatorToken).toBeNull();
		expect(deck).not.toHaveProperty("creatorId");

		// It is the workspace's, not the creator's: it is in the workspace's list
		// and in nobody's `/mine`.
		const owned = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/presentations`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(owned.some((entry: Any) => entry.id === deck.id)).toBe(true);
		for (const key of [ownerKey, adminKey, memberKey]) {
			const mine = await (
				await fetch(`${baseUrl}/api/presentations/mine`, {
					headers: { "x-api-key": key },
				})
			).json();
			expect(mine.some((entry: Any) => entry.id === deck.id)).toBe(false);
		}
	});

	test("only a member with a creating role can put a deck in a workspace", async () => {
		const workspace = await createStaffedWorkspace();
		const refused = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: keyed(strangerKey),
			body: JSON.stringify({
				title: "Not yours",
				slides: SLIDES,
				workspaceId: workspace.id,
			}),
		});
		expect(refused.status).toBe(403);

		// A workspace that does not exist answers the same 403 — the refusal reports
		// nothing about which ids are real.
		const missing = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: keyed(ownerKey),
			body: JSON.stringify({
				title: "Nowhere",
				slides: SLIDES,
				workspaceId: "no-such-workspace",
			}),
		});
		expect(missing.status).toBe(403);

		// And an anonymous create naming one is refused before anything is written.
		const anonymous = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Anonymous",
				slides: SLIDES,
				workspaceId: workspace.id,
			}),
		});
		expect(anonymous.status).toBe(401);
	});

	test("a workspace deck is not a pre-auth deck — nobody walks in through the legacy door", async () => {
		// The sharpest line in the slice. A workspace deck has no `creatorId` and no
		// `creatorTokenHash`, which is exactly the shape a grandfathered pre-auth
		// deck has; reading it as one would hand `edit` to every anonymous caller
		// who could type its id.
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const routes = mutations(deck.id, SLIDES[0].id);

		for (const [name, call] of Object.entries(routes)) {
			const anonymous = await call({});
			expect(`${name}:${anonymous.status}`).toBe(`${name}:401`);
			const stranger = await call({ "x-api-key": strangerKey });
			expect(`${name}:${stranger.status}`).toBe(`${name}:403`);
		}
		expect(
			(await fetch(`${baseUrl}/api/presentations/${deck.id}`, { method: "DELETE" }))
				.status,
		).toBe(401);

		// Nothing the refused calls asked for happened, and no standing is reported
		// to a caller who has none.
		const read = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(read.title).toBe("Workspace deck");
		expect(read.accessLevel).toBeNull();
		expect(read.workspaceId).toBe(workspace.id);
	});

	test("an ownerless-looking workspace deck cannot be claimed", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		// A member has `edit` on it, so the claim's control check passes — and it is
		// still refused, because the workspace is the owner.
		for (const key of [memberKey, ownerKey]) {
			const claimed = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/claim`,
				{ method: "POST", headers: keyed(key) },
			);
			expect(claimed.status).toBe(409);
		}
		const still = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(still.workspaceId).toBe(workspace.id);
	});

	test("every member may run the deck; deleting it is the admin's", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const routes = mutations(deck.id, SLIDES[0].id);

		for (const [name, call] of Object.entries(routes)) {
			const res = await call({ "x-api-key": memberKey });
			expect(`${name}:${res.ok}`).toBe(`${name}:true`);
		}
		const renamed = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(renamed.title).toBe("Renamed by a member");

		// The one mutation a plain membership does not reach — being trusted to
		// build the workspace's deck is not being trusted to destroy it (REQ146).
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: keyed(memberKey),
				})
			).status,
		).toBe(403);
		expect((await fetch(`${baseUrl}/api/presentations/${deck.id}`)).status).toBe(
			200,
		);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: keyed(adminKey),
				})
			).status,
		).toBe(200);
	});

	test("a member reads the deck as its author wrote it, and its exports too", async () => {
		const workspace = await createStaffedWorkspace();
		const created = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: keyed(ownerKey),
			body: JSON.stringify({
				title: "Quiz deck",
				workspaceId: workspace.id,
				slides: [
					{
						id: "q1",
						type: "quiz",
						question: "Which?",
						notes: "Say it slowly",
						options: [
							{ id: "a", text: "A", isCorrect: true },
							{ id: "b", text: "B" },
						],
					},
				],
			}),
		});
		const deck = await created.json();

		const asMember = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(asMember.accessLevel).toBe("edit");
		expect(asMember.slides[0].options[0].isCorrect).toBe(true);
		expect(asMember.slides[0].notes).toBe("Say it slowly");

		// The exports follow the same standing every mutation does.
		for (const path of ["results.xlsx", "deck.pdf"]) {
			expect(
				(
					await fetch(`${baseUrl}/api/presentations/${deck.id}/${path}`, {
						headers: { "x-api-key": memberKey },
					})
				).status,
			).toBe(200);
			expect(
				(
					await fetch(`${baseUrl}/api/presentations/${deck.id}/${path}`, {
						headers: { "x-api-key": strangerKey },
					})
				).status,
			).toBe(403);
		}

		// A caller with no standing still meets the audience's view.
		const asStranger = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(asStranger.slides[0].options[0]).not.toHaveProperty("isCorrect");
		expect(asStranger.slides[0].notes).toBe("");
	});

	// ── The survival property (REQ128) ──────────────────────

	test("a deck survives the removal of the member who created it", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(
			workspace.id,
			memberKey,
			"Made by the member",
		);
		const roster = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/members`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		const memberRow = roster.find((entry: Any) => entry.email === MEMBER_EMAIL);

		expect(
			(
				await fetch(
					`${baseUrl}/api/workspaces/${workspace.id}/members/${memberRow.id}`,
					{ method: "DELETE", headers: keyed(ownerKey) },
				)
			).status,
		).toBe(200);

		// The deck is exactly where it was, and the remaining members still read,
		// present and edit it.
		const owned = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/presentations`, {
				headers: { "x-api-key": adminKey },
			})
		).json();
		expect(owned.some((entry: Any) => entry.id === deck.id)).toBe(true);
		expect(
			(await mutations(deck.id, SLIDES[0].id).start({ "x-api-key": adminKey }))
				.status,
		).toBe(200);

		// And its creator, now outside, is a stranger to it — which is the other
		// half of "surviving any single member's removal".
		expect(
			(await mutations(deck.id, SLIDES[0].id).end({ "x-api-key": memberKey }))
				.status,
		).toBe(403);
		const theirs = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(theirs.some((entry: Any) => entry.id === deck.id)).toBe(false);
	});

	// ── Moving a deck in and out ────────────────────────────

	test("moving a deck in retires its edit token and its account owner", async () => {
		const workspace = await createStaffedWorkspace();
		// An ordinary personal deck as a browser makes one — created anonymously so
		// it is minted an edit token, then claimed by the account. Both credentials
		// exist on it, which is the state this move has to end.
		const personal = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Mine", slides: SLIDES }),
			})
		).json();
		const token = personal.creatorToken as string;
		expect(typeof token).toBe("string");
		const claimed = await fetch(
			`${baseUrl}/api/presentations/${personal.id}/claim`,
			{
				method: "POST",
				headers: { ...keyed(ownerKey), Authorization: `Bearer ${token}` },
			},
		);
		expect(claimed.status).toBe(200);

		const moved = await fetch(
			`${baseUrl}/api/presentations/${personal.id}/workspace`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ workspaceId: workspace.id }),
			},
		);
		expect(moved.status).toBe(200);
		expect((await moved.json()).workspaceId).toBe(workspace.id);

		// The forwardable capability nobody in the workspace could revoke is gone.
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${personal.id}/start`, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				})
			).status,
		).toBe(401);
		// The deck left its old owner's list and joined the workspace's.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.some((entry: Any) => entry.id === personal.id)).toBe(false);
		const owned = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/presentations`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(owned.some((entry: Any) => entry.id === personal.id)).toBe(true);
	});

	test("moving a deck out is the workspace owner's alone", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);

		for (const key of [memberKey, adminKey, strangerKey]) {
			const refused = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/workspace`,
				{
					method: "POST",
					headers: keyed(key),
					body: JSON.stringify({ workspaceId: null }),
				},
			);
			expect(refused.status).toBe(403);
		}

		const moved = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/workspace`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ workspaceId: null }),
			},
		);
		expect(moved.status).toBe(200);
		expect((await moved.json()).workspaceId).toBeNull();

		// It is an account's deck again — in its new owner's list, and out of reach
		// of the workspace's other members.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.some((entry: Any) => entry.id === deck.id)).toBe(true);
		expect(
			(await mutations(deck.id, SLIDES[0].id).start({ "x-api-key": memberKey }))
				.status,
		).toBe(403);
	});

	test("a deck cannot be moved into a workspace through the ordinary patch", async () => {
		// `workspaceId` is unwritable by a body (REQ128): a caller who could set it
		// would move any deck they can edit into a workspace they administer.
		const workspace = await createStaffedWorkspace();
		const victim = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: keyed(adminKey),
				body: JSON.stringify({ title: "Somebody's deck", slides: SLIDES }),
			})
		).json();

		const patched = await fetch(`${baseUrl}/api/presentations/${victim.id}`, {
			method: "PATCH",
			headers: keyed(adminKey),
			body: JSON.stringify({ title: "Renamed", workspaceId: workspace.id }),
		});
		expect(patched.status).toBe(200);
		const read = await patched.json();
		expect(read.title).toBe("Renamed");
		expect(read.workspaceId).toBeNull();

		const owned = await (
			await fetch(`${baseUrl}/api/workspaces/${workspace.id}/presentations`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(owned.some((entry: Any) => entry.id === victim.id)).toBe(false);
	});

	// ── Coexistence with the per-deck grant model (REQ075) ──

	test("a workspace deck can still be shared outside it, and only by an admin", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);

		// A plain member cannot widen who is on the deck — the same limit an `edit`
		// collaborator has, read off the role instead of off a grant.
		const byMember = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: keyed(memberKey),
				body: JSON.stringify({ email: STRANGER_EMAIL, level: "view" }),
			},
		);
		expect(byMember.status).toBe(403);

		const byAdmin = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: keyed(adminKey),
				body: JSON.stringify({ email: STRANGER_EMAIL, level: "view" }),
			},
		);
		expect(byAdmin.status).toBe(201);

		// The outsider reads the deck at the level they were given, and no more.
		const shared = await (
			await fetch(`${baseUrl}/api/presentations/shared`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(
			shared.find((entry: Any) => entry.id === deck.id).accessLevel,
		).toBe("view");
		expect(
			(await mutations(deck.id, SLIDES[0].id).start({ "x-api-key": strangerKey }))
				.status,
		).toBe(403);
	});

	test("a weak grant on a workspace deck does not demote a member", async () => {
		// Two independent standings, and the stronger one stands: a member who was
		// also handed a `view` grant is not thereby demoted on a deck their own
		// workspace owns.
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);
		const granted = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: keyed(ownerKey),
				body: JSON.stringify({ email: MEMBER_EMAIL, level: "view" }),
			},
		);
		expect(granted.status).toBe(201);

		const read = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": memberKey },
			})
		).json();
		expect(read.accessLevel).toBe("edit");
		expect(
			(await mutations(deck.id, SLIDES[0].id).start({ "x-api-key": memberKey }))
				.status,
		).toBe(200);
	});

	test("the deck's comment threads open to the workspace, not to a link", async () => {
		const workspace = await createStaffedWorkspace();
		const deck = await createWorkspaceDeck(workspace.id, ownerKey);

		const written = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/comments`,
			{
				method: "POST",
				headers: keyed(memberKey),
				body: JSON.stringify({ slideId: SLIDES[0].id, body: "Move slide 2 up" }),
			},
		);
		expect(written.status).toBe(201);

		const threads = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/comments`, {
				headers: { "x-api-key": adminKey },
			})
		).json();
		expect(threads).toHaveLength(1);
		expect(threads[0].body).toBe("Move slide 2 up");
		expect(threads[0].mine).toBe(false);

		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/comments`, {
					headers: { "x-api-key": strangerKey },
				})
			).status,
		).toBe(403);
		expect(
			(await fetch(`${baseUrl}/api/presentations/${deck.id}/comments`)).status,
		).toBe(401);
	});
});
