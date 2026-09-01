/**
 * Integration tests for the presentation-wide Q&A layer.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ036 — the layer is deck-level: switched on once, questions arrive from
 *              anywhere, and the endpoints refuse while it is off
 *   - REQ037 — who reads the list, decided per request from the caller's own
 *              credentials rather than filtered on a client
 *   - REQ060 — upvotes, "mark as answered", and the order the queue is worked in
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0/p1 harnesses.
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

/** A live deck with one ordinary slide — the Q&A layer is off until asked for. */
async function createAndStart(
	body: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Q&A Test",
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

async function setSettings(
	pres: AnyJson,
	changes: Record<string, unknown>,
): Promise<Response> {
	return authed(`/api/presentations/${pres.id}/qa/settings`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify(changes),
	});
}

async function ask(
	presentationId: string,
	text: string,
	participantId: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/qa`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, participantId }),
	});
}

async function upvote(
	presentationId: string,
	questionId: string,
	participantId: string,
): Promise<Response> {
	return fetch(
		`${baseUrl}/api/presentations/${presentationId}/qa/${questionId}/upvote`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId }),
		},
	);
}

/** The list as an anonymous participant reads it. */
async function listAs(
	presentationId: string,
	participantId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/qa?participantId=${encodeURIComponent(participantId)}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The list as the deck's owner reads it — the edit token on the fetch. */
async function listAsOwner(pres: AnyJson): Promise<AnyJson> {
	const res = await authed(
		`/api/presentations/${pres.id}/qa?participantId=presenter`,
		pres.creatorToken,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("Q&A layer integration (REQ036/REQ037/REQ060)", () => {
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

	// ── REQ036 — the layer, on and off ────────────────────────

	test("a fresh deck carries the layer off and its questions unpublished", async () => {
		const pres = await createAndStart();
		expect(pres.qaEnabled).toBe(false);
		expect(pres.qaVisibility).toBe("presenter");
	});

	test("questions are refused while the layer is off", async () => {
		const pres = await createAndStart();
		const res = await ask(pres.id, "Can I ask this?", "p1");
		expect(res.status).toBe(400);
		expect((await listAsOwner(pres)).questions).toHaveLength(0);
	});

	test("switching the layer on takes questions from any slide", async () => {
		const pres = await createAndStart();
		expect((await setSettings(pres, { enabled: true })).status).toBe(200);

		expect((await ask(pres.id, "What about pricing?", "p1")).status).toBe(200);
		expect((await ask(pres.id, "And the roadmap?", "p2")).status).toBe(200);

		const list = await listAsOwner(pres);
		expect(list.enabled).toBe(true);
		expect(list.totalCount).toBe(2);
		expect(list.openCount).toBe(2);
		expect(list.questions.map((question: AnyJson) => question.text)).toContain(
			"What about pricing?",
		);
	});

	test("switching it off again keeps what was collected, for the presenter", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Asked during the phase", "p1");
		expect((await setSettings(pres, { enabled: false })).status).toBe(200);

		// Refused for new questions…
		expect((await ask(pres.id, "Too late", "p2")).status).toBe(400);
		// …but the queue is exactly what a presenter switches the layer off to work
		// through, so it is still theirs to read.
		const owned = await listAsOwner(pres);
		expect(owned.enabled).toBe(false);
		expect(owned.questions).toHaveLength(1);
		// The room reads none of it — bar the asker, who still gets their own
		// words back. That is one rule, not two: you always see what you asked,
		// and you see everyone else's only while the layer is on and published.
		expect((await listAs(pres.id, "p2")).questions).toHaveLength(0);
		const asker = await listAs(pres.id, "p1");
		expect(asker.canSeeAll).toBe(false);
		expect(asker.questions).toHaveLength(1);
		expect(asker.questions[0].own).toBe(true);
	});

	test("the layer's switches are a presentation mutation, not a public one", async () => {
		const pres = await createAndStart();
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/qa/settings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: true }),
		});
		expect(res.status).toBe(401);
		expect((await listAsOwner(pres)).enabled).toBe(false);
	});

	test("a deck that has not gone live yet takes no questions", async () => {
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Draft",
				slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
				qaEnabled: true,
			}),
		});
		const draft = await res.json();
		expect((await ask(draft.id, "Early bird", "p1")).status).toBe(400);
	});

	test("a survey deck takes questions at its own pace, like its votes", async () => {
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Survey",
				slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
				mode: "survey",
				qaEnabled: true,
			}),
		});
		const survey = await res.json();
		expect((await ask(survey.id, "Asked async", "p1")).status).toBe(200);
	});

	// ── REQ037 — who reads the list ───────────────────────────

	test("a moderated deck shows a participant their own questions and nobody else's", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Mine", "alice");
		await ask(pres.id, "Theirs", "bob");

		const alice = await listAs(pres.id, "alice");
		expect(alice.visibility).toBe("presenter");
		expect(alice.canSeeAll).toBe(false);
		expect(alice.questions).toHaveLength(1);
		expect(alice.questions[0].text).toBe("Mine");
		expect(alice.questions[0].own).toBe(true);
		// The counts describe the list that came back, never the volume behind it.
		expect(alice.totalCount).toBe(1);

		const owner = await listAsOwner(pres);
		expect(owner.canSeeAll).toBe(true);
		expect(owner.questions).toHaveLength(2);
	});

	test("publishing the list hands the whole room the same one", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Mine", "alice");
		await ask(pres.id, "Theirs", "bob");

		const alice = await listAs(pres.id, "alice");
		expect(alice.canSeeAll).toBe(true);
		expect(alice.questions).toHaveLength(2);
		expect(alice.questions.map((question: AnyJson) => question.own)).toEqual(
			expect.arrayContaining([true, false]),
		);
	});

	test("the asking participant's id never reaches a client", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Who asked me?", "alice");

		const asRoom = await listAs(pres.id, "bob");
		const asOwner = await listAsOwner(pres);
		for (const payload of [asRoom, asOwner]) {
			expect(JSON.stringify(payload)).not.toContain("alice");
			expect(payload.questions[0]).not.toHaveProperty("participantId");
		}
	});

	test("an id-less reader of a moderated deck is shown nothing", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Something", "alice");
		const anonymous = await listAs(pres.id, "");
		expect(anonymous.questions).toHaveLength(0);
	});

	// ── REQ060 — upvotes ──────────────────────────────────────

	test("an upvote toggles, and only counts once per participant", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Popular?", "alice");
		const questionId = (await listAs(pres.id, "bob")).questions[0].id;

		expect((await upvote(pres.id, questionId, "bob")).status).toBe(200);
		expect((await upvote(pres.id, questionId, "carol")).status).toBe(200);
		let list = await listAs(pres.id, "bob");
		expect(list.questions[0].upvotes).toBe(2);
		expect(list.questions[0].upvoted).toBe(true);

		// A second call by the same participant takes it back.
		expect((await upvote(pres.id, questionId, "bob")).status).toBe(200);
		list = await listAs(pres.id, "bob");
		expect(list.questions[0].upvotes).toBe(1);
		expect(list.questions[0].upvoted).toBe(false);
	});

	test("you cannot upvote your own question, or vote without an id", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Mine to ask", "alice");
		const questionId = (await listAs(pres.id, "alice")).questions[0].id;

		expect((await upvote(pres.id, questionId, "alice")).status).toBe(400);
		expect((await upvote(pres.id, questionId, "")).status).toBe(400);
		expect((await listAs(pres.id, "alice")).questions[0].upvotes).toBe(0);
	});

	test("a moderated deck refuses upvotes — you cannot vote on what you were not shown", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Hidden", "alice");
		const questionId = (await listAsOwner(pres)).questions[0].id;

		expect((await upvote(pres.id, questionId, "bob")).status).toBe(400);
		expect((await listAsOwner(pres)).questions[0].upvotes).toBe(0);
	});

	test("a question id from another deck is refused", async () => {
		const first = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		const second = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(first.id, "Over here", "alice");
		const questionId = (await listAs(first.id, "bob")).questions[0].id;

		expect((await upvote(second.id, questionId, "bob")).status).toBe(400);
	});

	test("re-asking a published question upvotes it instead of duplicating it", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		expect((await ask(pres.id, "When is lunch?", "alice")).status).toBe(200);
		const second = await ask(pres.id, "  WHEN IS   lunch? ", "bob");
		expect(second.status).toBe(200);
		expect((await second.json()).merged).toBe(true);

		const list = await listAs(pres.id, "bob");
		expect(list.questions).toHaveLength(1);
		expect(list.questions[0].upvotes).toBe(1);
		// Stored as it was first typed — nobody's words are rewritten by the fold.
		expect(list.questions[0].text).toBe("When is lunch?");
	});

	test("a moderated deck stores every submission, so the moderator sees them all", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "When is lunch?", "alice");
		await ask(pres.id, "when is LUNCH?", "bob");
		expect((await listAsOwner(pres)).questions).toHaveLength(2);
	});

	test("re-asking your own question is a no-op, not a second row", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		const first = await ask(pres.id, "Same again", "alice");
		const again = await ask(pres.id, "same again", "alice");
		const list = await listAsOwner(pres);
		expect(list.questions).toHaveLength(1);
		expect(list.questions[0].upvotes).toBe(0);

		// And the no-op says so rather than reporting a submission that did not
		// happen: a client cannot distinguish "stored" from "changed nothing" out
		// of a bare `ok`, and would tell the asker their words landed.
		expect(await first.json()).toMatchObject({ stored: true, merged: false });
		expect(await again.json()).toMatchObject({ stored: false, merged: false });
	});

	test("a question folded onto someone else's reports the merge, not a store", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Shared concern", "alice");
		const folded = await ask(pres.id, "shared concern", "bob");
		expect(await folded.json()).toMatchObject({
			stored: false,
			merged: true,
		});
	});

	test("concurrent upvotes from one participant never count more than once", async () => {
		// The upvote is a find-then-insert with no unique index under it, so
		// requests racing — a double-tap, a retried POST — can both see nothing and
		// both write. Counting rows would then read 2 for one person, skewing the
		// queue order that is the whole of REQ060.
		//
		// The interleaving cannot be *forced* from the HTTP boundary (the store is
		// synchronous and in-process, so concurrent handlers usually serialize),
		// which is why this asserts the invariant rather than a fixed count: one
		// participant is worth at most one vote, and `upvoted` agrees with the
		// tally, under **every** interleaving. It fails whenever the race does land
		// and rows are counted instead of upvoters.
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "Tapped twice", "alice");
		const questionId = (await listAs(pres.id, "bob")).questions[0].id;

		await Promise.all(
			Array.from({ length: 4 }, () => upvote(pres.id, questionId, "bob")),
		);
		let list = await listAs(pres.id, "bob");
		expect(list.questions[0].upvotes).toBeLessThanOrEqual(1);
		expect(list.questions[0].upvoted).toBe(list.questions[0].upvotes === 1);

		// And the toggle still agrees with the tally afterwards, from any landing —
		// a duplicate row left behind would show a vote the control cannot take
		// back, which is why toggling off clears every row the participant holds.
		await upvote(pres.id, questionId, "bob");
		list = await listAs(pres.id, "bob");
		expect(list.questions[0].upvotes).toBeLessThanOrEqual(1);
		expect(list.questions[0].upvoted).toBe(list.questions[0].upvotes === 1);
	});

	// ── REQ060 — mark as answered, and the queue's order ──────

	test("the presenter marks a question answered, and can put it back", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Dealt with?", "alice");
		const questionId = (await listAsOwner(pres)).questions[0].id;

		const marked = await authed(
			`/api/presentations/${pres.id}/qa/${questionId}/answered`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({}) },
		);
		expect(marked.status).toBe(200);

		let list = await listAsOwner(pres);
		expect(list.questions[0].answered).toBe(true);
		expect(typeof list.questions[0].answeredAt).toBe("string");
		expect(list.openCount).toBe(0);
		expect(list.answeredCount).toBe(1);

		const reopened = await authed(
			`/api/presentations/${pres.id}/qa/${questionId}/answered`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ answered: false }) },
		);
		expect(reopened.status).toBe(200);
		list = await listAsOwner(pres);
		expect(list.questions[0].answered).toBe(false);
		// An explicit null, never a stale instant (ADR-0024).
		expect(list.questions[0].answeredAt).toBeNull();
	});

	test("a participant cannot retire a question nobody answered", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await ask(pres.id, "Still open", "alice");
		const questionId = (await listAsOwner(pres)).questions[0].id;

		const res = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/qa/${questionId}/answered`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ answered: true }),
			},
		);
		expect(res.status).toBe(401);
		expect((await listAsOwner(pres)).questions[0].answered).toBe(false);
	});

	test("the queue reads open-first, most-upvoted, longest-waiting", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "quiet", "alice");
		await ask(pres.id, "popular", "bob");
		await ask(pres.id, "handled", "carol");

		const initial = await listAsOwner(pres);
		const idOf = (text: string) =>
			initial.questions.find((question: AnyJson) => question.text === text).id;

		await upvote(pres.id, idOf("popular"), "alice");
		await upvote(pres.id, idOf("popular"), "carol");
		await upvote(pres.id, idOf("handled"), "alice");
		await authed(
			`/api/presentations/${pres.id}/qa/${idOf("handled")}/answered`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ answered: true }) },
		);

		const ordered = await listAsOwner(pres);
		expect(ordered.questions.map((question: AnyJson) => question.text)).toEqual(
			["popular", "quiet", "handled"],
		);
	});

	// ── The layer and the deck's lifecycle ───────────────────

	test("resetting the deck clears the questions along with the votes", async () => {
		const pres = await createAndStart({
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		await ask(pres.id, "From the last run", "alice");
		const questionId = (await listAsOwner(pres)).questions[0].id;
		await upvote(pres.id, questionId, "bob");
		expect((await listAsOwner(pres)).questions).toHaveLength(1);

		const reset = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(reset.status).toBe(200);

		const afterReset = await listAsOwner(pres);
		expect(afterReset.questions).toHaveLength(0);
		// The layer's own settings are deck authoring, not session data, so a
		// re-run opens with the floor still open.
		expect(afterReset.enabled).toBe(true);
		expect(afterReset.visibility).toBe("everyone");
	});

	test("an ended deck stops taking questions", async () => {
		const pres = await createAndStart({ qaEnabled: true });
		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});
		expect((await ask(pres.id, "After the fact", "p1")).status).toBe(400);
	});

	test("the list 404s for a presentation that does not exist", async () => {
		const res = await fetch(`${baseUrl}/api/presentations/nope/qa`);
		expect(res.status).toBe(404);
	});
});
