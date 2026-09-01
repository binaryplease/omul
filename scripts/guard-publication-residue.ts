#!/usr/bin/env bun
// ── Publication residue guard ─────────────────────────────────────────
//
// REQ163 removes internal-estate detail from the tree that gets published.
// One of its classes is held here: a private sibling repository's slug
// (class 2), which was swept by hand twice and came back both times — most
// recently on 2026-08-29, in requirement documents written after the sweep had
// already measured the tree clean.
//
// A sweep is a measurement; nothing failed when the vocabulary came back, so
// only the next manual sweep noticed. This is the control that measurement
// was standing in for. Run via `mise run check`; exits non-zero and names the
// file, the line and the remedy — never the identifier.
//
// ── What this guard does not hold ─────────────────────────────────────
//
// It once refused the internal work queue's task identifiers as well
// (REQ163 class 3). That class was **retired by owner decision on 2026-08-31**
// and is no longer a disclosure this repository sweeps: every commit is
// stamped with such an identifier by the session runner, the published tree
// goes on collecting them as development continues, and a chase in which each
// cleanup leaves the next one's residue costs more than the identifiers
// disclose. So a work-queue identifier may sit anywhere in this tree — a
// requirement body, a commit trailer, ordinary prose — and nothing here
// refuses it. Do not re-add it: the retirement is a decision, not an omission,
// and REQ163's log records it.
//
// Class 4, the internal decision-record identifiers, is still deferred whole,
// so there is nothing yet for this guard to hold on its behalf either.
//
// ── Why the terms are held as digests ─────────────────────────────────
//
// A guard that names the string it refuses is an occurrence of that string,
// in the one file whose subject is its absence. REQ174/REQ175 dropped three
// negative-assertion guards for exactly that reason, and REQ176's own Notes
// decline to quote their subject. So the term lives here as the SHA-256 of its
// lowercased form and is compared against the digest of every candidate token
// found in the tree.
//
// That is not concealment and does not pretend to be: a short slug is
// brute-forceable and the digest below is not a secret. What it buys is that
// this repository does not *state* the identifier, which is the whole of what
// class 2 is about — a reader grepping the published tree for it finds
// nothing, including here.
//
// ── What is exempt, and what is not ───────────────────────────────────
//
// `OPEN_SOURCING_PROGRESS.md` is the publication record. It is where the
// findings are written down, it is deleted by the extraction rather than
// exported, and it is out of scope for the sweep by decision — so it is
// skipped whole.
//
// Nothing else is exempt, and no section of any file is. In particular the
// append-only `## Updates` log of a requirement gets no allowance: the tree
// carries this slug nowhere today, and an occurrence landing in a place a
// later change may not edit is worse than one in ordinary prose, not better.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..");

/** The publication record — see the exemption note above. */
const EXEMPT_PATHS = new Set(["OPEN_SOURCING_PROGRESS.md"]);

function digestOf(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/**
 * A whole token this tree may not contain, held by digest and by length. The
 * length is a prefilter — it lets the scan skip almost every token without
 * hashing it, and a length discloses nothing an identifier would.
 */
type ForbiddenToken = { digest: string; length: number };

/** REQ163 class 2 — the private infrastructure repository that owns the deploy configuration. */
const FORBIDDEN_TOKENS: ForbiddenToken[] = [
	{
		digest:
			"fb55ad6e492e7ea82a7b4b65459334ca337084375dd9094b91fb720fe4e22203",
		length: 16,
	},
];

/**
 * Every contiguous run of one or more `-`-joined segments of a token, so a
 * forbidden slug is still found when a longer name is built around it.
 */
function hyphenRuns(token: string): string[] {
	const segments = token.split("-");
	const runs: string[] = [];
	for (let start = 0; start < segments.length; start += 1) {
		for (let end = start + 1; end <= segments.length; end += 1) {
			runs.push(segments.slice(start, end).join("-"));
		}
	}
	return runs;
}

/**
 * True when the token is, or contains as a hyphen-delimited run, a forbidden
 * whole token. `_` is folded to `-` so a snake-cased spelling cannot slip past.
 */
function isForbiddenToken(token: string): boolean {
	const normalized = token.toLowerCase().replace(/_/g, "-");
	return hyphenRuns(normalized).some((run) =>
		FORBIDDEN_TOKENS.some(
			(forbidden) =>
				run.length === forbidden.length && digestOf(run) === forbidden.digest,
		),
	);
}

/**
 * The residue classes this guard holds. One today; class 4 would join here if
 * its deferred slice ever lands, which is why the report is written by class
 * rather than assuming a single kind.
 */
type ResidueClass = "estate-repository";

type Occurrence = {
	file: string;
	line: number;
	column: number;
	/**
	 * The line with *every* forbidden identifier on it replaced, so a report
	 * never restates one — including a second identifier that shares the line
	 * with the one being reported.
	 */
	maskedText: string;
	residueClass: ResidueClass;
};

const TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9_-]*/g;

const REDACTION = "‹redacted›";

/** Which class a token belongs to, or null when it is ordinary. */
function residueClassOf(token: string): ResidueClass | null {
	if (isForbiddenToken(token)) {
		return "estate-repository";
	}
	return null;
}

/** Every forbidden token on the line, with its offset. */
function forbiddenTokensOn(
	lineText: string,
): { offset: number; token: string; residueClass: ResidueClass }[] {
	const found = [];
	for (const match of lineText.matchAll(TOKEN_PATTERN)) {
		const residueClass = residueClassOf(match[0]);
		if (residueClass !== null) {
			found.push({
				offset: match.index ?? 0,
				token: match[0],
				residueClass,
			});
		}
	}
	return found;
}

function scanFile(file: string, contents: string): Occurrence[] {
	const lines = contents.split("\n");
	const occurrences: Occurrence[] = [];
	lines.forEach((lineText, lineIndex) => {
		const found = forbiddenTokensOn(lineText);
		if (found.length === 0) {
			return;
		}
		let maskedText = lineText;
		for (const { offset, token } of [...found].reverse()) {
			maskedText =
				maskedText.slice(0, offset) +
				REDACTION +
				maskedText.slice(offset + token.length);
		}
		for (const { offset, residueClass } of found) {
			occurrences.push({
				file,
				line: lineIndex + 1,
				column: offset + 1,
				maskedText,
				residueClass,
			});
		}
	});
	return occurrences;
}

/**
 * The tree the extraction would copy: every tracked file, plus every
 * not-yet-ignored untracked one. The untracked half matters because the
 * session runner's post-session hook is what commits — an agent leaves its new
 * files in the working tree, so a guard that only saw `--cached` would clear a
 * file the very next step commits.
 */
function candidateFiles(): string[] {
	const listing = Bun.spawnSync(
		["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: REPOSITORY_ROOT },
	);
	if (listing.exitCode !== 0) {
		console.error("✗ could not list the repository's files:");
		console.error(listing.stderr.toString());
		process.exit(1);
	}
	return listing.stdout
		.toString()
		.split("\0")
		.filter((path) => path.length > 0);
}

/** True for a file that is not text — a NUL byte in the first block settles it. */
function isBinary(contents: Buffer): boolean {
	return contents.subarray(0, 8192).includes(0);
}

const REMEDIES: Record<ResidueClass, string> = {
	"estate-repository":
		"Names a private sibling repository (REQ163 class 2). State the constraint by role — \"a separate private infrastructure repository\" — rather than by slug.",
};

const violations = candidateFiles()
	.filter((file) => !EXEMPT_PATHS.has(file))
	.flatMap((file) => {
		const contents = readFileSync(join(REPOSITORY_ROOT, file));
		return isBinary(contents) ? [] : scanFile(file, contents.toString("utf8"));
	});

if (violations.length > 0) {
	console.error(
		`✗ ${violations.length} publication-residue violation(s) — REQ163:\n`,
	);
	for (const violation of violations) {
		console.error(`  ${violation.file}:${violation.line}:${violation.column}`);
		console.error(
			`    [${violation.residueClass}] ${REMEDIES[violation.residueClass]}`,
		);
		console.error(`    > ${violation.maskedText.trim()}\n`);
	}
	console.error(
		"The identifier is redacted above on purpose: a report that quotes it puts it back in front of the reader this guard exists to keep it from.",
	);
	process.exit(1);
}

console.log(
	"✓ publication residue OK — no private sibling repository's name in the tracked or not-yet-committed tree",
);
