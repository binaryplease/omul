/**
 * The admin allowlist (`server/admins.ts`, REQ164).
 *
 * The defect these cover: the allowlist used to be a compiled-in array holding
 * two named individuals' work addresses, so every deployment built from this
 * source inherited one deployment's administrators and no operator could name
 * their own without forking, editing a source file and rebuilding.
 *
 * **Every case runs in a fresh subprocess, and that is not incidental.** The
 * allowlist is read once, when `./admins` is first imported, which is the
 * property worth having — a request is judged against what the process started
 * with, not against whatever mutated the environment since. Bun's test runner
 * evaluates a module once for the whole run, so an in-process suite could only
 * ever observe the single allowlist this run happens to have loaded, and would
 * be at the mercy of which test file imported the module first. Starting a
 * process per case tests the shipped shape instead: a server booting with the
 * variable set one way, or not set at all.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ADMINS_MODULE = join(import.meta.dir, "admins.ts");
const VARIABLE = "OMUL_ADMIN_EMAILS";

/**
 * Start a process with `OMUL_ADMIN_EMAILS` set to `configured` (or unset when
 * it is `undefined`), import `./admins` there, and hand back the JSON value of
 * `expression`. The import happens *after* the environment is decided, exactly
 * as it does when the server boots.
 */
function inFreshProcess(configured: string | undefined, expression: string) {
	const source = [
		`import { adminEmails, isAdminEmail, adminAllowlistStartupReport } from ${JSON.stringify(ADMINS_MODULE)};`,
		`console.log(JSON.stringify(${expression}));`,
	].join("\n");

	const environment: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined) environment[name] = value;
	}
	if (configured === undefined) delete environment[VARIABLE];
	else environment[VARIABLE] = configured;

	const ran = Bun.spawnSync({ cmd: ["bun", "-e", source], env: environment });
	if (ran.exitCode !== 0) {
		throw new Error(`allowlist probe failed: ${ran.stderr.toString()}`);
	}
	return JSON.parse(ran.stdout.toString());
}

/** Whether a process configured with `configured` admits each of `emails`. */
function admits(configured: string | undefined, emails: string[]): boolean[] {
	const calls = emails.map((email) => `isAdminEmail(${email})`).join(", ");
	return inFreshProcess(configured, `[${calls}]`);
}

describe("the allowlist is what the deployment supplied (REQ164)", () => {
	test("unset names nobody — the fail-closed default", () => {
		// The whole point of the change: an image carries no administrators, so an
		// operator who has named none runs an admin surface with none on it rather
		// than inheriting whoever built the image.
		expect(inFreshProcess(undefined, "adminEmails")).toEqual([]);
		expect(
			admits(undefined, [`"someone@example.com"`, `"admin@example.com"`]),
		).toEqual([false, false]);
	});

	test("every way of supplying nothing lands on the same empty list", () => {
		// An operator's typo names no administrator; it never falls back to a list.
		for (const nothing of ["", "   ", ",", " , , ", "\n\t"]) {
			expect(inFreshProcess(nothing, "adminEmails")).toEqual([]);
			expect(admits(nothing, [`"someone@example.com"`])).toEqual([false]);
		}
	});

	test("a configured address is admitted and nothing else is", () => {
		expect(
			admits("admin@example.com", [
				`"admin@example.com"`,
				`"bob@example.com"`,
				`"admin@example.test"`,
			]),
		).toEqual([true, false, false]);
	});

	test("a comma-separated list names several, trimmed", () => {
		const configured = " admin@example.com , second-admin@example.test ";
		expect(inFreshProcess(configured, "adminEmails")).toEqual([
			"admin@example.com",
			"second-admin@example.test",
		]);
		expect(
			admits(configured, [
				`"admin@example.com"`,
				`"second-admin@example.test"`,
			]),
		).toEqual([true, true]);
	});

	test("comparison stays case-insensitive after trimming", () => {
		// The contract the route layer has always had, unchanged by where the list
		// comes from: Better Auth stores the address the account signed up with, and
		// the operator writing the variable is not the person typing the login.
		expect(inFreshProcess("Admin@Example.COM", "adminEmails")).toEqual([
			"admin@example.com",
		]);
		expect(
			admits("Admin@Example.COM", [
				`"  ADMIN@example.com "`,
				`"admin@example.com"`,
			]),
		).toEqual([true, true]);
	});

	test("a repeated address is listed once", () => {
		expect(
			inFreshProcess(
				"admin@example.com,ADMIN@example.com, admin@example.com",
				"adminEmails",
			),
		).toEqual(["admin@example.com"]);
	});

	test("null, blank and unknown are refused whatever is configured", () => {
		for (const configured of [undefined, "admin@example.com"]) {
			expect(
				admits(configured, [
					"null",
					"undefined",
					`""`,
					`"   "`,
					`"stranger@example.test"`,
				]),
			).toEqual([false, false, false, false, false]);
		}
	});

	test("no address is compiled in — the source names none", async () => {
		// The publication half of the requirement, asserted against the file rather
		// than its behaviour: a list restored as a "default" would still pass every
		// case above, because it would simply be what an unset variable yields.
		const source = await Bun.file(ADMINS_MODULE).text();
		expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
	});
});

describe("the boot report says which posture is in force", () => {
	test("an empty allowlist reports itself, naming the variable", () => {
		// An operator upgrading into this change reads this in the container log
		// instead of discovering it at a 403 they cannot explain.
		const report: string[] = inFreshProcess(
			undefined,
			"adminAllowlistStartupReport()",
		);
		expect(report.join("\n")).toContain(VARIABLE);
		expect(report.join("\n")).toContain("403");
	});

	test("a configured allowlist reports who is on it", () => {
		const report: string[] = inFreshProcess(
			"admin@example.com",
			"adminAllowlistStartupReport()",
		);
		expect(report.join("\n")).toContain("admin@example.com");
	});
});
