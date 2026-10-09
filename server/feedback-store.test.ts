/**
 * The feedback database (`server/feedback-store.ts`, REQ185, REQ186).
 *
 *   - **Off opens nothing.** With `OMUL_FEEDBACK_ENABLED` anything but exactly
 *     `"true"` and `OMUL_FEEDBACK_PROMPT_PERCENT` unset, there is no store and no
 *     `feedback.sqlite` on disk — through the opener and through the module's
 *     own import. Either switch alone opens it.
 *   - **The prompt's settings fail loudly.** A malformed percentage or cooldown
 *     stops the module's import, and so the server, naming the variable.
 *   - **A row holds only REQ185's columns**, and the date is the UTC day.
 *   - **The boot line says which posture is in force**, channel by channel, and
 *     warns when answers would be stored that no administrator can read.
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
	type FeedbackSettings,
	feedbackStartupReport,
	openConfiguredFeedbackStore,
	readFeedbackSettings,
} from "./feedback-store";

const VARIABLES = [
	"OMUL_FEEDBACK_ENABLED",
	"OMUL_FEEDBACK_PROMPT_PERCENT",
	"OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS",
	"OMUL_FEEDBACK_DB",
	"DATABASE_PATH",
];
const INHERITED = Object.fromEntries(
	VARIABLES.map((variable) => [variable, process.env[variable]]),
);

let directory = "";

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "omul-feedback-store-"));
	process.env.DATABASE_PATH = join(directory, "omul.sqlite");
	delete process.env.OMUL_FEEDBACK_ENABLED;
	delete process.env.OMUL_FEEDBACK_PROMPT_PERCENT;
	delete process.env.OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS;
	delete process.env.OMUL_FEEDBACK_DB;
});

const MENU_ONLY: FeedbackSettings = {
	menuEnabled: true,
	promptPercent: null,
	promptCooldownDays: 30,
};
const PROMPT_ONLY: FeedbackSettings = {
	menuEnabled: false,
	promptPercent: 25,
	promptCooldownDays: 14,
};

/** Import the module in a fresh process under `environment`. */
function importWith(environment: Record<string, string>) {
	const moduleUrl = new URL("./feedback-store.ts", import.meta.url).href;
	return Bun.spawnSync(
		["bun", "-e", `await import(${JSON.stringify(moduleUrl)});`],
		{
			env: {
				...process.env,
				DATABASE_PATH: join(directory, "omul.sqlite"),
				OMUL_FEEDBACK_ENABLED: "",
				OMUL_FEEDBACK_PROMPT_PERCENT: "",
				OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS: "",
				...environment,
			},
		},
	);
}

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

	test("importing the module with both switches unset creates no file either", () => {
		const imported = importWith({});
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

	test("the prompt alone opens it too, the menu's switch untouched (REQ186)", () => {
		process.env.OMUL_FEEDBACK_PROMPT_PERCENT = "10";
		const store = openConfiguredFeedbackStore();
		expect(store?.path).toBe(resolve(join(directory, "feedback.sqlite")));
		store?.close();
		expect(openConfiguredFeedbackStore(PROMPT_ONLY)).not.toBeNull();
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

describe("the prompt's settings (REQ186)", () => {
	test("unset is off, with the 30-day cooldown; blank counts as unset", () => {
		expect(readFeedbackSettings({})).toEqual({
			menuEnabled: false,
			promptPercent: null,
			promptCooldownDays: 30,
		});
		expect(
			readFeedbackSettings({
				OMUL_FEEDBACK_PROMPT_PERCENT: "  ",
				OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS: "",
			}),
		).toEqual({ menuEnabled: false, promptPercent: null, promptCooldownDays: 30 });
	});

	test("whole numbers in range are read as written, independently of the menu", () => {
		for (const [percent, days] of [
			["1", "1"],
			["100", "3650"],
			[" 25 ", "7"],
		] as const) {
			expect(
				readFeedbackSettings({
					OMUL_FEEDBACK_PROMPT_PERCENT: percent,
					OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS: days,
				}),
			).toEqual({
				menuEnabled: false,
				promptPercent: Number(percent),
				promptCooldownDays: Number(days),
			});
		}
		expect(
			readFeedbackSettings({
				OMUL_FEEDBACK_ENABLED: "true",
				OMUL_FEEDBACK_PROMPT_PERCENT: "50",
			}),
		).toMatchObject({ menuEnabled: true, promptPercent: 50 });
	});

	test("a malformed percentage throws, naming the variable and the value", () => {
		for (const written of ["0", "101", "abc", "50%", "1.5", "-5", "1e2", "0x10"]) {
			expect(() =>
				readFeedbackSettings({ OMUL_FEEDBACK_PROMPT_PERCENT: written }),
			).toThrow(`OMUL_FEEDBACK_PROMPT_PERCENT must be a whole number from 1 to 100, or unset; it is "${written}".`);
		}
	});

	test("a malformed cooldown throws, naming the variable — even with the prompt off", () => {
		for (const written of ["0", "3651", "thirty", "2.5", "-1"]) {
			expect(() =>
				readFeedbackSettings({ OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS: written }),
			).toThrow("OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS must be");
		}
	});

	test("a malformed value stops the module's import, so the server does not start", () => {
		for (const [variable, written] of [
			["OMUL_FEEDBACK_PROMPT_PERCENT", "150"],
			["OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS", "soon"],
		] as const) {
			const imported = importWith({ [variable]: written });
			expect(imported.exitCode).not.toBe(0);
			expect(imported.stderr.toString()).toContain(`${variable} must be`);
		}
		expect(existsSync(join(directory, "feedback.sqlite"))).toBe(false);
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

	test("a participant's answer keeps the trimmed comment, the rating, the language and the day — nothing else (REQ186)", () => {
		const path = join(directory, "feedback.sqlite");
		const store = createFeedbackStore(path);
		const entry = store.recordParticipantFeedback({
			rating: null,
			comment: "  Easy to join  ",
			language: "pt",
			now: Date.UTC(2026, 9, 9, 8, 15),
		});
		store.close();

		const db = new Database(path, { readonly: true });
		const rows = db.query("SELECT * FROM participant_feedback").all();
		db.close();
		expect(rows).toEqual([
			{
				id: entry.id,
				rating: null,
				comment: "Easy to join",
				language: "pt",
				createdOn: "2026-10-09",
			},
		]);
	});

	test("the day is UTC", () => {
		expect(feedbackDay(Date.UTC(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
	});
});

describe("reading a channel back (REQ185)", () => {
	test("an empty channel has no entries, no next page and nothing counted", () => {
		const store = createFeedbackStore(":memory:");
		expect(store.summarize("user")).toEqual({
			total: 0,
			ratingCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
			unratedCount: 0,
		});
		expect(store.listParticipantFeedback({ cursor: null, limit: 10 })).toEqual({
			entries: [],
			nextCursor: null,
		});
		store.close();
	});

	test("pages run newest first, end on a null cursor, and refuse a stranger's cursor", () => {
		const store = createFeedbackStore(":memory:");
		const ids = [1, 2, 3].map(
			(rating) =>
				store.recordUserFeedback({
					rating,
					comment: "",
					surface: "other",
					contactAccountId: null,
					language: "en",
					now: Date.UTC(2026, 0, 1),
				}).id,
		);
		const first = store.listUserFeedback({ cursor: null, limit: 2 });
		expect(first?.entries.map((entry) => entry.id)).toEqual([ids[2], ids[1]]);
		expect(first?.nextCursor).toBe(ids[1] ?? "");
		const second = store.listUserFeedback({
			cursor: first?.nextCursor ?? null,
			limit: 2,
		});
		expect(second).toEqual({
			entries: [expect.objectContaining({ id: ids[0], rating: 1 })],
			nextCursor: null,
		});
		expect(store.listUserFeedback({ cursor: "no-such-entry", limit: 2 })).toBeNull();
		store.close();
	});
});

describe("the boot line (REQ185, REQ186)", () => {
	test("off says so, naming both switches", () => {
		const lines = feedbackStartupReport(null, readFeedbackSettings({}), []);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toStartWith("[feedback] off");
		expect(lines[0]).toContain("OMUL_FEEDBACK_ENABLED");
		expect(lines[0]).toContain("OMUL_FEEDBACK_PROMPT_PERCENT");
	});

	test("on names the database, and warns when nobody can read it", () => {
		const store = createFeedbackStore(":memory:");
		const unread = feedbackStartupReport(store, MENU_ONLY, []);
		expect(unread[0]).toStartWith("[feedback] on");
		expect(unread[0]).toContain(":memory:");
		expect(unread[0]).toContain("GET /api/admin/feedback");
		expect(unread[3]).toContain("OMUL_ADMIN_EMAILS is empty");
		expect(
			feedbackStartupReport(store, MENU_ONLY, ["admin@example.com"]),
		).toHaveLength(3);
		store.close();
	});

	test("each channel's posture is its own line", () => {
		const store = createFeedbackStore(":memory:");
		const menuOnly = feedbackStartupReport(store, MENU_ONLY, ["a@example.com"]);
		expect(menuOnly[1]).toStartWith("[feedback] app menu: on");
		expect(menuOnly[2]).toStartWith("[feedback] prompt after a session: off");
		expect(menuOnly[2]).toContain("OMUL_FEEDBACK_PROMPT_PERCENT is unset");

		const promptOnly = feedbackStartupReport(store, PROMPT_ONLY, ["a@example.com"]);
		expect(promptOnly[1]).toStartWith("[feedback] app menu: off");
		expect(promptOnly[2]).toStartWith("[feedback] prompt after a session: on");
		expect(promptOnly[2]).toContain("25% of eligible participants");
		expect(promptOnly[2]).toContain("once every 14 days");
		expect(promptOnly[2]).toContain("POST /api/feedback/participant");
		expect(promptOnly[2]).toContain("a card on the ended screen");
		expect(promptOnly[2]).not.toContain("still to come");
		store.close();
	});
});
