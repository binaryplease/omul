/**
 * Integration tests for sharing a deck with another account (REQ075).
 *
 * The point of this suite is the sentence the requirement ends on — *the level
 * is enforced on every mutation, not only in the UI* — so it does not check that
 * a button is absent. It signs in as a real second account, holds a real grant,
 * and drives every mutation route on the deck:
 *
 *   - a `view` collaborator and a `comment` collaborator are refused `403` on
 *     each one — every mutation route, not a sample of them;
 *   - an `edit` collaborator is allowed the same set — except deleting the deck,
 *     which stays with its owner;
 *   - nobody but the owner can widen who is on the deck, the edit token included;
 *   - a revoke lands on the collaborator's next request, not on their next login.
 *
 * Stands up the real Elysia app (auth handler + presentation routes) against a
 * throw-away in-memory docstore and a temp auth DB, exactly as
 * `ownership.integration.test.ts` does — it is the neighbour this extends.
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
	mkdtempSync(join(tmpdir(), "omul-collaborators-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Account credentials created in beforeAll, all via personal API keys.
let ownerKey = "";
let collaboratorKey = "";
let collaboratorUserId = "";
let strangerKey = "";

const OWNER_EMAIL = "deck-owner@example.com";
const COLLABORATOR_EMAIL = "collaborator@example.com";
const STRANGER_EMAIL = "stranger@example.com";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
	},
];

async function createOwnedDeck(): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
		body: JSON.stringify({ title: "Shared deck", slides: SLIDES }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

/** Share a deck with the collaborator account, returning the created grant. */
async function share(
	deckId: string,
	level: "view" | "comment" | "edit",
	email = COLLABORATOR_EMAIL,
): Promise<Any> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${deckId}/collaborators`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ email, level }),
		},
	);
	expect([200, 201]).toContain(res.status);
	return res.json();
}

/**
 * Every mutation route on a deck, as one callable each. Swept rather than
 * sampled: the enforcement claim is about *every* mutation, so every one of them
 * is driven here.
 *
 * **This list is hand-written and nothing derives it from the router**, so it
 * cannot catch a route that does not exist yet: a mutation added without a level
 * gate passes this suite in silence. Adding one to the router means adding it
 * here. (The `PATCH` body hole this suite now covers is what the gap looks like:
 * the probe below sent only `{ title }`, so an escalation through the *same*
 * route went unseen — which is why the patch body has cases of its own further
 * down rather than being trusted to this map.)
 *
 * `POST …/vote` and the other participant-facing writes are deliberately absent
 * — they are open to the room by design and authorize nothing.
 */
function mutations(deckId: string, slideId: string) {
	return {
		patch: (headers: Record<string, string>) =>
			fetch(`${baseUrl}/api/presentations/${deckId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify({ title: "Renamed by a collaborator" }),
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

describe("sharing a deck with other accounts (REQ075)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
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
		const collaborator = await accountFor(COLLABORATOR_EMAIL, "Collaborator");
		collaboratorKey = collaborator.key;
		// A collaborator knows their own account id — the SPA reads it out of
		// `GET /api/auth/get-session` — so a test that pretends otherwise would be
		// testing an obscurity the attacker does not actually face.
		collaboratorUserId = collaborator.userId;
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

	// ── The grant itself ────────────────────────────────────

	test("the owner shares, the collaborator sees the deck, and no account id travels", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "view");
		expect(grant.email).toBe(COLLABORATOR_EMAIL);
		expect(grant.level).toBe("view");
		expect(typeof grant.id).toBe("string");
		// The one thing that must never reach a client, on the one payload that
		// is built from a row holding it.
		expect(grant).not.toHaveProperty("userId");
		expect(grant).not.toHaveProperty("presentationId");
		expect(grant).not.toHaveProperty("invitedBy");

		const shared = await (
			await fetch(`${baseUrl}/api/presentations/shared`, {
				headers: { "x-api-key": collaboratorKey },
			})
		).json();
		const entry = shared.find((p: Any) => p.id === deck.id);
		expect(entry).toBeDefined();
		expect(entry.accessLevel).toBe("view");
		// Shared, not owned: the two lists stay separate.
		expect(entry).not.toHaveProperty("creatorId");
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": collaboratorKey },
			})
		).json();
		expect(mine.some((p: Any) => p.id === deck.id)).toBe(false);
	});

	test("a stranger's account sees nothing of it", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");
		const shared = await (
			await fetch(`${baseUrl}/api/presentations/shared`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(shared.some((p: Any) => p.id === deck.id)).toBe(false);
		const read = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(read.accessLevel).toBeNull();
	});

	test("`/shared` needs an account", async () => {
		const res = await fetch(`${baseUrl}/api/presentations/shared`);
		expect(res.status).toBe(401);
	});

	test("sharing again with the same account changes the level rather than stacking", async () => {
		const deck = await createOwnedDeck();
		const first = await share(deck.id, "view");
		const second = await share(deck.id, "edit");
		expect(second.id).toBe(first.id);
		expect(second.level).toBe("edit");
		const list = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(list).toHaveLength(1);
		expect(list[0].level).toBe("edit");
	});

	test("two simultaneous shares of one pair leave one grant, not two", async () => {
		const deck = await createOwnedDeck();
		// The race `grantDeckAccess`'s check-then-insert cannot win on its own:
		// both calls read no row, both try to insert, and the unique index is what
		// turns the loser into a level change instead of a second standing.
		const results = await Promise.all([
			fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "edit" }),
			}),
			fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "edit" }),
			}),
		]);
		for (const result of results) expect([200, 201]).toContain(result.status);

		const list = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(list).toHaveLength(1);

		// The same race at its tightest, driven at the service directly: two calls
		// that both get past the read before either writes. Exactly one reports
		// having created the grant, and the store still holds one row.
		const { grantDeckAccess, listDeckCollaborators } = await import(
			"./services/collaborators"
		);
		const raced = await Promise.all([
			grantDeckAccess("raced-deck", "raced-user", "edit", "owner"),
			grantDeckAccess("raced-deck", "raced-user", "edit", "owner"),
		]);
		expect(raced.filter((outcome) => outcome.created)).toHaveLength(1);
		expect(await listDeckCollaborators("raced-deck")).toHaveLength(1);

		// And the single grant is the whole standing: revoking it leaves nothing
		// behind, which is exactly what a duplicate would have broken.
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/collaborators/${list[0].id}`,
					{ method: "DELETE", headers: { "x-api-key": ownerKey } },
				)
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
					method: "POST",
					headers: { "x-api-key": collaboratorKey },
				})
			).status,
		).toBe(403);
	});

	test("an unregistered address is a refusal, and the owner cannot share with themselves", async () => {
		const deck = await createOwnedDeck();
		const unknown = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ email: "nobody@example.com", level: "edit" }),
			},
		);
		expect(unknown.status).toBe(404);

		const self = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ email: OWNER_EMAIL, level: "edit" }),
			},
		);
		expect(self.status).toBe(400);
	});

	// ── Enforcement: the whole point (REQ075) ───────────────

	for (const level of ["view", "comment"] as const) {
		test(`a \`${level}\` collaborator is refused every mutation, server-side`, async () => {
			const deck = await createOwnedDeck();
			await share(deck.id, level);
			const headers = { "x-api-key": collaboratorKey };
			const routes = mutations(deck.id, SLIDES[0].id);

			for (const [name, call] of Object.entries(routes)) {
				const res = await call(headers);
				// 403, not 401: this account has real standing on the deck — it
				// simply does not have *this* standing. And not 200 with the write
				// quietly dropped, which is how "enforced in the UI only" looks from
				// the outside.
				expect(`${name}:${res.status}`).toBe(`${name}:403`);
			}

			// Deleting is refused too, and the deck is still there afterwards.
			const deleted = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				method: "DELETE",
				headers,
			});
			expect(deleted.status).toBe(403);
			const still = await fetch(`${baseUrl}/api/presentations/${deck.id}`);
			expect(still.status).toBe(200);

			// Nothing the refused PATCH asked for happened.
			const read = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`)
			).json();
			expect(read.title).toBe("Shared deck");
		});
	}

	test("an `edit` collaborator may run the deck — but not delete it", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");
		const headers = { "x-api-key": collaboratorKey };
		const routes = mutations(deck.id, SLIDES[0].id);

		for (const [name, call] of Object.entries(routes)) {
			const res = await call(headers);
			expect(`${name}:${res.ok}`).toBe(`${name}:true`);
		}

		const renamed = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(renamed.title).toBe("Renamed by a collaborator");

		// The one carve-out: an edit grant is help with the deck, not authority to
		// destroy it and the room's answers with it.
		const deleted = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "DELETE",
			headers,
		});
		expect(deleted.status).toBe(403);
		expect(
			(await fetch(`${baseUrl}/api/presentations/${deck.id}`)).status,
		).toBe(200);
	});

	test("the deck's exports follow the same level as its mutations", async () => {
		// REQ095/REQ096 — both exports are gated with `requireEdit`, so a grant is
		// the third way to open them, exactly as it is the third way to run the
		// deck. `edit` reads them; `view` is refused with the `403` that says "you
		// have standing here, just not this standing"; a stranger's account gets
		// the same `403`, and no account at all a `401`.
		const exports = ["results.xlsx", "deck.pdf", "deck.pdf?results=false"];

		const editable = await createOwnedDeck();
		await share(editable.id, "edit");
		for (const path of exports) {
			const res = await fetch(
				`${baseUrl}/api/presentations/${editable.id}/${path}`,
				{ headers: { "x-api-key": collaboratorKey } },
			);
			expect(`${path}:${res.status}`).toBe(`${path}:200`);
		}

		const viewable = await createOwnedDeck();
		await share(viewable.id, "view");
		for (const path of exports) {
			const refused = await fetch(
				`${baseUrl}/api/presentations/${viewable.id}/${path}`,
				{ headers: { "x-api-key": collaboratorKey } },
			);
			expect(`${path}:${refused.status}`).toBe(`${path}:403`);

			// And an account with no standing on this deck at all.
			const stranger = await fetch(
				`${baseUrl}/api/presentations/${viewable.id}/${path}`,
				{ headers: { "x-api-key": strangerKey } },
			);
			expect(`${path}:${stranger.status}`).toBe(`${path}:403`);

			const anonymous = await fetch(
				`${baseUrl}/api/presentations/${viewable.id}/${path}`,
			);
			expect(`${path}:${anonymous.status}`).toBe(`${path}:401`);
		}
	});

	test("a collaborator reads the deck as its author wrote it, at every level", async () => {
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({
				title: "Quiz deck",
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
		const deck = await res.json();
		await share(deck.id, "view");

		const asCollaborator = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": collaboratorKey },
			})
		).json();
		expect(asCollaborator.accessLevel).toBe("view");
		// The level governs what may be changed, not a redacted copy of the deck
		// somebody was deliberately invited to.
		expect(asCollaborator.slides[0].options[0].isCorrect).toBe(true);
		expect(asCollaborator.slides[0].notes).toBe("Say it slowly");

		// A caller with no standing still meets the audience's view (REQ056/REQ090).
		const asStranger = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": strangerKey },
			})
		).json();
		expect(asStranger.slides[0].options[0]).not.toHaveProperty("isCorrect");
		expect(asStranger.slides[0].notes).toBe("");
	});

	// ── Privilege escalation through the patch body ─────────
	//
	// The two limits this slice puts on an `edit` grant — no delete, no re-share —
	// are worth exactly as much as the deck's own credentials are unwritable. The
	// PATCH route takes a free-form patch that the store *merges* into the stored
	// document, and `StoredPresentationSchema` declares `creatorId` and
	// `creatorTokenHash`, so before `UpdatePresentationSchema` existed a
	// collaborator could write themselves into either and walk around both limits
	// in one request. Both routes down are asserted, not just the write.

	test("an `edit` collaborator cannot write themselves into `creatorId`", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");
		const headers = {
			"Content-Type": "application/json",
			"x-api-key": collaboratorKey,
		};

		// The patch is *accepted* — a collaborator may rename the deck — and the
		// credential riding beside the rename is dropped rather than merged.
		const patched = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({
				title: "Renamed by a collaborator",
				creatorId: collaboratorUserId,
			}),
		});
		expect(patched.status).toBe(200);
		expect((await patched.json()).title).toBe("Renamed by a collaborator");

		// Neither power the grant is denied has been acquired.
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					method: "DELETE",
					headers: { "x-api-key": collaboratorKey },
				})
			).status,
		).toBe(403);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
					method: "POST",
					headers,
					body: JSON.stringify({ email: STRANGER_EMAIL, level: "edit" }),
				})
			).status,
		).toBe(403);

		// And the owner still owns it: it is in their `/mine`, not the
		// collaborator's, and they can still manage the list.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.some((deckOfMine: Any) => deckOfMine.id === deck.id)).toBe(true);
		const notMine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": collaboratorKey },
			})
		).json();
		expect(notMine.some((deckOfMine: Any) => deckOfMine.id === deck.id)).toBe(
			false,
		);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/collaborators`, {
					headers: { "x-api-key": ownerKey },
				})
			).status,
		).toBe(200);
	});

	test("an `edit` collaborator cannot plant an edit token or orphan the deck", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "edit");
		const headers = {
			"Content-Type": "application/json",
			"x-api-key": collaboratorKey,
		};

		// The variant that needs no account id at all: make the deck ownerless with
		// a token hash of the collaborator's choosing, then claim it. The hash is
		// the SHA-256 the server would have stored for `plantedToken`.
		const plantedToken = "planted-token-value";
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(plantedToken);
		const planted = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({
				creatorId: null,
				creatorTokenHash: hasher.digest("hex"),
			}),
		});
		expect(planted.status).toBe(200);

		// The token was never stored, so it authorizes nothing…
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
					method: "POST",
					headers: { Authorization: `Bearer ${plantedToken}` },
				})
			).status,
		).toBe(401);
		// …and the deck was never orphaned, so there is nothing to claim.
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/claim`, {
					method: "POST",
					headers: {
						"x-api-key": collaboratorKey,
						Authorization: `Bearer ${plantedToken}`,
					},
				})
			).status,
		).toBe(409);

		// So a revoke is still total: nothing the collaborator planted outlives it.
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
					{ method: "DELETE", headers: { "x-api-key": ownerKey } },
				)
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
					method: "POST",
					headers: {
						"x-api-key": collaboratorKey,
						Authorization: `Bearer ${plantedToken}`,
					},
				})
			).status,
		).toBe(403);
	});

	test("the deck's results link is not writable through the patch body either", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update("planted-results-token");
		const patched = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": collaboratorKey,
			},
			body: JSON.stringify({
				resultsTokenHash: hasher.digest("hex"),
				resultsTokenIssuedAt: "2026-01-01T00:00:00.000Z",
			}),
		});
		expect(patched.status).toBe(200);
		// The owner's own view of the link is the authority on whether one exists.
		const link = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/results-link`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(link.active).toBe(false);
		expect(link.issuedAt).toBeNull();
	});

	// ── Who may widen the deck ──────────────────────────────

	test("only the owner manages the list — not a collaborator, not the edit token", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");

		// An `edit` collaborator cannot re-share, cannot read the list, and cannot
		// revoke anybody — sharing is not something a grant can widen.
		const reshare = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": collaboratorKey,
				},
				body: JSON.stringify({ email: STRANGER_EMAIL, level: "edit" }),
			},
		);
		expect(reshare.status).toBe(403);
		const list = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators`,
			{ headers: { "x-api-key": collaboratorKey } },
		);
		expect(list.status).toBe(403);

		// An anonymous deck's edit token is a forwardable capability with no
		// account behind it; it opens mutations, never the sharing surface.
		const anonymous = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Tokened", slides: SLIDES }),
			})
		).json();
		const viaToken = await fetch(
			`${baseUrl}/api/presentations/${anonymous.id}/collaborators`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${anonymous.creatorToken}`,
				},
				body: JSON.stringify({ email: STRANGER_EMAIL, level: "edit" }),
			},
		);
		expect(viaToken.status).toBe(401);

		// And an account that merely holds the token is still not the owner.
		const viaTokenAndAccount = await fetch(
			`${baseUrl}/api/presentations/${anonymous.id}/collaborators`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": strangerKey,
					Authorization: `Bearer ${anonymous.creatorToken}`,
				},
				body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "edit" }),
			},
		);
		expect(viaTokenAndAccount.status).toBe(403);
	});

	// ── Changing and revoking ───────────────────────────────

	test("a level change lands on the collaborator's next request", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "edit");
		const headers = { "x-api-key": collaboratorKey };

		expect(
			(await mutations(deck.id, SLIDES[0].id).start(headers)).status,
		).toBe(200);

		const demoted = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ level: "view" }),
			},
		);
		expect(demoted.status).toBe(200);
		expect((await demoted.json()).level).toBe("view");

		// No cache, no issued credential, nothing to wait out.
		expect((await mutations(deck.id, SLIDES[0].id).end(headers)).status).toBe(
			403,
		);
	});

	test("a revoke is immediate and total", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "edit");
		const headers = { "x-api-key": collaboratorKey };

		const revoked = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
			{ method: "DELETE", headers: { "x-api-key": ownerKey } },
		);
		expect(revoked.status).toBe(200);

		expect(
			(await mutations(deck.id, SLIDES[0].id).start(headers)).status,
		).toBe(403);
		const shared = await (
			await fetch(`${baseUrl}/api/presentations/shared`, { headers })
		).json();
		expect(shared.some((p: Any) => p.id === deck.id)).toBe(false);
		const read = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, { headers })
		).json();
		expect(read.accessLevel).toBeNull();

		// Revoking twice is a 404 rather than a second success.
		const again = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
			{ method: "DELETE", headers: { "x-api-key": ownerKey } },
		);
		expect(again.status).toBe(404);
	});

	test("a grant id from another deck cannot be used to write across decks", async () => {
		const one = await createOwnedDeck();
		const other = await createOwnedDeck();
		const grant = await share(one.id, "view");

		const crossPatch = await fetch(
			`${baseUrl}/api/presentations/${other.id}/collaborators/${grant.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ level: "edit" }),
			},
		);
		expect(crossPatch.status).toBe(404);
		const crossDelete = await fetch(
			`${baseUrl}/api/presentations/${other.id}/collaborators/${grant.id}`,
			{ method: "DELETE", headers: { "x-api-key": ownerKey } },
		);
		expect(crossDelete.status).toBe(404);

		// The grant it aimed at is untouched.
		const list = await (
			await fetch(`${baseUrl}/api/presentations/${one.id}/collaborators`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(list[0].level).toBe("view");
	});

	test("deleting a deck takes its grants with it", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "edit");
		const { revokeAllDeckAccess, listDeckCollaborators } = await import(
			"./services/collaborators"
		);
		expect(await listDeckCollaborators(deck.id)).toHaveLength(1);

		const deleted = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "DELETE",
			headers: { "x-api-key": ownerKey },
		});
		expect(deleted.status).toBe(200);
		expect(await listDeckCollaborators(deck.id)).toHaveLength(0);
		// The sweep is idempotent — nothing left for a second pass to find.
		expect(await revokeAllDeckAccess(deck.id)).toBe(0);

		const shared = await (
			await fetch(`${baseUrl}/api/presentations/shared`, {
				headers: { "x-api-key": collaboratorKey },
			})
		).json();
		expect(shared.some((p: Any) => p.id === deck.id)).toBe(false);
	});
});
