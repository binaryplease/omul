/**
 * Integration tests for the embed slide (REQ066, REQ067, REQ068).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * What is worth an integration test here is not which viewer a link opens —
 * that is the resolver, tested next door — but the *round trip and its
 * absences*:
 *
 *   - a deck of all three providers survives create → fetch, and reaches a
 *     participant's phone through the join-code lookup with each URL byte for
 *     byte as it was typed
 *   - editing the deck replaces the link
 *   - **nothing is hosted or converted.** The response carries a link and
 *     nothing else: no uploaded file, no rendered copy, no proxied path this
 *     service would have to serve. REQ066/067/068 are all "externally hosted",
 *     and the shape of the response is where that is either true or quietly
 *     stopped being true.
 *   - a URL no frame may be pointed at is still *stored* as typed, because the
 *     boundary is not the thing that decides what is framed — the renderer is,
 *     through the one resolver, and it refuses it. Storing it verbatim is what
 *     lets the organizer see what they wrote instead of finding it silently
 *     deleted.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the video / pin /
 * grid harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { slideEmbedFor } from "./schemas";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

const GOOGLE_URL =
	"https://docs.google.com/presentation/d/1FvIH-DcTLBoP2Zk9OaMHV3sJ4mQr7yXaBcDeFgHiJkL/edit?usp=sharing";
const POWERPOINT_URL = "https://example.com/talks/keynote.pptx";
const MIRO_URL = "https://miro.com/app/board/uXjVNQOLDDk=/";

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
		body: JSON.stringify({ title: "Embed deck", slides }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

function embedSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "em",
		type: "embed",
		question: "Last quarter's numbers",
		mediaUrl: GOOGLE_URL,
		body: "The deck the finance team already keeps.",
		...overrides,
	};
}

describe("embed slide integration (REQ066, REQ067, REQ068)", () => {
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

	test("an embed slide round-trips through create → fetch", async () => {
		const pres = await createOk([embedSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].type).toBe("embed");
		expect(fetched.slides[0].mediaUrl).toBe(GOOGLE_URL);
		expect(fetched.slides[0].question).toBe("Last quarter's numbers");
		expect(fetched.slides[0].body).toBe(
			"The deck the finance team already keeps.",
		);
	});

	test("all three providers live in one deck, side by side", async () => {
		// The three requirements are one slide type, and this is the assertion that
		// says so: a PowerPoint, a Google Slides deck and a Miro board are the same
		// slide carrying different links, in one deck, with no per-provider path
		// through the boundary.
		const pres = await createOk([
			embedSlide({ id: "gs", mediaUrl: GOOGLE_URL }),
			embedSlide({ id: "pp", mediaUrl: POWERPOINT_URL }),
			embedSlide({ id: "mb", mediaUrl: MIRO_URL }),
		]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides.map((slide: AnyJson) => slide.type)).toEqual([
			"embed",
			"embed",
			"embed",
		]);
		expect(
			fetched.slides.map(
				(slide: AnyJson) => slideEmbedFor(slide)?.provider ?? null,
			),
		).toEqual(["google-slides", "powerpoint", "miro"]);
	});

	test("the phone that joined by code gets the same link the editor wrote", async () => {
		// The projector and the room's phones frame the same slide through the same
		// resolver, so a boundary that handed one of them a different string would
		// be a deck showing two different things.
		const pres = await createOk([embedSlide({ mediaUrl: MIRO_URL })]);
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].mediaUrl).toBe(MIRO_URL);
		expect(slideEmbedFor(byCode.slides[0])).toEqual({
			provider: "miro",
			url: "https://miro.com/app/live-embed/uXjVNQOLDDk=/",
		});
	});

	test("the deck carries a link and nothing else — nothing is hosted or converted here", async () => {
		// REQ066's own word, asserted against the response: the slide holds the URL
		// the organizer typed, and this service adds no copy of the deck, no
		// converted slides, no upload id and no path of its own to serve it from.
		const pres = await createOk([embedSlide({ mediaUrl: POWERPOINT_URL })]);
		const slide = (
			await (await fetch(`${baseUrl}/api/presentations/${pres.id}`)).json()
		).slides[0];
		expect(slide.mediaUrl).toBe(POWERPOINT_URL);
		expect(slideEmbedFor(slide)).toEqual({
			provider: "powerpoint",
			url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(POWERPOINT_URL)}`,
		});
		// Nothing on the stored slide points at this deployment.
		const stored = JSON.stringify(slide);
		expect(stored).not.toContain(baseUrl);
	});

	test("editing the deck replaces the embedded material", async () => {
		const pres = await createOk([embedSlide()]);
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({ slides: [embedSlide({ mediaUrl: MIRO_URL })] }),
			},
		);
		expect(patched.status).toBe(200);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].mediaUrl).toBe(MIRO_URL);
	});

	test("a URL no frame may be pointed at is stored as typed, and refused on render", async () => {
		// The server does not decide what is framed — the renderer does, through the
		// one resolver every surface reads. Storing the string verbatim is what lets
		// the organizer find and fix what they pasted.
		const written = "javascript:alert(1)";
		const pres = await createOk([embedSlide({ mediaUrl: written })]);
		const slide = (
			await (await fetch(`${baseUrl}/api/presentations/${pres.id}`)).json()
		).slides[0];
		expect(slide.mediaUrl).toBe(written);
		expect(slideEmbedFor(slide)).toBeNull();
	});

	test("an embed slide has no answers to aggregate — an empty tally, like the other content slides", async () => {
		// There is no vote path onto a content slide, so its aggregate is the empty
		// one every content slide reports — including a Miro board, which the room
		// works in without anything coming back here. Asserted against a text slide
		// in the same deck rather than against a literal: the point is that the new
		// type behaves like the family it joined.
		const pres = await createOk([
			embedSlide({ id: "em", mediaUrl: MIRO_URL }),
			{ id: "tx", type: "text", question: "Intro" },
		]);
		const embed = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/em`)
		).json();
		const text = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/tx`)
		).json();
		expect(embed).toEqual({ type: "embed", totalVotes: 0 });
		expect(embed.totalVotes).toBe(text.totalVotes);
	});

	test("the creator's token never rides along on an embed deck", async () => {
		// The auth invariant every response carries (docs/api.md): a fetched deck
		// exposes neither `creatorTokenHash` nor `creatorId`, whatever it holds.
		const pres = await createOk([embedSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.creatorTokenHash).toBeUndefined();
		expect(fetched.creatorId).toBeUndefined();
	});
});
