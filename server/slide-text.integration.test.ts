/**
 * Integration tests for formatted slide text (REQ088 hyperlinks, REQ089
 * markdown, REQ091 text size).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore.
 * What is worth an integration test here is not the formatting — that is the
 * client's parser, tested next door — but the *round trip*: the organizer types
 * markup and picks a size in the editor, and the room reads them back off a
 * different endpoint on a different device. So:
 *
 *   - the markup and the step survive create → fetch, byte for byte and step
 *     for step, on both the owner's fetch and the join-code lookup a
 *     participant's phone uses
 *   - editing them through PATCH replaces them
 *   - a size no surface implements is refused at the boundary rather than
 *     stored for a projector to trip over
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the pin / grid /
 * guess harnesses.
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

/** A body with every part of the subset the requirement names. */
const MARKDOWN_BODY = [
	"# Before we start",
	"",
	"- **Bring** your laptop",
	"- Read [the handbook](https://example.com/handbook)",
	"",
	"1. Sign in",
	"2. Join with the code",
	"",
	"Questions go to https://example.com/support",
].join("\n");

const MARKDOWN_QUESTION = "**Q3** — see [the report](https://example.com/q3)";

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

async function create(slides: AnyJson[]): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Formatted text", slides }),
	});
}

async function createOk(slides: AnyJson[]): Promise<AnyJson> {
	const res = await create(slides);
	expect(res.status).toBe(201);
	return await res.json();
}

function textSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "tx",
		type: "text",
		question: MARKDOWN_QUESTION,
		body: MARKDOWN_BODY,
		...overrides,
	};
}

describe("formatted slide text integration", () => {
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

	// ── REQ088 / REQ089 — the markup is what was typed ─────────

	test("markdown and links round-trip through create → fetch, byte for byte", async () => {
		const pres = await createOk([textSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].question).toBe(MARKDOWN_QUESTION);
		expect(fetched.slides[0].body).toBe(MARKDOWN_BODY);
	});

	test("the phone that joined by code reads the same string the editor wrote", async () => {
		// The two surfaces render the same markup through the same parser, so a
		// boundary that normalised on one path and not the other would be a slide
		// that formats differently on the projector and in the room's hands.
		const pres = await createOk([textSlide()]);
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.slides[0].question).toBe(MARKDOWN_QUESTION);
		expect(byCode.slides[0].body).toBe(MARKDOWN_BODY);
	});

	test("a link with a scheme the client will not open is still stored as typed", async () => {
		// The server does not decide what is clickable — the renderer does, and it
		// refuses this one. Storing it verbatim is what lets the organizer see
		// what they wrote instead of finding it silently deleted.
		const written = "[click](javascript:alert(1))";
		const pres = await createOk([textSlide({ body: written })]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].body).toBe(written);
	});

	// ── REQ091 — the size the organizer picked ─────────────────

	test("a slide authored with no size comes back at medium", async () => {
		const pres = await createOk([textSlide()]);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].textSize).toBe("medium");
	});

	test("every step the schema offers round-trips", async () => {
		const { SlideTextSizeEnum } = await import("./schemas");
		for (const step of SlideTextSizeEnum.options) {
			const pres = await createOk([textSlide({ textSize: step })]);
			const fetched = await (
				await fetch(`${baseUrl}/api/presentations/${pres.id}`)
			).json();
			expect(fetched.slides[0].textSize).toBe(step);
		}
	});

	test("editing the deck replaces the size and the markup together", async () => {
		const pres = await createOk([textSlide({ textSize: "small" })]);
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [
						textSlide({ textSize: "x-large", body: "*just this* now" }),
					],
				}),
			},
		);
		expect(patched.status).toBe(200);

		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].textSize).toBe("x-large");
		expect(fetched.slides[0].body).toBe("*just this* now");
	});

	test("a size no surface implements is refused at the boundary", async () => {
		const res = await create([textSlide({ textSize: "gigantic" })]);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	test("the editor's save path refuses it too, and leaves the stored step alone", async () => {
		// The route the editor actually saves through is PATCH, and it declares no
		// body schema of its own (pre-existing) — so the refusal comes from the
		// docstore's schema gate rather than from Zod at the edge, and arrives as a
		// 5xx rather than the POST path's 4xx. The status is not the invariant
		// worth pinning; *the write not landing* is, on both paths.
		const pres = await createOk([textSlide({ textSize: "large" })]);
		const patched = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					slides: [textSlide({ textSize: "gigantic" })],
				}),
			},
		);
		expect(patched.ok).toBe(false);

		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.slides[0].textSize).toBe("large");
	});
});
