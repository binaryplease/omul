/**
 * Integration tests for participant names (REQ076).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * The requirement is one sentence with three clauses, and this suite is
 * organised as those clauses plus the one thing they imply and do not say:
 *
 *   - **"A deck can require a participant to state a name on joining."** The
 *     switch is the deck's, off unless authored on, and the endpoint refuses
 *     every call on a deck that did not ask. "On joining" is taken literally:
 *     a name is accepted on a deck the presenter has not started yet, and
 *     refused once the session is over.
 *   - **"The name is stored with that participant's answers."** One row per
 *     (deck, participant) — re-stating corrects rather than adds — and it joins
 *     to the votes on `participantId`, which is what the roster's per-person
 *     slide count is built from.
 *   - **"…and appears on the results surface and in exports."** The roster
 *     endpoint, the name on a Form slide's rows, and the export routes.
 *   - **What it must not do.** No participant-facing payload carries a name:
 *     not the join lookup, not the deck read, not a tally, not the chat, not
 *     the Q&A, not a scorecard — and the deck's read-only results link does not
 *     open the roster either. A reset and a delete both take the names with
 *     them.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / chat
 * / form harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	encodeFormSubmission,
	PARTICIPANT_NAME_MAX_LENGTH,
	RESULTS_TOKEN_HEADER,
} from "./schemas";

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

/** A deck with two answer-collecting slides, created but not started. */
async function createDeck(body: Record<string, unknown> = {}): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Names Test",
			slides: [
				{ id: "s1", type: "word-cloud", question: "One word?" },
				{
					id: "s2",
					type: "scale",
					question: "How was it?",
					scaleMin: 1,
					scaleMax: 5,
					scaleStatements: [
						{ id: "st1", text: "Pace" },
						{ id: "st2", text: "Content" },
					],
				},
			],
			...body,
		}),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

/** The same, started, so votes are accepted. */
async function createAndStart(
	body: Record<string, unknown> = {},
): Promise<AnyJson> {
	const pres = await createDeck(body);
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

async function stateName(
	presentationId: string,
	participantId: string,
	name: string,
): Promise<Response> {
	return fetch(
		`${baseUrl}/api/presentations/${presentationId}/participant-name`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId, name }),
		},
	);
}

async function vote(
	presentationId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** The roster, as the deck's owner reads it. */
async function readRoster(pres: AnyJson): Promise<AnyJson[]> {
	const res = await authed(
		`/api/presentations/${pres.id}/participants`,
		pres.creatorToken,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("participant names (REQ076)", () => {
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

	// ── The deck's switch ─────────────────────────────────────

	test("a fresh deck asks for no names", async () => {
		const pres = await createDeck();
		expect(pres.requireParticipantName).toBe(false);
	});

	test("a deck that did not ask refuses to store one", async () => {
		const pres = await createAndStart();
		const res = await stateName(pres.id, "p1", "Ada");
		expect(res.status).toBe(400);
		// And nothing was written: the roster of a deck that asks nothing is empty.
		expect(await readRoster(pres)).toEqual([]);
	});

	test("a create can turn it on, and the room is told", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		expect(pres.requireParticipantName).toBe(true);
		// The switch — and only the switch — reaches the participants' door: every
		// phone has to know whether to ask before it can draw the question.
		const joined = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(joined.requireParticipantName).toBe(true);
	});

	test("the editor can turn it on and off again with an ordinary save", async () => {
		const pres = await createAndStart();
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({ requireParticipantName: true }),
			},
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).requireParticipantName).toBe(true);
		expect((await stateName(pres.id, "p1", "Ada")).status).toBe(200);

		const off = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: false }),
		});
		expect(off.status).toBe(200);
		expect((await stateName(pres.id, "p2", "Bob")).status).toBe(400);
		// What was already stated is kept — the switch decides what is collected
		// next, not what is thrown away.
		expect((await readRoster(pres)).map((row) => row.name)).toEqual(["Ada"]);
	});

	// ── "On joining" ──────────────────────────────────────────

	test("a name is stated before the presenter has started the deck", async () => {
		// The whole reading of "on joining": a participant standing at the door of
		// a deck that has not started is exactly who the question is asked of, and
		// a vote would be refused at this moment.
		const pres = await createDeck({ requireParticipantName: true });
		expect(pres.status).toBe("draft");
		expect(
			(await vote(pres.id, { slideId: "s1", value: "early", participantId: "p1" }))
				.status,
		).toBe(400);
		const res = await stateName(pres.id, "p1", "Ada");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "Ada" });
	});

	test("an ended deck takes no more names", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		expect((await stateName(pres.id, "p1", "Ada")).status).toBe(200);
		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});
		expect((await stateName(pres.id, "p2", "Bob")).status).toBe(400);
	});

	// ── One name per participant ──────────────────────────────

	test("the stored name comes back, normalised", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		const res = await stateName(pres.id, "p1", "  Ada   Lovelace ");
		expect(res.status).toBe(200);
		// The normalisation is the server's, so the response is what was kept
		// rather than what was sent — a client that echoed its own string back
		// would show a name the roster does not have.
		expect(await res.json()).toEqual({ name: "Ada Lovelace" });
	});

	test("re-stating corrects in place rather than adding a second row", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		expect((await stateName(pres.id, "p1", "Adda")).status).toBe(200);
		expect((await stateName(pres.id, "p1", "Ada")).status).toBe(200);
		const roster = await readRoster(pres);
		expect(roster).toHaveLength(1);
		expect(roster[0].name).toBe("Ada");
	});

	test("a blank or oversized name is refused at the boundary", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		expect((await stateName(pres.id, "p1", "   ")).status).toBe(422);
		expect(
			(await stateName(pres.id, "p1", "a".repeat(PARTICIPANT_NAME_MAX_LENGTH + 1)))
				.status,
		).toBe(422);
		expect(await readRoster(pres)).toEqual([]);
	});

	// ── The roster ────────────────────────────────────────────

	test("the roster names who took part and counts slides, not rows", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		await stateName(pres.id, "p2", "Bob");
		// One word-cloud answer, and two rows on the multi-statement scale — which
		// is one *slide* answered, not two. Counting rows would report the deck's
		// shape rather than this person's participation.
		await vote(pres.id, { slideId: "s1", value: "steady", participantId: "p1" });
		await vote(pres.id, {
			slideId: "s2",
			value: "4",
			participantId: "p1",
			statementId: "st1",
		});
		await vote(pres.id, {
			slideId: "s2",
			value: "5",
			participantId: "p1",
			statementId: "st2",
		});

		const roster = await readRoster(pres);
		expect(roster.map((row) => row.name)).toEqual(["Ada", "Bob"]);
		const ada = roster.find((row) => row.participantId === "p1");
		expect(ada.answeredSlides).toBe(2);
		// Somebody who stated a name and answered nothing is still on the roster:
		// they are in the room.
		expect(roster.find((row) => row.participantId === "p2").answeredSlides).toBe(
			0,
		);
	});

	test("somebody who answered without stating a name is not padded into it", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		await vote(pres.id, { slideId: "s1", value: "quiet", participantId: "ghost" });
		const roster = await readRoster(pres);
		expect(roster.map((row) => row.participantId)).toEqual(["p1"]);
	});

	test("the roster is refused without the deck's own credentials", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		const anonymous = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/participants`,
		);
		expect(anonymous.status).toBe(401);
	});

	test("the deck's results link does not open the roster", async () => {
		// REQ098 delegates the *numbers*, and a list of who was in the room is not
		// one. Nobody minting a link to their tallies decided to hand over a roster
		// with it, so the link is refused here exactly as no credential is.
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		const minted = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(minted.status).toBe(201);
		const { resultsToken } = await minted.json();
		expect(typeof resultsToken).toBe("string");

		// The link does open the tallies…
		const tallies = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results`,
			{ headers: { [RESULTS_TOKEN_HEADER]: resultsToken } },
		);
		expect(tallies.status).toBe(200);
		// …and does not open the roster.
		const roster = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/participants`,
			{ headers: { [RESULTS_TOKEN_HEADER]: resultsToken } },
		);
		expect(roster.status).toBe(401);
	});

	// ── Never to the room ─────────────────────────────────────

	test("no participant-facing payload carries a name", async () => {
		const pres = await createAndStart({
			requireParticipantName: true,
			qaEnabled: true,
			chatEnabled: true,
		});
		await stateName(pres.id, "p1", "Adalovelace");
		await vote(pres.id, { slideId: "s1", value: "steady", participantId: "p1" });
		await fetch(`${baseUrl}/api/presentations/${pres.id}/qa`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "When do we ship?", participantId: "p1" }),
		});
		await fetch(`${baseUrl}/api/presentations/${pres.id}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "hello room", participantId: "p1" }),
		});

		// Every door a participant (or a stranger) can knock on, searched in the
		// payload rather than taken on trust — the same shape the comment-thread
		// suite uses, and for the same reason: this is a property of what the
		// server sends, not of what a client chooses to draw.
		const paths = [
			`/api/join/${pres.code}`,
			`/api/presentations/${pres.id}`,
			`/api/presentations/${pres.id}/results`,
			`/api/presentations/${pres.id}/results/s1`,
			`/api/presentations/${pres.id}/qa?participantId=p1`,
			`/api/presentations/${pres.id}/chat?participantId=p1`,
			`/api/presentations/${pres.id}/scorecard?participantId=p1`,
		];
		for (const path of paths) {
			const res = await fetch(`${baseUrl}${path}`);
			expect(res.status).toBe(200);
			expect(await res.text()).not.toContain("Adalovelace");
		}
	});

	// ── The results surface ───────────────────────────────────

	test("a form slide's rows carry the name, and only for a caller who can edit", async () => {
		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Signup",
				requireParticipantName: true,
				slides: [
					{
						id: "fm",
						type: "form",
						question: "Sign up",
						formFields: [{ id: "role", label: "Your role" }],
					},
				],
			}),
		});
		expect(res.status).toBe(201);
		const pres = await res.json();
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await stateName(pres.id, "p1", "Ada");
		await vote(pres.id, {
			slideId: "fm",
			value: encodeFormSubmission({ role: "Engineer" }),
			participantId: "p1",
		});

		const owner = await (
			await authed(`/api/presentations/${pres.id}/results/fm`, pres.creatorToken)
		).json();
		expect(owner.submissions).toHaveLength(1);
		expect(owner.submissions[0].participantName).toBe("Ada");

		// The block is withheld from everybody else, so the name cannot travel
		// without the row it labels.
		const room = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/fm`)
		).json();
		expect(room.submissions).toBeNull();
	});

	test("both exports are served for a deck that collected names", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		await vote(pres.id, { slideId: "s1", value: "steady", participantId: "p1" });

		const workbook = await authed(
			`/api/presentations/${pres.id}/results.xlsx`,
			pres.creatorToken,
		);
		expect(workbook.status).toBe(200);
		expect((await workbook.arrayBuffer()).byteLength).toBeGreaterThan(0);

		const pdf = await authed(
			`/api/presentations/${pres.id}/deck.pdf`,
			pres.creatorToken,
		);
		expect(pdf.status).toBe(200);
		expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});

	// ── What clears them ──────────────────────────────────────

	test("a reset clears the roster with the answers", async () => {
		// REQ101 — a re-run is a different room, so it starts with an empty roster
		// for the same reason it starts with an empty tally.
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		await vote(pres.id, { slideId: "s1", value: "steady", participantId: "p1" });
		expect(await readRoster(pres)).toHaveLength(1);

		const reset = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(reset.status).toBe(200);
		expect(await readRoster(pres)).toEqual([]);
		// And the deck still asks: resetting re-runs the session, it does not
		// un-author the deck.
		expect((await reset.json()).requireParticipantName).toBe(true);
	});

	test("deleting the deck takes the names with it", async () => {
		const pres = await createAndStart({ requireParticipantName: true });
		await stateName(pres.id, "p1", "Ada");
		const deleted = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "DELETE" },
		);
		expect(deleted.status).toBe(200);
		// Nothing resolves the deck any more, so nothing resolves its roster —
		// which is the point: a name must not outlive the session it was for.
		const gone = await authed(
			`/api/presentations/${pres.id}/participants`,
			pres.creatorToken,
		);
		expect(gone.status).toBe(401);
	});
});
