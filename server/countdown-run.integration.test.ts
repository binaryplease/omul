/**
 * Integration tests for running a countdown slide (REQ107), over the real HTTP
 * surface.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore: the
 * presenter starts, pauses, resumes and resets a countdown slide through
 * `POST /presentations/:id/countdown`, the run is recorded on the presentation
 * as `countdownRuns` (server-managed live state, like `slideStartedAt`), and
 * every reader of the deck — the presenter's fetch and the join door a phone
 * comes in through — reads the same run beside `serverNow`, which is what a
 * client that joins or reloads during a run or a pause draws the clock from.
 *
 * The broadcast half (`slide.countdown`) is asserted in `ws.integration.test.ts`,
 * which holds the socket harness.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the other harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { countdownPhase, countdownRemainingSeconds } from "./schemas";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

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

/** A live deck holding two countdowns and a question. */
async function createAndStart(): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Countdown Test",
			slides: [
				{ id: "break", type: "countdown", question: "Break", countdownSeconds: 300 },
				{ id: "think", type: "countdown", question: "Think", countdownSeconds: 30 },
				{ id: "sprint", type: "countdown", question: "Sprint", countdownSeconds: 1 },
				{
					id: "q1",
					type: "multiple-choice",
					question: "Pick",
					options: [
						{ id: "a", text: "A" },
						{ id: "b", text: "B" },
					],
				},
			],
		}),
	});
	expect(response.status).toBe(201);
	const pres = await response.json();
	const started = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(started.status).toBe(200);
	return pres;
}

async function setCountdown(
	pres: AnyJson,
	slideId: string,
	action: "start" | "pause" | "reset",
	token: string = pres.creatorToken,
): Promise<Response> {
	return authed(`/api/presentations/${pres.id}/countdown`, token, {
		method: "POST",
		body: JSON.stringify({ slideId, action }),
	});
}

/** Sends the action and answers with the deck's runs in the response. */
async function runsAfter(
	pres: AnyJson,
	slideId: string,
	action: "start" | "pause" | "reset",
): Promise<AnyJson> {
	const response = await setCountdown(pres, slideId, action);
	expect(response.status).toBe(200);
	return (await response.json()).countdownRuns;
}

function pauseFor(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Lets the one-second `sprint` slide run out. */
const SPRINT_OVER_MS = 1_100;

/** The deck as anybody in the room reads it, through the join door. */
async function joined(pres: AnyJson): Promise<AnyJson> {
	const response = await fetch(`${baseUrl}/api/join/${pres.code}`);
	expect(response.status).toBe(200);
	return await response.json();
}

describe("running a countdown slide (REQ107)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

		const app = new Elysia().use(presentationRoutes);
		app.listen({ port: 0, hostname: "127.0.0.1" });
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("a fresh deck has no countdown run", async () => {
		const pres = await createAndStart();
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("starting records the full length and the server's instant", async () => {
		const pres = await createAndStart();
		const before = Date.now();
		const response = await setCountdown(pres, "break", "start");
		expect(response.status).toBe(200);
		const deck = await response.json();
		const run = deck.countdownRuns.break;
		expect(run.remainingMs).toBe(300_000);
		const resumedAt = Date.parse(run.resumedAt);
		expect(resumedAt).toBeGreaterThanOrEqual(before - 1000);
		expect(resumedAt).toBeLessThanOrEqual(Date.now() + 1000);
		// The authored slide is untouched: the run is live state, not authoring.
		expect(
			deck.slides.find((slide: AnyJson) => slide.id === "break").countdownSeconds,
		).toBe(300);
	});

	test("a phone joining mid-run reads the run and the server's clock, so it draws the time left", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		const deck = await joined(pres);
		expect(typeof deck.serverNow).toBe("string");
		// Read against the server's own clock, a run started a moment ago is
		// within a second of its full length — not past it, and not reset by the
		// join.
		const slide = deck.slides.find((candidate: AnyJson) => candidate.id === "break");
		const seconds = countdownRemainingSeconds(
			slide,
			deck.countdownRuns.break,
			Date.parse(deck.serverNow),
		);
		expect(seconds).toBeGreaterThanOrEqual(299);
		expect(seconds).toBeLessThanOrEqual(300);
	});

	test("the presenter's reload reads the same run", async () => {
		const pres = await createAndStart();
		const started = await runsAfter(pres, "break", "start");
		const reloaded = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
		);
		expect(reloaded.status).toBe(200);
		const deck = await reloaded.json();
		expect(deck.countdownRuns).toEqual(started);
		expect(typeof deck.serverNow).toBe("string");
	});

	test("pausing freezes the clock at the time left on the server's clock", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		await pauseFor(30);
		const run = (await runsAfter(pres, "break", "pause")).break;
		expect(run.resumedAt).toBeNull();
		expect(run.remainingMs).toBeLessThan(300_000);
		expect(run.remainingMs).toBeGreaterThan(295_000);
	});

	test("the request carries no time: a time left sent by a client is ignored", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		const response = await authed(
			`/api/presentations/${pres.id}/countdown`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ slideId: "break", action: "pause", remainingMs: 5 }),
			},
		);
		expect(response.status).toBe(200);
		expect((await response.json()).countdownRuns.break.remainingMs).toBeGreaterThan(
			295_000,
		);
	});

	test("a phone joining during a pause draws the frozen time, however long the pause", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		const frozen = (await runsAfter(pres, "break", "pause")).break;
		await pauseFor(30);
		const deck = await joined(pres);
		expect(deck.countdownRuns.break).toEqual(frozen);
		const slide = deck.slides.find((candidate: AnyJson) => candidate.id === "break");
		const serverNow = Date.parse(deck.serverNow);
		expect(countdownPhase(deck.countdownRuns.break, serverNow)).toBe("paused");
		expect(countdownRemainingSeconds(slide, deck.countdownRuns.break, serverNow)).toBe(
			Math.ceil(frozen.remainingMs / 1000),
		);
	});

	test("resuming continues from the frozen time, not from the top", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		await pauseFor(20);
		const frozen = (await runsAfter(pres, "break", "pause")).break;
		await pauseFor(20);
		const before = Date.now();
		const resumed = (await runsAfter(pres, "break", "start")).break;
		expect(resumed.remainingMs).toBe(frozen.remainingMs);
		expect(Date.parse(resumed.resumedAt)).toBeGreaterThanOrEqual(before - 1000);
	});

	test("a start sent to a running clock changes nothing", async () => {
		const pres = await createAndStart();
		const first = await runsAfter(pres, "break", "start");
		await pauseFor(5);
		expect(await runsAfter(pres, "break", "start")).toEqual(first);
		expect((await joined(pres)).countdownRuns).toEqual(first);
	});

	test("a pause sent to a paused clock keeps the frozen time", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		const first = await runsAfter(pres, "break", "pause");
		await pauseFor(5);
		expect(await runsAfter(pres, "break", "pause")).toEqual(first);
		expect((await joined(pres)).countdownRuns).toEqual(first);
	});

	test("a pause sent to a clock with no run changes nothing", async () => {
		const pres = await createAndStart();
		expect(await runsAfter(pres, "break", "pause")).toEqual({});
	});

	test("a reset returns a running clock to its full length, not running", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		expect(await runsAfter(pres, "break", "reset")).toEqual({});
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("a reset returns a paused clock to its full length, not running", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		await setCountdown(pres, "break", "pause");
		expect(await runsAfter(pres, "break", "reset")).toEqual({});
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("a reset on a clock already at its full length changes nothing", async () => {
		const pres = await createAndStart();
		expect(await runsAfter(pres, "break", "reset")).toEqual({});
	});

	test("after a reset, starting runs the full length from a new instant", async () => {
		const pres = await createAndStart();
		const first = (await runsAfter(pres, "break", "start")).break;
		await pauseFor(5);
		await setCountdown(pres, "break", "reset");
		await pauseFor(5);
		const second = (await runsAfter(pres, "break", "start")).break;
		expect(second.remainingMs).toBe(300_000);
		expect(Date.parse(second.resumedAt)).toBeGreaterThan(Date.parse(first.resumedAt));
	});

	test("a clock that reached 0:00 stays there until a reset", async () => {
		const pres = await createAndStart();
		const expired = await runsAfter(pres, "sprint", "start");
		await pauseFor(SPRINT_OVER_MS);
		const deck = await joined(pres);
		const slide = deck.slides.find((candidate: AnyJson) => candidate.id === "sprint");
		const serverNow = Date.parse(deck.serverNow);
		expect(countdownPhase(deck.countdownRuns.sprint, serverNow)).toBe("finished");
		expect(countdownRemainingSeconds(slide, deck.countdownRuns.sprint, serverNow)).toBe(0);
		// Neither half of the control moves it.
		expect(await runsAfter(pres, "sprint", "pause")).toEqual(expired);
		expect(await runsAfter(pres, "sprint", "start")).toEqual(expired);
		// A reset does.
		expect(await runsAfter(pres, "sprint", "reset")).toEqual({});
	});

	test("lengthening a slide does not bring its finished clock back", async () => {
		const pres = await createAndStart();
		const expired = await runsAfter(pres, "sprint", "start");
		await pauseFor(SPRINT_OVER_MS);
		const deck = await joined(pres);
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: deck.slides.map((slide: AnyJson) =>
						slide.id === "sprint" ? { ...slide, countdownSeconds: 600 } : slide,
					),
				}),
			},
		);
		expect(patched.status).toBe(200);
		const after = await joined(pres);
		expect(after.countdownRuns).toEqual(expired);
		expect(countdownPhase(after.countdownRuns.sprint, Date.parse(after.serverNow))).toBe(
			"finished",
		);
	});

	test("another slide's run survives a start, a pause, a reset and a navigation", async () => {
		const pres = await createAndStart();
		const kept = (await runsAfter(pres, "break", "start")).break;
		await setCountdown(pres, "think", "start");
		await setCountdown(pres, "think", "pause");
		await setCountdown(pres, "think", "reset");
		const navigated = await authed(
			`/api/presentations/${pres.id}/slide`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ index: 3 }) },
		);
		expect(navigated.status).toBe(200);
		expect((await joined(pres)).countdownRuns).toEqual({ break: kept });
	});

	test("moving to another slide leaves a pause standing", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		const paused = await runsAfter(pres, "break", "pause");
		const navigated = await authed(
			`/api/presentations/${pres.id}/slide`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ index: 3 }) },
		);
		expect(navigated.status).toBe(200);
		expect((await joined(pres)).countdownRuns).toEqual(paused);
	});

	test("a slide the deck does not have is a 404 and writes nothing", async () => {
		const pres = await createAndStart();
		for (const action of ["start", "pause", "reset"] as const) {
			expect((await setCountdown(pres, "nope", action)).status).toBe(404);
		}
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("a slide that is not a countdown is refused and writes nothing", async () => {
		const pres = await createAndStart();
		for (const action of ["start", "pause", "reset"] as const) {
			expect((await setCountdown(pres, "q1", action)).status).toBe(400);
		}
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("`action` is required and closed — the request says which it is", async () => {
		const pres = await createAndStart();
		for (const body of [
			{ slideId: "break" },
			{ slideId: "break", action: "stop" },
			{ slideId: "break", running: true },
		]) {
			const response = await authed(
				`/api/presentations/${pres.id}/countdown`,
				pres.creatorToken,
				{ method: "POST", body: JSON.stringify(body) },
			);
			expect(response.status).toBeGreaterThanOrEqual(400);
		}
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("a caller with no credential cannot start a room's countdown", async () => {
		const pres = await createAndStart();
		const response = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/countdown`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slideId: "break", action: "start" }),
			},
		);
		expect(response.status).toBe(401);
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("another deck's edit token does not authorize this one", async () => {
		const pres = await createAndStart();
		const other = await createAndStart();
		const response = await setCountdown(pres, "break", "start", other.creatorToken);
		expect([401, 403]).toContain(response.status);
		expect((await joined(pres)).countdownRuns).toEqual({});
	});

	test("pausing and resetting need the same credential as starting", async () => {
		const pres = await createAndStart();
		const other = await createAndStart();
		const kept = await runsAfter(pres, "break", "start");
		for (const action of ["pause", "reset"] as const) {
			const anonymous = await fetch(
				`${baseUrl}/api/presentations/${pres.id}/countdown`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ slideId: "break", action }),
				},
			);
			expect(anonymous.status).toBe(401);
			const foreign = await setCountdown(pres, "break", action, other.creatorToken);
			expect([401, 403]).toContain(foreign.status);
		}
		expect((await joined(pres)).countdownRuns).toEqual(kept);
	});

	test("an editor's ordinary save cannot write the run", async () => {
		// Server-managed live state: the deck PATCH does not declare it, so a save
		// from the editor mid-session can neither start nor stop a clock.
		const pres = await createAndStart();
		const kept = await runsAfter(pres, "break", "start");
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					title: "Renamed mid-session",
					countdownRuns: { think: { remainingMs: 5, resumedAt: null } },
				}),
			},
		);
		expect(patched.status).toBe(200);
		const deck = await patched.json();
		expect(deck.title).toBe("Renamed mid-session");
		expect(deck.countdownRuns).toEqual(kept);
	});

	test("a deck-wide reset clears running and paused clocks (REQ101)", async () => {
		const pres = await createAndStart();
		await setCountdown(pres, "break", "start");
		await setCountdown(pres, "think", "start");
		await setCountdown(pres, "think", "pause");
		const reset = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(reset.status).toBe(200);
		expect((await reset.json()).countdownRuns).toEqual({});
		expect((await joined(pres)).countdownRuns).toEqual({});
	});
});
