/**
 * Tests for `resolveUserId` — the credential-slot rules for resolving the
 * account behind a request.
 *
 * The guarantees under test:
 *  - `x-api-key` is the personal-key slot and is authoritative: whatever sits
 *    in `Authorization` (garbage, or even a *valid* key) is ignored whenever
 *    `x-api-key` is present.
 *  - A personal API key mistakenly sent as `Authorization: Bearer <key>` (the
 *    classic agent mistake) still resolves its account as a defensive
 *    fallback, instead of silently downgrading the request to anonymous.
 *
 * Uses a throwaway sqlite file under a temp dir and a real Better Auth instance
 * so the API-key path is exercised end-to-end, never touching real data.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir: string;
let userId: string;
let apiKey: string;
let resolveUserId: (headers: Headers) => Promise<string | null>;

beforeAll(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "omul-accounts-"));
	// The auth instance reads this at import time, so set it before the first
	// dynamic import below.
	process.env.OMUL_AUTH_DB = join(tempDir, "auth.sqlite");
	const accounts = await import("./accounts");
	await accounts.ensureAuthSchema();
	resolveUserId = accounts.resolveUserId;

	const signUp = await accounts.auth.api.signUpEmail({
		body: {
			email: "resolve-user-id@example.com",
			password: "correct-horse-battery",
			name: "Resolver",
		},
	});
	userId = signUp.user.id;
	const created = await accounts.auth.api.createApiKey({
		body: { userId, name: "test key" },
	});
	apiKey = created.key;
});

// Deferred cleanup: the sqlite path binds process-wide at import, so deleting
// mid-run could break a sibling test file that touched auth.
process.on("exit", () => {
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveUserId — credential-slot precedence", () => {
	test("a valid x-api-key resolves the account", async () => {
		expect(await resolveUserId(new Headers({ "x-api-key": apiKey }))).toBe(
			userId,
		);
	});

	test("a wrong Bearer value never breaks a valid x-api-key", async () => {
		const headers = new Headers({
			"x-api-key": apiKey,
			authorization: "Bearer totally-wrong-value",
		});
		expect(await resolveUserId(headers)).toBe(userId);
	});

	test("the Bearer slot is ignored entirely when x-api-key is present", async () => {
		// Even a VALID key in Bearer must not rescue an invalid x-api-key — the
		// x-api-key slot is authoritative once used.
		const headers = new Headers({
			"x-api-key": "not-a-real-key",
			authorization: `Bearer ${apiKey}`,
		});
		expect(await resolveUserId(headers)).toBeNull();
	});

	test("a personal key mistakenly sent as Bearer still resolves (defensive fallback)", async () => {
		const headers = new Headers({ authorization: `Bearer ${apiKey}` });
		expect(await resolveUserId(headers)).toBe(userId);
	});

	test("a non-key Bearer value resolves to anonymous, not an error", async () => {
		const headers = new Headers({ authorization: "Bearer some-random-value" });
		expect(await resolveUserId(headers)).toBeNull();
	});

	test("no credentials resolves to anonymous", async () => {
		expect(await resolveUserId(new Headers())).toBeNull();
	});
});
