/**
 * Sending feedback about omul from the app menu, over HTTP (REQ185).
 *
 *   - **Off is absent.** `POST /api/feedback` answers `404` whatever the body —
 *     valid, malformed, empty or form-encoded — and the config route reports
 *     `enabled: false`.
 *   - **JSON only.** A form-encoded, multipart or plain-text post is refused
 *     `415` and stores nothing, so another site cannot post through a browser.
 *   - **Either half is enough.** A comment alone, a rating alone and both
 *     together are each stored; neither is refused `400`.
 *   - **The contact account comes from the session.** `contactMe: true` with a
 *     session stores that session's account; without one it stores `null`.
 *   - **It has a budget of its own** (REQ145).
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "omul-feedback-"));
process.env.OMUL_AUTH_DB = join(directory, "auth.sqlite");
const FEEDBACK_DB = join(directory, "feedback.sqlite");

// loose test types
type Any = any;

let enabledRoutes: Any;
let disabledRoutes: Any;
let closeStore = () => {};
let sessionCookie = "";
let sessionUserId = "";

function send(
	routes: Any,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return routes.handle(
		new Request("http://localhost/api/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
}

function postRaw(
	routes: Any,
	contentType: string,
	body: BodyInit,
): Promise<Response> {
	return routes.handle(
		new Request("http://localhost/api/feedback", {
			method: "POST",
			headers: { "Content-Type": contentType },
			body,
		}),
	);
}

function storedCount(): number {
	const db = new Database(FEEDBACK_DB, { readonly: true });
	const { count } = db
		.query("SELECT COUNT(*) AS count FROM user_feedback")
		.get() as Any;
	db.close();
	return count;
}

function storedRow(id: string): Any {
	const db = new Database(FEEDBACK_DB, { readonly: true });
	const row = db.query("SELECT * FROM user_feedback WHERE id = ?").get(id);
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
	enabledRoutes = createFeedbackRoutes(store);
	disabledRoutes = createFeedbackRoutes(null);

	const signedUp = await auth.api.signUpEmail({
		body: {
			email: "feedback-sender@example.com",
			password: "correct-horse-feedback",
			name: "Sender",
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

describe("with the channel off (REQ185)", () => {
	test("the config route reports enabled: false", async () => {
		const response = await disabledRoutes.handle(
			new Request("http://localhost/api/feedback/config"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ enabled: false });
	});

	test("a valid submission answers 404", async () => {
		const response = await send(disabledRoutes, {
			rating: 5,
			surface: "presenter",
			language: "en",
		});
		expect(response.status).toBe(404);
	});

	test("a malformed or empty body answers 404 too, echoing nothing", async () => {
		for (const response of [
			await send(disabledRoutes, { rating: 9, surface: "x", language: "" }),
			await disabledRoutes.handle(
				new Request("http://localhost/api/feedback", { method: "POST" }),
			),
			await postRaw(
				disabledRoutes,
				"application/x-www-form-urlencoded",
				"comment=csrf&surface=other&language=en",
			),
		]) {
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({
				error: "Feedback is not collected on this server",
			});
		}
	});
});

describe("with the channel on (REQ185)", () => {
	test("the config route reports enabled: true", async () => {
		const response = await enabledRoutes.handle(
			new Request("http://localhost/api/feedback/config"),
		);
		expect(await response.json()).toEqual({ enabled: true });
	});

	test("a comment alone is stored", async () => {
		const response = await send(enabledRoutes, {
			comment: "  The word cloud is great  ",
			surface: "participant",
			language: "de",
		});
		expect(response.status).toBe(201);
		const { id } = (await response.json()) as Any;
		const row = storedRow(id);
		expect(row.rating).toBeNull();
		expect(row.comment).toBe("The word cloud is great");
		expect(row.surface).toBe("participant");
		expect(row.language).toBe("de");
		expect(row.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test("a rating alone is stored", async () => {
		const response = await send(enabledRoutes, {
			rating: 3,
			surface: "other",
			language: "en",
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.rating).toBe(3);
		expect(row.comment).toBeNull();
	});

	test("a rating and a comment together are stored", async () => {
		const response = await send(enabledRoutes, {
			rating: 5,
			comment: "Works",
			surface: "presenter",
			language: "en",
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.rating).toBe(5);
		expect(row.comment).toBe("Works");
	});

	test("neither a rating nor a non-blank comment answers 400", async () => {
		for (const body of [
			{ surface: "presenter", language: "en" },
			{ comment: "   ", surface: "presenter", language: "en" },
			{ rating: null, comment: "", surface: "presenter", language: "en" },
		]) {
			expect((await send(enabledRoutes, body)).status).toBe(400);
		}
	});

	test("a malformed body is refused before anything is stored", async () => {
		for (const body of [
			{ rating: 6, surface: "presenter", language: "en" },
			{ rating: 2.5, surface: "presenter", language: "en" },
			{ rating: 4, surface: "deck", language: "en" },
			{ rating: 4, surface: "presenter" },
			{ comment: "x".repeat(2001), surface: "presenter", language: "en" },
		]) {
			const response = await send(enabledRoutes, body);
			expect(response.status).toBe(422);
		}
	});

	test("anything but application/json is refused 415 and nothing is stored", async () => {
		const multipart = new FormData();
		multipart.set("comment", "csrf");
		multipart.set("surface", "other");
		multipart.set("language", "en");
		const before = storedCount();
		for (const response of [
			await postRaw(
				enabledRoutes,
				"application/x-www-form-urlencoded",
				"comment=csrf&surface=other&language=en",
			),
			await enabledRoutes.handle(
				new Request("http://localhost/api/feedback", {
					method: "POST",
					body: multipart,
				}),
			),
			// A text/plain form can carry a body that is valid JSON.
			await postRaw(
				enabledRoutes,
				"text/plain",
				JSON.stringify({ comment: "csrf", surface: "other", language: "en" }),
			),
		]) {
			expect(response.status).toBe(415);
		}
		expect(storedCount()).toBe(before);
	});

	test("application/json with a charset parameter is accepted", async () => {
		const response = await postRaw(
			enabledRoutes,
			"application/json; charset=utf-8",
			JSON.stringify({ rating: 2, surface: "other", language: "en" }),
		);
		expect(response.status).toBe(201);
	});

	test("contactMe with a session stores the session's account", async () => {
		const response = await send(
			enabledRoutes,
			{ rating: 4, surface: "presenter", language: "en", contactMe: true },
			{ cookie: sessionCookie },
		);
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.contactAccountId).toBe(sessionUserId);
	});

	test("a session without contactMe stores no account", async () => {
		const response = await send(
			enabledRoutes,
			{ rating: 4, surface: "presenter", language: "en", contactMe: false },
			{ cookie: sessionCookie },
		);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.contactAccountId).toBeNull();
	});

	test("contactMe without a session stores null — the body cannot name an account", async () => {
		const response = await send(enabledRoutes, {
			rating: 4,
			surface: "participant",
			language: "en",
			contactMe: true,
			contactAccountId: sessionUserId,
		});
		expect(response.status).toBe(201);
		const row = storedRow(((await response.json()) as Any).id);
		expect(row.contactAccountId).toBeNull();
	});
});

describe("the feedback budget (REQ145)", () => {
	test("past FEEDBACK_RULE the route answers 429 with a retry hint", async () => {
		const { FEEDBACK_RULE, resetRateLimits } = await import("./rate-limit");
		const inherited = process.env.OMUL_RATE_LIMITS_DISABLED;
		process.env.OMUL_RATE_LIMITS_DISABLED = "false";
		resetRateLimits();
		try {
			const body = { rating: 1, surface: "other", language: "en" };
			for (let sent = 0; sent < FEEDBACK_RULE.limit; sent++) {
				expect((await send(enabledRoutes, body)).status).toBe(201);
			}
			const refused = await send(enabledRoutes, body);
			expect(refused.status).toBe(429);
			expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
			// Off spends nothing: the 404 does not depend on the budget.
			expect((await send(disabledRoutes, body)).status).toBe(404);
		} finally {
			if (inherited === undefined) delete process.env.OMUL_RATE_LIMITS_DISABLED;
			else process.env.OMUL_RATE_LIMITS_DISABLED = inherited;
			resetRateLimits();
		}
	});
});
