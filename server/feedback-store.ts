/**
 * The feedback database — what people tell this instance's operator about omul
 * itself (REQ185), and what participants answer after a session (REQ186).
 *
 * A dedicated `bun:sqlite` file, built the way `server/admin-events.ts` builds
 * `admin.sqlite`, and deliberately outside the zodstore domain data: feedback is
 * the operator's data about the product, not data in any deck, workspace or
 * account, so no presentation, workspace or deletion path ever touches it, and
 * backing it up, purging it or excluding it is one file.
 *
 * Two tables, one per channel — `user_feedback` (the app menu, REQ185) and
 * `participant_feedback` (the prompt after a session, REQ186, which never
 * holds an account id at all). Each holds only the columns REQ185 lists, and
 * what it leaves out is
 * the point: no email address, participant id, name, presentation, workspace,
 * IP address or user agent, and no time finer than the UTC day. An account id
 * is kept only as `contactAccountId`, and only when the sender asked to be
 * contacted; the operator view (`GET /api/admin/feedback`) resolves it to an
 * address at read time, so a changed address is followed and a deleted account
 * leaves nothing behind here.
 *
 * **Each channel has its own switch, and both are off on a fresh install**:
 * the app menu's is `OMUL_FEEDBACK_ENABLED` set to exactly `"true"`, the
 * prompt's is `OMUL_FEEDBACK_PROMPT_PERCENT` set at all, so an operator can run
 * either alone. With both off nothing is opened: the process-wide store is
 * `null` and no file is created. With either on the one store is opened, and
 * the routes answer `404` for the channel that is off. A malformed prompt
 * setting throws at import — that is, it stops the server at startup — with
 * an error naming the variable. The store's path is `OMUL_FEEDBACK_DB`, by
 * default a `feedback.sqlite` sibling of the docstore file; `:memory:` gives
 * tests an isolated store.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import {
	FEEDBACK_PROMPT_COOLDOWN_DAYS_DEFAULT,
	FEEDBACK_PROMPT_COOLDOWN_DAYS_MAX,
	type FeedbackChannel,
	FeedbackPromptCooldownDaysSettingSchema,
	FeedbackPromptPercentSettingSchema,
	type FeedbackRatingCounts,
	type FeedbackSurface,
	type ParticipantLanguage,
} from "./schemas";
import { siblingDbPath } from "./sibling-db-path";

/** The switch that turns the app menu's channel on (REQ185). */
export const FEEDBACK_ENABLED_ENV = "OMUL_FEEDBACK_ENABLED";

/**
 * The switch that turns the prompt after a session on (REQ186): the share of
 * eligible participants asked, a whole number from 1 to 100. Unset is off.
 */
export const FEEDBACK_PROMPT_PERCENT_ENV = "OMUL_FEEDBACK_PROMPT_PERCENT";

/** How many days a device waits before the prompt asks it again (REQ186). */
export const FEEDBACK_PROMPT_COOLDOWN_DAYS_ENV =
	"OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS";

/** Where the feedback database lives, when the default sibling will not do. */
export const FEEDBACK_DB_ENV = "OMUL_FEEDBACK_DB";

/** The feedback database's filename beside the docstore. */
export const FEEDBACK_DB_FILENAME = "feedback.sqlite";

/**
 * One entry sent from the app menu, as stored — every column of
 * `user_feedback` and nothing else.
 */
export interface UserFeedbackEntry {
	id: string;
	rating: number | null;
	comment: string | null;
	surface: FeedbackSurface;
	contactAccountId: string | null;
	language: string;
	/** UTC date, `YYYY-MM-DD` — never a finer time. */
	createdOn: string;
}

/**
 * One entry from the prompt after a session (REQ186), as stored — every column
 * of `participant_feedback` and nothing else.
 */
export interface ParticipantFeedbackEntry {
	id: string;
	rating: number | null;
	comment: string | null;
	language: string;
	/** UTC date, `YYYY-MM-DD` — never a finer time. */
	createdOn: string;
}

/** A channel's totals, over every entry it holds. */
export interface FeedbackSummary {
	total: number;
	ratingCounts: FeedbackRatingCounts;
	/** Entries that hold only a comment. */
	unratedCount: number;
}

/**
 * One page of a channel, newest first. `nextCursor` is the id of the page's
 * last entry when more follow it, and `null` on the last page.
 */
export interface FeedbackPage<Entry> {
	entries: Entry[];
	nextCursor: string | null;
}

/** Which page to read: the first (`cursor: null`), or the one after `cursor`. */
export interface FeedbackPageRequest {
	cursor: string | null;
	limit: number;
}

export interface FeedbackStore {
	/** Where this store's database lives (`:memory:` for an ephemeral one). */
	path: string;
	/**
	 * Store one app-menu entry. The caller has already decided that it holds a
	 * rating or a non-blank comment, and whose account — if anyone's — may be
	 * contacted about it.
	 */
	recordUserFeedback(input: {
		rating: number | null;
		comment: string;
		surface: FeedbackSurface;
		contactAccountId: string | null;
		language: string;
		now?: number;
	}): UserFeedbackEntry;
	/**
	 * Store one answer to the prompt after a session (REQ186). The caller has
	 * already decided that it holds a rating or a non-blank comment; there is
	 * nobody to record, because the table has no column for anyone.
	 */
	recordParticipantFeedback(input: {
		rating: number | null;
		comment: string;
		language: ParticipantLanguage;
		now?: number;
	}): ParticipantFeedbackEntry;
	/** A channel's total, and how many of its entries carry each rating or none. */
	summarize(channel: FeedbackChannel): FeedbackSummary;
	/**
	 * One page of app-menu entries, newest first — or `null` when `cursor` names
	 * no entry of this channel.
	 */
	listUserFeedback(
		request: FeedbackPageRequest,
	): FeedbackPage<UserFeedbackEntry> | null;
	/** The same, for the participant channel (REQ186). */
	listParticipantFeedback(
		request: FeedbackPageRequest,
	): FeedbackPage<ParticipantFeedbackEntry> | null;
	close(): void;
}

/** Each channel's table — a fixed map, so no caller ever names a table. */
const CHANNEL_TABLES: Record<FeedbackChannel, string> = {
	user: "user_feedback",
	participant: "participant_feedback",
};

const USER_FEEDBACK_COLUMNS =
	"id, rating, comment, surface, contactAccountId, language, createdOn";
const PARTICIPANT_FEEDBACK_COLUMNS = "id, rating, comment, language, createdOn";

/** The UTC day a timestamp falls on, and nothing finer. */
export function feedbackDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

export function createFeedbackStore(path: string): FeedbackStore {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const db = new Database(path, { create: true });
	if (path !== ":memory:") {
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA busy_timeout = 5000");
	}
	// The CHECKs restate the route's rules where the data lives, so a future
	// writer that forgets one fails here rather than storing a row nobody sent.
	db.exec(`
		CREATE TABLE IF NOT EXISTS user_feedback (
			id TEXT PRIMARY KEY,
			rating INTEGER CHECK (rating BETWEEN 1 AND 5),
			comment TEXT,
			surface TEXT NOT NULL CHECK (surface IN ('presenter', 'participant', 'other')),
			contactAccountId TEXT,
			language TEXT NOT NULL,
			createdOn TEXT NOT NULL,
			CHECK (rating IS NOT NULL OR comment IS NOT NULL)
		);
		CREATE TABLE IF NOT EXISTS participant_feedback (
			id TEXT PRIMARY KEY,
			rating INTEGER CHECK (rating BETWEEN 1 AND 5),
			comment TEXT,
			language TEXT NOT NULL,
			createdOn TEXT NOT NULL,
			CHECK (rating IS NOT NULL OR comment IS NOT NULL)
		);
	`);

	function recordUserFeedback(input: {
		rating: number | null;
		comment: string;
		surface: FeedbackSurface;
		contactAccountId: string | null;
		language: string;
		now?: number;
	}): UserFeedbackEntry {
		const comment = input.comment.trim();
		const entry: UserFeedbackEntry = {
			id: crypto.randomUUID(),
			rating: input.rating,
			comment: comment.length > 0 ? comment : null,
			surface: input.surface,
			contactAccountId: input.contactAccountId,
			language: input.language,
			createdOn: feedbackDay(input.now ?? Date.now()),
		};
		db.query(
			`INSERT INTO user_feedback
				(id, rating, comment, surface, contactAccountId, language, createdOn)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			entry.id,
			entry.rating,
			entry.comment,
			entry.surface,
			entry.contactAccountId,
			entry.language,
			entry.createdOn,
		);
		return entry;
	}

	function recordParticipantFeedback(input: {
		rating: number | null;
		comment: string;
		language: ParticipantLanguage;
		now?: number;
	}): ParticipantFeedbackEntry {
		const comment = input.comment.trim();
		const entry: ParticipantFeedbackEntry = {
			id: crypto.randomUUID(),
			rating: input.rating,
			comment: comment.length > 0 ? comment : null,
			language: input.language,
			createdOn: feedbackDay(input.now ?? Date.now()),
		};
		db.query(
			`INSERT INTO participant_feedback
				(id, rating, comment, language, createdOn)
				VALUES (?, ?, ?, ?, ?)`,
		).run(
			entry.id,
			entry.rating,
			entry.comment,
			entry.language,
			entry.createdOn,
		);
		return entry;
	}

	function summarize(channel: FeedbackChannel): FeedbackSummary {
		const groups = db
			.query<{ rating: number | null; count: number }, []>(
				`SELECT rating, COUNT(*) AS count FROM ${CHANNEL_TABLES[channel]} GROUP BY rating`,
			)
			.all();
		const summary: FeedbackSummary = {
			total: 0,
			ratingCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
			unratedCount: 0,
		};
		for (const group of groups) {
			summary.total += group.count;
			if (group.rating === null) summary.unratedCount = group.count;
			else {
				const rating = String(group.rating) as keyof FeedbackRatingCounts;
				summary.ratingCounts[rating] = group.count;
			}
		}
		return summary;
	}

	// Newest first is the day, then the order rows were written within it — the
	// rowid, since the day is all the time a row keeps. A cursor is the last
	// entry's id; the next page is every row strictly before it in that order, so
	// entries sent while an administrator pages land ahead of the first page
	// rather than repeating on a later one.
	function pageOf<Entry extends { id: string }>(
		table: string,
		columns: string,
		request: FeedbackPageRequest,
	): FeedbackPage<Entry> | null {
		const order = "ORDER BY createdOn DESC, rowid DESC LIMIT ?";
		let rows: Entry[];
		if (request.cursor === null) {
			rows = db
				.query<Entry, [number]>(`SELECT ${columns} FROM ${table} ${order}`)
				.all(request.limit + 1);
		} else {
			const anchor = db
				.query<{ createdOn: string; position: number }, [string]>(
					`SELECT createdOn, rowid AS position FROM ${table} WHERE id = ?`,
				)
				.get(request.cursor);
			if (!anchor) return null;
			rows = db
				.query<Entry, [string, number, number]>(
					`SELECT ${columns} FROM ${table} WHERE (createdOn, rowid) < (?, ?) ${order}`,
				)
				.all(anchor.createdOn, anchor.position, request.limit + 1);
		}
		const entries = rows.slice(0, request.limit);
		const last = entries[entries.length - 1];
		return {
			entries,
			nextCursor: rows.length > request.limit && last ? last.id : null,
		};
	}

	function listUserFeedback(
		request: FeedbackPageRequest,
	): FeedbackPage<UserFeedbackEntry> | null {
		return pageOf<UserFeedbackEntry>(
			CHANNEL_TABLES.user,
			USER_FEEDBACK_COLUMNS,
			request,
		);
	}

	function listParticipantFeedback(
		request: FeedbackPageRequest,
	): FeedbackPage<ParticipantFeedbackEntry> | null {
		return pageOf<ParticipantFeedbackEntry>(
			CHANNEL_TABLES.participant,
			PARTICIPANT_FEEDBACK_COLUMNS,
			request,
		);
	}

	function close(): void {
		db.close();
	}

	return {
		path,
		recordUserFeedback,
		recordParticipantFeedback,
		summarize,
		listUserFeedback,
		listParticipantFeedback,
		close,
	};
}

/** Which feedback channels this deployment runs, as its environment says. */
export interface FeedbackSettings {
	/** The app menu's channel (REQ185): `OMUL_FEEDBACK_ENABLED` is exactly `"true"`. */
	menuEnabled: boolean;
	/**
	 * The prompt after a session (REQ186): the share of eligible participants
	 * asked, from 1 to 100, or `null` while the prompt is off.
	 */
	promptPercent: number | null;
	/** How many days a device waits before the prompt asks it again. */
	promptCooldownDays: number;
}

type Environment = Record<string, string | undefined>;

/**
 * One whole-number variable: `null` when unset or blank, its value when it
 * reads as one in bounds, and otherwise an error that names the variable and
 * says what it holds — thrown, so a deployment that mistyped it does not start
 * with a guessed value instead.
 */
function readWholeNumberSetting(
	environment: Environment,
	name: string,
	schema: z.ZodType<number, z.ZodTypeDef, string>,
	expected: string,
): number | null {
	const written = (environment[name] ?? "").trim();
	if (written === "") return null;
	const parsed = schema.safeParse(written);
	if (!parsed.success) {
		throw new Error(
			`${name} must be ${expected}, or unset; it is ${JSON.stringify(written)}.`,
		);
	}
	return parsed.data;
}

/**
 * The feedback settings an environment asks for. Throws on a malformed prompt
 * setting, naming the variable; the menu's switch cannot be malformed, since
 * anything but exactly `"true"` is off.
 */
export function readFeedbackSettings(
	environment: Environment = process.env,
): FeedbackSettings {
	return {
		menuEnabled: environment[FEEDBACK_ENABLED_ENV] === "true",
		promptPercent: readWholeNumberSetting(
			environment,
			FEEDBACK_PROMPT_PERCENT_ENV,
			FeedbackPromptPercentSettingSchema,
			"a whole number from 1 to 100",
		),
		promptCooldownDays:
			readWholeNumberSetting(
				environment,
				FEEDBACK_PROMPT_COOLDOWN_DAYS_ENV,
				FeedbackPromptCooldownDaysSettingSchema,
				`a whole number of days from 1 to ${FEEDBACK_PROMPT_COOLDOWN_DAYS_MAX}`,
			) ?? FEEDBACK_PROMPT_COOLDOWN_DAYS_DEFAULT,
	};
}

/** Whether a channel collects answers under these settings. */
export function feedbackChannelOn(
	settings: FeedbackSettings,
	channel: FeedbackChannel,
): boolean {
	return channel === "user"
		? settings.menuEnabled
		: settings.promptPercent !== null;
}

/**
 * Where the feedback database lives: `OMUL_FEEDBACK_DB` when set, otherwise a
 * `feedback.sqlite` sibling of the docstore file — or `:memory:` when either of
 * those is, so an in-memory test docstore never leaves a file behind.
 */
export function feedbackDbPath(): string {
	return siblingDbPath(process.env[FEEDBACK_DB_ENV], FEEDBACK_DB_FILENAME);
}

/**
 * The store these settings ask for — opened while either channel is on — or
 * `null` while both are off, in which case nothing is opened and no file is
 * created.
 */
export function openConfiguredFeedbackStore(
	settings: FeedbackSettings = readFeedbackSettings(),
): FeedbackStore | null {
	return feedbackChannelOn(settings, "user") ||
		feedbackChannelOn(settings, "participant")
		? createFeedbackStore(feedbackDbPath())
		: null;
}

// The process-wide settings, read at import: a malformed one stops the server
// here, at startup, rather than on the first participant it would have asked.
export const feedbackSettings = readFeedbackSettings();

// Process-wide default feedback store, opened at import when a channel is on.
export const feedbackStore = openConfiguredFeedbackStore(feedbackSettings);

/**
 * Whether this deployment collects feedback, said on every boot, channel by
 * channel. Off looks the same as a menu that forgot the item or a prompt that
 * never comes, and on with no administrator looks the same as a healthy
 * channel — answers arrive and nobody can read them — so each is stated rather
 * than left to be noticed.
 *
 * The administrators are handed in rather than imported: `server/admins.ts`
 * reads its allowlist once, at import, and this module has no business deciding
 * when that happens.
 */
export function feedbackStartupReport(
	store: FeedbackStore | null,
	settings: FeedbackSettings,
	administrators: readonly string[],
): string[] {
	if (!store) {
		return [
			`[feedback] off — ${FEEDBACK_ENABLED_ENV} is not "true" and ${FEEDBACK_PROMPT_PERCENT_ENV} is unset. No feedback is collected and no feedback database is opened.`,
		];
	}
	const lines = [
		`[feedback] on — answers are stored in ${store.path}; administrators read them on /app/admin/feedback or from GET /api/admin/feedback (REQ185).`,
		feedbackChannelOn(settings, "user")
			? "[feedback] app menu: on — every screen's app menu offers a feedback form, sent to POST /api/feedback."
			: `[feedback] app menu: off — ${FEEDBACK_ENABLED_ENV} is not "true", so the menu offers no form and POST /api/feedback answers 404.`,
		settings.promptPercent !== null
			? `[feedback] prompt after a session: on — ${settings.promptPercent}% of eligible participants, a device at most once every ${settings.promptCooldownDays} days, answering to POST /api/feedback/participant (REQ186). The card on the participant's ended screen is still to come, so no participant is asked yet.`
			: `[feedback] prompt after a session: off — ${FEEDBACK_PROMPT_PERCENT_ENV} is unset, so POST /api/feedback/participant answers 404.`,
	];
	if (administrators.length === 0) {
		lines.push(
			"[feedback] WARNING — OMUL_ADMIN_EMAILS is empty, so nobody is an administrator and nobody can read the answers.",
		);
	}
	return lines;
}
