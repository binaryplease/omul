/**
 * Integration tests for a deck's theming over HTTP.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ079 — a deck is created carrying a theme from the built-in set, keeps
 *     it, and is re-themed through the same authorized PATCH every other deck
 *     setting travels on
 *   - REQ079 — a theme outside the set never reaches storage
 *   - REQ080/REQ092/REQ135 — a deck defines a theme of its own, stores it on the
 *     same field, applies it through the same PATCH, and has it refused the same
 *     way when it names a colour or a face nobody could draw
 *   - REQ136 — the logo the deck carries reaches the participant-facing door
 *
 * The point of testing this over HTTP rather than only at the resolver: the
 * theme and the mark are things the *room* has to receive. A palette the
 * organizer chose that never leaves the editor is not a theme, so what these
 * assert is the payload — that the fields arrive on the join route, which is the
 * one every phone in the room comes through and the one that carries no
 * credential at all.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DECK_THEME_IDS, DEFAULT_DECK_THEME } from "./schemas";

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

const TEXT_SLIDE = { id: "s1", type: "text", question: "Hello", body: "Body" };

async function create(deck: Record<string, unknown> = {}): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Theme Test", slides: [TEXT_SLIDE], ...deck }),
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

describe("Deck theme integration", () => {
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

	// ── REQ079 — a deck carries a theme from the built-in set ───

	test("a deck is created carrying the theme it was authored with", async () => {
		const pres = await created({ theme: "editorial" });
		expect(pres.theme).toBe("editorial");

		const read = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect((await read.json()).theme).toBe("editorial");
	});

	test("every built-in theme survives a create and a read", async () => {
		// Walking the enum rather than sampling it: a theme added to the schema and
		// forgotten on a write path fails here rather than on somebody's projector.
		for (const theme of DECK_THEME_IDS) {
			const pres = await created({ theme });
			expect(pres.theme).toBe(theme);
			expect((await asParticipant(pres.code)).theme).toBe(theme);
		}
	});

	test("a deck created without one wears the house theme", async () => {
		const pres = await created();
		expect(pres.theme).toBe(DEFAULT_DECK_THEME);
		expect(pres.themeLogoUrl).toBe("");
		expect(pres.themeLogoAlt).toBe("");
	});

	test("a theme nobody designed is refused before it is stored", async () => {
		const res = await create({ theme: "neon" });
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	// ── REQ079 — re-theming a deck is a presentation mutation ───

	test("the deck's theme is changed by whoever may edit it", async () => {
		const pres = await created({ theme: "signal" });
		const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ theme: "broadcast" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).theme).toBe("broadcast");

		// And the room is drawn in the new one from its next read on.
		expect((await asParticipant(pres.code)).theme).toBe("broadcast");
	});

	test("a caller who cannot edit the deck cannot re-theme it", async () => {
		// A deck's appearance is the organizer's, like every other setting on it:
		// the mutation is authorized by owner or edit token and by nothing else.
		const pres = await created({ theme: "signal" });
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ theme: "broadcast" }),
		});
		expect(res.status).toBe(401);
		expect((await asParticipant(pres.code)).theme).toBe("signal");
	});

	// ── REQ136 — the mark reaches the participant-facing door ───

	test("the logo travels to the room on the join payload", async () => {
		const pres = await created({
			theme: "pulse",
			themeLogoUrl: "https://example.test/acme.svg",
			themeLogoAlt: "Acme",
		});
		const joined = await asParticipant(pres.code);
		expect(joined.theme).toBe("pulse");
		expect(joined.themeLogoUrl).toBe("https://example.test/acme.svg");
		expect(joined.themeLogoAlt).toBe("Acme");
	});

	test("the logo is added and taken away through the same edit", async () => {
		const pres = await created();
		expect((await asParticipant(pres.code)).themeLogoUrl).toBe("");

		await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({
				themeLogoUrl: "/brand/mark.svg",
				themeLogoAlt: "Acme",
			}),
		});
		expect((await asParticipant(pres.code)).themeLogoUrl).toBe("/brand/mark.svg");

		// Taking it back leaves the field present and empty rather than absent —
		// the audience's view of a branded deck and an unbranded one are the same
		// complete shape, so no client reaches for `??`.
		await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ themeLogoUrl: "", themeLogoAlt: "" }),
		});
		const cleared = await asParticipant(pres.code);
		expect(cleared.themeLogoUrl).toBe("");
		expect(cleared.themeLogoAlt).toBe("");
	});

	// ── REQ080/REQ135 — a theme the deck defines for itself ─────

	test("a deck is created carrying the theme it authored", async () => {
		const brand = {
			name: "Acme",
			accent: "#0f62fe",
			canvas: "#0b1020",
			text: "#eef2ff",
			font: "serif",
		};
		const pres = await created({ theme: "custom", themeBrand: brand });
		expect(pres.theme).toBe("custom");
		expect(pres.themeBrand).toEqual(brand);

		// And it reaches the room through the participants' own door, which is the
		// only thing that makes it a theme rather than an editor setting.
		const joined = await asParticipant(pres.code);
		expect(joined.theme).toBe("custom");
		expect(joined.themeBrand).toEqual(brand);
	});

	test("a deck created without one carries an empty brand, not an absent one", async () => {
		const pres = await created();
		expect(pres.themeBrand).toEqual({
			name: "",
			accent: "",
			canvas: "",
			text: "",
			font: "figtree",
		});
	});

	test("a deck naming the retired face id gets the face that replaced it (REQ178)", async () => {
		// A client built against the old vocabulary is not a malformed client, so
		// `sora` is accepted rather than 4xx'd — and it is folded on the way in, so
		// the room is never handed an id for a face this build no longer carries.
		const pres = await created({
			theme: "custom",
			themeBrand: { accent: "#0f62fe", font: "sora" },
		});
		expect(pres.themeBrand.font).toBe("figtree");
		expect((await asParticipant(pres.code)).themeBrand.font).toBe("figtree");
	});

	test("a colour nobody could draw is refused before it is stored", async () => {
		const res = await create({
			theme: "custom",
			themeBrand: { accent: "url(https://example.test/x)" },
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	test("a face this build does not ship is refused before it is stored", async () => {
		const res = await create({
			theme: "custom",
			themeBrand: { font: "Comic Sans MS" },
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	test("the deck's own theme is authored and applied by whoever may edit it", async () => {
		// Authored on one edit, applied on another: the brand is stored while a
		// built-in theme is still what the room sees, and switching the deck onto
		// it is the ordinary PATCH every other setting travels on. No separate
		// theming endpoint, and no second authorization to get wrong.
		const pres = await created({ theme: "pulse" });
		const authoring = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{
				method: "PATCH",
				body: JSON.stringify({
					themeBrand: {
						name: "Acme",
						accent: "#0f62fe",
						canvas: "#0b1020",
						text: "",
						font: "mono",
					},
				}),
			},
		);
		expect(authoring.status).toBe(200);
		const stillPulse = await asParticipant(pres.code);
		expect(stillPulse.theme).toBe("pulse");
		expect(stillPulse.themeBrand.accent).toBe("#0f62fe");

		const applying = await authed(
			`/api/presentations/${pres.id}`,
			pres.creatorToken,
			{ method: "PATCH", body: JSON.stringify({ theme: "custom" }) },
		);
		expect(applying.status).toBe(200);
		const branded = await asParticipant(pres.code);
		expect(branded.theme).toBe("custom");
		// And the colours authored a request earlier are still the ones it carries.
		expect(branded.themeBrand.name).toBe("Acme");
		expect(branded.themeBrand.font).toBe("mono");
	});

	test("a re-brand that names a colour nobody could draw stores nothing", async () => {
		// The create path is validated by `CreatePresentationSchema` and answers a
		// clean 4xx; PATCH declares no body schema (pre-existing — it passes the
		// body straight through), so the refusal comes from the docstore's own
		// schema gate instead. What matters is the same either way and is what this
		// asserts: the write does not land, and the brand the deck was already
		// wearing is exactly the brand it is still wearing. PATCH is the path an
		// editor actually re-brands a live deck on, so it needs the assertion more
		// than the create does.
		const good = {
			name: "Acme",
			accent: "#0f62fe",
			canvas: "#0b1020",
			text: "",
			font: "mono",
		};
		const pres = await created({ theme: "custom", themeBrand: good });

		for (const bad of [
			{ ...good, accent: "url(https://example.test/x)" },
			{ ...good, canvas: "rgb(0, 0, 0)" },
			{ ...good, font: "Comic Sans MS" },
		]) {
			const res = await authed(
				`/api/presentations/${pres.id}`,
				pres.creatorToken,
				{ method: "PATCH", body: JSON.stringify({ themeBrand: bad }) },
			);
			expect(res.status).toBeGreaterThanOrEqual(400);
			// Whatever the status, the room keeps the theme it had.
			expect((await asParticipant(pres.code)).themeBrand).toEqual(good);
		}

		// And the same field still takes a valid brand afterwards — the refusals
		// above left nothing broken behind them.
		const res = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({ themeBrand: { ...good, accent: "#e11d48" } }),
		});
		expect(res.status).toBe(200);
		expect((await asParticipant(pres.code)).themeBrand.accent).toBe("#e11d48");
	});

	test("a caller who cannot edit the deck cannot re-brand it", async () => {
		const pres = await created({ theme: "signal" });
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				theme: "custom",
				themeBrand: { accent: "#0f62fe" },
			}),
		});
		expect(res.status).toBe(401);
		const unchanged = await asParticipant(pres.code);
		expect(unchanged.theme).toBe("signal");
		expect(unchanged.themeBrand.accent).toBe("");
	});

	test("theming a deck carries none of the organizer's credentials with it", async () => {
		// The theme rides the ordinary presentation document, and that document is
		// the one every phone in the room receives — so this is the payload the
		// creator-token hash must never appear on, branded or not.
		const pres = await created({
			theme: "ember",
			themeLogoUrl: "https://example.test/acme.svg",
		});
		const joined = await asParticipant(pres.code);
		expect(joined.creatorTokenHash).toBeUndefined();
		expect(joined.creatorToken).toBeUndefined();
		expect(joined.creatorId).toBeUndefined();
	});
});
