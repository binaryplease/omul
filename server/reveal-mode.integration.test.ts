/**
 * Integration tests for the deck's reveal mode — when a question slide's tally
 * actually reaches the audience.
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - REQ015 — an `instant` slide publishes its tally as each answer lands
 *   - REQ016 — an `on-click` slide collects answers and publishes nothing until
 *     the presenter reveals it, and withholds again when they take it back
 *   - REQ017 — a `private` slide never publishes a tally to the room, while its
 *     answers stay recorded and readable on the results surface
 *   - REQ018 — one mode set for the deck, in one request, applied to every
 *     question slide in it
 *
 * The point of testing this over HTTP rather than only at the resolver: the
 * requirement is about **publication**, not about rendering. A tally that
 * travels to a participant's browser has been published whatever the client
 * then draws, so what these assert is the payload — that a withholding mode
 * sends the marker and no numbers, to a caller who cannot prove they authored
 * the deck.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 harnesses.
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

/** A two-option choice slide, optionally overriding the deck's reveal mode. */
function choiceSlide(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		type: "multiple-choice",
		question: `Pick on ${id}`,
		options: [
			{ id: `${id}-a`, text: "A" },
			{ id: `${id}-b`, text: "B" },
		],
		...overrides,
	};
}

async function createAndStart(
	slides: AnyJson[],
	deck: Record<string, unknown> = {},
): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Reveal Mode Test", slides, ...deck }),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

async function vote(
	presentationId: string,
	slideId: string,
	optionId: string,
	participantId: string,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slideId, value: optionId, participantId }),
	});
}

/** One slide's tally, as the room reads it (no credential) or as its author does. */
async function results(
	presentationId: string,
	slideId: string,
	token?: string,
): Promise<AnyJson> {
	const path = `/api/presentations/${presentationId}/results/${slideId}`;
	const res = token
		? await authed(path, token)
		: await fetch(`${baseUrl}${path}`);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The whole deck's tallies, keyed by slide id, as the given caller reads them. */
async function allResults(
	presentationId: string,
	token?: string,
): Promise<Record<string, AnyJson>> {
	const path = `/api/presentations/${presentationId}/results`;
	const res = token
		? await authed(path, token)
		: await fetch(`${baseUrl}${path}`);
	expect(res.status).toBe(200);
	const rows: AnyJson[] = await res.json();
	return Object.fromEntries(rows.map((row) => [row.slideId, row]));
}

async function reveal(
	pres: AnyJson,
	slideId: string,
	revealed = true,
): Promise<Response> {
	return authed(`/api/presentations/${pres.id}/reveal`, pres.creatorToken, {
		method: "POST",
		body: JSON.stringify({ slideId, reveal: revealed }),
	});
}

describe("Deck reveal mode integration", () => {
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

	// ── REQ015 — publish the tally as answers land ──────────

	test("an instant slide publishes its tally as each answer arrives", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "instant",
		});

		// Before anyone has answered the room already reads a tally — an empty
		// one, which is a different statement from a withheld one.
		const empty = await results(pres.id, "q1");
		expect(empty.withheld).toBeUndefined();
		expect(empty.totalVotes).toBe(0);

		await vote(pres.id, "q1", "q1-a", "p1");
		const afterOne = await results(pres.id, "q1");
		expect(afterOne.totalVotes).toBe(1);
		expect(
			afterOne.options.find((option: AnyJson) => option.id === "q1-a").count,
		).toBe(1);

		// And it keeps moving: no reveal, no threshold, no waiting.
		await vote(pres.id, "q1", "q1-b", "p2");
		expect((await results(pres.id, "q1")).totalVotes).toBe(2);
	});

	test("instant is what a deck that says nothing about it does", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await vote(pres.id, "q1", "q1-a", "p1");
		expect((await results(pres.id, "q1")).totalVotes).toBe(1);
	});

	// ── REQ016 — publish on the presenter's reveal ──────────

	test("an on-click slide collects silently, then publishes on the reveal", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "on-click",
		});

		// The answers are taken — collecting is not what the mode gates.
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		expect((await vote(pres.id, "q1", "q1-a", "p2")).status).toBe(200);

		// And nothing about them is published: the marker, and no numbers at all.
		const before = await results(pres.id, "q1");
		expect(before.withheld).toBe(true);
		expect(before.type).toBe("multiple-choice");
		expect(before.totalVotes).toBeUndefined();
		expect(before.options).toBeUndefined();

		// The presenter counts them the whole time, on their own credential.
		expect((await results(pres.id, "q1", pres.creatorToken)).totalVotes).toBe(2);

		expect((await reveal(pres, "q1")).status).toBe(200);

		const after = await results(pres.id, "q1");
		expect(after.withheld).toBeUndefined();
		expect(after.totalVotes).toBe(2);
		expect(
			after.options.find((option: AnyJson) => option.id === "q1-a").count,
		).toBe(2);
	});

	test("taking the reveal back withholds the tally again", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "on-click",
		});
		await vote(pres.id, "q1", "q1-a", "p1");

		await reveal(pres, "q1");
		expect((await results(pres.id, "q1")).totalVotes).toBe(1);

		expect((await reveal(pres, "q1", false)).status).toBe(200);
		expect((await results(pres.id, "q1")).withheld).toBe(true);
	});

	test("the reveal is per slide — it does not open the deck", async () => {
		const pres = await createAndStart(
			[choiceSlide("q1"), choiceSlide("q2")],
			{ resultsVisibility: "on-click" },
		);
		await vote(pres.id, "q1", "q1-a", "p1");
		await vote(pres.id, "q2", "q2-a", "p1");

		await reveal(pres, "q1");
		expect((await results(pres.id, "q1")).totalVotes).toBe(1);
		expect((await results(pres.id, "q2")).withheld).toBe(true);
	});

	test("ending the deck is not the presenter revealing it", async () => {
		// An unrevealed `on-click` tally stays unpublished after the session is
		// over. The organizer chose when it goes on screen; running out of session
		// is not them choosing.
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "on-click",
		});
		await vote(pres.id, "q1", "q1-a", "p1");
		expect(
			(
				await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
					method: "POST",
				})
			).status,
		).toBe(200);
		expect((await results(pres.id, "q1")).withheld).toBe(true);
		expect((await results(pres.id, "q1", pres.creatorToken)).totalVotes).toBe(1);
	});

	// ── REQ017 — collect with no audience-facing tally ──────

	test("a private slide records answers and never publishes a tally", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "private",
		});
		expect((await vote(pres.id, "q1", "q1-a", "p1")).status).toBe(200);
		expect((await vote(pres.id, "q1", "q1-b", "p2")).status).toBe(200);

		const audience = await results(pres.id, "q1");
		expect(audience.withheld).toBe(true);
		expect(audience.totalVotes).toBeUndefined();

		// Reachable on the results surface, which is authorized as an edit: the
		// answers were recorded, they are simply not the room's to read.
		const owner = await results(pres.id, "q1", pres.creatorToken);
		expect(owner.totalVotes).toBe(2);
		expect(owner.respondentCount).toBe(2);
	});

	test("a reveal cannot open a private slide", async () => {
		// The presenter's control belongs to `on-click`. Were a stray reveal to
		// publish a private tally, "never" would only mean "until someone clicks".
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "private",
		});
		await vote(pres.id, "q1", "q1-a", "p1");
		expect((await reveal(pres, "q1")).status).toBe(200);
		expect((await results(pres.id, "q1")).withheld).toBe(true);
	});

	test("the deck-wide results list withholds slide by slide", async () => {
		const pres = await createAndStart(
			[
				choiceSlide("open", { resultsVisibility: "instant" }),
				choiceSlide("shut", { resultsVisibility: "private" }),
			],
			{ resultsVisibility: "instant" },
		);
		await vote(pres.id, "open", "open-a", "p1");
		await vote(pres.id, "shut", "shut-a", "p1");

		const audience = await allResults(pres.id);
		expect(audience.open.totalVotes).toBe(1);
		expect(audience.open.withheld).toBeUndefined();
		expect(audience.shut.withheld).toBe(true);
		expect(audience.shut.totalVotes).toBeUndefined();
		// The withheld entry is still *present*, so a consumer walking the deck
		// sees every slide and can tell "kept back" from "not a question".
		expect(audience.shut.slideId).toBe("shut");

		const owner = await allResults(pres.id, pres.creatorToken);
		expect(owner.open.totalVotes).toBe(1);
		expect(owner.shut.totalVotes).toBe(1);
	});

	test("a slide's own mode wins over the deck's, in both directions", async () => {
		const pres = await createAndStart(
			[
				choiceSlide("shown", { resultsVisibility: "instant" }),
				choiceSlide("hidden", { resultsVisibility: "private" }),
			],
			{ resultsVisibility: "private" },
		);
		await vote(pres.id, "shown", "shown-a", "p1");
		await vote(pres.id, "hidden", "hidden-a", "p1");

		expect((await results(pres.id, "shown")).totalVotes).toBe(1);
		expect((await results(pres.id, "hidden")).withheld).toBe(true);
	});

	// ── REQ018 — one mode for the whole deck, in one operation ─

	test("one request sets the mode and applies it to every question slide", async () => {
		const pres = await createAndStart(
			[
				choiceSlide("q1", { resultsVisibility: "instant" }),
				choiceSlide("q2", { resultsVisibility: "on-click" }),
				choiceSlide("q3"),
				{ id: "t1", type: "text", question: "An interlude" },
			],
			{ resultsVisibility: "instant" },
		);
		for (const slideId of ["q1", "q2", "q3"]) {
			await vote(pres.id, slideId, `${slideId}-a`, "p1");
		}
		// Before: the deck is not uniform — `q1` publishes, `q2` does not.
		expect((await results(pres.id, "q1")).totalVotes).toBe(1);
		expect((await results(pres.id, "q2")).withheld).toBe(true);

		const res = await authed(
			`/api/presentations/${pres.id}/results-visibility`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ resultsVisibility: "private" }) },
		);
		expect(res.status).toBe(200);
		const updated = await res.json();
		expect(updated.resultsVisibility).toBe("private");
		// Every question slide is back on the deck setting; the content slide is
		// untouched by an operation that does not govern it.
		expect(
			updated.slides
				.filter((slide: AnyJson) => slide.type !== "text")
				.map((slide: AnyJson) => slide.resultsVisibility),
		).toEqual(["inherit", "inherit", "inherit"]);

		// After: the whole deck withholds, including the slide that had been
		// pinned to `instant` above it.
		for (const slideId of ["q1", "q2", "q3"]) {
			expect((await results(pres.id, slideId)).withheld).toBe(true);
			expect(
				(await results(pres.id, slideId, pres.creatorToken)).totalVotes,
			).toBe(1);
		}
	});

	test("applying instant opens every question slide, overrides included", async () => {
		// The operation loosens as readily as it tightens (REQ018) — that is what
		// "applied to every question slide" means, and it is why the editor states
		// the consequence before the organizer runs it.
		const pres = await createAndStart(
			[
				choiceSlide("q1", { resultsVisibility: "private" }),
				choiceSlide("q2", { resultsVisibility: "on-click" }),
			],
			{ resultsVisibility: "private" },
		);
		await vote(pres.id, "q1", "q1-a", "p1");
		await vote(pres.id, "q2", "q2-a", "p1");

		expect(
			(
				await authed(
					`/api/presentations/${pres.id}/results-visibility`,
					pres.creatorToken,
					{
						method: "POST",
						body: JSON.stringify({ resultsVisibility: "instant" }),
					},
				)
			).status,
		).toBe(200);

		expect((await results(pres.id, "q1")).totalVotes).toBe(1);
		expect((await results(pres.id, "q2")).totalVotes).toBe(1);
	});

	test("the deck mode is a mutation — owner or edit token only", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "private",
		});

		// No credential at all.
		const anonymous = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results-visibility`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resultsVisibility: "instant" }),
			},
		);
		expect(anonymous.status).toBe(401);

		// Somebody else's token.
		const other = await createAndStart([choiceSlide("q1")]);
		const wrongToken = await authed(
			`/api/presentations/${pres.id}/results-visibility`,
			other.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ resultsVisibility: "instant" }),
			},
		);
		expect(wrongToken.status).toBe(401);

		// The deck did not move under either.
		await vote(pres.id, "q1", "q1-a", "p1");
		expect((await results(pres.id, "q1")).withheld).toBe(true);
	});

	test("an unknown mode is refused rather than stored", async () => {
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "private",
		});
		const res = await authed(
			`/api/presentations/${pres.id}/results-visibility`,
			pres.creatorToken,
			{
				method: "POST",
				body: JSON.stringify({ resultsVisibility: "eventually" }),
			},
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
		const fetched = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}`)
		).json();
		expect(fetched.resultsVisibility).toBe("private");
	});

	// ── The deck payload the room holds ─────────────────────

	test("a withholding mode is not itself a secret", async () => {
		// Both live surfaces tell the room in words that results are private or
		// not yet revealed, so the mode rides the deck payload openly. What it
		// governs is the numbers, and those are what never travel.
		const pres = await createAndStart([choiceSlide("q1")], {
			resultsVisibility: "private",
		});
		const byCode = await (
			await fetch(`${baseUrl}/api/join/${pres.code}`)
		).json();
		expect(byCode.resultsVisibility).toBe("private");
		expect(byCode.slides[0].resultsVisibility).toBe("inherit");
	});
});
