/**
 * Integration tests for a deck that requires a signed-in participant (REQ134,
 * slice 1: server enforcement).
 *
 * The claim is about the boundary, so every gated route is driven rather than a
 * sample of them: the join route and each participant write refuse a caller
 * with no account, with one stated `refused` code; a signed-in caller goes
 * through; a participant id first used by one account cannot be written under by
 * another; the binding reaches no public read; and a delete erases it.
 *
 * Stands up the real Elysia app (auth handler + presentation routes) against a
 * throw-away in-memory docstore and a temp auth DB, as
 * `collaborators.integration.test.ts` does.
 */

// Env must be set before importing ./db and ./accounts (both read it at module
// load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-participant-sign-in-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;
let bindings: import("./db").Store;

let ownerKey = "";
let firstKey = "";
let firstUserId = "";
let secondKey = "";
let secondUserId = "";
/** A Better Auth session cookie for the first participant's account. */
let firstCookie = "";

const PASSWORD = "correct-horse-battery";

/**
 * A started deck every gated write can land on: an open-text slide taking
 * response upvotes, a published Q&A layer, both channels, names asked for and
 * repeat passes on.
 */
async function createDeck(requireParticipantSignIn: boolean): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
		body: JSON.stringify({
			title: "Sign-in deck",
			slides: [
				{
					id: "s1",
					type: "open-text",
					question: "What should we fix first?",
					allowResponseVotes: true,
					maxResponses: 0,
				},
			],
			qaEnabled: true,
			qaVisibility: "everyone",
			chatEnabled: true,
			reactionsEnabled: true,
			requireParticipantName: true,
			mode: "survey",
			allowRepeatPasses: true,
			requireParticipantSignIn,
		}),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const started = await fetch(`${baseUrl}/api/presentations/${pres.id}/start`, {
		method: "POST",
		headers: { "x-api-key": ownerKey },
	});
	expect(started.status).toBe(200);
	return pres;
}

function post(
	path: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(`${baseUrl}/api${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

/**
 * Every participant write on a deck, as one callable each, all under one
 * participant id. `responseId` and `questionId` name rows the caller may upvote;
 * a refusal at the door does not reach them, so placeholders serve there.
 */
function participantWrites(
	deckId: string,
	participantId: string,
	targets: { responseId: string; questionId: string },
) {
	return {
		vote: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/vote`,
				{ slideId: "s1", value: "Onboarding", participantId },
				headers,
			),
		responseVote: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/response-vote`,
				{ slideId: "s1", responseId: targets.responseId, participantId },
				headers,
			),
		pass: (headers: Record<string, string>) =>
			post(`/presentations/${deckId}/passes`, { participantId }, headers),
		question: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/qa`,
				{ text: `Question from ${participantId}`, participantId },
				headers,
			),
		questionUpvote: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/qa/${targets.questionId}/upvote`,
				{ participantId },
				headers,
			),
		reaction: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/reactions`,
				{ kind: "like", participantId },
				headers,
			),
		chat: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/chat`,
				{ text: `Hello from ${participantId}`, participantId },
				headers,
			),
		name: (headers: Record<string, string>) =>
			post(
				`/presentations/${deckId}/participant-name`,
				{ participantId, name: "Ada" },
				headers,
			),
	};
}

/** A response and a question somebody else wrote, for the two upvote routes. */
async function seedTargets(
	deckId: string,
	headers: Record<string, string>,
): Promise<{ responseId: string; questionId: string }> {
	const vote = await post(
		`/presentations/${deckId}/vote`,
		{ slideId: "s1", value: "Seeded answer", participantId: "seed" },
		headers,
	);
	expect(vote.status).toBe(200);
	const asked = await post(
		`/presentations/${deckId}/qa`,
		{ text: "Seeded question", participantId: "seed" },
		headers,
	);
	expect(asked.status).toBe(200);
	const list = await (
		await fetch(`${baseUrl}/api/presentations/${deckId}/qa`, {
			headers: { "x-api-key": ownerKey },
		})
	).json();
	return { responseId: (await vote.json()).id, questionId: list.questions[0].id };
}

describe("a deck that requires a signed-in participant (REQ134)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const schemas = await import("./schemas");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();
		await ensureAuthSchema();
		// Reopened by name: `createStore` is idempotent per collection, so this is
		// the table the binding service writes through.
		bindings = db.createStore(
			"participantAccounts",
			schemas.StoredParticipantAccountSchema,
		);

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		const accountFor = async (email: string, name: string) => {
			const account = await auth.api.signUpEmail({
				body: { email, password: PASSWORD, name },
			});
			const created = await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			});
			return { userId: account.user.id, key: created.key };
		};
		ownerKey = (await accountFor("sign-in-owner@example.com", "Owner")).key;
		const first = await accountFor("first-participant@example.com", "First");
		firstKey = first.key;
		firstUserId = first.userId;
		const second = await accountFor("second-participant@example.com", "Second");
		secondKey = second.key;
		secondUserId = second.userId;

		const signedIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: baseUrl },
			body: JSON.stringify({
				email: "first-participant@example.com",
				password: PASSWORD,
			}),
		});
		expect(signedIn.status).toBe(200);
		firstCookie = (signedIn.headers.getSetCookie?.() ?? [])
			.map((cookie) => cookie.split(";")[0])
			.join("; ");
		expect(firstCookie).toContain("session_token");
	});

	afterAll(async () => {
		await server?.stop();
		if (process.env.OMUL_AUTH_DB) {
			rmSync(join(process.env.OMUL_AUTH_DB, ".."), {
				recursive: true,
				force: true,
			});
		}
	});

	// ── The switch ──────────────────────────────────────────

	test("the switch defaults off, and a deck stored before it existed reads off", async () => {
		const schemas = await import("./schemas");
		expect(
			schemas.StoredPresentationSchema.parse({
				id: "legacy",
				title: "Old",
				code: "123456",
				slides: [],
			}).requireParticipantSignIn,
		).toBe(false);

		const res = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({
				title: "Default deck",
				slides: [{ id: "s1", type: "open-text", question: "Q" }],
			}),
		});
		const created = await res.json();
		expect(created.requireParticipantSignIn).toBe(false);
	});

	test("the switch rides creation and PATCH, and the public deck reports it", async () => {
		const pres = await createDeck(true);
		expect(pres.requireParticipantSignIn).toBe(true);

		const patch = (value: boolean) =>
			fetch(`${baseUrl}/api/presentations/${pres.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
				body: JSON.stringify({ requireParticipantSignIn: value }),
			});
		const off = await patch(false);
		expect(off.status).toBe(200);
		expect((await off.json()).requireParticipantSignIn).toBe(false);
		const anonymousRead = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		expect((await anonymousRead.json()).requireParticipantSignIn).toBe(false);

		expect((await (await patch(true)).json()).requireParticipantSignIn).toBe(true);
		const joined = await fetch(`${baseUrl}/api/join/${pres.code}`, {
			headers: { "x-api-key": firstKey },
		});
		expect((await joined.json()).requireParticipantSignIn).toBe(true);
	});

	// ── Switch off: unchanged ───────────────────────────────

	test("with the switch off, an anonymous room joins and writes as it always has, and nothing is bound", async () => {
		const pres = await createDeck(false);
		const joined = await fetch(`${baseUrl}/api/join/${pres.code}`);
		expect(joined.status).toBe(200);

		const targets = await seedTargets(pres.id, {});
		for (const [route, write] of Object.entries(
			participantWrites(pres.id, "anonymous-a", targets),
		)) {
			const res = await write({});
			expect({ route, status: res.status }).toEqual({ route, status: 200 });
		}
		// A signed-in caller on such a deck is not bound either: the switch is off.
		expect((await participantWrites(pres.id, "signed-a", targets).vote({ "x-api-key": firstKey })).status).toBe(200);
		expect(await bindings.find({ presentationId: pres.id })).toHaveLength(0);
	});

	// ── Switch on: anonymous refused ────────────────────────

	test("an anonymous join is refused with `sign-in-required`", async () => {
		const pres = await createDeck(true);
		const res = await fetch(`${baseUrl}/api/join/${pres.code}`);
		expect(res.status).toBe(401);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = await res.json();
		expect(body.refused).toBe("sign-in-required");
		expect(typeof body.error).toBe("string");
		// A refused join carries nothing of the deck.
		expect(body).not.toHaveProperty("slides");
		expect(body).not.toHaveProperty("title");
	});

	test("every anonymous participant write is refused with `sign-in-required`, and nothing lands", async () => {
		const pres = await createDeck(true);
		const writes = participantWrites(pres.id, "anonymous-a", {
			responseId: "placeholder",
			questionId: "placeholder",
		});
		for (const [route, write] of Object.entries(writes)) {
			const res = await write({});
			const body = await res.json();
			expect({ route, status: res.status, refused: body.refused }).toEqual({
				route,
				status: 401,
				refused: "sign-in-required",
			});
		}
		// The results surface still answers, and holds no answer.
		const results = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results`, {
				headers: { "x-api-key": ownerKey },
			})
		).json();
		expect(JSON.stringify(results)).not.toContain("Onboarding");
		expect(await bindings.find({ presentationId: pres.id })).toHaveLength(0);
	});

	// ── Switch on: signed-in accepted ───────────────────────

	test("a signed-in participant joins and writes on every route, by API key or session cookie", async () => {
		const pres = await createDeck(true);
		for (const headers of [{ "x-api-key": firstKey }, { Cookie: firstCookie }]) {
			const joined = await fetch(`${baseUrl}/api/join/${pres.code}`, { headers });
			expect(joined.status).toBe(200);
			expect((await joined.json()).id).toBe(pres.id);
		}

		const targets = await seedTargets(pres.id, { "x-api-key": secondKey });
		for (const [headerName, headers] of Object.entries({
			key: { "x-api-key": firstKey },
			cookie: { Cookie: firstCookie },
		})) {
			for (const [route, write] of Object.entries(
				participantWrites(pres.id, `first-${headerName}`, targets),
			)) {
				const res = await write(headers);
				expect({ headerName, route, status: res.status }).toEqual({
					headerName,
					route,
					status: 200,
				});
			}
		}

		// Every participant id written under is attributed to the account whose
		// session sent it — one binding each, the seed included.
		const stored = await bindings.find({ presentationId: pres.id });
		const byParticipant = Object.fromEntries(
			stored.map((row) => [row.participantId, row.userId]),
		);
		expect(byParticipant).toEqual({
			seed: secondUserId,
			"first-key": firstUserId,
			"first-cookie": firstUserId,
		});
	});

	test("a write naming no participant id is refused rather than stored unattributed", async () => {
		const pres = await createDeck(true);
		const res = await post(
			`/presentations/${pres.id}/chat`,
			{ text: "Who said this?" },
			{ "x-api-key": firstKey },
		);
		expect(res.status).toBe(400);
		const reaction = await post(
			`/presentations/${pres.id}/reactions`,
			{ kind: "like" },
			{ "x-api-key": firstKey },
		);
		expect(reaction.status).toBe(200);
	});

	// ── One participant id, one account ─────────────────────

	test("a participant id first used by one account is refused under another, on every write", async () => {
		const pres = await createDeck(true);
		const targets = await seedTargets(pres.id, { "x-api-key": ownerKey });
		const firstVote = await participantWrites(pres.id, "shared-id", targets).vote({
			"x-api-key": firstKey,
		});
		expect(firstVote.status).toBe(200);

		for (const [route, write] of Object.entries(
			participantWrites(pres.id, "shared-id", targets),
		)) {
			const res = await write({ "x-api-key": secondKey });
			const body = await res.json();
			expect({ route, status: res.status, refused: body.refused }).toEqual({
				route,
				status: 403,
				refused: "participant-account-mismatch",
			});
		}

		// The binding did not move, and the first account still writes under it.
		const stored = await bindings.find({
			presentationId: pres.id,
			participantId: "shared-id",
		});
		expect(stored.map((row) => row.userId)).toEqual([firstUserId]);
		const again = await participantWrites(pres.id, "shared-id", targets).chat({
			"x-api-key": firstKey,
		});
		expect(again.status).toBe(200);

		// The same id on another deck is a different participant.
		const otherDeck = await createDeck(true);
		const elsewhere = await participantWrites(otherDeck.id, "shared-id", targets).vote({
			"x-api-key": secondKey,
		});
		expect(elsewhere.status).toBe(200);
	});

	// The limit `docs/api.md` states (security review NST11845, finding 1): the
	// binding has no time window, so a switch turned off mid-session lets an
	// anonymous write land under a bound id, and the binding still names the
	// account that did not send it. Pinned so the document stays true.
	test("a switch turned off lets an anonymous write under a bound id, and the binding is not moved", async () => {
		const pres = await createDeck(true);
		const targets = { responseId: "", questionId: "" };
		const signedIn = await participantWrites(pres.id, "kiosk", targets).vote({
			"x-api-key": firstKey,
		});
		expect(signedIn.status).toBe(200);

		const off = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ requireParticipantSignIn: false }),
		});
		expect(off.status).toBe(200);
		const anonymous = await participantWrites(pres.id, "kiosk", targets).chat({});
		expect(anonymous.status).toBe(200);

		const stored = await bindings.find({
			presentationId: pres.id,
			participantId: "kiosk",
		});
		expect(stored.map((row) => row.userId)).toEqual([firstUserId]);
	});

	// ── Never published ─────────────────────────────────────

	test("the bound account reaches no public read, nor the organizer's", async () => {
		const pres = await createDeck(true);
		const targets = await seedTargets(pres.id, { "x-api-key": firstKey });
		const writes = participantWrites(pres.id, "visible-a", targets);
		for (const write of Object.values(writes)) {
			expect((await write({ "x-api-key": firstKey })).status).toBe(200);
		}

		const reads: [string, Record<string, string>][] = [
			[`/presentations/${pres.id}`, {}],
			[`/presentations/${pres.id}`, { "x-api-key": ownerKey }],
			[`/join/${pres.code}`, { "x-api-key": firstKey }],
			[`/presentations/${pres.id}/results`, {}],
			[`/presentations/${pres.id}/results`, { "x-api-key": ownerKey }],
			[`/presentations/${pres.id}/results/s1`, { "x-api-key": ownerKey }],
			[`/presentations/${pres.id}/qa?participantId=visible-a`, {}],
			[`/presentations/${pres.id}/qa`, { "x-api-key": ownerKey }],
			[`/presentations/${pres.id}/chat?participantId=visible-a`, {}],
			[`/presentations/${pres.id}/participants`, { "x-api-key": ownerKey }],
		];
		for (const [path, headers] of reads) {
			const res = await fetch(`${baseUrl}/api${path}`, { headers });
			expect({ path, status: res.status }).toEqual({ path, status: 200 });
			const text = await res.text();
			expect({ path, leaks: text.includes(firstUserId) }).toEqual({
				path,
				leaks: false,
			});
		}
	});

	// ── Erased with the deck ────────────────────────────────

	test("deleting the deck erases its bindings, and only its own", async () => {
		const deleted = await createDeck(true);
		const kept = await createDeck(true);
		for (const pres of [deleted, kept]) {
			expect(
				(
					await participantWrites(pres.id, "erased-a", {
						responseId: "",
						questionId: "",
					}).vote({ "x-api-key": firstKey })
				).status,
			).toBe(200);
		}
		expect(await bindings.find({ presentationId: deleted.id })).toHaveLength(1);

		const res = await fetch(`${baseUrl}/api/presentations/${deleted.id}`, {
			method: "DELETE",
			headers: { "x-api-key": ownerKey },
		});
		expect(res.status).toBe(200);
		expect(await bindings.find({ presentationId: deleted.id })).toHaveLength(0);
		expect(await bindings.find({ presentationId: kept.id })).toHaveLength(1);
	});

	test("a reset erases the bindings with the room's answers", async () => {
		const pres = await createDeck(true);
		await participantWrites(pres.id, "reset-a", {
			responseId: "",
			questionId: "",
		}).vote({ "x-api-key": firstKey });
		expect(await bindings.find({ presentationId: pres.id })).toHaveLength(1);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/reset`, {
			method: "POST",
			headers: { "x-api-key": ownerKey },
		});
		expect(res.status).toBe(200);
		expect(await bindings.find({ presentationId: pres.id })).toHaveLength(0);
	});
});
