import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The triage CLI resolves `docs/requirements/` from its own location, so each
 * test runs a copy of `triage.ts` and `requirements.ts` against a scratch
 * catalog and never touches the real one.
 */
let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omul-triage-"));
	mkdirSync(join(root, "scripts"));
	mkdirSync(join(root, "docs/requirements"), { recursive: true });
	for (const script of ["triage.ts", "requirements.ts"]) {
		copyFileSync(join(import.meta.dir, script), join(root, "scripts", script));
	}
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const requirementFile = () => join(root, "docs/requirements/REQ250.md");

function triage(...args: string[]) {
	const result = Bun.spawnSync(["bun", join(root, "scripts/triage.ts"), ...args]);
	return {
		exitCode: result.exitCode,
		output: `${result.stdout.toString()}${result.stderr.toString()}`,
	};
}

const frontmatter =
	"---\nid: REQ250\ncategory: X\npriority: P0\nstatus: pending\n---\n\n";
const today = () => new Date().toISOString().slice(0, 10);

describe("triage on a file with empty section headings", () => {
	test("validate accepts a bare heading for each of the four sections", async () => {
		await Bun.write(
			requirementFile(),
			`${frontmatter}## Description\n\n## Notes\n\n## Triage note\n\n## Updates\n`,
		);
		const result = triage("validate");
		expect(result.output).toContain("✓ 1 requirement files are valid");
		expect(result.exitCode).toBe(0);
	});

	test("validate still refuses a file with no ## Description heading", async () => {
		await Bun.write(requirementFile(), `${frontmatter}## Notes\n\nn\n`);
		const result = triage("validate");
		expect(result.output).toContain('no "## Description" section');
		expect(result.exitCode).toBe(1);
	});

	test("log writes its entry under the existing bare ## Updates", async () => {
		await Bun.write(
			requirementFile(),
			`${frontmatter}## Description\n\nx\n\n## Updates\n`,
		);
		expect(triage("log", "REQ250", "--message", "First change").exitCode).toBe(
			0,
		);
		const text = await Bun.file(requirementFile()).text();
		expect(text.match(/^## Updates$/gm)).toHaveLength(1);
		expect(text).toEndWith(
			`## Description\n\nx\n\n## Updates\n\n- ${today()} — First change\n`,
		);
	});

	test("set keeps every bare heading and adds none", async () => {
		await Bun.write(
			requirementFile(),
			`${frontmatter}## Description\n\nx\n\n## Notes\n\n## Triage note\n\n## Updates\n`,
		);
		expect(triage("set", "REQ250", "--status", "done").exitCode).toBe(0);
		expect(await Bun.file(requirementFile()).text()).toBe(
			`---\nid: REQ250\ncategory: X\npriority: P0\nstatus: done\nupdated: "${today()}"\n---\n\n## Description\n\nx\n\n## Notes\n\n## Triage note\n\n## Updates\n`,
		);
	});
});
