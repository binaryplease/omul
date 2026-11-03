/**
 * Integration tests for repeat passes through an audience-paced deck (REQ083).
 *
 * A deck can let one device go through it more than once, and each pass is kept
 * as its own set of answers instead of replacing the last. Everything here goes
 * through the HTTP surface and the WebSocket — the real Elysia app, a throw-away
 * in-memory zodstore and a temp auth DB, like the harnesses beside it — and
 * reads the store directly wherever the claim is about what is *kept*:
 *
 *  - **The switch** is an authored deck setting: off unless a create names it,
 *    public on every read a phone makes, written only by the deck's editors
 *    (owner, edit token, `edit` collaborator — `401`/`403` for everybody else),
 *    and broadcast to the room when it moves.
 *  - **Off is exactly what was there before**: one set of answers per device,
 *    a resubmission replacing it, whatever pass a request names, and a new pass
 *    refused with a stated reason. A presenter-paced deck is always off.
 *  - **On, each pass is its own set**, for every rule that used to be per
 *    device: the replace, a quiz's one final answer, a word cloud's cap, a
 *    multi-select's deselect, an upvote's toggle, the duplicate fold.
 *  - **A pass is opened by the server and recorded** — never by an answer — so
 *    a number a client made up, or kept through a reset it missed, lands in the
 *    latest pass that was really opened, every time; and two people at one
 *    kiosk are never written into one pass, whether the switch goes off between
 *    them or their requests cross in flight.
 *  - **Turning it off part-way** stops new passes without stranding a device
 *    in the one it was handed.
 *  - **Every pass is a respondent** on the results surface, on the
 *    leaderboard, in the breakdown and in the spreadsheet — and the breakdown's
 *    privacy floor still counts people, not passes.
 *  - **Every pass goes** with a reset, a deletion and a taken-down answer's
 *    upvotes.
 *  - **An answer stored before passes existed** is a single first pass.
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
import ExcelJS from "exceljs";
import { z } from "zod";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-repeat-passes-")),
	"auth.sqlite",
);

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Personal API keys for four accounts, created in beforeAll.
let ownerKey = "";
let viewerKey = "";
let editorKey = "";
let strangerKey = "";

const OWNER_EMAIL = "passes-owner@example.com";
const VIEWER_EMAIL = "passes-viewer@example.com";
const EDITOR_EMAIL = "passes-editor@example.com";
const STRANGER_EMAIL = "passes-stranger@example.com";

/** Direct handles on the collections a pass is stored in, and opened in. */
let stores: {
	votes: import("./db").Store;
	responseVotes: import("./db").Store;
	participantPasses: import("./db").Store;
};

/**
 * One slide of every rule a pass has to be kept inside: a single-choice replace,
 * a multi-select toggle, a quiz's final answer, a word cloud's cap, an open
 * question's upvotes and fold, a ranking's one-row-per-participant — and the
 * leaderboard the quiz feeds.
 */
const SURVEY: AnyJson[] = [
	{
		id: "team",
		type: "multiple-choice",
		question: "Which team are you on?",
		options: [
			{ id: "eng", text: "Engineering" },
			{ id: "sales", text: "Sales" },
		],
	},
	{
		id: "mood",
		type: "multiple-choice",
		question: "How did it go?",
		options: [
			{ id: "good", text: "Good" },
			{ id: "bad", text: "Bad" },
		],
	},
	{
		id: "pick",
		type: "multiple-choice",
		question: "Pick any",
		mcMaxSelections: 0,
		options: [
			{ id: "x", text: "X" },
			{ id: "y", text: "Y" },
		],
	},
	{
		id: "quiz",
		type: "quiz",
		question: "What is 2 + 2?",
		timeLimit: 0,
		options: [
			{ id: "four", text: "4", isCorrect: true },
			{ id: "five", text: "5" },
		],
	},
	{ id: "cloud", type: "word-cloud", question: "One word", maxResponses: 2 },
	{
		id: "ideas",
		type: "open-text",
		question: "Any ideas?",
		allowResponseVotes: true,
	},
	{
		id: "rank",
		type: "ranking",
		question: "Rank them",
		rankingItems: [
			{ id: "ra", text: "A" },
			{ id: "rb", text: "B" },
		],
	},
	{ id: "board", type: "leaderboard", question: "Standings" },
];

async function post(path: string, body: unknown): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

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

/** A request on an account's personal API key. */
async function asAccount(
	path: string,
	key: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			"x-api-key": key,
		},
	});
}

/**
 * An anonymous create: an audience-paced deck with repeat passes on, unless the
 * fields say otherwise. Comes back with its edit token.
 */
async function create(fields: AnyJson = {}): Promise<AnyJson> {
	const response = await post("/api/presentations", {
		title: "Kiosk survey",
		slides: SURVEY,
		mode: "survey",
		allowRepeatPasses: true,
		...fields,
	});
	expect(response.status).toBe(201);
	return response.json();
}

function vote(presentationId: string, body: AnyJson): Promise<Response> {
	return post(`/api/presentations/${presentationId}/vote`, body);
}

/** Vote and insist it landed. */
async function answer(presentationId: string, body: AnyJson): Promise<void> {
	const response = await vote(presentationId, body);
	expect(response.status).toBe(200);
}

function startPass(presentationId: string, body: AnyJson): Promise<Response> {
	return post(`/api/presentations/${presentationId}/passes`, body);
}

/** Start a pass and return the number the server opened. */
async function nextPass(
	presentationId: string,
	participantId: string,
): Promise<number> {
	const response = await startPass(presentationId, { participantId });
	expect(response.status).toBe(200);
	const body = await response.json();
	return body.pass;
}

function upvote(presentationId: string, body: AnyJson): Promise<Response> {
	return post(`/api/presentations/${presentationId}/response-vote`, body);
}

/** One slide's tally as the deck's editor reads it — every mode lifted. */
async function resultsOf(presentation: AnyJson, slideId: string): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${presentation.id}/results/${slideId}`,
		presentation.creatorToken,
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function scorecard(
	presentationId: string,
	participantId: string,
	pass?: number,
): Promise<AnyJson> {
	const query = new URLSearchParams({ participantId });
	if (pass !== undefined) query.set("pass", String(pass));
	const response = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/scorecard?${query}`,
	);
	expect(response.status).toBe(200);
	return response.json();
}

/** One device's stored answers to one slide, as `{ pass, value }`, by pass. */
async function keptAnswers(
	presentationId: string,
	slideId: string,
	participantId: string,
): Promise<{ pass: number; value: string }[]> {
	const rows = await stores.votes.find({ presentationId, slideId, participantId });
	return rows
		.map((row) => ({ pass: row.pass as number, value: row.value as string }))
		.sort(
			(left, right) =>
				left.pass - right.pass || left.value.localeCompare(right.value),
		);
}

interface Envelope {
	event: string;
	data: AnyJson;
}

/** Open a socket, join a room, and buffer every envelope. */
async function joinRoom(presentationId: string): Promise<{
	waitFor: (eventName: string, timeoutMs?: number) => Promise<Envelope>;
	received: Envelope[];
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
	socket.send(
		JSON.stringify({ type: "join", presentationId, role: "participant" }),
	);
	// Let the join land before anything the test does is broadcast.
	await new Promise((resolve) => setTimeout(resolve, 50));

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

	return { waitFor, received, close };
}

/** Every data row of a sheet, as cell values keyed by header text. */
function rowsOf(
	workbook: ExcelJS.Workbook,
	sheetName: string,
): Record<string, unknown>[] {
	const sheet = workbook.getWorksheet(sheetName) as ExcelJS.Worksheet;
	expect(sheet).toBeDefined();
	const headers: string[] = [];
	sheet.getRow(1).eachCell((cell, columnNumber) => {
		headers[columnNumber] = String(cell.value ?? "");
	});
	const rows: Record<string, unknown>[] = [];
	sheet.eachRow((row, rowNumber) => {
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

describe("Repeat passes (REQ083)", () => {
	beforeAll(async () => {
		// Load server modules AFTER the environment above is set.
		const { connectDb, createStore } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const {
			StoredParticipantPassSchema,
			StoredResponseVoteSchema,
			StoredVoteSchema,
		} = await import("./schemas");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		// `createStore` is idempotent per collection name, so these are the same
		// tables the service writes through.
		stores = {
			votes: createStore("votes", StoredVoteSchema),
			responseVotes: createStore("responseVotes", StoredResponseVoteSchema),
			participantPasses: createStore(
				"participantPasses",
				StoredParticipantPassSchema,
			),
		};

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.ws("/ws", {
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
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://127.0.0.1:${bunServer.port}`;
		wsUrl = `ws://127.0.0.1:${bunServer.port}/ws`;

		const accountFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: "correct-horse-battery", name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return created.key;
		};
		ownerKey = await accountFor(OWNER_EMAIL, "Owner");
		viewerKey = await accountFor(VIEWER_EMAIL, "Viewer");
		editorKey = await accountFor(EDITOR_EMAIL, "Editor");
		strangerKey = await accountFor(STRANGER_EMAIL, "Stranger");
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

	// ── The switch ─────────────────────────────────────────

	describe("the switch", () => {
		test("a deck created without naming it has it off, on every read a phone makes", async () => {
			const presentation = await create({ allowRepeatPasses: undefined });
			expect(presentation.allowRepeatPasses).toBe(false);
			const read = await (
				await fetch(`${baseUrl}/api/presentations/${presentation.id}`)
			).json();
			expect(read.allowRepeatPasses).toBe(false);
			const joined = await (
				await fetch(`${baseUrl}/api/join/${presentation.code}`)
			).json();
			expect(joined.allowRepeatPasses).toBe(false);
		});

		test("a deck created with it on tells the room so at the door", async () => {
			const presentation = await create();
			expect(presentation.allowRepeatPasses).toBe(true);
			const joined = await (
				await fetch(`${baseUrl}/api/join/${presentation.code}`)
			).json();
			expect(joined.allowRepeatPasses).toBe(true);
		});

		test("the edit token turns it on and off, and the room hears both", async () => {
			const presentation = await create({ allowRepeatPasses: false });
			const room = await joinRoom(presentation.id);
			try {
				const on = await authed(
					`/api/presentations/${presentation.id}`,
					presentation.creatorToken,
					{ method: "PATCH", body: JSON.stringify({ allowRepeatPasses: true }) },
				);
				expect(on.status).toBe(200);
				expect((await on.json()).allowRepeatPasses).toBe(true);
				const turnedOn = await room.waitFor("presentation.repeat-passes");
				expect(turnedOn.data).toEqual({
					presentationId: presentation.id,
					allowRepeatPasses: true,
				});

				room.received.length = 0;
				const off = await authed(
					`/api/presentations/${presentation.id}`,
					presentation.creatorToken,
					{ method: "PATCH", body: JSON.stringify({ allowRepeatPasses: false }) },
				);
				expect(off.status).toBe(200);
				const turnedOff = await room.waitFor("presentation.repeat-passes");
				expect(turnedOff.data.allowRepeatPasses).toBe(false);
			} finally {
				await room.close();
			}
		});

		test("a save that does not name it tells the room nothing about it", async () => {
			const presentation = await create();
			const room = await joinRoom(presentation.id);
			try {
				const saved = await authed(
					`/api/presentations/${presentation.id}`,
					presentation.creatorToken,
					{ method: "PATCH", body: JSON.stringify({ title: "Renamed" }) },
				);
				expect(saved.status).toBe(200);
				await expect(
					room.waitFor("presentation.repeat-passes", 300),
				).rejects.toThrow();
			} finally {
				await room.close();
			}
		});

		test("only the deck's editors can change it", async () => {
			const created = await asAccount("/api/presentations", ownerKey, {
				method: "POST",
				body: JSON.stringify({
					title: "Owned survey",
					slides: SURVEY,
					mode: "survey",
				}),
			});
			expect(created.status).toBe(201);
			const presentation = await created.json();
			for (const [email, level] of [
				[VIEWER_EMAIL, "view"],
				[EDITOR_EMAIL, "edit"],
			]) {
				const shared = await asAccount(
					`/api/presentations/${presentation.id}/collaborators`,
					ownerKey,
					{ method: "POST", body: JSON.stringify({ email, level }) },
				);
				expect([200, 201]).toContain(shared.status);
			}
			const patch = { method: "PATCH", body: JSON.stringify({ allowRepeatPasses: true }) };
			const path = `/api/presentations/${presentation.id}`;

			const anonymous = await fetch(`${baseUrl}${path}`, {
				...patch,
				headers: { "Content-Type": "application/json" },
			});
			expect(anonymous.status).toBe(401);
			expect((await asAccount(path, strangerKey, patch)).status).toBe(403);
			expect((await asAccount(path, viewerKey, patch)).status).toBe(403);
			const read = await (await fetch(`${baseUrl}${path}`)).json();
			expect(read.allowRepeatPasses).toBe(false);

			const byEditor = await asAccount(path, editorKey, patch);
			expect(byEditor.status).toBe(200);
			expect((await byEditor.json()).allowRepeatPasses).toBe(true);
		});
	});

	// ── Off: one set of answers per device, exactly as before ─

	describe("with the switch off", () => {
		test("a vote naming a later pass is still the device's first, and replaces it", async () => {
			const presentation = await create({ allowRepeatPasses: false });
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "solo",
			});
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "solo",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "team", "solo")).toEqual([
				{ pass: 1, value: "sales" },
			]);
			const results = await resultsOf(presentation, "team");
			expect(results.respondentCount).toBe(1);
			expect(results.totalVotes).toBe(1);
		});

		test("a new pass is refused, with the reason a phone can name", async () => {
			const presentation = await create({ allowRepeatPasses: false });
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "solo",
			});
			const refused = await startPass(presentation.id, {
				participantId: "solo",
				pass: 1,
			});
			expect(refused.status).toBe(400);
			const body = await refused.json();
			expect(body.refused).toBe("repeat-passes-off");
			expect(typeof body.error).toBe("string");
		});

		test("a presenter-paced deck opens no second pass, whatever its switch says", async () => {
			const presentation = await create({ mode: "live" });
			expect(presentation.allowRepeatPasses).toBe(true);
			const refused = await startPass(presentation.id, { participantId: "solo" });
			expect(refused.status).toBe(400);
			expect((await refused.json()).refused).toBe("repeat-passes-off");

			const started = await authed(
				`/api/presentations/${presentation.id}/start`,
				presentation.creatorToken,
				{ method: "POST" },
			);
			expect(started.status).toBe(200);
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "solo",
			});
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "solo",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "team", "solo")).toEqual([
				{ pass: 1, value: "sales" },
			]);
		});
	});

	// ── On: each pass is its own set of answers ─────────────

	describe("with the switch on", () => {
		test("a new pass is handed out by the server, and kept beside the first", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
			});
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "kiosk",
				pass: 2,
			});

			expect(await keptAnswers(presentation.id, "team", "kiosk")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "sales" },
			]);
			const results = await resultsOf(presentation, "team");
			expect(results.respondentCount).toBe(2);
			expect(results.totalVotes).toBe(2);
			const counts = Object.fromEntries(
				results.options.map((option: AnyJson) => [option.id, option.count]),
			);
			expect(counts).toEqual({ eng: 1, sales: 1 });
		});

		test("each start opens the next pass and records it, empty ones included", async () => {
			const presentation = await create();
			// The first pass is always open, so the first start opens the second —
			// even for a device that has answered nothing yet.
			expect(await nextPass(presentation.id, "fresh")).toBe(2);
			// Round again without answering anything in pass 2: a new pass all the
			// same, never the empty one handed back, which could be shared by two
			// people whose answers crossed in flight.
			expect(await nextPass(presentation.id, "fresh")).toBe(3);
			const [record] = await stores.participantPasses.find({
				presentationId: presentation.id,
				participantId: "fresh",
			});
			expect(record.openedPass).toBe(3);

			// A pass nothing was answered in leaves no rows behind, so it is not a
			// respondent anywhere.
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "fresh",
				pass: 3,
			});
			expect(await keptAnswers(presentation.id, "team", "fresh")).toEqual([
				{ pass: 3, value: "eng" },
			]);
			expect((await resultsOf(presentation, "team")).respondentCount).toBe(1);
		});

		test("two starts landing together open two passes, not one", async () => {
			const presentation = await create();
			const both = await Promise.all([
				startPass(presentation.id, { participantId: "twins" }),
				startPass(presentation.id, { participantId: "twins" }),
			]);
			const handed = await Promise.all(both.map((response) => response.json()));
			expect(handed.map((body: AnyJson) => body.pass).sort()).toEqual([2, 3]);
			expect(
				await stores.participantPasses.find({
					presentationId: presentation.id,
					participantId: "twins",
				}),
			).toHaveLength(1);
		});

		test("a resubmission replaces only the pass it names", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "mood",
				value: "good",
				participantId: "kiosk",
			});
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			await answer(presentation.id, {
				slideId: "mood",
				value: "bad",
				participantId: "kiosk",
				pass: 2,
			});
			await answer(presentation.id, {
				slideId: "mood",
				value: "good",
				participantId: "kiosk",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "mood", "kiosk")).toEqual([
				{ pass: 1, value: "good" },
				{ pass: 2, value: "good" },
			]);
		});

		test("a multi-select selection belongs to its pass, and so does its deselect", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "pick",
				value: "x",
				participantId: "kiosk",
			});
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			// The option pass 1 already holds is a fresh selection in pass 2, not a
			// tap that takes pass 1's back.
			await answer(presentation.id, {
				slideId: "pick",
				value: "x",
				participantId: "kiosk",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "pick", "kiosk")).toEqual([
				{ pass: 1, value: "x" },
				{ pass: 2, value: "x" },
			]);
			// The same option again in pass 2 takes pass 2's selection back, and
			// only that one.
			await answer(presentation.id, {
				slideId: "pick",
				value: "x",
				participantId: "kiosk",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "pick", "kiosk")).toEqual([
				{ pass: 1, value: "x" },
			]);
		});

		test("a ranking keeps one ordering per pass", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "rank",
				value: "ra,rb",
				participantId: "kiosk",
			});
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			await answer(presentation.id, {
				slideId: "rank",
				value: "rb,ra",
				participantId: "kiosk",
				pass: 2,
			});
			await answer(presentation.id, {
				slideId: "rank",
				value: "ra,rb",
				participantId: "kiosk",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "rank", "kiosk")).toEqual([
				{ pass: 1, value: "ra,rb" },
				{ pass: 2, value: "ra,rb" },
			]);
			expect((await resultsOf(presentation, "rank")).ballots).toBe(2);
		});

		test("a quiz answer is final within its pass, and the next pass answers again", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "quiz",
				value: "five",
				participantId: "kiosk",
			});
			const locked = await vote(presentation.id, {
				slideId: "quiz",
				value: "four",
				participantId: "kiosk",
			});
			expect(locked.status).toBe(400);
			expect((await locked.json()).refused).toBe("quiz-already-answered");

			const pass = await nextPass(presentation.id, "kiosk");
			// The new pass's card is blank, so nothing locks its answer cards.
			const blank = await scorecard(presentation.id, "kiosk", pass);
			expect(blank.pass).toBe(2);
			expect(blank.answeredCount).toBe(0);
			expect(blank.rank).toBeNull();

			await answer(presentation.id, {
				slideId: "quiz",
				value: "four",
				participantId: "kiosk",
				pass,
			});

			const first = await scorecard(presentation.id, "kiosk");
			expect(first.pass).toBe(1);
			expect(first.slides[0].optionId).toBe("five");
			expect(first.slides[0].isCorrect).toBe(false);
			const second = await scorecard(presentation.id, "kiosk", 2);
			expect(second.pass).toBe(2);
			expect(second.slides[0].optionId).toBe("four");
			expect(second.slides[0].isCorrect).toBe(true);
			// Two rows on the board, under two different handles.
			expect(second.entryId).not.toBe(first.entryId);
			expect(second.rank).toBe(1);
			expect(first.rank).toBe(2);

			const tally = await resultsOf(presentation, "quiz");
			expect(tally.respondentCount).toBe(2);
			expect(tally.scoring.answeredCount).toBe(2);
			expect(tally.scoring.correctCount).toBe(1);
			const board = await resultsOf(presentation, "board");
			expect(board.rankedCount).toBe(2);
		});

		test("a word cloud's cap counts one pass's answers", async () => {
			const presentation = await create();
			for (const word of ["one", "two"]) {
				await answer(presentation.id, {
					slideId: "cloud",
					value: word,
					participantId: "kiosk",
				});
			}
			const capped = await vote(presentation.id, {
				slideId: "cloud",
				value: "three",
				participantId: "kiosk",
			});
			expect(capped.status).toBe(400);
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			for (const word of ["three", "four"]) {
				await answer(presentation.id, {
					slideId: "cloud",
					value: word,
					participantId: "kiosk",
					pass: 2,
				});
			}
			expect(await keptAnswers(presentation.id, "cloud", "kiosk")).toEqual([
				{ pass: 1, value: "one" },
				{ pass: 1, value: "two" },
				{ pass: 2, value: "four" },
				{ pass: 2, value: "three" },
			]);
			expect((await resultsOf(presentation, "cloud")).totalVotes).toBe(4);
		});

		test("an upvote belongs to its pass, and its toggle never takes back an earlier pass's", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "ideas",
				value: "Pizza fridays",
				participantId: "author",
			});
			const [idea] = (await resultsOf(presentation, "ideas")).responses;
			const upvoteAs = async (pass?: number) => {
				const response = await upvote(presentation.id, {
					slideId: "ideas",
					responseId: idea.id,
					participantId: "fan",
					...(pass === undefined ? {} : { pass }),
				});
				expect(response.status).toBe(200);
			};
			const upvotesNow = async () =>
				(await resultsOf(presentation, "ideas")).responses[0].upvotes;

			await upvoteAs();
			expect(await upvotesNow()).toBe(1);
			expect(await nextPass(presentation.id, "fan")).toBe(2);
			await upvoteAs(2);
			expect(await upvotesNow()).toBe(2);
			await upvoteAs(2);
			expect(await upvotesNow()).toBe(1);
			const kept = await stores.responseVotes.find({
				presentationId: presentation.id,
				participantId: "fan",
			});
			expect(kept.map((row) => row.pass)).toEqual([1]);
		});

		test("the same words from a later pass fold into an upvote, like anybody else's", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "ideas",
				value: "Pizza",
				participantId: "solo",
			});
			expect(await nextPass(presentation.id, "solo")).toBe(2);
			await answer(presentation.id, {
				slideId: "ideas",
				value: "pizza",
				participantId: "solo",
				pass: 2,
			});
			const results = await resultsOf(presentation, "ideas");
			expect(results.responses).toHaveLength(1);
			expect(results.responses[0].upvotes).toBe(1);
			const folded = await stores.responseVotes.find({
				presentationId: presentation.id,
				participantId: "solo",
			});
			expect(folded.map((row) => row.pass)).toEqual([2]);
		});

		test("an answer never opens a pass: one naming a pass nobody started lands in the latest that was", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "drift",
			});
			// Neither pass 9 nor pass 2 was ever started for this device, so both
			// are read as the latest pass it has — its first — and replace in it.
			for (const [pass, value] of [
				[9, "sales"],
				[2, "eng"],
			] as const) {
				await answer(presentation.id, {
					slideId: "team",
					value,
					participantId: "drift",
					pass,
				});
			}
			expect(await keptAnswers(presentation.id, "team", "drift")).toEqual([
				{ pass: 1, value: "eng" },
			]);
			// Once the server opens pass 2, an answer naming it lands there.
			expect(await nextPass(presentation.id, "drift")).toBe(2);
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "drift",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "team", "drift")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "sales" },
			]);
		});

		test("the last answer and the next start crossing in flight keep two people apart", async () => {
			// One person's final answer is still on its way when the next person taps
			// "Answer again". The answer names the pass it was given in and lands
			// there; the start opens a pass of its own rather than handing back one
			// it believes is empty.
			const presentation = await create();
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
			const [answered, started] = await Promise.all([
				vote(presentation.id, {
					slideId: "team",
					value: "sales",
					participantId: "kiosk",
					pass: 2,
				}),
				startPass(presentation.id, { participantId: "kiosk" }),
			]);
			expect(answered.status).toBe(200);
			expect((await started.json()).pass).toBe(3);
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
				pass: 3,
			});
			expect(await keptAnswers(presentation.id, "team", "kiosk")).toEqual([
				{ pass: 2, value: "sales" },
				{ pass: 3, value: "eng" },
			]);
		});
	});

	// ── Turning it off part-way through ─────────────────────

	describe("turning the switch off part-way through", () => {
		test("a pass already under way stays open, and no new one starts", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "mid",
			});
			expect(await nextPass(presentation.id, "mid")).toBe(2);
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "mid",
				pass: 2,
			});

			const off = await authed(
				`/api/presentations/${presentation.id}`,
				presentation.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ allowRepeatPasses: false }) },
			);
			expect(off.status).toBe(200);

			// Pass 2 is finished where it is, not written over pass 1.
			await answer(presentation.id, {
				slideId: "mood",
				value: "bad",
				participantId: "mid",
				pass: 2,
			});
			const refused = await startPass(presentation.id, { participantId: "mid" });
			expect(refused.status).toBe(400);
			expect((await refused.json()).refused).toBe("repeat-passes-off");
			// A pass it never got to open reads as the latest one it has.
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "mid",
				pass: 3,
			});

			expect(await keptAnswers(presentation.id, "team", "mid")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "eng" },
			]);
			expect(await keptAnswers(presentation.id, "mood", "mid")).toEqual([
				{ pass: 2, value: "bad" },
			]);
		});

		test("pacing the deck back to the presenter stops new passes and leaves opened ones open", async () => {
			// The same rule as switching repeat passes off, reached through the other
			// half of `deckAllowsRepeatPasses`: what stops is a *new* pass. The kiosk's
			// waiting pass stays the next person's rather than folding them into the
			// person before.
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
			});
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);

			const paced = await authed(
				`/api/presentations/${presentation.id}`,
				presentation.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ mode: "live" }) },
			);
			expect(paced.status).toBe(200);
			const started = await authed(
				`/api/presentations/${presentation.id}/start`,
				presentation.creatorToken,
				{ method: "POST" },
			);
			expect(started.status).toBe(200);

			const refused = await startPass(presentation.id, { participantId: "kiosk" });
			expect(refused.status).toBe(400);
			expect((await refused.json()).refused).toBe("repeat-passes-off");
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "kiosk",
				pass: 2,
			});
			expect(await keptAnswers(presentation.id, "team", "kiosk")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "sales" },
			]);
		});

		test("a kiosk waiting on a fresh pass when the switch goes off never answers over the person before", async () => {
			// The kiosk case end to end. Person A goes through and taps "Answer
			// again"; the kiosk sits at the first slide of a pass nothing has been
			// answered in. The organizer turns repeat passes off. Person B answers
			// there — and every one of B's answers is B's, in the pass the kiosk was
			// handed, while A's stand exactly as A left them.
			const presentation = await create();
			for (const [slideId, value] of [
				["team", "eng"],
				["pick", "x"],
				["quiz", "five"],
			] as const) {
				await answer(presentation.id, { slideId, value, participantId: "kiosk" });
			}
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);

			const off = await authed(
				`/api/presentations/${presentation.id}`,
				presentation.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ allowRepeatPasses: false }) },
			);
			expect(off.status).toBe(200);

			for (const [slideId, value] of [
				["team", "sales"],
				["pick", "x"],
				["quiz", "four"],
			] as const) {
				await answer(presentation.id, {
					slideId,
					value,
					participantId: "kiosk",
					pass: 2,
				});
			}

			expect(await keptAnswers(presentation.id, "team", "kiosk")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "sales" },
			]);
			expect(await keptAnswers(presentation.id, "pick", "kiosk")).toEqual([
				{ pass: 1, value: "x" },
				{ pass: 2, value: "x" },
			]);
			expect(await keptAnswers(presentation.id, "quiz", "kiosk")).toEqual([
				{ pass: 1, value: "five" },
				{ pass: 2, value: "four" },
			]);
			const card = await scorecard(presentation.id, "kiosk", 2);
			expect(card.pass).toBe(2);
			expect(card.slides[0].optionId).toBe("four");
			expect((await resultsOf(presentation, "team")).respondentCount).toBe(2);
		});
	});

	// ── The boundary ───────────────────────────────────────

	describe("the start-a-pass route's refusals", () => {
		test("an ended deck starts no pass", async () => {
			const presentation = await create();
			const ended = await authed(
				`/api/presentations/${presentation.id}/end`,
				presentation.creatorToken,
				{ method: "POST" },
			);
			expect(ended.status).toBe(200);
			const refused = await startPass(presentation.id, { participantId: "late" });
			expect(refused.status).toBe(400);
			const body = await refused.json();
			expect(typeof body.error).toBe("string");
			expect(body.refused).toBeUndefined();
		});

		test("a deck that does not exist is a 404", async () => {
			const missing = await startPass("no-such-deck", { participantId: "p" });
			expect(missing.status).toBe(404);
		});

		test("a malformed request is refused at the boundary", async () => {
			const presentation = await create();
			expect((await startPass(presentation.id, {})).status).toBe(422);
			expect(
				(await startPass(presentation.id, { participantId: "" })).status,
			).toBe(422);
			expect(
				(
					await vote(presentation.id, {
						slideId: "team",
						value: "eng",
						participantId: "p",
						pass: "two",
					})
				).status,
			).toBe(422);
			expect(
				(
					await upvote(presentation.id, {
						slideId: "ideas",
						responseId: "r",
						participantId: "p",
						pass: -1,
					})
				).status,
			).toBe(422);
			const badCard = await fetch(
				`${baseUrl}/api/presentations/${presentation.id}/scorecard?participantId=p&pass=0`,
			);
			expect(badCard.status).toBe(422);
		});
	});

	// ── Every pass is a respondent ──────────────────────────

	describe("results and exports count each pass", () => {
		test("the spreadsheet has a row per pass, and counts them as participants", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
			});
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "kiosk",
				pass: await nextPass(presentation.id, "kiosk"),
			});
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "visitor",
			});

			const response = await authed(
				`/api/presentations/${presentation.id}/results.xlsx`,
				presentation.creatorToken,
			);
			expect(response.status).toBe(200);
			const workbook = new ExcelJS.Workbook();
			await workbook.xlsx.load(await response.arrayBuffer());

			const summary = Object.fromEntries(
				rowsOf(workbook, "Summary").map((row) => [row.Field, row.Value]),
			);
			expect(summary.Participants).toBe(3);
			expect(summary["Repeat passes"]).toBe(true);

			const participants = rowsOf(workbook, "Participants").map((row) => [
				row.Participant,
				row.Pass,
				row["1. Which team are you on?"],
			]);
			expect(participants).toEqual([
				["kiosk", 1, "Engineering"],
				["kiosk", 2, "Sales"],
				["visitor", 1, "Engineering"],
			]);

			const responses = rowsOf(workbook, "Responses")
				.filter((row) => row.Participant === "kiosk")
				.map((row) => [row.Pass, row.Answer]);
			expect(responses).toEqual([
				[1, "Engineering"],
				[2, "Sales"],
			]);

			// The PDF reads the same rows; it has to come out with them in it.
			const pdf = await authed(
				`/api/presentations/${presentation.id}/deck.pdf`,
				presentation.creatorToken,
			);
			expect(pdf.status).toBe(200);
		});

		test("a breakdown joins each pass to its own answers", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
			});
			await answer(presentation.id, {
				slideId: "mood",
				value: "good",
				participantId: "kiosk",
			});
			const pass = await nextPass(presentation.id, "kiosk");
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "kiosk",
				pass,
			});
			await answer(presentation.id, {
				slideId: "mood",
				value: "bad",
				participantId: "kiosk",
				pass,
			});

			// As the deck's editor, so no group is held back for its size.
			const response = await authed(
				`/api/presentations/${presentation.id}/results/mood/segments?by=team`,
				presentation.creatorToken,
			);
			expect(response.status).toBe(200);
			const breakdown = await response.json();
			const segment = (key: string | null) =>
				breakdown.segments.find((candidate: AnyJson) => candidate.key === key);
			const countsIn = (key: string) =>
				Object.fromEntries(
					segment(key).results.options.map((option: AnyJson) => [
						option.id,
						option.count,
					]),
				);
			expect(segment("eng").respondentCount).toBe(1);
			expect(countsIn("eng")).toEqual({ good: 1, bad: 0 });
			expect(segment("sales").respondentCount).toBe(1);
			expect(countsIn("sales")).toEqual({ good: 0, bad: 1 });
			expect(segment(null).respondentCount).toBe(0);
		});

		test("a breakdown's privacy floor counts people, so one person's five passes are not a group of five", async () => {
			const presentation = await create();
			// One person goes through five times, always Engineering and Good.
			for (let pass = 1; pass <= 5; pass++) {
				if (pass > 1) expect(await nextPass(presentation.id, "retaker")).toBe(pass);
				await answer(presentation.id, {
					slideId: "team",
					value: "eng",
					participantId: "retaker",
					pass,
				});
				await answer(presentation.id, {
					slideId: "mood",
					value: "good",
					participantId: "retaker",
					pass,
				});
			}
			// Five different people go through once each.
			for (const participantId of ["d1", "d2", "d3", "d4", "d5"]) {
				await answer(presentation.id, { slideId: "team", value: "sales", participantId });
				await answer(presentation.id, { slideId: "mood", value: "bad", participantId });
			}

			// Read as the room reads it — no credential. Engineering holds five
			// respondents and one person: published, its tally would be that person's
			// answers. So it is held back, and Sales with it as the complement.
			const room = await (
				await fetch(
					`${baseUrl}/api/presentations/${presentation.id}/results/mood/segments?by=team`,
				)
			).json();
			const roomSegment = (key: string) =>
				room.segments.find((candidate: AnyJson) => candidate.key === key);
			expect(room.withheld).toBe(false);
			expect(roomSegment("eng").suppressed).toBe(true);
			expect(roomSegment("eng").respondentCount).toBeNull();
			expect(roomSegment("eng").results).toBeNull();
			expect(roomSegment("sales").suppressed).toBe(true);

			// The deck's editor reads every group, counted in respondents as the
			// tally above them is.
			const editor = await (
				await authed(
					`/api/presentations/${presentation.id}/results/mood/segments?by=team`,
					presentation.creatorToken,
				)
			).json();
			const editorSegment = (key: string) =>
				editor.segments.find((candidate: AnyJson) => candidate.key === key);
			expect(editorSegment("eng").suppressed).toBe(false);
			expect(editorSegment("eng").respondentCount).toBe(5);
			expect(editorSegment("sales").respondentCount).toBe(5);
		});
	});

	// ── Every pass goes ─────────────────────────────────────

	describe("cascades take every pass, not only the latest", () => {
		/** A deck where one device has answered and upvoted in two passes. */
		async function deckWithTwoPasses(): Promise<{
			presentation: AnyJson;
			ideaId: string;
		}> {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "ideas",
				value: "Standups at ten",
				participantId: "author",
			});
			const [idea] = (await resultsOf(presentation, "ideas")).responses;
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "kiosk",
			});
			await upvote(presentation.id, {
				slideId: "ideas",
				responseId: idea.id,
				participantId: "kiosk",
			});
			const pass = await nextPass(presentation.id, "kiosk");
			expect(pass).toBe(2);
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "kiosk",
				pass,
			});
			const second = await upvote(presentation.id, {
				slideId: "ideas",
				responseId: idea.id,
				participantId: "kiosk",
				pass,
			});
			expect(second.status).toBe(200);
			const kept = await stores.votes.find({ presentationId: presentation.id });
			expect(new Set(kept.map((row) => row.pass))).toEqual(new Set([1, 2]));
			expect(
				await stores.participantPasses.find({ presentationId: presentation.id }),
			).toHaveLength(1);
			return { presentation, ideaId: idea.id };
		}

		test("a reset clears every pass, and the next answer is a first pass again", async () => {
			const { presentation } = await deckWithTwoPasses();
			const reset = await authed(
				`/api/presentations/${presentation.id}/reset`,
				presentation.creatorToken,
				{ method: "POST" },
			);
			expect(reset.status).toBe(200);
			expect(
				await stores.votes.find({ presentationId: presentation.id }),
			).toEqual([]);
			expect(
				await stores.responseVotes.find({ presentationId: presentation.id }),
			).toEqual([]);
			expect(
				await stores.participantPasses.find({ presentationId: presentation.id }),
			).toEqual([]);

			// A phone that missed the reset still thinks it is on pass 2. Every one
			// of its answers is the re-run's first pass — the first one *and* the
			// ones after it: an answer landing cannot open a pass, so the person is
			// not split in two by the order their answers arrived in.
			for (const [slideId, value] of [
				["team", "eng"],
				["mood", "good"],
				["quiz", "five"],
			] as const) {
				await answer(presentation.id, {
					slideId,
					value,
					participantId: "kiosk",
					pass: 2,
				});
			}
			const kept = await stores.votes.find({ presentationId: presentation.id });
			expect(kept).toHaveLength(3);
			expect(kept.every((row) => row.pass === 1)).toBe(true);
			for (const slideId of ["team", "mood", "quiz"]) {
				expect((await resultsOf(presentation, slideId)).respondentCount).toBe(1);
			}
			// The quiz answer it gave is final in that one pass.
			const again = await vote(presentation.id, {
				slideId: "quiz",
				value: "four",
				participantId: "kiosk",
				pass: 2,
			});
			expect((await again.json()).refused).toBe("quiz-already-answered");
			// And the next pass it is handed is the re-run's second.
			expect(await nextPass(presentation.id, "kiosk")).toBe(2);
		});

		test("deleting the deck deletes every pass", async () => {
			const { presentation } = await deckWithTwoPasses();
			const deleted = await authed(
				`/api/presentations/${presentation.id}`,
				presentation.creatorToken,
				{ method: "DELETE" },
			);
			expect(deleted.status).toBe(200);
			expect(
				await stores.votes.find({ presentationId: presentation.id }),
			).toEqual([]);
			expect(
				await stores.responseVotes.find({ presentationId: presentation.id }),
			).toEqual([]);
			expect(
				await stores.participantPasses.find({ presentationId: presentation.id }),
			).toEqual([]);
		});

		test("taking an answer down takes its upvotes from every pass", async () => {
			const { presentation, ideaId } = await deckWithTwoPasses();
			const upvotesBefore = await stores.responseVotes.find({
				presentationId: presentation.id,
				responseId: ideaId,
			});
			expect(upvotesBefore.map((row) => row.pass).sort()).toEqual([1, 2]);

			const removed = await authed(
				`/api/presentations/${presentation.id}/answers/${ideaId}`,
				presentation.creatorToken,
				{ method: "DELETE" },
			);
			expect(removed.status).toBe(200);
			expect(
				await stores.responseVotes.find({
					presentationId: presentation.id,
					responseId: ideaId,
				}),
			).toEqual([]);
			// The device's own answers in both passes are not what was taken down.
			expect(await keptAnswers(presentation.id, "team", "kiosk")).toEqual([
				{ pass: 1, value: "eng" },
				{ pass: 2, value: "sales" },
			]);
		});
	});

	// ── Answers stored before passes existed ───────────────

	describe("answers stored before passes existed", () => {
		test("read as a single first pass: counted once, replaced in place, then followed by pass 2", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "team",
				value: "eng",
				participantId: "veteran",
			});
			const { createStore } = await import("./db");
			const { StoredVoteSchema } = await import("./schemas");
			// The collection as every build before REQ083 opened it: a vote with no
			// `pass` in its shape. A row it writes has no such key at all — which is
			// the state every vote on disk was in the day this shipped.
			const prePassVotes = createStore(
				"votes",
				StoredVoteSchema.omit({ pass: true }),
			);
			const [stored] = await stores.votes.find({
				presentationId: presentation.id,
				participantId: "veteran",
			});
			await prePassVotes.update(stored.id as string, {});
			const rawVotes = createStore(
				"votes",
				z.object({ id: z.string() }).passthrough(),
			);
			const onDisk = (await rawVotes.findOne(stored.id as string)) as AnyJson;
			expect("pass" in onDisk).toBe(false);

			// Every read fills the first pass in.
			expect((await stores.votes.findOne(stored.id as string))?.pass).toBe(1);
			expect((await resultsOf(presentation, "team")).respondentCount).toBe(1);

			// A first-pass resubmission replaces it rather than standing beside it.
			await answer(presentation.id, {
				slideId: "team",
				value: "sales",
				participantId: "veteran",
			});
			expect(await keptAnswers(presentation.id, "team", "veteran")).toEqual([
				{ pass: 1, value: "sales" },
			]);
			// And it is held as the first pass: the next one is the second.
			expect(await nextPass(presentation.id, "veteran")).toBe(2);
		});

		test("an upvote stored before passes existed is the first pass's to take back", async () => {
			const presentation = await create();
			await answer(presentation.id, {
				slideId: "ideas",
				value: "Fewer meetings",
				participantId: "author",
			});
			const [idea] = (await resultsOf(presentation, "ideas")).responses;
			const press = () =>
				upvote(presentation.id, {
					slideId: "ideas",
					responseId: idea.id,
					participantId: "veteran",
				});
			expect((await press()).status).toBe(200);

			const { createStore } = await import("./db");
			const { StoredResponseVoteSchema } = await import("./schemas");
			const prePassUpvotes = createStore(
				"responseVotes",
				StoredResponseVoteSchema.omit({ pass: true }),
			);
			const [stored] = await stores.responseVotes.find({
				presentationId: presentation.id,
				participantId: "veteran",
			});
			await prePassUpvotes.update(stored.id as string, {});

			// Pressing again in the first pass takes the legacy upvote back.
			expect((await press()).status).toBe(200);
			expect(
				await stores.responseVotes.find({
					presentationId: presentation.id,
					participantId: "veteran",
				}),
			).toEqual([]);
			expect((await resultsOf(presentation, "ideas")).responses[0].upvotes).toBe(0);
		});
	});
});
