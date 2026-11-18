/**
 * Integration tests for the operator's switch that closes presentation
 * creation without an account (REQ252, `OMUL_GUEST_CREATION_DISABLED`).
 *
 * Stands up the real Elysia app — the Better Auth handler, the presentation
 * routes and the generation routes — against a throw-away in-memory docstore
 * and a temporary auth database, so a cookie session and a personal API key
 * are real credentials minted by Better Auth.
 *
 * The generation routes run over a **stub generator**: the case that proves an
 * anonymous generate is refused needs a deployment that can generate, because
 * an unconfigured one answers `503` before it looks at the caller. No provider
 * key is read and no network call is made.
 *
 * The create routes read the switch on every request, so each case sets it for
 * itself through {@link withEnvironment} and puts the previous value back.
 */

// Env must be set before importing ./db and ./accounts (read at module load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUEST_CREATION_CLOSED_MESSAGE } from "./instance-access";
import { CREATE_RULE, resetRateLimits } from "./rate-limit";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "omul-guest-creation-"));
process.env.OMUL_AUTH_DB = join(temporaryDirectory, "auth.sqlite");

// loose test types
type AnyJson = any;

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;
let accountKey = "";
let accountCookie = "";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Q",
		options: [{ id: "a", text: "A" }],
	},
];

/** A template id the built-in catalog files an entry under. */
const TEMPLATE_ID = "team-check-in";

/**
 * Run `body` with each named variable set (or deleted, for `undefined`), then
 * put back what was there before.
 */
async function withEnvironment(
	settings: Record<string, string | undefined>,
	body: () => Promise<void>,
): Promise<void> {
	const before: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(settings)) {
		before[name] = process.env[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	try {
		await body();
	} finally {
		for (const [name, value] of Object.entries(before)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

const CLOSED = { OMUL_GUEST_CREATION_DISABLED: "true" };

function create(
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

const BLANK = { title: "Deck", slides: SLIDES };
const FROM_TEMPLATE = { templateId: TEMPLATE_ID };

function generate(headers: Record<string, string> = {}): Promise<Response> {
	return fetch(`${baseUrl}/api/deck-generation`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ prompt: "a retro for my team" }),
	});
}

async function signInCookie(email: string, password: string): Promise<string> {
	const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", origin: baseUrl },
		body: JSON.stringify({ email, password }),
	});
	expect(response.ok).toBe(true);
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

describe("OMUL_GUEST_CREATION_DISABLED (REQ252)", () => {
	beforeAll(async () => {
		const { connectDb } = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { createDeckGenerator } = await import("./deck-generator");
		const { createDeckGenerationRoutes } = await import(
			"./routes/deck-generation"
		);
		const { Elysia } = await import("elysia");

		await connectDb();
		await ensureAuthSchema();

		const generator = createDeckGenerator({
			model: async () => ({
				title: "Sprint retrospective",
				slides: [
					{ type: "instruction", question: "Join the retro" },
					{ type: "open-text", question: "What should we change?" },
					{ type: "scale", question: "How did it go?" },
				],
			}),
		});

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(createDeckGenerationRoutes(generator))
			.use(presentationRoutes)
			.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		server = { stop: async () => void app.stop() };

		const account = await auth.api.signUpEmail({
			body: {
				email: "guest-creation@example.com",
				password: "correct-horse-guest",
				name: "Account",
			},
		});
		accountKey = (
			await auth.api.createApiKey({
				body: { userId: account.user.id, name: "k" },
			})
		).key;
		accountCookie = await signInCookie(
			"guest-creation@example.com",
			"correct-horse-guest",
		);
	});

	afterAll(async () => {
		await server?.stop();
		rmSync(temporaryDirectory, { recursive: true, force: true });
	});

	describe("POST /api/presentations", () => {
		test("switch on: an anonymous create answers 401 with the reason, blank or from a template", async () => {
			await withEnvironment(CLOSED, async () => {
				for (const body of [BLANK, FROM_TEMPLATE]) {
					const response = await create(body);
					expect(response.status).toBe(401);
					expect(await response.json()).toEqual({
						error: GUEST_CREATION_CLOSED_MESSAGE,
					});
				}
			});
		});

		test("switch on: a cookie session creates, and is minted an edit token as before", async () => {
			await withEnvironment(CLOSED, async () => {
				for (const body of [BLANK, FROM_TEMPLATE]) {
					const response = await create(body, { Cookie: accountCookie });
					expect(response.status).toBe(201);
					const created: AnyJson = await response.json();
					expect(typeof created.creatorToken).toBe("string");
				}
			});
		});

		test("switch on: an API key creates, owner-editable and with no edit token", async () => {
			await withEnvironment(CLOSED, async () => {
				for (const body of [BLANK, FROM_TEMPLATE]) {
					const response = await create(body, { "x-api-key": accountKey });
					expect(response.status).toBe(201);
					const created: AnyJson = await response.json();
					expect(created.creatorToken).toBeNull();
				}
			});
		});

		test("switch on: an invalid API key is a caller without an account", async () => {
			await withEnvironment(CLOSED, async () => {
				const response = await create(BLANK, { "x-api-key": "not-a-key" });
				expect(response.status).toBe(401);
			});
		});

		test("unset or \"false\": an anonymous create answers 201 with an edit token, as before", async () => {
			for (const value of [undefined, "false"]) {
				await withEnvironment(
					{ OMUL_GUEST_CREATION_DISABLED: value },
					async () => {
						for (const body of [BLANK, FROM_TEMPLATE]) {
							const response = await create(body);
							expect(response.status).toBe(201);
							const created: AnyJson = await response.json();
							expect(typeof created.creatorToken).toBe("string");
						}
					},
				);
			}
		});

		test("switch on: a deck created before keeps working with its edit token, and joining by code stays open", async () => {
			const created: AnyJson = await (await create(BLANK)).json();
			await withEnvironment(CLOSED, async () => {
				const edited = await fetch(`${baseUrl}/api/presentations/${created.id}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${created.creatorToken}`,
					},
					body: JSON.stringify({ title: "Renamed" }),
				});
				expect(edited.status).toBe(200);
				expect(((await edited.json()) as AnyJson).title).toBe("Renamed");

				const joined = await fetch(`${baseUrl}/api/join/${created.code}`);
				expect(joined.status).toBe(200);
			});
		});
	});

	describe("the create budget (REQ145) is not spent by a refusal", () => {
		const LIMITS_ON = {
			OMUL_RATE_LIMITS_DISABLED: undefined,
			OMUL_TRUST_PROXY: "true",
		};

		test("switch on: refusals past the whole budget leave a signed-in create from the same address its budget", async () => {
			await withEnvironment({ ...CLOSED, ...LIMITS_ON }, async () => {
				resetRateLimits();
				try {
					const address = "203.0.113.70";
					for (let attempt = 0; attempt < CREATE_RULE.limit + 3; attempt++) {
						const refused = await create(BLANK, { "X-Forwarded-For": address });
						expect(refused.status).toBe(401);
					}
					const signedIn = await create(BLANK, {
						"X-Forwarded-For": address,
						Cookie: accountCookie,
					});
					expect(signedIn.status).toBe(201);
				} finally {
					resetRateLimits();
				}
			});
		});

		test("switch off: the same anonymous creates spend it, as before", async () => {
			await withEnvironment(
				{ OMUL_GUEST_CREATION_DISABLED: undefined, ...LIMITS_ON },
				async () => {
					resetRateLimits();
					try {
						const address = "203.0.113.71";
						for (let attempt = 0; attempt < CREATE_RULE.limit; attempt++) {
							const allowed = await create(BLANK, { "X-Forwarded-For": address });
							expect(allowed.status).toBe(201);
						}
						const overLimit = await create(BLANK, {
							"X-Forwarded-For": address,
							Cookie: accountCookie,
						});
						expect(overLimit.status).toBe(429);
					} finally {
						resetRateLimits();
					}
				},
			);
		});
	});

	describe("POST /api/deck-generation, with a generation provider configured", () => {
		const OPENED_GENERATION = { OMUL_GENERATION_ALLOW_ANONYMOUS: "true" };

		test("switch on: an anonymous generate answers 401 even with OMUL_GENERATION_ALLOW_ANONYMOUS=true", async () => {
			await withEnvironment({ ...CLOSED, ...OPENED_GENERATION }, async () => {
				const response = await generate();
				expect(response.status).toBe(401);
				expect(await response.json()).toEqual({
					error: GUEST_CREATION_CLOSED_MESSAGE,
					refused: "account-required",
				});
			});
		});

		test("switch on: GET /api/deck-generation reports requiresAccount: true whatever the anonymous switch says", async () => {
			for (const allowAnonymous of ["true", "false"]) {
				await withEnvironment(
					{ ...CLOSED, OMUL_GENERATION_ALLOW_ANONYMOUS: allowAnonymous },
					async () => {
						const report: AnyJson = await (
							await fetch(`${baseUrl}/api/deck-generation`)
						).json();
						expect(report.requiresAccount).toBe(true);
					},
				);
			}
		});

		test("switch on: a cookie session and an API key still generate", async () => {
			await withEnvironment({ ...CLOSED, ...OPENED_GENERATION }, async () => {
				expect((await generate({ Cookie: accountCookie })).status).toBe(201);
				expect((await generate({ "x-api-key": accountKey })).status).toBe(201);
			});
		});

		test("unset: the anonymous switch decides, as before", async () => {
			await withEnvironment(
				{ OMUL_GUEST_CREATION_DISABLED: undefined, ...OPENED_GENERATION },
				async () => {
					expect((await generate()).status).toBe(201);
					const report: AnyJson = await (
						await fetch(`${baseUrl}/api/deck-generation`)
					).json();
					expect(report.requiresAccount).toBe(false);
				},
			);
		});
	});
});
