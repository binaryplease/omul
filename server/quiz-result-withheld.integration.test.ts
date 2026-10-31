/**
 * Integration tests for a quiz question's result while it is not the room's yet
 * (REQ215).
 *
 * While a quiz question is running, or its solution is not yet visible to the
 * audience, nobody who cannot edit the deck is sent what the room answered: no
 * per-option `count`, and none of the correctness half of `scoring`
 * (`correctCount`, `totalPoints`, `averagePoints`, `correctShare`). Each is an
 * explicit `null`, and `quizResultWithheld` is the one reading of that shape.
 * How many answered, and where the window stands, still read.
 *
 * Why it matters on the wire and not only on screen: a participant id is minted
 * by the browser, so anybody can answer under a fresh one and read the next
 * frame. A correct count that rose by one says that answer was the key; the
 * per-option counts say what the majority picked. So every surface a tally
 * leaves by is pinned here — both results endpoints, the `results.updated`
 * frame the room's sockets receive, and segmentation of and by the question.
 *
 * Runs the real Elysia app — routes and WebSocket — against a throw-away
 * in-memory zodstore, like the harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	EDIT_TOKEN_HEADER,
	QUIZ_SUBMISSION_GRACE_MS,
	quizResultWithheld,
	RESULTS_TOKEN_HEADER,
} from "./schemas";

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void>; port: number } | null = null;

// API response is loosely typed
type AnyJson = any;

type Envelope = { event: string; data: AnyJson };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A three-option quiz question whose second option is the marked solution. */
function quizSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		options: [
			{ id: "venus", text: "Venus" },
			{ id: "mercury", text: "Mercury", isCorrect: true },
			{ id: "mars", text: "Mars" },
		],
		timeLimit: 30,
		...overrides,
	};
}

/** A plain single-select choice slide — scored on nothing. */
function choiceSlide(id = "mc") {
	return {
		id,
		type: "multiple-choice",
		question: "Which team are you on?",
		options: [
			{ id: "red", text: "Red" },
			{ id: "blue", text: "Blue" },
		],
	};
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

/** Create a deck and take it live, with whatever reveal mode it is given. */
async function goLive(
	slides: AnyJson[],
	extra: Record<string, unknown> = {},
): Promise<AnyJson> {
	const created = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Withheld Quiz Result", slides, ...extra }),
	});
	expect(created.status).toBe(201);
	const pres = await created.json();
	const started = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(started.status).toBe(200);
	return pres;
}

/** Open a question's window, as the presenter's "Start timer" does (REQ226). */
async function startTimer(pres: AnyJson, slideId = "qz"): Promise<void> {
	const res = await authed(
		`/api/presentations/${pres.id}/timer`,
		pres.creatorToken,
		{ method: "POST", body: JSON.stringify({ slideId }) },
	);
	expect(res.status).toBe(200);
}

/** Bring a slide up on the shared screen, which opens a question on arrival. */
async function goToSlide(pres: AnyJson, index: number): Promise<void> {
	const res = await authed(`/api/presentations/${pres.id}/slide`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify({ index }),
	});
	expect(res.status).toBe(200);
}

async function answer(
	presentationId: string,
	participantId: string,
	value: string,
	slideId = "qz",
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value, participantId }),
	});
	expect(res.status).toBe(200);
}

/** One read of a path, with the headers a kind of caller sends. */
async function read(path: string, headers: Record<string, string> = {}) {
	const res = await fetch(`${baseUrl}${path}`, { headers });
	expect(res.status).toBe(200);
	return (await res.json()) as AnyJson;
}

/** The room's single-slide tally — what a competitor's browser fetches. */
function audienceTally(pres: AnyJson, slideId = "qz") {
	return read(`/api/presentations/${pres.id}/results/${slideId}`);
}

/** The single-slide tally as the deck's edit-token holder reads it. */
function editorTally(pres: AnyJson, slideId = "qz") {
	return read(`/api/presentations/${pres.id}/results/${slideId}`, {
		Authorization: `Bearer ${pres.creatorToken}`,
	});
}

/** One slide's entry out of the whole-deck read. */
async function deckEntry(
	pres: AnyJson,
	slideId: string,
	headers: Record<string, string> = {},
) {
	const all = await read(`/api/presentations/${pres.id}/results`, headers);
	const entry = (all as AnyJson[]).find((one) => one.slideId === slideId);
	expect(entry).toBeDefined();
	return entry;
}

/** Mint the deck's results link (REQ098) and hand back its token. */
async function mintResultsLink(pres: AnyJson): Promise<string> {
	const res = await authed(
		`/api/presentations/${pres.id}/results-link`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(res.status).toBe(201);
	return (await res.json()).resultsToken as string;
}

/** What the room's result of a quiz question carries while withheld. */
function expectWithheld(tally: AnyJson, answeredCount: number) {
	expect(quizResultWithheld(tally)).toBe(true);
	expect(tally.options.map((option: AnyJson) => option.count)).toEqual(
		tally.options.map(() => null),
	);
	expect(tally.options.map((option: AnyJson) => option.isCorrect)).toEqual(
		tally.options.map(() => null),
	);
	expect(tally.scoring.correctCount).toBe(null);
	expect(tally.scoring.totalPoints).toBe(null);
	expect(tally.scoring.averagePoints).toBe(null);
	expect(tally.scoring.correctShare).toBe(null);
	// What may stay: how many answered, and the window.
	expect(tally.scoring.answeredCount).toBe(answeredCount);
	expect(tally.respondentCount).toBe(answeredCount);
	expect(tally.totalVotes).toBe(answeredCount);
	expect(tally.scoring).toHaveProperty("timeLimit");
	expect(tally.scoring).toHaveProperty("startedAt");
	expect(tally.scoring).toHaveProperty("deadline");
	expect(tally.scoring.closed).toBe(false);
	// Not the whole-tally marker: the answered count is published.
	expect(tally.withheld).toBeUndefined();
}

/** The two answers almost every test casts: one right, one wrong. */
async function answerOneRightOneWrong(pres: AnyJson): Promise<void> {
	await answer(pres.id, "p1", "mercury");
	await answer(pres.id, "p2", "venus");
}

async function joinRoom(
	presentationId: string,
	role: "presenter" | "participant",
): Promise<{
	received: Envelope[];
	close: () => Promise<void>;
}> {
	const socket = new WebSocket(wsUrl);
	const received: Envelope[] = [];
	socket.addEventListener("message", (event) => {
		try {
			const raw = (event as MessageEvent).data;
			received.push(
				JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)),
			);
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
	// Let the join land before anything is broadcast to the room.
	await wait(50);
	return {
		received,
		async close() {
			socket.close();
			await wait(50);
		},
	};
}

describe("a quiz question's result while it is not the room's (REQ215)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const ws = await import("./ws");
		const { Elysia } = await import("elysia");

		await db.connectDb();

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
					ws.joinRoom(clientId, parsed.presentationId, parsed.role || "participant");
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

	// ── The audience, on every surface a tally leaves by ────────

	test("the single-slide read withholds the counts and the score while the question runs", async () => {
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		expectWithheld(await audienceTally(pres), 2);
	});

	test("the whole-deck read withholds them the same way", async () => {
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		expectWithheld(await deckEntry(pres, "qz"), 2);
	});

	test("the frame the room's sockets receive after an answer carries no counts and no score", async () => {
		// The frame goes to every socket in the room, so what it carries is in
		// every competitor's browser. A presenter socket is sent the same frame:
		// `role` is self-declared, and the presenter's numbers come from its own
		// credentialed poll.
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		const phone = await joinRoom(pres.id, "participant");
		const screen = await joinRoom(pres.id, "presenter");

		await answerOneRightOneWrong(pres);
		// The broadcast is coalesced (REQ150); let the trailing run land.
		await wait(300);

		for (const room of [phone, screen]) {
			const frames = room.received.filter(
				(envelope) =>
					envelope.event === "results.updated" && envelope.data.slideId === "qz",
			);
			expect(frames.length).toBeGreaterThan(0);
			for (const frame of frames) {
				expect(quizResultWithheld(frame.data.results)).toBe(true);
				expect(
					frame.data.results.options.every(
						(option: AnyJson) => option.count === null,
					),
				).toBe(true);
				expect(frame.data.results.scoring.correctCount).toBe(null);
			}
			expect(frames.at(-1)?.data.results.scoring.answeredCount).toBe(2);
		}
		await phone.close();
		await screen.close();
	});

	test("a question not opened yet is withheld too", async () => {
		// A deck joined mid-session holds every slide, and the quiz further on has
		// not been asked: its result is no more the room's than a running one's.
		const pres = await goLive([choiceSlide(), quizSlide()]);
		expectWithheld(await audienceTally(pres), 0);
	});

	test("an untimed question stays withheld until the presenter reveals it", async () => {
		const pres = await goLive([quizSlide({ timeLimit: 0 })]);
		await answerOneRightOneWrong(pres);
		expectWithheld(await audienceTally(pres), 2);

		const reveal = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(reveal.status).toBe(200);
		const revealed = await audienceTally(pres);
		expect(quizResultWithheld(revealed)).toBe(false);
		expect(revealed.scoring.correctCount).toBe(1);
	});

	// ── Who is exempt, and who is not ───────────────────────────

	test("the edit token reads the real counts and score, in either slot", async () => {
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);

		for (const headers of [
			{ Authorization: `Bearer ${pres.creatorToken}` },
			{ [EDIT_TOKEN_HEADER]: pres.creatorToken },
		]) {
			const tally = await read(`/api/presentations/${pres.id}/results/qz`, headers);
			expect(quizResultWithheld(tally)).toBe(false);
			expect(tally.options.map((option: AnyJson) => option.count)).toEqual([
				1, 1, 0,
			]);
			expect(tally.scoring.correctCount).toBe(1);
			expect(tally.scoring.correctShare).toBe(50);
			expect((await deckEntry(pres, "qz", headers)).scoring.correctCount).toBe(1);
		}
	});

	test("the results link does not lift it", async () => {
		// The link is a delegation of the tallies under every reveal mode, and it
		// authorizes no running question's answer key (REQ098). The counts are
		// that key read off the room.
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		const resultsToken = await mintResultsLink(pres);
		const headers = { [RESULTS_TOKEN_HEADER]: resultsToken };

		expectWithheld(await deckEntry(pres, "qz", headers), 2);
		expectWithheld(
			await read(`/api/presentations/${pres.id}/results/qz`, headers),
			2,
		);
	});

	test("a claim on the request lifts nothing", async () => {
		// Only a proven edit credential does; a flag the caller sets is not one.
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		expectWithheld(
			await read(
				`/api/presentations/${pres.id}/results/qz?canEdit=true&role=presenter`,
			),
			2,
		);
	});

	// ── When it becomes the room's ──────────────────────────────

	test("the counts and the score reach the room once the window is over", async () => {
		const pres = await goLive([quizSlide({ timeLimit: 1 })]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		expectWithheld(await audienceTally(pres), 2);

		await wait(1_100 + QUIZ_SUBMISSION_GRACE_MS);
		const over = await audienceTally(pres);
		expect(quizResultWithheld(over)).toBe(false);
		expect(over.scoring.closed).toBe(true);
		expect(over.options.map((option: AnyJson) => option.count)).toEqual([1, 1, 0]);
		expect(over.scoring.correctCount).toBe(1);
		expect(over.scoring.correctShare).toBe(50);
	}, 10_000);

	test("under 'on click' the result arrives with the presenter's reveal", async () => {
		const pres = await goLive([quizSlide()], { resultsVisibility: "on-click" });
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		// Collecting silently: the whole tally is the withheld marker.
		expect((await audienceTally(pres)).withheld).toBe(true);

		const reveal = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "qz" }) },
		);
		expect(reveal.status).toBe(200);
		const revealed = await audienceTally(pres);
		expect(quizResultWithheld(revealed)).toBe(false);
		expect(revealed.options.map((option: AnyJson) => option.count)).toEqual([
			1, 1, 0,
		]);
		expect(revealed.scoring.correctCount).toBe(1);
	});

	// ── Segmentation, of and by a running question ─────────────

	test("breaking a running question down by another slide withholds every group's result", async () => {
		const pres = await goLive([choiceSlide(), quizSlide()]);
		const room = Array.from({ length: 12 }, (_, index) => `p${index}`);
		for (const [index, participantId] of room.entries()) {
			await answer(pres.id, participantId, index % 2 ? "red" : "blue", "mc");
		}
		await goToSlide(pres, 1);
		for (const [index, participantId] of room.entries()) {
			await answer(pres.id, participantId, index % 3 ? "venus" : "mercury");
		}

		const path = `/api/presentations/${pres.id}/results/qz/segments?by=mc`;
		const audience = await read(path);
		expect(audience.withheld).toBe(false);
		const published = audience.segments.filter(
			(segment: AnyJson) => !segment.suppressed,
		);
		expect(published.length).toBeGreaterThan(0);
		for (const segment of published) {
			expectWithheld(segment.results, segment.respondentCount);
		}

		const editor = await read(path, { Authorization: `Bearer ${pres.creatorToken}` });
		for (const segment of editor.segments) {
			expect(quizResultWithheld(segment.results)).toBe(false);
		}
	});

	test("grouping by a running question is withheld from the audience and the results link", async () => {
		// Each group is one of the question's options, sized by who picked it —
		// the per-option count under another name.
		const pres = await goLive([quizSlide(), choiceSlide()]);
		await startTimer(pres);
		await answerOneRightOneWrong(pres);
		await goToSlide(pres, 1);
		await answer(pres.id, "p1", "red", "mc");
		await answer(pres.id, "p2", "blue", "mc");

		const path = `/api/presentations/${pres.id}/results/mc/segments?by=qz`;
		const resultsToken = await mintResultsLink(pres);
		for (const headers of [{}, { [RESULTS_TOKEN_HEADER]: resultsToken }]) {
			const breakdown = await read(path, headers);
			expect(breakdown.withheld).toBe(true);
			expect(breakdown.withheldReason).toBe("quiz-not-over");
			expect(breakdown.segments).toEqual([]);
		}

		const editor = await read(path, { Authorization: `Bearer ${pres.creatorToken}` });
		expect(editor.withheld).toBe(false);
		expect(editor.withheldReason).toBe(null);
		expect(editor.segments.length).toBeGreaterThan(0);
	});

	// ── What does not change ────────────────────────────────────

	test("a plain choice slide keeps its counts for everybody", async () => {
		const pres = await goLive([choiceSlide()]);
		await answer(pres.id, "p1", "red", "mc");
		await answer(pres.id, "p2", "red", "mc");
		const tally = await audienceTally(pres, "mc");
		expect(quizResultWithheld(tally)).toBe(false);
		expect(tally.options.map((option: AnyJson) => option.count)).toEqual([2, 0]);
		expect(tally.scoring).toBe(null);
	});

	test("an editor's empty tally still reads as nobody having answered", async () => {
		// `null` averages are the unanswered shape too; `correctCount` is what
		// tells the two apart, and on an editor read it is a number.
		const pres = await goLive([quizSlide()]);
		await startTimer(pres);
		const tally = await editorTally(pres);
		expect(quizResultWithheld(tally)).toBe(false);
		expect(tally.scoring.correctCount).toBe(0);
		expect(tally.scoring.averagePoints).toBe(null);
	});
});
