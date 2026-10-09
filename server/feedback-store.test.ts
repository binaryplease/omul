/**
 * The feedback database (`server/feedback-store.ts`, REQ185).
 *
 *   - **Off opens nothing.** With `OMUL_FEEDBACK_ENABLED` anything but exactly
 *     `"true"`, there is no store and no `feedback.sqlite` on disk — through the
 *     opener and through the module's own import.
 *   - **A row holds only REQ185's columns**, and the date is the UTC day.
 *   - **The boot line says which posture is in force**, and warns when answers
 *     would be stored that no administrator can read.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createFeedbackStore,
	feedbackDay,
	feedbackDbPath,
	feedbackStartupReport,
	openConfiguredFeedbackStore,
} from "./feedback-store";

const VARIABLES = ["OMUL_FEEDBACK_ENABLED", "OMUL_FEEDBACK_DB", "DATABASE_PATH"];
const INHERITED = Object.fromEntries(
	VARIABLES.map((variable) => [variable, process.env[variable]]),
);

let directory = "";

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "omul-feedback-store-"));
	process.env.DATABASE_PATH = join(directory, "omul.sqlite");
	delete process.env.OMUL_FEEDBACK_ENABLED;
	delete process.env.OMUL_FEEDBACK_DB;
});

afterEach(() => {
	for (const variable of VARIABLES) {
		const inherited = INHERITED[variable];
		if (inherited === undefined) delete process.env[variable];
		else process.env[variable] = inherited;
	}
	rmSync(directory, { recursive: true, force: true });
});

describe("the feedback switch (REQ185)", () => {
	test("unset, or anything but exactly \"true\", opens no store and creates no file", () => {
		for (const value of [undefined, "", "TRUE", "1", "yes", " true"]) {
			if (value === undefined) delete process.env.OMUL_FEEDBACK_ENABLED;
			else process.env.OMUL_FEEDBACK_ENABLED = value;
			expect(openConfiguredFeedbackStore()).toBeNull();
		}
		expect(existsSync(join(directory, "feedback.sqlite"))).toBe(false);
	});

	test("importing the module with the switch unset creates no file either", () => {
		const moduleUrl = new URL("./feedback-store.ts", import.meta.url).href;
		const imported = Bun.spawnSync(
			["bun", "-e", `await import(${JSON.stringify(moduleUrl)});`],
			{
				env: {
					...process.env,
					DATABASE_PATH: join(directory, "omul.sqlite"),
					OMUL_FEEDBACK_ENABLED: "",
				},
			},
		);
		expect(imported.exitCode).toBe(0);
		expect(existsSync(join(directory, "feedback.sqlite"))).toBe(false);
	});

	test("\"true\" opens feedback.sqlite beside the docstore", () => {
		process.env.OMUL_FEEDBACK_ENABLED = "true";
		const store = openConfiguredFeedbackStore();
		expect(store?.path).toBe(resolve(join(directory, "feedback.sqlite")));
		expect(existsSync(join(directory, "feedback.sqlite"))).toBe(true);
		store?.close();
	});

	test("OMUL_FEEDBACK_DB moves it, and :memory: keeps it off disk", () => {
		process.env.OMUL_FEEDBACK_DB = join(directory, "elsewhere", "answers.db");
		expect(feedbackDbPath()).toBe(join(directory, "elsewhere", "answers.db"));
		process.env.OMUL_FEEDBACK_DB = ":memory:";
		expect(feedbackDbPath()).toBe(":memory:");
		delete process.env.OMUL_FEEDBACK_DB;
		process.env.DATABASE_PATH = ":memory:";
		expect(feedbackDbPath()).toBe(":memory:");
	});
});

describe("what a stored entry holds (REQ185)", () => {
	test("both tables carry exactly REQ185's columns", () => {
		const path = join(directory, "feedback.sqlite");
		createFeedbackStore(path).close();
		const db = new Database(path, { readonly: true });
		const columns = (table: string) =>
			db
				.query<{ name: string }, []>(`PRAGMA table_info(${table})`)
				.all()
				.map((column) => column.name);
		expect(columns("user_feedback")).toEqual([
			"id",
			"rating",
			"comment",
			"surface",
			"contactAccountId",
			"language",
			"createdOn",
		]);
		expect(columns("participant_feedback")).toEqual([
			"id",
			"rating",
			"comment",
			"language",
			"createdOn",
		]);
		db.close();
	});

	test("a row keeps the trimmed comment, the rating and the UTC day — nothing finer", () => {
		const path = join(directory, "feedback.sqlite");
		const store = createFeedbackStore(path);
		const sentAt = Date.UTC(2026, 9, 9, 23, 59, 30);
		const entry = store.recordUserFeedback({
			rating: 4,
			comment: "  Lovely tool  ",
			surface: "presenter",
			contactAccountId: null,
			language: "en",
			now: sentAt,
		});
		store.close();

		const db = new Database(path, { readonly: true });
		const row = db.query("SELECT * FROM user_feedback").get();
		db.close();
		expect(row).toEqual({
			id: entry.id,
			rating: 4,
			comment: "Lovely tool",
			surface: "presenter",
			contactAccountId: null,
			language: "en",
			createdOn: "2026-10-09",
		});
	});

	test("a blank comment is stored as no comment", () => {
		const store = createFeedbackStore(":memory:");
		const entry = store.recordUserFeedback({
			rating: 2,
			comment: "   ",
			surface: "other",
			contactAccountId: null,
			language: "de",
		});
		expect(entry.comment).toBeNull();
		store.close();
	});

	test("the database itself refuses an entry with neither rating nor comment", () => {
		const store = createFeedbackStore(":memory:");
		expect(() =>
			store.recordUserFeedback({
				rating: null,
				comment: "",
				surface: "other",
				contactAccountId: null,
				language: "en",
			}),
		).toThrow();
		store.close();
	});

	test("the day is UTC", () => {
		expect(feedbackDay(Date.UTC(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
	});
});

describe("the boot line (REQ185)", () => {
	test("off says so", () => {
		const lines = feedbackStartupReport(null, []);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toStartWith("[feedback] off");
	});

	test("on names the database, and warns when nobody can read it", () => {
		const store = createFeedbackStore(":memory:");
		const unread = feedbackStartupReport(store, []);
		expect(unread[0]).toStartWith("[feedback] on");
		expect(unread[0]).toContain(":memory:");
		expect(unread[1]).toContain("OMUL_ADMIN_EMAILS is empty");
		expect(feedbackStartupReport(store, ["admin@example.com"])).toHaveLength(1);
		store.close();
	});
});
