/**
 * Integration tests for the vote path's read-modify-write races (REQ148).
 *
 * Every branch of `submitVote` reads what a participant already holds before it
 * decides what to store, and the `Store` interface that wraps zodstore is
 * `async` — so the read `await`s, the next submission's handler runs in that gap
 * and reads the state that predated the first one's write, and both write. This
 * suite provokes that gap on every branch that has an invariant to lose:
 *
 *   - REQ022 / REQ026 — the Word Cloud / Open Ended response cap, which a cap of
 *     1 and three concurrent submissions from one device stepped straight over
 *   - REQ025 — the duplicate fold, where two participants typing the same words
 *     at once were both stored as fresh responses rather than one becoming an
 *     upvote on the other, and the upvote toggle beside it
 *   - the single-row branches (ranking, 100 Points, Guess the Number, Pin on
 *     Image, single-select and capped multi-select choice, the per-statement
 *     scale and grid rows, a form): one participant, one row, whatever arrives
 *     together
 *
 * Driven through the service rather than over HTTP, which is the only way to
 * reproduce these deterministically: three `fetch` calls are three round trips
 * that may or may not land in the same event-loop gap, so an HTTP version of
 * these tests passes against the bug about as often as it fails. The gap is at
 * the service boundary, so that is where it is provoked — the route above it is
 * the rate-limit guard, this call, and a status code.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / quiz
 * harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeFormSubmission } from "./schemas";

let connectDb: () => Promise<void>;
let submitVote: (
	presentationId: string,
	slideId: string,
	value: string,
	participantId: string,
	opts?: { statementId?: string | null; skip?: boolean },
) => Promise<unknown>;
let voteOnResponse: (
	presentationId: string,
	slideId: string,
	responseId: string,
	participantId: string,
) => Promise<unknown>;

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

async function createAndStart(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Vote race test", slides }),
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

async function results(
	presentationId: string,
	slideId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/**
 * One participant's submissions, all leaving the device in the same tick — the
 * double-tap, the retried POST, the reconnect that replays a queued answer.
 */
function submitTogether(
	presentationId: string,
	slideId: string,
	participantId: string,
	values: string[],
	opts: { statementId?: string | null; skip?: boolean } = {},
): Promise<unknown[]> {
	return Promise.all(
		values.map((value) =>
			submitVote(presentationId, slideId, value, participantId, opts),
		),
	);
}

/**
 * One single-row slide type, its concurrent submissions, and what the room must
 * read afterwards. Table-driven because the shape under test is identical across
 * every branch: whatever arrives together, one participant holds one row.
 */
const SINGLE_ROW_CASES: {
	name: string;
	slide: AnyJson;
	slideId: string;
	values: string[];
	opts?: { statementId?: string | null };
}[] = [
	{
		name: "ranking (REQ033)",
		slideId: "rk",
		slide: {
			id: "rk",
			type: "ranking",
			question: "Order these",
			rankingItems: [
				{ id: "a", text: "Alpha" },
				{ id: "b", text: "Beta" },
				{ id: "c", text: "Gamma" },
			],
		},
		values: ["a,b,c", "b,c,a", "c,a,b"],
	},
	{
		name: "100 Points (REQ044)",
		slideId: "pt",
		slide: {
			id: "pt",
			type: "points",
			question: "Spend the budget",
			pointsItems: [
				{ id: "a", text: "Alpha" },
				{ id: "b", text: "Beta" },
			],
		},
		values: ["a:100", "a:50,b:50", "b:100"],
	},
	{
		name: "Guess the Number (REQ039)",
		slideId: "gn",
		slide: {
			id: "gn",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 0, max: 10, step: 1 },
		},
		values: ["3", "7", "9"],
	},
	{
		name: "Pin on Image (REQ051)",
		slideId: "pn",
		slide: {
			id: "pn",
			type: "pin-image",
			question: "Where?",
			mediaUrl: "https://example.test/heart.png",
		},
		values: ["100,100", "500,500", "900,900"],
	},
	{
		name: "single-select multiple choice (REQ014)",
		slideId: "mc",
		slide: {
			id: "mc",
			type: "multiple-choice",
			question: "Pick one",
			options: [
				{ id: "a", text: "Alpha" },
				{ id: "b", text: "Beta" },
				{ id: "c", text: "Gamma" },
			],
			mcMaxSelections: 1,
		},
		values: ["a", "b", "c"],
	},
	{
		name: "a form (REQ061)",
		slideId: "fm",
		slide: {
			id: "fm",
			type: "form",
			question: "Sign up",
			formFields: [
				{ id: "name", label: "Your name" },
				{ id: "mail", label: "Email", type: "email", required: true },
			],
		},
		values: [
			encodeFormSubmission({ name: "Ada", mail: "ada@example.test" }),
			encodeFormSubmission({ name: "Ada L", mail: "ada.l@example.test" }),
			encodeFormSubmission({ name: "A Lovelace", mail: "al@example.test" }),
		],
	},
	{
		name: "one statement of a multi-statement scale (REQ029)",
		slideId: "sc",
		slide: {
			id: "sc",
			type: "scale",
			question: "Rate each",
			scaleMin: 1,
			scaleMax: 5,
			scaleStatements: [
				{ id: "st1", text: "Statement A" },
				{ id: "st2", text: "Statement B" },
			],
		},
		values: ["1", "3", "5"],
		opts: { statementId: "st1" },
	},
	{
		name: "one item of a 2x2 grid (REQ046)",
		slideId: "gd",
		slide: {
			id: "gd",
			type: "grid",
			question: "Position these",
			gridItems: [
				{ id: "a", text: "Alpha" },
				{ id: "b", text: "Beta" },
			],
			gridXAxis: { title: "Effort", min: 0, max: 10 },
			gridYAxis: { title: "Impact", min: 0, max: 10 },
		},
		values: ["1,1", "5,5", "9,9"],
		opts: { statementId: "a" },
	},
	{
		name: "a single-statement scale (the default branch)",
		slideId: "s1",
		slide: {
			id: "s1",
			type: "scale",
			question: "Rate this",
			scaleMin: 1,
			scaleMax: 5,
		},
		values: ["1", "3", "5"],
	},
];

describe("vote-path read-modify-write races (REQ148)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

		const service = await import("./services/presentations");
		submitVote = service.submitVote as typeof submitVote;
		voteOnResponse = service.voteOnResponse as typeof voteOnResponse;

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
		// down with the process. Only this suite's server is stopped.
		await server?.stop();
	});

	// ── REQ022 / REQ026 — the Word Cloud / Open Ended response cap ─────────

	test("a cap of 1 holds when three responses arrive at once (REQ022)", async () => {
		// The reproduction REQ148 was filed from: a fresh deck, `maxResponses: 1`,
		// three concurrent submissions from one device — and all three stored, so
		// the room's cloud read three words for a slide the presenter had capped at
		// one, until that device happened to answer again.
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 1 },
		]);

		await submitTogether(pres.id, "wc", "p1", ["alpha", "beta", "gamma"]);

		const payload = await results(pres.id, "wc");
		expect(payload.totalVotes).toBe(1);
		// One word in the cloud, and it is one of the three that were sent.
		const texts = (payload.words ?? []).map((word: AnyJson) => word.text);
		expect(texts.length).toBe(1);
		expect(["alpha", "beta", "gamma"]).toContain(texts[0]);
	});

	test("a cap above 1 is not overspent by a burst (REQ026)", async () => {
		// The other half of the cap. A cap of 2 with five submissions in flight has
		// to refuse three of them — and unlike a cap of 1 this branch never
		// replaces, so anything the race let through would stand for the session.
		const pres = await createAndStart([
			{ id: "oe", type: "open-text", question: "Anything?", maxResponses: 2 },
		]);

		const outcomes = await submitTogether(pres.id, "oe", "p1", [
			"one",
			"two",
			"three",
			"four",
			"five",
		]);
		expect(outcomes.filter((outcome) => outcome !== null).length).toBe(2);

		const payload = await results(pres.id, "oe");
		expect(payload.totalVotes).toBe(2);
	});

	test("an uncapped word cloud still takes every response (REQ026)", async () => {
		// The queue serializes; it must not swallow. `maxResponses: 0` is unlimited,
		// so five concurrent submissions from one device are five rows.
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 0 },
		]);

		await submitTogether(pres.id, "wc", "p1", ["a", "b", "c", "d", "e"]);

		const payload = await results(pres.id, "wc");
		expect(payload.totalVotes).toBe(5);
	});

	test("a capped slide queues per participant, not per room (REQ022)", async () => {
		// The key is the narrowest one that covers the cap, so a whole room
		// answering in the same moment is not queued behind itself — each of them
		// gets their one response, and all twelve land.
		const pres = await createAndStart([
			{ id: "wc", type: "word-cloud", question: "Word?", maxResponses: 1 },
		]);

		const room = Array.from({ length: 12 }, (_, index) => `p${index}`);
		await Promise.all(
			room.map((participantId) =>
				submitVote(pres.id, "wc", `word-${participantId}`, participantId),
			),
		);

		const payload = await results(pres.id, "wc");
		expect(payload.totalVotes).toBe(12);
	});

	// ── REQ025 — the duplicate fold and the upvote beside it ───────────────

	test("two people typing the same words at once fold into one response (REQ025)", async () => {
		// The fold is the one invariant here that is not per participant: "has
		// anybody already said this?" reads the whole slide. Two participants
		// submitting the same text in the same tick both read "nobody has" without a
		// queue, and the list the room is reading shows the same idea twice with one
		// upvote between them instead of once with two people behind it.
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "What should we build?",
				allowResponseVotes: true,
				maxResponses: 0,
			},
		]);

		await Promise.all(
			["p1", "p2", "p3"].map((participantId) =>
				submitVote(pres.id, "oe", "  Dark   Mode ", participantId),
			),
		);

		const payload = await results(pres.id, "oe");
		// One response, and the two who arrived after the first are upvotes on it
		// rather than duplicates beside it.
		expect(payload.responses.length).toBe(1);
		expect(payload.totalVotes).toBe(1);
		expect(payload.responses[0].upvotes).toBe(2);
	});

	test("the fold leaves distinct answers alone (REQ025)", async () => {
		// The queue must not fold what is not a duplicate: three different answers
		// arriving together are three responses, with nobody upvoted.
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "What should we build?",
				allowResponseVotes: true,
				maxResponses: 0,
			},
		]);

		await Promise.all(
			[
				["p1", "dark mode"],
				["p2", "offline mode"],
				["p3", "keyboard shortcuts"],
			].map(([participantId, text]) =>
				submitVote(pres.id, "oe", text, participantId),
			),
		);

		const payload = await results(pres.id, "oe");
		expect(payload.responses.length).toBe(3);
		for (const response of payload.responses) expect(response.upvotes).toBe(0);
	});

	test("folding a duplicate and tapping upvote at once counts once (REQ025)", async () => {
		// Two paths write the same upvote row: the fold, when a participant submits
		// text somebody has already said, and `voteOnResponse`, when they tap the
		// response directly. A participant with the list open can do both in the
		// same tick — and if the two ran under different keys, they would both read
		// "not upvoted yet" and both insert, leaving the response one upvote heavier
		// than the people behind it and a toggle that can only take one row back off.
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "What should we build?",
				allowResponseVotes: true,
				maxResponses: 0,
			},
		]);
		const authored = (await submitVote(
			pres.id,
			"oe",
			"dark mode",
			"author",
		)) as AnyJson;

		await Promise.all([
			voteOnResponse(pres.id, "oe", authored.id, "fan"),
			submitVote(pres.id, "oe", "Dark Mode", "fan"),
		]);

		const payload = await results(pres.id, "oe");
		// The fold held: one response, not two.
		expect(payload.responses.length).toBe(1);
		// Whichever of the two got its turn first, this participant holds at most
		// one upvote row on that response — the tap toggles what the fold wrote, or
		// the fold sees what the tap wrote and leaves it alone. Two rows is the one
		// reading that is nobody's opinion, and it is what both paths produced while
		// they ran under different keys.
		const { createStore } = await import("./db");
		const { StoredResponseVoteSchema } = await import("./schemas");
		const upvoteStore = createStore("responseVotes", StoredResponseVoteSchema);
		const held = await upvoteStore.find({
			presentationId: pres.id,
			slideId: "oe",
			responseId: authored.id,
			participantId: "fan",
		});
		expect(held.length).toBeLessThanOrEqual(1);
		expect(payload.responses[0].upvotes).toBe(held.length);
	});

	test("a double-tapped upvote counts once (REQ025)", async () => {
		// `voteOnResponse` toggles, and the toggle is the same read-modify-write.
		// Two taps landing together both read "not upvoted yet" and both insert
		// without a queue — leaving the response one upvote heavier than the people
		// behind it, and a toggle that can only take one of the two rows back off.
		const pres = await createAndStart([
			{
				id: "oe",
				type: "open-text",
				question: "What should we build?",
				allowResponseVotes: true,
			},
		]);
		const submitted = (await submitVote(
			pres.id,
			"oe",
			"dark mode",
			"author",
		)) as AnyJson;

		await Promise.all([
			voteOnResponse(pres.id, "oe", submitted.id, "fan"),
			voteOnResponse(pres.id, "oe", submitted.id, "fan"),
		]);

		const payload = await results(pres.id, "oe");
		const entry = payload.responses.find(
			(response: AnyJson) => response.id === submitted.id,
		);
		// An even number of taps is off, an odd one is on — either is a truthful
		// reading of two taps, and neither is the two rows one person left behind.
		expect([0, 1]).toContain(entry.upvotes);
		const again = await voteOnResponse(pres.id, "oe", submitted.id, "fan");
		expect(again).toBeTruthy();
		const after = await results(pres.id, "oe");
		const toggled = after.responses.find(
			(response: AnyJson) => response.id === submitted.id,
		);
		expect(toggled.upvotes).toBe(entry.upvotes === 0 ? 1 : 0);
	});

	// ── One participant, one row, on every single-row branch ───────────────

	for (const singleRow of SINGLE_ROW_CASES) {
		test(`concurrent submissions leave one row: ${singleRow.name}`, async () => {
			// Each of these branches replaces on the participant's next submission
			// and collapses whatever a race left behind — but only if that next
			// submission ever comes, which on a slide someone has already answered is
			// exactly what does not happen. Until then the room's distribution counts
			// one person as several.
			const pres = await createAndStart([singleRow.slide]);

			await submitTogether(
				pres.id,
				singleRow.slideId,
				"p1",
				singleRow.values,
				singleRow.opts ?? {},
			);

			const { createStore } = await import("./db");
			const { StoredVoteSchema } = await import("./schemas");
			const voteStore = createStore("votes", StoredVoteSchema);
			const rows = await voteStore.find({
				presentationId: pres.id,
				slideId: singleRow.slideId,
				participantId: "p1",
			});
			expect(rows.length).toBe(1);
		});
	}

	test("a statement-less vote leaves the participant's rated statements alone (REQ029)", async () => {
		// `statementId` is nullable on the vote boundary, and a multi-statement scale
		// is only handled per statement when one is sent — so a request without it
		// falls through to the default single-row branch. That branch looks up "the
		// row this participant holds", and if the lookup did not match `statementId`
		// explicitly it would match every row they hold on the slide: their ratings
		// of st1, st2 and st3. The first would be overwritten and the rest deleted,
		// and the room's per-statement distribution would lose two data points with
		// no way back.
		const pres = await createAndStart([
			{
				id: "sc",
				type: "scale",
				question: "Rate each",
				scaleMin: 1,
				scaleMax: 5,
				scaleStatements: [
					{ id: "st1", text: "Statement A" },
					{ id: "st2", text: "Statement B" },
					{ id: "st3", text: "Statement C" },
				],
			},
		]);

		for (const [statementId, value] of [
			["st1", "5"],
			["st2", "4"],
			["st3", "3"],
		]) {
			await submitVote(pres.id, "sc", value, "p1", { statementId });
		}

		// The malformed submission: no statement, on a slide made of statements.
		await submitVote(pres.id, "sc", "1", "p1");

		const { createStore } = await import("./db");
		const { StoredVoteSchema } = await import("./schemas");
		const voteStore = createStore("votes", StoredVoteSchema);
		const rated = await voteStore.find({
			presentationId: pres.id,
			slideId: "sc",
			participantId: "p1",
		});
		// All three ratings still stand, each with the value it was given.
		const byStatement = new Map(
			rated
				.filter((row) => row.statementId)
				.map((row) => [row.statementId as string, row.value]),
		);
		expect(byStatement.get("st1")).toBe("5");
		expect(byStatement.get("st2")).toBe("4");
		expect(byStatement.get("st3")).toBe("3");

		// And the room reads all three of them, each with its one answer.
		const payload = await results(pres.id, "sc");
		expect(payload.statements).toHaveLength(3);
		for (const statement of payload.statements) {
			expect(statement.answered).toBe(1);
		}
		expect(
			payload.statements.find((s: AnyJson) => s.statementId === "st1").average,
		).toBe(5);
	});

	test("a capped multi-select is not overspent by a burst (REQ014)", async () => {
		// The multi-select half of the choice branch: the cap is "how many options
		// does this participant already hold?", read before the insert that would
		// make it one more. Three selections arriving together against a cap of 2
		// have to leave two.
		const pres = await createAndStart([
			{
				id: "mc",
				type: "multiple-choice",
				question: "Pick up to two",
				options: [
					{ id: "a", text: "Alpha" },
					{ id: "b", text: "Beta" },
					{ id: "c", text: "Gamma" },
					{ id: "d", text: "Delta" },
				],
				mcMaxSelections: 2,
			},
		]);

		await submitTogether(pres.id, "mc", "p1", ["a", "b", "c", "d"]);

		const payload = await results(pres.id, "mc");
		expect(payload.totalVotes).toBe(2);
	});

	test("a participant placing two grid items at once keeps both (REQ046)", async () => {
		// The grid and scale rows are per statement, so the key is too: one device
		// positioning two items in the same gesture must not have the second queued
		// behind the first and mistaken for a re-placement of it.
		const pres = await createAndStart([
			{
				id: "gd",
				type: "grid",
				question: "Position these",
				gridItems: [
					{ id: "a", text: "Alpha" },
					{ id: "b", text: "Beta" },
				],
				gridXAxis: { title: "Effort", min: 0, max: 10 },
				gridYAxis: { title: "Impact", min: 0, max: 10 },
			},
		]);

		await Promise.all([
			submitVote(pres.id, "gd", "1,1", "p1", { statementId: "a" }),
			submitVote(pres.id, "gd", "9,9", "p1", { statementId: "b" }),
		]);

		const { createStore } = await import("./db");
		const { StoredVoteSchema } = await import("./schemas");
		const voteStore = createStore("votes", StoredVoteSchema);
		const rows = await voteStore.find({
			presentationId: pres.id,
			slideId: "gd",
			participantId: "p1",
		});
		expect(rows.length).toBe(2);
	});
});
