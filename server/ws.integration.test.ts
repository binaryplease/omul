/**
 * Integration tests for the WebSocket layer.
 *
 * Spins up the real Elysia app against a throw-away in-memory zodstore,
 * creates a presentation via the REST API, connects real WebSocket clients, and
 * asserts that the documented event envelope shows up when state changes.
 *
 * The store is in-process (bun:sqlite ":memory:"), so the suite needs no
 * external database and leaves nothing behind.
 */

// IMPORTANT: Set DATABASE_PATH before any import of ./db — db.ts opens the store
// at module-load time, and ES module imports are hoisted above top-level
// statements. We use dynamic imports below so this assignment runs first.
// ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Modules below are loaded lazily inside beforeAll() so the env overrides stick.
let connectDb: () => Promise<void>;

let baseUrl = "";
let wsUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// ── Test harness ─────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────

interface Envelope {
	event: string;
	data: Record<string, unknown>;
}

/**
 * Open a WebSocket to the test server and buffer every incoming envelope.
 * The returned `waitFor` method resolves with the first message whose event
 * matches `eventName` (scanning already-received messages first), or rejects
 * after `timeoutMs`.
 */
function openWs(): {
	socket: WebSocket;
	received: Envelope[];
	waitFor: (eventName: string, timeoutMs?: number) => Promise<Envelope>;
	waitForCount: (
		eventName: string,
		predicate: (env: Envelope) => boolean,
		timeoutMs?: number,
	) => Promise<Envelope>;
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
			// ignore non-JSON frames
		}
	});

	const ready = new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", (e) => reject(new Error(String(e))), {
			once: true,
		});
	});

	function waitFor(eventName: string, timeoutMs = 3000): Promise<Envelope> {
		return waitForCount(eventName, () => true, timeoutMs);
	}

	function waitForCount(
		eventName: string,
		predicate: (env: Envelope) => boolean,
		timeoutMs = 3000,
	): Promise<Envelope> {
		const existing = received.find(
			(e) => e.event === eventName && predicate(e),
		);
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
				if (env.event === eventName && predicate(env)) {
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
		// Allow the server a tick to process the close handler so subsequent tests
		// see a clean participant-count baseline.
		await new Promise((r) => setTimeout(r, 50));
	}

	return { socket, received, waitFor, waitForCount, close, ready };
}

async function createPresentation(title = "WS Test"): Promise<{
	id: string;
	code: string;
	creatorToken: string;
}> {
	const body = {
		title,
		slides: [
			{
				id: "s1",
				type: "multiple-choice",
				question: "Pick one",
				options: [
					{ id: "a", text: "A" },
					{ id: "b", text: "B" },
				],
			},
			{
				id: "s2",
				type: "open-text",
				question: "Anything?",
			},
		],
	};
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	// body typed below via return annotation
	return (await res.json()) as any;
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

/** One scored question and the board that reports on it (REQ059). */
async function createLeaderboardDeck(): Promise<{
	id: string;
	creatorToken: string;
}> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "WS Leaderboard",
			slides: [
				{
					id: "qz",
					type: "quiz",
					question: "Closest to the sun?",
					timeLimit: 30,
					options: [
						{ id: "venus", text: "Venus" },
						{ id: "mercury", text: "Mercury", isCorrect: true },
					],
				},
				{ id: "board", type: "leaderboard", question: "" },
			],
		}),
	});
	expect(res.status).toBe(201);
	return (await res.json()) as any;
}

async function answerQuiz(
	presentationId: string,
	participantId: string,
	optionId: string,
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId: "qz", value: optionId, participantId }),
	});
	expect(res.status).toBe(200);
}

/** One answer on a slide of the default deck (REQ150's tally tests). */
async function castVote(
	presentationId: string,
	slideId: string,
	participantId: string,
	value: string,
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value, participantId }),
	});
	expect(res.status).toBe(200);
}

/** Join a presentation and wait for the first participants.count event. */
async function join(
	client: ReturnType<typeof openWs>,
	presentationId: string,
	role: "presenter" | "participant" = "participant",
): Promise<Envelope> {
	client.socket.send(JSON.stringify({ type: "join", presentationId, role }));
	return client.waitFor("participants.count");
}

// ── Server lifecycle ────────────────────────────────────────

describe("WebSocket integration", () => {
	beforeAll(async () => {
		// Load server modules AFTER DATABASE_PATH is set.
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
					// See server/index.ts for the rationale — mutate ws.raw.data, not ws.data.
					// raw.data is Bun's settable slot
					(wsConn.raw as any).data = {
						// spreading existing context
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
						// ignore malformed
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
		// Elysia's runtime shape
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
		// A coalesced standings recount (REQ059) may still be pending behind the
		// last board this suite moved. Dropped rather than left to fire into a
		// stopped server, where it would log a failure that is this teardown's
		// doing rather than the code's.
		const { resetStandingsBroadcasts, resetTallyBroadcasts } = await import(
			"./services/presentations"
		);
		resetStandingsBroadcasts();
		// And the same for a slide's own tally (REQ150), which is folded the same
		// way and can be holding a window of its own behind the last answer.
		resetTallyBroadcasts();
	});

	// ── Tests ──────────────────────────────────────────────

	test("health check reachable (sanity)", async () => {
		const res = await fetch(`${baseUrl}/api/health`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("join handshake produces a participants.count event", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;

		const env = await join(client, pres.id, "participant");
		expect(env.data).toEqual({ count: 1, presentationId: pres.id });

		await client.close();
	});

	test("malformed frames are ignored without dropping the connection", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;

		client.socket.send("}{ not json");
		client.socket.send(JSON.stringify({ type: "bogus" }));
		const env = await join(client, pres.id);
		expect(env.data).toMatchObject({ count: 1, presentationId: pres.id });
		expect(client.socket.readyState).toBe(WebSocket.OPEN);

		await client.close();
	});

	test("multiple clients in the same room each see their own count update", async () => {
		const pres = await createPresentation();
		const a = openWs();
		await a.ready;
		const first = await join(a, pres.id);
		expect(first.data).toEqual({ count: 1, presentationId: pres.id });

		const b = openWs();
		await b.ready;
		const bFirst = await join(b, pres.id);
		expect(bFirst.data).toEqual({ count: 2, presentationId: pres.id });

		// a should also have seen count=2.
		const aUpdate = await a.waitForCount(
			"participants.count",
			(e) => e.data.count === 2,
		);
		expect(aUpdate.data.presentationId).toBe(pres.id);

		await a.close();
		await b.close();
	});

	test("presenter role is not counted in participants.count", async () => {
		const pres = await createPresentation();
		const presenter = openWs();
		await presenter.ready;
		const env = await join(presenter, pres.id, "presenter");
		expect(env.data).toEqual({ count: 0, presentationId: pres.id });

		await presenter.close();
	});

	test("closing a participant socket triggers a decremented count", async () => {
		const pres = await createPresentation();
		const stayer = openWs();
		await stayer.ready;
		await join(stayer, pres.id);

		const leaver = openWs();
		await leaver.ready;
		await join(leaver, pres.id);

		// stayer should observe count=2 at some point.
		await stayer.waitForCount("participants.count", (e) => e.data.count === 2);

		leaver.socket.close();
		// stayer should now observe count=1.
		const decremented = await stayer.waitForCount(
			"participants.count",
			(e) => e.data.count === 1,
		);
		expect(decremented.data.presentationId).toBe(pres.id);

		await stayer.close();
	});

	test("presentation.started is broadcast to joined clients", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const res = await authed(
			`/api/presentations/${pres.id}/start`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);

		const env = await client.waitFor("presentation.started");
		expect(env.data).toEqual({ presentationId: pres.id });

		await client.close();
	});

	test("slide.changed carries the new slide payload", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await client.waitFor("presentation.started");

		const res = await authed(
			`/api/presentations/${pres.id}/slide`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ index: 1 }) },
		);
		expect(res.status).toBe(200);

		const env = await client.waitFor("slide.changed");
		expect(env.data.presentationId).toBe(pres.id);
		expect(env.data.slideIndex).toBe(1);
		expect((env.data.slide as { id: string }).id).toBe("s2");

		await client.close();
	});

	test("submitVote broadcasts results.updated to everyone in the room", async () => {
		const pres = await createPresentation();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "presenter");

		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");

		const voteRes = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slideId: "s1",
					value: "a",
					participantId: "participant-1",
				}),
			},
		);
		expect(voteRes.status).toBe(200);

		const env = await viewer.waitFor("results.updated");
		expect(env.data.presentationId).toBe(pres.id);
		expect(env.data.slideId).toBe("s1");
		const results = env.data.results as {
			totalVotes: number;
			options: { id: string; count: number }[];
		};
		expect(results.totalVotes).toBe(1);
		expect(results.options.find((o) => o.id === "a")?.count).toBe(1);

		await viewer.close();
	});

	test("a quiz answer re-broadcasts the deck's leaderboard too (REQ059)", async () => {
		// The one aggregate that changes because of a vote cast on a *different*
		// slide. Without it a board on screen would sit at whatever it said when
		// the room arrived, while the room is still answering the question behind
		// it — a leaderboard reporting a race that has already moved on.
		const pres = await createLeaderboardDeck();

		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "presenter");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");

		await answerQuiz(pres.id, "participant-1", "mercury");

		const env = await viewer.waitForCount(
			"results.updated",
			(candidate) => (candidate.data as { slideId: string }).slideId === "board",
		);
		const board = env.data.results as {
			type: string;
			rankedCount: number;
			entries: { totalPoints: number }[];
		};
		expect(board.type).toBe("leaderboard");
		expect(board.rankedCount).toBe(1);
		expect(board.entries[0].totalPoints).toBeGreaterThan(0);

		await viewer.close();
	});

	test("re-marking a solution re-broadcasts the leaderboard (REQ059)", async () => {
		// Scores are derived from the slide *as it stands now*, so an edit to what
		// counts as correct re-orders the board with no new vote. The presenter's
		// poll would catch it on the projector; a participant's phone only hears
		// about it here, and without this it keeps a board the edit already
		// settled differently.
		const pres = await createLeaderboardDeck();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");

		await answerQuiz(pres.id, "participant-1", "venus");
		// The wrong answer's board first, so the re-marked one is a fresh frame.
		const before = await viewer.waitForCount(
			"results.updated",
			(candidate) => (candidate.data as { slideId: string }).slideId === "board",
		);
		expect(
			(before.data.results as { entries: { totalPoints: number }[] }).entries[0]
				.totalPoints,
		).toBe(0);
		viewer.received.length = 0;

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({
				slides: [
					{
						id: "qz",
						type: "quiz",
						question: "Closest to the sun?",
						timeLimit: 30,
						options: [
							{ id: "venus", text: "Venus", isCorrect: true },
							{ id: "mercury", text: "Mercury" },
						],
					},
					{ id: "board", type: "leaderboard", question: "" },
				],
			}),
		});
		expect(patch.status).toBe(200);

		const env = await viewer.waitForCount(
			"results.updated",
			(candidate) => (candidate.data as { slideId: string }).slideId === "board",
		);
		const board = env.data.results as {
			entries: { totalPoints: number }[];
		};
		expect(board.entries[0].totalPoints).toBeGreaterThan(0);

		await viewer.close();
	});

	test("restarting a question's timer re-broadcasts the leaderboard (REQ057/REQ059)", async () => {
		// A fresh window re-measures the speed half of every answer already given
		// against it, so the standings move on this path too.
		const pres = await createLeaderboardDeck();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");

		await answerQuiz(pres.id, "participant-1", "mercury");
		await viewer.waitForCount(
			"results.updated",
			(candidate) => (candidate.data as { slideId: string }).slideId === "board",
		);
		viewer.received.length = 0;

		const restarted = await authed(
			`/api/presentations/${pres.id}/timer`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(restarted.status).toBe(200);

		const env = await viewer.waitForCount(
			"results.updated",
			(candidate) => (candidate.data as { slideId: string }).slideId === "board",
		);
		expect((env.data.results as { type: string }).type).toBe("leaderboard");

		await viewer.close();
	});

	test("a room answering together costs one board recount per window, not one per answer (REQ059)", async () => {
		// The board is a whole-deck aggregate with only a latest value, so N answers
		// inside one window have one answer between them. Re-scoring the deck and
		// broadcasting to the whole room per *individual* answer made a large room
		// the expensive case — see `server/coalesce.ts`.
		const pres = await createLeaderboardDeck();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");
		viewer.received.length = 0;

		// A room answering the question at once. Concurrent rather than sequential,
		// because arriving together is the shape that used to cost the most.
		const ROOM = 40;
		await Promise.all(
			Array.from({ length: ROOM }, (_, seat) =>
				answerQuiz(pres.id, `participant-${seat}`, "mercury"),
			),
		);

		const boardFrames = () =>
			viewer.received.filter(
				(candidate) =>
					candidate.event === "results.updated" &&
					(candidate.data as { slideId: string }).slideId === "board",
			);

		// Let the trailing recount land — the window is half a second.
		await new Promise((resolve) => setTimeout(resolve, 900));

		const frames = boardFrames();
		// Far fewer frames than answers is the whole property. Asserted as a bound
		// rather than an exact count: how many windows 40 concurrent requests span
		// is a property of the machine, and pinning it would make this a flake.
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.length).toBeLessThan(ROOM / 2);

		// And the board the room is left holding is the *settled* one — coalescing
		// merges frames, it never drops the last change. A fix that traded the cost
		// for a board stuck mid-count would be worse than the cost.
		const settled = frames[frames.length - 1].data.results as {
			rankedCount: number;
			entries: { totalPoints: number }[];
		};
		expect(settled.rankedCount).toBe(ROOM);
		expect(settled.entries.length).toBeGreaterThan(0);
		expect(settled.entries[0].totalPoints).toBeGreaterThan(0);

		await viewer.close();
	});

	test("a room answering together costs one tally broadcast per window, not one per answer (REQ150)", async () => {
		// The remaining half of the same shape the board fix took off this path:
		// every answer used to re-aggregate the slide and fan the tally out to the
		// whole room, so one question on a room of 300 was 300 re-aggregations and
		// 90,000 socket writes. Coalesced, the cost of a question is set by how long
		// it runs rather than by how many people are in it.
		const pres = await createPresentation();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");
		viewer.received.length = 0;

		const ROOM = 40;
		await Promise.all(
			Array.from({ length: ROOM }, (_, seat) =>
				castVote(pres.id, "s1", `participant-${seat}`, seat % 2 ? "a" : "b"),
			),
		);

		const tallyFrames = () =>
			viewer.received.filter(
				(candidate) =>
					candidate.event === "results.updated" &&
					(candidate.data as { slideId: string }).slideId === "s1",
			);

		// Let the trailing broadcast land — the window is a tenth of a second.
		await new Promise((resolve) => setTimeout(resolve, 400));

		const frames = tallyFrames();
		// Far fewer frames than answers is the whole property. Asserted as a bound
		// rather than an exact count: how many windows 40 concurrent requests span
		// is a property of the machine, and pinning it would make this a flake.
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.length).toBeLessThan(ROOM / 2);

		// And the tally the room is left holding is the *settled* one — coalescing
		// merges frames, it never drops the last change. A chart stuck mid-count
		// would be worse than the cost it saved.
		const settled = frames[frames.length - 1].data.results as {
			totalVotes: number;
			options: { id: string; count: number }[];
		};
		expect(settled.totalVotes).toBe(ROOM);
		expect(settled.options.find((option) => option.id === "a")?.count).toBe(
			ROOM / 2,
		);

		await viewer.close();
	});

	test("a room answering slower than the window still sees every answer land (REQ150)", async () => {
		// The half of REQ150 that is not about cost. A slide tally is the direct
		// feedback for the gesture just made, and a word cloud filling in word by
		// word is part of what the product is — so the leading run is immediate and
		// the window is never extended by what it absorbs. Below one answer per
		// window that adds up to exactly what it always was: one frame per answer,
		// which is every small room and the tail of every large one.
		const pres = await createPresentation();
		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");
		viewer.received.length = 0;

		const ANSWERS = 3;
		for (let seat = 0; seat < ANSWERS; seat++) {
			await castVote(pres.id, "s1", `slow-${seat}`, "a");
			// Comfortably past the window, so each answer meets a quiet slide the way
			// a room answering at human speed does.
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		const frames = viewer.received.filter(
			(candidate) =>
				candidate.event === "results.updated" &&
				(candidate.data as { slideId: string }).slideId === "s1",
		);
		expect(frames.length).toBe(ANSWERS);
		expect(
			frames.map((frame) => (frame.data.results as { totalVotes: number }).totalVotes),
		).toEqual([1, 2, 3]);

		await viewer.close();
	});

	test("a coalesced tally on a private deck still broadcasts the withheld marker and no numbers (REQ015–REQ017)", async () => {
		// The frame goes to every socket in the room, so it may carry only what the
		// audience may see. Coalescing changes when it is sent and never what it
		// reads — a burst on a withholding deck must fold to a withheld frame, not
		// to a tally that slipped out because it was assembled on a different path.
		const created = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "WS Private",
				resultsVisibility: "private",
				slides: [
					{
						id: "shut",
						type: "multiple-choice",
						question: "Pick one",
						options: [
							{ id: "a", text: "A" },
							{ id: "b", text: "B" },
						],
					},
				],
			}),
		});
		expect(created.status).toBe(201);
		const pres = (await created.json()) as { id: string; creatorToken: string };

		const viewer = openWs();
		await viewer.ready;
		await join(viewer, pres.id, "participant");
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await viewer.waitFor("presentation.started");
		viewer.received.length = 0;

		await Promise.all(
			Array.from({ length: 12 }, (_, seat) =>
				castVote(pres.id, "shut", `hidden-${seat}`, "a"),
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 400));

		const frames = viewer.received.filter(
			(candidate) => candidate.event === "results.updated",
		);
		expect(frames.length).toBeGreaterThan(0);
		// Every one of them, leading and trailing alike.
		for (const frame of frames) {
			const results = frame.data.results as Record<string, unknown>;
			expect(results.withheld).toBe(true);
			expect(results.totalVotes).toBeUndefined();
			expect(results.options).toBeUndefined();
		}

		await viewer.close();
	});

	test("events for presentation A do not leak into presentation B", async () => {
		const a = await createPresentation("A");
		const b = await createPresentation("B");

		const watcherB = openWs();
		await watcherB.ready;
		await join(watcherB, b.id);
		const baselineLen = watcherB.received.length;

		await authed(`/api/presentations/${a.id}/start`, a.creatorToken, {
			method: "POST",
		});

		// Give the server a generous window to (fail to) deliver a leaked event.
		await new Promise((r) => setTimeout(r, 250));

		const leaked = watcherB.received
			.slice(baselineLen)
			.find((e) => e.event === "presentation.started");
		expect(leaked).toBeUndefined();

		await watcherB.close();
	});

	test("presentation.ended and presentation.reset are broadcast", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await client.waitFor("presentation.started");

		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});
		const ended = await client.waitFor("presentation.ended");
		expect(ended.data).toEqual({ presentationId: pres.id });

		await authed(`/api/presentations/${pres.id}/reset`, pres.creatorToken, {
			method: "POST",
		});
		const reset = await client.waitFor("presentation.reset");
		expect(reset.data).toEqual({ presentationId: pres.id });

		await client.close();
	});

	// ── The Q&A layer's settings reach the room from every writer ─────────
	//
	// `POST /qa/settings` is not the only thing that writes `qaEnabled` /
	// `qaVisibility`: the editor saves both on an ordinary PATCH. A write that
	// told nobody would leave a withdrawn question list on every phone in the
	// room, since nothing about the deck a client holds would have changed to
	// make it refetch — and REQ037 is the control that exists to withdraw it.

	test("the settings endpoint broadcasts qa.settings (REQ036/REQ037)", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const res = await authed(
			`/api/presentations/${pres.id}/qa/settings`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ enabled: true, visibility: "everyone" }),
			},
		);
		expect(res.status).toBe(200);

		const env = await client.waitFor("qa.settings");
		expect(env.data).toEqual({
			presentationId: pres.id,
			qaEnabled: true,
			qaVisibility: "everyone",
		});

		await client.close();
	});

	test("a PATCH that withdraws the question list broadcasts it too (REQ037)", async () => {
		// The failure this guards: deck running with the list published, presenter
		// opens the editor, switches to "Only the presenter", saves. Stored, but
		// silent — so every phone keeps `qaVisibility: "everyone"`, never refetches,
		// and the full room list stays on screen. They believe they withdrew it and
		// they have not.
		const pres = await createPresentation();
		await authed(`/api/presentations/${pres.id}/qa/settings`, pres.creatorToken, {
			method: "POST",
			body: JSON.stringify({ enabled: true, visibility: "everyone" }),
		});

		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ qaVisibility: "presenter" }),
		});
		expect(patch.status).toBe(200);

		const env = await client.waitFor("qa.settings");
		expect(env.data).toEqual({
			presentationId: pres.id,
			// The layer is still on — the PATCH named only the visibility, and the
			// broadcast reports the deck as it now stands rather than echoing the
			// keys that happened to be sent.
			qaEnabled: true,
			qaVisibility: "presenter",
		});

		await client.close();
	});

	test("a PATCH that touches neither Q&A key broadcasts no qa.settings", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ title: "Renamed" }),
		});
		expect(patch.status).toBe(200);

		// Give the broadcast a tick it could have arrived in.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(client.received.some((env) => env.event === "qa.settings")).toBe(
			false,
		);

		await client.close();
	});

	// ── The name switch reaches the room (REQ076) ────────────────────────
	//
	// The deck PATCH is the *only* writer of `requireParticipantName`, so this is
	// the only frame — but it is no less load-bearing for that. Turned on
	// silently, nobody already in the room is ever asked and every answer they go
	// on to give is stored under nobody. Turned off silently, a participant still
	// standing at the gate submits into a boundary that has started refusing
	// them, and the gate is drawn from the deck they hold, so there is nothing to
	// release them.

	test("a PATCH that starts asking for names broadcasts it (REQ076)", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: true }),
		});
		expect(patch.status).toBe(200);

		const env = await client.waitFor("presentation.participant-name");
		expect(env.data).toEqual({
			presentationId: pres.id,
			requireParticipantName: true,
		});

		await client.close();
	});

	test("a PATCH that stops asking broadcasts it too (REQ076)", async () => {
		const pres = await createPresentation();
		await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: true }),
		});

		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: false }),
		});
		expect(patch.status).toBe(200);

		const env = await client.waitFor("presentation.participant-name");
		expect(env.data).toEqual({
			presentationId: pres.id,
			requireParticipantName: false,
		});

		await client.close();
	});

	test("the frame carries the switch and never a name (REQ076)", async () => {
		// The one thing this feature must not do. A frame naming somebody would
		// put a name on every phone in the room; the roster is fetched, by a
		// credentialed caller, and only ever by them.
		const pres = await createPresentation();
		await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: true }),
		});
		await fetch(
			`${baseUrl}/api/presentations/${pres.id}/participant-name`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ participantId: "p1", name: "Adalovelace" }),
			},
		);

		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ requireParticipantName: false }),
		});
		await client.waitFor("presentation.participant-name");

		// Give any other frame a tick it could have arrived in, then search
		// everything this socket was sent rather than trusting the projection.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(JSON.stringify(client.received)).not.toContain("Adalovelace");

		await client.close();
	});

	test("a PATCH that does not name the switch broadcasts nothing (REQ076)", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ title: "Renamed" }),
		});
		expect(patch.status).toBe(200);

		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(
			client.received.some(
				(env) => env.event === "presentation.participant-name",
			),
		).toBe(false);

		await client.close();
	});

	// ── The deck's reveal mode reaches the room from every writer ─────────
	//
	// `POST /results-visibility` is not the only thing that writes
	// `resultsVisibility`: the editor's "Apply to every question slide" changes
	// the document it holds and saves it through the ordinary PATCH. The same
	// failure as the Q&A pair above, with a worse symptom — the server does stop
	// publishing, so a silent write leaves the last tally every phone was
	// legitimately sent frozen on screen under a question the organizer has just
	// made private (REQ016/REQ017/REQ018).

	test("the deck-wide endpoint broadcasts presentation.results-visibility (REQ018)", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const res = await authed(
			`/api/presentations/${pres.id}/results-visibility`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ resultsVisibility: "private" }),
			},
		);
		expect(res.status).toBe(200);

		const env = await client.waitFor("presentation.results-visibility");
		expect(env.data).toEqual({
			presentationId: pres.id,
			resultsVisibility: "private",
		});

		await client.close();
	});

	test("a PATCH that changes the reveal mode broadcasts it too (REQ018)", async () => {
		// The failure this guards: deck running on `instant` with phones drawing a
		// tally, organizer opens the editor, switches the deck to `private`, clicks
		// "Apply to every question slide", saves. Stored, but silent — so every
		// phone keeps `resultsVisibility: "instant"`, never refetches, and goes on
		// drawing the last tally it received under a question that is now private.
		// They believe they withdrew it and they have not.
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ resultsVisibility: "private" }),
		});
		expect(patch.status).toBe(200);

		const env = await client.waitFor("presentation.results-visibility");
		// The broadcast reports the deck as it now stands rather than echoing what
		// was sent, exactly as the Q&A one does.
		expect(env.data).toEqual({
			presentationId: pres.id,
			resultsVisibility: "private",
		});

		await client.close();
	});

	test("a PATCH that leaves the reveal mode alone broadcasts nothing", async () => {
		const pres = await createPresentation();
		const client = openWs();
		await client.ready;
		await join(client, pres.id);

		const patch = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ title: "Renamed" }),
		});
		expect(patch.status).toBe(200);

		// Give the broadcast a tick it could have arrived in.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(
			client.received.some(
				(env) => env.event === "presentation.results-visibility",
			),
		).toBe(false);

		await client.close();
	});
});
