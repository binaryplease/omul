/**
 * Integration tests for the account-ownership layer wired on top of Better Auth:
 *
 *   - anonymous create → mints an edit token; API-key create → owner, no token
 *   - owner-or-edit-token authorization on mutations
 *   - POST /presentations/:id/claim (claim an ownerless deck for an account)
 *   - GET  /presentations/mine (owner-scoped listing)
 *   - what GET /presentations/:id *reports* to an owner holding no edit token,
 *     which is the signal every client surface gates its controls on (REQ149)
 *   - the two-step admin reassign-owner flow + audit log
 *
 * Stands up the real Elysia app (auth handler + presentation routes + admin
 * routes) against a throw-away in-memory docstore and a temp auth DB.
 */

// Env must be set before importing ./db, ./accounts, ./admin-events, ./admins
// (they read it at module load). :memory: for the domain + admin stores; a temp
// file for the auth DB so the Better Auth `user` table persists across the suite.
process.env.DATABASE_PATH = ":memory:";
process.env.OMUL_ADMIN_DB = ":memory:";
process.env.NODE_ENV = "test";

// This suite's administrator, in a reserved example domain. The allowlist is
// deployment-supplied (REQ164, server/admins.ts), so a suite that wants an admin
// names one the same way an operator does — through the environment, before
// ./routes/admin pulls the module in. Nothing about who is an admin ships in the
// source any more, here or there.
const ADMIN_EMAIL = "admin@example.com";
process.env.OMUL_ADMIN_EMAILS = ADMIN_EMAIL;

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-ownership-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Account credentials created in beforeAll.
let ownerKey = "";
let ownerCookie = "";
let otherKey = "";
let otherUserId = "";
let adminCookie = "";
let nonAdminCookie = "";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
	},
];

async function createDeck(headers: Record<string, string> = {}): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ title: "Deck", slides: SLIDES }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function signInCookie(email: string, password: string): Promise<string> {
	const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", origin: baseUrl },
		body: JSON.stringify({ email, password }),
	});
	expect(res.ok).toBe(true);
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

describe("account ownership + admin", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { adminRoutes } = await import("./routes/admin");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.use(adminRoutes)
			.listen(0);
		const port = app.server?.port;
		baseUrl = `http://localhost:${port}`;
		server = { stop: async () => void app.stop() };

		// Owner + other accounts, authenticated via personal API keys.
		const owner = await auth.api.signUpEmail({
			body: {
				email: "owner@example.com",
				password: "correct-horse-1",
				name: "Owner",
			},
		});
		ownerKey = (
			await auth.api.createApiKey({
				body: { userId: owner.user.id, name: "k" },
			})
		).key;
		// The same account signed in the way a *browser* is: a cookie session and
		// nothing else. This is the second machine in REQ149 — the account owns the
		// deck, and the `omul-tokens` map that would carry an edit token is on
		// the machine it was created on.
		ownerCookie = await signInCookie("owner@example.com", "correct-horse-1");
		const other = await auth.api.signUpEmail({
			body: {
				email: "other@example.com",
				password: "correct-horse-2",
				name: "Other",
			},
		});
		otherUserId = other.user.id;
		otherKey = (
			await auth.api.createApiKey({
				body: { userId: other.user.id, name: "k" },
			})
		).key;

		// Admin (allowlisted email) + a non-admin, both via cookie sessions.
		await auth.api.signUpEmail({
			body: {
				email: ADMIN_EMAIL,
				password: "correct-horse-3",
				name: "Admin",
			},
		});
		adminCookie = await signInCookie(ADMIN_EMAIL, "correct-horse-3");
		await auth.api.signUpEmail({
			body: {
				email: "bob@example.com",
				password: "correct-horse-4",
				name: "Bob",
			},
		});
		nonAdminCookie = await signInCookie("bob@example.com", "correct-horse-4");
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

	test("anonymous create mints an edit token; edits work with it", async () => {
		const deck = await createDeck();
		expect(typeof deck.creatorToken).toBe("string");
		const res = await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
			headers: { Authorization: `Bearer ${deck.creatorToken}` },
		});
		expect(res.status).toBe(200);
	});

	test("edit without any credential is rejected (401)", async () => {
		const deck = await createDeck();
		const res = await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	test("API-key create → owner, no token, editable via the key, listed in /mine", async () => {
		const deck = await createDeck({ "x-api-key": ownerKey });
		expect(deck.creatorToken).toBeNull();

		// Owner edits with only the key (no edit token).
		const edit = await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		expect(edit.status).toBe(200);

		// A different account (no token) is forbidden.
		const forbidden = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/end`,
			{
				method: "POST",
				headers: { "x-api-key": otherKey },
			},
		);
		expect(forbidden.status).toBe(403);

		// /mine lists it for the owner, not for the other account.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.some((p: Any) => p.id === deck.id)).toBe(true);
		const notMine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": otherKey },
			})
		).json();
		expect(notMine.some((p: Any) => p.id === deck.id)).toBe(false);
	});

	test("/mine requires a session", async () => {
		const res = await fetch(`${baseUrl}/api/presentations/mine`);
		expect(res.status).toBe(401);
	});

	// ── What the deck read *reports* to its caller (REQ149) ──
	//
	// Every client surface draws its controls from one field of this payload —
	// `accessLevel`, the caller's own standing — precisely so that it never has to
	// re-derive authority from whatever the browser happens to hold. The defect
	// these cover is the disagreement that arises when it does: `authorizeEdit`
	// accepts owner **or** edit token, so a client asking only "does this browser
	// hold the token?" hands the owner of a deck a read-only screen. The API-key
	// create path produces exactly that case every time, since it deliberately
	// mints no token at all.
	//
	// Each one checks the report *and* a call gated on the same standing, because
	// a report that disagrees with the gate is the same defect facing the other
	// way — a live button that answers 401.
	describe("an owner holding no edit token (REQ149)", () => {
		test("a deck created via API key reports `edit` to its owner's session", async () => {
			const deck = await createDeck({ "x-api-key": ownerKey });
			// The premise: this deck has no edit token in existence, so no browser
			// anywhere can hold one for it.
			expect(deck.creatorToken).toBeNull();

			// Annotated rather than inferred: an unannotated array of two objects
			// with disjoint keys widens to a union whose members each carry the
			// other's key as `undefined`, which `HeadersInit` refuses. Same
			// `Record<string, string>` the `createDeck` helper above takes.
			const ownerCredentials: Record<string, string>[] = [
				{ "x-api-key": ownerKey },
				{ Cookie: ownerCookie },
			];
			for (const credential of ownerCredentials) {
				const read = await (
					await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
						headers: credential,
					})
				).json();
				expect(read.accessLevel).toBe("edit");
			}

			// And the report is honest: the same cookie session, carrying no token,
			// runs the deck.
			const started = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/start`,
				{ method: "POST", headers: { Cookie: ownerCookie } },
			);
			expect(started.status).toBe(200);
		});

		test("the dry run opens for an owner with no token, since it is authorized as an edit", async () => {
			// The control REQ149 left dead in the editor and on the preview screen:
			// a preview carries the deck's answer keys, so the endpoint gates it like
			// a mutation — which the owner passes with no token at all.
			const deck = await createDeck({ "x-api-key": ownerKey });
			const preview = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/preview`,
				{ headers: { Cookie: ownerCookie } },
			);
			expect(preview.status).toBe(200);
			const refused = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/preview`,
			);
			expect(refused.status).toBe(401);
		});

		test("an owner whose browser lost the token still reads `edit` on their own deck", async () => {
			// The other half of the case: the deck *was* created with a token — in
			// another browser profile, or in one whose site data has since been
			// cleared — and claimed by the account. The token exists and this caller
			// does not have it.
			const deck = await createDeck();
			expect(typeof deck.creatorToken).toBe("string");
			const claimed = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/claim`,
				{
					method: "POST",
					headers: {
						Cookie: ownerCookie,
						Authorization: `Bearer ${deck.creatorToken}`,
					},
				},
			);
			expect(claimed.status).toBe(200);

			const read = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: { Cookie: ownerCookie },
				})
			).json();
			expect(read.accessLevel).toBe("edit");
		});

		test("a caller with no standing is still told they have none", async () => {
			// The direction this must not fail in. Widening what the client asks
			// widens nothing about who is answered `edit`.
			const deck = await createDeck({ "x-api-key": ownerKey });
			const anonymous = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`)
			).json();
			expect(anonymous.accessLevel).toBeNull();
			const stranger = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: { "x-api-key": otherKey },
				})
			).json();
			expect(stranger.accessLevel).toBeNull();
			// And the gate agrees with the report.
			const refused = await fetch(
				`${baseUrl}/api/presentations/${deck.id}/start`,
				{ method: "POST", headers: { "x-api-key": otherKey } },
			);
			expect(refused.status).toBe(403);
		});

		test("the browser that holds only the edit token reads `edit` too", async () => {
			// The standing the client used to ask about *exclusively*. It still
			// answers `edit`, so nothing that worked before this stops working — the
			// point is that it is no longer the only thing that does.
			const deck = await createDeck();
			const read = await (
				await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: { Authorization: `Bearer ${deck.creatorToken}` },
				})
			).json();
			expect(read.accessLevel).toBe("edit");
			// …and it has no account behind it, which is why the comment threads are
			// gated on the second report rather than on this one (REQ074).
			expect(read.commentAccess).toBeNull();
		});
	});

	test("claim attaches an ownerless deck; re-claim is idempotent; other account is 409", async () => {
		const deck = await createDeck();
		// Claim with the owner account + the deck's edit token.
		const claim = await fetch(`${baseUrl}/api/presentations/${deck.id}/claim`, {
			method: "POST",
			headers: {
				"x-api-key": ownerKey,
				Authorization: `Bearer ${deck.creatorToken}`,
			},
		});
		expect(claim.status).toBe(200);

		// Now owned: it appears in the owner's /mine.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(mine.some((p: Any) => p.id === deck.id)).toBe(true);

		// Re-claiming your own deck is idempotent (200).
		const again = await fetch(`${baseUrl}/api/presentations/${deck.id}/claim`, {
			method: "POST",
			headers: {
				"x-api-key": ownerKey,
				Authorization: `Bearer ${deck.creatorToken}`,
			},
		});
		expect(again.status).toBe(200);

		// Another account holding the token cannot steal an owned deck (409).
		const steal = await fetch(`${baseUrl}/api/presentations/${deck.id}/claim`, {
			method: "POST",
			headers: {
				"x-api-key": otherKey,
				Authorization: `Bearer ${deck.creatorToken}`,
			},
		});
		expect(steal.status).toBe(409);
	});

	test("claim without a session is 401", async () => {
		const deck = await createDeck();
		const res = await fetch(`${baseUrl}/api/presentations/${deck.id}/claim`, {
			method: "POST",
			headers: { Authorization: `Bearer ${deck.creatorToken}` },
		});
		expect(res.status).toBe(401);
	});

	test("admin reassign-owner: prepare → confirm hands the deck to the target", async () => {
		const deck = await createDeck({ "x-api-key": ownerKey }); // owned by owner

		// Prepare (admin cookie).
		const prepared = await fetch(`${baseUrl}/api/admin/actions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: adminCookie },
			body: JSON.stringify({
				type: "reassign-presentation",
				presentationId: deck.id,
				targetEmail: "other@example.com",
			}),
		});
		expect(prepared.status).toBe(201);
		const prep = await prepared.json();
		expect(typeof prep.confirmationToken).toBe("string");

		// Confirm.
		const confirmed = await fetch(
			`${baseUrl}/api/admin/actions/${prep.id}/confirm`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: adminCookie },
				body: JSON.stringify({ confirmationToken: prep.confirmationToken }),
			},
		);
		expect(confirmed.status).toBe(200);

		// The deck now belongs to the target account.
		const mine = await (
			await fetch(`${baseUrl}/api/presentations/mine`, {
				headers: { "x-api-key": otherKey },
			})
		).json();
		expect(mine.some((p: Any) => p.id === deck.id)).toBe(true);
		void otherUserId;

		// A second confirm with the same token is 409 (already executed).
		const replay = await fetch(
			`${baseUrl}/api/admin/actions/${prep.id}/confirm`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: adminCookie },
				body: JSON.stringify({ confirmationToken: prep.confirmationToken }),
			},
		);
		expect(replay.status).toBe(409);
	});

	test("admin surface rejects non-admins and anonymous callers", async () => {
		const body = JSON.stringify({
			type: "reassign-presentation",
			presentationId: "whatever",
			targetEmail: "other@example.com",
		});
		// Anonymous → 401.
		const anon = await fetch(`${baseUrl}/api/admin/actions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		});
		expect(anon.status).toBe(401);
		// Signed-in non-admin → 403.
		const bob = await fetch(`${baseUrl}/api/admin/actions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: nonAdminCookie },
			body,
		});
		expect(bob.status).toBe(403);
	});

	test("admin audit log records requested + executed steps", async () => {
		const events = await (
			await fetch(`${baseUrl}/api/admin/events`, {
				headers: { Cookie: adminCookie },
			})
		).json();
		expect(Array.isArray(events)).toBe(true);
		expect(events.some((e: Any) => e.kind === "requested")).toBe(true);
		expect(events.some((e: Any) => e.kind === "executed")).toBe(true);
	});
});
