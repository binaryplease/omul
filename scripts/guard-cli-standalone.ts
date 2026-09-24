#!/usr/bin/env bun
// ── Command-line client standalone guard (REQ180) ─────────────────────
//
// `cli/` is built into an executable by the flake (`packages.default`), in a
// sandbox with no network and no `node_modules`. What makes that possible is a
// property of the source rather than of the build: the client imports **only
// its own modules and Bun/Node builtins** — no npm package, and none of this
// repository's own `server/` or `src/` either, both of which reach for Zod,
// Elysia and React within a file or two.
//
// That property is invisible while you work. `bun cli/index.ts` resolves
// whatever is in `node_modules`, `bun test` does too, and an `import { z }`
// added for one line of validation will pass every other check in this repo —
// and then fail in `nix build`, at release, for somebody who did not write it.
// So it is held here, where it costs a second per run.
//
// Test files are exempt: they run with the repository's dependencies present
// and are never part of the bundle. `cli/protocol.test.ts` is the clearest case
// — it imports the server's own constant precisely so the one value `cli/`
// restates cannot drift from it.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..");
const CLIENT_ROOT = join(REPOSITORY_ROOT, "cli");

/** Every `from "…"` / `import("…")` specifier in a source file, with its line. */
function importSpecifiers(source: string): { specifier: string; line: number }[] {
	const found: { specifier: string; line: number }[] = [];
	const lines = source.split("\n");
	for (const [index, text] of lines.entries()) {
		for (const match of text.matchAll(
			/(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
		)) {
			found.push({ specifier: match[1] as string, line: index + 1 });
		}
	}
	return found;
}

/** A specifier the bundle may carry: a sibling module, or a runtime builtin. */
function isSelfContained(specifier: string): boolean {
	return specifier.startsWith("./") || specifier.startsWith("node:");
}

const violations: string[] = [];

for (const name of readdirSync(CLIENT_ROOT)) {
	if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
	const path = join(CLIENT_ROOT, name);
	const source = readFileSync(path, "utf8");
	for (const { specifier, line } of importSpecifiers(source)) {
		if (isSelfContained(specifier)) continue;
		violations.push(
			`${relative(REPOSITORY_ROOT, path)}:${line} imports ${JSON.stringify(specifier)}`,
		);
	}
}

if (violations.length > 0) {
	console.error("✗ the command-line client imports something it cannot bundle:\n");
	for (const violation of violations) console.error(`  ${violation}`);
	console.error(
		"\n  cli/ must import only its own modules (./…) and runtime builtins (node:…),",
	);
	console.error(
		"  so `nix build .#omul` can build it from source with no node_modules.",
	);
	console.error(
		"  Restate what you need inside cli/ (see cli/protocol.ts), or put the work on the server.",
	);
	process.exit(1);
}

console.log(
	"✓ command-line client is self-contained — it imports only cli/ modules and runtime builtins",
);
