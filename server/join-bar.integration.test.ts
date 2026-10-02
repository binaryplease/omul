/**
 * Integration tests for the presenter surface's join bar (REQ073).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore. The
 * requirement is one sentence — the bar "can be shown or hidden without
 * changing whether the deck accepts joins" — and this suite is organised as its
 * two halves plus the boundary around them:
 *
 *   - **The switch.** A deck-level setting, shown unless the deck says
 *     otherwise — including a deck stored before the field existed — moved by
 *     the deck PATCH, persisted, and broadcast so every presenter screen of the
 *     deck draws the same header.
 *   - **Who may move it.** Only a caller who may change the deck: the route's
 *     own authorization, and no other route writes the field.
 *   - **What it must not do.** A hidden bar leaves the join code, the join
 *     route, the deck's status and a participant's answers exactly as they were.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / chat
 * / participant-name harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	PresentationSchema,
	StoredPresentationSchema,
	UpdatePresentationSchema,
} from "./schemas";

let baseUrl = "";
let wsUrl = "";
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

/** A deck with one answer-collecting slide, created but not started. */
async function createDeck(): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Join Bar Test",
			slides: [{ id: "s1", type: "word-cloud", question: "One word?" }],
		}),
	});
	expect(response.status).toBe(201);
	return await response.json();
}

async function startDeck(pres: AnyJson): Promise<void> {
	const started = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(started.status).toBe(200);
}

async function setJoinBar(pres: AnyJson, showJoinBar: boolean): Promise<Response> {
	return authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
		method: "PATCH",
		body: JSON.stringify({ showJoinBar }),
	});
}

/** The deck as its owner reads it back. */
async function readDeck(pres: AnyJson): Promise<AnyJson> {
	const response = await authed(
		`/api/presentations/${pres.id}`,
		pres.creatorToken,
	);
	expect(response.status).toBe(200);
	return await response.json();
}

type Envelope = { event: string; data: Record<string, unknown> };

/** A socket joined to one deck's room, buffering every frame it is sent. */
async function openRoom(
	presentationId: string,
	role: "presenter" | "participant",
): Promise<{
	waitFor: (eventName: string) => Promise<Envelope>;
	close: () => void;
}> {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	socket.addEventListener("message", (message) => {
		received.push(JSON.parse(String((message as MessageEvent).data)));
	});
	await new Promise<void>((resolve) =>
		socket.addEventListener("open", () => resolve(), { once: true }),
	);
	socket.send(JSON.stringify({ type: "join", presentationId, role }));

	const waitFor = async (eventName: string): Promise<Envelope> => {
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline) {
			const found = received.find((envelope) => envelope.event === eventName);
			if (found) return found;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`Timed out waiting for "${eventName}"`);
	};
	// The room has taken the join once it reports its head count.
	await waitFor("participants.count");
	return { waitFor, close: () => socket.close() };
}

describe("the join bar (REQ073)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		// The socket wiring mirrors server/index.ts — see ws.integration.test.ts
		// for the reasoning behind writing into `raw.data`.
		const app = new Elysia().use(presentationRoutes).ws("/ws", {
			open(connection) {
				const clientId = ws.registerClient(connection);
				// raw.data is Bun's settable slot
				(connection.raw as any).data = {
					...((connection.raw as any).data ?? {}),
					clientId,
				};
			},
			message(connection, message) {
				const parsed =
					typeof message === "string" ? JSON.parse(message) : message;
				const clientId = (connection.raw as any).data?.clientId as
					| string
					| undefined;
				if (parsed.type === "join" && clientId) {
					ws.joinRoom(clientId, parsed.presentationId, parsed.role);
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
		wsUrl = `ws://${bunServer.hostname}:${bunServer.port}/ws`;
	});

	afterAll(async () => {
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here.
		if (server) await server.stop();
	});

	// ── Shown unless the deck says otherwise ──────────────────

	test("a deck stored without the field reads as shown", () => {
		const stored = StoredPresentationSchema.parse({ id: "legacy" });
		expect(stored.showJoinBar).toBe(true);
		// And the response shape a presenter screen draws from agrees.
		expect(PresentationSchema.parse(stored).showJoinBar).toBe(true);
	});

	test("an update that does not mention it does not claim it", () => {
		// A PATCH is defined by the keys it carries — a default here would turn
		// every editor save into a decision about the bar.
		expect("showJoinBar" in UpdatePresentationSchema.parse({ title: "x" })).toBe(
			false,
		);
	});

	test("a fresh deck shows its join bar", async () => {
		const pres = await createDeck();
		expect(pres.showJoinBar).toBe(true);
		expect((await readDeck(pres)).showJoinBar).toBe(true);
	});

	// ── The switch ────────────────────────────────────────────

	test("the deck's editor hides it and shows it again, and it persists", async () => {
		const pres = await createDeck();

		const hidden = await setJoinBar(pres, false);
		expect(hidden.status).toBe(200);
		expect((await hidden.json()).showJoinBar).toBe(false);
		expect((await readDeck(pres)).showJoinBar).toBe(false);

		const shown = await setJoinBar(pres, true);
		expect(shown.status).toBe(200);
		expect((await readDeck(pres)).showJoinBar).toBe(true);
	});

	test("an ordinary editor save leaves a hidden bar hidden", async () => {
		const pres = await createDeck();
		await setJoinBar(pres, false);
		const saved = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ title: "Renamed", chatEnabled: true }),
		});
		expect(saved.status).toBe(200);
		expect((await readDeck(pres)).showJoinBar).toBe(false);
	});

	test("every presenter screen of the deck is told", async () => {
		const pres = await createDeck();
		const secondScreen = await openRoom(pres.id, "presenter");

		expect((await setJoinBar(pres, false)).status).toBe(200);
		const frame = await secondScreen.waitFor("presentation.join-bar");
		expect(frame.data).toEqual({ presentationId: pres.id, showJoinBar: false });

		secondScreen.close();
	});

	// ── Who may move it ───────────────────────────────────────

	test("a caller with no credential cannot hide it", async () => {
		const pres = await createDeck();
		const response = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ showJoinBar: false }),
		});
		expect(response.status).toBe(401);
		expect((await readDeck(pres)).showJoinBar).toBe(true);
	});

	test("another deck's edit token cannot hide it", async () => {
		const pres = await createDeck();
		const other = await createDeck();
		const response = await authed(
			`/api/presentations/${pres.id}`,
			other.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ showJoinBar: false }) },
		);
		expect(response.ok).toBe(false);
		expect((await readDeck(pres)).showJoinBar).toBe(true);
	});

	test("no other deck route writes it", async () => {
		// The channels switch is authorized exactly as the PATCH is; a body that
		// smuggles the field in is stripped by its schema rather than merged.
		const pres = await createDeck();
		const response = await authed(
			`/api/presentations/${pres.id}/channels`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ chatEnabled: true, showJoinBar: false }),
			},
		);
		expect(response.status).toBe(200);
		expect((await readDeck(pres)).showJoinBar).toBe(true);
	});

	// ── What hiding must not change ───────────────────────────

	test("a hidden bar leaves the deck's door exactly as it was", async () => {
		const pres = await createDeck();
		await startDeck(pres);
		const before = await readDeck(pres);

		expect((await setJoinBar(pres, false)).status).toBe(200);
		const after = await readDeck(pres);
		expect(after.code).toBe(before.code);
		expect(after.status).toBe("live");

		// The participants' door still opens on the same code…
		const joined = await fetch(`${baseUrl}/api/join/${pres.code}`);
		expect(joined.status).toBe(200);
		const joinedDeck = await joined.json();
		expect(joinedDeck.id).toBe(pres.id);
		expect(joinedDeck.status).toBe("live");

		// …and the room that walks through it is still answered.
		const vote = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId: "s1", value: "still", participantId: "p1" }),
		});
		expect(vote.status).toBe(200);
	});

	test("hiding the bar on a draft does not open or close it", async () => {
		const pres = await createDeck();
		await setJoinBar(pres, false);
		expect((await readDeck(pres)).status).toBe("draft");
		// A draft's join lookup answers as it always has.
		expect((await fetch(`${baseUrl}/api/join/${pres.code}`)).status).toBe(200);
	});
});
