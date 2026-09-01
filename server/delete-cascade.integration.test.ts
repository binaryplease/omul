/**
 * Integration tests for what a deletion actually erases (REQ146).
 *
 * Deleting a presentation is the one erasure control a participant is promised,
 * and the five collections a room writes into — `votes`, `responseVotes`,
 * `qaQuestions`, `qaUpvotes` and `chatMessages` (REQ078) — are keyed by
 * `presentationId` and by nothing else. If the delete stops at the deck
 * document, those rows outlive it as personal data nothing points at: no route
 * resolves them, no screen draws them and no control reaches them again. So this
 * suite does not read the deletion back through the API (there is no API left to
 * read it through — that is the whole problem); it fills all five collections
 * through the real endpoints and then opens the collections directly and looks.
 *
 * Reactions (REQ077) are deliberately absent from the list: nothing persists
 * one, so a delete has no row of theirs to miss.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0/p1/qa
 * harnesses, and `createStore` is idempotent per collection name, so the handles
 * below are the same tables the service writes through.
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

/** Direct handles on the six collections a room writes into. */
let stores: {
	votes: import("./db").Store;
	responseVotes: import("./db").Store;
	qaQuestions: import("./db").Store;
	qaUpvotes: import("./db").Store;
	chatMessages: import("./db").Store;
	participantNames: import("./db").Store;
};

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
 * A live deck that can collect all five record types at once: one open-text
 * slide taking responses and their upvotes (REQ025), a published Q&A layer so
 * the room may both ask and upvote (REQ037 `everyone` — a moderated list refuses
 * upvotes on questions it never showed), and the live chat open (REQ078).
 */
async function createCollectingDeck(title: string): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title,
			slides: [
				{
					id: "s1",
					type: "open-text",
					question: "What should we fix first?",
					allowResponseVotes: true,
					maxResponses: 0,
				},
			],
			qaEnabled: true,
			qaVisibility: "everyone",
			chatEnabled: true,
			requireParticipantName: true,
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

/**
 * Fill every collection this deck can write to, through the endpoints a phone in
 * the room actually calls, and return the counts that landed.
 */
async function fillRoomRecords(pres: AnyJson): Promise<void> {
	// The name stated at the door (REQ076) — the row that ties every one of the
	// records below to a person by more than a random handle, and therefore the
	// one a delete leaving something behind would leave behind worst.
	const nameRes = await fetch(
		`${baseUrl}/api/presentations/${pres.id}/participant-name`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId: "participant-a", name: "Ada" }),
		},
	);
	expect(nameRes.status).toBe(200);

	// A written response (REQ022) — free text, one of the two things a
	// participant's own words end up in.
	const voteRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			slideId: "s1",
			value: `Onboarding, in ${pres.title}`,
			participantId: "participant-a",
		}),
	});
	expect(voteRes.status).toBe(200);
	const response = await voteRes.json();

	// Somebody else backing it (REQ025).
	const responseVoteRes = await fetch(
		`${baseUrl}/api/presentations/${pres.id}/response-vote`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				responseId: response.id,
				participantId: "participant-b",
			}),
		},
	);
	expect(responseVoteRes.status).toBe(200);

	// A question asked out loud through the Q&A layer (REQ036) …
	const askRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/qa`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text: `When does ${pres.title} ship?`,
			participantId: "participant-a",
		}),
	});
	expect(askRes.status).toBe(200);

	// … and somebody else asking for it to be taken (REQ060). Read the question's
	// id from the presenter's own view of the list, which is where ids are handed
	// out; the asker cannot upvote their own question.
	const listRes = await authed(
		`/api/presentations/${pres.id}/qa?participantId=presenter`,
		pres.creatorToken,
	);
	expect(listRes.status).toBe(200);
	const list = await listRes.json();
	expect(list.questions).toHaveLength(1);

	const upvoteRes = await fetch(
		`${baseUrl}/api/presentations/${pres.id}/qa/${list.questions[0].id}/upvote`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId: "participant-b" }),
		},
	);
	expect(upvoteRes.status).toBe(200);

	// And a line typed into the deck's chat (REQ078) — the third place a
	// participant's own words end up, and the newest collection a delete has to
	// remember.
	const chatRes = await fetch(`${baseUrl}/api/presentations/${pres.id}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text: `Talking during ${pres.title}`,
			participantId: "participant-b",
		}),
	});
	expect(chatRes.status).toBe(200);
}

/** What each of the six collections still holds for one presentation id. */
async function storedCounts(presentationId: string): Promise<{
	votes: number;
	responseVotes: number;
	qaQuestions: number;
	qaUpvotes: number;
	chatMessages: number;
	participantNames: number;
}> {
	return {
		votes: (await stores.votes.find({ presentationId })).length,
		responseVotes: (await stores.responseVotes.find({ presentationId })).length,
		qaQuestions: (await stores.qaQuestions.find({ presentationId })).length,
		qaUpvotes: (await stores.qaUpvotes.find({ presentationId })).length,
		chatMessages: (await stores.chatMessages.find({ presentationId })).length,
		participantNames: (await stores.participantNames.find({ presentationId }))
			.length,
	};
}

describe("deleting a presentation erases what the room submitted (REQ146)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const schemas = await import("./schemas");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		// Reopened by name, not re-created: zodstore's `collection()` is
		// idempotent, so these are handles on the very tables the service writes.
		stores = {
			votes: db.createStore("votes", schemas.StoredVoteSchema),
			responseVotes: db.createStore(
				"responseVotes",
				schemas.StoredResponseVoteSchema,
			),
			qaQuestions: db.createStore("qaQuestions", schemas.StoredQAQuestionSchema),
			qaUpvotes: db.createStore("qaUpvotes", schemas.StoredQAUpvoteSchema),
			chatMessages: db.createStore(
				"chatMessages",
				schemas.StoredChatMessageSchema,
			),
			participantNames: db.createStore(
				"participantNames",
				schemas.StoredParticipantNameSchema,
			),
		};

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

	test("all six record types survive nothing of the deck they were written in", async () => {
		const pres = await createCollectingDeck("Deletion Test");
		await fillRoomRecords(pres);

		// Guard the test itself: a cascade assertion over six empty collections
		// would pass against the very defect it exists to catch.
		expect(await storedCounts(pres.id)).toEqual({
			votes: 1,
			responseVotes: 1,
			qaQuestions: 1,
			qaUpvotes: 1,
			chatMessages: 1,
			participantNames: 1,
		});

		const deleteRes = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "DELETE" },
		);
		expect(deleteRes.status).toBe(200);
		expect(await deleteRes.json()).toEqual({ ok: true });

		expect(await storedCounts(pres.id)).toEqual({
			votes: 0,
			responseVotes: 0,
			qaQuestions: 0,
			qaUpvotes: 0,
			chatMessages: 0,
			participantNames: 0,
		});

		// And the deck itself is gone, which is what made the rows above
		// unreachable in the first place.
		const getRes = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect(getRes.status).toBe(404);
	});

	test("only the deleted deck's records go — the room next door is untouched", async () => {
		const deleted = await createCollectingDeck("Deleted Deck");
		const kept = await createCollectingDeck("Kept Deck");
		await fillRoomRecords(deleted);
		await fillRoomRecords(kept);

		const deleteRes = await authed(
			`/api/presentations/${deleted.id}`,
			deleted.creatorToken,
			{ method: "DELETE" },
		);
		expect(deleteRes.status).toBe(200);

		expect(await storedCounts(deleted.id)).toEqual({
			votes: 0,
			responseVotes: 0,
			qaQuestions: 0,
			qaUpvotes: 0,
			chatMessages: 0,
			participantNames: 0,
		});
		expect(await storedCounts(kept.id)).toEqual({
			votes: 1,
			responseVotes: 1,
			qaQuestions: 1,
			qaUpvotes: 1,
			chatMessages: 1,
			participantNames: 1,
		});
	});

	test("a delete that is not authorized erases nothing", async () => {
		const pres = await createCollectingDeck("Guarded Deck");
		await fillRoomRecords(pres);

		const deleteRes = await authed(
			`/api/presentations/${pres.id}`,
			"not-the-creator-token",
			{ method: "DELETE" },
		);
		expect(deleteRes.status).toBe(401);

		// The erasure runs inside `deletePresentation`, behind the route's
		// owner-or-edit-token gate — a refused caller must not be able to wipe a
		// room's answers on the way to being turned away.
		expect(await storedCounts(pres.id)).toEqual({
			votes: 1,
			responseVotes: 1,
			qaQuestions: 1,
			qaUpvotes: 1,
			chatMessages: 1,
			participantNames: 1,
		});
	});
});
