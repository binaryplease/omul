/**
 * Integration tests for a quiz's audio cue (REQ058).
 *
 * The cue plays on the presenter's screen and on no other, and the server's
 * half of that promise is a boundary, not a feature: **no payload that leaves
 * for somebody who cannot edit the deck may carry the track's address**. A
 * participant's phone that is never handed the address cannot load it, so every
 * channel the address could ride is asked here directly:
 *
 *   - the deck fetch — with the edit token, the owner's account and a `view`
 *     collaborator's (who read what was authored), and without a credential, with
 *     a wrong token and as a signed-in stranger (who read what the room reads);
 *   - the join payload, which is the participants' door and is never an editor's;
 *   - the public list;
 *   - the `slide.changed` WebSocket broadcast, which every socket in the room
 *     receives whatever role it claimed on join;
 *   - the results endpoints and the spreadsheet export, which carry no cue.
 *
 * And the other half, which the withholding is worthless without: writing a
 * cue is an edit like any other, so it is gated as one (owner, edit token or
 * `edit` collaborator — see docs/api.md), held to the URL ceiling, and a deck
 * stored before the field existed reads back with it empty and takes one
 * through an ordinary edit, with no migration.
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
import { z } from "zod";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-quiz-audio-")),
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

// Named so that none of them contains {@link ADDRESS_MARKER}: a payload that
// carried an account's email must not read as one carrying a track.
const OWNER_EMAIL = "audio-cue-owner@example.com";
const COLLABORATOR_EMAIL = "audio-cue-collaborator@example.com";
const STRANGER_EMAIL = "audio-cue-stranger@example.com";

/**
 * The two tracks under test. Both carry `req058-` in their path — a marker no
 * question, option or title below contains — so a payload can be searched for
 * either address as a whole, not only in the field it belongs in.
 */
const TRACK = "https://cdn.example.com/audio/req058-thinking-music.mp3";
const SECOND_TRACK = "/media/req058-countdown.ogg";
const ADDRESS_MARKER = "req058-";

const DECK: AnyJson[] = [
	{
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		timeLimit: 30,
		options: [
			{ id: "mercury", text: "Mercury", isCorrect: true },
			{ id: "venus", text: "Venus" },
		],
		quizAudioUrl: TRACK,
	},
	{
		id: "qz2",
		type: "quiz",
		question: "Which planet is the largest?",
		timeLimit: 0,
		options: [
			{ id: "jupiter", text: "Jupiter", isCorrect: true },
			{ id: "saturn", text: "Saturn" },
		],
		quizAudioUrl: SECOND_TRACK,
	},
	{ id: "wc", type: "word-cloud", question: "One word for this quiz" },
];

/** The cue on every slide of a deck payload, in deck order. */
function cuesOf(presentation: AnyJson): string[] {
	return (presentation.slides as AnyJson[]).map((slide) => slide.quizAudioUrl);
}

/** Assert a payload carries neither address, in any field. */
function expectNoAddress(payload: unknown) {
	expect(JSON.stringify(payload)).not.toContain(ADDRESS_MARKER);
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

/** An anonymous create: the deck comes back with its edit token. */
async function create(slides: AnyJson[] = DECK): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Quiz audio cue", slides }),
	});
	expect(response.status).toBe(201);
	return response.json();
}

/** A deck the owner account creates, shared with the collaborator at `view`. */
async function createOwnedSharedDeck(): Promise<AnyJson> {
	const created = await asAccount("/api/presentations", ownerKey, {
		method: "POST",
		body: JSON.stringify({ title: "Owned quiz", slides: DECK }),
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
	return deck;
}

/** The deck's slides with the first quiz's cue replaced. */
function withFirstCue(quizAudioUrl: string): AnyJson[] {
	return DECK.map((slide) =>
		slide.id === "qz" ? { ...slide, quizAudioUrl } : slide,
	);
}

/** Read a deck back as its author does. */
async function authoredDeck(presentation: AnyJson): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${presentation.id}`,
		presentation.creatorToken,
	);
	expect(response.status).toBe(200);
	return response.json();
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

	return { waitFor, close };
}

describe("Quiz audio cue (REQ058)", () => {
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
		if (process.env.OMUL_AUTH_DB) {
			rmSync(join(process.env.OMUL_AUTH_DB, ".."), {
				recursive: true,
				force: true,
			});
		}
	});

	// ── Authoring: the cue is an edit like any other ──────

	test("the create response hands the author the cue back", async () => {
		const presentation = await create();
		expect(cuesOf(presentation)).toEqual([TRACK, SECOND_TRACK, ""]);
	});

	test("a slide authored without a cue carries an empty string, not a missing key", async () => {
		const presentation = await create([
			{ id: "plain", type: "quiz", question: "No music", options: [] },
		]);
		const [slide] = presentation.slides;
		expect("quizAudioUrl" in slide).toBe(true);
		expect(slide.quizAudioUrl).toBe("");
	});

	test("the edit token sets, changes and clears a cue", async () => {
		const presentation = await create();
		for (const next of ["https://cdn.example.com/audio/req058-other.wav", ""]) {
			const patch = await authed(
				`/api/presentations/${presentation.id}`,
				presentation.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ slides: withFirstCue(next) }) },
			);
			expect(patch.status).toBe(200);
			expect(cuesOf(await patch.json())[0]).toBe(next);
			expect(cuesOf(await authoredDeck(presentation))[0]).toBe(next);
		}
	});

	test("an address past the URL ceiling is refused, and the cue that stood is kept", async () => {
		const presentation = await create();
		const tooLong = `https://cdn.example.com/${"a".repeat(2048)}.mp3`;
		const patch = await authed(
			`/api/presentations/${presentation.id}`,
			presentation.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ slides: withFirstCue(tooLong) }) },
		);
		expect(patch.status).toBe(422);
		expect(cuesOf(await authoredDeck(presentation))[0]).toBe(TRACK);

		// The same ceiling on the way in, on a create.
		const refusedCreate = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Too long", slides: withFirstCue(tooLong) }),
		});
		expect(refusedCreate.status).toBe(422);
	});

	test("a write with no credential is refused, and the cue stands", async () => {
		const presentation = await create();
		const patch = await fetch(`${baseUrl}/api/presentations/${presentation.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slides: withFirstCue("https://attacker.example/req058-loud.mp3"),
			}),
		});
		expect(patch.status).toBe(401);
		expect(cuesOf(await authoredDeck(presentation))[0]).toBe(TRACK);
	});

	test("a wrong edit token is refused like no credential at all", async () => {
		const presentation = await create();
		const patch = await authed(
			`/api/presentations/${presentation.id}`,
			"not-the-token",
			{ method: "PATCH", body: JSON.stringify({ slides: withFirstCue("") }) },
		);
		expect(patch.status).toBe(401);
		expect(cuesOf(await authoredDeck(presentation))[0]).toBe(TRACK);
	});

	test("a signed-in account with no standing on the deck is refused", async () => {
		const deck = await createOwnedSharedDeck();
		const patch = await asAccount(`/api/presentations/${deck.id}`, strangerKey, {
			method: "PATCH",
			body: JSON.stringify({ slides: withFirstCue("") }),
		});
		expect(patch.status).toBe(403);
		const ownerView = await (
			await asAccount(`/api/presentations/${deck.id}`, ownerKey)
		).json();
		expect(cuesOf(ownerView)[0]).toBe(TRACK);
	});

	test("the owner's account writes the cue without any token", async () => {
		const deck = await createOwnedSharedDeck();
		const patch = await asAccount(`/api/presentations/${deck.id}`, ownerKey, {
			method: "PATCH",
			body: JSON.stringify({ slides: withFirstCue(SECOND_TRACK) }),
		});
		expect(patch.status).toBe(200);
		expect(cuesOf(await patch.json())[0]).toBe(SECOND_TRACK);
	});

	test("a view collaborator reads the cue they were invited to see — and cannot change it", async () => {
		// A collaborator reads the deck as its author wrote it (REQ075): what their
		// level governs is what they may change, not a redacted copy.
		const deck = await createOwnedSharedDeck();
		const read = await asAccount(`/api/presentations/${deck.id}`, collaboratorKey);
		expect(read.status).toBe(200);
		expect(cuesOf(await read.json())).toEqual([TRACK, SECOND_TRACK, ""]);

		const patch = await asAccount(
			`/api/presentations/${deck.id}`,
			collaboratorKey,
			{ method: "PATCH", body: JSON.stringify({ slides: withFirstCue("") }) },
		);
		expect(patch.status).toBe(403);
		const ownerView = await (
			await asAccount(`/api/presentations/${deck.id}`, ownerKey)
		).json();
		expect(cuesOf(ownerView)[0]).toBe(TRACK);
	});

	// ── Reading: only an editor is handed the address ─────

	test("the deck fetch without a credential carries no cue — and no address anywhere", async () => {
		const presentation = await create();
		const response = await fetch(
			`${baseUrl}/api/presentations/${presentation.id}`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(cuesOf(body)).toEqual(["", "", ""]);
		expectNoAddress(body);
	});

	test("a wrong token reads what the room reads", async () => {
		const presentation = await create();
		const response = await authed(
			`/api/presentations/${presentation.id}`,
			"not-the-token",
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(cuesOf(body)).toEqual(["", "", ""]);
		expectNoAddress(body);
	});

	test("a signed-in stranger reads what the room reads", async () => {
		const deck = await createOwnedSharedDeck();
		const response = await asAccount(`/api/presentations/${deck.id}`, strangerKey);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(cuesOf(body)).toEqual(["", "", ""]);
		expectNoAddress(body);
	});

	test("the join payload never carries a cue — whoever asks", async () => {
		// Even holding the edit token or the owner's key: an organizer opening their
		// own join link is in the room as a participant, and this door hands out one
		// deck.
		const presentation = await create();
		const callers: Record<string, string>[] = [
			{},
			{ Authorization: `Bearer ${presentation.creatorToken}` },
			{ "x-api-key": ownerKey },
		];
		for (const headers of callers) {
			const response = await fetch(`${baseUrl}/api/join/${presentation.code}`, {
				headers,
			});
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(cuesOf(body)).toEqual(["", "", ""]);
			expectNoAddress(body);
		}
	});

	test("the public list carries no cue", async () => {
		await create();
		const response = await fetch(`${baseUrl}/api/presentations`);
		expect(response.status).toBe(200);
		const list = (await response.json()) as AnyJson[];
		expect(list.length).toBeGreaterThan(0);
		expectNoAddress(list);
	});

	test("the slide.changed broadcast carries no cue — for any socket", async () => {
		const presentation = await create();
		const started = await authed(
			`/api/presentations/${presentation.id}/start`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		expect(started.status).toBe(200);
		// The presenter's own response to going live carries what they authored:
		// it is what their screen plays the first question's cue from.
		expect(cuesOf(await started.json())).toEqual([TRACK, SECOND_TRACK, ""]);

		// Both roles, because `role` is whatever the socket said it was: a frame is
		// read by every client in the room, so it may only carry what the
		// audience may see.
		const participant = await joinRoom(presentation.id, "participant");
		const presenter = await joinRoom(presentation.id, "presenter");

		const navigated = await authed(
			`/api/presentations/${presentation.id}/slide`,
			presentation.creatorToken,
			{ method: "POST", body: JSON.stringify({ index: 1 }) },
		);
		expect(navigated.status).toBe(200);
		expect(cuesOf(await navigated.json())).toEqual([TRACK, SECOND_TRACK, ""]);

		for (const socket of [participant, presenter]) {
			const envelope = await socket.waitFor("slide.changed");
			expect(envelope.data.slide.id).toBe("qz2");
			expect(envelope.data.slide.quizAudioUrl).toBe("");
			expectNoAddress(envelope.data);
			await socket.close();
		}
	});

	test("the window closing, or the deck ending, is not a reveal for a cue", async () => {
		// An answer key comes back once its question is over (REQ056). A cue has no
		// such moment: it is never the room's to load.
		const presentation = await create();
		await authed(
			`/api/presentations/${presentation.id}/start`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		const closed = await authed(
			`/api/presentations/${presentation.id}/participation`,
			presentation.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz", open: false }) },
		);
		expect(closed.status).toBe(200);
		const whileClosed = await (
			await fetch(`${baseUrl}/api/join/${presentation.code}`)
		).json();
		expect(cuesOf(whileClosed)).toEqual(["", "", ""]);

		await authed(
			`/api/presentations/${presentation.id}/end`,
			presentation.creatorToken,
			{ method: "POST" },
		);
		const afterEnd = await (
			await fetch(`${baseUrl}/api/join/${presentation.code}`)
		).json();
		// The answer key is out now — and the cue still is not.
		expect(afterEnd.slides[0].options[0].isCorrect).toBe(true);
		expect(cuesOf(afterEnd)).toEqual(["", "", ""]);
		expectNoAddress(afterEnd);
	});

	test("no results payload carries a cue", async () => {
		const presentation = await create();
		for (const path of [
			`/api/presentations/${presentation.id}/results`,
			`/api/presentations/${presentation.id}/results/qz`,
		]) {
			const response = await fetch(`${baseUrl}${path}`);
			expect(response.status).toBe(200);
			expectNoAddress(await response.json());
		}
	});

	test("the spreadsheet export has no cue in any sheet (REQ095)", async () => {
		// The organizer's own file, so not a leak to the room — but a file that
		// gets forwarded, and a track's address is the presenter's business.
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
		// The questions are there, so the next assertion is about the cue rather
		// than about an empty workbook.
		expect(cells.some((value) => value.includes("closest to the sun"))).toBe(
			true,
		);
		expect(cells.some((value) => value.includes(ADDRESS_MARKER))).toBe(false);
	});

	// ── A deck stored before the field existed ────────────

	test("a deck stored before REQ058 reads back with an empty cue, and takes one with no migration", async () => {
		const presentation = await create(
			DECK.map(({ quizAudioUrl: _cue, ...slide }) => slide),
		);
		const { createStore } = await import("./db");
		const { SlideSchema, StoredPresentationSchema } = await import("./schemas");
		// The collection as every build before REQ058 opened it: a slide with no
		// `quizAudioUrl` in its shape. A row it writes has no such key at all —
		// which is the state every deck on disk was in the day this shipped.
		const preCueStore = createStore(
			"presentations",
			StoredPresentationSchema.extend({
				slides: z.array(SlideSchema.omit({ quizAudioUrl: true })).default([]),
			}),
		);
		await preCueStore.update(presentation.id, {});
		// What is on disk, read with no schema to fill anything in.
		const rawStore = createStore(
			"presentations",
			z.object({ id: z.string() }).passthrough(),
		);
		const onDisk = (await rawStore.findOne(presentation.id)) as AnyJson;
		expect(onDisk.slides.length).toBe(3);
		for (const slide of onDisk.slides) {
			expect("quizAudioUrl" in slide).toBe(false);
		}

		// Every read fills the default in, so the key is there and the cue is off.
		const authored = await authoredDeck(presentation);
		for (const slide of authored.slides) {
			expect("quizAudioUrl" in slide).toBe(true);
		}
		expect(cuesOf(authored)).toEqual(["", "", ""]);
		const joined = await (
			await fetch(`${baseUrl}/api/join/${presentation.code}`)
		).json();
		expect(cuesOf(joined)).toEqual(["", "", ""]);

		// And an ordinary edit gives the old deck a cue — nothing to migrate first.
		const patch = await authed(
			`/api/presentations/${presentation.id}`,
			presentation.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ slides: DECK }) },
		);
		expect(patch.status).toBe(200);
		expect(cuesOf(await authoredDeck(presentation))).toEqual([
			TRACK,
			SECOND_TRACK,
			"",
		]);
		const rewritten = (await rawStore.findOne(presentation.id)) as AnyJson;
		expect(rewritten.slides[0].quizAudioUrl).toBe(TRACK);
	});
});
