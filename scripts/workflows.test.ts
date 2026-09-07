/**
 * A workflow's `run:` script is shell source, and `${{ }}` is textual
 * substitution into it before the shell ever starts.
 *
 * That is the whole of the class held here, and it is not hypothetical in this
 * repository. `.github/workflows/build.yaml` interpolated `github.head_ref` —
 * the branch name on a fork's pull request, chosen by whoever opens it —
 * straight into the first `run:` of a job triggered by `pull_request` on
 * `main`. Refnames forbid spaces and `~^:?*[\` but permit `$`, `(`, `)`,
 * backtick, `;`, `&` and `|`, so a branch named with a command substitution ran
 * on the runner before `actions/checkout` did. The blast radius was bounded —
 * a fork's `pull_request` token is read-only whatever the `permissions:` block
 * says, so the GHCR push could not succeed and the cache is scoped away from
 * `main` — but "bounded" is a property of today's triggers and today's token
 * scopes, and neither is held by anything. The shape is what has to be held.
 *
 * So the rule is absolute rather than a denylist of contexts: no `${{ }}` of
 * any kind inside any `run:` block, in any workflow. Values reach a script
 * through `env:`, where the runner passes them as data and the shell never
 * parses them as source. A denylist would have to be re-derived every time
 * GitHub adds a context, and the one context somebody forgets is the one that
 * matters. `${{ }}` outside a `run:` — in `if:`, `with:`, `env:` or a tag
 * expression — is not shell and is not held here.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_DIR = join(import.meta.dir, "..", ".github", "workflows");

/** One `run:` script, with the file and line it starts at. */
type RunBlock = { file: string; line: number; script: string };

/**
 * Every `run:` script in a workflow, inline form and block-scalar form both.
 *
 * Hand-scanned rather than parsed as YAML: this repository ships no YAML
 * parser, and adding a dependency to read three files is a worse trade than
 * twenty lines that fail loudly. A block runs from the `run:` key to the first
 * following line that is neither blank nor indented past that key — which is
 * exactly YAML's own rule for where a block scalar ends.
 */
function runBlocks(file: string): RunBlock[] {
	const lines = readFileSync(join(WORKFLOW_DIR, file), "utf8").split("\n");
	const blocks: RunBlock[] = [];

	for (let index = 0; index < lines.length; index++) {
		// `run:` as a mapping key, optionally the first key of a list item. A
		// commented-out or prose mention of `run:` never matches, because the
		// line would start with `#`.
		const key = lines[index].match(/^(\s*(?:-\s+)?)run:(.*)$/);
		if (key === null) continue;

		const keyColumn = key[1].length;
		const rest = key[2].trim();

		// Inline scalar: `run: bun test`. Nothing follows it.
		if (rest !== "" && !/^[|>][-+]?\d*$/.test(rest)) {
			blocks.push({ file, line: index + 1, script: rest });
			continue;
		}

		const body: string[] = [];
		let cursor = index + 1;
		while (cursor < lines.length) {
			const line = lines[cursor];
			const indent = line.length - line.trimStart().length;
			if (line.trim() !== "" && indent <= keyColumn) break;
			body.push(line);
			cursor++;
		}
		blocks.push({ file, line: index + 1, script: body.join("\n") });
		index = cursor - 1;
	}

	return blocks;
}

const WORKFLOWS = readdirSync(WORKFLOW_DIR)
	.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
	.sort();

describe("no workflow interpolates an expression into a shell script", () => {
	test("there are workflows, and they have scripts to check", () => {
		// The failure this guards is a scanner that quietly matches nothing and
		// reports every file clean — the same reason the contact guard measures
		// its own candidate set.
		expect(WORKFLOWS.length).toBeGreaterThan(0);
		expect(WORKFLOWS.flatMap(runBlocks).length).toBeGreaterThan(0);
	});

	for (const file of WORKFLOWS) {
		test(`${file} passes every value through env, never through the script`, () => {
			const offenders = runBlocks(file)
				.filter((block) => /\$\{\{/.test(block.script))
				.map((block) => `${block.file}:${block.line}`);
			// Read the failure as: move that value into the step's `env:` and
			// refer to it as "$NAME" in the script.
			expect(offenders).toEqual([]);
		});
	}
});

describe("the fork-triggered build reads its refnames as data", () => {
	// The specific regression: build.yaml's branch-info step is the one that
	// took an attacker-chosen refname, and it is the first step of a job that
	// runs on `pull_request` from a public, forkable repository.
	const build = readFileSync(join(WORKFLOW_DIR, "build.yaml"), "utf8");

	test("head_ref and ref_name arrive as environment variables", () => {
		expect(build).toMatch(/^\s*HEAD_REF: \$\{\{ github\.head_ref \}\}$/m);
		expect(build).toMatch(/^\s*REF_NAME: \$\{\{ github\.ref_name \}\}$/m);
	});

	test("the branch-info script reads them by name", () => {
		expect(build).toMatch(/RAW_BRANCH="\$HEAD_REF"/);
		expect(build).toMatch(/RAW_BRANCH="\$REF_NAME"/);
	});
});
