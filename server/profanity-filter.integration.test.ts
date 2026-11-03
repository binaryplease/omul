/**
 * Integration tests for the profanity filter on free text (REQ085).
 *
 * The filter's promise is a boundary, so it is asked at every door rather than
 * at one: **with the filter on, no payload that reaches a screen in the room
 * carries a withheld answer** — not the public results reads, not the
 * `results.updated` frame every socket in the room receives, and not the
 * presenter's own credentialed poll either, because that screen is the
 * projector. The raw words stay reachable to the deck's editors, marked, on a
 * read that asks for them (the results surface) and in both exports.
 *
 * Around that, the setting itself is an edit like any other: authored on create
 * and PATCH, refused 401/403 to a caller who may not edit the deck, off by
 * default, and read forward with no migration on a deck stored before it
 * existed. Switching it — or moving the deck's language while the filter
 * follows it — re-sends every free-text tally to the room at once.
 *
 * Runs the real Elysia app — auth handler, routes and WebSocket — against a
 * throw-away in-memory zodstore and a temp auth DB, like the harnesses beside it.
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
import { drawnRuns } from "./deck-pdf.test-support";
import { z } from "zod";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-profanity-filter-")),
	"auth.sqlite",
);

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// Personal API keys for three accounts, created in beforeAll.
let ownerKey = "";
let collaboratorKey = "";
let strangerKey = "";

const OWNER_EMAIL = "filter-owner@example.com";
const COLLABORATOR_EMAIL = "filter-collaborator@example.com";
const STRANGER_EMAIL = "filter-stranger@example.com";

/** Every answer below the English list withholds, exactly as typed. */
const PROFANE = ["what the fuck", "Shit happens", "FÜCK", "motherfucker"];
/** Answers the list leaves alone, including two that merely contain one. */
const CLEAN = ["Pizza", "pizza", "Scunthorpe", "a classic"];

const DECK: AnyJson[] = [
	{ id: "team", type: "multiple-choice", question: "Which team?", options: [
		{ id: "eng", text: "Engineering" },
		{ id: "ops", text: "Operations" },
	] },
	{ id: "wc", type: "word-cloud", question: "One word for Monday" },
	{ id: "oe", type: "open-text", question: "What would you change?" },
	{
		id: "qz",
		type: "quiz",
		question: "Capital of France?",
		quizAnswerMode: "type",
		quizAnswers: [{ id: "paris", text: "Paris" }],
		timeLimit: 0,
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

/** An anonymous create: the deck comes back with its edit token. */
async function create(extra: AnyJson = {}, slides: AnyJson[] = DECK): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Profanity filter", slides, ...extra }),
	});
	expect(response.status).toBe(201);
	return response.json();
}

/** A filtering deck that is live and taking answers. */
async function liveFilteredDeck(extra: AnyJson = {}): Promise<AnyJson> {
	const deck = await create({ profanityFilterEnabled: true, ...extra });
	const started = await authed(
		`/api/presentations/${deck.id}/start`,
		deck.creatorToken,
		{ method: "POST" },
	);
	expect(started.status).toBe(200);
	return deck;
}

let participantCounter = 0;

/** One answer from a participant nobody else answers as. */
async function answer(deck: AnyJson, slideId: string, value: string) {
	participantCounter += 1;
	const response = await fetch(`${baseUrl}/api/presentations/${deck.id}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			slideId,
			value,
			participantId: `filter-participant-${participantCounter}`,
		}),
	});
	expect(response.status).toBe(200);
	return response.json();
}

/** One slide's tally, as a given reader reads it. */
async function tally(
	deck: AnyJson,
	slideId: string,
	{
		token,
		key,
		resultsToken,
		include = false,
	}: { token?: string; key?: string; resultsToken?: string; include?: boolean } = {},
): Promise<AnyJson> {
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (key) headers["x-api-key"] = key;
	if (resultsToken) headers["x-omul-results-token"] = resultsToken;
	const response = await fetch(
		`${baseUrl}/api/presentations/${deck.id}/results/${slideId}${
			include ? "?filtered=include" : ""
		}`,
		{ headers },
	);
	expect(response.status).toBe(200);
	return response.json();
}

/** Assert a payload carries none of the withheld answers, in any field or case. */
function expectNothingWithheld(payload: unknown) {
	const serialized = JSON.stringify(payload).toLowerCase();
	for (const withheld of PROFANE) {
		expect([withheld, serialized.includes(withheld.toLowerCase())]).toEqual([
			withheld,
			false,
		]);
	}
}

/** Read one worksheet as header → value rows. */
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
			if (!headers[columnNumber]) continue;
			entry[headers[columnNumber]] = row.getCell(columnNumber).value ?? null;
		}
		rows.push(entry);
	});
	return rows;
}

async function workbookOf(deck: AnyJson): Promise<ExcelJS.Workbook> {
	const response = await authed(
		`/api/presentations/${deck.id}/results.xlsx`,
		deck.creatorToken,
	);
	expect(response.status).toBe(200);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await response.arrayBuffer());
	return workbook;
}

/**
 * The words the PDF draws, as one searchable string — the read the PDF suites
 * share (`deck-pdf.test-support.ts`).
 */
async function pdfText(deck: AnyJson): Promise<string> {
	const response = await authed(
		`/api/presentations/${deck.id}/deck.pdf`,
		deck.creatorToken,
	);
	expect(response.status).toBe(200);
	return (await drawnRuns(new Uint8Array(await response.arrayBuffer()))).join("\n");
}

// ── The room's socket ────────────────────────────────────────

interface Envelope {
	event: string;
	data: AnyJson;
}

/** Open a socket, join a room, and buffer every envelope it receives. */
async function joinRoom(presentationId: string): Promise<{
	received: Envelope[];
	frameAfter: (
		since: number,
		matches: (envelope: Envelope) => boolean,
		timeoutMs?: number,
	) => Promise<Envelope>;
	close: () => Promise<void>;
}> {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	const listeners: Array<() => void> = [];
	socket.addEventListener("message", (event) => {
		try {
			const raw = (event as MessageEvent).data;
			received.push(
				JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)),
			);
			for (const listener of [...listeners]) listener();
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
	// Let the join land before anything is broadcast at the room.
	await new Promise((resolve) => setTimeout(resolve, 50));

	/** The first envelope received at or after `since` that `matches`. */
	function frameAfter(
		since: number,
		matches: (envelope: Envelope) => boolean,
		timeoutMs = 3000,
	): Promise<Envelope> {
		const find = () => received.slice(since).find(matches);
		const existing = find();
		if (existing) return Promise.resolve(existing);
		return new Promise<Envelope>((resolve, reject) => {
			const listener = () => {
				const found = find();
				if (!found) return;
				clearTimeout(timer);
				listeners.splice(listeners.indexOf(listener), 1);
				resolve(found);
			};
			const timer = setTimeout(() => {
				listeners.splice(listeners.indexOf(listener), 1);
				reject(new Error("Timed out waiting for a matching frame"));
			}, timeoutMs);
			listeners.push(listener);
		});
	}

	async function close() {
		socket.close();
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	return { received, frameAfter, close };
}

/** Whether an envelope is a word cloud's recounted tally. */
const isCloudTally = (envelope: Envelope) =>
	envelope.event === "results.updated" && envelope.data?.slideId === "wc";

describe("Profanity filter on free text (REQ085)", () => {
	beforeAll(async () => {
		// Load server modules AFTER the environment above is set.
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

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
		collaboratorKey = await accountFor(COLLABORATOR_EMAIL, "Collaborator");
		strangerKey = await accountFor(STRANGER_EMAIL, "Stranger");
	});

	afterAll(async () => {
		await server?.stop();
		// Switching the filter recounts every free-text slide through the
		// coalesced tally broadcast, and the last tests here do exactly that: drop
		// any window still open behind them rather than let it fire into a stopped
		// server — or into whichever suite this process runs next.
		const { resetStandingsBroadcasts, resetTallyBroadcasts } = await import(
			"./services/presentations"
		);
		resetStandingsBroadcasts();
		resetTallyBroadcasts();
		if (process.env.OMUL_AUTH_DB) {
			rmSync(join(process.env.OMUL_AUTH_DB, ".."), {
				recursive: true,
				force: true,
			});
		}
	});

	// ── Off by default ───────────────────────────────────────

	test("off by default: a deck that never turned it on puts every answer on the wall as written", async () => {
		const deck = await create();
		expect(deck.profanityFilterEnabled).toBe(false);
		expect(deck.profanityFilterLanguage).toBeNull();
		await authed(`/api/presentations/${deck.id}/start`, deck.creatorToken, {
			method: "POST",
		});
		for (const value of [...PROFANE, ...CLEAN]) await answer(deck, "wc", value);

		const cloud = await tally(deck, "wc", { token: deck.creatorToken, include: true });
		const words = cloud.words.map((word: AnyJson) => word.text);
		for (const value of PROFANE) expect(words).toContain(value.toLowerCase());
		expect(cloud.totalVotes).toBe(PROFANE.length + CLEAN.length);
		expect(cloud.answers).toHaveLength(PROFANE.length + CLEAN.length);
		// Off is stated as off, not as "it withheld nothing".
		expect(cloud.filteredCount).toBeNull();
		expect(cloud.filteredAnswers).toBeNull();
	});

	// ── Authoring the setting ────────────────────────────────

	test("a create carries the setting, and every read of the deck reports it", async () => {
		const deck = await create({
			profanityFilterEnabled: true,
			profanityFilterLanguage: "de",
		});
		expect(deck.profanityFilterEnabled).toBe(true);
		expect(deck.profanityFilterLanguage).toBe("de");
		const publicRead = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(publicRead.profanityFilterEnabled).toBe(true);
		expect(publicRead.profanityFilterLanguage).toBe("de");
		const joined = await (await fetch(`${baseUrl}/api/join/${deck.code}`)).json();
		expect(joined.profanityFilterEnabled).toBe(true);
	});

	test("a create naming a list that is not one of the seven languages is refused", async () => {
		const response = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Bad list",
				slides: DECK,
				profanityFilterEnabled: true,
				profanityFilterLanguage: "ja",
			}),
		});
		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(response.status).toBeLessThan(500);
	});

	test("the setting is an edit: the token and the owner may change it, nobody else", async () => {
		const created = await asAccount("/api/presentations", ownerKey, {
			method: "POST",
			body: JSON.stringify({ title: "Owned", slides: DECK }),
		});
		expect(created.status).toBe(201);
		const deck = await created.json();
		const shared = await asAccount(
			`/api/presentations/${deck.id}/collaborators`,
			ownerKey,
			{
				method: "POST",
				body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "view" }),
			},
		);
		expect([200, 201]).toContain(shared.status);
		const turnOn = JSON.stringify({ profanityFilterEnabled: true });
		const patch = (init: RequestInit) =>
			fetch(`${baseUrl}/api/presentations/${deck.id}`, {
				method: "PATCH",
				...init,
				headers: { "Content-Type": "application/json", ...(init.headers || {}) },
			});

		// No credential at all.
		expect((await patch({ body: turnOn })).status).toBe(401);
		// A wrong edit token.
		expect(
			(await patch({ body: turnOn, headers: { Authorization: "Bearer nope" } }))
				.status,
		).toBe(401);
		// A signed-in stranger, and a collaborator whose level opens no edit.
		expect(
			(await patch({ body: turnOn, headers: { "x-api-key": strangerKey } }))
				.status,
		).toBe(403);
		expect(
			(await patch({ body: turnOn, headers: { "x-api-key": collaboratorKey } }))
				.status,
		).toBe(403);
		const unchanged = await (
			await fetch(`${baseUrl}/api/presentations/${deck.id}`)
		).json();
		expect(unchanged.profanityFilterEnabled).toBe(false);

		// The owner.
		const byOwner = await patch({
			body: JSON.stringify({
				profanityFilterEnabled: true,
				profanityFilterLanguage: "fr",
			}),
			headers: { "x-api-key": ownerKey },
		});
		expect(byOwner.status).toBe(200);
		const owned = await byOwner.json();
		expect(owned.profanityFilterEnabled).toBe(true);
		expect(owned.profanityFilterLanguage).toBe("fr");

		// And an anonymous deck's edit token.
		const anonymous = await create();
		const byToken = await authed(
			`/api/presentations/${anonymous.id}`,
			anonymous.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({ profanityFilterEnabled: true }),
			},
		);
		expect(byToken.status).toBe(200);
		expect((await byToken.json()).profanityFilterEnabled).toBe(true);
	});

	test("a PATCH naming a list outside the seven is refused and writes nothing", async () => {
		const deck = await create({ profanityFilterEnabled: true });
		const refused = await authed(
			`/api/presentations/${deck.id}`,
			deck.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({ profanityFilterLanguage: "klingon" }),
			},
		);
		expect(refused.status).toBe(422);
		const read = await (await fetch(`${baseUrl}/api/presentations/${deck.id}`)).json();
		expect(read.profanityFilterLanguage).toBeNull();
	});

	test("the results reads refuse a `filtered` that is neither word", async () => {
		const deck = await create();
		for (const path of ["/results", "/results/wc"]) {
			const response = await authed(
				`/api/presentations/${deck.id}${path}?filtered=yes`,
				deck.creatorToken,
			);
			expect([path, response.status]).toEqual([path, 422]);
		}
	});

	// ── A word cloud ─────────────────────────────────────────

	test("a word cloud withholds a matched answer from every reader, the presenter's own poll included", async () => {
		const deck = await liveFilteredDeck();
		for (const value of [...PROFANE, ...CLEAN]) await answer(deck, "wc", value);

		for (const reader of [
			{ name: "anonymous", options: {} },
			{ name: "anonymous asking", options: { include: true } },
			{ name: "the presenter's poll", options: { token: deck.creatorToken } },
		]) {
			const cloud = await tally(deck, "wc", reader.options);
			expect([reader.name, cloud.words]).toEqual([
				reader.name,
				[
					{ text: "pizza", count: 2 },
					{ text: "scunthorpe", count: 1 },
					{ text: "a classic", count: 1 },
				],
			]);
			// Every answer that arrived is still counted, and the cloud says how many
			// of them it does not draw.
			expect(cloud.totalVotes).toBe(PROFANE.length + CLEAN.length);
			expect(cloud.filteredCount).toBe(PROFANE.length);
			expect(cloud.filteredAnswers).toBeNull();
			expectNothingWithheld(cloud);
		}

		// The editor's per-answer list (REQ027) is drawn under the cloud on the
		// projector, so it lists only what the room may see.
		const polled = await tally(deck, "wc", { token: deck.creatorToken });
		expect(polled.answers.map((row: AnyJson) => row.text).sort()).toEqual(
			[...CLEAN].sort(),
		);

		// Asking, as the editor, adds the withheld answers exactly as written.
		const surface = await tally(deck, "wc", {
			token: deck.creatorToken,
			include: true,
		});
		expect(surface.words).toEqual(polled.words);
		expect(
			surface.filteredAnswers.map((row: AnyJson) => row.text).sort(),
		).toEqual([...PROFANE].sort());
		for (const row of surface.filteredAnswers) {
			expect(Object.keys(row).sort()).toEqual(["createdAt", "id", "text"]);
			expect(typeof row.id).toBe("string");
			expect(Date.parse(row.createdAt)).not.toBeNaN();
		}
	});

	test("the deck's results link reads the filtered tally and never the withheld words", async () => {
		const deck = await liveFilteredDeck();
		for (const value of [...PROFANE, ...CLEAN]) await answer(deck, "wc", value);
		const minted = await authed(
			`/api/presentations/${deck.id}/results-link`,
			deck.creatorToken,
			{ method: "POST" },
		);
		expect(minted.status).toBe(201);
		const { resultsToken } = await minted.json();

		const linked = await tally(deck, "wc", { resultsToken, include: true });
		expect(linked.filteredCount).toBe(PROFANE.length);
		expect(linked.filteredAnswers).toBeNull();
		expectNothingWithheld(linked);

		const whole = await fetch(
			`${baseUrl}/api/presentations/${deck.id}/results?filtered=include`,
			{ headers: { "x-omul-results-token": resultsToken } },
		);
		expect(whole.status).toBe(200);
		expectNothingWithheld(await whole.json());
	});

	test("the withheld words are an authoring read: a collaborator reads them, a stranger does not", async () => {
		const created = await asAccount("/api/presentations", ownerKey, {
			method: "POST",
			body: JSON.stringify({
				title: "Owned and filtering",
				slides: DECK,
				profanityFilterEnabled: true,
			}),
		});
		const deck = await created.json();
		await asAccount(`/api/presentations/${deck.id}/collaborators`, ownerKey, {
			method: "POST",
			body: JSON.stringify({ email: COLLABORATOR_EMAIL, level: "view" }),
		});
		await asAccount(`/api/presentations/${deck.id}/start`, ownerKey, {
			method: "POST",
		});
		await answer(deck, "wc", "motherfucker");
		await answer(deck, "wc", "Pizza");

		const byOwner = await tally(deck, "wc", { key: ownerKey, include: true });
		expect(byOwner.filteredAnswers.map((row: AnyJson) => row.text)).toEqual([
			"motherfucker",
		]);
		const byCollaborator = await tally(deck, "wc", {
			key: collaboratorKey,
			include: true,
		});
		expect(byCollaborator.filteredAnswers.map((row: AnyJson) => row.text)).toEqual([
			"motherfucker",
		]);
		const byStranger = await tally(deck, "wc", { key: strangerKey, include: true });
		expect(byStranger.filteredAnswers).toBeNull();
		expect(byStranger.filteredCount).toBe(1);
		expectNothingWithheld(byStranger);
	});

	// ── An open-ended slide ──────────────────────────────────

	test("an open-ended slide withholds a matched response, and its id with it", async () => {
		const deck = await liveFilteredDeck();
		const withheldIds: string[] = [];
		for (const value of PROFANE) withheldIds.push((await answer(deck, "oe", value)).id);
		for (const value of CLEAN) await answer(deck, "oe", value);

		const publicWall = await tally(deck, "oe");
		expect(publicWall.responses.map((row: AnyJson) => row.text).sort()).toEqual(
			[...CLEAN].sort(),
		);
		expect(publicWall.totalVotes).toBe(PROFANE.length + CLEAN.length);
		expect(publicWall.filteredCount).toBe(PROFANE.length);
		expectNothingWithheld(publicWall);
		for (const id of withheldIds) {
			expect(JSON.stringify(publicWall)).not.toContain(id);
		}

		const polled = await tally(deck, "oe", { token: deck.creatorToken });
		expect(polled.responses).toEqual(publicWall.responses);
		expect(polled.filteredAnswers).toBeNull();

		const surface = await tally(deck, "oe", {
			token: deck.creatorToken,
			include: true,
		});
		expect(surface.filteredAnswers.map((row: AnyJson) => row.id).sort()).toEqual(
			[...withheldIds].sort(),
		);
	});

	// ── A typed quiz answer ──────────────────────────────────

	test("a typed quiz answer is withheld from the tally and still scored", async () => {
		const deck = await liveFilteredDeck();
		await answer(deck, "qz", "Paris");
		await answer(deck, "qz", "paris");
		await answer(deck, "qz", "fucking Paris");

		const polled = await tally(deck, "qz", { token: deck.creatorToken });
		expect(polled.typedAnswers.entries).toEqual([
			{ text: "Paris", count: 2, isCorrect: true },
		]);
		expect(polled.typedAnswers.filteredCount).toBe(1);
		expect(polled.typedAnswers.filteredAnswers).toBeNull();
		// The filter decides what the screen shows, never who was right.
		expect(polled.respondentCount).toBe(3);
		expect(polled.scoring.answeredCount).toBe(3);
		expect(polled.scoring.correctCount).toBe(2);
		expect(JSON.stringify(polled).toLowerCase()).not.toContain("fucking");

		const surface = await tally(deck, "qz", {
			token: deck.creatorToken,
			include: true,
		});
		expect(
			surface.typedAnswers.filteredAnswers.map((row: AnyJson) => row.text),
		).toEqual(["fucking Paris"]);

		// Once the deck ends the room reads the entries — still without it.
		await authed(`/api/presentations/${deck.id}/end`, deck.creatorToken, {
			method: "POST",
		});
		const afterwards = await tally(deck, "qz");
		expect(afterwards.typedAnswers.entries).toEqual(polled.typedAnswers.entries);
		expect(afterwards.typedAnswers.filteredCount).toBe(1);
		expect(JSON.stringify(afterwards).toLowerCase()).not.toContain("fucking");
	});

	test("a choice slide's answers are not free text, and the filter leaves its tally alone", async () => {
		const deck = await liveFilteredDeck();
		await answer(deck, "team", "eng");
		const choice = await tally(deck, "team", {
			token: deck.creatorToken,
			include: true,
		});
		expect("filteredCount" in choice).toBe(false);
		expect(choice.options[0].count).toBe(1);
	});

	// ── Which list ───────────────────────────────────────────

	test("the deck's language chooses the list until one is chosen by name", async () => {
		const deck = await liveFilteredDeck({ language: "de" });
		await answer(deck, "wc", "Arschloch");
		await answer(deck, "wc", "wanker");
		await answer(deck, "wc", "connard");
		const shown = async () =>
			(await tally(deck, "wc")).words.map((word: AnyJson) => word.text).sort();
		const patch = (changes: AnyJson) =>
			authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify(changes),
			});

		// German, from the deck's language.
		expect(await shown()).toEqual(["connard", "wanker"]);
		// English, chosen by name.
		expect((await patch({ profanityFilterLanguage: "en" })).status).toBe(200);
		expect(await shown()).toEqual(["arschloch", "connard"]);
		// A chosen list stands when the deck's language moves…
		expect((await patch({ language: "fr" })).status).toBe(200);
		expect(await shown()).toEqual(["arschloch", "connard"]);
		// …and following the deck again picks up the French one.
		expect((await patch({ profanityFilterLanguage: null })).status).toBe(200);
		expect(await shown()).toEqual(["arschloch", "wanker"]);
	});

	test("matching ignores case and accents, and reads whole words only", async () => {
		const deck = await liveFilteredDeck({ language: "fr" });
		for (const value of ["ENCULÉ", "encule", "d'enculé", "un cul-de-sac", "la chatte"]) {
			await answer(deck, "wc", value);
		}
		const cloud = await tally(deck, "wc");
		expect(cloud.filteredCount).toBe(3);
		expect(cloud.words.map((word: AnyJson) => word.text).sort()).toEqual([
			"la chatte",
			"un cul-de-sac",
		]);
	});

	// ── The live room ────────────────────────────────────────

	test("no frame the room receives carries a withheld answer, and switching the filter re-sends the tally", async () => {
		const deck = await create();
		await authed(`/api/presentations/${deck.id}/start`, deck.creatorToken, {
			method: "POST",
		});
		const room = await joinRoom(deck.id);
		try {
			// Off: the answer is on the wall as written, as it always was.
			let since = room.received.length;
			await answer(deck, "wc", "motherfucker");
			const unfiltered = await room.frameAfter(since, isCloudTally);
			expect(unfiltered.data.results.words).toEqual([
				{ text: "motherfucker", count: 1 },
			]);

			// Switched on: the recount reaches the room with no new answer needed.
			since = room.received.length;
			const switchedOn = await authed(
				`/api/presentations/${deck.id}`,
				deck.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ profanityFilterEnabled: true }) },
			);
			expect(switchedOn.status).toBe(200);
			const recounted = await room.frameAfter(
				since,
				(envelope) =>
					isCloudTally(envelope) && envelope.data.results.filteredCount === 1,
			);
			expect(recounted.data.results.words).toEqual([]);
			expect(recounted.data.results.filteredAnswers).toBeNull();
			expectNothingWithheld(recounted);

			// While on, an answer landing is broadcast without it.
			since = room.received.length;
			await answer(deck, "wc", "Shit happens");
			await answer(deck, "wc", "Pizza");
			await room.frameAfter(
				since,
				(envelope) =>
					isCloudTally(envelope) &&
					envelope.data.results.words.some(
						(word: AnyJson) => word.text === "pizza",
					),
			);
			for (const envelope of room.received.slice(since)) {
				expectNothingWithheld(envelope);
			}

			// Switched off: the withheld answers come back without anybody reloading.
			since = room.received.length;
			await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify({ profanityFilterEnabled: false }),
			});
			const restored = await room.frameAfter(
				since,
				(envelope) =>
					isCloudTally(envelope) &&
					envelope.data.results.filteredCount === null,
			);
			expect(
				restored.data.results.words.map((word: AnyJson) => word.text).sort(),
			).toEqual(["motherfucker", "pizza", "shit happens"]);
		} finally {
			await room.close();
		}
	});

	test("a save that leaves the list in force where it was re-sends nothing", async () => {
		const deck = await liveFilteredDeck({ profanityFilterLanguage: "en" });
		// On the English list and not on the German one, so moving the list shows.
		await answer(deck, "wc", "wanker");
		const room = await joinRoom(deck.id);
		try {
			const save = (changes: AnyJson) =>
				authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
					method: "PATCH",
					body: JSON.stringify(changes),
				});
			const since = room.received.length;
			// What the editor's Save sends every time: every setting, unchanged.
			expect(
				(
					await save({
						title: "Renamed",
						language: "en",
						profanityFilterEnabled: true,
						profanityFilterLanguage: "en",
					})
				).status,
			).toBe(200);
			// A language change while a list is chosen by name moves nothing either.
			expect((await save({ language: "de" })).status).toBe(200);
			// A recount is sent before the PATCH answers, so a quiet moment after the
			// last response is enough to know none was.
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(room.received.slice(since).filter(isCloudTally)).toEqual([]);

			// And moving the list does send one.
			expect((await save({ profanityFilterLanguage: null })).status).toBe(200);
			const recounted = await room.frameAfter(since, isCloudTally);
			// The German list does not name the English insult, so it is back.
			expect(recounted.data.results.words).toEqual([{ text: "wanker", count: 1 }]);
		} finally {
			await room.close();
		}
	});

	test("moving the deck's language re-sends the tally while the filter follows it", async () => {
		const deck = await liveFilteredDeck({ language: "en" });
		await answer(deck, "wc", "Arschloch");
		const room = await joinRoom(deck.id);
		try {
			const since = room.received.length;
			await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
				method: "PATCH",
				body: JSON.stringify({ language: "de" }),
			});
			const recounted = await room.frameAfter(
				since,
				(envelope) =>
					isCloudTally(envelope) && envelope.data.results.filteredCount === 1,
			);
			expect(recounted.data.results.words).toEqual([]);
		} finally {
			await room.close();
		}
	});

	// ── Moderation and the other reads ───────────────────────

	test("a withheld answer can still be taken down by the id the results surface names", async () => {
		const deck = await liveFilteredDeck();
		await answer(deck, "wc", "motherfucker");
		await answer(deck, "wc", "Pizza");
		const surface = await tally(deck, "wc", {
			token: deck.creatorToken,
			include: true,
		});
		const [withheld] = surface.filteredAnswers;
		const removed = await authed(
			`/api/presentations/${deck.id}/answers/${withheld.id}`,
			deck.creatorToken,
			{ method: "DELETE" },
		);
		expect(removed.status).toBe(200);
		const after = await tally(deck, "wc", { token: deck.creatorToken, include: true });
		expect(after.filteredCount).toBe(0);
		expect(after.filteredAnswers).toEqual([]);
		expect(after.totalVotes).toBe(1);
	});

	test("an editor's segmented breakdown and the preview read through the same filter", async () => {
		const deck = await liveFilteredDeck();
		for (const team of ["eng", "eng", "ops"]) {
			participantCounter += 1;
			const participantId = `segment-${participantCounter}`;
			for (const [slideId, value] of [
				["team", team],
				["wc", team === "ops" ? "motherfucker" : "Pizza"],
			]) {
				const voted = await fetch(`${baseUrl}/api/presentations/${deck.id}/vote`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ slideId, value, participantId }),
				});
				expect(voted.status).toBe(200);
			}
		}
		const segmented = await authed(
			`/api/presentations/${deck.id}/results/wc/segments?by=team`,
			deck.creatorToken,
		);
		expect(segmented.status).toBe(200);
		const breakdown = await segmented.json();
		const ops = breakdown.segments.find((segment: AnyJson) => segment.key === "ops");
		expect(ops.results.words).toEqual([]);
		expect(ops.results.filteredCount).toBe(1);
		expectNothingWithheld(breakdown);

		const preview = await authed(
			`/api/presentations/${deck.id}/preview?respondents=8`,
			deck.creatorToken,
		);
		expect(preview.status).toBe(200);
		const cloud = (await preview.json()).slides.find(
			(slide: AnyJson) => slide.slideId === "wc",
		);
		expect(typeof cloud.presenterResults.filteredCount).toBe("number");
		expect(typeof cloud.audienceResults.filteredCount).toBe("number");
		expect(cloud.presenterResults.filteredAnswers).toBeNull();
	});

	// ── Exports ──────────────────────────────────────────────

	test("the spreadsheet marks every withheld row and counts them under the tally", async () => {
		const deck = await liveFilteredDeck();
		await answer(deck, "team", "eng");
		for (const value of ["motherfucker", "Pizza"]) await answer(deck, "wc", value);
		await answer(deck, "oe", "Shit happens");
		await answer(deck, "qz", "fucking Paris");
		await answer(deck, "qz", "Paris");

		const workbook = await workbookOf(deck);
		const responses = rowsOf(workbook, "Responses");
		const markOf = (text: string) =>
			responses.find((row) => row.Answer === text)?.Filtered;
		// The raw words are in the file, beside the mark that says the room never saw them.
		expect(markOf("motherfucker")).toBe(true);
		expect(markOf("Shit happens")).toBe(true);
		expect(markOf("fucking Paris")).toBe(true);
		expect(markOf("Pizza")).toBe(false);
		expect(markOf("Paris")).toBe(false);
		// A choice is not free text: the filter never read it, and the cell says so.
		expect(responses.find((row) => row["Slide ID"] === "team")?.Filtered).toBeNull();

		const aggregates = rowsOf(workbook, "Aggregates");
		const withheld = (slideNumber: number) =>
			aggregates.find(
				(row) =>
					row["Slide #"] === slideNumber &&
					row.Metric === "Withheld by profanity filter",
			)?.Value;
		expect(withheld(2)).toBe(1);
		expect(withheld(3)).toBe(1);
		expect(withheld(4)).toBe(1);
		expect(
			aggregates.some(
				(row) => row.Entry === "motherfucker" || row.Entry === "Shit happens",
			),
		).toBe(false);

		const summary = Object.fromEntries(
			rowsOf(workbook, "Summary").map((row) => [String(row.Field), row.Value]),
		);
		expect(summary["Profanity filter"]).toBe(true);
		expect(summary["Profanity filter list"]).toBe("en");
	});

	test("with the filter off the spreadsheet's mark column is empty and nothing is counted", async () => {
		const deck = await create();
		await authed(`/api/presentations/${deck.id}/start`, deck.creatorToken, {
			method: "POST",
		});
		await answer(deck, "wc", "motherfucker");
		const workbook = await workbookOf(deck);
		const responses = rowsOf(workbook, "Responses");
		expect(responses.map((row) => row.Filtered)).toEqual([null]);
		expect(
			rowsOf(workbook, "Aggregates").some(
				(row) => row.Metric === "Withheld by profanity filter",
			),
		).toBe(false);
		const summary = Object.fromEntries(
			rowsOf(workbook, "Summary").map((row) => [String(row.Field), row.Value]),
		);
		expect(summary["Profanity filter"]).toBe(false);
		expect(summary["Profanity filter list"]).toBeNull();
	});

	test("the PDF prints the withheld answers, marked, under the tally the room saw", async () => {
		const deck = await liveFilteredDeck();
		for (const value of ["motherfucker", "Pizza"]) await answer(deck, "wc", value);
		// One string, whitespace collapsed, so a line the layout wrapped still reads whole.
		const text = (await pdfText(deck)).replace(/\s+/g, " ");
		expect(text).toContain("Withheld by profanity filter");
		// Section labels are drawn in capitals.
		expect(text).toContain("WITHHELD FROM THE ROOM BY THE PROFANITY FILTER");
		expect(text).toContain("motherfucker");
		// The tally above it is the room's: the withheld word is not one of its bars.
		expect(text.indexOf("motherfucker")).toBeGreaterThan(
			text.indexOf("WITHHELD FROM THE ROOM"),
		);
	});

	// ── A deck stored before the fields existed ──────────────

	test("a deck stored before REQ085 reads back with the filter off, and filters after an ordinary edit", async () => {
		const deck = await create();
		const { createStore } = await import("./db");
		const { StoredPresentationSchema } = await import("./schemas");
		// The collection as every build before REQ085 opened it. A row it writes has
		// neither key — the state every deck on disk was in the day this shipped.
		const preFilterStore = createStore(
			"presentations",
			StoredPresentationSchema.omit({
				profanityFilterEnabled: true,
				profanityFilterLanguage: true,
			}),
		);
		await preFilterStore.update(deck.id, {});
		const rawStore = createStore(
			"presentations",
			z.object({ id: z.string() }).passthrough(),
		);
		const onDisk = (await rawStore.findOne(deck.id)) as AnyJson;
		expect("profanityFilterEnabled" in onDisk).toBe(false);
		expect("profanityFilterLanguage" in onDisk).toBe(false);

		// Every read fills the defaults in: off, following the deck's language.
		const read = await (await fetch(`${baseUrl}/api/presentations/${deck.id}`)).json();
		expect(read.profanityFilterEnabled).toBe(false);
		expect(read.profanityFilterLanguage).toBeNull();
		await authed(`/api/presentations/${deck.id}/start`, deck.creatorToken, {
			method: "POST",
		});
		await answer(deck, "wc", "motherfucker");
		expect((await tally(deck, "wc")).filteredCount).toBeNull();

		// And an ordinary edit switches it on — nothing to migrate first.
		const patch = await authed(`/api/presentations/${deck.id}`, deck.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ profanityFilterEnabled: true }),
		});
		expect(patch.status).toBe(200);
		const filtered = await tally(deck, "wc");
		expect(filtered.filteredCount).toBe(1);
		expectNothingWithheld(filtered);
		expect(((await rawStore.findOne(deck.id)) as AnyJson).profanityFilterEnabled).toBe(
			true,
		);
	});
});
