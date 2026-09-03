/**
 * requirements.ts — the requirement store: one frontmatter markdown file per REQ.
 *
 * These are **source-code requirements**: what the code must do. What the
 * business wants and why lives in a private documentation sidecar as a
 * business requirement (`BRxxx`), and a requirement here names the BRs it
 * answers in its `source` field — or `internal`, where no BR is behind it. The
 * split is what lets this repository be public without its product strategy,
 * plan tiers and competitive research being public with it.
 *
 * Each requirement lives in `docs/requirements/REQxxx.md`. YAML frontmatter
 * carries the queryable fields (identity, classification, triage state); the
 * markdown body carries the long prose:
 *
 *   ---
 *   id: REQ001
 *   summary: Create an empty presentation
 *   category: Deck & Slides
 *   priority: P0
 *   source: BR001
 *   status: done
 *   tags:
 *     - p1
 *   updated: "2026-04-21"
 *   ---
 *
 *   ## Description
 *
 *   A create call persists a new presentation document …
 *
 *   ## Notes
 *
 *   Constraint: …
 *
 *   ## Triage note
 *
 *   Already implemented in MVP; verified via code inspection
 *
 *   ## Updates
 *
 *   - 2026-04-21 — Implemented behind the reveal endpoint.
 *
 * Catalog fields (`summary`, `category`, `priority`, `source`, and the
 * Description/Notes sections) describe what has to be built. Triage fields
 * (`status`, `tags`, `updated`, and the Triage note section) describe our
 * handling of it and are what `scripts/triage.ts` writes. The Updates section is
 * an append-only work log — one dated entry per change, newest last, written by
 * `triage log`.
 *
 * `source` is a closed vocabulary, enforced by `SOURCE_PATTERN` below:
 *   BR042           — derives from that business requirement in the sidecar
 *   BR042, BR116    — derives from several
 *   internal        — no BR behind it: a defect, a performance ceiling or a
 *                     hardening that originated in this codebase
 * It deliberately cannot hold a URL. A requirement points at the BR that
 * derives it, and the BR is where provenance is recorded; a field that cannot
 * express a URL keeps that boundary from being crossed by hand. Business
 * prose does not belong here either — a requirement that needs a plan tier or a
 * price to be understood is a BR, and the BR is where that detail stays.
 *
 * The reference is opaque by design: a bare number, never the BR's title or a
 * gloss on what it says. A pattern that admits only `BR\d+` is what makes that
 * structural rather than a habit — there is nowhere in the field to put the
 * thing we are trying not to carry across.
 *
 * The reference is also many-to-many, which is why the pattern
 * takes a list: one BR may be answered by several REQs, and one REQ may cite
 * several BRs. The two id sequences are independent — a REQ's number is this
 * catalog's next free one and says nothing about its BR's, whatever the 142
 * pairs that happen to match today suggest. This field is the only copy of the
 * BR → REQ edge; the reverse direction is computed from it
 * (`grep -lE '^source:.*\bBR042\b' docs/requirements/*.md`), never stored in the
 * sidecar.
 *
 * There is no `plan` field and no `screenshot` field. Plan and tier are pricing
 * decisions and live on the BR; a screenshot of somebody else's product is the
 * one kind of copying that would be a real problem in a public repository, and
 * the field it would arrive through is gone rather than merely unused.
 *
 * Which branch the work landed on is git's to answer, not the catalog's: the
 * commit that closes a requirement is the implementation commit, and the merge
 * commit names the branch.
 *
 * `status` is omul's own state set — `VALID_STATUSES` below is the authority,
 * because work tracking, states included, is each repository's own to choose:
 *   pending      — not yet triaged (the default every file starts at)
 *   planned      — scheduled for a task, not yet approved
 *   ready        — approved for execution
 *   in-progress  — actively being worked on
 *   done         — completed
 *   blocked      — external dependency
 *   cancelled    — abandoned
 *   deferred     — intentionally postponed, out of current scope
 *   rejected     — will not implement
 *
 * A requirement counts as *untriaged* while it still carries no triage
 * information at all — status `pending`, no tags, no triage note.
 *
 * Both the frontmatter keys and the body sections are a closed set: an unknown
 * key or `## ` heading is a hard parse error, because the writer only emits the
 * ones above and would silently drop anything else on the next write.
 *
 * Body sections are delimited by `## ` headings, so requirement prose must not
 * contain a line starting with `## `.
 */

import { readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// Resolved from this module, not the entry script, so importers anywhere work.
export const REQUIREMENTS_DIR = join(
	realpathSync(import.meta.dir),
	"../docs/requirements",
);

export const VALID_STATUSES = [
	"pending",
	"planned",
	"ready",
	"in-progress",
	"done",
	"blocked",
	"cancelled",
	"deferred",
	"rejected",
] as const;
export type Status = (typeof VALID_STATUSES)[number];

/** Triage state — how we are handling the requirement. */
export interface Triage {
	status: Status;
	tags?: string[];
	note?: string;
	updated?: string;
}

/** One requirement: what has to be built, plus its triage state. */
export interface Requirement {
	id: string;
	summary: string | null;
	category: string;
	priority: string;
	/** `BR042`, `BR042, BR116`, or `internal` — see `SOURCE_PATTERN`. */
	source: string | null;
	description: string;
	notes: string | null;
	/** Append-only work log: what happened to this requirement, newest last. */
	updates: string | null;
	triage: Triage;
}

const ID_PATTERN = /^REQ\d{3,}$/;

/**
 * What `source` may say: a business-requirement reference list, or `internal`
 * for a requirement this codebase raised itself. Anything else — a URL above
 * all — is a parse error, so a citation to another product's documentation
 * cannot re-enter a public repository through this field.
 */
const SOURCE_PATTERN = /^(?:BR\d{3,}(?:, BR\d{3,})*|internal)$/;

// ─── YAML frontmatter emitting ───────────────────────────────────────────────

/** Scalars a YAML parser would coerce away from string, so they need quoting. */
const AMBIGUOUS_PLAIN =
	/^(?:true|false|yes|no|on|off|null|~|[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\d{4}-\d{2}-\d{2}(?:[T ].*)?)$/i;

function needsQuoting(value: string): boolean {
	if (value === "") return true;
	if (/^\s|\s$/.test(value)) return true;
	// guarding against them is the point
	if (/[\u0000-\u001f\u007f]/.test(value)) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
	if (/:\s/.test(value) || value.endsWith(":")) return true;
	if (/\s#/.test(value)) return true;
	return AMBIGUOUS_PLAIN.test(value);
}

function yamlScalar(value: string): string {
	if (!needsQuoting(value)) return value;
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

function yamlField(key: string, value: string | null | undefined): string[] {
	if (value === null || value === undefined) return [];
	return [`${key}: ${yamlScalar(value)}`];
}

function yamlList(key: string, values: string[] | undefined): string[] {
	if (!values || values.length === 0) return [];
	return [`${key}:`, ...values.map((v) => `  - ${yamlScalar(v)}`)];
}

// ─── serialize ───────────────────────────────────────────────────────────────

/** One `## Heading` block, or nothing when the field is empty. */
function section(heading: string, body: string | null | undefined): string[] {
	if (!body) return [];
	return [`## ${heading}\n\n${body}`];
}

export function serializeRequirement(req: Requirement): string {
	const frontmatter = [
		...yamlField("id", req.id),
		...yamlField("summary", req.summary),
		...yamlField("category", req.category),
		...yamlField("priority", req.priority),
		...yamlField("source", req.source),
		...yamlField("status", req.triage.status),
		...yamlList("tags", req.triage.tags),
		...yamlField("updated", req.triage.updated),
	];

	const blocks = [
		...section("Description", req.description),
		...section("Notes", req.notes),
		...section("Triage note", req.triage.note),
		...section("Updates", req.updates),
	];

	return `---\n${frontmatter.join("\n")}\n---\n\n${blocks.join("\n\n")}\n`;
}

// ─── parse ───────────────────────────────────────────────────────────────────

const SECTION_FIELDS: Record<
	string,
	"description" | "notes" | "note" | "updates"
> = {
	description: "description",
	notes: "notes",
	"triage note": "note",
	updates: "updates",
};

/** The canonical headings, in the order the writer emits them. */
const SECTION_HEADINGS = ["Description", "Notes", "Triage note", "Updates"];

/** The canonical frontmatter keys, in the order the writer emits them. */
const FRONTMATTER_KEYS = [
	"id",
	"summary",
	"category",
	"priority",
	"source",
	"status",
	"tags",
	"updated",
];

/**
 * Split the body on `## ` headings. Unknown headings are a hard error: the
 * writer only emits the sections above, so silently accepting one would mean
 * losing it on the next write.
 */
function parseBodySections(body: string, file: string): Record<string, string> {
	const sections: Record<string, string> = {};
	let heading: string | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (heading === null) return;
		const field = SECTION_FIELDS[heading.toLowerCase()];
		if (!field) {
			throw new Error(
				`${file}: unknown section "## ${heading}" — allowed sections are ${SECTION_HEADINGS.map(
					(h) => `"## ${h}"`,
				).join(", ")}`,
			);
		}
		sections[field] = buffer.join("\n").trim();
		buffer = [];
	};

	for (const line of body.split("\n")) {
		const match = /^## (.+)$/.exec(line);
		if (match) {
			flush();
			heading = match[1].trim();
		} else if (heading !== null) {
			buffer.push(line);
		}
	}
	flush();
	return sections;
}

function requireString(value: unknown, field: string, file: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${file}: missing required frontmatter field "${field}"`);
	}
	return value;
}

function optionalString(
	value: unknown,
	field: string,
	file: string,
): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${file}: frontmatter field "${field}" must be a string`);
	}
	return value;
}

export function parseRequirement(text: string, file: string): Requirement {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	if (!match) throw new Error(`${file}: missing YAML frontmatter`);

	let front: Record<string, unknown>;
	try {
		front = (Bun.YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`${file}: invalid YAML frontmatter — ${error}`);
	}

	// Same reasoning as the section headings: the writer emits a closed set of
	// keys, so an unknown one would be lost on the next write.
	for (const key of Object.keys(front)) {
		if (!FRONTMATTER_KEYS.includes(key)) {
			throw new Error(
				`${file}: unknown frontmatter field "${key}" — allowed fields are ${FRONTMATTER_KEYS.join(
					", ",
				)}`,
			);
		}
	}

	const sections = parseBodySections(match[2], file);

	const id = requireString(front.id, "id", file);
	if (!ID_PATTERN.test(id)) {
		throw new Error(`${file}: id "${id}" does not look like REQxxx`);
	}

	const source = optionalString(front.source, "source", file);
	if (source !== null && !SOURCE_PATTERN.test(source)) {
		throw new Error(
			`${file}: source "${source}" is not a business-requirement reference — ` +
				`expected "BR042", "BR042, BR116" or "internal"`,
		);
	}

	const status = front.status ?? "pending";
	if (!VALID_STATUSES.includes(status as Status)) {
		throw new Error(`${file}: invalid status "${status}"`);
	}

	const rawTags = front.tags;
	let tags: string[] | undefined;
	if (rawTags !== undefined && rawTags !== null) {
		if (!Array.isArray(rawTags)) {
			throw new Error(`${file}: frontmatter field "tags" must be a list`);
		}
		tags = rawTags.map(String);
	}

	const triage: Triage = { status: status as Status };
	if (tags && tags.length > 0) triage.tags = tags;
	if (sections.note) triage.note = sections.note;
	const updated = optionalString(front.updated, "updated", file);
	if (updated) triage.updated = updated;

	return {
		id,
		summary: optionalString(front.summary, "summary", file),
		category: requireString(front.category, "category", file),
		priority: requireString(front.priority, "priority", file),
		source,
		description: sections.description ?? "",
		notes: sections.notes ?? null,
		updates: sections.updates ?? null,
		triage,
	};
}

// ─── IO ──────────────────────────────────────────────────────────────────────

export function requirementPath(id: string): string {
	return join(REQUIREMENTS_DIR, `${id}.md`);
}

/** All requirements, ordered by id (REQ001, REQ002, …). */
export async function loadRequirements(): Promise<Requirement[]> {
	const files = readdirSync(REQUIREMENTS_DIR)
		.filter((f) => /^REQ\d+\.md$/.test(f))
		.sort();
	const reqs = await Promise.all(
		files.map(async (file) =>
			parseRequirement(
				await Bun.file(join(REQUIREMENTS_DIR, file)).text(),
				`docs/requirements/${file}`,
			),
		),
	);
	return reqs;
}

export async function saveRequirement(req: Requirement): Promise<void> {
	await Bun.write(requirementPath(req.id), serializeRequirement(req));
}

export function removeRequirement(id: string): void {
	unlinkSync(requirementPath(id));
}

// ─── triage helpers ──────────────────────────────────────────────────────────

/**
 * Append one dated entry to a requirement's `## Updates` log. The log is
 * append-only — existing entries are never rewritten.
 */
export function appendUpdate(
	req: Requirement,
	message: string,
	date: string,
): void {
	const entry = `- ${date} — ${message.trim()}`;
	req.updates = req.updates ? `${req.updates}\n${entry}` : entry;
}

/** True while a requirement carries no triage information at all. */
export function isUntriaged(req: Requirement): boolean {
	const t = req.triage;
	return (
		t.status === "pending" &&
		(t.tags === undefined || t.tags.length === 0) &&
		t.note === undefined
	);
}
