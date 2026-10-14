#!/usr/bin/env bun
// ── Publish gate ──────────────────────────────────────────────────────
//
// Maintainers develop in a private copy of this tree. Finished work reaches
// this repository only by promotion: one workbatch branch, rebased onto this
// repository's `main`, pushed here and merged through a pull request. Pushing a
// branch publishes every commit on it — a commit that added a line and the
// next one that removed it are both readable for good — so the gate checks the
// whole range, commit by commit, and not just the final tree.
//
//   mise run publish:gate -- <base> <head> --terms <file>
//
// Run it in the maintainer's checkout of the private copy, after
// `git fetch public`. `<base>` is this repository's `main` (`public/main`),
// `<head>` the candidate. It reads only the commits in the range, never the
// working tree, so it needs no separate clone. `--terms` names a file held outside the tree, one regular
// expression per line (`#` starts a comment): the owner's list of what must
// not cross. The file is required. A gate that quietly skipped the disclosure
// check when the list was missing would report a pass it never measured.
//
// What it checks, and what it leaves to the pull request:
//
// 1. `<base>` is an ancestor of `<head>`, so the promotion adds commits on
//    top of `main` and carries no merge from the private copy's history.
// 2. Every commit message and every added line in the range is clear of the
//    residue guard's forbidden identifiers (scripts/guard-publication-residue.ts).
// 3. The same text is clear of every pattern in the terms file.
// 4. gitleaks finds no secret in any commit of the range.
// 5. It lists the authors in the range. The CLA check on the pull request is
//    what decides whether they may be merged; the list is for the reviewer.
//
// Tests and the build run on the pull request (.github/workflows/test.yaml,
// build.yaml), where the merge decision is made.
//
// When a commit fails 2–4, the range does not cross as it is: squash the
// branch into one commit whose tree and message pass, and run the gate again.
// It exits non-zero on any failure and never prints a matched term or a secret.

import { readFileSync } from "node:fs";
import { forbiddenTokensOn } from "./guard-publication-residue.ts";

type CheckResult = { name: string; passed: boolean; details: string[] };

function usageAndExit(message: string): never {
	console.error(`✗ ${message}`);
	console.error(
		"usage: mise run publish:gate -- <base> <head> --terms <file>",
	);
	process.exit(2);
}

function parseArguments(argumentList: string[]): {
	baseRevision: string;
	headRevision: string;
	termsFile: string;
} {
	const positional: string[] = [];
	let termsFile: string | null = null;
	for (let index = 0; index < argumentList.length; index += 1) {
		const argument = argumentList[index];
		if (argument === "--terms") {
			termsFile = argumentList[index + 1] ?? null;
			index += 1;
		} else {
			positional.push(argument);
		}
	}
	if (positional.length !== 2) {
		usageAndExit("expected exactly two revisions, <base> and <head>");
	}
	if (termsFile === null) {
		usageAndExit(
			"--terms is required: the disclosure check does not run without the owner's list",
		);
	}
	return {
		baseRevision: positional[0],
		headRevision: positional[1],
		termsFile,
	};
}

function runGit(gitArguments: string[]): { exitCode: number; output: string } {
	const result = Bun.spawnSync(["git", ...gitArguments]);
	return {
		exitCode: result.exitCode,
		output: result.stdout.toString() + result.stderr.toString(),
	};
}

function gitOutputOrExit(gitArguments: string[]): string {
	const result = runGit(gitArguments);
	if (result.exitCode !== 0) {
		console.error(`✗ git ${gitArguments.join(" ")} failed:\n${result.output}`);
		process.exit(2);
	}
	return result.output;
}

function loadTermPatterns(termsFile: string): RegExp[] {
	let fileContents: string;
	try {
		fileContents = readFileSync(termsFile, "utf8");
	} catch {
		usageAndExit(`cannot read the terms file ${termsFile}`);
	}
	const patterns = fileContents
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.map((line) => new RegExp(line, "i"));
	if (patterns.length === 0) {
		usageAndExit(`the terms file ${termsFile} holds no patterns`);
	}
	return patterns;
}

/** One line of text the range would publish, with where it came from. */
type PublishedLine = { commit: string; location: string; text: string };

/** Every commit message line and every added diff line, per commit. */
function publishedLinesOf(commits: string[]): PublishedLine[] {
	const publishedLines: PublishedLine[] = [];
	for (const commit of commits) {
		const shortCommit = commit.slice(0, 8);
		const message = gitOutputOrExit(["log", "-1", "--format=%B", commit]);
		message.split("\n").forEach((text, lineIndex) => {
			publishedLines.push({
				commit: shortCommit,
				location: `message line ${lineIndex + 1}`,
				text,
			});
		});
		const diff = gitOutputOrExit([
			"show",
			"--format=",
			"--unified=0",
			"--no-color",
			"--no-ext-diff",
			commit,
		]);
		let currentFile = "?";
		for (const diffLine of diff.split("\n")) {
			if (diffLine.startsWith("+++ ")) {
				currentFile = diffLine.replace(/^\+\+\+ (b\/)?/, "");
			} else if (diffLine.startsWith("+")) {
				publishedLines.push({
					commit: shortCommit,
					location: currentFile,
					text: diffLine.slice(1),
				});
			}
		}
	}
	return publishedLines;
}

function checkAncestry(baseRevision: string, headRevision: string): CheckResult {
	const ancestry = runGit([
		"merge-base",
		"--is-ancestor",
		baseRevision,
		headRevision,
	]);
	return {
		name: "base is an ancestor of head",
		passed: ancestry.exitCode === 0,
		details:
			ancestry.exitCode === 0
				? []
				: [`rebase ${headRevision} onto ${baseRevision} first`],
	};
}

function checkResidue(publishedLines: PublishedLine[]): CheckResult {
	const hits = publishedLines.filter(
		(line) => forbiddenTokensOn(line.text).length > 0,
	);
	return {
		name: "no private sibling repository named (REQ163 class 2)",
		passed: hits.length === 0,
		details: hits.map((hit) => `${hit.commit} ${hit.location}`),
	};
}

function checkTerms(
	publishedLines: PublishedLine[],
	termPatterns: RegExp[],
): CheckResult {
	const hits = publishedLines.flatMap((line) =>
		termPatterns
			.map((pattern, patternIndex) => ({ pattern, patternIndex }))
			.filter(({ pattern }) => pattern.test(line.text))
			.map(
				({ patternIndex }) =>
					`${line.commit} ${line.location} (terms file pattern ${patternIndex + 1})`,
			),
	);
	return {
		name: `no disclosure term matched (${termPatterns.length} patterns)`,
		passed: hits.length === 0,
		details: hits,
	};
}

function checkSecrets(baseRevision: string, headRevision: string): CheckResult {
	const scan = Bun.spawnSync([
		"nix",
		"run",
		"nixpkgs#gitleaks",
		"--",
		"git",
		"--no-banner",
		"--redact",
		`--log-opts=${baseRevision}..${headRevision}`,
		".",
	]);
	const output = scan.stdout.toString() + scan.stderr.toString();
	return {
		name: "gitleaks finds no secret in the range",
		passed: scan.exitCode === 0,
		details:
			scan.exitCode === 0
				? []
				: output
						.split("\n")
						.filter((line) => line.trim().length > 0)
						.slice(-20),
	};
}

const { baseRevision, headRevision, termsFile } = parseArguments(
	process.argv.slice(2),
);
const termPatterns = loadTermPatterns(termsFile);
const commits = gitOutputOrExit([
	"rev-list",
	"--reverse",
	`${baseRevision}..${headRevision}`,
])
	.split("\n")
	.filter((commit) => commit.length > 0);
if (commits.length === 0) {
	usageAndExit(`${baseRevision}..${headRevision} holds no commits`);
}

const publishedLines = publishedLinesOf(commits);
const results: CheckResult[] = [
	checkAncestry(baseRevision, headRevision),
	checkResidue(publishedLines),
	checkTerms(publishedLines, termPatterns),
	checkSecrets(baseRevision, headRevision),
];

console.log(
	`publish gate: ${commits.length} commit(s), ${baseRevision}..${headRevision}\n`,
);
for (const result of results) {
	console.log(`${result.passed ? "✓" : "✗"} ${result.name}`);
	for (const detail of result.details) {
		console.log(`    ${detail}`);
	}
}

const authors = gitOutputOrExit([
	"log",
	"--format=%an <%ae>",
	`${baseRevision}..${headRevision}`,
])
	.split("\n")
	.filter((author) => author.length > 0);
console.log("\nauthors in the range (the pull request's CLA check decides):");
for (const author of [...new Set(authors)]) {
	console.log(`    ${author}`);
}

if (results.some((result) => !result.passed)) {
	console.log(
		"\n✗ the range does not cross as it is — squash it into one commit that passes, then run the gate again",
	);
	process.exit(1);
}
console.log("\n✓ the range may be pushed as a publish/<id> branch");
