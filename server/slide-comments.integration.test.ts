/**
 * Integration tests for comment threads on slides (REQ074).
 *
 * The requirement is two sentences, and this suite is organized as those two:
 *
 *   - *readable and writable by the accounts it is shared with* — the owner and
 *     a `comment` or `edit` grantee write and read; a `view` grantee reads and
 *     is refused a write; a stranger's account, an anonymous caller and the
 *     holder of the deck's **edit token** are refused both, since a comment has
 *     an author and a forwardable token has nobody behind it.
 *   - *never visible to participants* — asserted rather than arranged for. A
 *     comment is written carrying a marker string, and every payload a caller
 *     without an account on the deck can reach is fetched and searched for it:
 *     the join lookup, the deck read (anonymous, participant and edit-token),
 *     the public list, both results reads, the results **link**, the Q&A, the
 *     chat, a scorecard, the organizer's own preview and export input, and the
 *     `slide.changed` frame the whole room is broadcast.
 *
 * Stands up the real Elysia app (auth handler + presentation routes + the `/ws`
 * mount) against a throw-away in-memory docstore and a temp auth DB, exactly as
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
	mkdtempSync(join(tmpdir(), "omul-slide-comments-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Account credentials created in beforeAll, all via personal API keys.
let ownerKey = "";
let viewerKey = "";
let commenterKey = "";
let editorKey = "";
let strangerKey = "";

const OWNER_EMAIL = "comments-owner@example.com";
const VIEWER_EMAIL = "comments-viewer@example.com";
const COMMENTER_EMAIL = "comments-commenter@example.com";
const EDITOR_EMAIL = "comments-editor@example.com";
const STRANGER_EMAIL = "comments-stranger@example.com";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Which one?",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		],
	},
	{ id: "s2", type: "open-text", question: "Anything else?" },
];

/**
 * The string every leak assertion looks for. Nothing else in this API says it,
 * so finding it anywhere outside a comments payload is the failure itself.
 */
const MARKER = "PRIVATE-COMMENT-MARKER-b7f2";

async function createOwnedDeck(): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
		body: JSON.stringify({ title: "Commented deck", slides: SLIDES }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

/** Share a deck with one of the accounts above, returning the created grant. */
async function share(
	deckId: string,
	level: "view" | "comment" | "edit",
	email: string,
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

async function postComment(
	deckId: string,
	slideId: string,
	body: string,
	key: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${deckId}/comments`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": key },
		body: JSON.stringify({ slideId, body }),
	});
}

async function readComments(deckId: string, key: string): Promise<Any[]> {
	const res = await fetch(`${baseUrl}/api/presentations/${deckId}/comments`, {
		headers: { "x-api-key": key },
	});
	expect(res.status).toBe(200);
	return res.json();
}

describe("comment threads on slides (REQ074)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		// The `/ws` mount is this suite's own miniature of `server/index.ts`, and it
		// is here because one of the leak assertions is about a frame rather than a
		// response: `slide.changed` goes to every socket in the room.
		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.ws("/ws", {
				open(connection) {
					const clientId = ws.registerClient(connection);
					(connection.raw as Any).data = {
						...((connection.raw as Any).data ?? {}),
						clientId,
					};
				},
				message(connection, message) {
					try {
						const parsed =
							typeof message === "string" ? JSON.parse(message) : message;
						if (parsed.type !== "join") return;
						const clientId = (connection.raw as Any).data?.clientId as
							| string
							| undefined;
						if (!clientId) return;
						ws.joinRoom(
							clientId,
							parsed.presentationId,
							parsed.role || "participant",
						);
					} catch {
						// ignore malformed
					}
				},
				close(connection) {
					const clientId = (connection.raw as Any).data?.clientId as
						| string
						| undefined;
					if (clientId) ws.removeClient(clientId);
				},
			})
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		wsUrl = `ws://localhost:${app.server?.port}/ws`;
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
		viewerKey = (await accountFor(VIEWER_EMAIL, "Viewer")).key;
		commenterKey = (await accountFor(COMMENTER_EMAIL, "Commenter")).key;
		editorKey = (await accountFor(EDITOR_EMAIL, "Editor")).key;
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

	// ── The thread itself ───────────────────────────────────

	test("the owner writes on a slide and reads it back, anchored and attributed", async () => {
		const deck = await createOwnedDeck();
		const posted = await postComment(deck.id, "s1", "The wording is off", ownerKey);
		expect(posted.status).toBe(201);
		const comment = await posted.json();
		expect(comment.slideId).toBe("s1");
		expect(comment.body).toBe("The wording is off");
		expect(comment.authorName).toBe("Owner");
		expect(comment.mine).toBe(true);
		// The identifiers that must never travel, on the one payload built from a
		// row holding one.
		expect(comment).not.toHaveProperty("authorId");
		expect(comment).not.toHaveProperty("presentationId");
		expect(JSON.stringify(comment)).not.toContain(OWNER_EMAIL);

		const list = await readComments(deck.id, ownerKey);
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(comment.id);
	});

	test("a deck's threads are per slide, and the whole conversation arrives oldest-first", async () => {
		const deck = await createOwnedDeck();
		expect((await postComment(deck.id, "s1", "first", ownerKey)).status).toBe(201);
		expect((await postComment(deck.id, "s2", "second", ownerKey)).status).toBe(201);
		expect((await postComment(deck.id, "s1", "third", ownerKey)).status).toBe(201);

		const list = await readComments(deck.id, ownerKey);
		expect(list.map((comment: Any) => comment.body)).toEqual([
			"first",
			"second",
			"third",
		]);
		expect(
			list
				.filter((comment: Any) => comment.slideId === "s1")
				.map((comment: Any) => comment.body),
		).toEqual(["first", "third"]);
	});

	test("a comment must be anchored to a slide the deck actually has", async () => {
		const deck = await createOwnedDeck();
		const orphan = await postComment(deck.id, "no-such-slide", "?", ownerKey);
		expect(orphan.status).toBe(404);
		expect(await readComments(deck.id, ownerKey)).toHaveLength(0);
	});

	test("a comment on a slide since authored off the deck is not drawn as a thread", async () => {
		const deck = await createOwnedDeck();
		expect((await postComment(deck.id, "s2", "on the second", ownerKey)).status).toBe(
			201,
		);
		// The organizer deletes that slide: the thread is anchored to nothing a
		// client can draw, so it is not handed to one.
		const patched = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ slides: [SLIDES[0]] }),
		});
		expect(patched.status).toBe(200);
		expect(await readComments(deck.id, ownerKey)).toHaveLength(0);
	});

	// ── Who may read and who may write ──────────────────────

	test("`comment` and `edit` write; `view` reads and is refused a write", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "view", VIEWER_EMAIL);
		await share(deck.id, "comment", COMMENTER_EMAIL);
		await share(deck.id, "edit", EDITOR_EMAIL);

		expect((await postComment(deck.id, "s1", "from comment", commenterKey)).status).toBe(
			201,
		);
		expect((await postComment(deck.id, "s1", "from edit", editorKey)).status).toBe(201);
		// The first thing in this API that tells `view` and `comment` apart — 403,
		// not 401: this account has real standing, it simply does not have this one.
		const refused = await postComment(deck.id, "s1", "from view", viewerKey);
		expect(refused.status).toBe(403);

		// …and the refusal is a refusal, not a silently dropped write.
		const asViewer = await readComments(deck.id, viewerKey);
		expect(asViewer.map((comment: Any) => comment.body)).toEqual([
			"from comment",
			"from edit",
		]);
		// Every level reads the thread as the others wrote it, and each caller is
		// told which lines are their own.
		expect(asViewer.every((comment: Any) => comment.mine === false)).toBe(true);
		const asCommenter = await readComments(deck.id, commenterKey);
		expect(
			asCommenter.filter((comment: Any) => comment.mine).map((one: Any) => one.body),
		).toEqual(["from comment"]);
		expect(await readComments(deck.id, ownerKey)).toHaveLength(2);
	});

	test("no account, no thread — a stranger, an anonymous caller and the edit token alike", async () => {
		const deck = await createOwnedDeck();
		await postComment(deck.id, "s1", MARKER, ownerKey);
		const path = `${baseUrl}/api/presentations/${deck.id}/comments`;

		// An account with no grant on this deck: real credentials, no standing.
		expect((await fetch(path, { headers: { "x-api-key": strangerKey } })).status).toBe(
			403,
		);
		expect((await postComment(deck.id, "s1", "hello", strangerKey)).status).toBe(403);

		// No account at all — which is every participant in the room.
		expect((await fetch(path)).status).toBe(401);
		expect(
			(
				await fetch(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ slideId: "s1", body: "hello" }),
				})
			).status,
		).toBe(401);

		// The deck's own **edit token**, which authorizes every mutation on it. A
		// comment has an author and this capability is anonymous and forwardable —
		// an edit link sent to the wrong person must not become a way to read what
		// the accounts on the deck said to each other.
		const anonymous = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Tokened", slides: SLIDES }),
			})
		).json();
		const tokened = { Authorization: `Bearer ${anonymous.creatorToken}` };
		// It opens the deck's mutations…
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${anonymous.id}/start`, {
					method: "POST",
					headers: tokened,
				})
			).status,
		).toBe(200);
		// …and nothing here.
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${anonymous.id}/comments`, {
					headers: tokened,
				})
			).status,
		).toBe(401);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/comments`, {
					headers: tokened,
				})
			).status,
		).toBe(401);

		// And the deck read *says so up front*: `accessLevel` reports `edit` for
		// the token (it authorizes every mutation), while `commentAccess` reports
		// the account standing the threads are gated on — `null` here, so a
		// client gating its comment surfaces on it never fires the read this
		// test just watched get refused.
		const tokenedRead = await (
			await fetch(`${baseUrl}/api/presentations/${anonymous.id}`, {
				headers: tokened,
			})
		).json();
		expect(tokenedRead.accessLevel).toBe("edit");
		expect(tokenedRead.commentAccess).toBeNull();
	});

	test("commentAccess reports the account standing the threads are gated on", async () => {
		const deck = await createOwnedDeck();
		const ownerRead = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(ownerRead.commentAccess).toBe("edit");

		await share(deck.id, "view", VIEWER_EMAIL);
		const viewerRead = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				headers: { "x-api-key": viewerKey },
			})
		).json();
		expect(viewerRead.commentAccess).toBe("view");

		// No standing at all is reported, not omitted (ADR-0024).
		const anonymousRead = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(anonymousRead.commentAccess).toBeNull();
	});

	test("a grandfathered ownerless deck opens no thread to an anonymous caller", async () => {
		// A pre-auth deck (no owner, no token hash) is grandfathered as *editable*
		// so old decks keep working. Reading that as standing on a conversation
		// would make every anonymous caller an author on it.
		const { getPresentation } = await import("./services/presentations");
		const anonymous = await (
			await fetch(`${baseUrl}/api/presentations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Legacy", slides: SLIDES }),
			})
		).json();
		const { createStore } = await import("./db");
		const { StoredPresentationSchema } = await import("./schemas");
		const store = createStore("presentations", StoredPresentationSchema);
		await store.update(anonymous.id, {
			creatorId: null,
			creatorTokenHash: null,
		});
		expect((await getPresentation(anonymous.id))?.creatorTokenHash).toBeNull();

		expect(
			(await fetch(`${baseUrl}/api/presentations/${anonymous.id}/comments`)).status,
		).toBe(401);
		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${anonymous.id}/comments`, {
					headers: { "x-api-key": strangerKey },
				})
			).status,
		).toBe(403);
	});

	test("a revoked collaborator loses the thread on their next request", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "comment", COMMENTER_EMAIL);
		expect((await postComment(deck.id, "s1", "while I could", commenterKey)).status).toBe(
			201,
		);

		const revoked = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
			{ method: "DELETE", headers: { "x-api-key": ownerKey } },
		);
		expect(revoked.status).toBe(200);

		expect(
			(
				await fetch(`${baseUrl}/api/presentations/${deck.id}/comments`, {
					headers: { "x-api-key": commenterKey },
				})
			).status,
		).toBe(403);
		expect((await postComment(deck.id, "s1", "after", commenterKey)).status).toBe(403);
		// What they wrote stands — a revoke takes away standing, not the record of
		// a conversation the deck's owner is still having.
		const list = await readComments(deck.id, ownerKey);
		expect(list.map((comment: Any) => comment.body)).toEqual(["while I could"]);
	});

	test("a demotion to `view` takes the pen away and leaves the reading", async () => {
		const deck = await createOwnedDeck();
		const grant = await share(deck.id, "comment", COMMENTER_EMAIL);
		expect((await postComment(deck.id, "s1", "mine", commenterKey)).status).toBe(201);

		const demoted = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/collaborators/${grant.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ level: "view" }),
			},
		);
		expect(demoted.status).toBe(200);

		expect((await postComment(deck.id, "s1", "again", commenterKey)).status).toBe(403);
		expect(await readComments(deck.id, commenterKey)).toHaveLength(1);
	});

	// ── Taking back what you said ───────────────────────────

	test("an author removes their own comment, and nobody else's — not even the deck's owner", async () => {
		const deck = await createOwnedDeck();
		await share(deck.id, "comment", COMMENTER_EMAIL);
		const theirs = await (
			await postComment(deck.id, "s1", "theirs", commenterKey)
		).json();
		const ours = await (await postComment(deck.id, "s1", "ours", ownerKey)).json();

		// Moderating somebody else's line is not what a grant — or ownership —
		// carries here. Same 404 either way, so the route cannot be probed with.
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/comments/${theirs.id}`,
					{ method: "DELETE", headers: { "x-api-key": ownerKey } },
				)
			).status,
		).toBe(404);
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/comments/${ours.id}`,
					{ method: "DELETE", headers: { "x-api-key": commenterKey } },
				)
			).status,
		).toBe(404);
		expect(await readComments(deck.id, ownerKey)).toHaveLength(2);

		// Their own, though, is theirs to take back.
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/comments/${theirs.id}`,
					{ method: "DELETE", headers: { "x-api-key": commenterKey } },
				)
			).status,
		).toBe(200);
		const left = await readComments(deck.id, ownerKey);
		expect(left.map((comment: Any) => comment.body)).toEqual(["ours"]);
		// Deleting twice is a 404 rather than a second success.
		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${deck.id}/comments/${theirs.id}`,
					{ method: "DELETE", headers: { "x-api-key": commenterKey } },
				)
			).status,
		).toBe(404);
	});

	test("a comment id from another deck cannot be used to delete across decks", async () => {
		const one = await createOwnedDeck();
		const other = await createOwnedDeck();
		const comment = await (
			await postComment(one.id, "s1", "on the first deck", ownerKey)
		).json();

		expect(
			(
				await fetch(
					`${baseUrl}/api/presentations/${other.id}/comments/${comment.id}`,
					{ method: "DELETE", headers: { "x-api-key": ownerKey } },
				)
			).status,
		).toBe(404);
		expect(await readComments(one.id, ownerKey)).toHaveLength(1);
	});

	// ── What a session does and does not clear ──────────────

	test("a reset clears the room's records and leaves the deck's conversation", async () => {
		const deck = await createOwnedDeck();
		await postComment(deck.id, "s1", "still here afterwards", ownerKey);
		await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "s1", value: "a", participantId: "p1" }),
		});
		const reset = await fetch(`${baseUrl}/api/presentations/${deck.id}/reset`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		expect(reset.status).toBe(200);

		// Re-running a session is not un-saying what the deck's authors said about
		// its slides — the room did not write any of it.
		const list = await readComments(deck.id, ownerKey);
		expect(list.map((comment: Any) => comment.body)).toEqual([
			"still here afterwards",
		]);
	});

	test("deleting a deck takes its threads with it", async () => {
		const deck = await createOwnedDeck();
		await postComment(deck.id, "s1", MARKER, ownerKey);
		const { listDeckComments, deleteDeckComments } = await import(
			"./services/slide-comments"
		);
		expect(await listDeckComments(deck.id)).toHaveLength(1);

		const deleted = await fetch(`${baseUrl}/api/presentations/${deck.id}`, {
			method: "DELETE",
			headers: { "x-api-key": ownerKey },
		});
		expect(deleted.status).toBe(200);
		expect(await listDeckComments(deck.id)).toHaveLength(0);
		// The sweep is idempotent — nothing left for a second pass to find.
		expect(await deleteDeckComments(deck.id)).toBe(0);
	});

	// ── Never visible to participants: the sweep ────────────

	test("no payload a caller without an account on the deck can reach carries a comment", async () => {
		const deck = await createOwnedDeck();
		await postComment(deck.id, "s1", MARKER, ownerKey);
		await postComment(deck.id, "s2", MARKER, ownerKey);

		// A running session with a participant in it, so every surface below has
		// real content to hand back rather than an empty one that would pass
		// vacuously.
		await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/qa/settings`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ enabled: true, visibility: "everyone" }),
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/channels`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ chatEnabled: true }),
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "s1", value: "a", participantId: "p1" }),
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/qa`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "A question", participantId: "p1" }),
		});
		await fetch(`${baseUrl}/api/presentations/${deck.id}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "A message", participantId: "p1" }),
		});
		const resultsLink = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}/results-link`, {
				method: "POST",
				headers: { "x-api-key": ownerKey },
			})
		).json();

		const surfaces: [string, Promise<Response>][] = [
			// The room's own doors.
			[`join/:code`, fetch(`${baseUrl}/api/join/${deck.code}`)],
			[
				"deck (anonymous)",
				fetch(`${baseUrl}/api/presentations/${deck.id}`),
			],
			[
				"deck (a stranger's account)",
				fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: { "x-api-key": strangerKey },
				}),
			],
			[
				"deck (the edit token)",
				fetch(`${baseUrl}/api/presentations/${deck.id}`, {
					headers: { Authorization: "Bearer nonsense" },
				}),
			],
			["public list", fetch(`${baseUrl}/api/presentations`)],
			// Every tally read, including the one the results link opens (REQ098).
			["results", fetch(`${baseUrl}/api/presentations/${deck.id}/results`)],
			[
				"results/:slideId",
				fetch(`${baseUrl}/api/presentations/${deck.id}/results/s1`),
			],
			[
				"results (the shareable link)",
				fetch(`${baseUrl}/api/presentations/${deck.id}/results`, {
					headers: { "x-omul-results-token": resultsLink.resultsToken },
				}),
			],
			// The participant-facing layers.
			[
				"qa",
				fetch(`${baseUrl}/api/presentations/${deck.id}/qa?participantId=p1`),
			],
			[
				"chat",
				fetch(`${baseUrl}/api/presentations/${deck.id}/chat?participantId=p1`),
			],
			[
				"scorecard",
				fetch(
					`${baseUrl}/api/presentations/${deck.id}/scorecard?participantId=p1`,
				),
			],
			// And the organizer's own two, whose participant panes are the room's
			// view rendered back to them (REQ103) — a dry run that leaked a comment
			// would be showing the organizer a phone that does not exist.
			[
				"preview",
				fetch(`${baseUrl}/api/presentations/${deck.id}/preview`, {
					headers: { "x-api-key": ownerKey },
				}),
			],
		];

		for (const [name, pending] of surfaces) {
			const response = await pending;
			expect(`${name}:${response.status}`).toBe(`${name}:200`);
			const payload = await response.text();
			expect(`${name}:${payload.includes(MARKER)}`).toBe(`${name}:false`);
			expect(`${name}:${payload.includes("comments")}`).toBe(`${name}:false`);
		}

		// The spreadsheet is a zip, so searching its bytes for the marker would
		// prove nothing. The workbook's **input** is what the sheets are built
		// from, and that is searchable.
		const { getResultsExport } = await import("./services/presentations");
		const workbookInput = await getResultsExport(deck.id, {
			exportedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(JSON.stringify(workbookInput)).not.toContain(MARKER);
	});

	test("the frame the whole room is broadcast carries no comment either", async () => {
		const deck = await createOwnedDeck();
		await postComment(deck.id, "s2", MARKER, ownerKey);

		const socket = new WebSocket(wsUrl);
		const frames: string[] = [];
		socket.addEventListener("message", (event) => {
			const raw = (event as MessageEvent).data;
			frames.push(
				typeof raw === "string" ? raw : new TextDecoder().decode(raw as Any),
			);
		});
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener(
				"error",
				() => reject(new Error("socket failed")),
				{ once: true },
			);
		});
		// A socket claiming to be the presenter, deliberately: a room is broadcast
		// to by presentation and the role a socket claims proves nothing, so this is
		// the most a participant could ask to be sent.
		socket.send(
			JSON.stringify({
				type: "join",
				presentationId: deck.id,
				role: "presenter",
			}),
		);

		await fetch(`${baseUrl}/api/presentations/${deck.id}/start`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		const navigated = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/slide`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ index: 1 }),
			},
		);
		expect(navigated.status).toBe(200);

		const deadline = Date.now() + 3000;
		while (
			Date.now() < deadline &&
			!frames.some((frame) => frame.includes("slide.changed"))
		) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(frames.some((frame) => frame.includes("slide.changed"))).toBe(true);
		for (const frame of frames) expect(frame).not.toContain(MARKER);
		socket.close();
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
});
