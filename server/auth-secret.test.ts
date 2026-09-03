/**
 * The auth signing secret and the switch that permits the development one
 * (`server/auth-secret.ts`, REQ171).
 *
 * The defect these cover: the server used to fall back to a literal that ships
 * in its own source whenever `BETTER_AUTH_SECRET` was unset, so a self-hoster
 * who missed one variable ran an instance whose administrator sessions anyone
 * holding a clone could mint.
 *
 * The first fix gated that fallback on `NODE_ENV`, and the *second* defect is
 * the one worth keeping a test for: `bun build` constant-folds
 * `process.env.NODE_ENV` at bundle time, so the gate stopped being a runtime
 * decision at all. Built with `NODE_ENV` unset — what `bun run build` did — it
 * froze **open**, and the shipped bundle signed every cookie with the
 * placeholder regardless of the running server's environment.
 *
 * So this file exercises the switch two ways: directly, and — because a
 * source-level test cannot see a bundler folding anything — by building this
 * module with `bun build` and *executing the artifact*, which is the only shape
 * of test that fails when a future Bun starts folding one more variable.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuthSecret } from "./auth-secret";

const SWITCH = "OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET";

/** The environment this suite inherits, restored after every case. */
const INHERITED_SWITCH = process.env[SWITCH];
const INHERITED_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

function restoreEnvironment(): void {
	if (INHERITED_SWITCH === undefined) delete process.env[SWITCH];
	else process.env[SWITCH] = INHERITED_SWITCH;
	if (INHERITED_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
	else process.env.BETTER_AUTH_SECRET = INHERITED_AUTH_SECRET;
}

/**
 * A stand-in for the secret an operator supplies, in the *shape* the crash
 * message tells them to generate — 44 characters, base64 alphabet, trailing
 * `=`, exactly what `openssl rand -base64 32` produces — and with none of the
 * entropy (REQ173).
 *
 * The shape is what the tests below need; the randomness is not, and a random
 * literal here is indistinguishable from a leaked credential to a secret
 * scanner and nearly so to a reader. Spelling it out of a repeated word keeps
 * every property the suite relies on and costs the publication gate nothing.
 */
const SUPPLIED_SECRET = `${"notasecret".repeat(4)}not=`;

describe("resolveAuthSecret — the development secret needs an explicit switch (REQ171)", () => {
	afterEach(restoreEnvironment);

	test("the switch on, with nothing configured, yields the development secret", () => {
		delete process.env.BETTER_AUTH_SECRET;
		process.env[SWITCH] = "true";
		expect(resolveAuthSecret().length).toBeGreaterThan(0);
	});

	test("an exported secret wins even with the switch on", () => {
		process.env[SWITCH] = "true";
		process.env.BETTER_AUTH_SECRET = `  ${SUPPLIED_SECRET}  `;
		expect(resolveAuthSecret()).toBe(SUPPLIED_SECRET);
	});

	test("the switch is off unless it is exactly \"true\"", () => {
		// The default when unset or unparseable is the restrictive one,
		// so every near-miss an operator might type is a refusal, not a fallback.
		delete process.env.BETTER_AUTH_SECRET;
		for (const nearMiss of ["", "1", "yes", "TRUE", "True", " true", "false"]) {
			process.env[SWITCH] = nearMiss;
			expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
		}
		delete process.env[SWITCH];
		expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
	});

	test("NODE_ENV is not consulted for this decision at all", () => {
		// The gate must not be inferrable from an ambient environment-mode signal
		// — that is what let a build tool decide it. NODE_ENV=development
		// must NOT open the gate, and NODE_ENV=production must not close it once
		// the purpose-named switch is on.
		const inheritedNodeEnv = process.env.NODE_ENV;
		try {
			delete process.env.BETTER_AUTH_SECRET;
			delete process.env[SWITCH];
			for (const environment of ["development", "test"]) {
				process.env.NODE_ENV = environment;
				expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
			}
			process.env[SWITCH] = "true";
			process.env.NODE_ENV = "production";
			expect(resolveAuthSecret().length).toBeGreaterThan(0);
		} finally {
			if (inheritedNodeEnv === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = inheritedNodeEnv;
		}
	});

	test("an unset or blank secret without the switch is fatal", () => {
		delete process.env[SWITCH];
		for (const blank of [undefined, "", "   ", "\n\t"]) {
			if (blank === undefined) delete process.env.BETTER_AUTH_SECRET;
			else process.env.BETTER_AUTH_SECRET = blank;
			expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
		}
	});

	test("the development placeholder is refused as a configured value", () => {
		// Learn the literal the way an operator would — by reading it out of the
		// source — then try to use it as a real deployment's secret.
		delete process.env.BETTER_AUTH_SECRET;
		process.env[SWITCH] = "true";
		const developmentSecret = resolveAuthSecret();

		delete process.env[SWITCH];
		process.env.BETTER_AUTH_SECRET = developmentSecret;
		expect(() => resolveAuthSecret()).toThrow(/placeholder/);
	});

	test("a placeholder under an earlier product name is still refused", () => {
		// The rename moved the shipped literal's first word. A placeholder that
		// stops being refused because it was renamed is a hole opened by a naming
		// change: the value an operator could have copied out of an older clone is
		// no less public for having been superseded. The prefix below stands in for
		// the retired spelling, which this tree no longer carries anywhere; the
		// refusal is on the shared tail, so it is the same code path.
		delete process.env[SWITCH];
		for (const superseded of [
			"legacy-dev-insecure-secret-change-in-production",
			"anything-dev-insecure-secret-change-in-production",
		]) {
			// Long enough to clear the 32-character floor on its own, so the refusal
			// under test is the placeholder one and not the length one.
			expect(superseded.length).toBeGreaterThanOrEqual(32);
			process.env.BETTER_AUTH_SECRET = superseded;
			expect(() => resolveAuthSecret()).toThrow(/placeholder/);
		}
	});

	test("a secret shorter than 32 characters is refused", () => {
		// A known secret and a guessable one end the same way.
		delete process.env[SWITCH];
		for (const tooShort of ["x", "hunter2", "a".repeat(31)]) {
			process.env.BETTER_AUTH_SECRET = tooShort;
			expect(() => resolveAuthSecret()).toThrow(/32-character minimum/);
		}
		process.env.BETTER_AUTH_SECRET = "a".repeat(32);
		expect(resolveAuthSecret()).toBe("a".repeat(32));
	});

	test("a real secret is used, trimmed", () => {
		delete process.env[SWITCH];
		process.env.BETTER_AUTH_SECRET = `  ${SUPPLIED_SECRET}  `;
		expect(resolveAuthSecret()).toBe(SUPPLIED_SECRET);
	});

	test("the fatal message names the variable, the remedy and the dev switch", () => {
		// An operator reads this in a crashed container's log and nothing else, so
		// it has to carry the variable, the command that produces a value, and the
		// switch that is the *only* other way out — without ever echoing a secret.
		delete process.env.BETTER_AUTH_SECRET;
		delete process.env[SWITCH];
		expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
		expect(() => resolveAuthSecret()).toThrow(/openssl rand -base64 32/);
		expect(() => resolveAuthSecret()).toThrow(new RegExp(SWITCH));

		// The configured value must never reach the message.
		process.env.BETTER_AUTH_SECRET = "short-but-secret";
		expect(() => resolveAuthSecret()).toThrow(/32-character minimum/);
		try {
			resolveAuthSecret();
		} catch (failure) {
			expect((failure as Error).message).not.toContain("short-but-secret");
		}
	});
});

/**
 * The regression that matters most, and the one a source-level test cannot see.
 *
 * `bun build` folds some `process.env.X` reads into string literals. The first
 * version of this gate read `NODE_ENV`, which Bun folds, so the bundle's gate
 * was decided by whatever the *build* environment held — `"development"` when
 * unset, which froze it open. These cases build this module the way a release
 * does and then run the artifact, so the assertion is about the shipped thing
 * rather than about the source it came from.
 */
describe("the gate survives bundling — it is a runtime decision, not a baked one", () => {
	/**
	 * Bundle `server/auth-secret.ts` with `bun build`, then run the artifact with
	 * `environment` and report what `resolveAuthSecret()` did. The build inherits
	 * the switch as `buildSwitch` so the "built permissive, run restrictive" case
	 * — the exact shape of the shipped defect — can be expressed.
	 */
	function buildThenRun(
		buildSwitch: string | undefined,
		environment: Record<string, string | undefined>,
	): { exitCode: number; output: string } {
		const outputDir = mkdtempSync(join(tmpdir(), "omul-auth-secret-"));
		try {
			const buildEnvironment = { ...process.env, NODE_ENV: "development" };
			if (buildSwitch === undefined) delete buildEnvironment[SWITCH];
			else buildEnvironment[SWITCH] = buildSwitch;

			const built = Bun.spawnSync({
				cmd: [
					"bun",
					"build",
					join(import.meta.dir, "auth-secret.ts"),
					"--outdir",
					outputDir,
					"--target",
					"bun",
				],
				env: buildEnvironment,
			});
			expect(built.exitCode).toBe(0);

			const entry = join(outputDir, "auth-secret.js");
			const runner = join(outputDir, "run.ts");
			Bun.write(
				runner,
				`import { resolveAuthSecret } from ${JSON.stringify(entry)};\n` +
					"console.log(resolveAuthSecret());\n",
			);

			const runEnvironment: Record<string, string> = {};
			for (const [name, value] of Object.entries({
				...process.env,
				...environment,
			})) {
				if (value !== undefined) runEnvironment[name] = value;
			}
			for (const [name, value] of Object.entries(environment)) {
				if (value === undefined) delete runEnvironment[name];
			}

			const ran = Bun.spawnSync({ cmd: ["bun", runner], env: runEnvironment });
			return {
				exitCode: ran.exitCode,
				output: `${ran.stdout.toString()}${ran.stderr.toString()}`,
			};
		} finally {
			rmSync(outputDir, { recursive: true, force: true });
		}
	}

	test("a bundle built WITH the switch set still fails closed when run without it", () => {
		// The shipped defect, exactly: build in a permissive environment, run in a
		// real one. If the bundler folded the switch, this boots and signs with the
		// placeholder instead of crashing.
		const { exitCode, output } = buildThenRun("true", {
			[SWITCH]: undefined,
			BETTER_AUTH_SECRET: undefined,
			NODE_ENV: "production",
		});
		expect(exitCode).not.toBe(0);
		expect(output).toContain("BETTER_AUTH_SECRET");
		expect(output).not.toContain("-dev-insecure-secret");
	});

	test("a bundle built WITHOUT the switch still opens when run with it", () => {
		// The other direction: a developer must not be locked out by how the
		// artifact happened to be built.
		const { exitCode, output } = buildThenRun(undefined, {
			[SWITCH]: "true",
			BETTER_AUTH_SECRET: undefined,
		});
		expect(exitCode).toBe(0);
		expect(output).toContain("omul-dev-insecure-secret");
	});

	test("a bundle honours a real secret supplied only at run time", () => {
		const { exitCode, output } = buildThenRun(undefined, {
			[SWITCH]: undefined,
			BETTER_AUTH_SECRET: SUPPLIED_SECRET,
			NODE_ENV: "production",
		});
		expect(exitCode).toBe(0);
		expect(output).toContain(SUPPLIED_SECRET);
	});
});
