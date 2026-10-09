/**
 * The feedback database — what people tell this instance's operator about omul
 * itself (REQ185), and later what participants answer after a session (REQ186).
 *
 * A dedicated `bun:sqlite` file, built the way `server/admin-events.ts` builds
 * `admin.sqlite`, and deliberately outside the zodstore domain data: feedback is
 * the operator's data about the product, not data in any deck, workspace or
 * account, so no presentation, workspace or deletion path ever touches it, and
 * backing it up, purging it or excluding it is one file.
 *
 * Two tables, one per channel — `user_feedback` (the app menu, this
 * requirement) and `participant_feedback` (REQ186, created here and not yet
 * written). Each holds only the columns REQ185 lists, and what it leaves out is
 * the point: no email address, participant id, name, presentation, workspace,
 * IP address or user agent, and no time finer than the UTC day. An account id
 * is kept only as `contactAccountId`, and only when the sender asked to be
 * contacted; the operator view (REQ185 slice 3, not built yet) is to resolve it
 * to an address at read time, so a changed address is followed and a deleted
 * account leaves nothing behind here.
 *
 * **Off unless `OMUL_FEEDBACK_ENABLED` is exactly `"true"`**, and off means
 * nothing is opened: the process-wide store is `null` and no file is created.
 * Its path is `OMUL_FEEDBACK_DB`, by default a `feedback.sqlite` sibling of the
 * docstore file; `:memory:` gives tests an isolated store.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FeedbackSurface } from "./schemas";
import { siblingDbPath } from "./sibling-db-path";

/** The switch that turns the feedback channel on. */
export const FEEDBACK_ENABLED_ENV = "OMUL_FEEDBACK_ENABLED";

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
	close(): void;
}

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

	function close(): void {
		db.close();
	}

	return { path, recordUserFeedback, close };
}

/** Whether the channel is on: exactly `"true"`, and nothing else. */
export function feedbackEnabled(): boolean {
	return process.env[FEEDBACK_ENABLED_ENV] === "true";
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
 * The store this environment asks for, or `null` while the channel is off — in
 * which case nothing is opened and no file is created.
 */
export function openConfiguredFeedbackStore(): FeedbackStore | null {
	return feedbackEnabled() ? createFeedbackStore(feedbackDbPath()) : null;
}

// Process-wide default feedback store, opened at import when the channel is on.
export const feedbackStore = openConfiguredFeedbackStore();

/**
 * Whether this deployment collects feedback, said on every boot. Off looks the
 * same as a menu that forgot the item, and on with no administrator looks the
 * same as a healthy channel — answers arrive and nobody can read them — so
 * both are stated rather than left to be noticed.
 *
 * The administrators are handed in rather than imported: `server/admins.ts`
 * reads its allowlist once, at import, and this module has no business deciding
 * when that happens.
 */
export function feedbackStartupReport(
	store: FeedbackStore | null,
	administrators: readonly string[],
): string[] {
	if (!store) {
		return [
			`[feedback] off — ${FEEDBACK_ENABLED_ENV} is not "true". No feedback is collected and no feedback database is opened.`,
		];
	}
	const lines = [
		`[feedback] on — feedback sent to POST /api/feedback is stored in ${store.path}. The app menu offers a feedback form; the administrators' view of the answers is not built yet (REQ185).`,
	];
	if (administrators.length === 0) {
		lines.push(
			"[feedback] WARNING — OMUL_ADMIN_EMAILS is empty, so nobody is an administrator and nobody will be able to read the answers once the administrators' view lands.",
		);
	}
	return lines;
}
