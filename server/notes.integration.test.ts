/**
 * Integration tests for presenter notes (REQ090).
 *
 * One thing is under test and it is a boundary, not a feature: a slide's notes
 * are the organizer's own script, and **no payload that leaves for somebody who
 * cannot edit the deck may carry them**. Suppressing them in a renderer would
 * not be enough — what a client holds, a client can read out of the network tab
 * — so every channel a note could ride is asked here directly:
 *
 *   - the deck fetch, with the edit token and without it;
 *   - the join payload, which is the participants' door and is never an editor;
 *   - the public list;
 *   - the `slide.changed` WebSocket broadcast, which every socket in the room
 *     receives whatever role it claimed on join;
 *   - the results endpoints and the spreadsheet export (REQ095), which carry no
 *     notes column at all.
 *
 * And the other half of the requirement, which the withholding is worthless
 * without: the caller who *can* edit the deck gets the text back verbatim, on
 * the fetch the editor and the presenter screen actually make.
 *
 * Runs the real Elysia app — routes and WebSocket — against a throw-away
 * in-memory zodstore, like the harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";

let connectDb: () => Promise<void>;

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void>; port: number } | null = null;

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

/** The note under test — distinctive enough to grep a whole workbook for. */
const NOTE = "Cue: pause, then ask the room about the Q3 dip.";
const SECOND_NOTE = "Read the number off the slide, not from memory.";

const DECK: AnyJson[] = [
	{
		id: "mc",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "mc-a", text: "Weekly" },
			{ id: "mc-b", text: "Monthly" },
		],
		notes: NOTE,
	},
	{
		id: "wc",
		type: "word-cloud",
		question: "One word for this quarter",
		notes: SECOND_NOTE,
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
		body: JSON.stringify({ title: "Notes Test", slides }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

/** The notes on every slide of a deck payload, in deck order. */
function notesOf(presentation: AnyJson): string[] {
	return (presentation.slides as AnyJson[]).map((slide) => slide.notes);
}

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

describe("Presenter notes (REQ090)", () => {
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

	// ── The half that makes the feature a feature ─────────

	test("the create response hands the author their own notes back", async () => {
		const presentation = await create();
		expect(notesOf(presentation)).toEqual([NOTE, SECOND_NOTE]);
	});

	test("a caller holding the edit token reads the notes in full", async () => {
		const presentation = await create();
		const response = await authed(
			`/api/presentations/${presentation.id}`,
			presentation.creatorToken,
		);
		expect(response.status).toBe(200);
		expect(notesOf(await response.json())).toEqual([NOTE, SECOND_NOTE]);
	});

	test("notes survive an edit and come back byte for byte", async () => {
		const presentation = await create();
		const edited = "# Timing\n\n- 30s here\n- then **advance**";
		const patch = await authed(
			`/api/presentations/${presentation.id}`,
			presentation.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						{ ...DECK[0], notes: edited },
						{ ...DECK[1], notes: "" },
					],
				}),
			},
		);
		expect(patch.status).toBe(200);
		expect(notesOf(await patch.json())).toEqual([edited, ""]);
	});

	test("a slide authored without notes carries an empty string, not a missing key", async () => {
		// The field is always there, so no client reaches for `??` and a
		// noted slide and an un-noted one are the same shape.
		const presentation = await create([
			{ id: "plain", type: "word-cloud", question: "One word?" },
		]);
		const slide = presentation.slides[0];
		expect("notes" in slide).toBe(true);
		expect(slide.notes).toBe("");
	});

	// ── The half the requirement is actually about ────────

	test("the deck fetch without a credential carries no notes", async () => {
		const presentation = await create();
		const response = await fetch(
			`${baseUrl}/api/presentations/${presentation.id}`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(notesOf(body)).toEqual(["", ""]);
		// Not merely absent from the field it belongs in: the text is nowhere in
		// the payload at all.
		expect(JSON.stringify(body)).not.toContain("Cue:");
	});

	test("a wrong token is treated as no credential at all", async () => {
		const presentation = await create();
		const response = await authed(
			`/api/presentations/${presentation.id}`,
			"not-the-token",
		);
		expect(response.status).toBe(200);
		expect(notesOf(await response.json())).toEqual(["", ""]);
	});

	test("the join payload never carries notes — whoever asks", async () => {
		const presentation = await create();
		// Even holding the edit token: an organizer opening their own join link is
		// in the room as a participant, and this door hands out one deck.
		const withToken = {
			headers: { Authorization: `Bearer ${presentation.creatorToken}` },
		};
		for (const init of [{}, withToken]) {
			const response = await fetch(
				`${baseUrl}/api/join/${presentation.code}`,
				init,
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(notesOf(body)).toEqual(["", ""]);
			expect(JSON.stringify(body)).not.toContain("Cue:");
		}
	});

	test("ending the presentation is not a reveal for a note", async () => {
		// A withheld answer key comes back when the deck ends (REQ056). A note has
		// no such moment: it is never the room's to read.
		const presentation = await create();
		await authed(
			`/api/presentations/${presentation.id}/start`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		await authed(
			`/api/presentations/${presentation.id}/end`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		const response = await fetch(
			`${baseUrl}/api/join/${presentation.code}`,
		);
		expect(notesOf(await response.json())).toEqual(["", ""]);
	});

	test("the public list carries no notes", async () => {
		await create();
		const response = await fetch(`${baseUrl}/api/presentations`);
		expect(response.status).toBe(200);
		const list = (await response.json()) as AnyJson[];
		expect(list.length).toBeGreaterThan(0);
		expect(JSON.stringify(list)).not.toContain("Cue:");
	});

	test("the slide.changed broadcast carries no notes — for any socket", async () => {
		const presentation = await create();
		await authed(
			`/api/presentations/${presentation.id}/start`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		// Both roles, because `role` is whatever the socket said it was: a frame is
		// read by every client in the room, so it may only ever carry what the
		// audience may see.
		const participant = await joinRoom(presentation.id, "participant");
		const presenter = await joinRoom(presentation.id, "presenter");

		const navigated = await authed(
			`/api/presentations/${presentation.id}/slide`,
			presentation.creatorToken,
			{ method: "POST", body: JSON.stringify({ index: 1 }) },
		);
		expect(navigated.status).toBe(200);
		// The navigating organizer's own response still carries what they authored.
		expect(notesOf(await navigated.json())).toEqual([NOTE, SECOND_NOTE]);

		for (const socket of [participant, presenter]) {
			const envelope = await socket.waitFor("slide.changed");
			expect(envelope.data.slide.id).toBe("wc");
			expect(envelope.data.slide.notes).toBe("");
			expect(JSON.stringify(envelope.data)).not.toContain("Read the number");
			await socket.close();
		}
	});

	test("no results payload carries notes", async () => {
		const presentation = await create();
		for (const path of [
			`/api/presentations/${presentation.id}/results`,
			`/api/presentations/${presentation.id}/results/mc`,
		]) {
			const response = await fetch(`${baseUrl}${path}`);
			expect(response.status).toBe(200);
			expect(JSON.stringify(await response.json())).not.toContain("Cue:");
		}
	});

	test("the spreadsheet export has no notes in any sheet (REQ095)", async () => {
		// The export is the organizer's own file, so this is not a leak to the room
		// — it is the requirement's third named surface, and a notes column would
		// put a private script into a file that gets forwarded.
		const presentation = await create();
		const response = await authed(
			`/api/presentations/${presentation.id}/results.xlsx`,
			presentation.creatorToken,
		);
		expect(response.status).toBe(200);
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(await response.arrayBuffer());

		const cells: string[] = [];
		workbook.eachSheet((sheet) => {
			sheet.eachRow((row) => {
				row.eachCell((cell) => cells.push(String(cell.value ?? "")));
			});
		});
		expect(cells.length).toBeGreaterThan(0);
		expect(cells.some((value) => value.includes("Cue:"))).toBe(false);
		expect(cells.some((value) => value.includes("Read the number"))).toBe(
			false,
		);
		// The questions themselves are there, so the assertion above is about the
		// notes rather than about an empty workbook.
		expect(cells.some((value) => value.includes("Which release train?"))).toBe(
			true,
		);
	});
});
