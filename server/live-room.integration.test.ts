/**
 * Integration tests for the live room's two switches, over the real HTTP
 * surface.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ111 — a slide is opened and closed to submissions by the presenter,
 *     and a submission to a closed slide is refused **with a stated reason**
 *     rather than silently discarded
 *   - REQ109 — the shared screen is blanked without leaving the slide, closing
 *     participation or losing a single collected answer
 *
 * The point of testing this over HTTP rather than only at the resolver: both
 * requirements are about what the **boundary** does. A closed question that
 * only stopped looking answerable would still take an answer from a phone that
 * had not heard yet, or from a hand-built request — so what these assert is the
 * status code, the message, and what the store holds afterwards.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let connectDb: () => Promise<void>;

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

/** A two-option choice slide. */
function choiceSlide(id: string) {
	return {
		id,
		type: "multiple-choice",
		question: `Pick on ${id}`,
		options: [
			{ id: `${id}-a`, text: "A" },
			{ id: `${id}-b`, text: "B" },
		],
	};
}

/** An open-text slide that takes upvotes on its responses (REQ025). */
function openTextSlide(id: string) {
	return {
		id,
		type: "open-text",
		question: `Say something on ${id}`,
		allowResponseVotes: true,
		maxResponses: 0,
	};
}

async function createAndStart(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Live Room Test", slides, ...deck }),
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

async function vote(
	presentationId: string,
	slideId: string,
	value: string,
	participantId: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value, participantId }),
	});
}

async function setParticipation(
	pres: AnyJson,
	slideId: string,
	open: boolean,
): Promise<Response> {
	return authed(
		`/api/presentations/${pres.id}/participation`,
		pres.creatorToken,
		{ method: "POST", body: JSON.stringify({ slideId, open }) },
	);
}

async function setBlanked(pres: AnyJson, blanked: boolean): Promise<Response> {
	return authed(`/api/presentations/${pres.id}/blank`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify({ blanked }),
	});
}

/** One slide's tally, as its author reads it. */
async function results(pres: AnyJson, slideId: string): Promise<AnyJson> {
	const res = await authed(
		`/api/presentations/${pres.id}/results/${slideId}`,
		pres.creatorToken,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The deck as anybody in the room reads it, through the join door. */
async function joined(pres: AnyJson): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/join/${pres.code}`);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("the live room: participation and the blank screen (REQ111, REQ109)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

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
		await server?.stop();
	});

	// ── REQ111 — open and close participation per slide ─────

	test("a fresh deck takes answers on every slide", async () => {
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		expect(pres.closedSlideIds).toEqual([]);

		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		expect((await vote(pres.id, "q2", "q2-a", "p1")).status).toBe(200);
	});

	test("closing a slide refuses its submissions with a stated reason", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);

		const closed = await setParticipation(pres, "q1", false);
		expect(closed.status).toBe(200);
		expect((await closed.json()).closedSlideIds).toEqual(["q1"]);

		const refused = await vote(pres.id, "q1", "q1-b", "p2");
		expect(refused.status).toBe(400);
		// Stated, not folded into "cannot vote": the answer was well-formed and
		// the deck is live, and the only thing wrong with it is a decision the
		// presenter took a moment ago.
		const refusalBody = await refused.json();
		expect(refusalBody.error).toBe(
			"The presenter has closed this slide to submissions",
		);
		// Machine-readable beside the prose, so a client can say the same thing
		// in the deck's own language instead of guessing the reason from local
		// state (REQ084).
		expect(refusalBody.refused).toBe("participation-closed");
	});

	test("two concurrent closes both land — neither update is lost", async () => {
		// The close is a read-modify-write on the stored list, and the broadcasts
		// go out per request: without serialization, the owner closing q1 while a
		// collaborator closes q2 would store only the second write while every
		// connected client applied both frames — a room refused on a slide the
		// server considers open, until a reload.
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		const [first, second] = await Promise.all([
			setParticipation(pres, "q1", false),
			setParticipation(pres, "q2", false),
		]);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(400);
		expect((await vote(pres.id, "q2", "q2-a", "p1")).status).toBe(400);
	});

	test("a refused submission is not stored, and the tally does not move", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		await setParticipation(pres, "q1", false);
		expect((await vote(pres.id, "q1", "q1-b", "p2")).status).toBe(400);

		const tally = await results(pres, "q1");
		expect(tally.totalVotes).toBe(1);
		expect(tally.respondentCount).toBe(1);
	});

	test("closing one slide leaves every other slide answering", async () => {
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		await setParticipation(pres, "q1", false);

		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(400);
		expect((await vote(pres.id, "q2", "q2-a", "p1")).status).toBe(200);
	});

	test("reopening takes answers again, beside the ones already collected", async () => {
		// The whole reason this is a switch rather than a one-way door: a
		// presenter closes a question, talks about it, and lets the people who
		// were still typing finish.
		const pres = await createAndStart([choiceSlide("q1")]);
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		await setParticipation(pres, "q1", false);
		expect((await vote(pres.id, "q1", "q1-a", "p2")).status).toBe(400);

		const reopened = await setParticipation(pres, "q1", true);
		expect(reopened.status).toBe(200);
		expect((await reopened.json()).closedSlideIds).toEqual([]);

		expect((await vote(pres.id, "q1", "q1-a", "p2")).status).toBe(200);
		const tally = await results(pres, "q1");
		expect(tally.respondentCount).toBe(2);
	});

	test("closing keeps every answer already given", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await vote(pres.id, "q1", "q1-a", "p1");
		await vote(pres.id, "q1", "q1-b", "p2");
		const before = await results(pres, "q1");

		await setParticipation(pres, "q1", false);
		const after = await results(pres, "q1");
		expect(after.totalVotes).toBe(before.totalVotes);
		expect(after.respondentCount).toBe(2);
	});

	test("a response upvote on a closed slide is refused the same way", async () => {
		const pres = await createAndStart([openTextSlide("q1")]);
		const posted = await vote(pres.id, "q1", "Something", "p1");
		expect(posted.status).toBe(200);
		const responseId = (await posted.json()).id;

		// Open: the upvote lands.
		const allowed = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/response-vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slideId: "q1", responseId, participantId: "p2" }),
			},
		);
		expect(allowed.status).toBe(200);

		await setParticipation(pres, "q1", false);
		const refused = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/response-vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slideId: "q1", responseId, participantId: "p3" }),
			},
		);
		expect(refused.status).toBe(400);
		const upvoteRefusalBody = await refused.json();
		expect(upvoteRefusalBody.error).toBe(
			"The presenter has closed this slide to submissions",
		);
		expect(upvoteRefusalBody.refused).toBe("participation-closed");
	});

	test("the closed set reaches the room through the join door", async () => {
		// A phone has to know, or it draws a live control over a refusal.
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		await setParticipation(pres, "q1", false);
		expect((await joined(pres)).closedSlideIds).toEqual(["q1"]);
	});

	test("closing is idempotent and never stacks a duplicate", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await setParticipation(pres, "q1", false);
		const again = await setParticipation(pres, "q1", false);
		expect((await again.json()).closedSlideIds).toEqual(["q1"]);
	});

	test("a slideId the deck does not have is a 404 and writes nothing", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const res = await setParticipation(pres, "nope", false);
		expect(res.status).toBe(404);
		expect((await joined(pres)).closedSlideIds).toEqual([]);
	});

	test("`open` is required — the request says which half it is", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const res = await authed(
			`/api/presentations/${pres.id}/participation`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "q1" }) },
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect((await joined(pres)).closedSlideIds).toEqual([]);
	});

	test("a caller with no credential cannot close a room's question", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const res = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/participation`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slideId: "q1", open: false }),
			},
		);
		expect(res.status).toBe(401);
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
	});

	// ── REQ109 — blank the audience view ────────────────────

	test("a fresh deck is not blanked", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		expect(pres.audienceBlanked).toBe(false);
	});

	test("blanking does not leave the slide", async () => {
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		await authed(`/api/presentations/${pres.id}/slide`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ index: 1 }),
		});

		const blanked = await setBlanked(pres, true);
		expect(blanked.status).toBe(200);
		const deck = await blanked.json();
		expect(deck.audienceBlanked).toBe(true);
		expect(deck.activeSlideIndex).toBe(1);
		expect(deck.status).toBe("live");
	});

	test("blanking does not close participation", async () => {
		// The distinction REQ109 is written against, asserted where it is
		// enforced: a blanked room is still a room that can answer.
		const pres = await createAndStart([choiceSlide("q1")]);
		await setBlanked(pres, true);

		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		expect((await joined(pres)).closedSlideIds).toEqual([]);
	});

	test("blanking loses no collected answer", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await vote(pres.id, "q1", "q1-a", "p1");
		await vote(pres.id, "q1", "q1-b", "p2");

		await setBlanked(pres, true);
		const tally = await results(pres, "q1");
		expect(tally.totalVotes).toBe(2);
		expect(tally.respondentCount).toBe(2);
	});

	test("unblanking brings the screen back where it was", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await setBlanked(pres, true);
		const back = await setBlanked(pres, false);
		expect(back.status).toBe(200);
		expect((await back.json()).audienceBlanked).toBe(false);
	});

	test("the blank reaches the room, because the projector may be a second browser", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await setBlanked(pres, true);
		expect((await joined(pres)).audienceBlanked).toBe(true);
	});

	test("a caller with no credential cannot blank a room's screen", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/blank`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ blanked: true }),
		});
		expect(res.status).toBe(401);
		expect((await joined(pres)).audienceBlanked).toBe(false);
	});

	// ── The two together, and what clears them ──────────────

	test("closing a question does not blank the screen", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await setParticipation(pres, "q1", false);
		expect((await joined(pres)).audienceBlanked).toBe(false);
	});

	test("a reset reopens every slide and brings the screen back (REQ101)", async () => {
		// A re-run that inherited the last session's closed questions would refuse
		// a room that had done nothing.
		const pres = await createAndStart([choiceSlide("q1"), choiceSlide("q2")]);
		await vote(pres.id, "q1", "q1-a", "p1");
		await setParticipation(pres, "q1", false);
		await setBlanked(pres, true);

		const reset = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(reset.status).toBe(200);
		const deck = await reset.json();
		expect(deck.closedSlideIds).toEqual([]);
		expect(deck.audienceBlanked).toBe(false);
		expect(deck.status).toBe("draft");
	});

	test("an editor's ordinary save cannot reopen a closed question", async () => {
		// Both fields are server-managed live state: the deck PATCH declares
		// neither, so a save from the editor mid-session moves neither.
		const pres = await createAndStart([choiceSlide("q1")]);
		await setParticipation(pres, "q1", false);
		await setBlanked(pres, true);

		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					title: "Renamed mid-session",
					closedSlideIds: [],
					audienceBlanked: false,
				}),
			},
		);
		expect(patched.status).toBe(200);
		const deck = await patched.json();
		expect(deck.title).toBe("Renamed mid-session");
		expect(deck.closedSlideIds).toEqual(["q1"]);
		expect(deck.audienceBlanked).toBe(true);
		expect((await vote(pres.id, "q1", "q1-a", "p9")).status).toBe(400);
	});
});
