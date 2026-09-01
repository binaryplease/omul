/**
 * Integration tests for the video slide (REQ064).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * What is worth an integration test here is not which player a URL opens — that
 * is the resolver, tested next door — but the *round trip and its absences*:
 *
 *   - a video slide survives create → fetch, and reaches a participant's phone
 *     through the join-code lookup with the URL byte for byte as it was typed
 *   - editing the deck replaces the URL
 *   - **nothing is hosted.** The response carries a link and nothing else: no
 *     uploaded file, no stored copy, no proxied path this service would have to
 *     serve. REQ064 says the file is not hosted here, and the shape of the
 *     response is where that is either true or quietly stopped being true.
 *   - a URL no player may be pointed at is still *stored* as typed, because the
 *     boundary is not the thing that decides what plays — the renderer is, and
 *     it refuses it. Storing it verbatim is what lets the organizer see what
 *     they wrote instead of finding it silently deleted.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the pin / grid /
 * slide-text harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { slideVideoFor } from "./schemas";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const FILE_URL = "https://example.com/talks/keynote.mp4";

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

async function createOk(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Video deck", slides }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

function videoSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "vd",
		type: "video",
		question: "The keynote",
		mediaUrl: YOUTUBE_URL,
		body: "Recorded last spring.",
		...overrides,
	};
}

describe("video slide integration (REQ064)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes);

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
	});

	afterAll(async () => {
		// The in-memory store is a process-wide singleton shared with the other
		// integration suites in this run, so it is not closed here — bun tears it
		// down with the process.
		await server?.stop();
	});

	test("a video slide round-trips through create → fetch", async () => {
		const pres = await createOk([videoSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].type).toBe("video");
		expect(fetched.slides[0].mediaUrl).toBe(YOUTUBE_URL);
		expect(fetched.slides[0].question).toBe("The keynote");
		expect(fetched.slides[0].body).toBe("Recorded last spring.");
	});

	test("the phone that joined by code gets the same link the editor wrote", async () => {
		// The projector and the room's phones play the same slide through the same
		// resolver, so a boundary that handed one of them a different string would
		// be a deck that plays two different videos.
		const pres = await createOk([videoSlide({ mediaUrl: FILE_URL })]);
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].mediaUrl).toBe(FILE_URL);
		expect(slideVideoFor(byCode.slides[0])).toEqual({
			kind: "file",
			url: FILE_URL,
		});
	});

	test("the deck carries a link and nothing else — no file is hosted here", async () => {
		// REQ064's own sentence, asserted against the response: the slide holds the
		// URL the organizer typed, and this service adds no copy of the video, no
		// upload id and no path of its own to serve it from.
		const pres = await createOk([videoSlide()]);
		const slide = (
			await (await fetch(`${baseUrl}/api/presentations/${pres.id}`)).json()
		).slides[0];
		expect(slide.mediaUrl).toBe(YOUTUBE_URL);
		expect(slideVideoFor(slide)).toEqual({
			kind: "embed",
			url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
		});
		// Nothing on the stored slide points at this deployment.
		const stored = JSON.stringify(slide);
		expect(stored).not.toContain(baseUrl);
	});

	test("editing the deck replaces the video", async () => {
		const pres = await createOk([videoSlide()]);
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({ slides: [videoSlide({ mediaUrl: FILE_URL })] }),
			},
		);
		expect(patched.status).toBe(200);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].mediaUrl).toBe(FILE_URL);
	});

	test("a URL no player may be pointed at is stored as typed, and refused on render", async () => {
		// The server does not decide what plays — the renderer does, through the one
		// resolver every surface reads. Storing the string verbatim is what lets the
		// organizer find and fix what they pasted.
		const written = "javascript:alert(1)";
		const pres = await createOk([videoSlide({ mediaUrl: written })]);
		const slide = (
			await (await fetch(`${baseUrl}/api/presentations/${pres.id}`)).json()
		).slides[0];
		expect(slide.mediaUrl).toBe(written);
		expect(slideVideoFor(slide)).toBeNull();
	});

	test("a video slide has no answers to aggregate — an empty tally, like the other content slides", async () => {
		// There is no vote path onto a content slide, so its aggregate is the empty
		// one every content slide reports. Asserted against a text slide in the same
		// deck rather than against a literal: the point is that the new type behaves
		// like the family it joined, not that the empty shape has a particular spelling.
		const pres = await createOk([
			videoSlide(),
			{ id: "tx", type: "text", question: "Intro" },
		]);
		const video = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/vd`)
		).json();
		const text = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/tx`)
		).json();
		expect(video).toEqual({ type: "video", totalVotes: 0 });
		expect(video.totalVotes).toBe(text.totalVotes);
	});

	test("the creator's token never rides along on a video deck", async () => {
		// The auth invariant every response carries (docs/api.md): a fetched deck
		// exposes neither `creatorTokenHash` nor `creatorId`, whatever it holds.
		const pres = await createOk([videoSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.creatorTokenHash).toBeUndefined();
		expect(fetched.creatorId).toBeUndefined();
	});
});
