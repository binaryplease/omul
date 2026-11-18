/**
 * The operator's switch that closes account sign-up (REQ251): how the value is
 * parsed, what `GET /api/instance-access` reports, and what Better Auth does
 * with it — a refused sign-up and an unaffected sign-in.
 *
 * **The Better Auth cases run in fresh subprocesses**, for the reason
 * `server/admins.test.ts` gives: `server/accounts.ts` builds its auth instance
 * once, when it is first imported, and Bun's test runner evaluates a module
 * once for the whole run. An in-process case could only observe the switch this
 * run happened to load. A subprocess per case boots the module the way the
 * server does, with the variable set one way or not at all. The cases share one
 * auth database file, so an account opened while sign-up was open is the
 * existing account that signs in once it is closed.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClosingSwitch } from "./closing-switch";
import {
	instanceAccessStartupReport,
	resolveInstanceAccess,
	SIGNUP_DISABLED_ENV,
	signUpDisabled,
} from "./instance-access";
import { createInstanceAccessRoutes } from "./routes/instance-access";
import { InstanceAccessSchema } from "./schemas";

describe("readClosingSwitch — the rule for a switch that closes something", () => {
	test("unset, empty and \"false\" leave it open", () => {
		expect(readClosingSwitch("SOME_SWITCH", {})).toBe(false);
		expect(readClosingSwitch("SOME_SWITCH", { SOME_SWITCH: "" })).toBe(false);
		expect(readClosingSwitch("SOME_SWITCH", { SOME_SWITCH: "false" })).toBe(
			false,
		);
	});

	test("\"true\" closes it", () => {
		expect(readClosingSwitch("SOME_SWITCH", { SOME_SWITCH: "true" })).toBe(true);
	});

	test("any other value throws, naming the variable", () => {
		for (const typo of ["1", "0", "yes", "no", "TRUE", "False", " true", "on"]) {
			expect(() =>
				readClosingSwitch("SOME_SWITCH", { SOME_SWITCH: typo }),
			).toThrow("SOME_SWITCH");
		}
	});
});

describe("OMUL_SIGNUP_DISABLED — what the instance reports (REQ251)", () => {
	test("the variable is named OMUL_SIGNUP_DISABLED", () => {
		expect(SIGNUP_DISABLED_ENV).toBe("OMUL_SIGNUP_DISABLED");
	});

	test("unset or \"false\" reports sign-up open, \"true\" closed", () => {
		expect(resolveInstanceAccess({})).toEqual({
			signUpOpen: true,
			guestCreationOpen: true,
		});
		expect(
			resolveInstanceAccess({ OMUL_SIGNUP_DISABLED: "false" }).signUpOpen,
		).toBe(true);
		expect(
			resolveInstanceAccess({ OMUL_SIGNUP_DISABLED: "true" }),
		).toEqual({ signUpOpen: false, guestCreationOpen: true });
		expect(signUpDisabled({ OMUL_SIGNUP_DISABLED: "true" })).toBe(true);
	});

	test("a malformed value throws naming OMUL_SIGNUP_DISABLED", () => {
		expect(() => resolveInstanceAccess({ OMUL_SIGNUP_DISABLED: "1" })).toThrow(
			"OMUL_SIGNUP_DISABLED",
		);
	});

	test("the boot report says which posture this is", () => {
		const [open] = instanceAccessStartupReport(resolveInstanceAccess({}));
		expect(open).toContain("Sign-up is open");
		const [closed] = instanceAccessStartupReport(
			resolveInstanceAccess({ OMUL_SIGNUP_DISABLED: "true" }),
		);
		expect(closed).toContain("Sign-up is closed");
	});
});

describe("GET /api/instance-access", () => {
	async function served(environment: Record<string, string | undefined>) {
		const app = createInstanceAccessRoutes(resolveInstanceAccess(environment));
		const response = await app.handle(
			new Request("http://localhost/api/instance-access"),
		);
		return { status: response.status, body: await response.json() };
	}

	test("answers both fields for an instance that set nothing", async () => {
		const { status, body } = await served({});
		expect(status).toBe(200);
		expect(body).toEqual({ signUpOpen: true, guestCreationOpen: true });
		expect(InstanceAccessSchema.parse(body)).toEqual(body);
	});

	test("reports signUpOpen: false while OMUL_SIGNUP_DISABLED=true", async () => {
		const { status, body } = await served({ OMUL_SIGNUP_DISABLED: "true" });
		expect(status).toBe(200);
		expect(body).toEqual({ signUpOpen: false, guestCreationOpen: true });
	});
});

// ── Better Auth, booted with the switch set one way or the other ─────────

const ACCOUNTS_MODULE = join(import.meta.dir, "accounts.ts");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "omul-signup-switch-"));
const AUTH_DB = join(temporaryDirectory, "auth.sqlite");

afterAll(() => {
	rmSync(temporaryDirectory, { recursive: true, force: true });
});

const EXISTING = { email: "existing@example.com", password: "correct-horse-battery" };

/**
 * Boot `server/accounts.ts` in a fresh process with `OMUL_SIGNUP_DISABLED` set
 * to `configured` (unset when `undefined`) and the shared auth database, send
 * `requests` through its HTTP handler in order, and hand back each answer's
 * status and error code. A boot failure comes back as the exit code and the
 * process's error output.
 */
function bootAccounts(
	configured: string | undefined,
	requests: { path: string; body: Record<string, string> }[],
):
	| { booted: true; answers: { status: number; code: string | null }[] }
	| { booted: false; exitCode: number; stderr: string } {
	const source = [
		`const accounts = await import(${JSON.stringify(ACCOUNTS_MODULE)});`,
		"await accounts.ensureAuthSchema();",
		`const requests = ${JSON.stringify(requests)};`,
		"const answers = [];",
		"for (const { path, body } of requests) {",
		"	const response = await accounts.auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {",
		'		method: "POST",',
		'		headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },',
		"		body: JSON.stringify(body),",
		"	}));",
		"	const payload = await response.json().catch(() => null);",
		"	answers.push({ status: response.status, code: payload?.code ?? null });",
		"}",
		"console.log(JSON.stringify(answers));",
	].join("\n");

	const environment: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined) environment[name] = value;
	}
	environment.OMUL_AUTH_DB = AUTH_DB;
	if (configured === undefined) delete environment[SIGNUP_DISABLED_ENV];
	else environment[SIGNUP_DISABLED_ENV] = configured;

	// `--no-env-file` so a developer's local `.env` cannot put back a variable
	// an "unset" case removed (see `server/admins.test.ts`).
	const ran = Bun.spawnSync({
		cmd: ["bun", "--no-env-file", "-e", source],
		env: environment,
	});
	if (ran.exitCode !== 0) {
		return {
			booted: false,
			exitCode: ran.exitCode,
			stderr: ran.stderr.toString(),
		};
	}
	const lines = ran.stdout.toString().trim().split("\n");
	return { booted: true, answers: JSON.parse(lines[lines.length - 1]!) };
}

const signUp = (email: string) => ({
	path: "/sign-up/email",
	body: { email, password: EXISTING.password, name: "Someone" },
});
const signIn = { path: "/sign-in/email", body: EXISTING };

describe("Better Auth with OMUL_SIGNUP_DISABLED (REQ251)", () => {
	test("unset: sign-up opens an account and it signs in, as before", () => {
		const result = bootAccounts(undefined, [signUp(EXISTING.email), signIn]);
		if (!result.booted) throw new Error(result.stderr);
		expect(result.answers).toEqual([
			{ status: 200, code: null },
			{ status: 200, code: null },
		]);
	});

	test("\"false\": sign-up stays open", () => {
		const result = bootAccounts("false", [signUp("second@example.com")]);
		if (!result.booted) throw new Error(result.stderr);
		expect(result.answers).toEqual([{ status: 200, code: null }]);
	});

	test("\"true\": sign-up answers 400 EMAIL_PASSWORD_SIGN_UP_DISABLED and the existing account signs in", () => {
		const result = bootAccounts("true", [signUp("newcomer@example.com"), signIn]);
		if (!result.booted) throw new Error(result.stderr);
		expect(result.answers).toEqual([
			{ status: 400, code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
			{ status: 200, code: null },
		]);
	});

	test("\"true\": a password reset request for an existing account is still accepted", () => {
		const result = bootAccounts("true", [
			{
				path: "/request-password-reset",
				body: { email: EXISTING.email, redirectTo: "/" },
			},
		]);
		if (!result.booted) throw new Error(result.stderr);
		expect(result.answers).toEqual([{ status: 200, code: null }]);
	});

	test("any other value stops the boot, naming the variable", () => {
		const result = bootAccounts("yes", [signIn]);
		expect(result.booted).toBe(false);
		if (result.booted) return;
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("OMUL_SIGNUP_DISABLED");
	});
});
