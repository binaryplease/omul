#!/usr/bin/env bun
/**
 * triage.ts — filter and triage omul requirements.
 *
 * Requirements live one-per-file as frontmatter markdown in
 * docs/requirements/REQxxx.md. This CLI reads that directory and writes the
 * triage fields (status / tags / triage note / updated) back into the
 * individual files. See scripts/requirements.ts for the file format and the
 * status vocabulary.
 *
 * Usage:
 *   bun scripts/triage.ts list [--status S] [--category C] [--priority P]
 *                              [--tag T] [--search Q] [--untriaged]
 *                              [--format table|json|ids]
 *   bun scripts/triage.ts show <REQ...>
 *   bun scripts/triage.ts set <REQ...> [--status S] [--tag T...] [--note ...] [--clear-tags]
 *   bun scripts/triage.ts log <REQ...> --message "what changed"
 *   bun scripts/triage.ts clear <REQ...>
 *   bun scripts/triage.ts stats                 # breakdown by status/priority/category
 *   bun scripts/triage.ts categories            # distinct category values
 *   bun scripts/triage.ts priorities            # distinct priority values
 *   bun scripts/triage.ts validate              # check every file parses and is well-formed
 */

import { readdirSync } from "node:fs";
import {
	appendUpdate,
	isUntriaged,
	loadRequirements,
	parseRequirement,
	REQUIREMENTS_DIR,
	type Requirement,
	type Status,
	saveRequirement,
	VALID_STATUSES,
} from "./requirements.ts";

// ─── arg parsing ─────────────────────────────────────────────────────────────

interface Args {
	positional: string[];
	flags: Record<string, string | boolean>;
	multi: Record<string, string[]>;
}

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	const multi: Record<string, string[]> = {};
	const MULTI_KEYS = new Set(["tag"]);

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			const hasValue = next !== undefined && !next.startsWith("--");
			if (MULTI_KEYS.has(key)) {
				if (!multi[key]) multi[key] = [];
				if (hasValue) {
					multi[key].push(next);
					i++;
				}
			} else if (hasValue) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { positional, flags, multi };
}

// ─── filtering ───────────────────────────────────────────────────────────────

function matchesFilters(
	req: Requirement,
	flags: Record<string, string | boolean>,
	tagFilters: string[],
): boolean {
	const t = req.triage;

	if (flags.untriaged && !isUntriaged(req)) return false;
	if (typeof flags.status === "string" && t.status !== flags.status)
		return false;
	if (
		typeof flags.category === "string" &&
		!req.category.toLowerCase().includes(flags.category.toLowerCase())
	)
		return false;
	if (typeof flags.priority === "string" && req.priority !== flags.priority)
		return false;
	if (tagFilters.length > 0) {
		const tags = t.tags ?? [];
		if (!tagFilters.every((tag) => tags.includes(tag))) return false;
	}
	if (typeof flags.search === "string") {
		const q = flags.search.toLowerCase();
		const hay =
			`${req.id} ${req.summary ?? ""} ${req.description} ${req.category} ${req.notes ?? ""}`.toLowerCase();
		if (!hay.includes(q)) return false;
	}
	return true;
}

// ─── output helpers ──────────────────────────────────────────────────────────

function truncate(s: string | null | undefined, n: number): string {
	const flat = (s ?? "").replace(/\s+/g, " ").trim();
	return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

function pad(s: string, n: number): string {
	return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printTable(rows: string[][], headers: string[]): void {
	const all = [headers, ...rows];
	const widths = headers.map((_, col) =>
		Math.max(...all.map((r) => (r[col] ?? "").length)),
	);
	const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
	console.log(headers.map((h, i) => pad(h, widths[i])).join(" │ "));
	console.log(sep);
	for (const row of rows) {
		console.log(row.map((c, i) => pad(c ?? "", widths[i])).join(" │ "));
	}
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdList(args: Args): Promise<void> {
	const reqs = await loadRequirements();
	const tagFilters = args.multi.tag ?? [];
	const matched = reqs.filter((r) => matchesFilters(r, args.flags, tagFilters));

	const format = (args.flags.format as string) ?? "table";

	if (format === "ids") {
		for (const r of matched) console.log(r.id);
		return;
	}

	if (format === "json") {
		console.log(JSON.stringify(matched, null, 2));
		return;
	}

	const rows = matched.map((r) => [
		r.id,
		r.priority,
		r.triage.status,
		truncate(r.category, 24),
		truncate(r.summary, 50),
	]);
	printTable(rows, ["ID", "PRI", "STATUS", "CATEGORY", "SUMMARY"]);
	console.log(`\n${matched.length} of ${reqs.length} requirements`);
}

async function cmdShow(args: Args): Promise<void> {
	const reqs = await loadRequirements();
	const ids = args.positional.slice(1);
	if (ids.length === 0) {
		console.error("Usage: triage show <REQ...>");
		process.exit(2);
	}
	const byId = new Map(reqs.map((r) => [r.id, r]));
	for (const id of ids) {
		const r = byId.get(id);
		if (!r) {
			console.error(`Not found: ${id}`);
			continue;
		}
		const t = r.triage;
		console.log(`─── ${r.id} ────────────────────────────────────────────────`);
		console.log(`Summary:     ${r.summary ?? "-"}`);
		console.log(`Category:    ${r.category}`);
		console.log(`Priority:    ${r.priority}`);
		console.log(`Status:      ${t.status}`);
		console.log(`Tags:        ${(t.tags ?? []).join(", ") || "-"}`);
		if (t.note) console.log(`Triage note: ${t.note}`);
		if (t.updated) console.log(`Updated:     ${t.updated}`);
		console.log(`Derives:     ${r.source ?? "-"}`);
		console.log(`File:        docs/requirements/${r.id}.md`);
		console.log(`\nDescription:\n  ${r.description}`);
		if (r.notes) console.log(`\nNotes:\n  ${r.notes.replace(/\n/g, "\n  ")}`);
		if (r.updates)
			console.log(`\nUpdates:\n  ${r.updates.replace(/\n/g, "\n  ")}`);
		console.log();
	}
}

async function cmdSet(args: Args): Promise<void> {
	const reqs = await loadRequirements();
	const ids = args.positional.slice(1);
	if (ids.length === 0) {
		console.error(
			"Usage: triage set <REQ...> [--status S] [--tag T...] [--note ...] [--clear-tags]",
		);
		process.exit(2);
	}
	const byId = new Map(reqs.map((r) => [r.id, r]));
	for (const id of ids) {
		if (!byId.has(id)) {
			console.error(`Unknown requirement: ${id}`);
			process.exit(1);
		}
	}

	const status = args.flags.status as string | undefined;
	if (status && !VALID_STATUSES.includes(status as Status)) {
		console.error(`Invalid status: ${status}`);
		console.error(`Valid: ${VALID_STATUSES.join(", ")}`);
		process.exit(2);
	}

	const now = new Date().toISOString().slice(0, 10);
	for (const id of ids) {
		const req = byId.get(id)!;
		const t = req.triage;
		if (status) t.status = status as Status;
		if (typeof args.flags.note === "string") t.note = args.flags.note;
		if (args.flags["clear-tags"]) t.tags = [];
		if (args.multi.tag && args.multi.tag.length > 0) {
			const set = new Set(t.tags ?? []);
			for (const tag of args.multi.tag) set.add(tag);
			t.tags = [...set].sort();
		}
		t.updated = now;

		// prune empty optional fields
		if (t.tags && t.tags.length === 0) t.tags = undefined;
		if (!t.note) t.note = undefined;

		await saveRequirement(req);
		console.log(`${id}: ${JSON.stringify(t)}`);
	}
}

/** Append a dated entry to each requirement's `## Updates` log. */
async function cmdLog(args: Args): Promise<void> {
	const reqs = await loadRequirements();
	const ids = args.positional.slice(1);
	const message = args.flags.message;
	if (ids.length === 0 || typeof message !== "string" || !message.trim()) {
		console.error('Usage: triage log <REQ...> --message "what changed"');
		process.exit(2);
	}
	const byId = new Map(reqs.map((r) => [r.id, r]));
	for (const id of ids) {
		if (!byId.has(id)) {
			console.error(`Unknown requirement: ${id}`);
			process.exit(1);
		}
	}

	const today = new Date().toISOString().slice(0, 10);
	for (const id of ids) {
		const req = byId.get(id)!;
		appendUpdate(req, message, today);
		req.triage.updated = today;
		await saveRequirement(req);
		console.log(`${id}: logged "${message.trim()}"`);
	}
}

async function cmdClear(args: Args): Promise<void> {
	const reqs = await loadRequirements();
	const ids = args.positional.slice(1);
	if (ids.length === 0) {
		console.error("Usage: triage clear <REQ...>");
		process.exit(2);
	}
	const byId = new Map(reqs.map((r) => [r.id, r]));
	for (const id of ids) {
		const req = byId.get(id);
		if (!req) {
			console.error(`Unknown requirement: ${id}`);
			process.exit(1);
		}
		if (isUntriaged(req)) {
			console.log(`${id}: no triage state`);
			continue;
		}
		req.triage = { status: "pending" };
		await saveRequirement(req);
		console.log(`cleared ${id}`);
	}
}

async function cmdStats(): Promise<void> {
	const reqs = await loadRequirements();

	const byStatus: Record<string, number> = {};
	const byPriority: Record<string, number> = {};
	const byCategory: Record<string, number> = {};
	for (const r of reqs) {
		byStatus[r.triage.status] = (byStatus[r.triage.status] ?? 0) + 1;
		byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
		byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
	}

	console.log(`Total: ${reqs.length}\n`);
	console.log("By status:");
	for (const s of VALID_STATUSES) {
		if (byStatus[s]) console.log(`  ${pad(s, 12)} ${byStatus[s]}`);
	}
	console.log("\nBy priority:");
	for (const [p, n] of Object.entries(byPriority).sort()) {
		console.log(`  ${pad(p, 12)} ${n}`);
	}
	console.log("\nBy category (top 15):");
	const cats = Object.entries(byCategory)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15);
	for (const [c, n] of cats) {
		console.log(`  ${pad(String(n), 4)} ${c}`);
	}
}

async function cmdDistinct(field: "category" | "priority"): Promise<void> {
	const reqs = await loadRequirements();
	const values = new Set<string>();
	for (const r of reqs) {
		const v = r[field];
		if (v !== null && v !== undefined) values.add(String(v));
	}
	for (const v of [...values].sort()) console.log(v);
}

/** Every file parses, its id matches its filename, and ids are unique. */
async function cmdValidate(): Promise<void> {
	const entries = readdirSync(REQUIREMENTS_DIR).sort();
	const files = entries.filter((f) => /^REQ\d+\.md$/.test(f));
	const problems: string[] = [];

	// The directory holds requirement files and nothing else — its index lives
	// in docs/Requirements.md, one level up (ADR-0040).
	for (const stray of entries.filter((f) => !/^REQ\d+\.md$/.test(f))) {
		problems.push(
			`docs/requirements/${stray}: not a REQxxx.md requirement file`,
		);
	}

	const seen = new Map<string, string>();

	for (const file of files) {
		const path = `docs/requirements/${file}`;
		let req: Requirement;
		try {
			req = parseRequirement(
				await Bun.file(`${REQUIREMENTS_DIR}/${file}`).text(),
				path,
			);
		} catch (error) {
			problems.push(String(error instanceof Error ? error.message : error));
			continue;
		}
		if (`${req.id}.md` !== file) {
			problems.push(`${path}: id "${req.id}" does not match its filename`);
		}
		const previous = seen.get(req.id);
		if (previous) problems.push(`${path}: duplicate id, also in ${previous}`);
		seen.set(req.id, path);
		if (!req.description) problems.push(`${path}: empty Description section`);
	}

	if (problems.length > 0) {
		for (const p of problems) console.error(`✗ ${p}`);
		console.error(`\n${problems.length} problem(s) in ${files.length} files`);
		process.exit(1);
	}
	console.log(`✓ ${files.length} requirement files are valid`);
}

function usage(): void {
	console.log(`triage.ts — filter and triage omul requirements

Commands:
  list [filters]        List requirements (default command)
  show <REQ...>         Show full detail + triage state for one or more REQs
  set <REQ...> [opts]   Update triage state (see below)
  log <REQ...> --message Append a dated entry to the "## Updates" work log
  clear <REQ...>        Reset triage state back to untriaged
  stats                 Status / priority / category breakdown
  categories            List distinct categories
  priorities            List distinct priorities
  validate              Check every requirement file parses and is well-formed

Filters (for list):
  --status S            One of ${VALID_STATUSES.join(", ")}
  --category SUBSTR     Case-insensitive substring match
  --priority P0|P1|P2|P3
  --tag TAG             May be repeated; all must match
  --search Q            Free-text search in id/summary/description/category/notes
  --untriaged           Only requirements with no triage state yet
  --format table|json|ids

Set options:
  --status S            Set status (see list above)
  --tag TAG             Add a tag (repeatable)
  --clear-tags          Drop all tags before adding new ones
  --note "text"         Freeform triage note (current state, overwritten)

Log options:
  --message "text"      The entry to append (dated, never rewritten)

Workflow:
  # 1. Find candidates for a batch of work
  bun scripts/triage.ts list --category Quiz --priority P0 --untriaged

  # 2. Plan them as a batch
  bun scripts/triage.ts set REQ010 REQ011 REQ012 --status planned --tag quiz

  # 3. Later, when the work is approved to start
  bun scripts/triage.ts set REQ010 REQ011 REQ012 --status ready

  # 4. And once it ships, with a dated entry in the work log
  bun scripts/triage.ts set REQ010 --status done
  bun scripts/triage.ts log REQ010 --message "Scoring implemented"

Each requirement is one frontmatter markdown file in docs/requirements/;
"set" and "clear" rewrite the triage fields of the files they touch.`);
}

// ─── main ────────────────────────────────────────────────────────────────────

const args = parseArgs(Bun.argv.slice(2));
const cmd = args.positional[0] ?? "list";

switch (cmd) {
	case "list":
		await cmdList(args);
		break;
	case "show":
		await cmdShow(args);
		break;
	case "set":
		await cmdSet(args);
		break;
	case "log":
		await cmdLog(args);
		break;
	case "clear":
		await cmdClear(args);
		break;
	case "stats":
		await cmdStats();
		break;
	case "categories":
		await cmdDistinct("category");
		break;
	case "priorities":
		await cmdDistinct("priority");
		break;
	case "validate":
		await cmdValidate();
		break;
	case "help":
	case "--help":
	case "-h":
		usage();
		break;
	default:
		console.error(`Unknown command: ${cmd}\n`);
		usage();
		process.exit(2);
}
