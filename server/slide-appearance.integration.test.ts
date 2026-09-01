/**
 * Integration tests for a slide's own appearance over HTTP.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ087 — a slide is created carrying its own layout, keeps it, and is
 *     re-authored through the same authorized PATCH every other deck edit
 *     travels on
 *   - REQ070/REQ019 — the colours a slide overrides ride the wire to the room,
 *     and a value that is not a colour never reaches storage
 *   - REQ071 — a background image travels with the slide
 *   - REQ087 — a slide that authored nothing arrives complete and empty
 *     (ADR-0024), so no client has to tell "unset" from "absent"
 *
 * The point of testing this over HTTP rather than only at the resolver: a
 * slide's appearance is something the *room* has to receive. A colour the
 * organizer authored that never leaves the editor is not an override, so what
 * these assert is the payload — and above all the join route, which is the one
 * every phone in the room comes through and which carries no credential at all.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 and
 * theme harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SLIDE_LAYOUTS } from "./schemas";

let connectDb: () => Promise<void>;

let baseUrl = "";
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

/** One slide, with whatever appearance a case is about. */
function slide(overrides: Record<string, unknown> = {}) {
	return {
		id: "s1",
		type: "multiple-choice",
		question: "Which?",
		options: [
			{ id: "o1", text: "One" },
			{ id: "o2", text: "Two" },
		],
		...overrides,
	};
}

async function create(deck: Record<string, unknown> = {}): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: "Appearance Test",
			slides: [slide()],
			...deck,
		}),
	});
}

async function created(deck: Record<string, unknown> = {}): Promise<AnyJson> {
	const res = await create(deck);
	expect(res.status).toBe(201);
	return await res.json();
}

/** The deck as a participant meets it: the join door, with no credential. */
async function asParticipant(code: string): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/join/${code}`);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("Per-slide appearance integration", () => {
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
		await server?.stop();
	});

	// ── REQ087 — a slide carries its own layout ─────────────────

	test("a slide is created carrying the appearance it was authored with", async () => {
		const pres = await created({
			slides: [
				slide({
					layout: "left",
					backgroundColor: "#102030",
					backgroundImage: "https://example.com/bg.jpg",
					textColor: "#f8fafc",
					chartColor: "#10b981",
				}),
			],
		});
		expect(pres.slides[0].layout).toBe("left");
		expect(pres.slides[0].backgroundColor).toBe("#102030");
		expect(pres.slides[0].backgroundImage).toBe("https://example.com/bg.jpg");
		expect(pres.slides[0].textColor).toBe("#f8fafc");
		expect(pres.slides[0].chartColor).toBe("#10b981");

		const read = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect((await read.json()).slides[0].backgroundColor).toBe("#102030");
	});

	test("every layout survives a create and a read", async () => {
		// Walking the enum rather than sampling it: a placement added to the schema
		// and forgotten on a write path fails here rather than on a projector.
		for (const layout of SLIDE_LAYOUTS) {
			const pres = await created({ slides: [slide({ layout })] });
			expect(pres.slides[0].layout).toBe(layout);
			expect((await asParticipant(pres.code)).slides[0].layout).toBe(layout);
		}
	});

	test("a slide that authored nothing arrives complete and empty", async () => {
		// ADR-0024: the fields are emitted rather than omitted, so a client never
		// has to tell "this slide is on the theme" from "this build is older".
		const pres = await created();
		expect(pres.slides[0].layout).toBe("inherit");
		expect(pres.slides[0].backgroundColor).toBe("");
		expect(pres.slides[0].backgroundImage).toBe("");
		expect(pres.slides[0].textColor).toBe("");
		expect(pres.slides[0].chartColor).toBe("");
	});

	// ── REQ070/REQ019 — the room receives the override ──────────

	test("the slide's own colours travel to the room on the join payload", async () => {
		const pres = await created({
			slides: [slide({ backgroundColor: "#1b0d12", chartColor: "#e11d48" })],
		});
		const room = await asParticipant(pres.code);
		expect(room.slides[0].backgroundColor).toBe("#1b0d12");
		expect(room.slides[0].chartColor).toBe("#e11d48");
		// And the credential the deck is edited with is not on that payload —
		// an appearance field riding the wire must not have widened what else does.
		expect(room.creatorTokenHash).toBeUndefined();
		expect(room.creatorId).toBeUndefined();
		expect(room.creatorToken).toBeUndefined();
	});

	test("overriding one slide leaves the deck's other slides alone", async () => {
		// REQ070's "without changing the theme itself", as the payload shows it.
		const pres = await created({
			slides: [
				slide({ id: "s1", backgroundColor: "#102030" }),
				slide({ id: "s2" }),
			],
			theme: "ember",
		});
		const room = await asParticipant(pres.code);
		expect(room.theme).toBe("ember");
		expect(room.slides[0].backgroundColor).toBe("#102030");
		expect(room.slides[1].backgroundColor).toBe("");
	});

	// ── The boundary refuses what no screen should draw ─────────

	test("a colour that is not a colour never reaches storage", async () => {
		for (const field of ["backgroundColor", "textColor", "chartColor"]) {
			const res = await create({
				slides: [slide({ [field]: "red; background: url(x)" })],
			});
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		}
	});

	test("a layout nobody designed never reaches storage", async () => {
		const res = await create({ slides: [slide({ layout: "diagonal" })] });
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	// ── Re-authoring is an ordinary presentation mutation ───────

	test("the appearance is changed by whoever may edit the deck", async () => {
		const pres = await created({ slides: [slide({ layout: "center" })] });
		const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({
				slides: [slide({ layout: "right", textColor: "#fef3c7" })],
			}),
		});
		expect(res.status).toBe(200);
		const patched = await res.json();
		expect(patched.slides[0].layout).toBe("right");
		expect(patched.slides[0].textColor).toBe("#fef3c7");

		// And the room is drawn that way from its next read on.
		const room = await asParticipant(pres.code);
		expect(room.slides[0].layout).toBe("right");
		expect(room.slides[0].textColor).toBe("#fef3c7");
	});

	test("a caller who cannot edit the deck cannot re-author a slide's appearance", async () => {
		// A slide's appearance is the organizer's, like every other thing on the
		// deck: the mutation is authorized by owner or edit token and nothing else.
		const pres = await created({ slides: [slide({ backgroundColor: "#102030" })] });
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slides: [slide({ backgroundColor: "#ff0000" })] }),
		});
		expect(res.status).toBe(401);
		expect((await asParticipant(pres.code)).slides[0].backgroundColor).toBe(
			"#102030",
		);
	});

	test("clearing an override puts the slide back on the theme", async () => {
		const pres = await created({
			slides: [slide({ backgroundColor: "#102030", layout: "left" })],
		});
		const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({
				slides: [slide({ backgroundColor: "", layout: "inherit" })],
			}),
		});
		expect(res.status).toBe(200);
		const room = await asParticipant(pres.code);
		expect(room.slides[0].backgroundColor).toBe("");
		expect(room.slides[0].layout).toBe("inherit");
	});
});
