/**
 * Integration tests for deleting one submitted answer (REQ027).
 *
 * The requirement is one sentence with two halves, and the second is the one
 * that can quietly fail: *an editor can delete an individual answer from a word
 * cloud or open-ended slide, and the deletion is reflected in the tally the room
 * sees and in every export.* So every surface the deleted line could survive on
 * is asked here directly:
 *
 *   - the credentialed tally the presenter's own screen polls;
 *   - the public tally every phone in the room fetches;
 *   - the `results.updated` broadcast, which is how a room that is already
 *     looking at the wall learns the line is gone without reloading;
 *   - the spreadsheet (REQ095) — its response rows, its per-participant matrix,
 *     its aggregates and its totals;
 *   - the PDF (REQ096), read back out of the file the same way its own suite
 *     reads it.
 *
 * And the boundary around it, because a route that removes what a participant
 * wrote is one an editor may reach and nobody else: no credential, the wrong
 * deck's credential, an id from another deck, and a slide type this is not
 * offered on are each refused, and the answer is still there afterwards.
 *
 * Runs the real Elysia app — routes and WebSocket — against a throw-away
 * in-memory zodstore, like the harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";

let connectDb: () => Promise<void>;

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void>; port: number } | null = null;

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

/** The lines the room submits. One of each is taken down; the rest must stand. */
const DOOMED_WORD = "unprintable";
const KEPT_WORD = "momentum";
const DOOMED_RESPONSE = "A sentence the presenter must take off the wall";
const KEPT_RESPONSE = "A sentence that stays up";

const DECK: AnyJson[] = [
	{
		id: "wc",
		type: "word-cloud",
		question: "One word for this quarter",
		maxResponses: 3,
	},
	{
		id: "ot",
		type: "open-text",
		question: "What should we do differently?",
		allowResponseVotes: true,
	},
	{
		id: "mc",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "mc-a", text: "Weekly" },
			{ id: "mc-b", text: "Monthly" },
		],
	},
];

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

async function create(slides: AnyJson[] = DECK): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Moderation Test", slides }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function castVote(
	presentationId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function upvoteResponse(
	presentationId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/response-vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** The tally an editor reads — the one carrying a word cloud's own answers. */
async function editorResults(
	presentationId: string,
	slideId: string,
	token: string,
): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${presentationId}/results/${slideId}`,
		token,
	);
	expect(response.status).toBe(200);
	return response.json();
}

/** The tally a phone in the room reads, with no credential at all. */
async function roomResults(
	presentationId: string,
	slideId: string,
): Promise<AnyJson> {
	const response = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function deleteAnswer(
	presentationId: string,
	answerId: string,
	token: string,
): Promise<Response> {
	return authed(`/api/presentations/${presentationId}/answers/${answerId}`, token, {
		method: "DELETE",
	});
}

/**
 * Start a deck and fill it with the session every test below moderates: three
 * words from three people, two written responses with an upvote each, and one
 * choice vote on the slide this feature is deliberately not offered on.
 */
async function runSession(): Promise<AnyJson> {
	const pres = await create();
	await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
		method: "POST",
	});
	await castVote(pres.id, {
		slideId: "wc",
		value: DOOMED_WORD,
		participantId: "alice",
	});
	await castVote(pres.id, {
		slideId: "wc",
		value: KEPT_WORD,
		participantId: "bob",
	});
	await castVote(pres.id, {
		slideId: "wc",
		value: KEPT_WORD,
		participantId: "carol",
	});
	await castVote(pres.id, {
		slideId: "ot",
		value: DOOMED_RESPONSE,
		participantId: "alice",
	});
	await castVote(pres.id, {
		slideId: "ot",
		value: KEPT_RESPONSE,
		participantId: "bob",
	});
	await castVote(pres.id, {
		slideId: "mc",
		value: "mc-a",
		participantId: "alice",
	});

	// An upvote on each response, so a deleted one has something to take with it.
	const responses = (await editorResults(pres.id, "ot", pres.creatorToken))
		.responses as AnyJson[];
	for (const response of responses) {
		await upvoteResponse(pres.id, {
			slideId: "ot",
			responseId: response.id,
			participantId: "carol",
		});
	}
	return pres;
}

/** The id of the word-cloud answer carrying this text, from the editor's list. */
async function wordAnswerId(
	pres: AnyJson,
	text: string,
): Promise<string> {
	const tally = await editorResults(pres.id, "wc", pres.creatorToken);
	const answer = (tally.answers as AnyJson[]).find(
		(candidate) => candidate.text === text,
	);
	expect(answer).toBeDefined();
	return answer.id as string;
}

/** The id of the open-ended response carrying this text. */
async function responseId(pres: AnyJson, text: string): Promise<string> {
	const tally = await editorResults(pres.id, "ot", pres.creatorToken);
	const response = (tally.responses as AnyJson[]).find(
		(candidate) => candidate.text === text,
	);
	expect(response).toBeDefined();
	return response.id as string;
}

// ── Reading the two exports back ─────────────────────────────

/** Download the workbook and read it back with the library that wrote it. */
async function downloadWorkbook(
	presentationId: string,
	token: string,
): Promise<ExcelJS.Workbook> {
	const response = await authed(
		`/api/presentations/${presentationId}/results.xlsx`,
		token,
	);
	expect(response.status).toBe(200);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await response.arrayBuffer());
	return workbook;
}

/** Every data row of a sheet, as cell values keyed by header text. */
function rowsOf(
	workbook: ExcelJS.Workbook,
	sheetName: string,
): Record<string, unknown>[] {
	const sheet = workbook.getWorksheet(sheetName);
	expect(sheet).toBeDefined();
	const headerRow = (sheet as ExcelJS.Worksheet).getRow(1);
	const headers: string[] = [];
	headerRow.eachCell((cell, columnNumber) => {
		headers[columnNumber] = String(cell.value ?? "");
	});

	const rows: Record<string, unknown>[] = [];
	(sheet as ExcelJS.Worksheet).eachRow((row, rowNumber) => {
		if (rowNumber === 1) return;
		const entry: Record<string, unknown> = {};
		for (let columnNumber = 1; columnNumber < headers.length; columnNumber++) {
			const header = headers[columnNumber];
			if (!header) continue;
			entry[header] = row.getCell(columnNumber).value ?? null;
		}
		rows.push(entry);
	});
	return rows;
}

/** The Summary sheet as a field → value map. */
function summaryOf(workbook: ExcelJS.Workbook): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	for (const row of rowsOf(workbook, "Summary")) {
		map[String(row.Field)] = row.Value;
	}
	return map;
}

/**
 * The words the PDF draws, as one searchable string — the same two-step read
 * `deck-pdf.integration.test.ts` uses (inflate the content streams, decode the
 * hex `Tj` operands), because both are properties of the file format rather
 * than of this export.
 */
async function pdfText(presentationId: string, token: string): Promise<string> {
	const response = await authed(
		`/api/presentations/${presentationId}/deck.pdf`,
		token,
	);
	expect(response.status).toBe(200);
	const raw = Buffer.from(new Uint8Array(await response.arrayBuffer())).toString(
		"latin1",
	);
	const runs: string[] = [];
	const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let match = pattern.exec(raw);
	while (match !== null) {
		try {
			const content = inflateSync(Buffer.from(match[1], "latin1")).toString(
				"latin1",
			);
			const drawn = /<([0-9A-Fa-f]*)>\s*Tj/g;
			let run = drawn.exec(content);
			while (run !== null) {
				runs.push(Buffer.from(run[1], "hex").toString("latin1"));
				run = drawn.exec(content);
			}
		} catch {
			// Not a deflate stream — nothing to read out of it here.
		}
		match = pattern.exec(raw);
	}
	return runs.join("\n");
}

// ── The room's socket ────────────────────────────────────────

interface Envelope {
	event: string;
	data: AnyJson;
}

/** Open a socket, join a room as the given role, and buffer every envelope. */
async function joinRoom(
	presentationId: string,
	role: "presenter" | "participant",
): Promise<{
	received: Envelope[];
	waitFor: (eventName: string, timeoutMs?: number) => Promise<Envelope>;
	close: () => Promise<void>;
}> {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	const listeners: Array<(envelope: Envelope) => void> = [];

	socket.addEventListener("message", (event) => {
		try {
			const raw = (event as MessageEvent).data;
			const envelope: Envelope = JSON.parse(
				typeof raw === "string" ? raw : new TextDecoder().decode(raw),
			);
			received.push(envelope);
			for (const listener of listeners) listener(envelope);
		} catch {
			// ignore non-JSON frames
		}
	});

	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("ws error")), {
			once: true,
		});
	});
	socket.send(JSON.stringify({ type: "join", presentationId, role }));

	function waitFor(eventName: string, timeoutMs = 3000): Promise<Envelope> {
		const existing = received.find((envelope) => envelope.event === eventName);
		if (existing) return Promise.resolve(existing);
		return new Promise<Envelope>((resolve, reject) => {
			const timer = setTimeout(() => {
				listeners.splice(listeners.indexOf(onMessage), 1);
				reject(new Error(`Timed out waiting for "${eventName}"`));
			}, timeoutMs);
			const onMessage = (envelope: Envelope) => {
				if (envelope.event !== eventName) return;
				clearTimeout(timer);
				listeners.splice(listeners.indexOf(onMessage), 1);
				resolve(envelope);
			};
			listeners.push(onMessage);
		});
	}

	async function close() {
		socket.close();
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	return { received, waitFor, close };
}

describe("Deleting a submitted answer (REQ027)", () => {
	beforeAll(async () => {
		// Load server modules AFTER DATABASE_PATH is set.
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia().use(presentationRoutes).ws("/ws", {
			open(connection) {
				const clientId = ws.registerClient(connection);
				// See server/index.ts for the rationale — mutate ws.raw.data.
				(connection.raw as any).data = {
					...((connection.raw as any).data ?? {}),
					clientId,
				};
			},
			message(connection, message) {
				try {
					const parsed =
						typeof message === "string" ? JSON.parse(message) : message;
					if (parsed.type !== "join") return;
					const clientId = (connection.raw as any).data?.clientId as
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
				const clientId = (connection.raw as any).data?.clientId as
					| string
					| undefined;
				if (clientId) ws.removeClient(clientId);
			},
		});

		app.listen({ port: 0, hostname: "127.0.0.1" });
		const bunServer = (app as any).server as {
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = { stop: () => bunServer.stop(true), port: bunServer.port };
		baseUrl = `http://127.0.0.1:${bunServer.port}`;
		wsUrl = `ws://127.0.0.1:${bunServer.port}/ws`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	// ── The editor's list: what a deletion can be pointed at ──

	test("a word cloud hands its editor the individual answers behind its words", async () => {
		const pres = await runSession();
		const tally = await editorResults(pres.id, "wc", pres.creatorToken);
		expect(tally.totalVotes).toBe(3);
		// The cloud is an aggregate — two people typed the same word and it is one
		// entry — while the list beside it is one row per answer, which is what a
		// deletion needs.
		expect(tally.words).toEqual([
			{ text: KEPT_WORD, count: 2 },
			{ text: DOOMED_WORD, count: 1 },
		]);
		expect((tally.answers as AnyJson[]).map((one) => one.text).sort()).toEqual(
			[DOOMED_WORD, KEPT_WORD, KEPT_WORD].sort(),
		);
		for (const answer of tally.answers as AnyJson[]) {
			expect(typeof answer.id).toBe("string");
			expect(answer.id.length).toBeGreaterThan(0);
			expect(typeof answer.createdAt).toBe("string");
			// Who typed it is no part of taking it down, and a participant id is
			// that participant's only credential.
			expect(answer.participantId).toBeUndefined();
		}
	});

	test("the room reads the cloud without that list — the key is stated, not missing", async () => {
		const pres = await runSession();
		const tally = await roomResults(pres.id, "wc");
		expect(tally.words).toHaveLength(2);
		// ADR-0024: withheld reads as an explicit null a client can tell apart from
		// "nobody has answered", not as an absent key.
		expect(tally).toHaveProperty("answers");
		expect(tally.answers).toBeNull();
	});

	// ── The feature ──────────────────────────────────────────

	test("an editor deletes one word-cloud answer and the tally drops it", async () => {
		const pres = await runSession();
		const doomed = await wordAnswerId(pres, DOOMED_WORD);

		const response = await deleteAnswer(pres.id, doomed, pres.creatorToken);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, slideId: "wc" });

		const tally = await editorResults(pres.id, "wc", pres.creatorToken);
		expect(tally.totalVotes).toBe(2);
		expect(tally.words).toEqual([{ text: KEPT_WORD, count: 2 }]);
		expect((tally.answers as AnyJson[]).map((one) => one.text)).toEqual([
			KEPT_WORD,
			KEPT_WORD,
		]);
	});

	test("only that one answer goes — the other holder of the same word stands", async () => {
		const pres = await runSession();
		const oneOfTwo = await wordAnswerId(pres, KEPT_WORD);

		expect((await deleteAnswer(pres.id, oneOfTwo, pres.creatorToken)).status).toBe(
			200,
		);

		// An individual answer, not a word: the cloud still carries the word at a
		// count of one, because somebody else typed it too.
		const tally = await editorResults(pres.id, "wc", pres.creatorToken);
		expect(tally.words).toEqual([
			{ text: DOOMED_WORD, count: 1 },
			{ text: KEPT_WORD, count: 1 },
		]);
		expect(tally.totalVotes).toBe(2);
	});

	test("an editor deletes one open-ended response and the wall drops it", async () => {
		const pres = await runSession();
		const doomed = await responseId(pres, DOOMED_RESPONSE);

		const response = await deleteAnswer(pres.id, doomed, pres.creatorToken);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, slideId: "ot" });

		const tally = await editorResults(pres.id, "ot", pres.creatorToken);
		expect(tally.totalVotes).toBe(1);
		expect((tally.responses as AnyJson[]).map((one) => one.text)).toEqual([
			KEPT_RESPONSE,
		]);
		// The survivor keeps the upvote it collected — the deletion took one
		// response's upvotes, not the slide's.
		expect((tally.responses as AnyJson[])[0].upvotes).toBe(1);
	});

	test("the deleted response's upvotes go with it", async () => {
		const pres = await runSession();
		// Two responses, one upvote each — the deck's total before anything goes.
		expect(summaryOf(await downloadWorkbook(pres.id, pres.creatorToken)))
			.toHaveProperty("Response upvotes", 2);

		const doomed = await responseId(pres, DOOMED_RESPONSE);
		expect((await deleteAnswer(pres.id, doomed, pres.creatorToken)).status).toBe(
			200,
		);

		// A row naming a response that no longer exists would go on being counted
		// in the deck's totals — on the cover of the PDF and in the workbook's
		// summary — under an answer nobody can read any more.
		expect(summaryOf(await downloadWorkbook(pres.id, pres.creatorToken)))
			.toHaveProperty("Response upvotes", 1);
	});

	test("the room's live tally is recounted and broadcast", async () => {
		const pres = await runSession();
		const doomed = await wordAnswerId(pres, DOOMED_WORD);
		const room = await joinRoom(pres.id, "participant");

		await deleteAnswer(pres.id, doomed, pres.creatorToken);
		const frame = await room.waitFor("results.updated");

		expect(frame.data.slideId).toBe("wc");
		expect(frame.data.results.totalVotes).toBe(2);
		expect(frame.data.results.words).toEqual([{ text: KEPT_WORD, count: 2 }]);
		// The frame goes to the whole room, so it is the room's copy of the tally:
		// the editor-only list is withheld from it exactly as it is from the phone's
		// own fetch.
		expect(frame.data.results.answers).toBeNull();
		await room.close();
	});

	test("a phone that fetches after the deletion never sees the line", async () => {
		const pres = await runSession();
		const doomed = await responseId(pres, DOOMED_RESPONSE);
		await deleteAnswer(pres.id, doomed, pres.creatorToken);

		const tally = await roomResults(pres.id, "ot");
		expect((tally.responses as AnyJson[]).map((one) => one.text)).toEqual([
			KEPT_RESPONSE,
		]);
	});

	// ── Every export ─────────────────────────────────────────

	test("the spreadsheet is short the deleted answers, everywhere it reports them", async () => {
		const pres = await runSession();
		await deleteAnswer(pres.id, await wordAnswerId(pres, DOOMED_WORD), pres.creatorToken);
		await deleteAnswer(pres.id, await responseId(pres, DOOMED_RESPONSE), pres.creatorToken);

		const workbook = await downloadWorkbook(pres.id, pres.creatorToken);

		// The long table: one row per stored submission, and the deleted ones are
		// not stored any more.
		const answers = rowsOf(workbook, "Responses").map((row) => row.Answer);
		expect(answers).not.toContain(DOOMED_WORD);
		expect(answers).not.toContain(DOOMED_RESPONSE);
		expect(answers).toContain(KEPT_WORD);
		expect(answers).toContain(KEPT_RESPONSE);

		// The per-participant matrix: alice submitted both deleted lines and now
		// has nothing on either slide, while her choice vote is untouched.
		const alice = rowsOf(workbook, "Participants").find(
			(row) => row.Participant === "alice",
		);
		expect(alice).toBeDefined();
		expect(alice?.["1. One word for this quarter"]).toBeNull();
		expect(alice?.["2. What should we do differently?"]).toBeNull();
		expect(alice?.["3. Which release train?"]).toBe("Weekly");

		// The aggregates, which are the tallies the endpoint publishes rather than
		// a second count of their own.
		const aggregateEntries = rowsOf(workbook, "Aggregates").map(
			(row) => row.Entry,
		);
		expect(aggregateEntries).not.toContain(DOOMED_WORD);
		expect(aggregateEntries).not.toContain(DOOMED_RESPONSE);

		// And the totals on the front.
		const summary = summaryOf(workbook);
		expect(summary.Responses).toBe(4);
		expect(summary["Response upvotes"]).toBe(1);
	});

	test("the PDF is short them too", async () => {
		const pres = await runSession();
		expect(await pdfText(pres.id, pres.creatorToken)).toContain(DOOMED_WORD);

		await deleteAnswer(pres.id, await wordAnswerId(pres, DOOMED_WORD), pres.creatorToken);
		await deleteAnswer(pres.id, await responseId(pres, DOOMED_RESPONSE), pres.creatorToken);

		const text = await pdfText(pres.id, pres.creatorToken);
		expect(text).not.toContain(DOOMED_WORD);
		expect(text).not.toContain(DOOMED_RESPONSE);
		expect(text).toContain(KEPT_WORD);
	});

	test("an ended deck can still be moderated — which is when it is exported", async () => {
		const pres = await runSession();
		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});

		const doomed = await wordAnswerId(pres, DOOMED_WORD);
		expect((await deleteAnswer(pres.id, doomed, pres.creatorToken)).status).toBe(
			200,
		);
		expect(await pdfText(pres.id, pres.creatorToken)).not.toContain(DOOMED_WORD);
	});

	// ── The boundary ─────────────────────────────────────────

	test("a caller with no credential is refused, and the answer stands", async () => {
		const pres = await runSession();
		const doomed = await wordAnswerId(pres, DOOMED_WORD);

		const response = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/answers/${doomed}`,
			{ method: "DELETE" },
		);
		expect(response.status).toBe(401);

		const tally = await editorResults(pres.id, "wc", pres.creatorToken);
		expect(tally.totalVotes).toBe(3);
	});

	test("another deck's edit token opens nothing here", async () => {
		const pres = await runSession();
		const other = await create();
		const doomed = await wordAnswerId(pres, DOOMED_WORD);

		const response = await deleteAnswer(pres.id, doomed, other.creatorToken);
		expect(response.status).toBe(401);
		expect(
			(await editorResults(pres.id, "wc", pres.creatorToken)).totalVotes,
		).toBe(3);
	});

	test("an answer belonging to another deck answers 404, and survives", async () => {
		const mine = await runSession();
		const theirs = await runSession();
		const theirAnswer = await wordAnswerId(theirs, DOOMED_WORD);

		// Presented with my own deck's credentials, against my own deck's URL: the
		// id is real, and it is still none of this deck's business.
		const response = await deleteAnswer(mine.id, theirAnswer, mine.creatorToken);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "No such submitted answer on this deck",
		});
		expect(
			(await editorResults(theirs.id, "wc", theirs.creatorToken)).totalVotes,
		).toBe(3);
	});

	test("an id that names nothing answers the same 404", async () => {
		const pres = await runSession();
		const response = await deleteAnswer(
			pres.id,
			"no-such-answer",
			pres.creatorToken,
		);
		expect(response.status).toBe(404);
	});

	test("a choice slide's vote is refused with the rule that refused it", async () => {
		const pres = await runSession();
		// The one answer on this deck that is a choice rather than something
		// somebody wrote. Its id is not published by any tally, so it is read from
		// the export's response rows — which is exactly the reach an integrator
		// with the edit token has.
		const workbook = await downloadWorkbook(pres.id, pres.creatorToken);
		const choiceRow = rowsOf(workbook, "Responses").find(
			(row) => row["Slide ID"] === "mc",
		);
		expect(choiceRow).toBeDefined();
		const stored = await import("./services/presentations");
		const results = await stored.getSlideResults(pres.id, "mc", {
			canEdit: true,
		});
		expect((results as AnyJson).totalVotes).toBe(1);

		// The vote id is not on any payload, so it is taken from the store the way
		// the service does.
		const { createStore } = await import("./db");
		const { StoredVoteSchema } = await import("./schemas");
		const votes = createStore("votes", StoredVoteSchema, {
			indexes: ["presentationId", "slideId", "participantId", "statementId"],
		});
		const [choiceVote] = await votes.find({
			presentationId: pres.id,
			slideId: "mc",
		});
		expect(choiceVote).toBeDefined();

		const response = await deleteAnswer(
			pres.id,
			choiceVote.id as string,
			pres.creatorToken,
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Only word-cloud and open-ended answers can be deleted individually",
			refused: "slide-type",
		});
		expect(
			((await stored.getSlideResults(pres.id, "mc", { canEdit: true })) as AnyJson)
				.totalVotes,
		).toBe(1);
	});

	test("deleting the same answer twice is a 404 the second time", async () => {
		const pres = await runSession();
		const doomed = await wordAnswerId(pres, DOOMED_WORD);

		expect((await deleteAnswer(pres.id, doomed, pres.creatorToken)).status).toBe(
			200,
		);
		expect((await deleteAnswer(pres.id, doomed, pres.creatorToken)).status).toBe(
			404,
		);
	});
});
