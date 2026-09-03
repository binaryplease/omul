/**
 * Integration tests for the Pin on Image question type (REQ051, REQ052, REQ053).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ051 — a participant pins a spot; the tally reports every pin and the
 *     centre of the cloud, and one participant holds one pin
 *   - REQ052 — the image round-trips through create → fetch, and a slide with no
 *     image accepts no pins at all
 *   - REQ053 — the target area is counted, and it is only *reported* to a caller
 *     that may see it: an editor always, the room on the organizer's reveal
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the grid / guess /
 * p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

const IMAGE_URL = "https://example.test/heart.png";

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

async function create(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Pin Test", slides, ...deck }),
	});
	expect(res.status).toBe(201);
	return await res.json();
}

async function createAndStart(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const pres = await create(slides, deck);
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

/** Place one participant's pin at `(x, y)` on the image's per-mille lattice. */
async function pin(
	presentationId: string,
	participantId: string,
	x: number,
	y: number,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			slideId: "pn",
			value: `${x},${y}`,
			participantId,
		}),
	});
}

async function results(
	presentationId: string,
	slideId: string,
	token?: string,
): Promise<AnyJson> {
	const res = token
		? await authed(`/api/presentations/${presentationId}/results/${slideId}`, token)
		: await fetch(`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`);
	expect(res.status).toBe(200);
	return await res.json();
}

/** A pin slide on a picture, with an optional target area in its middle. */
function pinSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "pn",
		type: "pin-image",
		question: "Where is the aorta?",
		mediaUrl: IMAGE_URL,
		mediaAlt: "Cross-section of a heart",
		pinArea: { x: 400, y: 300, width: 200, height: 150 },
		...overrides,
	};
}

describe("Pin on Image question type integration", () => {
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

	// ── REQ052 — the image the question is asked on ────────────

	test("the image and its alt text round-trip through create → fetch", async () => {
		const pres = await createAndStart([pinSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].type).toBe("pin-image");
		expect(fetched.slides[0].mediaUrl).toBe(IMAGE_URL);
		expect(fetched.slides[0].mediaAlt).toBe("Cross-section of a heart");
	});

	test("the results payload carries the image, so a client draws the canvas from the tally", async () => {
		const pres = await createAndStart([pinSlide()]);
		const payload = await results(pres.id, "pn");
		expect(payload.type).toBe("pin-image");
		expect(payload.image).toEqual({
			url: IMAGE_URL,
			alt: "Cross-section of a heart",
		});
	});

	test("a slide with no image accepts no pins at all (REQ052)", async () => {
		// No image, no coordinate space: a stored pin would be a position on a
		// picture that does not exist.
		const pres = await createAndStart([
			pinSlide({ mediaUrl: "", pinArea: null }),
		]);
		expect((await pin(pres.id, "p1", 500, 500)).status).toBe(400);
		expect((await results(pres.id, "pn")).pinCount).toBe(0);
	});

	// ── REQ051 — the room's pins ───────────────────────────────

	test("pins are reported individually and as the centre of the cloud", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		await pin(pres.id, "p1", 200, 400);
		await pin(pres.id, "p2", 400, 600);

		const payload = await results(pres.id, "pn");
		expect(payload.pinCount).toBe(2);
		expect(payload.pins).toEqual([
			{ x: 200, y: 400 },
			{ x: 400, y: 600 },
		]);
		expect(payload.averageX).toBe(300);
		expect(payload.averageY).toBe(500);
	});

	test("an average is reported to two decimals", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		await pin(pres.id, "p1", 1, 0);
		await pin(pres.id, "p2", 2, 0);
		await pin(pres.id, "p3", 2, 0);

		expect((await results(pres.id, "pn")).averageX).toBe(1.67);
	});

	test("one participant holds one pin — moving it replaces it", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		await pin(pres.id, "p1", 100, 100);
		await pin(pres.id, "p1", 900, 900);
		await pin(pres.id, "p2", 500, 500);

		const payload = await results(pres.id, "pn");
		expect(payload.pinCount).toBe(2);
		expect(payload.totalVotes).toBe(2);
		expect(payload.averageX).toBe(700);
	});

	test("every corner of the image is a pin the boundary accepts", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		expect((await pin(pres.id, "p1", 0, 0)).status).toBe(200);
		expect((await pin(pres.id, "p2", 1000, 1000)).status).toBe(200);
		expect((await results(pres.id, "pn")).pinCount).toBe(2);
	});

	test("rejects a pin off the image rather than pulling it onto the edge", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		expect((await pin(pres.id, "p1", 1001, 500)).status).toBe(400);
		expect((await pin(pres.id, "p1", 500, -1)).status).toBe(400);
		expect((await results(pres.id, "pn")).pinCount).toBe(0);
	});

	test("rejects a value that is not a coordinate pair", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slideId: "pn",
				value: "middle",
				participantId: "p1",
			}),
		});
		expect(res.status).toBe(400);
		expect((await results(pres.id, "pn")).totalVotes).toBe(0);
	});

	test("an empty payload is well-formed before any pin lands", async () => {
		const pres = await createAndStart([pinSlide({ pinArea: null })]);
		const payload = await results(pres.id, "pn");
		expect(payload.totalVotes).toBe(0);
		expect(payload.pinCount).toBe(0);
		expect(payload.pins).toEqual([]);
		// Explicitly null, never a 0,0 that would draw a pin in the corner.
		expect("averageX" in payload).toBe(true);
		expect(payload.averageX).toBe(null);
		expect(payload.averageY).toBe(null);
		// No target area authored: all three correctness keys present and null.
		expect(payload.correctArea).toBe(null);
		expect(payload.correctCount).toBe(null);
		expect(payload.correctShare).toBe(null);
	});

	// ── REQ053 — the target area ───────────────────────────────

	test("pins inside the target area are counted and shared", async () => {
		const pres = await createAndStart([pinSlide()]);
		// The area is x 400–600, y 300–450.
		await pin(pres.id, "p1", 500, 380);
		await pin(pres.id, "p2", 400, 300);
		await pin(pres.id, "p3", 900, 900);
		await pin(pres.id, "p4", 601, 380);

		const payload = await results(pres.id, "pn", pres.creatorToken);
		expect(payload.correctArea).toEqual({
			x: 400,
			y: 300,
			width: 200,
			height: 150,
		});
		expect(payload.correctCount).toBe(2);
		expect(payload.correctShare).toBe(50);
	});

	test("the share stays null while nobody has pinned", async () => {
		// A percentage of no responses does not exist — distinct from 0%.
		const payload = await results(
			(await createAndStart([pinSlide()])).id,
			"pn",
		);
		expect(payload.correctCount).toBe(0);
		expect(payload.correctShare).toBe(null);
	});

	test("a target area is withheld from the room until it is revealed", async () => {
		const pres = await createAndStart(
			[pinSlide({ resultsVisibility: "on-click" })],
			{ resultsVisibility: "on-click" },
		);
		await pin(pres.id, "p1", 500, 380);

		// An `on-click` slide publishes nothing before the reveal (REQ016), so
		// what the room is kept from is not the target alone but the whole tally
		// it would be drawn on. The target could not leak through a payload the
		// room was never sent.
		const audience = await results(pres.id, "pn");
		expect(audience.withheld).toBe(true);
		expect(audience.correctArea).toBeUndefined();
		expect(audience.pins).toBeUndefined();

		// The organizer's own payload carries it, on the same request.
		const owner = await results(pres.id, "pn", pres.creatorToken);
		expect(owner.correctArea).not.toBe(null);
		expect(owner.correctCount).toBe(1);

		// On the reveal the room is handed the tally, target included — the pins
		// and the region they were aimed at arrive together, which is the whole
		// point of the reveal on a hotspot check.
		const revealRes = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "pn" }) },
		);
		expect(revealRes.status).toBe(200);
		const revealed = await results(pres.id, "pn");
		expect(revealed.withheld).toBeUndefined();
		expect(revealed.pinCount).toBe(1);
		expect(revealed.correctArea).not.toBe(null);
		expect(revealed.correctCount).toBe(1);
	});

	test("revealing the slide hands the room the target area", async () => {
		const pres = await createAndStart(
			[pinSlide({ resultsVisibility: "on-click" })],
			{ resultsVisibility: "on-click" },
		);
		await pin(pres.id, "p1", 500, 380);
		const reveal = await authed(
			`/api/presentations/${pres.id}/reveal`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ slideId: "pn", reveal: true }) },
		);
		expect(reveal.status).toBe(200);

		const audience = await results(pres.id, "pn");
		expect(audience.correctArea).toEqual({
			x: 400,
			y: 300,
			width: 200,
			height: 150,
		});
		expect(audience.correctCount).toBe(1);
		expect(audience.correctShare).toBe(100);
	});

	test("the deck a participant fetches carries no withheld target area", async () => {
		const pres = await createAndStart(
			[pinSlide({ resultsVisibility: "on-click" })],
			{ resultsVisibility: "on-click" },
		);
		// By join code — the participant's own path into the deck.
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].pinArea).toBe(null);
		// A client cannot read the answer off the network tab, whichever route it
		// asks through.
		const byId = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(byId.slides[0].pinArea).toBe(null);
		// The organizer's own fetch keeps it.
		const owner = await (
			await authed(`/api/presentations/${pres.id}`, pres.creatorToken)
		).json();
		expect(owner.slides[0].pinArea).not.toBe(null);
	});

	test("with instant results the target rides the deck from the start", async () => {
		// The room is watching the aggregate drawn over the target live, so
		// withholding the target while showing the tally would be incoherent.
		const pres = await createAndStart([pinSlide()]);
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].pinArea).not.toBe(null);
	});

	test("a private slide never hands the room its target area", async () => {
		const pres = await createAndStart([
			pinSlide({ resultsVisibility: "private" }),
		]);
		await pin(pres.id, "p1", 500, 380);
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].pinArea).toBe(null);
		// A private slide publishes no tally at all (REQ017), so the room gets
		// neither the pins nor the region they were aimed at — while the deck
		// payload above still nulls the area for the belt-and-braces reason it
		// always did.
		const audience = await results(pres.id, "pn");
		expect(audience.withheld).toBe(true);
		expect(audience.correctArea).toBeUndefined();
		// The organizer reads it under `private` exactly as under every other
		// mode: "never on screen" is not "never recorded" (REQ017).
		const owner = await results(pres.id, "pn", pres.creatorToken);
		expect(owner.pinCount).toBe(1);
		expect(owner.correctArea).not.toBe(null);
	});

	test("an area that runs off the image counts as no area at all", async () => {
		// A hand-built deck can carry one; the tally reads it the way every other
		// surface does, so "how many were inside?" is never a number about a region
		// participants could not reach.
		const pres = await createAndStart([
			pinSlide({ pinArea: { x: 900, y: 0, width: 200, height: 100 } }),
		]);
		await pin(pres.id, "p1", 950, 50);
		const payload = await results(pres.id, "pn", pres.creatorToken);
		expect(payload.correctArea).toBe(null);
		expect(payload.correctCount).toBe(null);
		expect(payload.pinCount).toBe(1);
	});
});
