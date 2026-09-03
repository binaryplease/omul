/**
 * Integration tests for the shareable results link (REQ098).
 *
 * The requirement is one sentence with three claims in it, and each is tested
 * over HTTP because each is a claim about what the *wire* carries:
 *
 *   - **A deck can mint a link granting read-only access to its results with no
 *     account.** The token is returned once, and it reads every slide's tally
 *     under every reveal mode — the `private` slide REQ017 keeps off every
 *     screen included — with no session, no API key and no edit token anywhere
 *     in the request.
 *   - **It carries no edit authority.** Every mutation the deck has, plus the
 *     spreadsheet export, plus the presenter's notes, plus a running quiz
 *     question's answer key, plus a Form slide's per-participant rows: the link
 *     buys none of them. Tested as absence, which is the only way a claim about
 *     absence can be — by presenting the token and nothing else, everywhere.
 *   - **It is revocable.** A revoked token is *refused*, not quietly demoted to
 *     the public read, and a re-mint retires the link before it by the same act.
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 and
 * reveal-mode harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeFormSubmission, RESULTS_TOKEN_HEADER } from "./schemas";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

/** A request carrying the deck's edit token — the organizer's own credential. */
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

/**
 * A request carrying the deck's **results link** and nothing else — no cookie,
 * no API key, no edit token. This is what a recipient's browser sends, and every
 * "carries no edit authority" case below goes through it.
 */
async function viaLink(
	path: string,
	resultsToken: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			[RESULTS_TOKEN_HEADER]: resultsToken,
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
		body: JSON.stringify({ title: "Results Link Test", slides, ...deck }),
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

/** Mint the deck's results link and hand back the one-time token. */
async function mint(pres: AnyJson): Promise<string> {
	const res = await authed(
		`/api/presentations/${pres.id}/results-link`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(res.status).toBe(201);
	const link = await res.json();
	expect(link.active).toBe(true);
	expect(typeof link.resultsToken).toBe("string");
	return link.resultsToken as string;
}

/** The whole deck's tallies keyed by slide id, as a results-link holder reads them. */
async function linkResults(
	presentationId: string,
	resultsToken: string,
): Promise<Record<string, AnyJson>> {
	const res = await viaLink(
		`/api/presentations/${presentationId}/results`,
		resultsToken,
	);
	expect(res.status).toBe(200);
	const rows: AnyJson[] = await res.json();
	return Object.fromEntries(rows.map((row) => [row.slideId, row]));
}

describe("Shareable results link integration (REQ098)", () => {
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

	// ── Minting, and who may ────────────────────────────────

	test("only a caller who can edit the deck may mint, revoke or read the link", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);

		for (const method of ["POST", "DELETE", "GET"]) {
			const res = await fetch(
				`${baseUrl}/api/presentations/${pres.id}/results-link`,
				{ method, headers: { "Content-Type": "application/json" } },
			);
			expect(res.status).toBe(401);
		}

		// And the link itself is not a second door to its own management: a holder
		// can read results with it and can do nothing about the link.
		const token = await mint(pres);
		for (const method of ["POST", "DELETE", "GET"]) {
			const res = await viaLink(
				`/api/presentations/${pres.id}/results-link`,
				token,
				{ method },
			);
			expect(res.status).toBe(401);
		}
	});

	test("a fresh deck has no link, and the status says so before and after", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);

		const before = await (
			await authed(`/api/presentations/${pres.id}/results-link`, pres.creatorToken)
		).json();
		expect(before).toEqual({
			active: false,
			issuedAt: null,
			resultsToken: null,
		});

		await mint(pres);
		const after = await (
			await authed(`/api/presentations/${pres.id}/results-link`, pres.creatorToken)
		).json();
		expect(after.active).toBe(true);
		expect(typeof after.issuedAt).toBe("string");
		// The secret is stored hashed, so the status can say a link exists and can
		// never say what it is (the key is emitted, explicitly empty).
		expect(after.resultsToken).toBe(null);
	});

	test("the deck payload never carries the link, to anybody", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		await mint(pres);

		for (const path of [
			`/api/presentations/${pres.id}`,
			`/api/join/${pres.code}`,
		]) {
			const deck = await (await fetch(`${baseUrl}${path}`)).json();
			expect(deck.resultsTokenHash).toBeUndefined();
			expect(deck.resultsTokenIssuedAt).toBeUndefined();
			expect(deck.creatorTokenHash).toBeUndefined();
		}
		// Nor to the organizer's own authenticated read.
		const own = await (
			await authed(`/api/presentations/${pres.id}`, pres.creatorToken)
		).json();
		expect(own.resultsTokenHash).toBeUndefined();
		expect(own.resultsTokenIssuedAt).toBeUndefined();
	});

	// ── Read-only access to the results, with no account ────

	test("a link holder reads the tallies under every reveal mode", async () => {
		// One deck, three slides, one mode each — the whole of REQ015–REQ017 in a
		// single payload, read twice: once by the room, once through the link.
		const pres = await createAndStart(
			[
				choiceSlide("open", { resultsVisibility: "instant" }),
				choiceSlide("later", { resultsVisibility: "on-click" }),
				choiceSlide("never", { resultsVisibility: "private" }),
			],
			{ resultsVisibility: "instant" },
		);
		for (const slideId of ["open", "later", "never"]) {
			expect((await vote(pres.id, slideId, `${slideId}-a`, "p1")).status).toBe(
				200,
			);
		}

		// The room: the instant slide only. The other two are withheld, and the
		// `on-click` one has not been revealed.
		const roomRows: AnyJson[] = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results`)
		).json();
		const room = Object.fromEntries(roomRows.map((row) => [row.slideId, row]));
		expect(room.open.withheld).toBeUndefined();
		expect(room.later.withheld).toBe(true);
		expect(room.never.withheld).toBe(true);

		// The link holder: all three, with numbers. No cookie, no key, no edit
		// token — just the token the organizer minted and sent them.
		const token = await mint(pres);
		const shared = await linkResults(pres.id, token);
		for (const slideId of ["open", "later", "never"]) {
			expect(shared[slideId].withheld).toBeUndefined();
			expect(shared[slideId].totalVotes).toBe(1);
		}

		// And on the single-slide endpoint, which is the other door to the same gate.
		const one = await viaLink(
			`/api/presentations/${pres.id}/results/never`,
			token,
		);
		expect(one.status).toBe(200);
		expect((await one.json()).totalVotes).toBe(1);
	});

	test("an ended deck's withheld tallies are still the link's to read", async () => {
		// Ending a session is deliberately not a reveal (REQ017), so this is the
		// case a link exists for: the organizer wants somebody to have the numbers
		// the room was never shown.
		const pres = await createAndStart([
			choiceSlide("never", { resultsVisibility: "private" }),
		]);
		await vote(pres.id, "never", "never-a", "p1");
		await authed(`/api/presentations/${pres.id}/end`, pres.creatorToken, {
			method: "POST",
		});

		const room = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/never`)
		).json();
		expect(room.withheld).toBe(true);

		const token = await mint(pres);
		const shared = await (
			await viaLink(`/api/presentations/${pres.id}/results/never`, token)
		).json();
		expect(shared.withheld).toBeUndefined();
		expect(shared.totalVotes).toBe(1);
	});

	// ── …and no edit authority ──────────────────────────────

	test("the link authorizes no mutation on the deck", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const token = await mint(pres);

		const mutations: [string, string, unknown?][] = [
			["PATCH", `/api/presentations/${pres.id}`, { title: "Taken over" }],
			["DELETE", `/api/presentations/${pres.id}`],
			["POST", `/api/presentations/${pres.id}/start`],
			["POST", `/api/presentations/${pres.id}/end`],
			["POST", `/api/presentations/${pres.id}/reset`],
			["POST", `/api/presentations/${pres.id}/slide`, { index: 0 }],
			["POST", `/api/presentations/${pres.id}/reveal`, { slideId: "q1" }],
			[
				"POST",
				`/api/presentations/${pres.id}/results-visibility`,
				{ resultsVisibility: "instant" },
			],
			["POST", `/api/presentations/${pres.id}/timer`, { slideId: "q1" }],
			["POST", `/api/presentations/${pres.id}/qa/settings`, { enabled: true }],
			["POST", `/api/presentations/${pres.id}/channels`, { chatEnabled: true }],
		];

		for (const [method, path, body] of mutations) {
			const res = await viaLink(path, token, {
				method,
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			expect([401, 403]).toContain(res.status);
		}

		// The deck is untouched by all of that.
		const deck = await (await fetch(`${baseUrl}/api/presentations/${pres.id}`)).json();
		expect(deck.title).toBe("Results Link Test");
		expect(deck.status).toBe("live");
	});

	test("the link does not open the spreadsheet export or the preview", async () => {
		// Both are authorized as an edit because both carry raw per-participant
		// rows and every answer key (REQ095/REQ103). A link delegates the tallies,
		// not the rows behind them.
		const pres = await createAndStart([choiceSlide("q1")]);
		const token = await mint(pres);

		for (const path of [
			`/api/presentations/${pres.id}/results.xlsx`,
			`/api/presentations/${pres.id}/preview`,
		]) {
			const res = await viaLink(path, token);
			expect(res.status).toBe(401);
		}
	});

	test("the link does not carry presenter notes or a running question's answer key", async () => {
		const pres = await createAndStart(
			[
				{
					id: "quiz1",
					type: "quiz",
					question: "Which one?",
					notes: "Say the thing about the thing",
					options: [
						{ id: "right", text: "Right", isCorrect: true },
						{ id: "wrong", text: "Wrong" },
					],
					timeLimit: 0,
				},
			],
			{ resultsVisibility: "private" },
		);
		await vote(pres.id, "quiz1", "right", "p1");
		const token = await mint(pres);

		// The deck read is the public one: the results token is not a credential on
		// it, and the notes and key travel with the deck (REQ056/REQ090).
		const deck = await (
			await viaLink(`/api/presentations/${pres.id}`, token)
		).json();
		expect(deck.slides[0].notes).toBe("");
		expect(
			deck.slides[0].options.some((option: AnyJson) => option.isCorrect),
		).toBe(false);

		// The tally is the link's — the numbers it was minted for — but the marks on
		// it are not. An untimed quiz question is over only when the presenter says
		// so, and nobody has.
		const tally = await (
			await viaLink(`/api/presentations/${pres.id}/results/quiz1`, token)
		).json();
		expect(tally.withheld).toBeUndefined();
		expect(tally.totalVotes).toBe(1);
		for (const option of tally.options) expect(option.isCorrect).toBe(null);

		// The organizer, who authored the key, still reads it.
		const own = await (
			await authed(
				`/api/presentations/${pres.id}/results/quiz1`,
				pres.creatorToken,
			)
		).json();
		expect(own.options.find((option: AnyJson) => option.id === "right").isCorrect).toBe(
			true,
		);
	});

	test("the link does not carry a Form slide's per-participant rows", async () => {
		// REQ061 keeps those behind the edit credential *whatever the reveal mode
		// says*, because a decision about numbers must not publish somebody's email
		// address. A results link is a decision about numbers.
		const pres = await createAndStart(
			[
				{
					id: "form1",
					type: "form",
					question: "Tell us",
					formFields: [
						{ id: "f-email", label: "Email", type: "email", required: true },
					],
				},
			],
			{ resultsVisibility: "instant" },
		);
		const submission = await vote(
			pres.id,
			"form1",
			encodeFormSubmission({ "f-email": "somebody@example.com" }),
			"p1",
		);
		expect(submission.status).toBe(200);

		const token = await mint(pres);
		const shared = await (
			await viaLink(`/api/presentations/${pres.id}/results/form1`, token)
		).json();
		expect(shared.withheld).toBeUndefined();
		// The counts are the tally and are public either way; the rows are not.
		expect(shared.submissions).toBe(null);

		const own = await (
			await authed(
				`/api/presentations/${pres.id}/results/form1`,
				pres.creatorToken,
			)
		).json();
		expect(own.submissions).toHaveLength(1);
		expect(own.submissions[0].answers[0].answer).toBe("somebody@example.com");
	});

	// ── …and it is revocable ────────────────────────────────

	test("a revoked link is refused rather than demoted to the public read", async () => {
		const pres = await createAndStart([
			choiceSlide("never", { resultsVisibility: "private" }),
		]);
		await vote(pres.id, "never", "never-a", "p1");
		const token = await mint(pres);
		expect((await linkResults(pres.id, token)).never.totalVotes).toBe(1);

		const revoked = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "DELETE" },
		);
		expect(revoked.status).toBe(200);
		expect(await revoked.json()).toEqual({
			active: false,
			issuedAt: null,
			resultsToken: null,
		});

		// Immediate, and stated. A silent fall-back to the public read would answer
		// this with a deck of withheld markers — indistinguishable, from the
		// holder's side, from a deck that never published anything.
		for (const path of [
			`/api/presentations/${pres.id}/results`,
			`/api/presentations/${pres.id}/results/never`,
		]) {
			const res = await viaLink(path, token);
			expect(res.status).toBe(401);
		}

		// The deck itself is unharmed: the room still reads what it always read.
		const room = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/never`)
		).json();
		expect(room.withheld).toBe(true);
	});

	test("revoking is idempotent and re-minting issues a link that works again", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const first = await mint(pres);

		for (let attempt = 0; attempt < 2; attempt++) {
			const res = await authed(
				`/api/presentations/${pres.id}/results-link`,
				pres.creatorToken,
				{ method: "DELETE" },
			);
			expect(res.status).toBe(200);
			expect((await res.json()).active).toBe(false);
		}

		const second = await mint(pres);
		expect(second).not.toBe(first);
		expect(
			(await viaLink(`/api/presentations/${pres.id}/results`, second)).status,
		).toBe(200);
		// The one revoked before it stays revoked — re-minting does not resurrect a
		// secret, it replaces the slot.
		expect(
			(await viaLink(`/api/presentations/${pres.id}/results`, first)).status,
		).toBe(401);
	});

	test("minting again retires the link before it", async () => {
		// One link per deck, so "replace" is the only shape a rotation has — and
		// the organizer has to be told, which is why the surface says so on the
		// button rather than after the click.
		const pres = await createAndStart([choiceSlide("q1")]);
		const first = await mint(pres);
		const second = await mint(pres);

		expect(second).not.toBe(first);
		expect(
			(await viaLink(`/api/presentations/${pres.id}/results`, second)).status,
		).toBe(200);
		expect(
			(await viaLink(`/api/presentations/${pres.id}/results`, first)).status,
		).toBe(401);
	});

	test("a link is the deck's own — it opens no other deck's results", async () => {
		const mine = await createAndStart([
			choiceSlide("never", { resultsVisibility: "private" }),
		]);
		const theirs = await createAndStart([
			choiceSlide("never", { resultsVisibility: "private" }),
		]);
		const token = await mint(mine);

		expect(
			(await viaLink(`/api/presentations/${theirs.id}/results`, token)).status,
		).toBe(401);
		// And a deck that never minted one refuses every token, rather than
		// grandfathering the way a pre-auth deck's edit check does.
		const untouched = await createAndStart([choiceSlide("q1")]);
		expect(
			(await viaLink(`/api/presentations/${untouched.id}/results`, token)).status,
		).toBe(401);
	});

	test("an organizer holding a stale token still reads their own deck", async () => {
		// The refusal is for a caller whose *only* credential is the dead link. An
		// organizer whose browser still holds the token they revoked a moment ago is
		// still the organizer, and a 401 on their own results would be the feature
		// locking them out of the thing it was meant to share.
		const pres = await createAndStart([
			choiceSlide("never", { resultsVisibility: "private" }),
		]);
		const token = await mint(pres);
		await authed(`/api/presentations/${pres.id}/results-link`, pres.creatorToken, {
			method: "DELETE",
		});

		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/results`, {
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${pres.creatorToken}`,
				[RESULTS_TOKEN_HEADER]: token,
			},
		});
		expect(res.status).toBe(200);
		const rows: AnyJson[] = await res.json();
		expect(rows[0].withheld).toBeUndefined();
	});

	test("deleting the deck takes its link with it", async () => {
		const pres = await createAndStart([choiceSlide("q1")]);
		const token = await mint(pres);
		expect(
			(
				await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
					method: "DELETE",
				})
			).status,
		).toBe(200);

		const res = await viaLink(`/api/presentations/${pres.id}/results`, token);
		expect(res.status).toBe(404);
	});
});
