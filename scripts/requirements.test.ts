import { describe, expect, test } from "bun:test";
import {
	appendUpdate,
	isUntriaged,
	loadRequirements,
	parseRequirement,
	type Requirement,
	serializeRequirement,
	VALID_STATUSES,
} from "./requirements.ts";

function req(overrides: Partial<Requirement> = {}): Requirement {
	return {
		id: "REQ001",
		summary: "Create an empty presentation",
		category: "Deck & Slides",
		priority: "P0",
		source: "BR001",
		description: "A create call persists a new presentation document.",
		notes: null,
		updates: null,
		triage: { status: "pending" },
		...overrides,
	};
}

/** serialize → parse must be the identity. */
function roundTrip(input: Requirement): Requirement {
	return parseRequirement(serializeRequirement(input), `${input.id}.md`);
}

describe("requirement file format", () => {
	test("round-trips a minimal untriaged requirement", () => {
		const input = req();
		expect(roundTrip(input)).toEqual(input);
	});

	test("round-trips a fully triaged requirement", () => {
		const input = req({
			notes: "Context: starting point.\n Goal: a structured unit.",
			triage: {
				status: "done",
				tags: ["p1", "slide-types"],
				note: "Already implemented in MVP",
				updated: "2026-04-21",
			},
		});
		expect(roundTrip(input)).toEqual(input);
	});

	test("round-trips values that need YAML quoting", () => {
		const input = req({
			// colon+space, embedded newline, quotes, leading dash, date-like
			summary: 'Open Ended: allow "voting" on answers',
			category: "Question Types\n - across every slide in a deck",
			priority: "P0",
			triage: {
				status: "planned",
				tags: ["- leading dash"],
				updated: "2026-04-21",
			},
		});
		expect(roundTrip(input)).toEqual(input);
	});

	test("keeps date-like scalars as strings", () => {
		const text = serializeRequirement(
			req({ triage: { status: "done", updated: "2026-04-21" } }),
		);
		expect(text).toContain('updated: "2026-04-21"');
		expect(parseRequirement(text, "x.md").triage.updated).toBe("2026-04-21");
	});

	test("omits absent optional fields rather than writing null", () => {
		const text = serializeRequirement(
			req({ summary: null, source: null, notes: null }),
		);
		expect(text).not.toContain("null");
		expect(text).not.toContain("summary:");
		expect(text).not.toContain("## Notes");
	});

	test("accepts every shape of the source vocabulary", () => {
		for (const source of ["BR001", "BR042, BR116", "internal", null]) {
			expect(roundTrip(req({ source })).source).toBe(source);
		}
	});

	test("rejects a source that is not a BR reference", () => {
		const text = serializeRequirement(req()).replace(
			"source: BR001",
			"source: https://help.example.com/en/articles/1234-some-article",
		);
		expect(() => parseRequirement(text, "REQ001.md")).toThrow(
			/not a business-requirement reference/,
		);
	});

	test("round-trips every status", () => {
		for (const status of VALID_STATUSES) {
			const input = req({ triage: { status } });
			expect(roundTrip(input).triage.status).toBe(status);
		}
	});

	test("defaults a missing status to pending", () => {
		const parsed = parseRequirement(
			"---\nid: REQ001\ncategory: X\npriority: P0\n---\n\n## Description\n\nx\n",
			"REQ001.md",
		);
		expect(parsed.triage.status).toBe("pending");
	});

	test("round-trips an updates log", () => {
		const input = req({
			updates: [
				"- 2026-04-21 — Implemented behind the reveal endpoint (task/0004).",
				"- 2026-07-28 — Presenter toggle added.",
			].join("\n"),
		});
		expect(roundTrip(input)).toEqual(input);
	});

	test("rejects an unknown section instead of silently dropping it", () => {
		expect(() =>
			parseRequirement(
				"---\nid: REQ001\ncategory: X\npriority: P0\n---\n\n## Description\n\nx\n\n## Open questions\n\ny\n",
				"REQ001.md",
			),
		).toThrow(/unknown section "## Open questions"/);
	});

	test("rejects an unknown frontmatter field instead of dropping it", () => {
		expect(() =>
			parseRequirement(
				"---\nid: REQ001\ncategory: X\npriority: P0\ntask: workbatch/c79ad531\n---\n\n## Description\n\nx\n",
				"REQ001.md",
			),
		).toThrow(/unknown frontmatter field "task"/);
	});

	test("rejects malformed files", () => {
		expect(() => parseRequirement("no frontmatter", "x.md")).toThrow(
			/missing YAML frontmatter/,
		);
		expect(() =>
			parseRequirement("---\ncategory: X\npriority: P0\n---\n", "x.md"),
		).toThrow(/missing required frontmatter field "id"/);
		expect(() =>
			parseRequirement(
				"---\nid: nope\ncategory: X\npriority: P0\n---\n",
				"x.md",
			),
		).toThrow(/does not look like REQxxx/);
		expect(() =>
			parseRequirement(
				"---\nid: REQ001\ncategory: X\npriority: P0\nstatus: nonsense\n---\n",
				"x.md",
			),
		).toThrow(/invalid status/);
	});
});

describe("appendUpdate", () => {
	test("starts a log and then appends without rewriting", () => {
		const r = req();
		appendUpdate(r, "First change", "2026-04-21");
		expect(r.updates).toBe("- 2026-04-21 — First change");

		appendUpdate(r, "Second change", "2026-07-28");
		expect(r.updates).toBe(
			"- 2026-04-21 — First change\n- 2026-07-28 — Second change",
		);
	});

	test("survives a serialize/parse cycle", () => {
		const r = req();
		appendUpdate(r, "Shipped the reveal endpoint", "2026-07-28");
		expect(roundTrip(r).updates).toBe(r.updates);
	});
});

describe("isUntriaged", () => {
	test("is true only while no triage information exists", () => {
		expect(isUntriaged(req())).toBe(true);
		expect(isUntriaged(req({ triage: { status: "pending", tags: [] } }))).toBe(
			true,
		);
		expect(isUntriaged(req({ triage: { status: "planned" } }))).toBe(false);
		expect(
			isUntriaged(req({ triage: { status: "pending", tags: ["a"] } })),
		).toBe(false);
		expect(isUntriaged(req({ triage: { status: "pending", note: "n" } }))).toBe(
			false,
		);
	});
});

describe("the real catalog", () => {
	test("every file parses and round-trips byte-identically", async () => {
		const reqs = await loadRequirements();
		expect(reqs.length).toBeGreaterThan(0);
		for (const r of reqs) {
			expect(roundTrip(r)).toEqual(r);
		}
	});

	test("ids are unique and every requirement has a description", async () => {
		const reqs = await loadRequirements();
		expect(new Set(reqs.map((r) => r.id)).size).toBe(reqs.length);
		for (const r of reqs) {
			expect(r.description).not.toBe("");
			expect(r.category).not.toBe("");
			expect(r.priority).not.toBe("");
		}
	});
});
