/**
 * Integration tests for the P0-requirement features added in
 * task/0004-p0-requirements:
 *
 *   - REQ102 — hide/show results (setSlideRevealed + /reveal route + slide.revealed WS)
 *   - REQ003/REQ082 — survey mode voting (accepts votes outside "live" status)
 *   - REQ084 — language field persisted on create
 *   - creator-token gate for /reveal
 *
 * Like ws.integration.test.ts, this suite stands up the real Elysia app
 * against a throw-away in-memory zodstore (bun:sqlite ":memory:").
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store,
// so the tests need no external database and never touch a persisted file.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let connectDb: () => Promise<void>;

let baseUrl = "";
let wsUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

interface Envelope {
	event: string;
	data: Record<string, unknown>;
}

function openWs(): {
	socket: WebSocket;
	received: Envelope[];
	waitFor: (eventName: string, timeoutMs?: number) => Promise<Envelope>;
	close: () => Promise<void>;
	ready: Promise<void>;
} {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	const listeners: Array<(env: Envelope) => void> = [];

	socket.addEventListener("message", (ev) => {
		try {
			const raw = (ev as MessageEvent).data;
			const env: Envelope = JSON.parse(
				typeof raw === "string" ? raw : new TextDecoder().decode(raw),
			);
			received.push(env);
			for (const l of listeners) l(env);
		} catch {
			/* ignore */
		}
	});

	const ready = new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", (e) => reject(new Error(String(e))), {
			once: true,
		});
	});

	function waitFor(eventName: string, timeoutMs = 3000): Promise<Envelope> {
		const existing = received.find((e) => e.event === eventName);
		if (existing) return Promise.resolve(existing);
		return new Promise<Envelope>((resolve, reject) => {
			const timer = setTimeout(() => {
				listeners.splice(listeners.indexOf(onMsg), 1);
				reject(
					new Error(
						`Timed out after ${timeoutMs}ms waiting for "${eventName}". ` +
							`Received: ${received.map((e) => e.event).join(", ") || "(none)"}`,
					),
				);
			}, timeoutMs);
			const onMsg = (env: Envelope) => {
				if (env.event === eventName) {
					clearTimeout(timer);
					listeners.splice(listeners.indexOf(onMsg), 1);
					resolve(env);
				}
			};
			listeners.push(onMsg);
		});
	}

	async function close() {
		if (
			socket.readyState === WebSocket.OPEN ||
			socket.readyState === WebSocket.CONNECTING
		) {
			socket.close();
		}
		await new Promise((r) => setTimeout(r, 50));
	}

	return { socket, received, waitFor, close, ready };
}

// API response is loosely typed
type CreateResponse = any;

async function createPresentation(
	overrides: Record<string, unknown> = {},
): Promise<CreateResponse> {
	const body = {
		title: "P0 Test",
		slides: [
			{
				id: "s1",
				type: "multiple-choice",
				question: "Pick one",
				options: [
					{ id: "a", text: "A" },
					{ id: "b", text: "B" },
				],
				resultsVisibility: "on-click",
			},
			{
				id: "s2",
				type: "open-text",
				question: "Anything?",
			},
		],
		...overrides,
	};
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	return await res.json();
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

async function join(
	client: ReturnType<typeof openWs>,
	presentationId: string,
	role: "presenter" | "participant" = "participant",
): Promise<Envelope> {
	client.socket.send(JSON.stringify({ type: "join", presentationId, role }));
	return client.waitFor("participants.count");
}

// ── Server lifecycle ────────────────────────────────────────

describe("P0 requirements integration", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes)
			.ws("/ws", {
				open(wsConn) {
					const clientId = ws.registerClient(wsConn);
					// raw.data is Bun's settable slot
					(wsConn.raw as any).data = {
						// spreading existing ctx
						...((wsConn.raw as any).data ?? {}),
						clientId,
					};
				},
				message(wsConn, message) {
					try {
						const msg =
							typeof message === "string" ? JSON.parse(message) : message;
						if (msg.type === "join") {
							// see open() above
							const clientId = (wsConn.raw as any).data?.clientId as
								| string
								| undefined;
							if (!clientId) return;
							ws.joinRoom(
								clientId,
								msg.presentationId,
								msg.role || "participant",
							);
						}
					} catch {
						/* ignore */
					}
				},
				close(wsConn) {
					// see open() above
					const clientId = (wsConn.raw as any).data?.clientId as
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
		// integration suites in this run, so it is not closed here — bun tears it
		// down when the test process exits. Only this suite's server is stopped.
		if (server) await server.stop();
	});

	// ── REQ084 — language on create ───────────────────────

	test("createPresentation persists the language field (REQ084)", async () => {
		const pres = await createPresentation({ language: "de" });
		expect(pres.language).toBe("de");
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.language).toBe("de");
	});

	test("createPresentation defaults language to 'en'", async () => {
		const pres = await createPresentation();
		expect(pres.language).toBe("en");
	});

	test("new presentations start with an empty revealedSlideIds list", async () => {
		const pres = await createPresentation();
		expect(pres.revealedSlideIds).toEqual([]);
	});

	// ── REQ102 — hide/show results ────────────────────────

	test("/reveal adds the slide to revealedSlideIds and broadcasts slide.revealed", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const res = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ slideId: "s1" }),
			},
		);
		expect(res.status).toBe(200);
		const updated = await res.json();
		expect(updated.revealedSlideIds).toContain("s1");

		const env = await client.waitFor("slide.revealed");
		expect(env.data).toEqual({
			presentationId: pres.id,
			slideId: "s1",
			revealed: true,
		});

		await client.close();
	});

	test("/reveal with reveal:false removes the slide from the revealed list", async () => {
		const pres = await createPresentation();

		// reveal first
		await authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ slideId: "s1" }),
		});

		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		// then hide
		const res = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ slideId: "s1", reveal: false }),
			},
		);
		expect(res.status).toBe(200);
		const updated = await res.json();
		expect(updated.revealedSlideIds).not.toContain("s1");

		const env = await client.waitFor("slide.revealed");
		expect(env.data).toEqual({
			presentationId: pres.id,
			slideId: "s1",
			revealed: false,
		});

		await client.close();
	});

	test("/reveal is idempotent — revealing twice does not duplicate the slideId", async () => {
		const pres = await createPresentation();
		await authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ slideId: "s1" }),
		});
		const res2 = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ slideId: "s1" }),
			},
		);
		expect(res2.status).toBe(200);
		const updated = await res2.json();
		const matches = updated.revealedSlideIds.filter(
			(id: string) => id === "s1",
		);
		expect(matches).toHaveLength(1);
	});

	test("/reveal requires a valid creator token (401 without)", async () => {
		const pres = await createPresentation();
		const resMissing = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/reveal`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slideId: "s1" }),
			},
		);
		expect(resMissing.status).toBe(401);

		const resBad = await authed(
			`/api/presentations/${pres.id}/reveal`,
			"not-the-real-token",
			{ method: "POST", body: JSON.stringify({ slideId: "s1" }) },
		);
		expect(resBad.status).toBe(401);
	});

	test("/reveal returns 404 for unknown slideId", async () => {
		const pres = await createPresentation();
		const res = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ slideId: "does-not-exist" }),
			},
		);
		expect(res.status).toBe(404);
	});

	test("reset clears revealedSlideIds (REQ102)", async () => {
		const pres = await createPresentation();
		await authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ slideId: "s1" }),
		});
		const beforeRes = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect((await beforeRes.json()).revealedSlideIds).toContain("s1");

		const resetRes = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(resetRes.status).toBe(200);

		const afterRes = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const after = await afterRes.json();
		expect(after.revealedSlideIds).toEqual([]);
	});

	// ── REQ003 / REQ082 — survey mode voting ──────────────

	test("survey mode accepts votes in draft status (REQ003/REQ082)", async () => {
		const pres = await createPresentation({ mode: "survey" });
		expect(pres.mode).toBe("survey");
		expect(pres.status).toBe("draft");

		const voteRes = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slideId: "s1",
					value: "a",
					participantId: "survey-1",
				}),
			},
		);
		expect(voteRes.status).toBe(200);

		// Read with the creator token: `s1` is authored `on-click`, so the room is
		// published no tally until the presenter reveals it (REQ016) and an
		// anonymous read here would be asserting the reveal mode rather than that
		// the vote landed, which is what this test is about.
		const resultsRes = await authed(
			`/api/presentations/${pres.id}/results/s1`,
			pres.creatorToken,
		);
		const results = await resultsRes.json();
		expect(results.totalVotes).toBe(1);
	});

	test("survey mode rejects votes once the presentation is ended", async () => {
		const pres = await createPresentation({ mode: "survey" });
		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				value: "a",
				participantId: "late",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("live mode rejects votes in draft status", async () => {
		const pres = await createPresentation({ mode: "live" });
		expect(pres.status).toBe("draft");

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				value: "a",
				participantId: "early",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("live mode accepts votes after /start", async () => {
		const pres = await createPresentation({ mode: "live" });
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "s1",
				value: "a",
				participantId: "live-1",
			}),
		});
		expect(res.status).toBe(200);
	});

	// ── Creator-token one-time disclosure ─────────────────

	test("creatorToken is returned once on create and never on subsequent GETs", async () => {
		const pres = await createPresentation();
		expect(typeof pres.creatorToken).toBe("string");
		expect(pres.creatorToken.length).toBeGreaterThan(0);

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		expect(fetched.creatorToken).toBeUndefined();
		expect(fetched.creatorTokenHash).toBeUndefined();
	});
});
