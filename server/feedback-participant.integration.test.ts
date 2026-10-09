/**
 * Answering the prompt after a session, over HTTP (REQ186).
 *
 *   - **Off is absent.** While `OMUL_FEEDBACK_PROMPT_PERCENT` is unset,
 *     `POST /api/feedback/participant` answers `404` whatever the body — valid,
 *     malformed, empty or form-encoded — and the config route reports
 *     `promptPercent: null`, with the menu channel on or off.
 *   - **JSON only.** A form-encoded, multipart or plain-text post is refused
 *     `415` and stores nothing.
 *   - **Either half is enough.** A comment alone, a rating alone and both
 *     together are each stored in `participant_feedback`; neither is `400`.
 *   - **The language is the deck's**, one of the seven the participant screens
 *     speak; anything else is refused `422`.
 *   - **Nobody is recorded.** A signed-in caller's account, and any participant,
 *     deck or account id the body carries, never reaches the database.
 *   - **The two switches are independent**, and each write has its own budget
 *     (REQ145).
 *
 * Stands up the routes over a file-backed store in a temp directory, so what
 * was stored is read back from the database itself rather than through the
 * module that wrote it.
 */

// Env must be set before importing ./accounts (it reads it at module load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedbackSettings } from "./feedback-store";
import { ParticipantLanguageSchema } from "./schemas";

const directory = mkdtempSync(join(tmpdir(), "omul-feedback-participant-"));
process.env.OMUL_AUTH_DB = join(directory, "auth.sqlite");
const FEEDBACK_DB = join(directory, "feedback.sqlite");

const OFF: FeedbackSettings = {
	menuEnabled: false,
	promptPercent: null,
	promptCooldownDays: 30,
};
const MENU_ONLY: FeedbackSettings = { ...OFF, menuEnabled: true };
const PROMPT_ONLY: FeedbackSettings = {
	...OFF,
	promptPercent: 100,
	promptCooldownDays: 7,
};
const BOTH: FeedbackSettings = { ...PROMPT_ONLY, menuEnabled: true };

// loose test types
type Any = any;

let offRoutes: Any;
let menuOnlyRoutes: Any;
let promptOnlyRoutes: Any;
let bothRoutes: Any;
let closeStore = () => {};
let sessionCookie = "";
let sessionUserId = "";
const SESSION_EMAIL = "prompt-answerer@example.com";

function post(
	routes: Any,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return routes.handle(
		new Request(`http://localhost/api${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
}

function answer(
	routes: Any,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return post(routes, "/feedback/participant", body, headers);
}

function postRaw(
	routes: Any,
	contentType: string,
	body: BodyInit,
): Promise<Response> {
	return routes.handle(
		new Request("http://localhost/api/feedback/participant", {
			method: "POST",
			headers: { "Content-Type": contentType },
			body,
		}),
	);
}

async function config(routes: Any): Promise<Any> {
	const response = await routes.handle(
		new Request("http://localhost/api/feedback/config"),
	);
	expect(response.status).toBe(200);
	return response.json();
}

function storedRows(): Any[] {
	const db = new Database(FEEDBACK_DB, { readonly: true });
	const rows = db.query("SELECT * FROM participant_feedback").all();
	db.close();
	return rows;
}

function storedRow(id: string): Any {
	const db = new Database(FEEDBACK_DB, { readonly: true });
	const row = db
		.query("SELECT * FROM participant_feedback WHERE id = ?")
		.get(id);
	db.close();
	return row;
}

beforeAll(async () => {
	const { auth, ensureAuthSchema } = await import("./accounts");
	const { createFeedbackStore } = await import("./feedback-store");
	const { createFeedbackRoutes } = await import("./routes/feedback");
	await ensureAuthSchema();

	const store = createFeedbackStore(FEEDBACK_DB);
	closeStore = () => store.close();
	offRoutes = createFeedbackRoutes(null, OFF);
	menuOnlyRoutes = createFeedbackRoutes(store, MENU_ONLY);
	promptOnlyRoutes = createFeedbackRoutes(store, PROMPT_ONLY);
	bothRoutes = createFeedbackRoutes(store, BOTH);

	const signedUp = await auth.api.signUpEmail({
		body: {
			email: SESSION_EMAIL,
			password: "correct-horse-prompt",
			name: "Answerer",
		},
		asResponse: true,
	});
	sessionCookie = signedUp.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
	sessionUserId = ((await signedUp.json()) as Any).user.id;
});

afterAll(() => {
	closeStore();
	rmSync(directory, { recursive: true, force: true });
});

describe("with the prompt off (REQ186)", () => {
	test("every request answers 404 — valid, malformed, empty or form-encoded — menu on or off", async () => {
		for (const routes of [offRoutes, menuOnlyRoutes]) {
			for (const response of [
				await answer(routes, { rating: 5, language: "en" }),
				await answer(routes, { rating: 9, language: "xx" }),
				await routes.handle(
					new Request("http://localhost/api/feedback/participant", {
						method: "POST",
					}),
				),
				await postRaw(
					routes,
					"application/x-www-form-urlencoded",
					"comment=csrf&language=en",
				),
			]) {
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({
					error: "Feedback from participants is not collected on this server",
				});
			}
		}
		expect(storedRows()).toEqual([]);
	});

	test("the config route reports promptPercent: null and the cooldown", async () => {
		expect(await config(offRoutes)).toEqual({
			enabled: false,
			promptPercent: null,
			promptCooldownDays: 30,
		});
		expect(await config(menuOnlyRoutes)).toEqual({
			enabled: true,
			promptPercent: null,
			promptCooldownDays: 30,
		});
	});
});

describe("with the prompt on (REQ186)", () => {
	test("the config route reports the percentage and the cooldown", async () => {
		expect(await config(promptOnlyRoutes)).toEqual({
			enabled: false,
			promptPercent: 100,
			promptCooldownDays: 7,
		});
		expect(await config(bothRoutes)).toEqual({
			enabled: true,
			promptPercent: 100,
			promptCooldownDays: 7,
		});
	});

	test("a comment alone is stored", async () => {
		const response = await answer(promptOnlyRoutes, {
			comment: "  Easy to follow  ",
			language: "de",
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.rating).toBeNull();
		expect(row.comment).toBe("Easy to follow");
		expect(row.language).toBe("de");
		expect(row.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test("a rating alone is stored", async () => {
		const response = await answer(promptOnlyRoutes, {
			rating: 2,
			language: "fr",
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.rating).toBe(2);
		expect(row.comment).toBeNull();
	});

	test("a rating and a comment together are stored", async () => {
		const response = await answer(bothRoutes, {
			rating: 5,
			comment: "Loved the quiz",
			language: "it",
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.rating).toBe(5);
		expect(row.comment).toBe("Loved the quiz");
		expect(row.language).toBe("it");
	});

	test("neither a rating nor a non-blank comment answers 400", async () => {
		const before = storedRows().length;
		for (const body of [
			{ language: "en" },
			{ comment: "   ", language: "en" },
			{ rating: null, comment: "", language: "en" },
		]) {
			const response = await answer(promptOnlyRoutes, body);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: "Feedback needs a rating, a comment, or both",
			});
		}
		expect(storedRows()).toHaveLength(before);
	});

	test("a language outside the seven, or none, is refused 422", async () => {
		const before = storedRows().length;
		for (const body of [
			{ rating: 4 },
			{ rating: 4, language: "" },
			{ rating: 4, language: "xx" },
			{ rating: 4, language: "EN" },
			{ rating: 4, language: "en-GB" },
			{ rating: 4, language: 7 },
		]) {
			expect((await answer(promptOnlyRoutes, body)).status).toBe(422);
		}
		expect(storedRows()).toHaveLength(before);
	});

	test("every one of the seven languages is accepted", async () => {
		for (const language of ParticipantLanguageSchema.options) {
			expect(
				(await answer(promptOnlyRoutes, { rating: 3, language })).status,
			).toBe(201);
		}
	});

	test("a malformed rating or an overlong comment is refused 422", async () => {
		for (const body of [
			{ rating: 6, language: "en" },
			{ rating: 0, language: "en" },
			{ rating: 2.5, language: "en" },
			{ comment: "x".repeat(2001), language: "en" },
		]) {
			expect((await answer(promptOnlyRoutes, body)).status).toBe(422);
		}
	});

	test("anything but application/json is refused 415 and nothing is stored", async () => {
		const multipart = new FormData();
		multipart.set("comment", "csrf");
		multipart.set("language", "en");
		const before = storedRows().length;
		for (const response of [
			await postRaw(
				promptOnlyRoutes,
				"application/x-www-form-urlencoded",
				"comment=csrf&language=en",
			),
			await promptOnlyRoutes.handle(
				new Request("http://localhost/api/feedback/participant", {
					method: "POST",
					body: multipart,
				}),
			),
			await postRaw(
				promptOnlyRoutes,
				"text/plain",
				JSON.stringify({ comment: "csrf", language: "en" }),
			),
		]) {
			expect(response.status).toBe(415);
		}
		expect(storedRows()).toHaveLength(before);
	});

	test("a signed-in caller is stored as anonymously as anyone, whatever the body names", async () => {
		const response = await answer(
			promptOnlyRoutes,
			{
				rating: 4,
				comment: "From a signed-in participant",
				language: "en",
				contactMe: true,
				contactAccountId: sessionUserId,
				accountId: sessionUserId,
				participantId: "participant-123",
				presentationId: "presentation-456",
				surface: "participant",
			},
			{ cookie: sessionCookie, "user-agent": "agent-under-test/1.0" },
		);
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(Object.keys(row)).toEqual([
			"id",
			"rating",
			"comment",
			"language",
			"createdOn",
		]);
		// Nothing of the caller is anywhere in the file, its write-ahead log
		// included.
		const bytes = [FEEDBACK_DB, `${FEEDBACK_DB}-wal`]
			.filter((file) => existsSync(file))
			.map((file) => readFileSync(file).toString("latin1"))
			.join("");
		for (const trace of [
			sessionUserId,
			SESSION_EMAIL,
			"participant-123",
			"presentation-456",
			"agent-under-test",
		]) {
			expect(bytes).not.toContain(trace);
		}
	});
});

describe("the two switches are independent (REQ186)", () => {
	test("prompt on, menu off: participant answers are stored and POST /api/feedback is 404", async () => {
		expect(
			(await answer(promptOnlyRoutes, { rating: 1, language: "nl" })).status,
		).toBe(201);
		const menu = await post(promptOnlyRoutes, "/feedback", {
			rating: 1,
			surface: "other",
			language: "en",
		});
		expect(menu.status).toBe(404);
		expect(await menu.json()).toEqual({
			error: "Feedback is not collected on this server",
		});
	});

	test("menu on, prompt off: the menu still stores and the prompt is 404", async () => {
		expect(
			(
				await post(menuOnlyRoutes, "/feedback", {
					rating: 1,
					surface: "other",
					language: "en",
				})
			).status,
		).toBe(201);
		expect(
			(await answer(menuOnlyRoutes, { rating: 1, language: "en" })).status,
		).toBe(404);
	});
});

describe("the participant budget (REQ145)", () => {
	test("past PARTICIPANT_FEEDBACK_RULE the route answers 429, and the menu's budget is its own", async () => {
		const { FEEDBACK_RULE, PARTICIPANT_FEEDBACK_RULE, resetRateLimits } =
			await import("./rate-limit");
		const inherited = process.env.OMUL_RATE_LIMITS_DISABLED;
		process.env.OMUL_RATE_LIMITS_DISABLED = "false";
		resetRateLimits();
		try {
			// Spending the whole menu budget leaves the prompt's untouched.
			const menuBody = { rating: 1, surface: "other", language: "en" };
			for (let sent = 0; sent < FEEDBACK_RULE.limit; sent++) {
				expect((await post(bothRoutes, "/feedback", menuBody)).status).toBe(201);
			}
			expect((await post(bothRoutes, "/feedback", menuBody)).status).toBe(429);

			const body = { rating: 1, language: "en" };
			for (let sent = 0; sent < PARTICIPANT_FEEDBACK_RULE.limit; sent++) {
				expect((await answer(bothRoutes, body)).status).toBe(201);
			}
			const refused = await answer(bothRoutes, body);
			expect(refused.status).toBe(429);
			expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
			// Off spends nothing: the 404 does not depend on the budget.
			expect((await answer(offRoutes, body)).status).toBe(404);
		} finally {
			if (inherited === undefined) delete process.env.OMUL_RATE_LIMITS_DISABLED;
			else process.env.OMUL_RATE_LIMITS_DISABLED = inherited;
			resetRateLimits();
		}
	});
});

describe("the seven languages (REQ186)", () => {
	test("are exactly the client's Lang in src/i18n.ts", () => {
		const source = readFileSync(
			new URL("../src/i18n.ts", import.meta.url),
			"utf8",
		);
		const declared = source.match(/export type Lang = ([^;]+);/)?.[1] ?? "";
		const clientLanguages = [...declared.matchAll(/"([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(clientLanguages).toEqual([...ParticipantLanguageSchema.options]);
	});
});
