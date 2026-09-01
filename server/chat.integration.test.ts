/**
 * Integration tests for the deck's live chat (REQ078).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * The requirement's load-bearing word is **separate** — from the Q&A queue and
 * from slide answers — so most of this suite is about what does *not* leak
 * between the three:
 *
 *   - a posted message appears in the chat and in neither the Q&A list nor any
 *     slide's tally, and a question and a vote appear in neither chat
 *   - the channel has its own switch, its own endpoint and its own refusals
 *   - the writing participant's id never comes back; `own` does
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0/p1/qa
 * harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

async function authed(
	path: string,
	token: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			Authorization: `Bearer ${token}`,
		},
	});
}

/** A live deck with one answer-collecting slide — the chat is closed until asked for. */
async function createAndStart(
	body: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Chat Test",
			slides: [{ id: "s1", type: "word-cloud", question: "Anything?" }],
			...body,
		}),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

async function setChannels(
	pres: AnyJson,
	changes: Record<string, unknown>,
): Promise<Response> {
	return authed(`/api/presentations/${pres.id}/channels`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify(changes),
	});
}

async function post(
	presentationId: string,
	text: string,
	participantId: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, participantId }),
	});
}

/** The feed as one participant reads it. */
async function readChat(
	presentationId: string,
	participantId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/chat?participantId=${encodeURIComponent(participantId)}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("the deck's live chat (REQ078)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes);

		app.listen({ port: 0, hostname: "127.0.0.1" });
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = {
			stop: () => bunServer.stop(true),
			hostname: bunServer.hostname,
			port: bunServer.port,
		};
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here — bun tears it
		// down when the test process exits. Only this suite's server is stopped.
		if (server) await server.stop();
	});

	// ── The channel a deck may carry ──────────────────────────

	test("a fresh deck carries no chat", async () => {
		const pres = await createAndStart();
		expect(pres.chatEnabled).toBe(false);
		const feed = await readChat(pres.id, "p1");
		expect(feed.enabled).toBe(false);
		expect(feed.messages).toEqual([]);
	});

	test("messages are refused while the channel is closed", async () => {
		const pres = await createAndStart();
		expect((await post(pres.id, "hello?", "p1")).status).toBe(400);
	});

	test("the presenter opens it and the deck says so", async () => {
		const pres = await createAndStart();
		const res = await setChannels(pres, { chatEnabled: true });
		expect(res.status).toBe(200);
		const updated = await res.json();
		expect(updated.chatEnabled).toBe(true);
		// The reaction channel is untouched — the two switches move separately.
		expect(updated.reactionsEnabled).toBe(false);
		expect(updated.creatorTokenHash).toBeUndefined();
	});

	test("the channel can be authored with the deck", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect(pres.chatEnabled).toBe(true);
		expect((await post(pres.id, "morning all", "p1")).status).toBe(200);
	});

	test("opening it needs the edit token", async () => {
		const pres = await createAndStart();
		const res = await authed(
			`/api/presentations/${pres.id}/channels`,
			"not-the-creator-token",
			{ method: "POST", body: JSON.stringify({ chatEnabled: true }) },
		);
		expect(res.status).toBe(401);
		expect((await post(pres.id, "sneaking in", "p1")).status).toBe(400);
	});

	// ── The transcript ────────────────────────────────────────

	test("what was said comes back in the order it was said", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		for (const line of ["first", "second", "third"]) {
			expect((await post(pres.id, line, "p1")).status).toBe(200);
		}
		const feed = await readChat(pres.id, "p1");
		expect(feed.messages.map((message: AnyJson) => message.text)).toEqual([
			"first",
			"second",
			"third",
		]);
		expect(feed.messageCount).toBe(3);
	});

	test("everyone in the room reads the same transcript", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "from a", "a")).status).toBe(200);
		expect((await post(pres.id, "from b", "b")).status).toBe(200);

		const asA = await readChat(pres.id, "a");
		const asB = await readChat(pres.id, "b");
		expect(asA.messages.map((message: AnyJson) => message.text)).toEqual([
			"from a",
			"from b",
		]);
		expect(asB.messages.map((message: AnyJson) => message.text)).toEqual([
			"from a",
			"from b",
		]);
		// Unlike the Q&A list there is no per-caller withholding here — a chat is
		// the room's. What differs between two readers is only which lines are
		// theirs.
		expect(asA.messages.map((message: AnyJson) => message.own)).toEqual([
			true,
			false,
		]);
		expect(asB.messages.map((message: AnyJson) => message.own)).toEqual([
			false,
			true,
		]);
	});

	test("the writing participant's id never comes back", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "it's me", "secret-participant")).status).toBe(
			200,
		);
		const feed = await readChat(pres.id, "someone-else");
		// The id is the participant's only credential — the post endpoint is public
		// and accepts whatever id it is handed — so it is projected down to `own`
		// and never emitted, exactly as a Q&A question's asker is.
		expect(JSON.stringify(feed)).not.toContain("secret-participant");
		expect(feed.messages[0].own).toBe(false);
	});

	test("an anonymous reader owns nothing rather than owning everything anonymous", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "said by nobody", "")).status).toBe(200);
		const feed = await readChat(pres.id, "");
		expect(feed.messages[0].own).toBe(false);
	});

	test("repeated lines stay repeated — a chat is not a list to de-duplicate", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "same here", "a")).status).toBe(200);
		expect((await post(pres.id, "same here", "b")).status).toBe(200);
		const feed = await readChat(pres.id, "a");
		expect(feed.messages).toHaveLength(2);
	});

	test("whitespace is trimmed, and a blank message is refused as a blank message", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "  padded  ", "a")).status).toBe(200);

		// Empty and whitespace-only are the same failure and are refused the same
		// way, at the boundary, before the handler ever runs.
		expect((await post(pres.id, "", "a")).status).toBe(422);
		const blank = await post(pres.id, "   ", "a");
		expect(blank.status).toBe(422);

		// And it must not be reported as something it is not. The channel is open
		// and the deck is live, so answering "the chat is off or the presentation
		// is not accepting submissions" would send whoever is debugging it to look
		// at two settings that are both correct.
		const body: AnyJson = await blank.json();
		expect(JSON.stringify(body)).not.toContain("chat is off");

		const feed = await readChat(pres.id, "a");
		expect(feed.messages.map((message: AnyJson) => message.text)).toEqual([
			"padded",
		]);
	});

	test("closing the channel stops posting but not reading", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "before", "a")).status).toBe(200);
		expect((await setChannels(pres, { chatEnabled: false })).status).toBe(200);

		expect((await post(pres.id, "after", "a")).status).toBe(400);
		const feed = await readChat(pres.id, "a");
		// The transcript is still there — a closed channel is not a deleted one,
		// and a participant's own last line must not read as having been removed.
		expect(feed.enabled).toBe(false);
		expect(feed.messages.map((message: AnyJson) => message.text)).toEqual([
			"before",
		]);
	});

	// ── Separate from the Q&A queue and from slide answers ────

	test("a chat message is in the chat and in nothing else", async () => {
		const pres = await createAndStart({
			chatEnabled: true,
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		expect((await post(pres.id, "a line in the chat", "a")).status).toBe(200);

		// Not in the Q&A list …
		const qaRes = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/qa?participantId=a`,
		);
		const qaList = await qaRes.json();
		expect(qaList.questions).toEqual([]);
		expect(qaList.totalCount).toBe(0);

		// … and not in the slide's tally.
		const resultsRes = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/s1`,
		);
		expect(JSON.stringify(await resultsRes.json())).not.toContain(
			"a line in the chat",
		);
	});

	test("a question and a vote are in neither the chat", async () => {
		const pres = await createAndStart({
			chatEnabled: true,
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		const askRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/qa`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "a question for the panel", participantId: "a" }),
		});
		expect(askRes.status).toBe(200);
		const voteRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				value: "an answer to the slide",
				participantId: "a",
			}),
		});
		expect(voteRes.status).toBe(200);

		const feed = await readChat(pres.id, "a");
		expect(feed.messages).toEqual([]);
		expect(feed.messageCount).toBe(0);
	});

	test("the chat's own switch does not turn on with the Q&A layer", async () => {
		// Three channels, three switches. Opening the floor for questions must not
		// quietly open a chat channel beside it.
		const pres = await createAndStart({ qaEnabled: true });
		expect(pres.chatEnabled).toBe(false);
		expect((await post(pres.id, "hello", "a")).status).toBe(400);
	});

	// ── The same refusals every other public write meets ──────

	test("a deck that is not accepting submissions refuses messages", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect(
			(
				await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
					method: "POST",
				})
			).status,
		).toBe(200);
		expect((await post(pres.id, "still here?", "a")).status).toBe(400);
	});

	test("reading a presentation that does not exist answers 404", async () => {
		const res = await fetch(
			`${baseUrl}/api/presentations/no-such-deck/chat?participantId=a`,
		);
		expect(res.status).toBe(404);
	});

	test("a message past the cap is refused at the boundary", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		const { CHAT_TEXT_MAX_LENGTH } = await import("./schemas");
		expect(
			(await post(pres.id, "x".repeat(CHAT_TEXT_MAX_LENGTH), "a")).status,
		).toBe(200);
		expect(
			(await post(pres.id, "x".repeat(CHAT_TEXT_MAX_LENGTH + 1), "a")).status,
		).toBe(422);
	});

	// ── A reset clears the transcript with the answers (REQ101) ──

	test("resetting the deck clears the chat along with the votes", async () => {
		const pres = await createAndStart({ chatEnabled: true });
		expect((await post(pres.id, "last session", "a")).status).toBe(200);
		expect((await readChat(pres.id, "a")).messages).toHaveLength(1);

		const resetRes = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(resetRes.status).toBe(200);

		// The audience in front of you is not the one that was talking.
		expect((await readChat(pres.id, "a")).messages).toEqual([]);
	});

	test("the deck PATCH is a second writer of the switch", async () => {
		const pres = await createAndStart();
		const patchRes = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ chatEnabled: true }) },
		);
		expect(patchRes.status).toBe(200);
		expect((await patchRes.json()).chatEnabled).toBe(true);
		expect((await post(pres.id, "saved from the editor", "a")).status).toBe(200);
	});
});
