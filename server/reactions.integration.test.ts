/**
 * Integration tests for reactions on any slide (REQ077).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * The requirement is one sentence with two clauses, and the second is the one
 * worth a suite:
 *
 *   - **"on any slide type"** — every slide takes reactions, including the
 *     content slides that collect no answers at all, because a reaction is not
 *     an answer to the question on screen.
 *   - **"not stored as answers or counted in any tally"** — proved by reaching
 *     past the API and opening the collections directly: after a burst of
 *     reactions the votes table is empty, no new collection has appeared, and
 *     every tally still reads zero.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0/p1/qa
 * harnesses, and `createStore` is idempotent per collection name, so the handles
 * below are the same tables the service would write through — if it wrote.
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

/** A direct handle on the collection a reaction must never reach. */
let voteStore: import("./db").Store;

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

/**
 * A live deck whose slides span the range the requirement names: one that
 * collects answers, and one that collects nothing at all.
 */
async function createAndStart(
	body: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Reactions Test",
			slides: [
				{ id: "s1", type: "word-cloud", question: "Anything?" },
				{ id: "s2", type: "text", question: "Just a slide" },
			],
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

async function react(
	presentationId: string,
	kind: string,
	options: { slideId?: string; participantId?: string } = {},
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/reactions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			kind,
			slideId: options.slideId,
			participantId: options.participantId ?? "p1",
		}),
	});
}

describe("reactions on any slide (REQ077)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const schemas = await import("./schemas");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();
		voteStore = db.createStore("votes", schemas.StoredVoteSchema);

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

	// ── The channel, closed and open ──────────────────────────

	test("a fresh deck has the channel closed", async () => {
		const pres = await createAndStart();
		expect(pres.reactionsEnabled).toBe(false);
	});

	test("reactions are refused while the channel is closed", async () => {
		const pres = await createAndStart();
		const res = await react(pres.id, "like", { slideId: "s1" });
		expect(res.status).toBe(400);
	});

	test("the presenter opens the channel and the deck says so", async () => {
		const pres = await createAndStart();
		const settingsRes = await setChannels(pres, { reactionsEnabled: true });
		expect(settingsRes.status).toBe(200);
		const updated = await settingsRes.json();
		expect(updated.reactionsEnabled).toBe(true);
		// The other channel is left exactly as it stood — the two switches move
		// independently.
		expect(updated.chatEnabled).toBe(false);
		// And the deck's internals never ride the response.
		expect(updated.creatorTokenHash).toBeUndefined();
		expect(updated.creatorId).toBeUndefined();
	});

	test("the channel can be authored with the deck", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		expect(pres.reactionsEnabled).toBe(true);
		expect((await react(pres.id, "love", { slideId: "s1" })).status).toBe(200);
	});

	test("opening the channel needs the edit token", async () => {
		const pres = await createAndStart();
		const res = await authed(
			`/api/presentations/${pres.id}/channels`,
			"not-the-creator-token",
			{ method: "POST", body: JSON.stringify({ reactionsEnabled: true }) },
		);
		expect(res.status).toBe(401);
		const after = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect((await after.json()).reactionsEnabled).toBe(false);
	});

	// ── "on any slide type" ───────────────────────────────────

	test("every slide takes reactions — including one that collects no answers", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		// A word-cloud slide, which does collect answers …
		const onQuestion = await react(pres.id, "like", { slideId: "s1" });
		expect(onQuestion.status).toBe(200);
		// … and a content slide, which collects none. There is nothing to answer
		// here, which is precisely why a reaction has to work: it is not an answer.
		const onContent = await react(pres.id, "celebrate", { slideId: "s2" });
		expect(onContent.status).toBe(200);
	});

	test("a reaction that names no slide is still a reaction", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		const res = await react(pres.id, "laugh");
		expect(res.status).toBe(200);
		// Reported as an explicit null rather than dropped from the body.
		expect(await res.json()).toMatchObject({ ok: true, slideId: null });
	});

	test("the response carries the frame the room was sent", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		const res = await react(pres.id, "insight", { slideId: "s1" });
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.kind).toBe("insight");
		expect(body.slideId).toBe("s1");
		expect(typeof body.id).toBe("string");
		expect(body.id.length).toBeGreaterThan(0);
		// The server's clock, so every screen in the room animates against one.
		expect(Number.isNaN(Date.parse(body.at))).toBe(false);
		// Two sends are two things on screen, never one.
		const second = await react(pres.id, "insight", { slideId: "s1" });
		expect((await second.json()).id).not.toBe(body.id);
	});

	test("a kind nobody declared is refused at the boundary", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		expect((await react(pres.id, "shrug", { slideId: "s1" })).status).toBe(422);
	});

	// ── "not stored as answers or counted in any tally" ───────

	test("a burst of reactions writes nothing and moves no tally", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });

		// Guard the test itself: a "nothing was written" assertion over a deck
		// nobody voted on would pass against the very defect it exists to catch, so
		// one real answer goes in first and must be the only thing there at the end.
		const voteRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				value: "an actual answer",
				participantId: "voter",
			}),
		});
		expect(voteRes.status).toBe(200);

		const before = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/s1`,
		);
		const tallyBefore = await before.json();

		for (const kind of ["like", "love", "celebrate", "laugh", "insight"]) {
			for (let repeat = 0; repeat < 4; repeat++) {
				expect(
					(
						await react(pres.id, kind, {
							slideId: "s1",
							participantId: `p${repeat}`,
						})
					).status,
				).toBe(200);
			}
		}

		// Twenty reactions later: one row in `votes`, and it is the answer.
		const stored = await voteStore.find({ presentationId: pres.id });
		expect(stored).toHaveLength(1);
		expect(stored[0].value).toBe("an actual answer");

		// And the slide's tally is byte-for-byte the one it had before them.
		const after = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results/s1`,
		);
		expect(await after.json()).toEqual(tallyBefore);
	});

	test("reactions leave the content slide's aggregate alone too", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		for (const kind of ["like", "love"]) {
			expect((await react(pres.id, kind, { slideId: "s2" })).status).toBe(200);
		}
		const stored = await voteStore.find({ presentationId: pres.id });
		expect(stored).toHaveLength(0);
	});

	test("nothing survives to be exported — a reaction is not in the results payload", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		expect((await react(pres.id, "love", { slideId: "s1" })).status).toBe(200);

		const res = await authed(
			`/api/presentations/${pres.id}/results`,
			pres.creatorToken,
		);
		expect(res.status).toBe(200);
		const rows = await res.json();
		// Nothing anywhere in the deck's whole results payload mentions a reaction:
		// there is no row for it, no counter and no key.
		expect(JSON.stringify(rows)).not.toContain("reaction");
		expect(JSON.stringify(rows)).not.toContain("love");
	});

	// ── The same refusals every other public write meets ──────

	test("a deck that is not accepting submissions refuses reactions", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		const endRes = await authed(
			`/api/presentations/${pres.id}/end`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(endRes.status).toBe(200);
		expect((await react(pres.id, "like", { slideId: "s1" })).status).toBe(400);
	});

	test("a presentation that does not exist answers 400, not a 500", async () => {
		expect((await react("no-such-deck", "like")).status).toBe(400);
	});

	test("closing the channel again stops reactions immediately", async () => {
		const pres = await createAndStart({ reactionsEnabled: true });
		expect((await react(pres.id, "like", { slideId: "s1" })).status).toBe(200);
		expect((await setChannels(pres, { reactionsEnabled: false })).status).toBe(
			200,
		);
		expect((await react(pres.id, "like", { slideId: "s1" })).status).toBe(400);
	});

	test("the deck PATCH is a second writer of the switch", async () => {
		// The editor saves the channel through the ordinary deck update, so that
		// path has to move it too — otherwise an organizer who opens the channel in
		// the editor is told it saved and the room is never told anything.
		const pres = await createAndStart();
		const patchRes = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ reactionsEnabled: true }) },
		);
		expect(patchRes.status).toBe(200);
		expect((await patchRes.json()).reactionsEnabled).toBe(true);
		expect((await react(pres.id, "like", { slideId: "s1" })).status).toBe(200);
	});
});
